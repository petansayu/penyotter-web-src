// @ts-nocheck -- Node で動かすテスト用の道具なので、アプリの型の確認からは外す
// 手元だけで動くテスト用のリレー。署名と投稿を、公開のリレーに送らずに確かめるために使う。
// 実行: node scripts/test-relay.mjs [ポート] [--auth]（既定 7777）→ ws://127.0.0.1:<ポート>
// --auth を付けると、つないだときに AUTH（NIP-42）を送り、認証するまで REQ と EVENT を断る（auth-required:）。
//
// イベントはメモリにだけ置き、止めると消える。127.0.0.1 でだけ待ち受ける（ほかの機械からはつなげない）。
// REQ・CLOSE・EVENT（OK を返す）・COUNT（NIP-45）だけに答える。署名と ID が正しくないイベントは受け取らない。

import { WebSocketServer } from "ws";
import { matchFilters, verifyEvent } from "nostr-tools";

export function startTestRelay(port = 7777, options = {}) {
  const requireAuth = options.auth === true;
  const url = `ws://127.0.0.1:${port}`;
  const events = new Map();
  const subscriptions = new Map(); // socket → Map<id, filters>
  const server = new WebSocketServer({ host: "127.0.0.1", port });

  const replaceable = (kind) => kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000);
  const addressable = (kind) => kind >= 30000 && kind < 40000;
  const dTag = (event) => event.tags.find((tag) => tag[0] === "d")?.[1] ?? "";

  function store(event) {
    // 置き換え可能なイベントは、同じ作者（とd）の古いものを消す
    for (const [id, old] of events) {
      if (old.pubkey !== event.pubkey || old.kind !== event.kind) continue;
      if (!replaceable(event.kind) && !(addressable(event.kind) && dTag(old) === dTag(event))) continue;
      if (old.created_at > event.created_at) return false;
      events.delete(id);
    }
    events.set(event.id, event);
    return true;
  }

  server.on("connection", (socket) => {
    subscriptions.set(socket, new Map());
    const send = (message) => socket.send(JSON.stringify(message));
    const challenge = Math.random().toString(36).slice(2);
    let authed = !requireAuth;
    if (requireAuth) send(["AUTH", challenge]);
    socket.on("message", (data) => {
      let message;
      try {
        message = JSON.parse(String(data));
      } catch {
        return send(["NOTICE", "invalid: JSON ではない"]);
      }
      const [type, ...rest] = message;
      if (type === "AUTH") {
        const event = rest[0];
        const tag = (name) => event?.tags?.find((t) => t[0] === name)?.[1];
        const fresh = Math.abs(Math.floor(Date.now() / 1000) - (event?.created_at ?? 0)) < 600;
        const ok = event && event.kind === 22242 && verifyEvent(event) && tag("challenge") === challenge && tag("relay") === url && fresh;
        if (ok) authed = true;
        return send(["OK", event?.id ?? "", !!ok, ok ? "" : "invalid: 認証のイベントが正しくない"]);
      }
      if (!authed && type === "EVENT") return send(["OK", rest[0]?.id ?? "", false, "auth-required: 先に認証してください"]);
      if (!authed && type === "REQ") return send(["CLOSED", rest[0], "auth-required: 先に認証してください"]);
      if (type === "EVENT") {
        const event = rest[0];
        if (!event || typeof event !== "object" || !verifyEvent(event)) return send(["OK", event?.id ?? "", false, "invalid: 署名が正しくない"]);
        const stored = store(event);
        send(["OK", event.id, true, stored ? "" : "duplicate: 新しい版がある"]);
        if (!stored) return;
        for (const [other, subs] of subscriptions) {
          for (const [id, filters] of subs) if (matchFilters(filters, event)) other.send(JSON.stringify(["EVENT", id, event]));
        }
      } else if (type === "REQ") {
        const [id, ...filters] = rest;
        subscriptions.get(socket).set(id, filters);
        const matched = [...events.values()].filter((event) => matchFilters(filters, event)).sort((a, b) => b.created_at - a.created_at);
        const limit = Math.min(...filters.map((filter) => filter.limit ?? Infinity));
        for (const event of matched.slice(0, Number.isFinite(limit) ? limit : undefined)) send(["EVENT", id, event]);
        send(["EOSE", id]);
      } else if (type === "COUNT") {
        const [id, ...filters] = rest;
        send(["COUNT", id, { count: [...events.values()].filter((event) => matchFilters(filters, event)).length }]);
      } else if (type === "CLOSE") {
        subscriptions.get(socket).delete(rest[0]);
      }
    });
    socket.on("close", () => subscriptions.delete(socket));
  });

  return {
    url,
    events,
    close: () => new Promise((resolve) => {
      for (const socket of subscriptions.keys()) socket.terminate();
      server.close(() => resolve());
    }),
    ready: new Promise((resolve) => server.on("listening", resolve)),
  };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/").replace(/^\//, "")}`) {
  const args = process.argv.slice(2);
  const port = Number(args.find((arg) => /^\d+$/.test(arg)) ?? 7777);
  const relay = startTestRelay(port, { auth: args.includes("--auth") });
  await relay.ready;
  console.log(`テスト用のリレー: ${relay.url}（止めるとイベントは消えます${args.includes("--auth") ? "。認証（NIP-42）を求めます" : ""}）`);
}
