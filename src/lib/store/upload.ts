import { checkNip96Response, checkUploadResponse, DEFAULT_UPLOAD_SERVER, isNip96, nip96Auth, normalizeServer, uploadAuth, type Attachment } from "../domain/media";
import { viewer } from "./viewer.svelte";

/**
 * 画像・動画のアップロード（Blossom、BUD-02。Android 版の data/Blossom.kt）。画像はこのブラウザで描き直してから送る
 * （撮影した場所などの情報を落とすため。Android 版も JPEG / PNG に変換して送る）。投稿先は見る人ごとにブラウザに保存する。
 */

/** テストモードの手元の投稿先（npm run test-blossom）。本番用のビルドでは null。 */
export const TEST_BLOSSOM: string | null = import.meta.env.DEV ? (import.meta.env.VITE_TEST_BLOSSOM ?? null) : null;

/** 送れる大きさの上限（これより大きいものは送る前に断る。実際の上限は投稿先ごとに違う）。 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
/** 描き直すときの長い辺の上限。 */
const MAX_EDGE = 4096;
/** 描き直す種類（GIF は動きが消えるので、SVG は描き直せないので、そのまま送る・断る）。 */
const REENCODE = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif"]);

const key = (pubkey: string) => `upload-server.${pubkey}`;

export function uploadServer(pubkey: string | null): string {
  if (TEST_BLOSSOM) return TEST_BLOSSOM;
  try {
    const saved = pubkey ? localStorage.getItem(key(pubkey)) : null;
    return (saved && normalizeServer(saved)) || DEFAULT_UPLOAD_SERVER;
  } catch {
    return DEFAULT_UPLOAD_SERVER;
  }
}

/** 投稿先を保存する。https のオリジンでなければ false。 */
export function saveUploadServer(pubkey: string, raw: string): boolean {
  const server = normalizeServer(raw);
  if (!server) return false;
  try {
    localStorage.setItem(key(pubkey), server);
  } catch {
    // 保存できなくてもこの間は使える
  }
  return true;
}

interface Prepared {
  blob: Blob;
  type: string;
  dim?: string;
}

/** 送る形にする。画像は描き直して、撮影情報を落とす（長い辺は 4096 まで）。 */
async function prepare(file: File): Promise<Prepared> {
  if (file.type === "image/svg+xml") throw new Error("SVG の画像は送れません");
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) throw new Error("画像か動画を選んでください");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("ファイルが大きすぎます（100MB まで）");
  if (!REENCODE.has(file.type)) return { blob: file, type: file.type };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("この画像はブラウザで読めませんでした（JPEG・PNG・WebP にしてください）");
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  // 透明があるかもしれない PNG は PNG のまま、それ以外は JPEG
  const type = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  if (!blob) throw new Error("画像を描き直せませんでした");
  return { blob, type, dim: `${width}x${height}` };
}

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

function base64(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** NIP-96 のサーバー情報（/.well-known/nostr/nip96.json、委譲先は 1 回まで）。 */
async function discoverNip96(server: string): Promise<string> {
  let url = `${server}/.well-known/nostr/nip96.json`;
  for (let i = 0; i < 2; i++) {
    const response = await fetch(url, { redirect: "error", credentials: "omit" }).catch(() => null);
    if (!response?.ok) throw new Error(`NIP-96サーバー情報を取得できません（${response?.status ?? "接続できません"}）`);
    const json = (await response.json().catch(() => ({}))) as { api_url?: unknown; delegated_to_url?: unknown };
    if (typeof json.delegated_to_url === "string" && json.delegated_to_url) {
      if (!json.delegated_to_url.startsWith("https://")) throw new Error("NIP-96の委譲先が https ではありません");
      url = `${json.delegated_to_url.replace(/\/+$/, "")}/.well-known/nostr/nip96.json`;
      continue;
    }
    if (typeof json.api_url !== "string" || !json.api_url.startsWith("https://")) throw new Error("NIP-96のアップロード先がHTTPSではありません");
    return json.api_url;
  }
  throw new Error("NIP-96の委譲先が多すぎます");
}

/** NIP-96 で送る（Android 版の Nip96Uploader）。認可は NIP-98（kind 27235）。 */
async function uploadNip96(server: string, prepared: Prepared, sha256: string): Promise<Attachment> {
  const api = await discoverNip96(server);
  const signer = await viewer.getSigner();
  const auth = await signer.sign(nip96Auth(api, sha256, Math.floor(Date.now() / 1000)));
  const form = new FormData();
  form.append("file", prepared.blob, `upload.${prepared.type.split("/")[1] ?? "bin"}`);
  form.append("size", String(prepared.blob.size));
  form.append("content_type", prepared.type);
  let response: Response;
  try {
    response = await fetch(api, { method: "POST", body: form, headers: { Authorization: `Nostr ${base64(JSON.stringify(auth))}` }, redirect: "error" });
  } catch {
    throw new Error(`${new URL(api).host} につながりませんでした`);
  }
  const json = await response.json().catch(() => null);
  if (![200, 201, 202].includes(response.status)) {
    const message = (json as { message?: unknown } | null)?.message;
    throw new Error(typeof message === "string" && message ? message.slice(0, 200) : `NIP-96アップロードに失敗しました（${response.status}）`);
  }
  return { ...checkNip96Response(json, prepared.type, prepared.blob.size, sha256), ...(prepared.dim ? { dim: prepared.dim } : {}) };
}

/** 1 つ送る。署名（kind 24242、NIP-96 は kind 27235）は送るたびに頼む。 */
export async function uploadFile(file: File): Promise<Attachment> {
  return uploadPrepared(await prepare(file), file.name || "file");
}

/** DM のファイルの上限（Android 版の BlossomUploader.MAX_BYTES と同じ）。 */
export const MAX_RAW_BYTES = 25 * 1024 * 1024;

/** 描き直さずにそのまま送る（DM の暗号化したファイル。種類は application/octet-stream）。 */
export async function uploadRaw(data: Uint8Array): Promise<Attachment> {
  if (data.length > MAX_RAW_BYTES) throw new Error("ファイルが大きすぎます（25MB まで）");
  return uploadPrepared({ blob: new Blob([data as BlobPart], { type: "application/octet-stream" }), type: "application/octet-stream" }, "file");
}

async function uploadPrepared(prepared: Prepared, name: string): Promise<Attachment> {
  const server = uploadServer(viewer.pubkey);
  const sha256 = hex(await crypto.subtle.digest("SHA-256", await prepared.blob.arrayBuffer()));
  if (!TEST_BLOSSOM && isNip96(server)) return uploadNip96(server, prepared, sha256);
  const signer = await viewer.getSigner();
  const auth = await signer.sign(uploadAuth(sha256, name, Math.floor(Date.now() / 1000), server));
  let response: Response;
  try {
    response = await fetch(`${server}/upload`, {
      method: "PUT",
      body: prepared.blob,
      headers: { Authorization: `Nostr ${base64(JSON.stringify(auth))}`, "Content-Type": prepared.type, "X-SHA-256": sha256 },
    });
  } catch {
    throw new Error(`${new URL(server).host} につながりませんでした`);
  }
  if (!response.ok) {
    const reason = response.headers.get("X-Reason");
    throw new Error(`${new URL(server).host} に断られました（${response.status}${reason ? `: ${reason.slice(0, 120)}` : ""}）`);
  }
  const attachment = checkUploadResponse(server, await response.json().catch(() => null), prepared.type, prepared.blob.size);
  return { ...attachment, ...(prepared.dim && attachment.sha256 === sha256 ? { dim: prepared.dim } : {}) };
}
