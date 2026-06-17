/**
 * Position and range primitives shared across the model, tokenizer, and view.
 *
 * Conventions (Monaco-compatible):
 *  - `lineNumber` is 1-based.
 *  - `column` is 1-based and counts UTF-16 code units, where column 1 is the
 *    position *before* the first character of the line.
 *  - `offset` is a 0-based absolute index into the document string (UTF-16).
 */

/** A 1-based (line, column) caret position. */
export interface Position {
  readonly lineNumber: number;
  readonly column: number;
}

/** An inclusive-start / exclusive-end span between two positions. */
export interface Range {
  readonly startLineNumber: number;
  readonly startColumn: number;
  readonly endLineNumber: number;
  readonly endColumn: number;
}

export function position(lineNumber: number, column: number): Position {
  return { lineNumber, column };
}

export function comparePositions(a: Position, b: Position): number {
  if (a.lineNumber !== b.lineNumber) return a.lineNumber - b.lineNumber;
  return a.column - b.column;
}

export function positionsEqual(a: Position, b: Position): boolean {
  return a.lineNumber === b.lineNumber && a.column === b.column;
}

/** Order two positions so the smaller comes first. */
export function orderPositions(a: Position, b: Position): [Position, Position] {
  return comparePositions(a, b) <= 0 ? [a, b] : [b, a];
}

export function rangeIsEmpty(range: Range): boolean {
  return (
    range.startLineNumber === range.endLineNumber &&
    range.startColumn === range.endColumn
  );
}
