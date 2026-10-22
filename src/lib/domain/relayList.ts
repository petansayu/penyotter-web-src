import type { EventTemplate } from "nostr-tools";
import type { Event } from "../nostr/events";
import { normalizeRelay } from "../nostr/relayUrl";
import { nextCreatedAt } from "./lists";

/**
 * 自分のリレーリスト（NIP-65、kind 10002）の編集（技術資料 4.1・4.1.1）。読み込み・書き込みはそれぞれ 1〜12 件。
 * `r` タグは、両方なら `["r", URL]`、片方だけなら `["r", URL, "read"]`・`["r", URL, "write"]`。前の版の `r` 以外の
 * タグと content は、ほかのアプリの情報なので残す。
 */

export interface RelayEntry {
  url: string;
  read: boolean;
  write: boolean;
}

export const MAX_EACH = 12;

/** リレーリストの `r` タグを、編集できる形にする（同じ URL はまとめる）。 */
export function relayEntries(event: Event | undefined): RelayEntry[] {
  const entries: RelayEntry[] = [];
  for (const tag of event?.tags ?? []) {
    if (tag[0] !== "r" || !tag[1]) continue;
    const marker = tag[2];
    if (marker && marker !== "read" && marker !== "write") continue;
    const url = normalizeRelay(tag[1]);
    if (!url) continue;
    const entry = entries.find((e) => e.url === url) ?? (entries.push({ url, read: false, write: false }), entries[entries.length - 1]);
    if (marker !== "write") entry.read = true;
    if (marker !== "read") entry.write = true;
  }
  return entries;
}

/** 公開できない理由（なければ null）。 */
export function relayProblem(entries: RelayEntry[]): string | null {
  for (const entry of entries) if (!normalizeRelay(entry.url)) return `wss:// で始まるリレーにしてください（${entry.url}）`;
  const read = entries.filter((e) => e.read).length;
  const write = entries.filter((e) => e.write).length;
  if (read === 0) return "読み込みリレーを 1 件以上にしてください";
  if (write === 0) return "書き込みリレーを 1 件以上にしてください";
  if (read > MAX_EACH) return `読み込みリレーは ${MAX_EACH} 件までです`;
  if (write > MAX_EACH) return `書き込みリレーは ${MAX_EACH} 件までです`;
  return null;
}

/** 次の版。読みも書きもしないリレーは載せない。 */
export function buildRelayList(base: Event | undefined, entries: RelayEntry[], now: number): EventTemplate {
  const problem = relayProblem(entries);
  if (problem) throw new Error(problem);
  const kept = (base?.tags ?? []).filter((tag) => tag[0] !== "r").map((tag) => [...tag]);
  const seen = new Set<string>();
  const relays: string[][] = [];
  for (const entry of entries) {
    const url = normalizeRelay(entry.url)!;
    if (seen.has(url) || (!entry.read && !entry.write)) continue;
    seen.add(url);
    relays.push(entry.read && entry.write ? ["r", url] : ["r", url, entry.read ? "read" : "write"]);
  }
  return { kind: 10002, created_at: nextCreatedAt(now, base), tags: [...relays, ...kept], content: base?.content ?? "" };
}

export interface RelayChange {
  url: string;
  before: string;
  after: string;
}

const role = (entry: RelayEntry | undefined) => (!entry || (!entry.read && !entry.write) ? "なし" : entry.read && entry.write ? "読み書き" : entry.read ? "読み込み" : "書き込み");

/** 前と後の違い（URL ごと）。 */
export function relayChanges(before: RelayEntry[], after: RelayEntry[]): RelayChange[] {
  const urls = [...new Set([...before.map((e) => e.url), ...after.map((e) => e.url)])];
  return urls
    .map((url) => ({ url, before: role(before.find((e) => e.url === url)), after: role(after.find((e) => e.url === url)) }))
    .filter((change) => change.before !== change.after);
}
