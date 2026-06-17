/**
 * EditorView: the Monaco-style rendering core.
 *
 * Architecture (mirrors the approach described for Monaco):
 *
 *  1. Hidden <textarea> (input + focus): an off-screen, visually-hidden real
 *     <textarea> receives all keyboard focus and input. We never use
 *     `contenteditable`. The textarea's value is kept as a tiny window of text
 *     around the caret so the browser/IME has something real to edit; its
 *     `input` events are translated into edits on the {@link TextModel}.
 *
 *  2. Custom DOM rendering (display): the visible text is drawn by us as one
 *     <div class="nm-line"> per line, each containing <span> runs colored by
 *     token type. No browser formatting is involved, so highlighting is fully
 *     under our control and identical across browsers.
 *
 *  3. Fake cursor (caret): a <div class="nm-cursor"> positioned with left/top
 *     computed from the caret's (line, column). It blinks via CSS. The real
 *     textarea caret is invisible and off-screen.
 *
 *  4. Mouse mapping & geometry: caret/selection x positions and click→column
 *     mapping are derived from the *actually painted* text using DOM Range
 *     measurement (see columnToX), not a fixed character width. This keeps the
 *     caret and selection aligned with the glyphs even for full-width CJK
 *     characters and other variable-advance text. All overlays share one
 *     coordinate origin (.nm-content) so no padding compensation is needed.
 *
 *  5. Selection: like the caret, the selection is drawn by us as positioned
 *     rectangles (one per line) in a layer beneath the text — the browser's
 *     native selection does not apply to our custom DOM. A selection has an
 *     `anchor` (fixed end) and the `caret` (active end). Drag selection,
 *     shift-click, shift+arrow, double-click word select, and Ctrl/Cmd+A are
 *     supported, and typing/Backspace/Delete replace the selection.
 *
 * This file owns geometry and event wiring; tokenization is injected via a
 * `tokenize` callback so the view stays agnostic about NamuMark.
 */
import type { LineTokens, Token } from "../highlight/token.js";
import { TextModel } from "../model/text-model.js";
import type { Position, Range } from "../model/position.js";
import { orderPositions, positionsEqual } from "../model/position.js";
import { clearChildren, el } from "./dom.js";

/** Callback that returns highlight tokens for the current document lines. */
export type TokenizeFn = (lines: readonly string[]) => LineTokens[];

export interface EditorViewOptions {
  /** Initial document text. */
  value?: string;
  /** Produce highlight tokens. If omitted, everything renders as plain text. */
  tokenize?: TokenizeFn;
  /** Optional callback fired after the model changes. */
  onChange?: (value: string) => void;
}

export class EditorView {
  readonly model: TextModel;

  private readonly root: HTMLElement;
  private readonly scroll: HTMLElement;
  private readonly content: HTMLElement;
  private readonly selectionLayer: HTMLElement;
  private readonly linesContainer: HTMLElement;
  private readonly cursorEl: HTMLElement;
  private readonly textarea: HTMLTextAreaElement;

  private tokenize: TokenizeFn;
  private readonly onChange: ((value: string) => void) | undefined;

  /** Caret position (1-based line/column), UTF-16 columns. */
  private caret: Position = { lineNumber: 1, column: 1 };

  /**
   * Selection anchor: where a selection started (mousedown / shift navigation).
   * The active end is always {@link caret}. When the anchor equals the caret
   * there is no selection (empty range), and only the caret is shown.
   */
  private anchor: Position = { lineNumber: 1, column: 1 };

  /** True while a drag selection is in progress (mouse button held). */
  private dragging = false;

  /** Bound document-level drag handlers, installed only while dragging. */
  private readonly onDocMouseMove = (ev: MouseEvent) => this.handleDragMove(ev);
  private readonly onDocMouseUp = () => this.endDrag();

  /** Cached measured character cell size. */
  private charWidth = 8;
  private lineHeight = 19;

  private disposed = false;
  private readonly disposers: Array<() => void> = [];

  constructor(container: HTMLElement, options: EditorViewOptions = {}) {
    this.model = new TextModel(options.value ?? "");
    this.tokenize = options.tokenize ?? defaultTokenize;
    this.onChange = options.onChange;

    // --- DOM scaffold --------------------------------------------------
    this.root = el("div", "nm-editor");
    this.root.tabIndex = -1;

    this.scroll = el("div", "nm-scroll");
    // A single content box establishes the shared coordinate origin for the
    // text and every overlay (selection, caret, input). Because all of them are
    // positioned relative to this same box, geometry computed as
    // `(column-1) * charWidth` lines up with the rendered text exactly — there
    // is no padding to compensate for separately.
    this.content = el("div", "nm-content");
    // Selection highlights render as positioned rectangles beneath the text.
    this.selectionLayer = el("div", "nm-selection-layer");
    this.selectionLayer.setAttribute("aria-hidden", "true");
    this.linesContainer = el("div", "nm-lines");
    this.cursorEl = el("div", "nm-cursor");
    this.cursorEl.setAttribute("aria-hidden", "true");

    // The real, hidden input surface.
    this.textarea = document.createElement("textarea");
    this.textarea.className = "nm-input";
    this.textarea.setAttribute("autocapitalize", "off");
    this.textarea.setAttribute("autocorrect", "off");
    this.textarea.setAttribute("autocomplete", "off");
    this.textarea.setAttribute("spellcheck", "false");
    this.textarea.setAttribute("aria-label", "NamuMark editor");

    // Order matters for stacking: selection (bottom) → text → caret → input.
    this.content.appendChild(this.selectionLayer);
    this.content.appendChild(this.linesContainer);
    this.content.appendChild(this.cursorEl);
    this.content.appendChild(this.textarea);
    this.scroll.appendChild(this.content);
    this.root.appendChild(this.scroll);
    container.appendChild(this.root);

    this.measureCharCell();
    this.wireEvents();
    this.render();
    this.updateCursor();
    this.renderSelection();
  }

  /** Replace the document text. */
  setValue(value: string): void {
    this.model.setValue(value);
    this.caret = { lineNumber: 1, column: 1 };
    this.anchor = this.caret;
    this.render();
    this.updateCursor();
    this.renderSelection();
    this.onChange?.(this.model.getValue());
  }

  getValue(): string {
    return this.model.getValue();
  }

  /**
   * The current selection as an ordered range (start <= end). When empty, start
   * and end are equal and located at the caret.
   */
  getSelection(): Range {
    const [start, end] = orderPositions(this.anchor, this.caret);
    return {
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column,
    };
  }

  /** True when the selection spans at least one character. */
  hasSelection(): boolean {
    return !positionsEqual(this.anchor, this.caret);
  }

  /** The currently selected text (empty string when there is no selection). */
  getSelectedText(): string {
    const sel = this.getSelection();
    const startOffset = this.model.positionToOffset({
      lineNumber: sel.startLineNumber,
      column: sel.startColumn,
    });
    const endOffset = this.model.positionToOffset({
      lineNumber: sel.endLineNumber,
      column: sel.endColumn,
    });
    return this.model.getValue().slice(startOffset, endOffset);
  }

  /** Swap the tokenizer (e.g. once the WASM parser becomes available). */
  setTokenizer(tokenize: TokenizeFn): void {
    this.tokenize = tokenize;
    this.render();
  }

  focus(): void {
    this.textarea.focus();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.endDrag(); // remove any active document-level drag listeners
    for (const d of this.disposers) d();
    this.root.remove();
  }

  // --- Rendering -------------------------------------------------------

  /** Re-render all visible lines from the model + tokenizer. */
  private render(): void {
    const lines = this.model.getLines();
    const tokensByLine = this.tokenize(lines);

    clearChildren(this.linesContainer);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < lines.length; i++) {
      frag.appendChild(this.renderLine(lines[i]!, tokensByLine[i]));
    }
    this.linesContainer.appendChild(frag);
  }

  /** Build one <div class="nm-line"> with token <span>s. */
  private renderLine(text: string, lineTokens: LineTokens | undefined): HTMLElement {
    const lineEl = el("div", "nm-line");
    if (text.length === 0) {
      // Keep empty lines selectable/height-stable with a zero-width space.
      lineEl.appendChild(document.createTextNode("\u200b"));
      return lineEl;
    }

    const tokens = lineTokens?.tokens ?? [];
    let column = 1;
    for (const token of tokens) {
      // Plain text between tokens.
      if (token.startColumn > column) {
        lineEl.appendChild(
          textSpan(text.slice(column - 1, token.startColumn - 1)),
        );
      }
      lineEl.appendChild(tokenSpan(text, token));
      column = Math.max(column, token.endColumn);
    }
    // Trailing plain text.
    if (column - 1 < text.length) {
      lineEl.appendChild(textSpan(text.slice(column - 1)));
    }
    return lineEl;
  }

  // --- Cursor ----------------------------------------------------------

  private updateCursor(): void {
    const x = this.columnToX(this.caret.lineNumber, this.caret.column);
    const y = (this.caret.lineNumber - 1) * this.lineHeight;
    this.cursorEl.style.transform = `translate(${x}px, ${y}px)`;
    this.cursorEl.style.height = `${this.lineHeight}px`;

    // Keep the hidden textarea where the caret is, so IME composition popups
    // appear in the right place.
    this.textarea.style.transform = `translate(${x}px, ${y}px)`;

    // The blinking caret is distracting during an active selection; hide it
    // while a non-empty range is selected (matches common editor behavior).
    this.cursorEl.style.display = this.hasSelection() ? "none" : "";
  }

  // --- Selection -------------------------------------------------------

  /**
   * Render the selection as one positioned rectangle per covered line.
   *
   * Because the editor draws its own text (no contenteditable / native
   * selection), it must also draw its own selection highlight. Each line's
   * rectangle spans from its selected start column to its selected end column;
   * lines fully inside a multi-line selection extend one extra cell to suggest
   * the trailing newline, the way Monaco/VS Code do.
   */
  private renderSelection(): void {
    clearChildren(this.selectionLayer);
    if (!this.hasSelection()) return;

    const sel = this.getSelection();
    const frag = document.createDocumentFragment();

    for (
      let line = sel.startLineNumber;
      line <= sel.endLineNumber;
      line++
    ) {
      const lineLength = this.model.getLineLength(line);
      const startCol = line === sel.startLineNumber ? sel.startColumn : 1;
      const endCol =
        line === sel.endLineNumber ? sel.endColumn : lineLength + 1;

      // Measure the painted edges so the rectangle hugs the real glyphs
      // (correct for CJK / full-width characters, not just ASCII).
      const left = this.columnToX(line, startCol);
      let right = this.columnToX(line, endCol);
      // Lines that are not the last selected line include the line break, drawn
      // as a small trailing strip beyond the text to suggest the newline.
      if (line < sel.endLineNumber) right += this.charWidth * 0.5;
      const top = (line - 1) * this.lineHeight;

      const rect = el("div", "nm-selection");
      rect.style.transform = `translate(${left}px, ${top}px)`;
      rect.style.width = `${Math.max(right - left, 1)}px`;
      rect.style.height = `${this.lineHeight}px`;
      frag.appendChild(rect);
    }

    this.selectionLayer.appendChild(frag);
  }

  // --- Geometry --------------------------------------------------------

  /**
   * Measure one monospace character cell.
   *
   * The probe must mirror the real rendering exactly: text is placed inside a
   * `.nm-tok` span within a `.nm-line` (the same nesting actual content uses),
   * so any span-level metrics (font, letter-spacing) are accounted for. A long
   * run is measured and divided to average out sub-pixel rounding, keeping the
   * computed caret/selection geometry in lock-step with the painted glyphs.
   */
  private measureCharCell(): void {
    const SAMPLE_LEN = 100;
    const line = el("div", "nm-line");
    line.style.position = "absolute";
    line.style.visibility = "hidden";
    line.style.whiteSpace = "pre";
    line.style.left = "-9999px";
    line.style.top = "0";

    const span = el("span", "nm-tok nm-tok-text");
    span.textContent = "0".repeat(SAMPLE_LEN);
    line.appendChild(span);
    this.linesContainer.appendChild(line);

    const spanRect = span.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    if (spanRect.width > 0) this.charWidth = spanRect.width / SAMPLE_LEN;
    if (lineRect.height > 0) this.lineHeight = lineRect.height;

    line.remove();
  }

  /** The rendered <div.nm-line> for a 1-based line number, if present. */
  private lineElementAt(lineNumber: number): HTMLElement | null {
    return this.linesContainer.children[lineNumber - 1] as HTMLElement | null;
  }

  /**
   * The x offset (relative to the shared .nm-content origin) of the boundary
   * just before the `column`-th (1-based) UTF-16 unit on `lineNumber`.
   *
   * This measures the *actual painted* text using a DOM Range rather than
   * multiplying a fixed character width, so it is correct for full-width CJK
   * glyphs, tabs, and any font where glyph advances differ. Falls back to the
   * monospace estimate when the line element or text node is unavailable
   * (e.g. an empty line rendered with a zero-width space).
   */
  private columnToX(lineNumber: number, column: number): number {
    const lineEl = this.lineElementAt(lineNumber);
    const originLeft = this.content.getBoundingClientRect().left;
    if (!lineEl) return (column - 1) * this.charWidth;

    // Column 1 = the line's left edge.
    if (column <= 1) return lineEl.getBoundingClientRect().left - originLeft;

    let remaining = column - 1; // UTF-16 units before the boundary
    const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    const range = document.createRange();

    while (node) {
      const len = node.data.length;
      if (remaining <= len) {
        range.setStart(node, remaining);
        range.setEnd(node, remaining);
        return range.getBoundingClientRect().left - originLeft;
      }
      remaining -= len;
      node = walker.nextNode() as Text | null;
    }

    // Past the end of the rendered text: use the line's right edge.
    return lineEl.getBoundingClientRect().right - originLeft;
  }

  /**
   * Convert page coordinates to a (line, column) caret position.
   *
   * The line is found by row height; the column is found by scanning boundaries
   * with {@link columnToX} and choosing the nearest one to the click. Scanning
   * (rather than dividing by charWidth) keeps click mapping correct for CJK and
   * other variable-advance glyphs.
   */
  private coordsToPosition(clientX: number, clientY: number): Position {
    const linesRect = this.linesContainer.getBoundingClientRect();
    const relY = clientY - linesRect.top;
    const lineCount = this.model.getLineCount();
    const lineNumber = Math.min(
      lineCount,
      Math.max(1, Math.floor(relY / this.lineHeight) + 1),
    );

    const lineLength = this.model.getLineLength(lineNumber);
    const targetX = clientX - this.content.getBoundingClientRect().left;

    // Find the column whose boundary x is closest to the click x.
    let bestColumn = 1;
    let bestDist = Infinity;
    for (let col = 1; col <= lineLength + 1; col++) {
      const x = this.columnToX(lineNumber, col);
      const dist = Math.abs(x - targetX);
      if (dist < bestDist) {
        bestDist = dist;
        bestColumn = col;
      } else if (x > targetX) {
        // Boundaries are monotonically increasing; once we pass the click and
        // distance grows, no nearer boundary remains.
        break;
      }
    }
    return { lineNumber, column: bestColumn };
  }

  // --- Events ----------------------------------------------------------

  private wireEvents(): void {
    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement,
      type: K,
      handler: (ev: HTMLElementEventMap[K]) => void,
    ) => {
      target.addEventListener(type, handler as EventListener);
      this.disposers.push(() =>
        target.removeEventListener(type, handler as EventListener),
      );
    };

    // Mouse down begins a (possibly empty) selection: the anchor and caret are
    // placed at the click; dragging extends the caret while the anchor stays.
    on(this.scroll, "mousedown", (ev) => {
      const me = ev as MouseEvent;
      if (me.button !== 0) return; // left button only
      me.preventDefault();
      const pos = this.coordsToPosition(me.clientX, me.clientY);

      if (me.shiftKey) {
        // Shift-click extends the existing selection from the current anchor.
        this.caret = pos;
      } else {
        this.caret = pos;
        this.anchor = pos;
      }

      this.dragging = true;
      document.addEventListener("mousemove", this.onDocMouseMove);
      document.addEventListener("mouseup", this.onDocMouseUp);

      this.syncTextareaToCaret();
      this.updateCursor();
      this.renderSelection();
      this.textarea.focus();
    });

    // Double click selects the word under the cursor.
    on(this.scroll, "dblclick", (ev) => {
      const me = ev as MouseEvent;
      this.selectWordAt(this.coordsToPosition(me.clientX, me.clientY));
    });

    // Typed/IME/pasted input lands in the textarea; translate to a model edit.
    on(this.textarea, "input", () => this.handleInput());

    on(this.textarea, "keydown", (ev) =>
      this.handleKeydown(ev as KeyboardEvent),
    );

    on(this.root, "focus", () => this.textarea.focus());
  }

  /** While dragging, move the caret (selection end) to the pointer. */
  private handleDragMove(ev: MouseEvent): void {
    if (!this.dragging) return;
    ev.preventDefault();
    const pos = this.coordsToPosition(ev.clientX, ev.clientY);
    if (positionsEqual(pos, this.caret)) return;
    this.caret = pos;
    this.syncTextareaToCaret();
    this.updateCursor();
    this.renderSelection();
  }

  /** Finish a drag selection and remove the document-level listeners. */
  private endDrag(): void {
    if (!this.dragging) return;
    this.dragging = false;
    document.removeEventListener("mousemove", this.onDocMouseMove);
    document.removeEventListener("mouseup", this.onDocMouseUp);
  }

  /** Select the word (run of word characters) containing `pos`. */
  private selectWordAt(pos: Position): void {
    const line = this.model.getLineContent(pos.lineNumber);
    const idx = Math.min(pos.column - 1, line.length);
    const isWord = (ch: string | undefined) => !!ch && /[\p{L}\p{N}_]/u.test(ch);

    let start = idx;
    let end = idx;
    // Expand left/right over word characters.
    while (start > 0 && isWord(line[start - 1])) start--;
    while (end < line.length && isWord(line[end])) end++;

    // If the click was not on a word char, select just that single character.
    if (start === end && idx < line.length) end = idx + 1;

    this.anchor = { lineNumber: pos.lineNumber, column: start + 1 };
    this.caret = { lineNumber: pos.lineNumber, column: end + 1 };
    this.syncTextareaToCaret();
    this.updateCursor();
    this.renderSelection();
    this.textarea.focus();
  }

  /**
   * The hidden textarea holds a single line "window" equal to the caret's line.
   * On input we diff the textarea against the model line and apply the change,
   * then re-render. This keeps IME/composition working with a real control.
   */
  private handleInput(): void {
    const newLine = this.textarea.value;
    const lineNumber = this.caret.lineNumber;
    const oldLine = this.model.getLineContent(lineNumber);

    if (newLine !== oldLine) {
      this.model.replaceRange(
        {
          startLineNumber: lineNumber,
          startColumn: 1,
          endLineNumber: lineNumber,
          endColumn: oldLine.length + 1,
        },
        newLine,
      );
      // Place caret at the textarea's selection end mapped onto the line.
      const col = this.textarea.selectionStart + 1;
      this.caret = { lineNumber, column: col };
      this.anchor = this.caret;
      this.render();
      this.updateCursor();
      this.renderSelection();
      this.onChange?.(this.model.getValue());
    }
  }

  /**
   * Delete the current selection from the model and collapse the caret/anchor
   * to the selection start. Re-renders and reloads the textarea window. No-op
   * when there is no selection.
   */
  private deleteSelection(): void {
    if (!this.hasSelection()) return;
    const sel = this.getSelection();
    this.model.replaceRange(sel, "");
    this.caret = {
      lineNumber: sel.startLineNumber,
      column: sel.startColumn,
    };
    this.anchor = this.caret;
    this.syncTextareaToCaret();
    this.render();
    this.updateCursor();
    this.renderSelection();
    this.onChange?.(this.model.getValue());
  }

  private handleKeydown(ev: KeyboardEvent): void {
    // Select-all.
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "a") {
      ev.preventDefault();
      this.selectAll();
      return;
    }

    switch (ev.key) {
      case "Enter": {
        ev.preventDefault();
        if (this.hasSelection()) this.deleteSelection();
        this.insertNewline();
        break;
      }
      case "Backspace":
      case "Delete":
        // When a selection exists, these keys delete it (one model edit) and
        // we stop the textarea from also editing its single-line window.
        if (this.hasSelection()) {
          ev.preventDefault();
          this.deleteSelection();
        }
        break;
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown":
        // Let the browser move within the textarea line where possible, then
        // resync on the next animation frame, honoring Shift for selection.
        requestAnimationFrame(() => this.syncCaretFromTextarea(ev.key, ev.shiftKey));
        break;
      default:
        // Any other printable key with an active selection replaces it. We
        // delete the selection now; the textarea then receives the character
        // and `input` applies it at the collapsed caret.
        if (this.hasSelection() && isPrintableKey(ev)) {
          this.deleteSelection();
        }
        break;
    }
  }

  /** Select the entire document. */
  private selectAll(): void {
    const lastLine = this.model.getLineCount();
    this.anchor = { lineNumber: 1, column: 1 };
    this.caret = {
      lineNumber: lastLine,
      column: this.model.getLineLength(lastLine) + 1,
    };
    this.syncTextareaToCaret();
    this.updateCursor();
    this.renderSelection();
  }

  private insertNewline(): void {
    const { lineNumber, column } = this.caret;
    this.model.replaceRange(
      {
        startLineNumber: lineNumber,
        startColumn: column,
        endLineNumber: lineNumber,
        endColumn: column,
      },
      "\n",
    );
    this.caret = { lineNumber: lineNumber + 1, column: 1 };
    this.anchor = this.caret;
    this.syncTextareaToCaret();
    this.render();
    this.updateCursor();
    this.renderSelection();
    this.onChange?.(this.model.getValue());
  }

  /** Load the caret's current line into the hidden textarea. */
  private syncTextareaToCaret(): void {
    const line = this.model.getLineContent(this.caret.lineNumber);
    this.textarea.value = line;
    const col = Math.min(this.caret.column - 1, line.length);
    this.textarea.setSelectionRange(col, col);
  }

  /**
   * After arrow navigation, reconcile caret line/column with the textarea.
   * When `shift` is held the anchor is preserved (extending the selection);
   * otherwise the selection collapses onto the new caret. A non-shift arrow
   * with an existing selection first jumps the caret to the selection edge.
   */
  private syncCaretFromTextarea(key: string, shift: boolean): void {
    const hadSelection = this.hasSelection();

    if (!shift && hadSelection) {
      // Collapse to the appropriate selection edge, like native editors.
      const sel = this.getSelection();
      const edge =
        key === "ArrowLeft" || key === "ArrowUp"
          ? { lineNumber: sel.startLineNumber, column: sel.startColumn }
          : { lineNumber: sel.endLineNumber, column: sel.endColumn };
      this.caret = edge;
      this.anchor = edge;
      this.syncTextareaToCaret();
      this.updateCursor();
      this.renderSelection();
      return;
    }

    if (key === "ArrowUp" && this.caret.lineNumber > 1) {
      this.caret = {
        lineNumber: this.caret.lineNumber - 1,
        column: this.caret.column,
      };
      this.syncTextareaToCaret();
    } else if (
      key === "ArrowDown" &&
      this.caret.lineNumber < this.model.getLineCount()
    ) {
      this.caret = {
        lineNumber: this.caret.lineNumber + 1,
        column: this.caret.column,
      };
      this.syncTextareaToCaret();
    } else {
      this.caret = {
        lineNumber: this.caret.lineNumber,
        column: this.textarea.selectionStart + 1,
      };
    }

    // Without Shift, every movement collapses the selection to the caret.
    if (!shift) this.anchor = this.caret;

    this.updateCursor();
    this.renderSelection();
  }
}

/** Heuristic: does this keydown represent a single printable character? */
function isPrintableKey(ev: KeyboardEvent): boolean {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return false;
  // Single-character keys (letters, digits, punctuation, space) have key.length
  // === 1. Named keys ("Shift", "ArrowLeft", ...) are longer.
  return ev.key.length === 1;
}

/** Plain (untyped) text run. */
function textSpan(text: string): HTMLElement {
  const span = el("span", "nm-tok nm-tok-text");
  span.textContent = text;
  return span;
}

/** Typed token run, CSS class `nm-tok-<type>`. */
function tokenSpan(lineText: string, token: Token): HTMLElement {
  const span = el("span", `nm-tok nm-tok-${token.type}`);
  span.textContent = lineText.slice(token.startColumn - 1, token.endColumn - 1);
  return span;
}

/** Fallback tokenizer: no tokens, everything renders as plain text. */
function defaultTokenize(lines: readonly string[]): LineTokens[] {
  return lines.map((_, i) => ({ lineNumber: i + 1, tokens: [] }));
}
