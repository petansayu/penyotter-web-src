/**
 * 画像・動画の投稿（Android 版の Blossom・ImageAttachments・PostBuilder の NIP-92）。アップロードした URL は本文の
 * 後ろに改行区切りで足し、`imeta` タグに種類・ハッシュ・大きさを書く。
 */

export interface Attachment {
  url: string;
  /** MIME の種類。 */
  type: string;
  /** 保存されたファイルの SHA-256（16 進）。 */
  sha256: string;
  size?: number;
  /** 画像の大きさ（幅 x 高さ）。 */
  dim?: string;
}

/** 1 つの投稿に付けられる数（Android 版と同じ）。 */
export const MAX_ATTACHMENTS = 4;

/** 画像の投稿先の候補（Android 版の BlossomSettings.DESTINATIONS と同じ）。NIP-96 のものは nip96。 */
export const UPLOAD_SERVERS: { url: string; label: string; nip96?: boolean }[] = [
  { url: "https://blossom.band", label: "blossom.band（おすすめ）" },
  { url: "https://cdn.nostr.build", label: "cdn.nostr.build" },
  { url: "https://blossom.primal.net", label: "blossom.primal.net" },
  { url: "https://nostrcheck.me", label: "nostrcheck.me（NIP-96）", nip96: true },
  { url: "https://nostr.build", label: "nostr.build（NIP-96）", nip96: true },
  { url: "https://files.sovbit.host", label: "files.sovbit.host（NIP-96）", nip96: true },
  { url: "https://nostpic.com", label: "nostpic.com（NIP-96）", nip96: true },
  { url: "https://yabu.me", label: "yabu.me（NIP-96）", nip96: true },
];
/** NIP-96 で送る投稿先か（候補にあるものだけ。ほかは Blossom とみなす。Android 版と同じ）。 */
export const isNip96 = (server: string) => UPLOAD_SERVERS.some((s) => s.url === server && s.nip96);
export const DEFAULT_UPLOAD_SERVER = UPLOAD_SERVERS[0].url;

/** 投稿先の URL を揃える（https のオリジンだけ）。だめなら null。test は手元のテスト用サーバー（http）を通すとき。 */
export function normalizeServer(raw: string, test: string | null = null): string | null {
  const value = raw.trim().replace(/\/+$/, "");
  if (test && value === test) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * アップロードの応答を確かめる（Android 版の Blossom と同じ）。URL は https（テストでは手元のサーバー）で、投稿先と
 * 同じサーバー（サブドメインを含む）にあり、URL に応答のハッシュが入っていること。サーバーが画像を変換して別の
 * ハッシュで返すこと（blossom.band）があるので、ハッシュは応答のものを使う。
 */
export function checkUploadResponse(server: string, raw: unknown, sentType: string, sentSize: number): Attachment {
  if (typeof raw !== "object" || raw === null) throw new Error("投稿先の応答を読めませんでした");
  const body = raw as Record<string, unknown>;
  const url = typeof body.url === "string" ? body.url : "";
  const sha256 = typeof body.sha256 === "string" ? body.sha256.toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("投稿先の応答にハッシュがありません");
  let parsed: URL;
  let host: string;
  try {
    parsed = new URL(url);
    host = new URL(server).hostname;
  } catch {
    throw new Error("投稿先の応答に画像の URL がありません");
  }
  const sameServer = parsed.hostname === host || parsed.hostname.endsWith(`.${host}`);
  const secure = parsed.protocol === "https:" || parsed.origin === new URL(server).origin;
  if (!secure || !sameServer) throw new Error("投稿先の応答の URL が、投稿先のサーバーのものではありません");
  if (!parsed.pathname.toLowerCase().includes(sha256)) throw new Error("投稿先の応答の URL に、ファイルのハッシュが入っていません");
  const type = typeof body.type === "string" && body.type ? body.type : sentType;
  const size = typeof body.size === "number" ? body.size : sentSize;
  return { url, type, sha256, size };
}

/** 本文の後ろに URL を足す（改行区切り）。 */
export function withAttachments(body: string, attachments: Attachment[]): string {
  if (attachments.length === 0) return body;
  const urls = attachments.map((a) => a.url).join("\n");
  return body.trim() ? `${body.trimEnd()}\n${urls}` : urls;
}

/** NIP-92 の imeta タグ。 */
export function imetaTags(attachments: Attachment[]): string[][] {
  return attachments.map((a) => ["imeta", `url ${a.url}`, `m ${a.type}`, `x ${a.sha256}`, ...(a.size ? [`size ${a.size}`] : []), ...(a.dim ? [`dim ${a.dim}`] : [])]);
}

/** Blossom の認可（BUD-02、kind 24242）の中身。5 分で切れる。 */
export function uploadAuth(sha256: string, name: string, now: number, server?: string) {
  const host = server ? new URL(server).hostname : null;
  return {
    kind: 24242,
    created_at: now,
    tags: [["t", "upload"], ["x", sha256], ["expiration", String(now + 300)], ...(host ? [["server", host]] : [])],
    content: `Upload ${name}`.slice(0, 200),
  };
}

/** NIP-98 の認可（kind 27235）。NIP-96 のアップロードで使う。 */
export const nip96Auth = (api: string, sha256: string, now: number) =>
  ({ kind: 27235, created_at: now, tags: [["u", api], ["method", "POST"], ["payload", sha256]], content: "" });

/** NIP-96 の応答（nip94_event のタグ）を読む。 */
export function checkNip96Response(raw: unknown, sentType: string, sentSize: number, sentHash: string): Attachment {
  const body = (raw ?? {}) as { status?: unknown; message?: unknown; nip94_event?: { tags?: unknown } };
  if (body.status === "error") throw new Error(typeof body.message === "string" ? body.message.slice(0, 200) : "アップロードに失敗しました");
  const tags = Array.isArray(body.nip94_event?.tags) ? (body.nip94_event!.tags as unknown[]).filter((t): t is string[] => Array.isArray(t) && typeof t[0] === "string") : [];
  const value = (name: string) => tags.find((t) => t[0] === name)?.[1];
  const url = value("url");
  if (!url || !url.startsWith("https://")) throw new Error("応答に画像URLがありません");
  const x = (value("x") ?? value("ox") ?? sentHash).toLowerCase();
  const size = Number(value("size"));
  return { url, type: value("m") || sentType, sha256: /^[0-9a-f]{64}$/.test(x) ? x : sentHash, size: Number.isFinite(size) && size > 0 ? size : sentSize, ...(value("dim") ? { dim: value("dim") } : {}) };
}

/** 画像のメタデータ（NIP-94、kind 1063）。 */
export function buildFileMetadata(a: Attachment, now: number) {
  const tags = [["url", a.url], ["m", a.type], ["x", a.sha256]];
  if (a.size) tags.push(["size", String(a.size)]);
  if (a.dim) tags.push(["dim", a.dim]);
  return { kind: 1063, created_at: now, tags, content: "" };
}

/** 画像・動画の投稿（NIP-68・NIP-71、kind 20・21・22）。content は説明文。 */
export const MEDIA_POST_KINDS = [20, 21, 22] as const;
export function buildMediaPost(kind: number, description: string, media: Attachment[], now: number, expiresAfter?: number | null) {
  if (![20, 21, 22, 34235, 34236].includes(kind) || media.length === 0) throw new Error("画像・動画を付けてください");
  const tags: string[][] = [];
  if (kind === 34235 || kind === 34236) tags.push(["d", media[0].sha256]);
  for (const a of media) {
    tags.push(["imeta", `url ${a.url}`, `m ${a.type}`, `x ${a.sha256}`, ...(a.dim ? [`dim ${a.dim}`] : [])]);
    tags.push(["m", a.type], ["x", a.sha256]);
  }
  if (expiresAfter && expiresAfter > 0) tags.push(["expiration", String(now + expiresAfter)]);
  return { kind, created_at: now, tags, content: description.trim().slice(0, 20000) };
}

/** Blossom のサーバー一覧（kind 10063）。https のもの 12 件まで。 */
export function buildBlossomServers(servers: string[], now: number) {
  const safe = [...new Set(servers.map((s) => s.trim().replace(/\/+$/, "")).filter((s) => s.startsWith("https://")))].slice(0, 12);
  if (safe.length === 0) throw new Error("https のサーバーを 1 つ以上入れてください");
  return { kind: 10063, created_at: now, tags: safe.map((s) => ["server", s]), content: "" };
}

/** kind 10063 のサーバー。 */
export const blossomServersOf = (tags: string[][]) =>
  [...new Set(tags.filter((t) => t[0] === "server" && t[1]?.startsWith("https://")).map((t) => t[1].replace(/\/+$/, "")))];

/** 読めなかった画像の代わりの URL（同じハッシュの、作者の Blossom サーバーのもの）。 */
export function blossomAlternatives(original: string, servers: string[]): string[] {
  const match = /([0-9a-fA-F]{64})(\.[A-Za-z0-9]{1,8})?(?:[?#].*)?$/.exec(original);
  if (!match) return [];
  const path = match[1].toLowerCase() + (match[2] ?? "");
  return servers.map((s) => `${s}/${path}`).filter((u) => u !== original);
}
