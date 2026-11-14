// MIT License © 2026 Binary Dice Games
/**
 * @file Google's Picker, the only way a `drive.file` app may see a folder or file it did not
 * create. The real one loads Google's script; test builds (`google.testPicker`) use a stand-in
 * that asks with `window.prompt` and grants through the fake Drive.
 */
import type { BohConfig } from '../config';
import { ProviderError } from '../errors';

/** What the picker returns: the chosen item, or `null` when cancelled. */
export type Picked = { id: string; name: string } | null;

/** What to pick: a folder, or one given file (to grant boh access to it). */
export type PickRequest = { kind: 'folder' } | { kind: 'file'; fileId: string };

/** A picker. */
export interface GooglePicker {
  /**
   * Shows the picker.
   * @param token the user's access token
   * @throws {ProviderError} `network` when the picker cannot be loaded
   */
  pick(request: PickRequest, token: string): Promise<Picked>;
}

/* Google's Picker API is untyped here: only the calls below are used. */
/* eslint-disable @typescript-eslint/no-explicit-any */
type PickerWindow = Window & { gapi?: any; google?: any };

let loading: Promise<void> | undefined;

function loadPickerApi(src: string): Promise<void> {
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => {
      const w = window as PickerWindow;
      w.gapi.load('picker', { callback: () => resolve() });
    };
    script.onerror = () => {
      loading = undefined;
      reject(new ProviderError('network', 'Google Picker could not be loaded'));
    };
    document.head.append(script);
  });
  return loading;
}

/** The real Google Picker. */
export function createGooglePicker(config: BohConfig['google']): GooglePicker {
  return {
    async pick(request, token) {
      await loadPickerApi(config.pickerScript);
      const g = (window as PickerWindow).google.picker;
      const view =
        request.kind === 'folder'
          ? new g.DocsView(g.ViewId.FOLDERS)
              .setIncludeFolders(true)
              .setSelectFolderEnabled(true)
              .setMimeTypes('application/vnd.google-apps.folder')
          : new g.DocsView(g.ViewId.DOCS).setFileIds(request.fileId).setMode(g.DocsViewMode.LIST);
      return new Promise<Picked>((resolve) => {
        const picker = new g.PickerBuilder()
          .addView(view)
          .setOAuthToken(token)
          .setDeveloperKey(config.apiKey)
          .setAppId(config.appId)
          .setCallback((data: any) => {
            if (data.action === g.Action.PICKED) {
              const doc = data.docs?.[0];
              resolve(doc ? { id: String(doc.id), name: String(doc.name) } : null);
            } else if (data.action === g.Action.CANCEL) {
              resolve(null);
            }
          })
          .build();
        picker.setVisible(true);
      });
    },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The test builds' picker: prompts for an id and grants it through the fake Drive. */
export function createTestPicker(config: BohConfig['google']): GooglePicker {
  return {
    async pick(request, token) {
      const id =
        request.kind === 'folder'
          ? window.prompt('Folder id')
          : window.confirm(`Let boh open ${request.fileId}?`)
            ? request.fileId
            : null;
      if (!id) {
        return null;
      }
      const res = await fetch(`${config.apiBase}/__picker`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        return null;
      }
      return (await res.json()) as Picked;
    },
  };
}
