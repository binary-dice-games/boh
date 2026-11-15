// MIT License © 2026 Binary Dice Games
/**
 * @file Tags in the app: chips that show manual and derived tags, and the editor that adds and
 * removes manual tags, either in a form (the change stays local) or on a paste (each change is
 * written through the provider). Tags are other people's input: they go in as text only.
 */
import { reasonOf } from '../errors';
import { parseTagList, sortTags, type TagChange } from '../tags';
import { button, h } from './dom';

/** A tag editor. */
export interface TagEditor {
  element: HTMLElement;
  /** The tags shown. */
  tags(): string[];
  /** Replaces the tags shown. */
  set(tags: readonly string[]): void;
  /** Turns editing off (tags stay visible) or on. */
  setReadOnly(readOnly: boolean, why?: string): void;
  /** Adds what is typed but not yet added; resolves once the change is applied. */
  commit(): Promise<void>;
}

/** Options of `tagEditor`. */
export interface TagEditorOptions {
  /** The id of the text input; the editor's element gets `data-tags-for` with it. */
  id: string;
  tags: readonly string[];
  /** Tags offered for completion. */
  suggestions?: () => readonly string[];
  readOnly?: boolean;
  /**
   * Applies a change. Returns the resulting tags (or nothing: the change is applied as given).
   * A rejection keeps the tags as they were and shows the error.
   */
  onChange?: (change: TagChange) => Promise<readonly string[] | void> | readonly string[] | void;
  /** Words for a failed change. */
  errorText?: (error: unknown) => string;
}

/** A tag editor: chips with a remove button each, and a text input that adds on Enter or comma. */
export function tagEditor(options: TagEditorOptions): TagEditor {
  let tags = sortTags(options.tags);
  let readOnly = options.readOnly ?? false;
  let busy = false;
  const chips = h('ul', { class: 'chips', 'aria-label': 'Tags' });
  const listId = `${options.id}-suggestions`;
  const datalist = h('datalist', { id: listId });
  const input = h('input', {
    id: options.id,
    type: 'text',
    list: listId,
    placeholder: 'Add tags',
    'aria-label': 'Add tags',
    autocomplete: 'off',
    maxlength: 400,
  });
  const note = h('small', { class: 'problem', hidden: true, role: 'alert' });
  const readOnlyNote = h('small', { class: 'muted', hidden: true });
  const element = h(
    'div',
    { class: 'tag-editor', 'data-tags-for': options.id },
    chips,
    input,
    datalist,
    note,
    readOnlyNote,
  );

  const say = (text: string) => {
    note.textContent = text;
    note.hidden = !text;
  };

  const draw = () => {
    chips.replaceChildren(
      ...tags.map((tag) =>
        h(
          'li',
          { class: 'chip', 'data-tag': tag },
          h('span', { text: tag }),
          readOnly
            ? null
            : button('×', () => void apply({ remove: [tag] }), {
                class: 'chip-remove',
                'aria-label': `Remove tag ${tag}`,
                title: `Remove ${tag}`,
                disabled: busy,
              }),
        ),
      ),
    );
    input.hidden = readOnly;
    input.disabled = busy;
  };

  const fillSuggestions = () => {
    const offered = (options.suggestions?.() ?? []).filter((t) => !tags.includes(t)).slice(0, 50);
    datalist.replaceChildren(...offered.map((t) => h('option', { value: t })));
  };

  const apply = async (change: TagChange): Promise<void> => {
    if (busy || readOnly) {
      return;
    }
    busy = true;
    draw();
    try {
      const result = await options.onChange?.(change);
      if (result) {
        tags = sortTags(result);
      } else {
        const next = new Set(tags);
        change.remove?.forEach((t) => next.delete(t));
        change.add?.forEach((t) => next.add(t));
        tags = sortTags(next);
      }
      say('');
    } catch (e) {
      say(options.errorText?.(e) ?? (e instanceof Error ? e.message : String(e)));
      if (reasonOf(e) === 'forbidden') {
        readOnly = true;
      }
    } finally {
      busy = false;
      draw();
    }
  };

  const commit = async () => {
    const { tags: typed, invalid } = parseTagList(input.value);
    const add = typed.filter((t) => !tags.includes(t));
    input.value = invalid.join(', ');
    if (invalid.length) {
      say(
        `Not a valid tag: ${invalid.join(', ')}. Tags have letters, digits, "-", "_", "." and "/".`,
      );
    }
    if (add.length) {
      await apply({ add });
      if (invalid.length) {
        say(`Not a valid tag: ${invalid.join(', ')}.`);
      }
    }
  };

  input.addEventListener('focus', fillSuggestions);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      void commit();
    } else if (event.key === 'Backspace' && !input.value && tags.length) {
      void apply({ remove: [tags[tags.length - 1]!] });
    }
  });
  // Choosing a suggestion from the list adds it at once.
  input.addEventListener('input', (event) => {
    if (!(event instanceof InputEvent) || event.inputType === 'insertReplacementText') {
      if ((options.suggestions?.() ?? []).includes(input.value)) {
        void commit();
      }
    }
  });
  draw();

  return {
    element,
    tags: () => [...tags],
    set(next) {
      tags = sortTags(next);
      draw();
    },
    setReadOnly(value, why) {
      readOnly = value;
      readOnlyNote.textContent = why ?? '';
      readOnlyNote.hidden = !value || !why;
      draw();
    },
    commit,
  };
}

/**
 * Read-only chips of a paste's manual and derived tags. With `onTag`, each chip is a button that
 * passes its query token (`#tag` or the derived tag itself).
 */
export function tagChips(
  tags: readonly string[],
  derived: readonly string[] = [],
  onTag?: (token: string, event: MouseEvent) => void,
): HTMLElement {
  const chip = (text: string, token: string, kind: 'manual' | 'derived') =>
    onTag
      ? button(text, (event) => onTag(token, event), {
          class: `tag ${kind}`,
          'data-tag': text,
          title: `Filter by ${text}`,
        })
      : h('span', { class: `tag ${kind}`, 'data-tag': text, text });
  return h(
    'span',
    { class: 'tags' },
    ...tags.map((t) => chip(t, `#${t}`, 'manual')),
    ...derived.map((t) => chip(t, t, 'derived')),
  );
}
