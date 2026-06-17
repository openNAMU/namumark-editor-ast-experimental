/**
 * Token model for syntax highlighting.
 *
 * A token is a half-open UTF-16 span [startColumn, endColumn) on a single line,
 * tagged with a semantic {@link TokenType}. The view maps each TokenType to a
 * CSS class (`nm-tok-<type>`), exactly like Monaco wraps text runs in styled
 * <span> elements rather than using contenteditable formatting.
 *
 * Tokens are derived from the namumark AST. Because the AST positions cover
 * node *content* (not markup punctuation), the highlighter additionally emits
 * {@link TokenType.Delimiter} tokens for the gaps between a structural node's
 * span and its children/siblings — that is how `'''`, `[[ ]]`, `||`, `==` etc.
 * get colored without dedicated AST spans.
 */

/** Semantic classes for a highlighted run, derived from AST node types. */
export enum TokenType {
  Text = "text",
  Heading = "heading",
  Bold = "bold",
  Italic = "italic",
  Underline = "underline",
  Strikethrough = "strikethrough",
  Superscript = "superscript",
  Subscript = "subscript",
  Link = "link",
  Image = "image",
  Video = "video",
  Macro = "macro",
  Comment = "comment",
  Redirect = "redirect",
  Category = "category",
  ListItem = "list-item",
  Blockquote = "blockquote",
  HorizontalRule = "horizontal-rule",
  Table = "table",
  WikiBlock = "wiki-block",
  Preformatted = "preformatted",
  Footnote = "footnote",
  Advanced = "advanced",
  /** Inferred markup punctuation (delimiters) between content spans. */
  Delimiter = "delimiter",
}

/** A single highlighted span on one line; columns are 1-based UTF-16, half-open. */
export interface Token {
  readonly startColumn: number;
  readonly endColumn: number;
  readonly type: TokenType;
}

/** All tokens for one line, ordered left-to-right and non-overlapping. */
export interface LineTokens {
  readonly lineNumber: number;
  readonly tokens: readonly Token[];
}
