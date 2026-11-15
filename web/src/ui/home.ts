// MIT License © 2026 Binary Dice Games
/**
 * @file The home view: the new-paste form, the bins, and the recent pastes of this browser.
 */
import type { BinEntry } from '../bin-store';
import { reasonOf } from '../errors';
import { extensionOf, formatSize, pasteFileName, TEXT_FORMATS } from '../formats';
import { PROVIDER_IDS, PROVIDER_LABELS } from '../providers/provider';
import { isTag, matchRules, sortTags } from '../tags';
import { openBinDialog } from './bin-dialog';
import type { AppContext } from './context';
import { button, copyText, external, field, formatTime, h, select } from './dom';
import { errorText, sharingMismatch, sharingText, VISIBILITY_LABELS } from './messages';
import { tagEditor } from './tag-editor';

/** The home view. */
export function homeView(ctx: AppContext, root: HTMLElement): () => void {
  const pasteSection = h('section', {
    class: 'card new-paste',
    'aria-labelledby': 'new-paste-title',
  });
  const binsSection = h('section', { class: 'card bins', 'aria-labelledby': 'bins-title' });
  const recentSection = h('section', { class: 'card recent', 'aria-labelledby': 'recent-title' });
  root.append(pasteSection, binsSection, recentSection);

  const form = newPasteForm(ctx, () => drawRecent(ctx, recentSection));
  pasteSection.append(h('h2', { id: 'new-paste-title', text: 'New paste' }), form.element);

  const drawBins = () => drawBinList(ctx, binsSection);
  drawBins();
  drawRecent(ctx, recentSection);
  const unsubscribe = ctx.store.onChange(() => {
    drawBins();
    form.updateBins();
  });
  return unsubscribe;
}

function binLabel(entry: BinEntry): string {
  return `${entry.bin.name} (${PROVIDER_LABELS[entry.provider]}, ${VISIBILITY_LABELS[entry.bin.visibility].toLowerCase()})`;
}

function newPasteForm(
  ctx: AppContext,
  uploaded: () => void,
): { element: HTMLElement; updateBins: () => void } {
  let file: File | undefined;
  const binSelect = h('select', { id: 'paste-bin', required: true });
  const title = h('input', {
    id: 'paste-title',
    type: 'text',
    maxlength: 120,
    placeholder: 'Optional',
  });
  const format = select(
    [
      ['', 'Bin default'],
      ...TEXT_FORMATS.map((f): [string, string] => [f.ext, `${f.label} (.${f.ext})`]),
    ],
    '',
    { id: 'paste-format' },
  );
  const text = h('textarea', {
    id: 'paste-text',
    rows: 12,
    spellcheck: false,
    placeholder: 'Type or paste text here. You can also drop a file, or paste an image.',
  });
  const fileInput = h('input', { id: 'paste-file', type: 'file' });
  const fileChip = h('p', { class: 'file-chip', hidden: true });

  // Tags: the bin's default tags and the rules' tags are preselected; what the user removes stays
  // removed and what they add stays added while they change the bin, the name or the format.
  let autoTags: string[] = [];
  const added = new Set<string>();
  const dismissed = new Set<string>();
  const currentTags = () => sortTags([...autoTags.filter((t) => !dismissed.has(t)), ...added]);
  const tags = tagEditor({
    id: 'paste-tags',
    tags: [],
    suggestions: () => ctx.library.knownTags(),
    onChange: (change) => {
      for (const t of change.remove ?? []) {
        added.delete(t);
        dismissed.add(t);
      }
      for (const t of change.add ?? []) {
        dismissed.delete(t);
        added.add(t);
      }
      return currentTags();
    },
  });
  const tagsField = field('Tags', tags.element, 'Press Enter or type a comma after each tag');
  const upload = h('button', {
    type: 'submit',
    id: 'paste-upload',
    class: 'primary',
    text: 'Upload',
  });
  const result = h('div', { class: 'result', id: 'paste-result', 'aria-live': 'polite' });
  const empty = h('p', { class: 'muted' });

  const setFile = (f: File | undefined) => {
    file = f;
    if (f) {
      fileChip.replaceChildren(
        `File: ${f.name} (${formatSize(f.size)}) `,
        button('Remove file', () => {
          fileInput.value = '';
          setFile(undefined);
        }),
      );
    }
    fileChip.hidden = !f;
    text.disabled = Boolean(f);
    format.disabled = Boolean(f);
    updateTags();
  };

  /** The file name the paste will get (the time stamp is a stand-in until upload). */
  const pendingName = (binFormat?: string): string => {
    if (file) {
      return title.value.trim()
        ? pasteFileName(title.value, extensionOf(file.name) || 'bin')
        : file.name;
    }
    return pasteFileName(title.value, format.value || binFormat || 'txt');
  };

  const updateTags = () => {
    const entry = ctx.store.find(binSelect.value);
    const usable = entry !== undefined && ctx.providers[entry.provider].capabilities.tags;
    tagsField.hidden = !usable;
    if (!entry || !usable) {
      return;
    }
    const name = pendingName(entry.bin.defaultFormat);
    autoTags = sortTags([
      ...(entry.bin.defaultTags ?? []).filter(isTag),
      ...matchRules(ctx.store.rules(entry.provider), entry.bin.id, { name, mime: file?.type }),
    ]);
    tags.set(currentTags());
  };
  const resetTags = () => {
    added.clear();
    dismissed.clear();
    updateTags();
  };
  binSelect.addEventListener('change', updateTags);
  format.addEventListener('change', updateTags);
  title.addEventListener('input', updateTags);
  fileInput.addEventListener('change', () => setFile(fileInput.files?.[0]));
  text.addEventListener('paste', (event) => {
    const image = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (image) {
      event.preventDefault();
      const ext = image.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
      setFile(new File([image], pasteFileName('', ext), { type: image.type }));
    }
  });

  const element = h(
    'form',
    { class: 'paste-form' },
    empty,
    h(
      'div',
      { class: 'row' },
      field('Bin', binSelect),
      field('Title', title),
      field('Format', format),
    ),
    field('Text', text),
    h('div', { class: 'row' }, field('Or a file', fileInput)),
    fileChip,
    tagsField,
    h('div', { class: 'actions' }, upload),
    result,
  );
  element.addEventListener('dragover', (event) => {
    event.preventDefault();
    element.classList.add('dragging');
  });
  element.addEventListener('dragleave', () => element.classList.remove('dragging'));
  element.addEventListener('drop', (event) => {
    event.preventDefault();
    element.classList.remove('dragging');
    const dropped = event.dataTransfer?.files?.[0];
    if (dropped) {
      setFile(dropped);
    }
  });

  const updateBins = () => {
    const bins = ctx.store.bins();
    const previous = binSelect.value || ctx.local.prefs().lastBin || ctx.store.defaultBin()?.bin.id;
    binSelect.replaceChildren(
      ...bins.map((e) =>
        h('option', { value: e.bin.id, text: binLabel(e), selected: e.bin.id === previous }),
      ),
    );
    const usable = bins.length > 0;
    upload.disabled = !usable;
    empty.textContent = usable
      ? ''
      : ctx.connected().length === 0
        ? 'Connect a cloud account above, then add a bin: a folder of yours where pastes go.'
        : 'Add a bin below: a folder of yours where pastes go.';
    empty.hidden = usable;
    updateTags();
  };
  updateBins();

  element.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      const entry = ctx.store.find(binSelect.value);
      if (!entry) {
        ctx.notify('Choose a bin first.', 'error');
        return;
      }
      const provider = ctx.providers[entry.provider];
      let name: string;
      let blob: Blob;
      if (file) {
        name = pendingName();
        blob = file;
      } else {
        if (!text.value.trim()) {
          ctx.notify(
            'There is nothing to upload: type or paste some text, or choose a file.',
            'error',
          );
          return;
        }
        const ext = format.value || entry.bin.defaultFormat || 'txt';
        name = pasteFileName(title.value, ext);
        blob = new Blob([text.value], { type: 'text/plain; charset=utf-8' });
      }
      if (blob.size > provider.maxUploadBytes) {
        ctx.notify(
          `That is too large for boh (${formatSize(blob.size)}; the limit is ${formatSize(provider.maxUploadBytes)}).`,
          'error',
        );
        return;
      }
      upload.disabled = true;
      await tags.commit();
      const pasteTags = provider.capabilities.tags ? tags.tags() : [];
      result.replaceChildren(h('p', { text: `Uploading ${name}…` }));
      try {
        const meta = await provider.upload(
          entry.bin.folder,
          name,
          blob,
          pasteTags.length ? { tags: pasteTags } : undefined,
        );
        ctx.library.add(entry.bin.id, meta);
        ctx.local.setPrefs({ lastBin: entry.bin.id });
        let link: string | undefined;
        let problem: string | undefined;
        try {
          link = await ctx.linkFor(meta, entry.bin.visibility);
        } catch (e) {
          problem = reasonOf(e) === 'unsupported' ? errorText(e) : errorText(e, entry.provider);
        }
        if (link) {
          ctx.local.addRecent({
            link,
            name: meta.name,
            provider: entry.provider,
            at: Date.now(),
            own: true,
          });
          uploaded();
        }
        showResult(ctx, result, meta.name, entry, link, problem, meta.webUrl);
        text.value = '';
        title.value = '';
        fileInput.value = '';
        setFile(undefined);
        resetTags();
      } catch (e) {
        result.replaceChildren(
          h('p', { class: 'problem', text: `Upload failed. ${errorText(e, entry.provider)}` }),
        );
      } finally {
        upload.disabled = false;
      }
    })();
  });
  return { element, updateBins };
}

function showResult(
  ctx: AppContext,
  result: HTMLElement,
  name: string,
  entry: BinEntry,
  link: string | undefined,
  problem: string | undefined,
  webUrl: string | undefined,
): void {
  if (!link) {
    result.replaceChildren(
      h('p', {
        text: `Uploaded ${name} to ${entry.bin.name}, but boh could not make a link: ${problem ?? ''}`,
      }),
      ...(webUrl ? [external(`Open in ${PROVIDER_LABELS[entry.provider]}`, webUrl)] : []),
    );
    return;
  }
  const input = h('input', {
    type: 'text',
    readonly: true,
    value: link,
    id: 'paste-link',
    'aria-label': 'Link',
  });
  result.replaceChildren(
    h('p', { text: `Uploaded ${name} to ${entry.bin.name}.` }),
    h(
      'div',
      { class: 'link-row' },
      input,
      button('Copy link', async () => {
        ctx.notify(
          (await copyText(link, input))
            ? 'Link copied.'
            : 'Press Ctrl+C (⌘C) to copy the selected link.',
        );
      }),
      h('a', { href: link, text: 'Open' }),
    ),
  );
}

function drawBinList(ctx: AppContext, section: HTMLElement): void {
  const add = button('Add bin', () => openBinDialog(ctx), {
    id: 'add-bin',
    disabled: ctx.connected().length === 0,
  });
  const list = h('ul', { class: 'bin-list' });
  section.replaceChildren(
    h(
      'div',
      { class: 'section-head' },
      h('h2', { id: 'bins-title', text: 'Bins' }),
      h('div', { class: 'actions' }, h('a', { href: '#library', text: 'Search all pastes' }), add),
    ),
    list,
  );

  for (const id of PROVIDER_IDS) {
    const state = ctx.store.state(id);
    if (state?.status === 'broken') {
      section.append(
        h(
          'p',
          { class: 'problem' },
          `The boh settings in ${PROVIDER_LABELS[id]} cannot be used: ${state.problem ?? ''} `,
          button('Reset them', () => {
            if (
              confirm(
                `Replace the boh settings file in ${PROVIDER_LABELS[id]} with an empty one? Your folders and pastes are not touched.`,
              )
            ) {
              ctx.store.reset(id).catch((e: unknown) => ctx.notify(errorText(e, id), 'error'));
            }
          }),
        ),
      );
    } else if (state?.status === 'error') {
      section.append(
        h(
          'p',
          { class: 'problem' },
          `Could not read the boh settings from ${PROVIDER_LABELS[id]}: ${state.problem ?? ''} `,
          button('Retry', () => ctx.store.load(id).catch(() => undefined)),
        ),
      );
    } else if (state?.status === 'loading' && state.config.bins.length === 0) {
      section.append(h('p', { class: 'muted', text: `Loading bins from ${PROVIDER_LABELS[id]}…` }));
    }
  }

  const bins = ctx.store.bins();
  if (bins.length === 0) {
    list.append(
      h('li', {
        class: 'muted',
        text: ctx.connected().length ? 'No bins yet.' : 'Connect a cloud account to see your bins.',
      }),
    );
  }
  for (const entry of bins) {
    const sharing = h('span', { class: 'sharing muted', text: 'Checking sharing…' });
    const warning = h('p', { class: 'warning', hidden: true });
    const connected = ctx.providers[entry.provider].account() !== null;
    list.append(
      h(
        'li',
        { class: 'bin', 'data-bin': entry.bin.id },
        h(
          'div',
          { class: 'bin-main' },
          h('a', {
            href: `#bin/${encodeURIComponent(entry.bin.id)}`,
            class: 'bin-name',
            text: entry.bin.name,
          }),
          h('span', {
            class: `badge ${entry.bin.visibility}`,
            text: VISIBILITY_LABELS[entry.bin.visibility],
          }),
          entry.bin.shared
            ? h('span', {
                class: 'badge shared',
                text: entry.bin.owner ? `Shared by ${entry.bin.owner.name}` : 'Shared with me',
              })
            : null,
          h('span', { class: 'muted', text: PROVIDER_LABELS[entry.provider] }),
          sharing,
        ),
        warning,
        h(
          'div',
          { class: 'bin-actions' },
          button('Edit', () => openBinDialog(ctx, entry)),
          button('Remove', () => {
            if (
              confirm(
                `Remove the bin "${entry.bin.name}" from boh? The folder and its files stay in ${PROVIDER_LABELS[entry.provider]}.`,
              )
            ) {
              ctx.store
                .removeBin(entry.bin.id)
                .catch((e: unknown) => ctx.notify(errorText(e, entry.provider), 'error'));
            }
          }),
        ),
      ),
    );
    if (!connected) {
      sharing.textContent = '';
      continue;
    }
    ctx.sharing(entry).then(
      (s) => {
        sharing.replaceChildren(
          s.manageUrl
            ? external(sharingText(s), s.manageUrl, { title: 'Change the sharing in the service' })
            : sharingText(s),
        );
        const mismatch = sharingMismatch(entry.bin.visibility, s);
        warning.textContent = mismatch ?? '';
        warning.hidden = !mismatch;
      },
      () => {
        sharing.textContent = 'Sharing unknown';
      },
    );
  }
}

function drawRecent(ctx: AppContext, section: HTMLElement): void {
  const recent = ctx.local.recent();
  const list = h('ul', { class: 'recent-list' });
  section.replaceChildren(
    h(
      'div',
      { class: 'section-head' },
      h('h2', { id: 'recent-title', text: 'Recent pastes' }),
      recent.length
        ? button('Clear', () => {
            ctx.local.clearRecent();
            drawRecent(ctx, section);
          })
        : null,
    ),
    h('p', { class: 'muted', text: 'Kept in this browser only.' }),
    list,
  );
  if (recent.length === 0) {
    list.append(h('li', { class: 'muted', text: 'Nothing yet.' }));
  }
  for (const paste of recent) {
    list.append(
      h(
        'li',
        {},
        h('a', { href: paste.link, text: paste.name }),
        h('span', {
          class: 'muted',
          text: ` ${PROVIDER_LABELS[paste.provider]} · ${paste.own ? 'uploaded' : 'opened'} ${formatTime(paste.at)} `,
        }),
        button(
          'Forget',
          () => {
            ctx.local.removeRecent(paste.link);
            drawRecent(ctx, section);
          },
          { class: 'small' },
        ),
      ),
    );
  }
}
