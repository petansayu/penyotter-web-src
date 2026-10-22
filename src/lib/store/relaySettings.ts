import { normalizeRelay, relaySet } from "../nostr/relayUrl";

/** 見る人ごとに、このブラウザに保存するリレーの一覧（検索リレー・グローバルで読むリレー）。12 件まで。 */

const MAX_RELAYS = 12;

export function readRelaySetting(name: string, pubkey: string | null, fallback: string[]): string[] {
  if (!pubkey) return fallback;
  try {
    const saved = JSON.parse(localStorage.getItem(`${name}.${pubkey}`) ?? "null");
    if (Array.isArray(saved)) return relaySet(saved.filter((url) => typeof url === "string"), MAX_RELAYS);
  } catch {
    // 保存がなければ最初の値
  }
  return fallback;
}

/** 1 行に 1 件の文字から保存する。wss:// でない行があれば、その行を返して保存しない。 */
export function saveRelaySetting(name: string, pubkey: string, text: string): { ok: true; relays: string[] } | { ok: false; line: string } {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) if (!normalizeRelay(line)) return { ok: false, line };
  const relays = relaySet(lines, MAX_RELAYS);
  try {
    localStorage.setItem(`${name}.${pubkey}`, JSON.stringify(relays));
  } catch {
    // 保存できなくてもこの間は使える
  }
  return { ok: true, relays };
}
