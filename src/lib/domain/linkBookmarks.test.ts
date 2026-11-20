import { describe, expect, it } from "vitest";
import type { Event } from "../nostr/events";
import {
  addLinkBookmark, buildLinkBookmark, decodeLinkBookmarks, linkBookmarkDeletion, linkFromIdentifier, linkIdentifier, linkKey,
  MAX_URL, normalizeLink, publicLinkBookmarks, type LinkBookmark,
} from "./linkBookmarks";

const ME = "a".repeat(64);
const OTHER = "b".repeat(64);
let next = 1;
const event = (d: string, time: number, pubkey = ME, ...tags: string[][]): Event =>
  ({ id: (next++).toString(16).padStart(64, "0"), pubkey, created_at: time, kind: 39701, tags: [["d", d], ...tags], content: "", sig: "0".repeat(128) }) as Event;

describe("リンクのブックマーク", () => {
  it("http・https でホストがあるものだけ", () => {
    expect(normalizeLink("  https://example.com/ep1 ")).toBe("https://example.com/ep1");
    expect(normalizeLink("http://example.com")).toBe("http://example.com");
    expect(normalizeLink("javascript:alert(1)")).toBeNull();
    expect(normalizeLink("https://example.com/a b")).toBeNull();
    expect(normalizeLink("https://example.com/" + "a".repeat(MAX_URL))).toBeNull();
  });

  it("d は https だけ省く（Android 版と同じ）", () => {
    expect(linkIdentifier("https://example.com/podcast")).toBe("example.com/podcast");
    expect(linkIdentifier("http://example.com/podcast")).toBe("http://example.com/podcast");
    expect(linkFromIdentifier("example.com/podcast")).toBe("https://example.com/podcast");
    expect(linkKey("https://example.com/")).toBe(linkKey("https://example.com"));
  });

  it("公開は kind 39701", () => {
    const post = buildLinkBookmark("https://example.com/show", " 番組 ", 2000, 1000);
    expect(post).toEqual({ kind: 39701, created_at: 2000, tags: [["d", "example.com/show"], ["title", "番組"], ["published_at", "1000"]], content: "" });
    expect(() => buildLinkBookmark("ftp://example.com", "", 1)).toThrow();
  });

  it("自分の分の新しい版だけ、消した時刻より古い版は除く", () => {
    const links = publicLinkBookmarks([
      event("example.com/a", 100, ME, ["title", "古い"]),
      event("example.com/a", 200, ME, ["title", "新しい"], ["published_at", "50"]),
      event("example.com/b", 150),
      event("example.com/c", 300, OTHER),
      event("example.com/d", 120),
    ], ME, { "example.com/d": 120 });
    expect(links.map((l) => l.url)).toEqual(["https://example.com/b", "https://example.com/a"]);
    expect(links[1].title).toBe("新しい");
    expect(links[1].addedAt).toBe(50);
  });

  it("削除の依頼はアドレスを指す", () => {
    const link: LinkBookmark = { url: "https://example.com/a", title: "", addedAt: 1, public: true, eventId: "e".repeat(64) };
    expect(linkBookmarkDeletion(ME, link, 5).tags).toEqual([["a", `39701:${ME}:example.com/a`], ["e", "e".repeat(64)], ["k", "39701"]]);
  });

  it("保存の形と、足すと上へ", () => {
    const list: LinkBookmark[] = [{ url: "https://example.com/a", title: "A", addedAt: 10, public: false, from: "nevent1xyz" }];
    expect(decodeLinkBookmarks(JSON.parse(JSON.stringify(list)), false)).toEqual(list);
    expect(decodeLinkBookmarks("壊れた", false)).toEqual([]);
    const added = addLinkBookmark([...list, { url: "https://example.com/b", title: "", addedAt: 5, public: false }], { url: "https://example.com/b/", title: "B", addedAt: 20, public: false });
    expect(added.map((l) => l.url)).toEqual(["https://example.com/b/", "https://example.com/a"]);
  });
});
