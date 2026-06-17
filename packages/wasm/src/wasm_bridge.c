/**
 * @file wasm_bridge.c
 * @brief Thin Emscripten-facing wrapper over the stable namumark C API.
 *
 * The browser cannot pass C struct pointers comfortably, so instead of
 * exporting `namumark_render` (which writes into a `namumark_buffer` struct),
 * we expose flat functions that:
 *   1. accept a pointer + length to UTF-8 input bytes already placed in the
 *      WASM heap by JavaScript,
 *   2. run the parser/renderer,
 *   3. stash the heap-owned result so JS can read its pointer and size,
 *   4. free it on demand.
 *
 * Only one render result is held at a time per call sequence; JS must read the
 * pointer/size and copy the bytes out before issuing the next render. This keeps
 * the ABI trivial: every accessor returns a single scalar.
 */
#include <stdlib.h>

#include "namumark.h"
/* version.h carries the real library release version (NAMUMARK_LIB_VERSION),
 * which currently differs from the public-API macro NAMUMARK_VERSION reported
 * by namumark_version(). Exposing both lets embedders show the accurate
 * release version. */
#include "version.h"

/* The last render result. Owned by the namumark library until freed. */
static namumark_buffer g_last_output = {0};
static namumark_status g_last_status = NAMUMARK_OK;

/**
 * @brief Render input bytes into the requested format.
 * @param input Pointer into the WASM heap holding UTF-8 bytes.
 * @param input_size Number of bytes.
 * @param format 0 = HTML, 1 = AST JSON (matches namumark_output_format).
 * @return Status code (0 == NAMUMARK_OK). On success, query
 *         nm_last_output_ptr()/nm_last_output_size() then call nm_free_last().
 */
int nm_render(const char *input, int input_size, int format) {
  namumark_buffer_free(&g_last_output);
  g_last_output.data = NULL;
  g_last_output.size = 0;

  g_last_status = namumark_render(input, (size_t)input_size,
                                  (namumark_output_format)format,
                                  &g_last_output);
  return (int)g_last_status;
}

/** @return Heap pointer to the last render result bytes, or 0 if none. */
const char *nm_last_output_ptr(void) { return g_last_output.data; }

/** @return Byte length of the last render result. */
int nm_last_output_size(void) { return (int)g_last_output.size; }

/** @return Status code of the last render call. */
int nm_last_status(void) { return (int)g_last_status; }

/** @brief Release the last render result buffer. */
void nm_free_last(void) {
  namumark_buffer_free(&g_last_output);
  g_last_output.data = NULL;
  g_last_output.size = 0;
}

/** @return Static English message for a status code (heap pointer to C string). */
const char *nm_status_message(int status) {
  return namumark_status_message((namumark_status)status);
}

/** @return Static public-API version string pointer (namumark_version()). */
const char *nm_version(void) { return namumark_version(); }

/** @return Static library release version pointer (NAMUMARK_LIB_VERSION). */
const char *nm_lib_version(void) { return NAMUMARK_LIB_VERSION; }
