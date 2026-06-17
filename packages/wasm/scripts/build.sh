#!/usr/bin/env bash
#
# Compile the namumark C parser + WASM bridge into a single-file ES module
# using Emscripten. Output lands in packages/wasm/dist/.
#
# Requirements: emcc on PATH (Emscripten SDK activated).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$HERE/.." && pwd)"
REPO_ROOT="$(cd "$PKG_DIR/../.." && pwd)"
NM_LIB="$REPO_ROOT/vendor/namumark/lib"
OUT_DIR="$PKG_DIR/dist"

if ! command -v emcc >/dev/null 2>&1; then
  echo "error: emcc not found on PATH. Activate the Emscripten SDK first." >&2
  echo "       e.g. source /path/to/emsdk/emsdk_env.sh" >&2
  exit 1
fi

if [ ! -d "$NM_LIB" ]; then
  echo "error: $NM_LIB missing. Did you run 'git submodule update --init --recursive'?" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

# namumark C sources (mirrors the STATIC/SHARED target in the upstream CMakeLists).
NM_SOURCES=(
  "$NM_LIB/blocks.c"
  "$NM_LIB/inlines.c"
  "$NM_LIB/namumark.c"
  "$NM_LIB/node.c"
  "$NM_LIB/parser.c"
  "$NM_LIB/renderer_ast.c"
  "$NM_LIB/renderer_html.c"
  "$NM_LIB/strbuf.c"
)

# Exported C functions (prefixed with _ for the WASM ABI).
EXPORTS='["_nm_render","_nm_last_output_ptr","_nm_last_output_size","_nm_last_status","_nm_free_last","_nm_status_message","_nm_version","_nm_lib_version","_malloc","_free"]'

# Runtime helpers JS needs for moving bytes across the heap boundary.
RUNTIME_METHODS='["ccall","cwrap","getValue","UTF8ToString","stringToUTF8","lengthBytesUTF8","HEAPU8","HEAP8"]'

echo "==> Building namumark WASM module"
emcc \
  -O3 \
  -std=c11 \
  -I"$NM_LIB" \
  "${NM_SOURCES[@]}" \
  "$PKG_DIR/src/wasm_bridge.c" \
  -o "$OUT_DIR/namumark.mjs" \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s ENVIRONMENT=web,worker,node \
  -s EXPORTED_FUNCTIONS="$EXPORTS" \
  -s EXPORTED_RUNTIME_METHODS="$RUNTIME_METHODS" \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s SINGLE_FILE=0 \
  -s EXPORT_NAME=createNamumarkModule \
  -s STACK_SIZE=5MB

echo "==> Done. Artifacts in $OUT_DIR:"
ls -la "$OUT_DIR"
