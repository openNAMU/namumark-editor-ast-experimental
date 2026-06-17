/**
 * Typed representation of namumark's AST JSON output.
 *
 * The C renderer (renderer_ast.c) prints a generic node shape: every node has
 * the same fields regardless of type. We mirror that here so consumers get full
 * type safety, plus a small parse helper.
 *
 * Position semantics (verified empirically against the feat/token-position
 * build of namumark):
 *  - `start_line` / `end_line` are 1-based.
 *  - `start_column` / `end_column` are 1-based **byte offsets** within the
 *    source line, half-open: `end_column` points just past the node's last byte.
 *  - Inline child nodes report absolute columns (not reset per parent).
 *  - Node spans cover the node's *content*; markup delimiters (`'''`, `[[`,
 *    `||`, ...) are NOT separately positioned.
 */

/** Node type strings emitted by node_type_name() in renderer_ast.c. */
export type AstNodeType =
  | "document"
  | "redirect"
  | "heading"
  | "list"
  | "list_item"
  | "footnote_definition"
  | "blockquote"
  | "horizontal_rule"
  | "table"
  | "category"
  | "wiki_block"
  | "preformatted"
  | "text"
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "superscript"
  | "subscript"
  | "link"
  | "image"
  | "video"
  | "footnote_reference"
  | "macro"
  | "comment"
  | "advanced"
  | "unknown";

/** Source span; lines/columns 1-based, columns are byte offsets, half-open. */
export interface AstPosition {
  start_line: number;
  start_column: number;
  end_line: number;
  end_column: number;
}

/** One AST node as produced by namumark's diagnostic JSON renderer. */
export interface AstNode {
  type: AstNodeType;
  position: AstPosition;
  content: string;
  level: number;
  folded: number;
  depth: number;
  indent: number;
  start_number: number;
  fixed_comment: number;
  list_marker: number;
  link_type: number;
  advanced_type: number;
  macro_type: number;
  label: string;
  target: string;
  args: string;
  onclick: string;
  tag: string;
  /** Only present on the document root. */
  categories?: string[];
  children: AstNode[];
}

/** Parse the AST JSON string into a typed tree. */
export function parseAst(json: string): AstNode {
  return JSON.parse(json) as AstNode;
}

/** Depth-first pre-order traversal helper. */
export function walkAst(
  node: AstNode,
  visit: (node: AstNode, depth: number) => void,
  depth = 0,
): void {
  visit(node, depth);
  for (const child of node.children) walkAst(child, visit, depth + 1);
}
