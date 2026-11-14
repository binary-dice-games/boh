// MIT License © 2026 Binary Dice Games
/**
 * @file The paste viewer: resolves a boh link through its provider (anonymously, then signed in,
 * then asking for a sign-in or Drive's permission), and shows the paste with its renderer.
 * Text, Markdown and HTML render in the sandboxed render frame; images, audio, video and PDF are
 * shown from blobs whose type boh chooses.
 */
import { reasonOf, TooLargeError } from '../errors';
import {
  ANONYMOUS_MAX_BYTES,
  blobType,
  chooseRenderer,
  formatSize,
  HIGHLIGHT_MAX_BYTES,
  languageOf,
  looksLikeText,
  maxBytesFor,
  MEDIA_MAX_BYTES,
  rendererChoices,
  TEXT_MAX_BYTES,
  TEXT_RENDERERS,
  type Renderer,
} from '../formats';
import type { PasteLink } from '../links';
import { PROVIDER_LABELS, type PasteMeta } from '../providers/provider';
import { RenderHost } from '../render-host';
import type { FrameRenderer } from '../render/protocol';
import type { AppContext } from './context';
import { button, copyText, external, h, select } from './dom';
import { errorText } from './messages';

const RENDERER_LABELS: Record<Renderer, string> = {
  text: 'Text',
  markdown: 'Markdown',
  html: 'HTML',
  image: 'Image',
  audio: 'Audio',
  video: 'Video',
  pdf: 'PDF',
  download: 'Download only',
};

/** The viewer of `link`; `href` is the link as opened (kept in the recent list). */
export function viewerView(
  ctx: AppContext,
  root: HTMLElement,
  link: PasteLink,
  href: string,
): () => void {
  const provider = ctx.providers[link.provider];
  const label = PROVIDER_LABELS[link.provider];
  const head = h('div', { class: 'viewer-head' });
  const body = h('div', { class: 'viewer-body' });
  root.append(h('section', { class: 'card viewer' }, head, body));
  const controller = new AbortController();
  const urls: string[] = [];
  let host: RenderHost | undefined;
  let closed = false;

  const message = (text: string, ...actions: (Node | null)[]) => {
    head.replaceChildren(h('h2', { text: link.name ?? 'Paste' }));
    body.replaceChildren(
      h('p', { class: 'problem', id: 'viewer-message', text }),
      h('div', { class: 'actions' }, ...actions.filter((a): a is Node => a !== null)),
    );
  };

  const signInButton = (text = `Sign in to ${label}`) =>
    button(
      text,
      () => {
        void ctx.connect(link.provider).then((ok) => ok && void resolve());
      },
      { class: 'primary', id: 'viewer-sign-in' },
    );

  const resolve = async (granted = false): Promise<void> => {
    if (closed) {
      return;
    }
    if (!provider.configured) {
      message(`This paste is in ${label}, which this boh site does not support.`);
      return;
    }
    head.replaceChildren(h('h2', { text: link.name ?? 'Paste' }));
    body.replaceChildren(h('p', { class: 'muted', text: `Opening the paste from ${label}…` }));
    let meta: PasteMeta;
    try {
      meta = await provider.openRef(link.ref);
    } catch (e) {
      if (closed) {
        return;
      }
      const reason = reasonOf(e);
      const account = provider.account();
      if (reason === 'needs_sign_in') {
        message(
          `This paste is in ${label}. Sign in to open it: boh reads it with your own ${label} account.`,
          signInButton(),
        );
      } else if (reason === 'needs_grant' && !granted && provider.grantAccess) {
        message(
          `${label} asks you to confirm that boh may open this file. Choose it in the window that opens.`,
          button(
            'Allow boh to open it',
            () => {
              // Granted or not, ask again: still refused now means no access.
              provider.grantAccess!(link.ref).then(
                () => void resolve(true),
                (err: unknown) => ctx.notify(errorText(err, link.provider), 'error'),
              );
            },
            { class: 'primary', id: 'viewer-grant' },
          ),
        );
      } else if (reason === 'needs_grant' || reason === 'forbidden' || reason === 'not_found') {
        message(
          `This paste does not exist, or ${account ? `your ${label} account (${account.name})` : 'you'} cannot open it. Ask whoever sent the link to check its sharing.`,
          account
            ? button('Use another account', () => {
                void provider
                  .signOut()
                  .then(() => ctx.connect(link.provider))
                  .then((ok) => ok && void resolve());
              })
            : signInButton(),
        );
      } else {
        message(
          errorText(e, link.provider),
          button('Try again', () => void resolve()),
        );
      }
      return;
    }
    if (!closed) {
      show(meta);
    }
  };

  const show = (meta: PasteMeta) => {
    ctx.local.addRecent({
      link: href,
      name: meta.name,
      provider: link.provider,
      at: Date.now(),
      own: false,
    });
    let renderer: Renderer = link.renderer ?? chooseRenderer(meta.name, meta.mime);
    let remote = false;
    let bytes: ArrayBuffer | undefined;
    const content = h('div', { class: 'viewer-content' });
    const rendererSelect = select([], renderer, { id: 'viewer-renderer', 'aria-label': 'Show as' });
    const wrap = h('input', {
      type: 'checkbox',
      id: 'viewer-wrap',
      checked: ctx.local.prefs().wrap,
    });
    const wrapLabel = h('label', { class: 'inline' }, wrap, ' Wrap lines');
    const remoteButton = button(
      'Load remote content',
      () => {
        remote = true;
        void draw();
      },
      { id: 'viewer-remote' },
    );
    const linkInput = h('input', {
      type: 'text',
      readonly: true,
      value: href,
      'aria-label': 'Link',
      class: 'visually-hidden',
    });
    const fillChoices = () => {
      rendererSelect.replaceChildren(
        ...rendererChoices(renderer).map((r) =>
          h('option', { value: r, text: RENDERER_LABELS[r], selected: r === renderer }),
        ),
      );
    };
    fillChoices();
    rendererSelect.addEventListener('change', () => {
      renderer = rendererSelect.value as Renderer;
      remote = false;
      void draw();
    });
    wrap.addEventListener('change', () => {
      ctx.local.setPrefs({ wrap: wrap.checked });
      void draw();
    });

    head.replaceChildren(
      h('h2', { id: 'viewer-name', text: meta.name }),
      h('p', { class: 'muted', text: [formatSize(meta.size), label].filter(Boolean).join(' · ') }),
      h(
        'div',
        { class: 'toolbar' },
        h('label', { class: 'inline' }, 'Show as ', rendererSelect),
        wrapLabel,
        remoteButton,
        button('Copy link', async () => {
          ctx.notify(
            (await copyText(href, linkInput))
              ? 'Link copied.'
              : 'Press Ctrl+C (⌘C) to copy the link.',
          );
        }),
        button('Download', () => void download(meta), { id: 'viewer-download' }),
        meta.webUrl ? external(`Open in ${label}`, meta.webUrl) : null,
        linkInput,
      ),
    );
    body.replaceChildren(content);

    const fetchBytes = async (limit: number): Promise<ArrayBuffer> => {
      bytes ??= await (
        await provider.fetch(meta, { maxBytes: limit, signal: controller.signal })
      ).arrayBuffer();
      if (bytes.byteLength > limit) {
        throw new TooLargeError(bytes.byteLength, limit);
      }
      return bytes;
    };

    const draw = async () => {
      for (const url of urls.splice(0)) {
        URL.revokeObjectURL(url);
      }
      host?.destroy();
      host = undefined;
      const inFrame = TEXT_RENDERERS.includes(renderer);
      wrapLabel.hidden = renderer !== 'text';
      remoteButton.hidden = remote || (renderer !== 'markdown' && renderer !== 'html');
      content.replaceChildren(h('p', { class: 'muted', text: 'Loading…' }));
      try {
        if (renderer === 'download') {
          if (meta.size !== undefined && meta.size <= TEXT_MAX_BYTES && !link.renderer && !bytes) {
            // An unknown type: if it is small and looks like text, show it as text.
            const sample = await fetchBytes(TEXT_MAX_BYTES);
            if (looksLikeText(new Uint8Array(sample, 0, Math.min(sample.byteLength, 65536)))) {
              renderer = 'text';
              fillChoices();
              return draw();
            }
          }
          content.replaceChildren(
            h('p', { text: `boh cannot show this kind of file. ${formatSize(meta.size)}` }),
            button('Download', () => void download(meta), { class: 'primary' }),
          );
          return;
        }
        const data = await fetchBytes(maxBytesFor(renderer, meta.access));
        if (closed) {
          return;
        }
        if (inFrame) {
          content.replaceChildren();
          host = new RenderHost(content);
          const { blocked } = await host.render(
            renderer as FrameRenderer,
            meta.name,
            data.slice(0),
            {
              remote,
              wrap: wrap.checked,
              highlight: data.byteLength <= HIGHLIGHT_MAX_BYTES,
              language: languageOf(meta.name),
            },
          );
          remoteButton.textContent =
            blocked > 0 ? `Load remote content (${blocked} blocked)` : 'Load remote content';
          return;
        }
        content.replaceChildren(await mediaElement(renderer, meta.name, data));
      } catch (e) {
        if (closed) {
          return;
        }
        content.replaceChildren(...failure(e, meta));
      }
    };

    const mediaElement = async (
      r: Renderer,
      name: string,
      data: ArrayBuffer,
    ): Promise<HTMLElement> => {
      const type = blobType(r, name);
      if (r === 'image' && type === 'image/svg+xml') {
        // A data: URL, not a blob: one: an SVG opened on its own must not run on boh's origin.
        const url = await new Promise<string>((ok) => {
          const reader = new FileReader();
          reader.onload = () => ok(String(reader.result));
          reader.readAsDataURL(new Blob([data], { type }));
        });
        return imageElement(url, name);
      }
      const url = URL.createObjectURL(new Blob([data], { type }));
      urls.push(url);
      if (r === 'image') {
        return imageElement(url, name);
      }
      if (r === 'audio') {
        return h('audio', { controls: true, src: url, id: 'viewer-media' });
      }
      if (r === 'video') {
        return h('video', { controls: true, src: url, id: 'viewer-media', class: 'video' });
      }
      return h(
        'div',
        { class: 'pdf' },
        h('iframe', { src: url, title: name, class: 'pdf-frame' }),
        h('p', { class: 'muted', text: 'If the PDF does not show, use Download.' }),
      );
    };

    const imageElement = (url: string, name: string) => {
      const img = h('img', { src: url, alt: name, id: 'viewer-image', class: 'fit' });
      img.addEventListener('click', () => img.classList.toggle('fit'));
      return h(
        'div',
        { class: 'image' },
        img,
        h('p', { class: 'muted', text: 'Click the image to switch between fit and full size.' }),
      );
    };

    void draw();
  };

  /** Why a paste cannot be shown, and what the viewer can do instead. */
  const failure = (e: unknown, meta: PasteMeta): Node[] => {
    const reason = reasonOf(e);
    const anonymous = meta.access === 'anonymous';
    const elsewhere = meta.webUrl
      ? external(`Open in ${label}`, meta.webUrl, { id: 'viewer-elsewhere', class: 'button' })
      : null;
    // Over the limit for public pastes read with the site's own key (not merely over the
    // renderer's limit, like a long text).
    const overQuotaLimit =
      anonymous && e instanceof TooLargeError && e.limit === ANONYMOUS_MAX_BYTES;
    let text: string;
    if (overQuotaLimit) {
      text = `This paste is too large for boh to show to everyone with the link. Open it in ${label}.`;
    } else if (reason === 'too_large') {
      text = 'This paste is too large to show here.';
    } else if (reason === 'rate_limited' && anonymous) {
      text = `Too many people are opening public pastes through boh right now. Open it in ${label}, or try again in a minute.`;
    } else {
      text = errorText(e, link.provider);
    }
    // Such a public paste is not downloaded through boh either: that would use the site's quota.
    const canDownload = !(overQuotaLimit || (anonymous && reason === 'rate_limited'));
    return [
      h('p', { class: 'problem', id: 'viewer-problem', text }),
      h(
        'div',
        { class: 'actions' },
        canDownload ? button('Download', () => void download(meta)) : null,
        elsewhere,
      ),
    ];
  };

  const download = async (meta: PasteMeta) => {
    try {
      const blob = await provider.fetch(meta, {
        maxBytes:
          meta.access === 'anonymous'
            ? ANONYMOUS_MAX_BYTES
            : Math.max(MEDIA_MAX_BYTES, meta.size ?? 0),
        signal: controller.signal,
      });
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' }));
      const a = h('a', { href: url, download: meta.name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      ctx.notify(
        meta.access === 'anonymous' && reasonOf(e) === 'too_large'
          ? `This paste is too large to download through boh. Open it in ${label}.`
          : errorText(e, link.provider),
        'error',
      );
    }
  };

  void resolve();
  return () => {
    closed = true;
    controller.abort();
    host?.destroy();
    for (const url of urls) {
      URL.revokeObjectURL(url);
    }
  };
}
