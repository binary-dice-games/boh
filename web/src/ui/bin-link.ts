// MIT License © 2026 Binary Dice Games
/**
 * @file Opening a bin link (spec/02_tags_and_shared_bins/DESIGN.md section 4.6): the recipient
 * signs in, lets boh open the folder (Drive's Picker), sees its pastes, and adds it to their bins.
 * The link grants nothing: the folder's sharing in the provider decides who gets in.
 */
import { newBinId } from '../config-file';
import { LinkError, reasonOf } from '../errors';
import type { BinLink } from '../links';
import { PROVIDER_LABELS, type FolderInfo, type FolderRef } from '../providers/provider';
import { binToken } from '../query';
import { derivedTags } from '../tags';
import type { AppContext } from './context';
import { button, field, h } from './dom';
import { errorText } from './messages';
import { tagChips } from './tag-editor';

/** The view of a bin link. */
export function binLinkView(ctx: AppContext, root: HTMLElement, link: BinLink): () => void {
  const provider = ctx.providers[link.provider];
  const label = PROVIDER_LABELS[link.provider];
  const card = h('section', { class: 'card bin-link' });
  root.append(card);
  let closed = false;
  /** Set while this view adds the bin itself (it then opens the library, not the bin). */
  let adding = false;

  const message = (text: string, ...actions: (Node | null)[]) => {
    card.replaceChildren(
      h('h2', { text: link.name ?? 'Shared bin' }),
      h('p', { class: 'problem', id: 'binlink-message', text }),
      h('div', { class: 'actions' }, ...actions.filter((a): a is Node => a !== null)),
    );
  };

  if (!provider.configured) {
    message(`This bin is in ${label}, which this boh site does not support.`);
    return () => undefined;
  }
  if (!provider.capabilities.binLinks || !provider.folderRef || !provider.describeFolder) {
    message(`boh cannot open bin links of ${label} yet.`);
    return () => undefined;
  }
  let folder: FolderRef;
  try {
    folder = provider.folderRef(link.ref);
  } catch (e) {
    message(
      `This bin link is not valid (${e instanceof LinkError ? e.message : String(e)}). Check that it was copied completely.`,
    );
    return () => undefined;
  }

  const openExisting = (): boolean => {
    const existing = ctx.store.findFolder(provider.id, folder.id);
    if (existing && !closed && !adding) {
      location.hash = `#bin/${encodeURIComponent(existing.bin.id)}`;
      return true;
    }
    return false;
  };

  const signIn = () =>
    button(
      `Sign in to ${label}`,
      () => void ctx.connect(provider.id).then((ok) => ok && void resolve()),
      { class: 'primary', id: 'binlink-sign-in' },
    );

  const resolve = async (granted = false): Promise<void> => {
    if (closed || openExisting()) {
      return;
    }
    if (!provider.account()) {
      message(
        `This is a bin of pastes in ${label}. Sign in to open it: boh reads it with your own ${label} account, and only works if its owner shared the folder with you.`,
        signIn(),
      );
      return;
    }
    card.replaceChildren(h('p', { class: 'muted', text: `Opening the bin from ${label}…` }));
    let info: FolderInfo;
    try {
      info = await provider.describeFolder!(folder);
    } catch (e) {
      if (closed) {
        return;
      }
      const reason = reasonOf(e);
      if (reason === 'needs_grant' && !granted && provider.pickFolder) {
        message(
          `${label} asks you to confirm that boh may open this folder. Choose it in the window that opens.`,
          button(
            'Allow boh to open it',
            () => {
              provider.pickFolder!({ folderId: folder.id }).then(
                () => void resolve(true),
                (err: unknown) => ctx.notify(errorText(err, provider.id), 'error'),
              );
            },
            { class: 'primary', id: 'binlink-grant' },
          ),
        );
      } else if (reason === 'needs_grant' || reason === 'forbidden' || reason === 'not_found') {
        message(
          `This folder does not exist, or your ${label} account (${provider.account()?.name ?? ''}) cannot open it. Ask whoever sent the link to share the folder with you.`,
        );
      } else if (reason === 'needs_sign_in') {
        message(`Sign in to ${label} again.`, signIn());
      } else {
        message(
          errorText(e, provider.id),
          button('Try again', () => void resolve(granted)),
        );
      }
      return;
    }
    if (!closed && !openExisting()) {
      show({ ...folder, name: info.name }, info);
    }
  };

  const show = (found: FolderRef, info: FolderInfo) => {
    const name = h('input', {
      id: 'binlink-name',
      type: 'text',
      required: true,
      maxlength: 80,
      value: info.name,
    });
    const add = h('button', {
      type: 'submit',
      class: 'primary',
      id: 'binlink-add',
      text: 'Add to my bins',
    });
    const preview = h('tbody');
    const status = h('p', { class: 'muted', text: 'Loading its pastes…' });
    const form = h(
      'form',
      {},
      field('Name in your bins', name),
      h('div', { class: 'actions' }, add),
    );
    card.replaceChildren(
      h('h2', { id: 'binlink-title', text: info.name }),
      h('p', {
        class: 'muted',
        id: 'binlink-owner',
        text: info.ownedByMe
          ? `Your own folder in ${label}.`
          : `Shared with you in ${label}${info.owner ? ` by ${info.owner.name}` : ''}. ${info.canAdd ? 'You can add pastes and edit their tags.' : 'You can read its pastes; you cannot add pastes or change tags.'}`,
      }),
      form,
      h(
        'table',
        { class: 'pastes' },
        h('thead', {}, h('tr', {}, h('th', { text: 'Name' }), h('th', { text: 'Tags' }))),
        preview,
      ),
      status,
    );
    provider.list(found).then(
      (page) => {
        preview.replaceChildren(
          ...page.items.map((meta) =>
            h(
              'tr',
              { 'data-paste': meta.name },
              h('td', { text: meta.name }),
              h('td', {}, tagChips(meta.tags ?? [], derivedTags(meta).slice(1, 2))),
            ),
          ),
        );
        status.textContent = page.items.length
          ? page.cursor
            ? 'The newest pastes; add the bin to see them all.'
            : ''
          : 'No pastes boh can see in this bin yet.';
      },
      (e: unknown) => {
        status.textContent = errorText(e, provider.id);
      },
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const binName = name.value.trim();
      if (!binName) {
        return;
      }
      add.disabled = true;
      adding = true;
      ctx.store
        .addBin(provider.id, {
          id: newBinId(),
          name: binName,
          folder: found,
          visibility: 'members',
          ...(info.ownedByMe ? {} : { shared: true }),
          ...(info.owner && !info.ownedByMe ? { owner: info.owner } : {}),
        })
        .then(
          () => {
            ctx.notify(`Added the bin ${binName}.`);
            location.hash = `#library?q=${encodeURIComponent(binToken(binName))}`;
          },
          (e: unknown) => {
            adding = false;
            add.disabled = false;
            ctx.notify(errorText(e, provider.id), 'error');
          },
        );
    });
  };

  void resolve();
  // The bins may still be loading: a bin with this folder, once known, opens directly.
  const unsubscribe = ctx.store.onChange(() => void openExisting());
  return () => {
    closed = true;
    unsubscribe();
  };
}
