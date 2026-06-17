/**
 * Minimal typing for the Emscripten-generated module factory.
 *
 * The actual file `dist/namumark.mjs` is produced by emcc at build time and is
 * not present in source control, so we declare its shape here and import it via
 * a relative path that resolves after the WASM build step runs.
 */
declare module "*/namumark.mjs" {
  export interface NamumarkEmscriptenModule {
    /** Allocate `size` bytes in the WASM heap, returning a pointer. */
    _malloc(size: number): number;
    /** Free a pointer previously returned by `_malloc`. */
    _free(ptr: number): void;

    /** nm_render(inputPtr, inputSize, format) -> status code */
    _nm_render(inputPtr: number, inputSize: number, format: number): number;
    _nm_last_output_ptr(): number;
    _nm_last_output_size(): number;
    _nm_last_status(): number;
    _nm_free_last(): void;
    _nm_status_message(status: number): number;
    _nm_version(): number;
    _nm_lib_version(): number;

    /** Raw heap views (refreshed automatically on memory growth). */
    HEAPU8: Uint8Array;

    /** Copy a UTF-8 JS string into the heap at `ptr` (writes up to maxBytes). */
    stringToUTF8(str: string, ptr: number, maxBytesToWrite: number): void;
    /** Number of bytes a UTF-8 encoding of `str` would occupy (excluding NUL). */
    lengthBytesUTF8(str: string): number;
    /** Decode a NUL-terminated UTF-8 C string at `ptr`. */
    UTF8ToString(ptr: number): string;
  }

  /** Emscripten module factory (MODULARIZE=1, EXPORT_ES6=1). */
  const createNamumarkModule: (
    overrides?: Record<string, unknown>,
  ) => Promise<NamumarkEmscriptenModule>;
  export default createNamumarkModule;
}
