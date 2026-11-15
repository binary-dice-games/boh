// MIT License © 2026 Binary Dice Games
/**
 * @file The stand-in for a provider this build leaves out (see `providers` in the build
 * configuration): not configured, never signed in, and every call refused with
 * `ProviderError('not_configured')`. The real module is not bundled.
 */
import { ProviderError } from '../errors';
import { PROVIDER_LABELS, type Provider, type ProviderId } from './provider';

/** A provider that this build does not offer. */
export function createDisabledProvider(id: ProviderId): Provider {
  const label = PROVIDER_LABELS[id];
  const refuse = () =>
    Promise.reject(new ProviderError('not_configured', `${label} is not available on this site`));
  return {
    id,
    label,
    configured: false,
    maxUploadBytes: 0,
    capabilities: { tags: false, binLinks: false },
    signIn: refuse,
    signOut: () => Promise.resolve(),
    account: () => null,
    setStay: () => undefined,
    readConfig: refuse,
    writeConfig: refuse,
    createFolder: refuse,
    describeSharing: refuse,
    list: refuse,
    upload: refuse,
    setTags: refuse,
    share: refuse,
    remove: refuse,
    openRef: refuse,
    fetch: refuse,
    folderUrl: () => undefined,
  };
}
