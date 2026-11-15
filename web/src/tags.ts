// MIT License © 2026 Binary Dice Games
/**
 * @file Tags (spec/02_tags_and_shared_bins/DESIGN.md section 3): normalizing manual tags, the
 * derived tags computed from a paste's name and type, the user's tag rules, and the key a tag is
 * stored under in a provider's file metadata.
 */
import { base64UrlToText, textToBase64Url } from './b64';
import { TagError } from './errors';
import { chooseRenderer, extensionOf, isRenderer, languageOf, type Renderer } from './formats';

/** The most manual tags one paste carries (Drive allows 30 private properties per app). */
export const MAX_TAGS = 25;
/** The longest tag, in UTF-8 bytes. */
export const MAX_TAG_BYTES = 48;
/** The prefix of the file metadata keys that hold tags. */
export const TAG_KEY_PREFIX = 't.';

const ALLOWED = /^[\p{L}\p{N}\p{M}._/-]+$/u;
const encoder = new TextEncoder();

/**
 * The normal form of a manual tag: NFC, trimmed, lower case, white space runs as one `-`.
 * @throws {TagError} `invalid_tag` when it is empty, too long, starts with `-`, or has a
 *   character other than letters, digits, `-`, `_`, `.` and `/` (`:` is kept for derived tags)
 */
export function normalizeTag(input: string): string {
  const tag = input.normalize('NFC').trim().toLowerCase().replace(/\s+/gu, '-').normalize('NFC');
  if (!tag) {
    throw new TagError('invalid_tag', 'a tag cannot be empty');
  }
  if (!ALLOWED.test(tag)) {
    throw new TagError(
      'invalid_tag',
      `"${tag}": tags may have letters, digits, "-", "_", "." and "/" only`,
    );
  }
  if (tag.startsWith('-')) {
    throw new TagError('invalid_tag', `"${tag}": a tag cannot start with "-"`);
  }
  if (encoder.encode(tag).length > MAX_TAG_BYTES) {
    throw new TagError('invalid_tag', `"${tag}" is too long`);
  }
  return tag;
}

/** Whether `input` is already a normalized tag. */
export function isTag(input: string): boolean {
  try {
    return normalizeTag(input) === input;
  } catch {
    return false;
  }
}

/**
 * Splits what a user typed (commas or new lines between tags) into normalized tags, without
 * duplicates, and the parts that are not valid tags. Never throws.
 */
export function parseTagList(input: string): { tags: string[]; invalid: string[] } {
  const tags: string[] = [];
  const invalid: string[] = [];
  for (const part of input.split(/[,\n]/)) {
    if (!part.trim()) {
      continue;
    }
    try {
      const tag = normalizeTag(part);
      if (!tags.includes(tag)) {
        tags.push(tag);
      }
    } catch {
      invalid.push(part.trim());
    }
  }
  return { tags, invalid };
}

/** Sorted tags without duplicates. */
export function sortTags(tags: Iterable<string>): string[] {
  return [...new Set(tags)].sort((a, b) => a.localeCompare(b));
}

/** A change to a paste's tags. */
export interface TagChange {
  add?: string[];
  remove?: string[];
}

/**
 * `current` with `change` applied (removals first, so a tag in both stays), sorted.
 * @throws {TagError} `too_many_tags` when the result has more than `MAX_TAGS`
 */
export function applyTagChange(current: readonly string[], change: TagChange): string[] {
  const next = new Set(current);
  for (const tag of change.remove ?? []) {
    next.delete(tag);
  }
  for (const tag of change.add ?? []) {
    next.add(tag);
  }
  if (next.size > MAX_TAGS && next.size > current.length) {
    throw new TagError('too_many_tags', `a paste can have at most ${MAX_TAGS} tags`);
  }
  return sortTags(next);
}

/** The metadata key a provider stores `tag` under: `t.<base64url of its UTF-8>`. */
export function tagKey(tag: string): string {
  return `${TAG_KEY_PREFIX}${textToBase64Url(tag)}`;
}

/** The tag stored under `key`, or `undefined` for other keys and damaged or non-normal tags. */
export function tagOfKey(key: string): string | undefined {
  if (!key.startsWith(TAG_KEY_PREFIX)) {
    return undefined;
  }
  try {
    const tag = base64UrlToText(key.slice(TAG_KEY_PREFIX.length));
    return isTag(tag) ? tag : undefined;
  } catch {
    return undefined;
  }
}

/** What derived tags and rules look at: a paste's name and the MIME type its provider reports. */
export interface NamedFile {
  name: string;
  mime?: string;
}

const derivedPart = (value: string) => value.replace(/\s+/gu, '-');

/**
 * The derived tags of a paste: `format:<ext>` (`format:none` without one), `kind:<renderer>`,
 * and `lang:<language>` for code. Computed from the name and MIME type only, never the content.
 */
export function derivedTags(file: NamedFile): string[] {
  const ext = extensionOf(file.name);
  const kind = chooseRenderer(file.name, file.mime);
  const tags = [`format:${ext ? derivedPart(ext) : 'none'}`, `kind:${kind}`];
  const language = languageOf(file.name);
  if (kind === 'text' && language !== 'plaintext') {
    tags.push(`lang:${language}`);
  }
  return tags;
}

/** A tag rule (design section 3.3), kept in the account's configuration file. */
export interface TagRule {
  id: string;
  /** Bin ids the rule applies to; empty: every bin of the account. */
  bins: string[];
  match: {
    /** Extensions, lower case, without the dot. */
    format?: string[];
    kind?: Renderer[];
    /** A glob over the file name: `*` and `?`, case-insensitive. */
    name?: string;
  };
  /** Normalized tags to add. */
  tags: string[];
  [extra: string]: unknown;
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string');

/** Whether `v` is a well-formed tag rule. */
export function isTagRule(v: unknown): v is TagRule {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    return false;
  }
  const r = v as Record<string, unknown>;
  const match = r.match as Record<string, unknown> | undefined;
  return (
    typeof r.id === 'string' &&
    r.id.length > 0 &&
    isStringArray(r.bins) &&
    isStringArray(r.tags) &&
    typeof match === 'object' &&
    match !== null &&
    !Array.isArray(match) &&
    (match.format === undefined || isStringArray(match.format)) &&
    (match.kind === undefined || (Array.isArray(match.kind) && match.kind.every(isRenderer))) &&
    (match.name === undefined || typeof match.name === 'string')
  );
}

/** A case-insensitive regular expression of a file name glob (`*`, `?`). */
export function globToRegExp(glob: string): RegExp {
  const body = [...glob]
    .map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${body}$`, 'iu');
}

/** Whether `rule` applies to a file named `file.name` uploaded to the bin `binId`. */
export function ruleMatches(rule: TagRule, binId: string, file: NamedFile): boolean {
  if (rule.bins.length > 0 && !rule.bins.includes(binId)) {
    return false;
  }
  const { format, kind, name } = rule.match;
  if (format && format.length > 0 && !format.includes(extensionOf(file.name))) {
    return false;
  }
  if (kind && kind.length > 0 && !kind.includes(chooseRenderer(file.name, file.mime))) {
    return false;
  }
  return !name || globToRegExp(name).test(file.name);
}

/** The tags the matching rules add, normalized and sorted; tags that are not valid are left out. */
export function matchRules(rules: readonly TagRule[], binId: string, file: NamedFile): string[] {
  const out: string[] = [];
  for (const rule of rules) {
    if (ruleMatches(rule, binId, file)) {
      out.push(...rule.tags.filter(isTag));
    }
  }
  return sortTags(out);
}
