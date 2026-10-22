// @ts-nocheck -- Node で動かすテスト用の道具なので、アプリの型の確認からは外す
// 手元だけで動くテスト用の画像の投稿先（Blossom、BUD-02 の PUT /upload と GET /<ハッシュ>）。公開の投稿先に送らずに、
// 画像の投稿を確かめるために使う。
// 実行: node scripts/test-blossom.mjs [ポート]（既定 7779）→ http://127.0.0.1:<ポート>
//
// ファイルはメモリにだけ置き、止めると消える。127.0.0.1 でだけ待ち受ける。認可（kind 24242）の署名・t・x・期限を確かめる。

import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { verifyEvent } from "nostr-tools";

export function startTestBlossom(port = 7779) {
  const origin = `http://127.0.0.1:${port}`;
  const files = new Map(); // ハッシュ → { type, body }
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-SHA-256",
    "Access-Control-Expose-Headers": "X-Reason",
  };
  const refuse = (res, status, reason) => {
    res.writeHead(status, { ...cors, "X-Reason": reason });
    res.end();
  };

  const server = createServer((req, res) => {
    if (req.method === "OPTIONS") return res.writeHead(204, cors), res.end();
    const path = new URL(req.url, origin).pathname;
    if (req.method === "GET") {
      const file = files.get(path.slice(1).split(".")[0]);
      if (!file) return refuse(res, 404, "not found");
      res.writeHead(200, { ...cors, "Content-Type": file.type });
      return res.end(file.body);
    }
    if (req.method !== "PUT" || path !== "/upload") return refuse(res, 404, "not found");
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const sha256 = createHash("sha256").update(body).digest("hex");
      let auth;
      try {
        auth = JSON.parse(Buffer.from((req.headers.authorization ?? "").replace(/^Nostr /, ""), "base64").toString("utf8"));
      } catch {
        return refuse(res, 401, "missing auth");
      }
      const tag = (name) => auth?.tags?.find((t) => t[0] === name)?.[1];
      const now = Math.floor(Date.now() / 1000);
      if (!auth || auth.kind !== 24242 || !verifyEvent(auth)) return refuse(res, 401, "invalid auth event");
      if (tag("t") !== "upload" || tag("x") !== sha256) return refuse(res, 401, "auth does not match the file");
      if (!(Number(tag("expiration")) > now)) return refuse(res, 401, "auth expired");
      const type = req.headers["content-type"] ?? "application/octet-stream";
      files.set(sha256, { type, body });
      const ext = type.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
      console.log(`受け取りました ${sha256.slice(0, 12)}… ${type} ${body.length} バイト（${auth.pubkey.slice(0, 12)}…）`);
      res.writeHead(200, { ...cors, "Content-Type": "application/json" });
      res.end(JSON.stringify({ url: `${origin}/${sha256}.${ext}`, sha256, size: body.length, type, uploaded: now }));
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ origin, files, close: () => server.close() })));
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("test-blossom.mjs")) {
  const port = Number(process.argv[2] ?? 7779);
  startTestBlossom(port).then(({ origin }) => console.log(`テスト用の画像の投稿先: ${origin}（止めるとファイルは消えます）`));
}
