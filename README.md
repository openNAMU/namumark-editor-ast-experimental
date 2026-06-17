# namumark-editor-ast-experimental

An AST-based NamuMark syntax-highlighting editor, built on a WebAssembly
build of the [namumark](https://github.com/ShapeLayer/namumark) C parser.

## Repository layout

```
.
├── vendor/namumark/          # git submodule: the namumark C library
├── packages/
│   ├── wasm/                 # @namumark/wasm  — Emscripten build + TS loader
│   │   ├── src/wasm_bridge.c #   flat C ABI over the namumark public API
│   │   ├── src/index.ts      #   Namumark class: renderHtml / renderAstJson / parseAst
│   │   ├── src/ast.ts        #   typed AST node model
│   │   └── scripts/build.sh  #   emcc compile script
│   └── editor/               # @namumark/editor — the editor library
│       └── src/
│           ├── model/        #   TextModel + Position/Range (offset <-> line/col)
│           ├── highlight/    #   AST -> tokens (byte->UTF16, delimiter gap heuristic)
│           ├── view/         #   Monaco-style EditorView (textarea + DOM + caret)
│           └── editor.ts     #   NamumarkEditor facade
└── demo/                     # @namumark/demo — Vite app: editor + live HTML/AST preview
```

<!--
### Why AST-driven, and the one limitation

namumark's AST reports **1-based, byte-offset, half-open** source spans, and
(since the `feat/token-position` work) inline child nodes carry **absolute**
columns. That is enough to color semantic regions (headings, bold, links,
macros, tables, …) precisely, including multi-byte (Korean/CJK) text after a
byte→UTF-16 conversion.

The AST does **not** give markup delimiters (`'''`, `[[ ]]`, `||`, `==`) their
own spans. The highlighter therefore infers delimiters as the **gaps between a
node's span and its children's spans**, emitting them as a `delimiter` token.
This colors punctuation distinctly without a second grammar. See
`packages/editor/src/highlight/ast-highlighter.ts` for details.
-->

## Prerequisites

- Node.js 18+ and `pnpm`
- The [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html)
  with `emcc` on `PATH` (only needed to (re)build the WASM module)

## Setup & build

```bash
# 1. Fetch the namumark submodule (tracks the release/prepare-0.1.1 branch)
git submodule update --init --recursive
#    To advance to the latest branch tip later:
#    git submodule update --remote vendor/namumark

# 2. Install workspace dependencies
pnpm install

# 3. Build the WASM module (requires emcc) + the editor library
pnpm run build

# 4. Run the demo
pnpm run dev
```

`pnpm run build` runs:

- `build:wasm` → compiles `vendor/namumark/lib/*.c` + `wasm_bridge.c` with
  `emcc` into `packages/wasm/dist/namumark.{mjs,wasm}`, then builds the TS loader.
- `build:editor` → type-checks and emits `packages/editor/dist`.

## Usage

```ts
import { NamumarkEditor } from "@namumark/editor";
import "@namumark/editor/style.css";

const editor = await NamumarkEditor.create(document.getElementById("host")!, {
  value: "== 제목 ==\n본문 '''굵게''' [[문서|링크]]\n",
  onChange: (value) => console.log(value),
});

editor.renderHtml();     // namumark HTML output
editor.renderAstJson();  // diagnostic AST JSON
```

When bundling, point the loader at the served `.wasm` (Vite example):

```ts
import wasmUrl from "@namumark/wasm/namumark.wasm?url";

await NamumarkEditor.create(host, {
  locateWasm: (path) => (path.endsWith(".wasm") ? wasmUrl : path),
});
```
