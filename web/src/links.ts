// MIT License © 2026 Binary Dice Games
/**
 * @file The boh link (spec/01_core_features/DESIGN.md section 4.4):
 * `<site>#v1/<provider>/<ref>[?r=<renderer>&n=<name>]`, and the bin link
 * (spec/02_tags_and_shared_bins/DESIGN.md section 4.6): `<site>#v1/bin/<provider>/<ref>[?n=<name>]`.
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

/** A parsed bin link: a folder somebody shared. */
export interface BinLink {
  provider: ProviderId;
  /** base64url, opaque to the app; the provider decodes it (`Provider.folderRef`). */
  ref: string;
  name?: string;
}

/** What a fragment holds. */
export type ParsedFragment =
  | { kind: 'paste'; link: PasteLink }
  | { kind: 'bin'; link: BinLink }
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
  const isBin = parts[1] === 'bin';
  if (parts.length !== (isBin ? 4 : 3)) {
    throw new LinkError(
      isBin
        ? 'a bin link has the form v1/bin/<provider>/<reference>'
        : 'a link has the form v1/<provider>/<reference>',
    );
  }
  const [provider = '', ref = ''] = parts.slice(isBin ? 2 : 1);
  if (!isProviderId(provider)) {
    throw new LinkError(`unknown provider "${provider}"`);
  }
  if (!REF.test(ref)) {
    throw new LinkError('the reference is not valid');
  }
  const params = new URLSearchParams(query);
  for (const key of params.keys()) {
    if (key !== 'n' && (isBin || key !== 'r')) {
      throw new LinkError(`unknown link parameter "${key}"`);
    }
  }
  const name = params.get('n');
  if (name !== null && (name.length === 0 || name.length > MAX_NAME)) {
    throw new LinkError('the name is empty or too long');
  }
  if (isBin) {
    return { kind: 'bin', link: { provider, ref, ...(name !== null ? { name } : {}) } };
  }
  const link: PasteLink = { provider, ref };
  const renderer = params.get('r');
  if (renderer !== null) {
    if (!isRenderer(renderer)) {
      throw new LinkError(`unknown renderer "${renderer}"`);
    }
    link.renderer = renderer;
  }
  if (name !== null) {
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

/** The full bin link of `link` on the site at `siteUrl`. */
export function formatBinLink(siteUrl: string, link: BinLink): string {
  const url = new URL(siteUrl);
  url.search = '';
  url.hash = '';
  const params = new URLSearchParams();
  if (link.name) {
    params.set('n', link.name.slice(0, MAX_NAME));
  }
  const query = params.toString();
  return `${url.toString()}#v1/bin/${link.provider}/${link.ref}${query ? `?${query}` : ''}`;
}
