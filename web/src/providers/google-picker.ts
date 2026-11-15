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

/**
 * What to pick: a folder (the user's own, those shared with them, or one given folder to grant boh
 * access to it), or one given file (to grant boh access to it).
 */
export type PickRequest =
  { kind: 'folder'; shared?: boolean; folderId?: string } | { kind: 'file'; fileId: string };

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
      const folders = () =>
        new g.DocsView(g.ViewId.FOLDERS)
          .setIncludeFolders(true)
          .setSelectFolderEnabled(true)
          .setMimeTypes('application/vnd.google-apps.folder');
      const views =
        request.kind === 'file'
          ? [new g.DocsView(g.ViewId.DOCS).setFileIds(request.fileId).setMode(g.DocsViewMode.LIST)]
          : request.folderId
            ? [folders().setFileIds(request.folderId).setMode(g.DocsViewMode.LIST)]
            : request.shared
              ? [folders().setOwnedByMe(false), folders().setEnableDrives(true)]
              : [folders()];
      return new Promise<Picked>((resolve) => {
        const builder = new g.PickerBuilder();
        for (const view of views) {
          builder.addView(view);
        }
        const picker = builder
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
      const given = request.kind === 'file' ? request.fileId : request.folderId;
      const id = given
        ? window.confirm(`Let boh open ${given}?`)
          ? given
          : null
        : window.prompt(
            request.kind === 'folder' && request.shared ? 'Shared folder id' : 'Folder id',
          );
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
