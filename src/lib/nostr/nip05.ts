import { isHex64 } from "./events";

/**
 * NIP-05 の確認（技術資料 10.5）。`https://<ドメイン>/.well-known/nostr.json?name=<名前>` を読み、名前の公開鍵を返す。
 * リダイレクトはたどらず、応答は 256KB まで、10 秒で打ち切る。名前は小文字の英数字と `_`・`.`・`-`。
 * Web 版だけ: ブラウザでは名前を引いた先の IP アドレスを確かめられないので、IP アドレスそのもの・localhost・
 * `.local`・`.localhost` のドメインには問い合わせない。
 */

export function parseNip05(raw: string): { name: string; domain: string } | null {
  const value = raw.trim().toLowerCase();
  const at = value.lastIndexOf("@");
  const name = at >= 0 ? value.slice(0, at) : "_";
  const host = at >= 0 ? value.slice(at + 1) : value;
  if (!/^[a-z0-9_.-]+$/.test(name)) return null;
  let domain: string;
  try {
    domain = new URL(`https://${host}`).hostname;
  } catch {
    return null;
  }
  if (!domain.includes(".") || domain === "localhost" || /\.(local|localhost)$/.test(domain)) return null;
  if (/^\d+(\.\d+){3}$/.test(domain) || domain.startsWith("[")) return null;
  if (`https://${host}` !== `https://${domain}`) return null;
  return { name, domain };
}

export async function resolveNip05(raw: string): Promise<string | null> {
  const parsed = parseNip05(raw);
  if (!parsed) throw new Error("NIP-05 の形を確かめられません");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`https://${parsed.domain}/.well-known/nostr.json?name=${encodeURIComponent(parsed.name)}`, {
      redirect: "error", signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error(`応答 ${response.status}`);
    const text = await readLimited(response, 256 * 1024);
    const names = (JSON.parse(text) as { names?: Record<string, unknown> }).names;
    const pubkey = names?.[parsed.name];
    return typeof pubkey === "string" && isHex64(pubkey.toLowerCase()) ? pubkey.toLowerCase() : null;
  } finally {
    clearTimeout(timer);
  }
}

async function readLimited(response: Response, max: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      void reader.cancel();
      throw new Error("応答が大きすぎます");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(all);
}
