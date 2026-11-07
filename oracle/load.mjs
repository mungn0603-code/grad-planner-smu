// 현재 앱(V44 게시본)의 <script>를 Node vm에서 학과 하나로 띄운다. DOM은 무엇이든 받아 주는 대역.
// 판정 함수(planItems·calc·geState·cdrCount·smPlan…)는 DOM이 아니라 S/SM 상태만 읽으므로 이 대역으로 충분하다.
import vm from 'node:vm';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';

const HTML = fs.readFileSync(new URL('./legacy/index.publish.html', import.meta.url), 'utf8');
const a = HTML.indexOf('<script>'), b = HTML.lastIndexOf('</script>');
if (a < 0 || b < a || HTML.indexOf('<script', a + 1) !== -1 && HTML.indexOf('<script', a + 1) < b) throw new Error('script block not unique');
export const SCRIPT = new vm.Script(HTML.slice(a + 8, b), { filename: 'legacy.js' });

const STR = new Set(['innerHTML', 'outerHTML', 'textContent', 'innerText', 'value', 'id', 'className', 'src', 'href', 'title', 'placeholder', 'tagName', 'nodeName']);
const BOOL = new Set(['checked', 'hidden', 'disabled', 'open', 'selected', 'isConnected']);
const NUM = new Set(['offsetLeft', 'offsetTop', 'offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight', 'scrollLeft', 'scrollTop', 'scrollWidth', 'scrollHeight', 'selectionStart', 'selectionEnd', 'length', 'naturalWidth', 'naturalHeight', 'width', 'height', 'nodeType']);
function el() {
  const o = Object.create(null);
  return new Proxy(function () {}, {
    get(_, p) {
      if (p in o) return o[p];
      if (p === Symbol.toPrimitive) return () => '';
      if (p === Symbol.iterator) return [][Symbol.iterator];
      if (typeof p === 'symbol' || p === 'then' || p === 'toJSON') return undefined;
      if (STR.has(p)) return '';
      if (BOOL.has(p)) return false;
      if (NUM.has(p)) return 0;
      if (p === 'style' || p === 'dataset') return (o[p] = {});
      if (p === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (p === 'children' || p === 'childNodes' || p === 'options' || p === 'files') return [];
      if (p === 'querySelectorAll' || p === 'getElementsByTagName' || p === 'getElementsByClassName') return () => [];
      if (p === 'getAttribute') return () => null;
      if (p === 'getBoundingClientRect') return () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
      return el();
    },
    set(_, p, v) { o[p] = v; return true; },
    apply() { return el(); },
    construct() { return el(); },
  });
}
function store(init) {
  const m = new Map(Object.entries(init || {}));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: k => void m.delete(k), clear: () => m.clear(), key: i => [...m.keys()][i] ?? null, get length() { return m.size; } };
}

// 학과 하나로 현재 앱을 띄운 컨텍스트. run(src)로 그 안에서 코드를 실행한다.
export function loadDept(dept) {
  const doc = el();
  Object.assign(doc, { querySelector: () => el(), querySelectorAll: () => [], getElementById: () => el(), createElement: () => el(), baseURI: 'http://localhost/index.html', readyState: 'complete' });
  const noop = () => 0;
  const g = {
    document: doc, localStorage: store({ 'smu-planner-dept-v1': dept }), sessionStorage: store(),
    location: { hash: '', search: '', href: 'http://localhost/index.html', protocol: 'http:', pathname: '/index.html', reload() {} },
    history: { replaceState() {}, pushState() {} }, navigator: { userAgent: 'node', clipboard: {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop, requestAnimationFrame: noop,
    scrollTo() {}, addEventListener() {}, removeEventListener() {}, getComputedStyle: () => el(),
    console, crypto: webcrypto, TextEncoder, TextDecoder, URL, structuredClone, performance,
    fetch: () => Promise.reject(new Error('offline')), Image: function () { return el(); }, DOMParser: function () { return { parseFromString: () => el() }; },
    Blob: globalThis.Blob, FileReader: function () { return el(); }, HTMLElement: function () {}, AbortController,
  };
  g.window = g; g.self = g; g.globalThis = g;
  const ctx = vm.createContext(g);
  SCRIPT.runInContext(ctx);
  const run = src => vm.runInContext(src, ctx);
  if (run('DEPT') !== dept) throw new Error(`dept not selected: ${dept}`);
  return { ctx, run };
}
