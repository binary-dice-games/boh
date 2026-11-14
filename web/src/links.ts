// MIT License © 2026 Binary Dice Games
/**
 * @file The boh link (design section 4.4): `<site>#v1/<provider>/<ref>[?r=<renderer>&n=<name>]`.
 * Everything after `#` stays in the browser.
 */
import { LinkError } from './errors';
import { isRenderer, type Renderer } from './formats';
import { isProviderId, type ProviderId } from './providers/provider';

/** A parsed paste link. */
export interface PasteLink {
  provider: ProviderId;
  /** base64url, opaque to the app; the provider decodes it. */
  ref: string;
  renderer?: Renderer;
  name?: string;
}

/** What a fragment holds. */
export type ParsedFragment =
  | { kind: 'paste'; link: PasteLink }
  /** A link of a later format than this boh understands. */
  | { kind: 'newer'; version: number }
  /** Not a paste link (an app route, or empty). */
  | { kind: 'other' };

const REF = /^[A-Za-z0-9_-]{1,4096}$/;
const MAX_NAME = 200;

/**
 * Parses a location fragment (with or without the leading `#`).
 * @throws {LinkError} when it is a `v1` link that is malformed
 */
export function parseFragment(fragment: string): ParsedFragment {
  const text = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  const version = /^v(\d+)\//.exec(text);
  if (!version) {
    return { kind: 'other' };
  }
  const n = Number(version[1]);
  if (n !== 1) {
    if (n > 1) {
      return { kind: 'newer', version: n };
    }
    throw new LinkError(`unknown link version ${n}`);
  }
  const [path = '', query = ''] = text.split('?', 2);
  const parts = path.split('/');
  if (parts.length !== 3) {
    throw new LinkError('a link has the form v1/<provider>/<reference>');
  }
  const [, provider, ref] = parts as [string, string, string];
  if (!isProviderId(provider)) {
    throw new LinkError(`unknown provider "${provider}"`);
  }
  if (!REF.test(ref)) {
    throw new LinkError('the reference is not valid');
  }
  const link: PasteLink = { provider, ref };
  const params = new URLSearchParams(query);
  for (const key of params.keys()) {
    if (key !== 'r' && key !== 'n') {
      throw new LinkError(`unknown link parameter "${key}"`);
    }
  }
  const renderer = params.get('r');
  if (renderer !== null) {
    if (!isRenderer(renderer)) {
      throw new LinkError(`unknown renderer "${renderer}"`);
    }
    link.renderer = renderer;
  }
  const name = params.get('n');
  if (name !== null) {
    if (name.length === 0 || name.length > MAX_NAME) {
      throw new LinkError('the name is empty or too long');
    }
    link.name = name;
  }
  return { kind: 'paste', link };
}

/** The fragment of `link`, without `#`. */
export function linkFragment(link: PasteLink): string {
  const params = new URLSearchParams();
  if (link.renderer) {
    params.set('r', link.renderer);
  }
  if (link.name) {
    params.set('n', link.name.slice(0, MAX_NAME));
  }
  const query = params.toString();
  return `v1/${link.provider}/${link.ref}${query ? `?${query}` : ''}`;
}

/**
 * The full link of `link` on the site at `siteUrl` (any query or fragment of it is dropped).
 */
export function formatLink(siteUrl: string, link: PasteLink): string {
  const url = new URL(siteUrl);
  url.search = '';
  url.hash = '';
  return `${url.toString()}#${linkFragment(link)}`;
}
