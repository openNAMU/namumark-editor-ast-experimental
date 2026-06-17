/**
 * Byte-offset <-> UTF-16 column conversion.
 *
 * namumark's AST reports columns as 1-based **byte** offsets into each source
 * line (UTF-8 encoding). The editor's TextModel and the DOM work in UTF-16 code
 * units. For ASCII the two coincide, but for Korean/CJK and other multi-byte
 * text they diverge, so every AST column must be translated before it can be
 * used to slice JS strings or position the cursor.
 *
 * We precompute, per line, a map from byte offset -> UTF-16 index. Building it
 * is O(line length) and done once per highlight pass.
 */

/** Per-line lookup from 0-based UTF-8 byte offset to 0-based UTF-16 index. */
export class LineByteIndex {
  /** byteToUtf16[b] = UTF-16 index of the char starting at byte offset b. */
  private readonly byteToUtf16: number[];
  /** Total UTF-8 byte length of the line. */
  readonly byteLength: number;
  /** Total UTF-16 length of the line. */
  readonly utf16Length: number;

  constructor(line: string) {
    const map: number[] = [];
    let byte = 0;
    // Iterate by code point so surrogate pairs advance UTF-16 index by 2.
    for (let i = 0; i < line.length; ) {
      const cp = line.codePointAt(i)!;
      const utf8Len = utf8ByteLength(cp);
      const utf16Len = cp > 0xffff ? 2 : 1;
      for (let b = 0; b < utf8Len; b++) map[byte + b] = i;
      byte += utf8Len;
      i += utf16Len;
    }
    map[byte] = line.length; // one past the end
    this.byteToUtf16 = map;
    this.byteLength = byte;
    this.utf16Length = line.length;
  }

  /**
   * Convert a 1-based byte column (AST convention) to a 1-based UTF-16 column
   * (editor convention). Out-of-range inputs are clamped.
   */
  byteColumnToUtf16Column(byteColumn: number): number {
    const byteOffset = Math.max(0, byteColumn - 1);
    const idx =
      byteOffset >= this.byteToUtf16.length
        ? this.utf16Length
        : (this.byteToUtf16[byteOffset] ?? this.utf16Length);
    return idx + 1;
  }
}

/** Number of UTF-8 bytes used to encode a Unicode code point. */
function utf8ByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

/** Build a {@link LineByteIndex} for every line of the document. */
export function buildLineByteIndices(lines: readonly string[]): LineByteIndex[] {
  return lines.map((line) => new LineByteIndex(line));
}
