// MIT License © 2026 Binary Dice Games
/**
 * @file The build configuration, injected by `scripts/build-web.mjs` (see `scripts/config.mjs`):
 * public client ids and the providers' endpoints.
 */

/** The configuration of one build. Every value is public. */
export interface BohConfig {
  google: {
    clientId: string;
    apiKey: string;
    appId: string;
    authUrl: string;
    apiBase: string;
    revokeUrl: string;
    pickerScript: string;
    testPicker: boolean;
  };
  dropbox: {
    appKey: string;
    authUrl: string;
    apiBase: string;
    contentBase: string;
    rawBase: string;
  };
  microsoft: {
    clientId: string;
    authority: string;
    graphBase: string;
    downloadHosts: string[];
  };
}

declare const __BOH_CONFIG__: BohConfig;

/** The configuration this page was built with. */
export function buildConfig(): BohConfig {
  return __BOH_CONFIG__;
}
