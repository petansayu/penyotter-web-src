import type { Filter } from "./events";

/**
 * 件数（NIP-45 の COUNT、技術資料 4.6）。フォロワー数だけに使う。リレーそれぞれに専用の接続を開き、5 秒で打ち切る。
 * 答えたリレーのうちいちばん大きい数を使い、どれかが approximate を返したらおよその数とする。どこも答えなければ null。
 */
export async function count(relays: string[], filter: Filter, limit = 5000): Promise<{ count: number; approximate: boolean } | null> {
  const answers = await Promise.all(relays.map((url) => countOne(url, filter, limit)));
  const got = answers.filter((a): a is { count: number; approximate: boolean } => a !== null);
  if (got.length === 0) return null;
  return { count: Math.max(...got.map((a) => a.count)), approximate: got.some((a) => a.approximate) };
}

function countOne(url: string, filter: Filter, limit: number): Promise<{ count: number; approximate: boolean } | null> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      return resolve(null);
    }
    const id = `count-${Math.random().toString(36).slice(2, 10)}`;
    let settled = false;
    const done = (value: { count: number; approximate: boolean } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // 閉じられなくてもよい
      }
      resolve(value);
    };
    const timer = setTimeout(() => done(null), limit);
    ws.onopen = () => ws.send(JSON.stringify(["COUNT", id, filter]));
    ws.onmessage = (message) => {
      try {
        const data = JSON.parse(String(message.data));
        if (!Array.isArray(data) || data[1] !== id) return;
        if (data[0] === "COUNT" && typeof data[2]?.count === "number" && Number.isInteger(data[2].count) && data[2].count >= 0) {
          done({ count: data[2].count, approximate: data[2].approximate === true });
        } else if (data[0] === "CLOSED") done(null);
      } catch {
        // 読めない知らせは使わない
      }
    };
    ws.onerror = () => done(null);
    ws.onclose = () => done(null);
  });
}
