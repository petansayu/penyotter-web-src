import type { EventTemplate } from "nostr-tools";
import { isHex64, type Event } from "../nostr/events";
import { normalizeRelay } from "../nostr/relayUrl";
import { CLIENT_TAG } from "./publishing";

/**
 * パブリックチャット（NIP-28。Android 版の PublicChat・技術資料 5.8・6.9）。チャンネル（kind 40）、チャンネルの情報の
 * 更新（kind 41、作成者のものだけ）、メッセージ（kind 42）、参加中のチャンネル（kind 10005）。
 */

export const MAX_CHANNEL_RELAYS = 12;
/** メッセージの送り先の上限（チャンネルのリレー＋自分の書き込みリレーの先頭 2 件）。 */
export const MAX_SEND_RELAYS = 8;

export interface ChannelMeta {
  name: string;
  about: string;
  picture: string | null;
  relays: string[];
}

function parseMeta(content: string): Partial<ChannelMeta> | null {
  try {
    const raw = JSON.parse(content) as Record<string, unknown>;
    if (typeof raw !== "object" || raw === null) return null;
    const relays = Array.isArray(raw.relays) ? raw.relays.filter((r): r is string => typeof r === "string").map(normalizeRelay).filter((r): r is string => !!r) : undefined;
    return {
      ...(typeof raw.name === "string" ? { name: raw.name.slice(0, 100) } : {}),
      ...(typeof raw.about === "string" ? { about: raw.about.slice(0, 2000) } : {}),
      ...(typeof raw.picture === "string" && raw.picture.startsWith("https://") ? { picture: raw.picture } : {}),
      ...(relays ? { relays: [...new Set(relays)].slice(0, MAX_CHANNEL_RELAYS) } : {}),
    };
  } catch {
    return null;
  }
}

/** チャンネルの情報。作成（kind 40）に、作成者の更新（kind 41）のいちばん新しいものを重ねる。 */
export function channelMeta(create: Event, updates: Iterable<Event> = []): ChannelMeta {
  const base = parseMeta(create.content) ?? {};
  let latestUpdate: Event | undefined;
  for (const update of updates) {
    if (update.kind !== 41 || update.pubkey !== create.pubkey || !update.tags.some((t) => t[0] === "e" && t[1] === create.id)) continue;
    if (!latestUpdate || update.created_at > latestUpdate.created_at) latestUpdate = update;
  }
  const updated = latestUpdate ? parseMeta(latestUpdate.content) ?? {} : {};
  return {
    name: (updated.name ?? base.name ?? "").trim() || "（名前のないチャンネル）",
    about: updated.about ?? base.about ?? "",
    picture: updated.picture ?? base.picture ?? null,
    relays: updated.relays ?? base.relays ?? [],
  };
}

/** メッセージ（kind 42）が属するチャンネル（`root` の `e`、なければ最初の `e`）。 */
export function messageChannel(event: Event): string | null {
  const refs = event.tags.filter((t) => t[0] === "e" && isHex64(t[1]));
  return (refs.find((t) => t[3] === "root") ?? refs[0])?.[1] ?? null;
}

/** 返信先のメッセージ（`reply` の `e`）。 */
export function messageReplyTo(event: Event): string | null {
  return event.tags.find((t) => t[0] === "e" && t[3] === "reply" && isHex64(t[1]))?.[1] ?? null;
}

/** メッセージを作る（技術資料 6.9）。relay はチャンネルのリレーの先頭。 */
export function buildMessage(channel: string, relay: string, body: string, now: number, replyTo?: Event, clientTag = true): EventTemplate {
  if (!body.trim()) throw new Error("メッセージを入力してください");
  const tags: string[][] = [["e", channel, relay, "root"]];
  if (replyTo) tags.push(["e", replyTo.id, relay, "reply"], ["p", replyTo.pubkey, relay]);
  if (clientTag) tags.push([...CLIENT_TAG]);
  return { kind: 42, created_at: now, tags, content: body };
}

/** チャンネルを作る（kind 40）。relays は作るときに選んだリレー。 */
export function buildChannel(name: string, about: string, relays: string[], now: number, picture = ""): EventTemplate {
  if (!name.trim()) throw new Error("チャンネルの名前を入れてください");
  const list = [...new Set(relays.map(normalizeRelay).filter((r): r is string => !!r))].slice(0, MAX_CHANNEL_RELAYS);
  if (list.length === 0) throw new Error("チャンネルを置くリレーを 1 件以上選んでください");
  const content: Record<string, unknown> = { name: name.trim().slice(0, 100), about: about.trim().slice(0, 2000), relays: list };
  if (picture.startsWith("https://")) content.picture = picture;
  return { kind: 40, created_at: now, tags: [], content: JSON.stringify(content) };
}

/** 参加中のチャンネル（kind 10005 の `e`）。 */
export const joinedChannels = (event: Event | undefined) => (event?.tags ?? []).filter((t) => t[0] === "e" && isHex64(t[1])).map((t) => t[1]);

export type ChatPlacement = { day: string | null; grouped: boolean };

/**
 * 吹き出しの並べ方（Android 版の chatPlacement）。同じ人が 5 分以内に続けたものはまとめ（名前とアイコンを出さない）、
 * 日が変わるところに日付の区切りを入れる。messages は古い順。
 */
export function chatPlacement(messages: Event[], timeZoneOffsetMinutes = new Date().getTimezoneOffset()): ChatPlacement[] {
  const dayOf = (seconds: number) => {
    const date = new Date((seconds - timeZoneOffsetMinutes * 60) * 1000);
    return `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
  };
  return messages.map((message, i) => {
    const before = messages[i - 1];
    const day = dayOf(message.created_at);
    const newDay = !before || dayOf(before.created_at) !== day;
    return { day: newDay ? day : null, grouped: !newDay && !!before && before.pubkey === message.pubkey && message.created_at - before.created_at <= 300 };
  });
}
