// MIT License © 2026 Binary Dice Games
/**
 * @file The tag rules dialog (spec/02_tags_and_shared_bins/DESIGN.md section 3.3): lists the rules
 * of a connected account, adds and removes them. Rules live in that account's settings file and
 * add tags to new pastes at upload; they never remove tags.
 */
import { newBinId } from '../config-file';
import { RENDERERS, type Renderer } from '../formats';
import type { Provider } from '../providers/provider';
import { parseTagList, type TagRule } from '../tags';
import type { AppContext } from './context';
import { button, field, h, select } from './dom';
import { errorText } from './messages';

/** A rule in words. */
export function describeRule(rule: TagRule, binName: (id: string) => string): string {
  const parts: string[] = [];
  parts.push(rule.bins.length ? `In ${rule.bins.map(binName).join(', ')}` : 'In every bin');
  if (rule.match.format?.length) {
    parts.push(`format ${rule.match.format.join(', ')}`);
  }
  if (rule.match.kind?.length) {
    parts.push(`kind ${rule.match.kind.join(', ')}`);
  }
  if (rule.match.name) {
    parts.push(`name ${rule.match.name}`);
  }
  return `${parts.join(', ')}: add ${rule.tags.join(', ')}`;
}

/** Opens the tag rules dialog. */
export function openRulesDialog(ctx: AppContext): void {
  const accounts = ctx.connected().filter((p) => p.capabilities.tags);
  const dialog = h('dialog', {
    class: 'bin-dialog rules-dialog',
    'aria-labelledby': 'rules-title',
  });
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);

  if (accounts.length === 0) {
    dialog.append(
      h('h2', { id: 'rules-title', text: 'Tag rules' }),
      h('p', { text: 'Connect an account that keeps tags (Google Drive) to write tag rules.' }),
      h('div', { class: 'actions' }, button('Close', close)),
    );
    dialog.showModal();
    return;
  }

  let provider: Provider = accounts[0]!;
  const account = select(
    accounts.map((p): [string, string] => [p.id, `${p.label} (${p.account()?.name ?? ''})`]),
    provider.id,
    { id: 'rules-account' },
  );
  const list = h('ul', { class: 'rules', id: 'rules-list' });
  const bins = h('select', { id: 'rule-bins', multiple: true, size: 4 });
  const formats = h('input', { id: 'rule-formats', type: 'text', placeholder: 'md, log' });
  const kinds = h('select', { id: 'rule-kinds', multiple: true, size: 4 });
  for (const r of RENDERERS) {
    kinds.append(h('option', { value: r, text: r }));
  }
  const name = h('input', { id: 'rule-name', type: 'text', placeholder: '*.log' });
  const tags = h('input', { id: 'rule-tags', type: 'text', placeholder: 'logs, server' });
  const problem = h('p', { class: 'problem', hidden: true });
  const add = h('button', { type: 'submit', class: 'primary', id: 'rule-add', text: 'Add rule' });
  const form = h(
    'form',
    { class: 'rule-form' },
    h('h3', { text: 'New rule' }),
    field('Bins', bins, 'None chosen: every bin of this account'),
    field('Formats', formats, 'Extensions, separated by commas'),
    field('Kinds', kinds),
    field('Name pattern', name, '* any text, ? one character'),
    field('Tags to add', tags),
    problem,
    h('div', { class: 'actions' }, add),
  );

  const fail = (e: unknown) => {
    problem.textContent = typeof e === 'string' ? e : errorText(e, provider.id);
    problem.hidden = false;
  };

  const binName = (id: string) => ctx.store.find(id)?.bin.name ?? '(removed bin)';
  const draw = () => {
    const own = ctx.store.bins().filter((e) => e.provider === provider.id);
    bins.replaceChildren(...own.map((e) => h('option', { value: e.bin.id, text: e.bin.name })));
    const rules = ctx.store.rules(provider.id);
    list.replaceChildren(
      ...(rules.length
        ? rules.map((rule) =>
            h(
              'li',
              { 'data-rule': rule.id },
              h('span', { text: describeRule(rule, binName) }),
              ' ',
              button(
                'Delete',
                () => {
                  ctx.store.removeRule(provider.id, rule.id).then(draw, fail);
                },
                { class: 'small' },
              ),
            ),
          )
        : [h('li', { class: 'muted', text: 'No rules yet.' })]),
    );
  };
  account.addEventListener('change', () => {
    provider = accounts.find((p) => p.id === account.value) ?? provider;
    draw();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    problem.hidden = true;
    const parsed = parseTagList(tags.value);
    if (parsed.invalid.length) {
      fail(`Not a valid tag: ${parsed.invalid.join(', ')}.`);
      return;
    }
    if (parsed.tags.length === 0) {
      fail('Give at least one tag to add.');
      return;
    }
    const format = formats.value
      .split(',')
      .map((f) => f.trim().toLowerCase().replace(/^\./, ''))
      .filter(Boolean);
    const kind = [...kinds.selectedOptions].map((o) => o.value as Renderer);
    const rule: TagRule = {
      id: newBinId(),
      bins: [...bins.selectedOptions].map((o) => o.value),
      match: {
        ...(format.length ? { format } : {}),
        ...(kind.length ? { kind } : {}),
        ...(name.value.trim() ? { name: name.value.trim() } : {}),
      },
      tags: parsed.tags,
    };
    add.disabled = true;
    ctx.store.addRule(provider.id, rule).then(
      () => {
        add.disabled = false;
        form.reset();
        draw();
        ctx.notify('Rule added.');
      },
      (e: unknown) => {
        add.disabled = false;
        fail(e);
      },
    );
  });

  dialog.append(
    h('h2', { id: 'rules-title', text: 'Tag rules' }),
    h('p', {
      class: 'muted',
      text: 'Rules preselect tags when you upload a paste; you can remove them before uploading. Apply rules in the library adds them to existing pastes. Rules never remove tags.',
    }),
    ...(accounts.length > 1 ? [field('Account', account)] : []),
    list,
    form,
    h('div', { class: 'actions' }, button('Close', close, { id: 'rules-close' })),
  );
  draw();
  dialog.showModal();
}
