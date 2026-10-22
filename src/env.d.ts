/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** テストモードのリレー（.env.testrelay）。本番用のビルドでは使わない。 */
  readonly VITE_TEST_RELAY?: string;
  readonly VITE_TEST_BLOSSOM?: string;
}

/** アプリの版（package.json の version）と、ビルドした日（vite.config.ts の define）。 */
declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;
