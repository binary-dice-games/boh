// MIT License © 2026 Binary Dice Games
/**
 * @file The app shell: the header with the accounts, the status line, and the router. Routes are
 * fragments: `#v1/...` is a paste link (the viewer), `#bin/<id>` a bin, anything else the home.
 */
import type { BinEntry, BinStore } from '../bin-store';
import { AuthError, LinkError } from '../errors';
import { formatLink, parseFragment } from '../links';
import type { LocalState } from '../local-state';
import {
  PROVIDER_IDS,
  PROVIDER_LABELS,
  type PasteMeta,
  type Provider,
  type ProviderId,
  type Sharing,
  type Visibility,
} from '../providers/provider';
import { binView } from './bin-view';
import type { AppContext, View } from './context';
import { button, h } from './dom';
import { homeView } from './home';
import { errorText } from './messages';
import { viewerView } from './viewer';

/** The app. */
export class App implements AppContext {
  private readonly header = h('header', { class: 'top' });
  private readonly status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  private readonly main = h('div', { class: 'view' });
  private cleanup: () => void = () => undefined;
  private readonly sharingCache = new Map<string, Promise<Sharing>>();
  private readonly linkCache = new Map<string, Promise<string>>();
  private statusTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    readonly providers: Record<ProviderId, Provider>,
    readonly store: BinStore,
    readonly local: LocalState,
    readonly siteUrl: string,
    private readonly root: HTMLElement,
  ) {}

  /** Draws the app and loads the connected accounts' bins. */
  start(): void {
    this.root.replaceChildren(this.header, this.status, this.main);
    window.addEventListener('hashchange', () => this.route());
    this.drawHeader();
    this.route();
    for (const p of this.connected()) {
      this.store.load(p.id).catch(() => undefined); // shown as the account's state
    }
  }

  connected(): Provider[] {
    return PROVIDER_IDS.map((id) => this.providers[id]).filter((p) => p.account() !== null);
  }

  connect(id: ProviderId): Promise<boolean> {
    const provider = this.providers[id];
    const signIn = provider.signIn({ stay: this.local.prefs().stay }); // opens the popup now
    this.notify(`Waiting for ${provider.label} sign-in…`);
    return signIn.then(
      (account) => {
        this.notify(`Connected ${provider.label} as ${account.name}.`);
        this.drawHeader();
        this.store.load(id).catch(() => undefined);
        this.route();
        return true;
      },
      (e: unknown) => {
        if (e instanceof AuthError && e.reason === 'cancelled') {
          this.notify('Sign-in cancelled.');
        } else {
          this.notify(errorText(e, id), 'error');
        }
        this.drawHeader();
        return false;
      },
    );
  }

  async disconnect(id: ProviderId): Promise<void> {
    this.store.forget(id);
    await this.providers[id].signOut();
    this.sharingCache.clear();
    this.linkCache.clear();
    this.notify(`Disconnected ${PROVIDER_LABELS[id]}.`);
    this.drawHeader();
    this.route();
  }

  notify(text: string, kind: 'info' | 'error' = 'info'): void {
    this.status.textContent = text;
    this.status.className = `status ${kind}`;
    clearTimeout(this.statusTimer);
    if (kind === 'info') {
      this.statusTimer = setTimeout(() => {
        this.status.textContent = '';
      }, 8000);
    }
  }

  sharing(entry: BinEntry): Promise<Sharing> {
    const key = `${entry.provider}:${entry.bin.folder.id}`;
    let found = this.sharingCache.get(key);
    if (!found) {
      found = this.providers[entry.provider].describeSharing(entry.bin.folder);
      found.catch(() => this.sharingCache.delete(key));
      this.sharingCache.set(key, found);
    }
    return found;
  }

  linkFor(meta: PasteMeta, visibility: Visibility): Promise<string> {
    const key = `${meta.provider}:${meta.key}:${visibility}`;
    let found = this.linkCache.get(key);
    if (!found) {
      found = this.providers[meta.provider]
        .share(meta, visibility)
        .then((ref) => formatLink(this.siteUrl, { provider: meta.provider, ref, name: meta.name }));
      found.catch(() => this.linkCache.delete(key));
      this.linkCache.set(key, found);
    }
    return found;
  }

  private drawHeader(): void {
    const accounts = h('div', { class: 'accounts' });
    const available = PROVIDER_IDS.map((id) => this.providers[id]).filter((p) => p.configured);
    for (const p of available) {
      const account = p.account();
      accounts.append(
        account
          ? h(
              'span',
              { class: `account ${p.id}`, 'data-provider': p.id },
              h('span', {
                class: 'who',
                text: `${p.label}: ${account.name}`,
                title: account.email ?? account.name,
              }),
              button('Disconnect', () => {
                if (
                  confirm(
                    `Disconnect ${p.label}? Its bins disappear from boh in this browser; nothing is deleted.`,
                  )
                ) {
                  void this.disconnect(p.id);
                }
              }),
            )
          : button(`Connect ${p.label}`, () => void this.connect(p.id), {
              class: 'connect',
              'data-provider': p.id,
            }),
      );
    }
    if (available.length === 0) {
      accounts.append(
        h('span', { class: 'muted', text: 'This build has no cloud services configured.' }),
      );
    }
    const stay = h('input', { type: 'checkbox', checked: this.local.prefs().stay, on: {} });
    stay.addEventListener('change', () => {
      this.local.setPrefs({ stay: stay.checked });
      for (const p of this.connected()) {
        p.setStay(stay.checked);
      }
    });
    this.header.replaceChildren(
      h('a', { class: 'logo', href: '#', text: 'boh' }),
      h('span', { class: 'tagline', text: 'bin of holding' }),
      accounts,
      h('label', { class: 'stay' }, stay, ' Stay signed in on this browser'),
    );
  }

  private route(): void {
    this.cleanup();
    this.main.replaceChildren();
    const hash = location.hash;
    let view: View;
    try {
      const parsed = parseFragment(hash);
      if (parsed.kind === 'paste') {
        view = (ctx, root) => viewerView(ctx, root, parsed.link, location.href);
      } else if (parsed.kind === 'newer') {
        view = (_ctx, root) => {
          root.append(
            h('p', {
              class: 'problem',
              text: 'This link needs a newer version of boh. Reload the page; if it stays, the link is from a later boh than this site.',
            }),
          );
          return () => undefined;
        };
      } else if (hash.startsWith('#bin/')) {
        const id = decodeURIComponent(hash.slice(5));
        view = (ctx, root) => binView(ctx, root, id);
      } else {
        view = homeView;
      }
    } catch (e) {
      const message = e instanceof LinkError ? e.message : String(e);
      view = (_ctx, root) => {
        root.append(
          h('p', {
            class: 'problem',
            text: `This boh link is not valid (${message}). Check that it was copied completely.`,
          }),
        );
        return () => undefined;
      };
    }
    this.cleanup = view(this, this.main);
    window.scrollTo(0, 0);
  }
}
