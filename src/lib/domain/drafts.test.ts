import { describe, expect, it } from "vitest";
import type { Event } from "../nostr/events";
import { articleFields, articleHashtags, buildArticle, buildDraftDeletion, buildDraftWrap, newestWraps, privateRelays, readDraft } from "./drafts";

const ME = "a".repeat(64);
let n = 0;
const event = (e: Partial<Event>): Event => ({ id: String(++n).padStart(64, "0"), pubkey: ME, created_at: 100, kind: 31234, tags: [], content: "", sig: "", ...e });

describe("リレーの下書き（NIP-37）", () => {
  it("d・k・90 日後の expiration。削除は中身が空で expiration なし", () => {
    expect(buildDraftWrap("x", 1, "enc", 1000).tags).toEqual([["d", "x"], ["k", "1"], ["expiration", String(1000 + 90 * 86400)]]);
    expect(buildDraftDeletion("x", 1, 5)).toEqual({ kind: 31234, created_at: 5, tags: [["d", "x"], ["k", "1"]], content: "" });
  });
  it("識別子ごとに新しい版。空の版は古い版ごと隠す", () => {
    const a1 = event({ tags: [["d", "a"]], content: "old", created_at: 1 });
    const a2 = event({ tags: [["d", "a"]], content: "new", created_at: 2 });
    const b1 = event({ tags: [["d", "b"]], content: "b", created_at: 3 });
    const b2 = event({ tags: [["d", "b"]], content: "", created_at: 4 });
    expect(newestWraps([a1, a2, b1, b2], ME)).toEqual([a2]);
  });
  it("kind 1・1111 だけ読む。10013 のリレー", () => {
    const wrap = event({ tags: [["d", "a"]] });
    expect(readDraft(wrap, JSON.stringify({ kind: 1, content: "やあ", tags: [["t", "x"]] }))).toMatchObject({ identifier: "a", kind: 1, content: "やあ", tags: [["t", "x"]] });
    expect(readDraft(wrap, JSON.stringify({ kind: 30023, content: "" }))).toBeNull();
    expect(privateRelays(JSON.stringify([["relay", "wss://p.test"], ["relay", "https://x"], ["r", "wss://q"]]))).toEqual(["wss://p.test"]);
  });
});

describe("記事（NIP-23）", () => {
  const fields = { identifier: "penyotter-1", title: " 題 ", summary: "", image: "http://x/a.png", hashtags: "Nostr、#日記 nostr", body: "# 本文", publishedAt: 50 };
  it("d・title・published_at（最初の公開の時刻）・t。http の画像は付けない。下書きは published_at なし", () => {
    expect(buildArticle(fields, 99).tags).toEqual([["d", "penyotter-1"], ["title", "題"], ["published_at", "50"], ["t", "nostr"], ["t", "日記"]]);
    expect(buildArticle(fields, 99, true).tags.some((t) => t[0] === "published_at")).toBe(false);
    expect(() => buildArticle({ ...fields, title: "" }, 1)).toThrow();
    expect(articleHashtags("a b,a")).toEqual(["a", "b"]);
  });
  it("書いた記事から値を戻す", () => {
    const note = event({ kind: 30023, content: "本文", tags: [["d", "x"], ["title", "t"], ["published_at", "7"], ["t", "a"], ["t", "b"]] });
    expect(articleFields(note)).toEqual({ identifier: "x", title: "t", summary: "", image: "", hashtags: "a b", body: "本文", publishedAt: 7 });
  });
});
