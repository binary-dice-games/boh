// MIT License © 2026 Binary Dice Games
export interface BuildConfig {
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
  [P in keyof BuildConfig]?: Partial<BuildConfig[P]>;
};
export const DEFAULT_CONFIG: BuildConfig;
export function resolveConfig(
  overrides?: ConfigOverrides,
  env?: Record<string, string | undefined>,
  file?: string,
): BuildConfig;
