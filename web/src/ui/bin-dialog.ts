// MIT License © 2026 Binary Dice Games
/**
 * @file The add-bin and edit-bin dialog. Adding picks a folder (Google's picker for Drive, boh's
 * folder browser for Dropbox and OneDrive) or creates one, shows its real sharing, and saves the
 * bin in the account's configuration.
 */
import type { BinEntry } from '../bin-store';
import { newBinId } from '../config-file';
import { TEXT_FORMATS } from '../formats';
import {
  VISIBILITIES,
  type FolderRef,
  type Provider,
  type Visibility,
} from '../providers/provider';
import type { AppContext } from './context';
import { button, field, h, select } from './dom';
import {
  errorText,
  sharingMismatch,
  sharingText,
  VISIBILITY_HINTS,
  VISIBILITY_LABELS,
} from './messages';

const visibilityOptions = (): [string, string][] =>
  VISIBILITIES.map((v) => [v, `${VISIBILITY_LABELS[v]}: ${VISIBILITY_HINTS[v]}`]);
const formatOptions = (): [string, string][] => TEXT_FORMATS.map((f) => [f.ext, f.label]);

/** Opens the dialog: editing `entry`, or adding a bin when it is omitted. */
export function openBinDialog(ctx: AppContext, entry?: BinEntry): void {
  const dialog = h('dialog', { class: 'bin-dialog', 'aria-labelledby': 'bin-dialog-title' });
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);

  const name = h('input', {
    id: 'bin-name',
    type: 'text',
    required: true,
    maxlength: 80,
    value: entry?.bin.name ?? '',
  });
  const visibility = select(visibilityOptions(), entry?.bin.visibility ?? 'members', {
    id: 'bin-visibility',
  });
  const defaultFormat = select(formatOptions(), entry?.bin.defaultFormat ?? 'txt', {
    id: 'bin-format',
  });
  const problem = h('p', { class: 'problem', hidden: true });
  const save = h('button', {
    type: 'submit',
    class: 'primary',
    id: 'bin-save',
    text: entry ? 'Save' : 'Add bin',
    disabled: !entry,
  });
  const form = h('form', { method: 'dialog' });
  dialog.append(form);

  let folder: FolderRef | undefined = entry?.bin.folder;
  let provider: Provider | undefined = entry ? ctx.providers[entry.provider] : ctx.connected()[0];

  const sharingLine = h('p', { class: 'muted', id: 'bin-sharing' });
  const mismatch = h('p', { class: 'warning', hidden: true });
  const checkMismatch = (kind?: Parameters<typeof sharingMismatch>[1]) => {
    const text = kind ? sharingMismatch(visibility.value as Visibility, kind) : undefined;
    mismatch.textContent = text ?? '';
    mismatch.hidden = !text;
  };
  let sharing: Parameters<typeof sharingMismatch>[1] | undefined;
  visibility.addEventListener('change', () => checkMismatch(sharing));

  const describe = (p: Provider, f: FolderRef, preset: boolean) => {
    sharingLine.textContent = 'Checking the folder’s sharing…';
    p.describeSharing(f).then(
      (s) => {
        sharing = s;
        sharingLine.textContent = `${sharingText(s)} in ${p.label}.`;
        if (preset && s.kind !== 'unknown') {
          visibility.value = s.kind;
        }
        checkMismatch(s);
      },
      () => {
        sharingLine.textContent = 'boh could not read the folder’s sharing.';
      },
    );
  };

  const fail = (e: unknown) => {
    problem.textContent = errorText(e, provider?.id);
    problem.hidden = false;
  };

  if (entry) {
    form.append(
      h('h2', { id: 'bin-dialog-title', text: `Edit ${entry.bin.name}` }),
      h('p', {
        class: 'muted',
        text: `Folder: ${entry.bin.folder.name} (${ctx.providers[entry.provider].label})`,
      }),
      sharingLine,
    );
    if (provider && provider.account()) {
      describe(provider, entry.bin.folder, false);
    }
  } else {
    const chosen = h('p', { id: 'bin-folder', class: 'chosen', text: 'No folder chosen yet.' });
    const chooser = h('div', { class: 'chooser' });
    const account = select(
      ctx
        .connected()
        .map((p): [string, string] => [p.id, `${p.label} (${p.account()?.name ?? ''})`]),
      provider?.id,
      { id: 'bin-account' },
    );
    const choose = (f: FolderRef) => {
      folder = f;
      chosen.textContent = `Folder: ${f.path ?? f.name}`;
      if (!name.value.trim()) {
        name.value = f.name;
      }
      save.disabled = false;
      chooser.replaceChildren();
      drawChooser();
      if (provider) {
        describe(provider, f, true);
      }
    };
    const drawChooser = () => {
      chooser.replaceChildren();
      const p = provider;
      if (!p) {
        return;
      }
      const newName = h('input', {
        id: 'new-folder-name',
        type: 'text',
        placeholder: 'New folder name',
        maxlength: 100,
      });
      let current: FolderRef | null = null;
      const trail: FolderRef[] = [];
      const browser = h('div', { class: 'folder-browser' });
      const create = button(
        'Create folder',
        () => {
          const value = newName.value.trim();
          if (!value) {
            newName.focus();
            return;
          }
          p.createFolder(value, current).then(choose, fail);
        },
        { id: 'create-folder' },
      );
      if (p.pickFolder) {
        chooser.append(
          button(
            `Choose a folder in ${p.label}`,
            () => {
              p.pickFolder!().then((f) => f && choose(f), fail);
            },
            { id: 'pick-folder' },
          ),
        );
      }
      if (p.listFolders) {
        const draw = () => {
          browser.replaceChildren(h('p', { class: 'muted', text: 'Loading folders…' }));
          p.listFolders!(current).then((folders) => {
            const crumbs = h(
              'p',
              { class: 'crumbs' },
              button(
                'Top',
                () => {
                  current = null;
                  trail.length = 0;
                  draw();
                },
                { class: 'link' },
              ),
              ...trail.flatMap((f, i) => [
                ' / ',
                button(
                  f.name,
                  () => {
                    trail.length = i + 1;
                    current = f;
                    draw();
                  },
                  { class: 'link' },
                ),
              ]),
            );
            const list = h('ul', { class: 'folders' });
            for (const f of folders) {
              list.append(
                h(
                  'li',
                  {},
                  button(
                    `📁 ${f.name}`,
                    () => {
                      trail.push(f);
                      current = f;
                      draw();
                    },
                    { class: 'link', 'data-folder': f.name },
                  ),
                ),
              );
            }
            if (folders.length === 0) {
              list.append(h('li', { class: 'muted', text: 'No folders here.' }));
            }
            browser.replaceChildren(
              crumbs,
              list,
              ...(current
                ? [
                    button(`Use “${current.name}”`, () => current && choose(current), {
                      id: 'use-folder',
                      class: 'primary',
                    }),
                  ]
                : []),
            );
          }, fail);
        };
        chooser.append(browser);
        draw();
      }
      chooser.append(h('div', { class: 'row' }, newName, create));
    };
    account.addEventListener('change', () => {
      provider = ctx.providers[account.value as keyof typeof ctx.providers];
      folder = undefined;
      save.disabled = true;
      chosen.textContent = 'No folder chosen yet.';
      sharingLine.textContent = '';
      drawChooser();
    });
    form.append(
      h('h2', { id: 'bin-dialog-title', text: 'Add a bin' }),
      h('p', {
        class: 'muted',
        text: 'A bin is a folder in your cloud storage. Who can open its pastes is decided by the folder’s sharing in that service.',
      }),
      field('Account', account),
      chooser,
      chosen,
      sharingLine,
    );
    drawChooser();
  }

  form.append(
    field('Name', name),
    field(
      'Visibility',
      visibility,
      'Which links boh makes for new pastes. It never changes the folder’s sharing.',
    ),
    mismatch,
    field('Default format', defaultFormat, 'For text pastes'),
    problem,
    h('div', { class: 'actions' }, button('Cancel', close), save),
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const binName = name.value.trim();
    if (!binName || !folder || !provider) {
      return;
    }
    save.disabled = true;
    const done = entry
      ? ctx.store.updateBin(entry.bin.id, {
          name: binName,
          visibility: visibility.value as Visibility,
          defaultFormat: defaultFormat.value,
        })
      : ctx.store.addBin(provider.id, {
          id: newBinId(),
          name: binName,
          folder,
          visibility: visibility.value as Visibility,
          defaultFormat: defaultFormat.value,
        });
    done.then(
      () => {
        ctx.notify(entry ? 'Bin saved.' : `Added the bin ${binName}.`);
        close();
      },
      (e: unknown) => {
        save.disabled = false;
        fail(e);
      },
    );
  });
  dialog.showModal();
}
