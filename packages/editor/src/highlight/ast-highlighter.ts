/**
 * AST-driven highlighter.
 *
 * Turns the namumark AST into per-line {@link LineTokens} for the view.
 *
 * Strategy
 * --------
 * 1. Walk the AST. For every node we care about, convert its byte-based source
 *    span into UTF-16 (line, column) coordinates via {@link LineByteIndex}.
 * 2. A node that has children delegates its *covered* character ranges to those
 *    children; the leftover ranges inside the node (the gaps not claimed by any
 *    child) are emitted as {@link TokenType.Delimiter} tokens. That is how
 *    markup punctuation (`'''`, `[[`, `||`, `==`, ...) gets colored even though
 *    the AST never gives delimiters their own span.
 * 3. Leaf nodes (no children, e.g. `text`) emit a single typed token over their
 *    own span.
 * 4. All spans are clipped to single lines and merged into a flat, ordered,
 *    non-overlapping token list per line.
 *
 * The result is a "semantic + delimiter" highlight that relies entirely on the
 * namumark parser for structure, with no second NamuMark grammar in JS.
 */
import type { AstNode, AstNodeType } from "@namumark/wasm";
import { LineByteIndex } from "./byte-column.js";
import { TokenType, type LineTokens, type Token } from "./token.js";

/** Map an AST node type to a highlight TokenType. */
function tokenTypeForNode(type: AstNodeType): TokenType {
  switch (type) {
    case "heading":
      return TokenType.Heading;
    case "bold":
      return TokenType.Bold;
    case "italic":
      return TokenType.Italic;
    case "underline":
      return TokenType.Underline;
    case "strikethrough":
      return TokenType.Strikethrough;
    case "superscript":
      return TokenType.Superscript;
    case "subscript":
      return TokenType.Subscript;
    case "link":
      return TokenType.Link;
    case "image":
      return TokenType.Image;
    case "video":
      return TokenType.Video;
    case "macro":
      return TokenType.Macro;
    case "comment":
      return TokenType.Comment;
    case "redirect":
      return TokenType.Redirect;
    case "category":
      return TokenType.Category;
    case "list_item":
      return TokenType.ListItem;
    case "blockquote":
      return TokenType.Blockquote;
    case "horizontal_rule":
      return TokenType.HorizontalRule;
    case "table":
      return TokenType.Table;
    case "wiki_block":
      return TokenType.WikiBlock;
    case "preformatted":
      return TokenType.Preformatted;
    case "footnote_definition":
    case "footnote_reference":
      return TokenType.Footnote;
    case "advanced":
      return TokenType.Advanced;
    case "text":
    case "document":
    case "list":
    default:
      return TokenType.Text;
  }
}

/** Node types that are pure structure: their direct text is delimiters/markup. */
const STRUCTURAL_WRAPPERS: ReadonlySet<AstNodeType> = new Set<AstNodeType>([
  "document",
  "list",
]);

/** A resolved span in UTF-16 line/column space. */
interface SpanToken {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  type: TokenType;
}

/**
 * Produce per-line tokens for a document given its AST and source lines.
 */
export function highlightAst(
  root: AstNode,
  lines: readonly string[],
): LineTokens[] {
  const indices = lines.map((line) => new LineByteIndex(line));
  const collector = new LineTokenCollector(lines.length);

  // The document root has no meaningful span; start from its children.
  for (const child of root.children) {
    emitNode(child, indices, collector);
  }

  return collector.finish();
}

/**
 * Emit tokens for `node`. Wrapper nodes contribute no token of their own; nodes
 * with children color the gaps (delimiters) around their children; leaves color
 * their whole span.
 */
function emitNode(
  node: AstNode,
  indices: LineByteIndex[],
  collector: LineTokenCollector,
): void {
  const span = resolveSpan(node, indices);
  const type = tokenTypeForNode(node.type);
  const isWrapper = STRUCTURAL_WRAPPERS.has(node.type);

  if (node.children.length === 0) {
    // Leaf: color the whole span (unless it's a contentless wrapper).
    if (!isWrapper && span) collector.add({ ...span, type });
    return;
  }

  // Node with children. Emit children first, then fill the gaps inside this
  // node's own span with the appropriate token: delimiters for content nodes,
  // nothing for pure wrappers (document/list).
  const childSpans: SpanToken[] = [];
  for (const child of node.children) {
    const cs = resolveSpan(child, indices);
    if (cs) childSpans.push({ ...cs, type: tokenTypeForNode(child.type) });
    emitNode(child, indices, collector);
  }

  if (isWrapper || !span) return;

  // The "gap" type: for a heading the gaps are the `==` markers, for bold the
  // `'''`, for a link the `[[ | ]]`, etc. We use Delimiter for the markup, but
  // keep the node's own color for any uncovered content that is not a child
  // (rare). To keep it simple and visually consistent, gaps become Delimiter.
  for (const gap of subtractSpans(span, childSpans)) {
    collector.add({ ...gap, type: TokenType.Delimiter });
  }
}

/** Convert a node's byte-based AST span into a UTF-16 SpanToken (or null). */
function resolveSpan(node: AstNode, indices: LineByteIndex[]): SpanToken | null {
  const p = node.position;
  if (p.start_line < 1 || p.end_line < 1) return null;
  const startIdx = indices[p.start_line - 1];
  const endIdx = indices[p.end_line - 1];
  if (!startIdx || !endIdx) return null;

  const startColumn = startIdx.byteColumnToUtf16Column(p.start_column);
  const endColumn = endIdx.byteColumnToUtf16Column(p.end_column);

  // Reject empty/degenerate spans on a single line.
  if (
    p.start_line === p.end_line &&
    endColumn <= startColumn
  ) {
    return null;
  }

  return {
    startLine: p.start_line,
    startColumn,
    endLine: p.end_line,
    endColumn,
    type: TokenType.Text,
  };
}

/**
 * Compute parent-minus-children: the ranges of `parent` not covered by any of
 * `children`. Works across multiple lines by flattening to absolute coordinates
 * is unnecessary here because the view consumes per-line tokens; instead we
 * subtract line-by-line.
 */
function subtractSpans(parent: SpanToken, children: SpanToken[]): SpanToken[] {
  const gaps: SpanToken[] = [];
  for (let line = parent.startLine; line <= parent.endLine; line++) {
    const lineStart = line === parent.startLine ? parent.startColumn : 1;
    // Open-ended on multi-line; the collector clips to actual line length.
    const lineEnd =
      line === parent.endLine ? parent.endColumn : Number.MAX_SAFE_INTEGER;

    // Collect child intervals that touch this line.
    const intervals = children
      .filter((c) => c.startLine <= line && c.endLine >= line)
      .map((c) => ({
        start: c.startLine === line ? c.startColumn : 1,
        end: c.endLine === line ? c.endColumn : Number.MAX_SAFE_INTEGER,
      }))
      .sort((a, b) => a.start - b.start);

    let cursor = lineStart;
    for (const iv of intervals) {
      if (iv.start > cursor) {
        gaps.push(makeGap(line, cursor, Math.min(iv.start, lineEnd)));
      }
      cursor = Math.max(cursor, iv.end);
      if (cursor >= lineEnd) break;
    }
    if (cursor < lineEnd) gaps.push(makeGap(line, cursor, lineEnd));
  }
  return gaps.filter((g) => g.endColumn > g.startColumn);
}

function makeGap(line: number, start: number, end: number): SpanToken {
  return {
    startLine: line,
    startColumn: start,
    endLine: line,
    endColumn: end,
    type: TokenType.Delimiter,
  };
}

/**
 * Accumulates SpanTokens, clipping to lines and producing a clean, ordered,
 * non-overlapping token list per line. Later additions win on overlap, which
 * means deeper/leaf tokens (added before their parents' gaps) are preserved.
 */
class LineTokenCollector {
  // Per line (1-based index): array of [start, end, type] kept sorted & merged.
  private readonly perLine: Token[][];

  constructor(lineCount: number) {
    this.perLine = Array.from({ length: Math.max(lineCount, 1) }, () => []);
  }

  add(span: SpanToken): void {
    for (let line = span.startLine; line <= span.endLine; line++) {
      const arr = this.perLine[line - 1];
      if (!arr) continue;
      const startColumn = line === span.startLine ? span.startColumn : 1;
      const endColumn =
        line === span.endLine ? span.endColumn : Number.MAX_SAFE_INTEGER;
      if (endColumn > startColumn) {
        arr.push({ startColumn, endColumn, type: span.type });
      }
    }
  }

  /**
   * Resolve overlaps so the view receives contiguous, non-overlapping tokens.
   * Earlier-added tokens (children/leaves) take priority over later ones
   * (parent gaps), which matches the emit order in {@link emitNode}.
   */
  finish(): LineTokens[] {
    const result: LineTokens[] = [];
    for (let i = 0; i < this.perLine.length; i++) {
      const raw = this.perLine[i]!;
      result.push({ lineNumber: i + 1, tokens: resolveOverlaps(raw) });
    }
    return result;
  }
}

/**
 * Flatten overlapping tokens into non-overlapping runs. Priority: a token added
 * earlier (lower index) wins over a later one where they overlap.
 */
function resolveOverlaps(tokens: Token[]): Token[] {
  if (tokens.length === 0) return [];

  // Collect all boundary columns.
  const bounds = new Set<number>();
  for (const t of tokens) {
    bounds.add(t.startColumn);
    bounds.add(t.endColumn);
  }
  const sorted = [...bounds].sort((a, b) => a - b);

  const out: Token[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i]!;
    const end = sorted[i + 1]!;
    if (end <= start) continue;
    // Find the highest-priority (earliest-added) token covering [start, end).
    let chosen: Token | undefined;
    for (const t of tokens) {
      if (t.startColumn <= start && t.endColumn >= end) {
        chosen = t;
        break; // earliest wins
      }
    }
    if (chosen) {
      // Merge with previous run if same type and contiguous.
      const prev = out[out.length - 1];
      if (prev && prev.type === chosen.type && prev.endColumn === start) {
        out[out.length - 1] = {
          startColumn: prev.startColumn,
          endColumn: end,
          type: prev.type,
        };
      } else {
        out.push({ startColumn: start, endColumn: end, type: chosen.type });
      }
    }
  }
  return out;
}
