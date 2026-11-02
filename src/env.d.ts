/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** テストモードのリレー（.env.testrelay）。本番用のビルドでは使わない。 */
  readonly VITE_TEST_RELAY?: string;
  readonly VITE_TEST_BLOSSOM?: string;
}

/** 画面に出す版。ビルドした日（日本時間）とコミット（vite.config.ts の buildVersion）。 */
declare const __APP_VERSION__: string;
