# @namumark/editor

AST-aware NamuMark syntax-highlighting editor.

- **Monaco-style core** — hidden `<textarea>` for input/focus, custom DOM
  rendering for display, a positioned fake caret. No `contenteditable`.
- **AST-driven highlighting** — coloring comes from the namumark parser
  (`@namumark/wasm`), not a JS grammar.

## Usage

```ts
import { NamumarkEditor } from "@namumark/editor";
import "@namumark/editor/style.css";

const editor = await NamumarkEditor.create(host, { value: "== 제목 ==\n" });
editor.getValue();
editor.renderHtml();
```

## Modules

| Path | Responsibility |
| --- | --- |
| `model/text-model.ts` | Canonical text, line splitting, offset ↔ (line, column) |
| `model/position.ts` | `Position` / `Range` primitives (1-based, UTF-16 columns) |
| `highlight/byte-column.ts` | namumark byte-column → UTF-16 column conversion |
| `highlight/ast-highlighter.ts` | AST → per-line tokens; delimiter gap heuristic |
| `highlight/token.ts` | `TokenType` + token shapes |
| `view/editor-view.ts` | Hidden textarea, DOM rendering, fake caret, events |
| `editor.ts` | `NamumarkEditor` facade wiring parser + highlighter + view |

## Theming

Override CSS variables on `.nm-editor` (see `src/style.css`), or target token
classes directly: each run is `nm-tok nm-tok-<type>` (e.g. `nm-tok-heading`,
`nm-tok-link`, `nm-tok-delimiter`).

## Notes & limitations

- Markup delimiters are inferred from gaps between AST node spans, since the
  parser does not position them individually.
- The view supports single-caret editing, Enter/arrow navigation, IME input,
  click-to-position, and **selection**: drag-select, shift-click, shift+arrow,
  double-click word selection, and Ctrl/Cmd+A. Typing or Backspace/Delete
  replaces the active selection. The selection is drawn as positioned overlay
  rectangles (no native browser selection on the custom DOM).
- Scrolling virtualization and multi-cursor are intentionally out of scope for
  this research build.
