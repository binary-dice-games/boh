// MIT License © 2026 Binary Dice Games
/** @file A bin's pastes: view, copy the link, open in the provider, delete. */
import type { BinEntry } from '../bin-store';
import { formatSize } from '../formats';
import { PROVIDER_LABELS, type PasteMeta } from '../providers/provider';
import type { AppContext } from './context';
import { button, copyText, external, formatTime, h } from './dom';
import { errorText, sharingMismatch, sharingText, VISIBILITY_LABELS } from './messages';

/** The view of the bin `binId`. */
export function binView(ctx: AppContext, root: HTMLElement, binId: string): () => void {
  let drawn = false;
  const draw = () => {
    const entry = ctx.store.find(binId);
    if (!entry) {
      const loading = ctx.connected().some((p) => {
        const s = ctx.store.state(p.id)?.status;
        return s === undefined || s === 'loading';
      });
      root.replaceChildren(
        h('p', {
          class: loading ? 'muted' : 'problem',
          text: loading ? 'Loading the bin…' : 'This bin does not exist in the connected accounts.',
        }),
      );
      return;
    }
    if (drawn) {
      return; // the listing does not depend on later configuration changes
    }
    drawn = true;
    drawBin(ctx, root, entry);
  };
  draw();
  return ctx.store.onChange(draw);
}

function drawBin(ctx: AppContext, root: HTMLElement, entry: BinEntry): void {
  const provider = ctx.providers[entry.provider];
  const sharing = h('p', { class: 'muted' });
  const warning = h('p', { class: 'warning', hidden: true });
  const table = h('tbody');
  const more = button('Load more', () => void load(cursor), { hidden: true });
  const status = h('p', { class: 'muted' });
  let cursor: string | undefined;

  root.replaceChildren(
    h(
      'section',
      { class: 'card' },
      h(
        'div',
        { class: 'section-head' },
        h('h2', { text: entry.bin.name }),
        h('span', {
          class: `badge ${entry.bin.visibility}`,
          text: VISIBILITY_LABELS[entry.bin.visibility],
        }),
      ),
      h('p', {
        class: 'muted',
        text: `${PROVIDER_LABELS[entry.provider]} folder ${entry.bin.folder.path ?? entry.bin.folder.name}`,
      }),
      sharing,
      warning,
      h(
        'div',
        { class: 'actions' },
        button('New paste here', () => {
          ctx.local.setPrefs({ lastBin: entry.bin.id });
          location.hash = '';
        }),
        button('Refresh', () => {
          table.replaceChildren();
          void load(undefined);
        }),
      ),
      h(
        'table',
        { class: 'pastes' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { text: 'Name' }),
            h('th', { text: 'Size' }),
            h('th', { text: 'Changed' }),
            h('th', { text: '' }),
          ),
        ),
        table,
      ),
      status,
      more,
    ),
  );

  if (!provider.account()) {
    status.replaceChildren(
      `Connect ${provider.label} to see this bin. `,
      button(`Connect ${provider.label}`, () => void ctx.connect(provider.id)),
    );
    return;
  }

  ctx.sharing(entry).then(
    (s) => {
      sharing.replaceChildren(s.manageUrl ? external(sharingText(s), s.manageUrl) : sharingText(s));
      const text = sharingMismatch(entry.bin.visibility, s);
      warning.textContent = text ?? '';
      warning.hidden = !text;
    },
    () => (sharing.textContent = 'Sharing unknown'),
  );

  const row = (meta: PasteMeta) => {
    const tr = h('tr', { 'data-paste': meta.name });
    const view = button('View', () => {
      ctx.linkFor(meta, entry.bin.visibility).then(
        (link) => (location.href = link),
        (e: unknown) => ctx.notify(errorText(e, entry.provider), 'error'),
      );
    });
    const copy = button('Copy link', () => {
      ctx.linkFor(meta, entry.bin.visibility).then(
        async (link) =>
          ctx.notify((await copyText(link)) ? `Copied the link of ${meta.name}.` : link),
        (e: unknown) => ctx.notify(errorText(e, entry.provider), 'error'),
      );
    });
    const remove = button('Delete', () => {
      if (!confirm(`Delete ${meta.name} from ${provider.label}? Links to it stop working.`)) {
        return;
      }
      provider.remove(meta).then(
        () => {
          tr.remove();
          if (table.childElementCount === 0 && !cursor) {
            status.textContent = 'No pastes in this bin yet.';
          }
          ctx.notify(`Deleted ${meta.name}.`);
        },
        (e: unknown) => ctx.notify(errorText(e, entry.provider), 'error'),
      );
    });
    tr.append(
      h('td', { text: meta.name }),
      h('td', { text: formatSize(meta.size) }),
      h('td', { text: formatTime(meta.modified) }),
      h(
        'td',
        { class: 'row-actions' },
        view,
        copy,
        meta.webUrl ? external(`Open in ${provider.label}`, meta.webUrl) : null,
        remove,
      ),
    );
    return tr;
  };

  const load = async (from: string | undefined) => {
    status.textContent = 'Loading…';
    more.hidden = true;
    try {
      const page = await provider.list(entry.bin.folder, from);
      table.append(...page.items.map(row));
      cursor = page.cursor;
      more.hidden = !cursor;
      status.textContent = table.childElementCount === 0 ? 'No pastes in this bin yet.' : '';
    } catch (e) {
      status.replaceChildren(
        errorText(e, entry.provider),
        ' ',
        button('Retry', () => void load(from)),
      );
    }
  };
  void load(undefined);
}
