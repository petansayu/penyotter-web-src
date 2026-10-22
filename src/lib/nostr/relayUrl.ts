import { TEST_RELAY } from "./testMode";

/**
 * リレーの URL を揃える。`wss://` だけを受け付け、ユーザー名・パスワード入りや `#` の付いたものは null。末尾の `/` は取る。
 * Android 版の技術資料 4.1 と同じ。
 */
export function normalizeRelay(raw: string): string | null {
  const value = raw.trim();
  // テストモードの手元のリレー（ws://127.0.0.1）だけは通す
  if (TEST_RELAY && value === TEST_RELAY) return value;
  if (!/^wss:\/\//i.test(value) || value.length > 512) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "wss:" || url.username || url.password || url.hash || !url.hostname) return null;
  const path = url.pathname.replace(/\/+$/, "");
  return `wss://${url.host.toLowerCase()}${path}${url.search}`;
}

/**
 * 相手のリストやヒントから来たリレーで、つないでよいもの。localhost・プライベートアドレス・IP アドレス・`.local`・
 * ドットのない名前は使わない（相手のリストでブラウザを家のネットワークへ向けさせないため。技術資料 4.4.1・5.2）。
 */
export function publicRelay(raw: string): string | null {
  const url = normalizeRelay(raw);
  if (!url) return null;
  const host = new URL(url).hostname.toLowerCase();
  if (!host.includes(".") || host.startsWith("[")) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return null;
  return url;
}

/** 重複と不正なものを除いて、先頭から max 件。 */
export function relaySet(urls: Iterable<string>, max = Infinity, check: (url: string) => string | null = normalizeRelay): string[] {
  const result: string[] = [];
  for (const raw of urls) {
    const url = check(raw);
    if (url && !result.includes(url)) result.push(url);
    if (result.length >= max) break;
  }
  return result;
}
