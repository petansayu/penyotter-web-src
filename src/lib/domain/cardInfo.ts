import type { Event } from "../nostr/events";

/**
 * 投稿カードに出す付け足しの情報（Android 版の ClientTags・SensitiveContent・Subjects・ProxyTags・UserStatuses）。
 */

const HEX64 = /^[0-9a-f]{64}$/;

/** 投稿元のクライアント名（`client` タグ。NIP-89 のアドレスとリレーが正しいものだけ）。 */
export function clientName(event: Event): string | null {
  for (const tag of event.tags) {
    if (tag[0] !== "client") continue;
    const name = (tag[1] ?? "").trim();
    const parts = (tag[2] ?? "").trim().split(":");
    const address = parts.length >= 3 && parts[0] === "31990" && HEX64.test(parts[1]) && parts.slice(2).join(":").length > 0 && parts.slice(2).join(":").length <= 128;
    let relay = false;
    try {
      const url = new URL((tag[3] ?? "").trim());
      relay = (url.protocol === "wss:" || url.protocol === "ws:") && !!url.hostname;
    } catch {
      relay = false;
    }
    // eslint-disable-next-line no-control-regex
    if (name && name.length <= 80 && !/[\u0000-\u001f\u007f]/.test(name) && address && relay) return name;
    return null;
  }
  return null;
}

/** 注意書き（`content-warning`）。理由がなければ「センシティブな内容」。なければ null。 */
export function contentWarning(event: Event): string | null {
  const tag = event.tags.find((t) => t[0] === "content-warning");
  if (!tag) return null;
  return (tag[1] ?? "").trim().slice(0, 200) || "センシティブな内容";
}

/** 件名（NIP-14）。本文が件名で始まるときは出さない（本文にも件名を書くアプリがあるため）。 */
export function subjectToShow(event: Event, body: string): string | null {
  const raw = event.tags.find((t) => t[0] === "subject" && t[1])?.[1];
  const subject = raw?.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!subject) return null;
  return body.trimStart().startsWith(subject) ? null : subject;
}

export interface ProxyOrigin {
  label: string;
  /** 元の投稿を開ける URL（https だけ）。 */
  url: string | null;
}

const BSKY_POST = /^at:\/\/(did:[a-z0-9]+:[A-Za-z0-9._:%-]+)\/app\.bsky\.feed\.post\/([A-Za-z0-9._~-]+)$/;
const PROXY_LABELS: Record<string, string> = { activitypub: "ActivityPub（Mastodon など）", atproto: "Bluesky", rss: "RSS", web: "Web" };

/** 橋渡し元（NIP-48 の `proxy`）。 */
export function proxyOrigin(event: Event): ProxyOrigin | null {
  const tag = event.tags.find((t) => t.length >= 3 && t[0] === "proxy" && t[1].trim());
  if (!tag) return null;
  const id = tag[1].trim();
  const protocol = tag[2].trim().toLowerCase();
  let url: string | null = null;
  if (protocol === "atproto") {
    const match = BSKY_POST.exec(id);
    if (match) url = `https://bsky.app/profile/${match[1]}/post/${match[2]}`;
  } else if (["activitypub", "rss", "web"].includes(protocol)) {
    try {
      const parsed = new URL(id);
      if (parsed.protocol === "https:" && parsed.hostname && !parsed.username && !parsed.password) url = id;
    } catch {
      url = null;
    }
  }
  return { label: PROXY_LABELS[protocol] ?? protocol, url };
}

export interface UserStatus {
  type: "general" | "music";
  content: string;
  createdAt: number;
}

/** その人のステータス（kind 30315 の general・music の最新。期限切れと空のものは除く）。general を先に。 */
export function latestStatuses(events: Iterable<Event>, author: string, now: number): UserStatus[] {
  const result: UserStatus[] = [];
  for (const type of ["general", "music"] as const) {
    let best: Event | undefined;
    for (const event of events) {
      if (event.kind !== 30315 || event.pubkey !== author || !event.tags.some((t) => t[0] === "d" && t[1] === type)) continue;
      const expiration = event.tags.find((t) => t[0] === "expiration")?.[1];
      if (expiration !== undefined && !(Number(expiration) > now)) continue;
      if (!best || event.created_at > best.created_at || (event.created_at === best.created_at && event.id < best.id)) best = event;
    }
    if (best && best.content.trim()) result.push({ type, content: best.content.slice(0, 500), createdAt: best.created_at });
  }
  return result;
}

/** 本文を折りたたむか（Android 版と同じく 420 文字か 8 行を超えたら）。 */
export const isLongBody = (visible: string) => visible.length > 420 || (visible.match(/\n/g)?.length ?? 0) >= 8;
