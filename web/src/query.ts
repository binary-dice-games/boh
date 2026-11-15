// MIT License © 2026 Binary Dice Games
/**
 * @file The library's search language (spec/02_tags_and_shared_bins/DESIGN.md section 3.6):
 * space-separated terms that must all match, `-` to negate, `#tag`, `tag:a,b`, `format:`, `kind:`,
 * `lang:`, `bin:`, `from:me|others`, `untagged`, and quoted phrases. Parsing never throws.
 */
import { normalizeTag } from './tags';

/** One term of a query. */
export interface Term {
  negate: boolean;
  /**
   * `word`: a manual tag or the name; `tag`: manual tags (any of `values`); `derived`: derived
   * tags; `bin`: bin names; `from`: `me` or `others`; `untagged`: no manual tags; `phrase`: the name.
   */
  kind: 'word' | 'tag' | 'derived' | 'bin' | 'from' | 'untagged' | 'phrase';
  values: string[];
}

/** A parsed query: all terms must match. */
export interface Query {
  terms: Term[];
}

/** What a query is matched against. */
export interface Searchable {
  name: string;
  /** Manual tags (normalized). */
  tags: readonly string[];
  /** Derived tags (`format:md`, ...). */
  derived: readonly string[];
  binName: string;
  /** Whether the paste is in one of the user's own bins. */
  own: boolean;
}

const DERIVED_KEYS = ['format', 'kind', 'lang'];

/** Lower case without accents, for name matching. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Splits a query into its raw tokens, keeping quoted parts (and `key:"..."`) whole. */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/u.test(text[i]!)) {
      i++;
    }
    let token = '';
    while (i < text.length && !/\s/u.test(text[i]!)) {
      if (text[i] === '"') {
        const end = text.indexOf('"', i + 1);
        const stop = end < 0 ? text.length : end + 1;
        token += text.slice(i, stop);
        i = stop;
      } else {
        token += text[i];
        i++;
      }
    }
    if (token) {
      tokens.push(token);
    }
  }
  return tokens;
}

const unquote = (value: string) => value.replaceAll('"', '');

function tagOrRaw(value: string): string {
  try {
    return normalizeTag(value);
  } catch {
    return value.toLowerCase();
  }
}

function termOf(token: string): Term | undefined {
  let negate = false;
  let rest = token;
  if (rest.length > 1 && rest.startsWith('-')) {
    negate = true;
    rest = rest.slice(1);
  }
  if (rest.startsWith('"')) {
    const phrase = fold(unquote(rest)).trim();
    return phrase ? { negate, kind: 'phrase', values: [phrase] } : undefined;
  }
  if (rest.length > 1 && rest.startsWith('#')) {
    return { negate, kind: 'tag', values: [tagOrRaw(rest.slice(1))] };
  }
  if (rest.toLowerCase() === 'untagged') {
    return { negate, kind: 'untagged', values: [] };
  }
  const keyed = /^([a-z]+):(.+)$/i.exec(rest);
  if (keyed) {
    const key = keyed[1]!.toLowerCase();
    const raw = keyed[2]!;
    const values = (raw.startsWith('"') ? [unquote(raw)] : raw.split(','))
      .map((v) => v.trim())
      .filter(Boolean);
    if (values.length > 0) {
      if (DERIVED_KEYS.includes(key)) {
        return { negate, kind: 'derived', values: values.map((v) => `${key}:${v.toLowerCase()}`) };
      }
      if (key === 'tag') {
        return { negate, kind: 'tag', values: values.map(tagOrRaw) };
      }
      if (key === 'bin') {
        return { negate, kind: 'bin', values: values.map(fold) };
      }
      if (key === 'from') {
        return { negate, kind: 'from', values: values.map((v) => v.toLowerCase()) };
      }
    }
  }
  const word = unquote(rest);
  return word ? { negate, kind: 'word', values: [word] } : undefined;
}

/** Parses a query. Never throws: unknown `key:` prefixes are name text. */
export function parseQuery(text: string): Query {
  return {
    terms: tokenize(text)
      .map(termOf)
      .filter((t): t is Term => t !== undefined),
  };
}

function termMatches(term: Term, item: Searchable): boolean {
  switch (term.kind) {
    case 'word': {
      const word = term.values[0]!;
      return item.tags.includes(tagOrRaw(word)) || fold(item.name).includes(fold(word));
    }
    case 'phrase':
      return fold(item.name).includes(term.values[0]!);
    case 'tag':
      return term.values.some((v) => item.tags.includes(v));
    case 'derived':
      return term.values.some((v) => item.derived.includes(v));
    case 'bin':
      return term.values.includes(fold(item.binName));
    case 'from':
      return term.values.includes(item.own ? 'me' : 'others');
    case 'untagged':
      return item.tags.length === 0;
  }
}

/** Whether `item` matches every term of `query` (an empty query matches everything). */
export function matches(query: Query, item: Searchable): boolean {
  return query.terms.every((term) => termMatches(term, item) !== term.negate);
}

/** The query token that filters by a manual tag. */
export function tagToken(tag: string): string {
  return `#${tag}`;
}

/** The query token that filters by a bin's name. */
export function binToken(name: string): string {
  const clean = name.replaceAll('"', '');
  return /[\s,]/u.test(clean) ? `bin:"${clean}"` : `bin:${clean}`;
}

/** Whether `text` has `token` among its tokens. */
export function hasToken(text: string, token: string): boolean {
  return tokenize(text).includes(token);
}

/** `text` with `token` added, or removed when it is there already. */
export function toggleToken(text: string, token: string): string {
  const tokens = tokenize(text);
  const at = tokens.indexOf(token);
  if (at >= 0) {
    tokens.splice(at, 1);
  } else {
    tokens.push(token);
  }
  return tokens.join(' ');
}

/** `text` without any of `tokens`, then with `token` added (when given). */
export function replaceTokens(text: string, tokens: readonly string[], token?: string): string {
  const kept = tokenize(text).filter((t) => !tokens.includes(t));
  if (token) {
    kept.push(token);
  }
  return kept.join(' ');
}
