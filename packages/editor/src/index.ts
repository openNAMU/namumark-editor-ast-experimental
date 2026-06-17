/**
 * @namumark/editor
 *
 * AST-aware NamuMark syntax-highlighting editor. The text editing core follows
 * the Monaco model (hidden textarea for input + custom DOM rendering + a fake
 * cursor) and never uses `contenteditable`. Syntax highlighting is derived
 * entirely from the namumark C parser compiled to WASM (@namumark/wasm); there
 * is no second NamuMark grammar implemented in JavaScript.
 */
export { NamumarkEditor } from "./editor.js";
export type { NamumarkEditorOptions } from "./editor.js";

// Lower-level building blocks, exported for advanced/embedding use.
export { EditorView } from "./view/editor-view.js";
export type { EditorViewOptions, TokenizeFn } from "./view/editor-view.js";
export { TextModel } from "./model/text-model.js";
export type { Position, Range } from "./model/position.js";
export { highlightAst } from "./highlight/ast-highlighter.js";
export { TokenType } from "./highlight/token.js";
export type { Token, LineTokens } from "./highlight/token.js";
export { LineByteIndex } from "./highlight/byte-column.js";
