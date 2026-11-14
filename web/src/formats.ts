// MIT License © 2026 Binary Dice Games
/**
 * @file Paste formats: which renderer shows a paste, which type its bytes are given, how a new
 * paste's file is named, and the size limits (design section 4.5 and 4.6).
 */

/** The renderers. `text`, `markdown` and `html` run in the render frame; the rest in the app. */
export const RENDERERS = [
  'text',
  'markdown',
  'html',
  'image',
  'audio',
  'video',
  'pdf',
  'download',
] as const;
export type Renderer = (typeof RENDERERS)[number];

/** Renderers whose input is text, and so can be switched among one another. */
export const TEXT_RENDERERS: readonly Renderer[] = ['text', 'markdown', 'html'];

export const MIB = 1024 * 1024;
/** Text renderers refuse more than this. */
export const TEXT_MAX_BYTES = 5 * MIB;
/** Highlighting is off above this. */
export const HIGHLIGHT_MAX_BYTES = 1 * MIB;
/** Media renderers fetch at most this; above, only Download. */
export const MEDIA_MAX_BYTES = 200 * MIB;

/** Whether `value` names a renderer. */
export function isRenderer(value: unknown): value is Renderer {
  return (RENDERERS as readonly unknown[]).includes(value);
}

/** Extension to highlight.js language for code and data files shown by the `text` renderer. */
const CODE: Record<string, string> = {
  txt: 'plaintext',
  text: 'plaintext',
  log: 'plaintext',
  csv: 'plaintext',
  tsv: 'plaintext',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  xml: 'xml',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'plaintext',
  sql: 'sql',
  css: 'css',
  scss: 'scss',
  less: 'less',
  lua: 'lua',
  pl: 'perl',
  r: 'r',
  swift: 'swift',
  m: 'objectivec',
  dart: 'plaintext',
  scala: 'plaintext',
  hs: 'plaintext',
  diff: 'diff',
  patch: 'diff',
  cmake: 'cmake',
  makefile: 'makefile',
  mk: 'makefile',
  dockerfile: 'dockerfile',
  graphql: 'graphql',
  vb: 'vbnet',
  bat: 'dos',
};

/** Extension to renderer and the MIME type its blob is given, for everything not in `CODE`. */
const MEDIA: Record<string, [Renderer, string]> = {
  md: ['markdown', 'text/plain'],
  markdown: ['markdown', 'text/plain'],
  mdown: ['markdown', 'text/plain'],
  html: ['html', 'text/plain'],
  htm: ['html', 'text/plain'],
  xhtml: ['html', 'text/plain'],
  png: ['image', 'image/png'],
  jpg: ['image', 'image/jpeg'],
  jpeg: ['image', 'image/jpeg'],
  gif: ['image', 'image/gif'],
  webp: ['image', 'image/webp'],
  avif: ['image', 'image/avif'],
  bmp: ['image', 'image/bmp'],
  ico: ['image', 'image/x-icon'],
  svg: ['image', 'image/svg+xml'],
  mp3: ['audio', 'audio/mpeg'],
  ogg: ['audio', 'audio/ogg'],
  oga: ['audio', 'audio/ogg'],
  opus: ['audio', 'audio/ogg'],
  wav: ['audio', 'audio/wav'],
  flac: ['audio', 'audio/flac'],
  m4a: ['audio', 'audio/mp4'],
  aac: ['audio', 'audio/aac'],
  mp4: ['video', 'video/mp4'],
  m4v: ['video', 'video/mp4'],
  webm: ['video', 'video/webm'],
  mov: ['video', 'video/quicktime'],
  ogv: ['video', 'video/ogg'],
  pdf: ['pdf', 'application/pdf'],
};

/** The lower-case extension of a file name (`Makefile` and `Dockerfile` count as their own). */
export function extensionOf(name: string): string {
  const base = name.split('/').pop() ?? name;
  const lower = base.toLowerCase();
  if (lower === 'makefile' || lower === 'dockerfile') {
    return lower;
  }
  const dot = lower.lastIndexOf('.');
  return dot > 0 ? lower.slice(dot + 1) : '';
}

/** Whether the first bytes look like text: valid UTF-8 with no NUL. */
export function looksLikeText(head: Uint8Array): boolean {
  if (head.includes(0)) {
    return false;
  }
  try {
    // A multi-byte character cut at the end of the sample is fine.
    new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * The renderer for a paste: from its extension, then its MIME type, then its first bytes.
 * @param head up to the first 64 KiB, when known
 */
export function chooseRenderer(name: string, mime?: string, head?: Uint8Array): Renderer {
  const ext = extensionOf(name);
  if (ext in CODE) {
    return 'text';
  }
  const known = MEDIA[ext];
  if (known) {
    return known[0];
  }
  const type = (mime ?? '').split(';')[0]!.trim().toLowerCase();
  if (type === 'text/markdown') {
    return 'markdown';
  }
  if (type === 'text/html') {
    return 'html';
  }
  if (type.startsWith('text/') || type === 'application/json' || type === 'application/xml') {
    return 'text';
  }
  if (type.startsWith('image/')) {
    return 'image';
  }
  if (type.startsWith('audio/')) {
    return 'audio';
  }
  if (type.startsWith('video/')) {
    return 'video';
  }
  if (type === 'application/pdf') {
    return 'pdf';
  }
  if (head && looksLikeText(head)) {
    return 'text';
  }
  return 'download';
}

/** The renderers a viewer may switch to for a paste shown with `renderer`. */
export function rendererChoices(renderer: Renderer): Renderer[] {
  return TEXT_RENDERERS.includes(renderer)
    ? [...TEXT_RENDERERS, 'download']
    : [renderer, 'download'];
}

/**
 * The MIME type boh gives a paste's blob for `renderer`. boh never trusts the provider's type:
 * nothing becomes `text/html` or runs script on the app's origin. Images keep their image type,
 * media theirs, PDF stays PDF, everything else is an opaque download.
 */
export function blobType(renderer: Renderer, name: string): string {
  const known = MEDIA[extensionOf(name)];
  if (renderer === 'image' || renderer === 'audio' || renderer === 'video' || renderer === 'pdf') {
    if (known && known[0] === renderer) {
      return known[1];
    }
    return renderer === 'pdf' ? 'application/pdf' : 'application/octet-stream';
  }
  return renderer === 'download' ? 'application/octet-stream' : 'text/plain';
}

/** The highlight.js language for a `text` paste, `plaintext` when unknown. */
export function languageOf(name: string): string {
  return CODE[extensionOf(name)] ?? 'plaintext';
}

/** The largest paste `renderer` shows. */
export function maxBytesFor(renderer: Renderer): number {
  return TEXT_RENDERERS.includes(renderer) ? TEXT_MAX_BYTES : MEDIA_MAX_BYTES;
}

/** The formats offered for a new text paste: extension and label. */
export const TEXT_FORMATS: readonly { ext: string; label: string }[] = [
  { ext: 'txt', label: 'Plain text' },
  { ext: 'md', label: 'Markdown' },
  { ext: 'html', label: 'HTML' },
  { ext: 'json', label: 'JSON' },
  { ext: 'yaml', label: 'YAML' },
  { ext: 'xml', label: 'XML' },
  { ext: 'csv', label: 'CSV' },
  { ext: 'log', label: 'Log' },
  { ext: 'diff', label: 'Diff' },
  { ext: 'sh', label: 'Shell' },
  { ext: 'py', label: 'Python' },
  { ext: 'js', label: 'JavaScript' },
  { ext: 'ts', label: 'TypeScript' },
  { ext: 'c', label: 'C' },
  { ext: 'cpp', label: 'C++' },
  { ext: 'cs', label: 'C#' },
  { ext: 'java', label: 'Java' },
  { ext: 'go', label: 'Go' },
  { ext: 'rs', label: 'Rust' },
  { ext: 'sql', label: 'SQL' },
  { ext: 'css', label: 'CSS' },
];

/** A file-name-safe slug of `title`: lower-case ASCII words joined by `-`, at most 60 chars. */
export function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The file name of a new paste: `<slug(title)>.<ext>`, or `paste-YYYYMMDD-HHMMSS.<ext>` (local
 * time) when the title has no usable characters.
 */
export function pasteFileName(title: string, ext: string, now = new Date()): string {
  const slug = slugify(title);
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const cleanExt = ext.toLowerCase().replace(/[^a-z0-9]/g, '') || 'txt';
  return `${slug || `paste-${stamp}`}.${cleanExt}`;
}

/** Human-readable size: `512 B`, `1.5 KiB`, `3.2 MiB`. */
export function formatSize(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
