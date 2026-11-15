// MIT License © 2026 Binary Dice Games
/**
 * @file A small DOM builder. Text always goes in as text: nothing from a provider or a paste is
 * ever parsed as HTML in the app's document.
 */

type Child = Node | string | null | undefined | false;

/** Properties of `h`: `class`, `text`, `on` handlers, and plain attributes (`true` for flags). */
export interface Props {
  class?: string;
  text?: string;
  on?: { [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void };
  [attribute: string]: unknown;
}

/** Creates an element with properties and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') {
      el.className = String(value);
    } else if (key === 'text') {
      el.textContent = String(value);
    } else if (key === 'on') {
      for (const [event, handler] of Object.entries(value as Record<string, EventListener>)) {
        el.addEventListener(event, handler);
      }
    } else if (value === true) {
      el.setAttribute(key, '');
    } else if (value !== false && value !== undefined && value !== null) {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) {
      el.append(child);
    }
  }
  return el;
}

/** A button. */
export function button(
  label: string,
  onClick: (event: MouseEvent) => void,
  props: Props = {},
): HTMLButtonElement {
  return h('button', { type: 'button', ...props, text: label, on: { click: onClick } });
}

/**
 * Whether `href` is an absolute `https:` or `http:` address, the only kind boh links to outside
 * itself (addresses come from the services' answers and from links people send).
 */
export function isWebUrl(href: string): boolean {
  try {
    const { protocol } = new URL(href);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * A link that opens outside boh. An address that is not `https:` or `http:` (`javascript:`,
 * `data:`, ...) gives a link without a target.
 */
export function external(label: string, href: string, props: Props = {}): HTMLAnchorElement {
  return h('a', {
    href: isWebUrl(href) ? href : undefined,
    target: '_blank',
    rel: 'noopener noreferrer',
    ...props,
    text: label,
  });
}

/** A labelled form field: `<label>text <control></label>`. */
export function field(label: string, control: HTMLElement, hint?: string): HTMLLabelElement {
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'label', text: label }),
    control,
    hint ? h('small', { text: hint }) : null,
  );
}

/** A `<select>` with `[value, label]` options. */
export function select(
  options: [string, string][],
  value?: string,
  props: Props = {},
): HTMLSelectElement {
  const el = h('select', props);
  for (const [v, label] of options) {
    el.append(h('option', { value: v, text: label, selected: v === value }));
  }
  return el;
}

/**
 * Copies `text` to the clipboard, falling back to selecting it in `input`.
 * @returns whether it was copied
 */
export async function copyText(text: string, input?: HTMLInputElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    input?.select();
    return false;
  }
}

/** Formats an ISO time as a short local date and time. */
export function formatTime(iso: string | number | undefined): string {
  if (iso === undefined) {
    return '';
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
