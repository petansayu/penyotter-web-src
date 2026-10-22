import { clearScope } from "./db";
import { readRelaySetting, saveRelaySetting } from "./relaySettings";

/**
 * グローバルで読むリレー（技術資料 4.1。Android 版の AccountSettings.globalRelays）。このブラウザだけに保存し、
 * kind 10002 には載せない。空なら、購読は常時接続リレー、さかのぼりは読み込みリレー全部。
 */

/** 日本のリレーの例（Android 版の GlobalRelaySuggestions。画面が日本語のときだけ出す）。 */
export const GLOBAL_RELAY_SUGGESTIONS = ["wss://yabu.me", "wss://relay-jp.nostr.wirednet.jp", "wss://r.kojira.io"];

export const globalRelays = (pubkey: string | null) => readRelaySetting("global-relays", pubkey, []);

/** 保存する。前と変わったら、前のリレーの投稿が一覧の下に残らないよう、グローバルの保存分を消す。 */
export async function saveGlobalRelays(pubkey: string, text: string) {
  const before = globalRelays(pubkey).join(" ");
  const result = saveRelaySetting("global-relays", pubkey, text);
  if (result.ok && result.relays.join(" ") !== before) await clearScope(pubkey, "global");
  return result;
}
