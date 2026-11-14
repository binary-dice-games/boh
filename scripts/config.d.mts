// MIT License © 2026 Binary Dice Games
export type ProviderId = 'gd' | 'db' | 'od';
export interface BuildConfig {
  providers: ProviderId[];
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
export type ConfigOverrides = {
  [P in Exclude<keyof BuildConfig, 'providers'>]?: Partial<BuildConfig[P]>;
} & { providers?: ProviderId[] };
export const PROVIDER_IDS: ProviderId[];
export const DEFAULT_CONFIG: BuildConfig;
export function resolveConfig(
  overrides?: ConfigOverrides,
  env?: Record<string, string | undefined>,
  file?: string,
): BuildConfig;
