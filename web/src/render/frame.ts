// MIT License © 2026 Binary Dice Games
/**
 * @file Entry of `render.html`, the render frame. The app loads it in a frame sandboxed without
 * `allow-same-origin`, so it runs with an opaque origin and cannot reach boh's tokens or settings
 * even if a paste got past the sanitizer. It turns text, Markdown and HTML pastes into a
 * sanitized document and shows it in a nested frame that runs no script at all, under a policy
 * that blocks remote resources unless the viewer asked for them.
 */
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import cmake from 'highlight.js/lib/languages/cmake';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import dos from 'highlight.js/lib/languages/dos';
import darkCss from 'highlight.js/styles/github-dark.css';
import lightCss from 'highlight.js/styles/github.css';
import { Marked } from 'marked';
import { documentCsp, isRemoteSrcset, isRemoteUrl } from './policy';
import type { FrameMessage, RenderRequest } from './protocol';

hljs.registerLanguage('cmake', cmake);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('dos', dos);

const BASE_CSS = `
:root { color-scheme: light dark; }
body { margin: 0; font: 15px/1.55 system-ui, sans-serif; }
body.doc { padding: 16px 20px; max-width: 60em; }
body.doc img, body.doc video { max-width: 100%; }
body.doc pre { overflow: auto; padding: 10px 12px; border-radius: 6px; background: rgba(127,127,127,.12); }
body.doc table { border-collapse: collapse; }
body.doc td, body.doc th { border: 1px solid rgba(127,127,127,.4); padding: 4px 8px; }
body.doc blockquote { margin-left: 0; padding-left: 1em; border-left: 4px solid rgba(127,127,127,.4); }
.text { display: flex; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.text pre { margin: 0; padding: 10px 12px; }
.gutter { text-align: right; opacity: .5; user-select: none; border-right: 1px solid rgba(127,127,127,.3); }
.code { flex: 1; overflow-x: auto; }
.wrap .code { white-space: pre-wrap; overflow-wrap: anywhere; }
.wrap .gutter { display: none; }
.hljs { background: transparent !important; padding: 0 !important; }
[data-boh-blocked] { outline: 1px dashed rgba(127,127,127,.6); }
`;
const HLJS_CSS = `${lightCss}\n@media (prefers-color-scheme: dark) {\n${darkCss}\n}`;

const URL_ATTRIBUTES = [
  'src',
  'srcset',
  'poster',
  'background',
  'xlink:href',
  'data',
  'action',
  'formaction',
];
let allowRemote = false;
let blocked = 0;

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  // SVG element names are lower case.
  const link = node.nodeName.toUpperCase() === 'A' || node.nodeName.toUpperCase() === 'AREA';
  if (link) {
    // Links open in a new tab, out of the sandbox, without telling the target where from.
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
  for (const name of link ? URL_ATTRIBUTES : [...URL_ATTRIBUTES, 'href']) {
    const value = node.getAttribute(name);
    if (value === null) {
      continue;
    }
    const remote = name === 'srcset' ? isRemoteSrcset(value) : isRemoteUrl(value);
    if (remote && !allowRemote) {
      node.removeAttribute(name);
      node.setAttribute('data-boh-blocked', '');
      blocked++;
    }
  }
});

const PURIFY = {
  ADD_ATTR: ['target'],
  FORBID_TAGS: ['base', 'link', 'meta', 'form', 'script', 'iframe', 'frame', 'object', 'embed'],
};

const escapeHtml = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

function highlighted(code: string, language: string, highlight: boolean): string {
  if (highlight && language !== 'plaintext' && hljs.getLanguage(language)) {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  }
  return escapeHtml(code);
}

function page(body: string, bodyClass: string, remote: boolean): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${documentCsp(remote)}">` +
    `<style>${BASE_CSS}${HLJS_CSS}</style></head>` +
    `<body class="${bodyClass}">${body}</body></html>`
  );
}

function textDocument(text: string, req: RenderRequest): string {
  const lines = text.endsWith('\n')
    ? text.slice(0, -1).split('\n').length
    : text.split('\n').length;
  const gutter = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
  const code = highlighted(text, req.options.language, req.options.highlight);
  const body =
    `<div class="text${req.options.wrap ? ' wrap' : ''}">` +
    `<pre class="gutter" aria-hidden="true">${gutter}</pre>` +
    `<pre class="code"><code class="hljs">${code}</code></pre></div>`;
  return page(body, 'plain', false);
}

function markdownDocument(text: string, req: RenderRequest): string {
  const marked = new Marked({ gfm: true, async: false });
  marked.use({
    renderer: {
      code({ text: code, lang }) {
        const language = (lang ?? '').split(/\s/)[0] ?? '';
        const html = highlighted(
          code,
          hljs.getLanguage(language) ? language : 'plaintext',
          req.options.highlight,
        );
        return `<pre><code class="hljs">${html}</code></pre>`;
      },
    },
  });
  const html = marked.parse(text) as string;
  return page(DOMPurify.sanitize(html, PURIFY), 'doc', req.options.remote);
}

function htmlDocument(text: string, req: RenderRequest): string {
  const clean = DOMPurify.sanitize(text, { ...PURIFY, WHOLE_DOCUMENT: true, ADD_TAGS: ['style'] });
  const meta = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${documentCsp(req.options.remote)}">`;
  return clean.includes('<head>') ? clean.replace('<head>', `<head>${meta}`) : `${meta}${clean}`;
}

/** Builds the document of a request and the number of remote resources left out. */
function build(req: RenderRequest): { html: string; blocked: number } {
  allowRemote = req.options.remote;
  blocked = 0;
  const text = new TextDecoder('utf-8').decode(req.bytes);
  const html =
    req.renderer === 'markdown'
      ? markdownDocument(text, req)
      : req.renderer === 'html'
        ? htmlDocument(text, req)
        : textDocument(text, req);
  return { html, blocked };
}

function show(html: string): void {
  const frame = document.createElement('iframe');
  // No allow-scripts: nothing in the paste runs. allow-same-origin only shares this frame's own
  // opaque origin. Links open in a new, unsandboxed tab.
  frame.setAttribute('sandbox', 'allow-same-origin allow-popups allow-popups-to-escape-sandbox');
  frame.setAttribute('title', 'Paste');
  frame.srcdoc = html;
  document.body.replaceChildren(frame);
}

function post(message: FrameMessage): void {
  parent.postMessage(message, '*');
}

window.addEventListener('message', (event: MessageEvent<RenderRequest>) => {
  if (event.source !== parent || event.data?.type !== 'render') {
    return;
  }
  const req = event.data;
  try {
    const result = build(req);
    show(result.html);
    post({ type: 'rendered', id: req.id, blocked: result.blocked });
  } catch (e) {
    post({ type: 'error', id: req.id, reason: e instanceof Error ? e.message : String(e) });
  }
});

post({ type: 'ready' });
