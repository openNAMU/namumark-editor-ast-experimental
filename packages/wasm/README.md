# @namumark/wasm

WebAssembly build of the [namumark](https://github.com/ShapeLayer/namumark) C
parser, with a small TypeScript loader.

Unlike the upstream Node binding (which uses `koffi` to call a native shared
library on the server), this package compiles the C sources with Emscripten so
the parser runs **in the browser** (and Node/worker) with no native addon.

## API

```ts
import { Namumark } from "@namumark/wasm";

const nm = await Namumark.create();

nm.version();                  // namumark public-API version macro
nm.libVersion();               // namumark library release version (e.g. "0.1.0")
nm.renderHtml(source);         // → HTML string
nm.renderAstJson(source);      // → AST JSON string
nm.parseAst(source);           // → typed AstNode tree
```

`Namumark.create({ locateFile })` lets you override where the `.wasm` binary is
fetched from (for bundlers/CDNs).

### Versions

namumark exposes two version strings:

- `version()` → `namumark_version()`, the public-API macro `NAMUMARK_VERSION`.
  Upstream currently reports a stale value here (it lags the release).
- `libVersion()` → `NAMUMARK_LIB_VERSION`, the actual library release version
  matching the published tag (e.g. `0.1.0`). **Use this for display.**

### AST positions

`AstNode.position` is `{ start_line, start_column, end_line, end_column }`:

- lines and columns are **1-based**,
- columns are **UTF-8 byte offsets** within the source line,
- spans are **half-open** (`end_column` points just past the last byte),
- inline children carry **absolute** columns,
- node spans cover **content**; markup delimiters have no dedicated span.

Consumers working with JS strings must convert byte columns to UTF-16 (see
`@namumark/editor`'s `LineByteIndex`).

## Build

Requires `emcc` (Emscripten SDK) on `PATH`.

```bash
pnpm run build        # emcc compile + tsc
pnpm run build:c      # just the WASM module
```

Output: `dist/namumark.mjs`, `dist/namumark.wasm`, and the TS loader in `dist/`.

The C ABI exposed to JS is defined in `src/wasm_bridge.c`: flat functions over
the buffer-oriented `namumark_render` API, so JavaScript only deals with heap
pointers and sizes.
