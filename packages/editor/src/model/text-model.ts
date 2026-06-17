/**
 * TextModel: the in-memory source of truth for the editor's text.
 *
 * Like Monaco, the editor never relies on `contenteditable`. Instead this model
 * holds the canonical text, splits it into lines, and provides bidirectional
 * conversion between absolute offsets and (line, column) positions. The view
 * renders from this model; the hidden textarea feeds edits into it.
 *
 * Line endings are normalized to "\n" internally. Lines are recomputed on every
 * mutation, which is more than fast enough for documents up to tens of
 * thousands of lines given the simple operations involved.
 */
import type { Position, Range } from "./position.js";

export type TextModelChangeListener = (model: TextModel) => void;

export class TextModel {
  private _value: string;
  private _lines: string[];
  private readonly listeners = new Set<TextModelChangeListener>();

  constructor(initialValue = "") {
    this._value = normalizeEol(initialValue);
    this._lines = splitLines(this._value);
  }

  /** Full document text (with "\n" line endings). */
  getValue(): string {
    return this._value;
  }

  /** Replace the entire document. */
  setValue(value: string): void {
    this._value = normalizeEol(value);
    this._lines = splitLines(this._value);
    this.emitChange();
  }

  /** Number of lines (always >= 1). */
  getLineCount(): number {
    return this._lines.length;
  }

  /** Text content of a 1-based line (without the trailing newline). */
  getLineContent(lineNumber: number): string {
    return this._lines[lineNumber - 1] ?? "";
  }

  /** Length in UTF-16 code units of a 1-based line. */
  getLineLength(lineNumber: number): number {
    return this.getLineContent(lineNumber).length;
  }

  /** Snapshot of all line strings. */
  getLines(): readonly string[] {
    return this._lines;
  }

  /**
   * Replace the text inside `range` with `text`, returning the caret position
   * at the end of the inserted text.
   */
  replaceRange(range: Range, text: string): Position {
    const startOffset = this.positionToOffset({
      lineNumber: range.startLineNumber,
      column: range.startColumn,
    });
    const endOffset = this.positionToOffset({
      lineNumber: range.endLineNumber,
      column: range.endColumn,
    });
    const insert = normalizeEol(text);

    this._value =
      this._value.slice(0, startOffset) + insert + this._value.slice(endOffset);
    this._lines = splitLines(this._value);
    this.emitChange();

    return this.offsetToPosition(startOffset + insert.length);
  }

  /** Convert a 0-based absolute offset to a 1-based position. */
  offsetToPosition(offset: number): Position {
    const clamped = Math.max(0, Math.min(offset, this._value.length));
    let remaining = clamped;
    for (let i = 0; i < this._lines.length; i++) {
      const lineLength = this._lines[i]!.length;
      if (remaining <= lineLength) {
        return { lineNumber: i + 1, column: remaining + 1 };
      }
      // Subtract the line content plus the "\n" separator.
      remaining -= lineLength + 1;
    }
    // Past end: clamp to last line end.
    const last = this._lines.length;
    return { lineNumber: last, column: (this._lines[last - 1]?.length ?? 0) + 1 };
  }

  /** Convert a 1-based position to a 0-based absolute offset. */
  positionToOffset(pos: Position): number {
    const line = Math.max(1, Math.min(pos.lineNumber, this._lines.length));
    let offset = 0;
    for (let i = 0; i < line - 1; i++) {
      offset += this._lines[i]!.length + 1; // +1 for "\n"
    }
    const lineLength = this._lines[line - 1]?.length ?? 0;
    const column = Math.max(1, Math.min(pos.column, lineLength + 1));
    return offset + (column - 1);
  }

  onDidChange(listener: TextModelChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emitChange(): void {
    for (const listener of this.listeners) listener(this);
  }
}

/** Collapse "\r\n" and "\r" into "\n". */
function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function splitLines(text: string): string[] {
  return text.split("\n");
}
