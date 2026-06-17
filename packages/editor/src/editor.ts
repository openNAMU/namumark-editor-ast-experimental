/**
 * NamumarkEditor: the public, high-level editor.
 *
 * Composes:
 *  - the WASM namumark parser (@namumark/wasm) for AST + HTML,
 *  - the AST-driven highlighter (highlightAst) for syntax coloring,
 *  - the Monaco-style EditorView for input and rendering.
 *
 * The parser runs synchronously once loaded, so highlighting happens on every
 * change. The HTML preview is available on demand via {@link renderHtml}.
 *
 * Loading is async because the WASM module must be instantiated first. Use
 * {@link NamumarkEditor.create}.
 */
import { Namumark } from "@namumark/wasm";
import { highlightAst } from "./highlight/ast-highlighter.js";
import type { LineTokens } from "./highlight/token.js";
import { EditorView } from "./view/editor-view.js";

export interface NamumarkEditorOptions {
  /** Initial document text. */
  value?: string;
  /** Fired whenever the document changes. */
  onChange?: (value: string) => void;
  /**
   * Override how the `.wasm` binary is located (passed to the WASM loader).
   * Useful with bundlers/CDNs.
   */
  locateWasm?: (path: string) => string;
}

export class NamumarkEditor {
  private readonly view: EditorView;
  private readonly parser: Namumark;

  private constructor(view: EditorView, parser: Namumark) {
    this.view = view;
    this.parser = parser;
  }

  /** Create an editor, loading the WASM parser first. */
  static async create(
    container: HTMLElement,
    options: NamumarkEditorOptions = {},
  ): Promise<NamumarkEditor> {
    const parser = await Namumark.create(
      options.locateWasm ? { locateFile: options.locateWasm } : {},
    );

    const tokenize = (lines: readonly string[]): LineTokens[] => {
      const source = lines.join("\n");
      try {
        const ast = parser.parseAst(source);
        return highlightAst(ast, lines);
      } catch {
        // On any parser error, fall back to no highlighting rather than break
        // editing. The HTML preview will surface the real error if requested.
        return lines.map((_, i) => ({ lineNumber: i + 1, tokens: [] }));
      }
    };

    const view = new EditorView(container, {
      value: options.value,
      tokenize,
      onChange: options.onChange,
    });

    return new NamumarkEditor(view, parser);
  }

  /** Current document text. */
  getValue(): string {
    return this.view.getValue();
  }

  /** Replace the document text. */
  setValue(value: string): void {
    this.view.setValue(value);
  }

  /** Render the current document to NamuMark HTML. */
  renderHtml(): string {
    return this.parser.renderHtml(this.getValue());
  }

  /** Parse the current document to AST JSON (diagnostic). */
  renderAstJson(): string {
    return this.parser.renderAstJson(this.getValue());
  }

  /**
   * The namumark parser release version string (e.g. "0.1.0").
   *
   * Uses the library release version, which is the accurate user-facing value;
   * the parser's public-API version macro currently lags upstream.
   */
  parserVersion(): string {
    return this.parser.libVersion();
  }

  /** True when text is currently selected (e.g. via drag). */
  hasSelection(): boolean {
    return this.view.hasSelection();
  }

  /** The currently selected text, or an empty string. */
  getSelectedText(): string {
    return this.view.getSelectedText();
  }

  focus(): void {
    this.view.focus();
  }

  dispose(): void {
    this.view.dispose();
  }
}
