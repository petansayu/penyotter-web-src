// @ts-nocheck -- Node で動かすテスト用の道具なので、アプリの型の確認からは外す
// 手元だけで動くテスト用のリモート署名（NIP-46 の bunker）。使い捨ての鍵で署名する。
// 実行: node scripts/test-bunker.mjs [リレー]（既定 ws://127.0.0.1:7777。先に npm run test-relay を動かす）
//
// 表示した bunker:// を Web 版のログインの画面に貼る。鍵はメモリにだけ置き、止めると消える。
// nostrconnect:// は、http://127.0.0.1:7778/connect?uri=<nostrconnect://…> に渡すと、承認したことにして返事をする
// （署名アプリで読み取る代わり。127.0.0.1 でだけ待ち受ける）。
// connect（初回は secret が合うときだけ）・get_public_key・sign_event・ping・logout に答える。

import { finalizeEvent, generateSecretKey, getPublicKey, nip44, SimplePool } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils.js";
import { createServer } from "node:http";

export function startTestBunker(relay = "ws://127.0.0.1:7777") {
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  const secret = bytesToHex(generateSecretKey()).slice(0, 16);
  const connected = new Set();
  const pool = new SimplePool();
  const requests = [];

  const answer = async (client, id, result, error) => {
    const content = nip44.encrypt(JSON.stringify({ id, result, ...(error ? { error } : {}) }), nip44.getConversationKey(secretKey, client));
    const event = finalizeEvent({ kind: 24133, created_at: Math.floor(Date.now() / 1000), tags: [["p", client]], content }, secretKey);
    await Promise.any(pool.publish([relay], event));
  };

  const sub = pool.subscribe([relay], { kinds: [24133], "#p": [pubkey], since: Math.floor(Date.now() / 1000) - 10 }, {
    onevent: async (event) => {
      let request;
      try {
        request = JSON.parse(nip44.decrypt(event.content, nip44.getConversationKey(secretKey, event.pubkey)));
      } catch {
        return;
      }
      requests.push(request.method);
      const { id, method, params = [] } = request;
      if (method === "connect") {
        if (!connected.has(event.pubkey) && params[1] !== secret) return answer(event.pubkey, id, "", "secret が違います");
        connected.add(event.pubkey);
        return answer(event.pubkey, id, "ack");
      }
      if (!connected.has(event.pubkey)) return answer(event.pubkey, id, "", "connect していません");
      if (method === "ping") return answer(event.pubkey, id, "pong");
      if (method === "get_public_key") return answer(event.pubkey, id, pubkey);
      if (method === "logout") {
        connected.delete(event.pubkey);
        return answer(event.pubkey, id, "ack");
      }
      if (method === "sign_event") {
        const template = JSON.parse(params[0]);
        const signed = finalizeEvent({ kind: template.kind, created_at: template.created_at, tags: template.tags, content: template.content }, secretKey);
        return answer(event.pubkey, id, JSON.stringify(signed));
      }
      return answer(event.pubkey, id, "", `${method} には答えません`);
    },
  });

  /** nostrconnect:// を受け取り、承認したことにして返事をする（result に secret を入れる）。 */
  const acceptNostrConnect = async (uri) => {
    const url = new URL(uri.replace(/^nostrconnect:\/\//, "https://"));
    const client = url.hostname;
    const connectSecret = url.searchParams.get("secret");
    if (!/^[0-9a-f]{64}$/.test(client) || !connectSecret) throw new Error("nostrconnect:// の形が正しくない");
    if (!url.searchParams.getAll("relay").includes(relay)) throw new Error(`テスト用のリレー（${relay}）が入っていない`);
    connected.add(client);
    await answer(client, Math.random().toString(36).slice(2), connectSecret);
  };

  return {
    pubkey,
    acceptNostrConnect,
    uri: `bunker://${pubkey}?relay=${encodeURIComponent(relay)}&secret=${secret}`,
    requests,
    close: () => {
      sub.close();
      pool.close([relay]);
    },
  };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/").replace(/^\//, "")}`) {
  const bunker = startTestBunker(process.argv[2]);
  console.log("テスト用の bunker（止めると鍵は消えます）:");
  console.log(bunker.uri);
  createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/connect") return response.writeHead(404).end();
    try {
      await bunker.acceptNostrConnect(url.searchParams.get("uri") ?? "");
      response.writeHead(200).end("ok");
    } catch (e) {
      response.writeHead(400).end(String(e?.message ?? e));
    }
  }).listen(7778, "127.0.0.1", () => console.log("nostrconnect:// の受け口: http://127.0.0.1:7778/connect?uri=…"));
}
