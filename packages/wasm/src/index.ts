/**
 * @namumark/wasm
 *
 * TypeScript loader and high-level API around the Emscripten build of the
 * namumark C parser. The C API is buffer-oriented; this module handles all the
 * heap marshalling (UTF-8 in, UTF-8 out) and exposes two simple methods:
 * `renderHtml` and `renderAstJson`.
 */
// The .mjs file is emitted by `scripts/build.sh` (emcc). It does not exist
// until the WASM build runs; the declaration in emscripten.d.ts types it.
// eslint-disable-next-line import/no-unresolved
import createNamumarkModule from "../dist/namumark.mjs";
import type { NamumarkEmscriptenModule } from "../dist/namumark.mjs";
import { parseAst, type AstNode } from "./ast.js";

export * from "./ast.js";

/** Output formats, matching `namumark_output_format` in the C API. */
export const OutputFormat = {
  Html: 0,
  AstJson: 1,
} as const;
export type OutputFormat = (typeof OutputFormat)[keyof typeof OutputFormat];

/** Status codes, matching `namumark_status` in the C API. */
export const Status = {
  Ok: 0,
  InvalidArgument: 1,
  Allocation: 2,
  Parse: 3,
  Render: 4,
} as const;

export class NamumarkError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(`namumark render failed (status ${status}): ${message}`);
    this.name = "NamumarkError";
    this.status = status;
  }
}

/**
 * A loaded namumark WASM instance. Construct via {@link Namumark.create}.
 *
 * Instances are cheap to share and safe to reuse across many render calls, but
 * not reentrant: do not call render methods concurrently from async code that
 * interleaves with the same instance, because the C bridge holds a single
 * global output buffer between render and free.
 */
export class Namumark {
  private readonly mod: NamumarkEmscriptenModule;
  private readonly encoder = new TextEncoder();

  private constructor(mod: NamumarkEmscriptenModule) {
    this.mod = mod;
  }

  /**
   * Instantiate the WASM module. Optionally override how the `.wasm` binary is
   * located (useful for bundlers/CDNs) via `locateFile`.
   */
  static async create(
    options: { locateFile?: (path: string) => string } = {},
  ): Promise<Namumark> {
    const overrides: Record<string, unknown> = {};
    if (options.locateFile) overrides.locateFile = options.locateFile;
    const mod = await createNamumarkModule(overrides);
    return new Namumark(mod);
  }

  /**
   * The namumark public **API** version string (from `namumark_version()`).
   *
   * Note: upstream currently reports a stale value here (the `NAMUMARK_VERSION`
   * macro lags the release). Prefer {@link libVersion} for the user-facing
   * release version.
   */
  version(): string {
    return this.mod.UTF8ToString(this.mod._nm_version());
  }

  /**
   * The namumark **library release** version string (from
   * `NAMUMARK_LIB_VERSION`). This matches the published release/tag (e.g.
   * "0.1.0") and is the accurate version to display to users.
   */
  libVersion(): string {
    return this.mod.UTF8ToString(this.mod._nm_lib_version());
  }

  /** Render NamuMark source to HTML. */
  renderHtml(source: string): string {
    return this.render(source, OutputFormat.Html);
  }

  /** Render NamuMark source to the diagnostic AST JSON string. */
  renderAstJson(source: string): string {
    return this.render(source, OutputFormat.AstJson);
  }

  /** Render NamuMark source and parse it into a typed AST tree. */
  parseAst(source: string): AstNode {
    return parseAst(this.renderAstJson(source));
  }

  /**
   * Core render path. Copies `source` into the heap, invokes the C renderer,
   * reads the heap-owned result back out, and frees it.
   */
  render(source: string, format: OutputFormat): string {
    const mod = this.mod;
    const bytes = this.encoder.encode(source);
    const inputPtr = mod._malloc(bytes.length || 1);
    try {
      if (bytes.length > 0) {
        mod.HEAPU8.set(bytes, inputPtr);
      }
      const status = mod._nm_render(inputPtr, bytes.length, format);
      if (status !== Status.Ok) {
        const msg = mod.UTF8ToString(mod._nm_status_message(status));
        throw new NamumarkError(status, msg);
      }
      const outPtr = mod._nm_last_output_ptr();
      const outSize = mod._nm_last_output_size();
      // Copy bytes out before freeing; slice() detaches from the heap view.
      const out = mod.HEAPU8.slice(outPtr, outPtr + outSize);
      return new TextDecoder("utf-8").decode(out);
    } finally {
      mod._nm_free_last();
      mod._free(inputPtr);
    }
  }
}

export type { NamumarkEmscriptenModule } from "../dist/namumark.mjs";
