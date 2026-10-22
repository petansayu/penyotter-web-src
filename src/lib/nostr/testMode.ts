/**
 * テストモード（開発用のサーバーを `npm run dev:test` で起動したときだけ）。
 *
 * - 読み書きの先を手元のテスト用リレー（scripts/test-relay.mjs）だけにする。
 * - それ以外のリレーへはイベントを送らない（RelayPool.publish が止める）。
 * - 使い捨ての鍵で署名する偽の NIP-07 を入れる（devSigner.ts）。
 *
 * 本番用のビルドでは import.meta.env.DEV が false なので、TEST_RELAY は null になり、関係するコードは入らない。
 */
export const TEST_RELAY: string | null = import.meta.env.DEV ? (import.meta.env.VITE_TEST_RELAY ?? null) : null;
