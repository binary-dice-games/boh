// MIT License © 2026 Binary Dice Games
/**
 * @file The library (spec/02_tags_and_shared_bins/DESIGN.md sections 3.5, 3.6, 4.4): the pastes of
 * every bin of the connected accounts, own and shared, with a search box, tag facets, and bulk
 * tag edits. Every view state is a query; the address is `#library?q=<query>`, which stays in the
 * browser.
 */
import { runBulk, type BulkAction, type BulkResult } from '../bulk-tags';
import { reasonOf } from '../errors';
import { formatSize } from '../formats';
import { facets, MAX_PER_BIN, type LibraryEntry } from '../library-index';
import { binToken, hasToken, parseQuery, replaceTokens, toggleToken } from '../query';
import { matchRules, normalizeTag, parseTagList } from '../tags';
import type { AppContext } from './context';
import { button, formatTime, h } from './dom';
import { errorText } from './messages';
import { openRulesDialog } from './rules-dialog';
import { tagChips } from './tag-editor';

/** The most rows drawn at once. */
const MAX_ROWS = 500;
/** The most tags listed in the facets. */
const MAX_FACETS = 40;

/** The query of a `#library?q=...` fragment. */
export function queryOfHash(hash: string): string {
  const at = hash.indexOf('?');
  return at < 0 ? '' : (new URLSearchParams(hash.slice(at + 1)).get('q') ?? '');
}

const keyOf = (e: LibraryEntry) => `${e.meta.provider}:${e.meta.key}`;

/** The library view, starting with the query `initial`. */
export function libraryView(ctx: AppContext, root: HTMLElement, initial: string): () => void {
  const controller = new AbortController();
  let query = initial;
  let results: LibraryEntry[] = [];
  const selected = new Set<string>();
  let bulkRunning: AbortController | undefined;

  const search = h('input', {
    id: 'library-search',
    type: 'search',
    value: query,
    placeholder: 'Search names and tags: #tag -#tag format:md bin:Notes from:others "phrase"',
    'aria-label': 'Search the library',
    autocomplete: 'off',
  });
  const scopes = h('div', { class: 'scope', role: 'group', 'aria-label': 'Whose pastes' });
  const binFacets = h('ul', { class: 'facet-list', id: 'facet-bins' });
  const tagFacets = h('ul', { class: 'facet-list', id: 'facet-tags' });
  const typeFacets = h('ul', { class: 'facet-list', id: 'facet-types' });
  const count = h('p', { class: 'muted', id: 'library-count', 'aria-live': 'polite' });
  const rows = h('tbody');
  const selectAll = h('input', {
    type: 'checkbox',
    id: 'select-all',
    'aria-label': 'Select all matching pastes',
  });
  const bulk = h('div', { class: 'bulk', id: 'bulk', hidden: true });
  const empty = h('p', { class: 'muted', id: 'library-empty', hidden: true });

  root.append(
    h(
      'section',
      { class: 'card library' },
      h(
        'div',
        { class: 'section-head' },
        h('h2', { text: 'Library' }),
        h(
          'div',
          { class: 'actions' },
          button('Refresh', () => void load(true), { id: 'library-refresh' }),
          button('Tag rules…', () => openRulesDialog(ctx), { id: 'library-rules' }),
        ),
      ),
      search,
      scopes,
      empty,
      h(
        'div',
        { class: 'library-body' },
        h(
          'aside',
          { class: 'facets', 'aria-label': 'Filters' },
          h('h3', { text: 'Bins' }),
          binFacets,
          h('h3', { text: 'Tags' }),
          tagFacets,
          h('h3', { text: 'Types' }),
          typeFacets,
        ),
        h(
          'div',
          { class: 'results' },
          count,
          bulk,
          h(
            'table',
            { class: 'pastes library-table' },
            h(
              'thead',
              {},
              h(
                'tr',
                {},
                h('th', {}, selectAll),
                h('th', { text: 'Name' }),
                h('th', { text: 'Bin' }),
                h('th', { text: 'Tags' }),
                h('th', { text: 'Size' }),
                h('th', { text: 'Changed' }),
              ),
            ),
            rows,
          ),
        ),
      ),
    ),
  );

  const setQuery = (next: string, focus = false) => {
    query = next.trim();
    if (search.value.trim() !== query) {
      search.value = query;
    }
    history.replaceState(null, '', query ? `#library?q=${encodeURIComponent(query)}` : '#library');
    draw();
    if (focus) {
      search.focus();
    }
  };

  let typing: ReturnType<typeof setTimeout> | undefined;
  /** The query as typed, also while the search box's pause has not passed yet. */
  const live = () => {
    clearTimeout(typing);
    return search.value.trim();
  };
  search.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => setQuery(search.value), 150);
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      clearTimeout(typing);
      setQuery(search.value);
    }
  });

  const facetButton = (label: string, token: string, n: number | undefined, attr: string) =>
    h(
      'li',
      {},
      button(
        n === undefined ? label : `${label} (${n})`,
        () => setQuery(toggleToken(live(), token)),
        {
          class: `facet${hasToken(query, token) ? ' on' : ''}`,
          'aria-pressed': hasToken(query, token) ? 'true' : 'false',
          [attr]: label,
        },
      ),
    );

  const drawScopes = () => {
    const scopeTokens = ['from:me', 'from:others'];
    const current = hasToken(query, 'from:me')
      ? 'mine'
      : hasToken(query, 'from:others')
        ? 'shared'
        : 'all';
    const scope = (id: string, label: string, token?: string) =>
      button(label, () => setQuery(replaceTokens(live(), scopeTokens, token)), {
        id: `scope-${id}`,
        class: current === id ? 'on' : '',
        'aria-pressed': current === id ? 'true' : 'false',
      });
    scopes.replaceChildren(
      scope('all', 'All'),
      scope('mine', 'Mine', 'from:me'),
      scope('shared', 'Shared with me', 'from:others'),
    );
  };

  const drawBins = () => {
    const bins = ctx.libraryBins();
    const counts = new Map(facets(results).bins);
    binFacets.replaceChildren(
      ...bins.map((b) => {
        const state = ctx.library.status(b.bin.id);
        const item = facetButton(
          b.bin.name,
          binToken(b.bin.name),
          counts.get(b.bin.id) ?? 0,
          'data-facet-bin',
        );
        const note = h('small', { class: 'muted' });
        if (b.bin.shared) {
          note.append(` shared${b.bin.owner ? ` by ${b.bin.owner.name}` : ''}`);
        }
        if (state?.status === 'loading') {
          note.append(state.fromCache ? ' · updating…' : ' · loading…');
        } else if (state?.status === 'error') {
          item.append(
            h('small', {
              class: 'problem',
              text: ` ${errorText(state.error, b.provider)}${state.fromCache ? ' Showing the last listing.' : ''} `,
            }),
            button('Retry', () => void load(true), { class: 'small' }),
          );
        }
        if (state?.truncated) {
          note.append(` · showing the newest ${MAX_PER_BIN}`);
        }
        item.append(note);
        return item;
      }),
    );
  };

  const drawFacets = () => {
    const f = facets(results);
    const tagList = f.tags.slice(0, MAX_FACETS);
    // Keep chosen tags visible even when the result has none of them.
    for (const token of query.split(/\s+/)) {
      const tag = token.startsWith('#') ? token.slice(1) : undefined;
      if (tag && !tagList.some(([t]) => t === tag)) {
        tagList.push([tag, 0]);
      }
    }
    tagFacets.replaceChildren(
      ...(tagList.length
        ? tagList.map(([t, n]) => facetButton(t, `#${t}`, n, 'data-facet-tag'))
        : [h('li', { class: 'muted', text: 'No tags here yet.' })]),
      h(
        'li',
        {},
        button('Untagged', () => setQuery(toggleToken(live(), 'untagged')), {
          class: `facet${hasToken(query, 'untagged') ? ' on' : ''}`,
          'aria-pressed': hasToken(query, 'untagged') ? 'true' : 'false',
          'data-facet-untagged': '',
        }),
      ),
    );
    typeFacets.replaceChildren(
      ...f.derived
        .filter(([t]) => t.startsWith('kind:') || t.startsWith('format:'))
        .slice(0, MAX_FACETS)
        .map(([t, n]) => facetButton(t, t, n, 'data-facet-derived')),
    );
  };

  const view = (entry: LibraryEntry) => {
    ctx.linkFor(entry.meta, entry.bin.bin.visibility).then(
      (link) => (location.href = link),
      (e: unknown) => ctx.notify(errorText(e, entry.bin.provider), 'error'),
    );
  };

  const drawRows = () => {
    const shown = results.slice(0, MAX_ROWS);
    rows.replaceChildren(
      ...shown.map((entry) => {
        const key = keyOf(entry);
        const check = h('input', {
          type: 'checkbox',
          checked: selected.has(key),
          'aria-label': `Select ${entry.meta.name}`,
        });
        check.addEventListener('change', () => {
          if (check.checked) {
            selected.add(key);
          } else {
            selected.delete(key);
          }
          drawBulk();
        });
        return h(
          'tr',
          { 'data-paste': entry.meta.name },
          h('td', {}, check),
          h(
            'td',
            {},
            button(entry.meta.name, () => view(entry), {
              class: 'link',
              title: `View ${entry.meta.name}`,
            }),
          ),
          h(
            'td',
            {},
            button(
              entry.bin.bin.name,
              () => setQuery(toggleToken(live(), binToken(entry.bin.bin.name))),
              {
                class: 'link muted',
              },
            ),
          ),
          h(
            'td',
            {},
            tagChips(
              entry.meta.tags ?? [],
              entry.derived.filter((t) => t.startsWith('kind:')),
              (token) => setQuery(toggleToken(live(), token)),
            ),
          ),
          h('td', { text: formatSize(entry.meta.size) }),
          h('td', { text: formatTime(entry.meta.modified) }),
        );
      }),
    );
    const all = results.length > 0 && results.every((e) => selected.has(keyOf(e)));
    selectAll.checked = all;
    selectAll.indeterminate = !all && results.some((e) => selected.has(keyOf(e)));
  };

  selectAll.addEventListener('change', () => {
    for (const e of results) {
      if (selectAll.checked) {
        selected.add(keyOf(e));
      } else {
        selected.delete(keyOf(e));
      }
    }
    drawRows();
    drawBulk();
  });

  // The bulk bar: its inputs survive redraws so typing is not lost.
  const bulkTags = h('input', {
    id: 'bulk-tags',
    type: 'text',
    placeholder: 'Tags, separated by commas',
    'aria-label': 'Tags to add or remove',
  });
  const renameFrom = h('input', {
    id: 'bulk-from',
    type: 'text',
    placeholder: 'Rename tag',
    'aria-label': 'Tag to rename',
  });
  const renameTo = h('input', {
    id: 'bulk-to',
    type: 'text',
    placeholder: 'to',
    'aria-label': 'New name',
  });
  const bulkCount = h('strong', { id: 'bulk-count' });
  const progress = h('p', { class: 'muted', id: 'bulk-progress', 'aria-live': 'polite' });
  const outcome = h('div', { id: 'bulk-result' });
  const cancel = button('Cancel', () => bulkRunning?.abort(), { id: 'bulk-cancel', hidden: true });
  const actionButtons: HTMLButtonElement[] = [];
  const action = (label: string, id: string, make: () => BulkAction | undefined) => {
    const b = button(
      label,
      () => {
        const act = make();
        if (act) {
          void runSelected(act);
        }
      },
      { id },
    );
    actionButtons.push(b);
    return b;
  };
  const typedTags = (): string[] | undefined => {
    const { tags, invalid } = parseTagList(bulkTags.value);
    if (invalid.length || tags.length === 0) {
      progress.textContent = invalid.length
        ? `Not a valid tag: ${invalid.join(', ')}.`
        : 'Type the tags first.';
      return undefined;
    }
    return tags;
  };
  bulk.append(
    h('p', {}, bulkCount, ' selected'),
    h(
      'div',
      { class: 'row' },
      bulkTags,
      action('Add tags', 'bulk-add', () => {
        const tags = typedTags();
        return tags && { kind: 'add', tags };
      }),
      action('Remove tags', 'bulk-remove', () => {
        const tags = typedTags();
        return tags && { kind: 'remove', tags };
      }),
      action('Apply rules', 'bulk-rules', () => ({
        kind: 'rules',
        tagsFor: (e) => matchRules(ctx.store.rules(e.bin.provider), e.bin.bin.id, e.meta),
      })),
    ),
    h(
      'div',
      { class: 'row' },
      renameFrom,
      renameTo,
      action('Rename tag', 'bulk-rename', () => {
        try {
          return {
            kind: 'rename',
            from: normalizeTag(renameFrom.value),
            to: normalizeTag(renameTo.value),
          };
        } catch (e) {
          progress.textContent = errorText(e);
          return undefined;
        }
      }),
    ),
    h('div', { class: 'actions' }, cancel),
    progress,
    outcome,
  );

  const drawBulk = () => {
    for (const key of [...selected]) {
      if (!results.some((e) => keyOf(e) === key)) {
        selected.delete(key);
      }
    }
    bulk.hidden = selected.size === 0 && !bulkRunning && !outcome.hasChildNodes();
    bulkCount.textContent = String(selected.size);
    for (const b of actionButtons) {
      b.disabled = Boolean(bulkRunning) || selected.size === 0;
    }
    cancel.hidden = !bulkRunning;
  };

  const showOutcome = (result: BulkResult, act: BulkAction) => {
    const parts = [`Changed ${result.changed.length}.`];
    if (result.unchanged) {
      parts.push(`${result.unchanged} needed no change.`);
    }
    if (result.skipped.length) {
      parts.push(`${result.skipped.length} skipped: you may not change them.`);
    }
    if (result.cancelled.length) {
      parts.push(`${result.cancelled.length} not done (cancelled).`);
    }
    if (result.failed.length) {
      parts.push(`${result.failed.length} failed.`);
    }
    progress.textContent = parts.join(' ');
    outcome.replaceChildren();
    const retry = [...result.failed.map((f) => f.entry), ...result.cancelled];
    if (result.failed.length) {
      outcome.append(
        h(
          'ul',
          { class: 'failures' },
          ...result.failed.map((f) =>
            h('li', { text: `${f.entry.meta.name}: ${errorText(f.error, f.entry.bin.provider)}` }),
          ),
        ),
      );
    }
    if (retry.length) {
      outcome.append(
        button(`Retry ${retry.length}`, () => void run(retry, act), { id: 'bulk-retry' }),
      );
    }
  };

  const run = async (entries: LibraryEntry[], act: BulkAction) => {
    bulkRunning = new AbortController();
    outcome.replaceChildren();
    drawBulk();
    const result = await runBulk(
      entries,
      act,
      async (entry, change, signal) => {
        const meta = await ctx.providers[entry.bin.provider].setTags(entry.meta, change, signal);
        ctx.library.update(meta);
        return meta;
      },
      {
        signal: bulkRunning.signal,
        onProgress: (done, total) => {
          progress.textContent = `Changing ${done} of ${total}…`;
        },
      },
    );
    bulkRunning = undefined;
    showOutcome(result, act);
    drawBulk();
  };

  const runSelected = (act: BulkAction) =>
    run(
      results.filter((e) => selected.has(keyOf(e))),
      act,
    );

  const draw = () => {
    const connected = ctx.connected();
    const bins = ctx.libraryBins();
    empty.hidden = connected.length > 0 && bins.length > 0;
    empty.textContent =
      connected.length === 0
        ? 'Connect a cloud account to see your pastes.'
        : 'No bins yet: add one on the home page, or open a bin link someone sent you.';
    results = ctx.library.query(parseQuery(query));
    drawScopes();
    drawBins();
    drawFacets();
    drawRows();
    drawBulk();
    const total = ctx.library.entries().length;
    count.textContent =
      results.length === total
        ? `${total} ${total === 1 ? 'paste' : 'pastes'}`
        : `${results.length} of ${total} pastes match`;
    if (results.length > MAX_ROWS) {
      count.textContent += ` (showing the first ${MAX_ROWS})`;
    }
  };

  let pending = false;
  const schedule = () => {
    if (!pending) {
      pending = true;
      setTimeout(() => {
        pending = false;
        draw();
      }, 0);
    }
  };

  const load = async (refresh: boolean) => {
    await ctx.library.load(ctx.libraryBins(), { refresh, signal: controller.signal });
  };

  const unsubscribeLibrary = ctx.library.onChange(schedule);
  const unsubscribeStore = ctx.store.onChange(() => {
    schedule();
    void load(false);
  });
  draw();
  void load(false).catch((e: unknown) => {
    if (reasonOf(e) !== 'aborted') {
      ctx.notify(errorText(e), 'error');
    }
  });
  return () => {
    controller.abort();
    bulkRunning?.abort();
    clearTimeout(typing);
    unsubscribeLibrary();
    unsubscribeStore();
  };
}
