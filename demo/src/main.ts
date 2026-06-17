/**
 * Demo entry point.
 *
 * Boots the NamumarkEditor, wires a live HTML / AST preview, and demonstrates
 * loading the WASM binary through a bundler. The `.wasm` URL is resolved via
 * Vite's `?url` import and handed to the editor through `locateWasm`.
 */
import { NamumarkEditor } from "@namumark/editor";
import "@namumark/editor/style.css";
import "./demo.css";

// Resolve the wasm binary URL through the bundler. The Emscripten loader asks
// for "namumark.wasm"; we return this hashed/served URL.
import wasmUrl from "@namumark/wasm/namumark.wasm?url";

const SAMPLE = `== An experimental application research for Namumark parser  ==
이 편집기는 나무위키 문법을 문법 파싱 C 라이브러리인, '''namumark'''를 __WASM__으로 빌드해서 웹에서 사용하고 있습니다. namumark의 ~~처리 결과로 생성된 AST~~를 에디터 모듈에서 받아서 하이라이팅에 사용합니다.

이 파서를 이용해 이와 같이 HTML로 렌더하는것도 쉽게 할 수 있습니다.

=== 링크와 매크로 ===
 * 내부 링크: [[나무위키]]
 * 라벨 링크: [[나무위키|위키]]
 * 매크로: [date]

> 인용문

|| 셀 A || 셀 B ||
|| 1 || 2 ||

{{{#!wiki style="background:#eee"
위키 블록 내부 내용
}}}
`;

const statusEl = document.getElementById("status")!;
const editorHost = document.getElementById("editor") as HTMLElement;
const previewHtml = document.getElementById("preview-html") as HTMLElement;
const previewAst = document.getElementById("preview-ast") as HTMLElement;

function refreshPreview(editor: NamumarkEditor): void {
  previewHtml.innerHTML = editor.renderHtml();
  previewAst.textContent = editor.renderAstJson();
}

async function main(): Promise<void> {
  const editor = await NamumarkEditor.create(editorHost, {
    value: SAMPLE,
    locateWasm: (path) => (path.endsWith(".wasm") ? wasmUrl : path),
    onChange: () => refreshPreview(editor),
  });

  statusEl.textContent = `namumark ${editor.parserVersion()} · ready`;
  statusEl.classList.remove("is-loading");
  statusEl.classList.add("is-ready");
  refreshPreview(editor);
  editor.focus();

  // Preview tab switching.
  const tabs = document.querySelectorAll<HTMLButtonElement>(".pane-tab[data-tab]");
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const which = tab.dataset.tab;
      previewHtml.classList.toggle("is-hidden", which !== "html");
      previewAst.classList.toggle("is-hidden", which !== "ast");
    });
  }
}

main().catch((err) => {
  statusEl.textContent = `failed to load: ${String(err)}`;
  statusEl.classList.remove("is-loading");
  statusEl.classList.add("is-error");
  console.error(err);
});
