import { describe, expect, it } from "vitest";
import { nip19, type Event } from "nostr-tools";
import { activeFilters, matchesFilters, matchNotes, matchProfiles, NO_FILTERS, parseQuery, searchFilters, terms, textMatches } from "./search";

const A = "a".repeat(64);
const B = "b".repeat(64);
let next = 1;
const event = (fields: Partial<Event>): Event =>
  ({ id: (next++).toString(16).padStart(64, "0"), pubkey: A, created_at: next, kind: 1, tags: [], content: "", sig: "0".repeat(128), ...fields }) as Event;

describe("parseQuery", () => {
  it("種類を見分ける", () => {
    expect(parseQuery("ぺにょ 餃子")).toEqual({ type: "text", value: "ぺにょ 餃子" });
    expect(parseQuery("#Nostr")).toEqual({ type: "tag", value: "nostr" });
    expect(parseQuery(A.toUpperCase())).toEqual({ type: "author", pubkey: A, relays: [] });
    expect(parseQuery(`nostr:${nip19.npubEncode(B)}`)).toEqual({ type: "author", pubkey: B, relays: [] });
    expect(parseQuery(nip19.nprofileEncode({ pubkey: B, relays: ["wss://yabu.me/"] }))).toEqual({ type: "author", pubkey: B, relays: ["wss://yabu.me"] });
    expect(parseQuery(nip19.neventEncode({ id: A, author: B }))).toEqual({ type: "event", id: A, relays: [], author: B });
    expect(parseQuery(nip19.naddrEncode({ kind: 30023, pubkey: B, identifier: "x" }))).toMatchObject({ type: "address", kind: 30023, pubkey: B, identifier: "x" });
    expect(parseQuery("name@example.com")).toEqual({ type: "nip05", value: "name@example.com" });
  });

  it("読めない入力は理由を返す", () => {
    expect(() => parseQuery("  ")).toThrow("検索語を入力してください");
    expect(() => parseQuery("nsec1abc")).toThrow("秘密鍵");
    expect(() => parseQuery("#a b")).toThrow("タグを1つ");
    expect(() => parseQuery("npub1qqqq")).toThrow("識別子");
  });
});

describe("文字の検索", () => {
  it("語・除外・引用符", () => {
    expect(terms('ぺにょ -餃子 "a b" since:2026')).toEqual([
      { value: "ぺにょ", excluded: false }, { value: "餃子", excluded: true }, { value: "a b", excluded: false },
    ]);
    expect(textMatches("ぺにょったー Web", "ぺにょ web")).toBe(true);
    expect(textMatches("ぺにょったーと餃子", "ぺにょ -餃子")).toBe(false);
  });

  it("端末内の投稿とプロフィール", () => {
    const hit = event({ content: "ぺにょったーを使う" });
    const article = event({ kind: 30023, tags: [["title", "ぺにょ入門"]], content: "本文" });
    const tagged = event({ tags: [["t", "Nostr"]] });
    expect(matchNotes({ type: "text", value: "ぺにょ" }, [hit, article, tagged, event({ kind: 0, content: "ぺにょ" })]).map((e) => e.id))
      .toEqual([article.id, hit.id]);
    expect(matchNotes({ type: "tag", value: "nostr" }, [hit, tagged]).map((e) => e.id)).toEqual([tagged.id]);
    expect(matchProfiles({ type: "text", value: "ぺぇ" }, [[A, { name: "pee", displayName: "ぺぇ" }], [B, { name: "other" }]])).toEqual([A]);
  });

  it("リレーへ送るフィルタ", () => {
    expect(searchFilters({ type: "text", value: "x" })).toEqual([{ kinds: [1, 1111, 30023], search: "x", limit: 100 }, { kinds: [0], search: "x", limit: 50 }]);
    expect(searchFilters({ type: "text", value: "x" }, 10)).toEqual([{ kinds: [1, 1111, 30023], search: "x", limit: 100, until: 10 }]);
    expect(searchFilters({ type: "tag", value: "nostr" })).toEqual([{ kinds: [1, 1111, 30023], "#t": ["nostr"], limit: 100 }]);
    expect(searchFilters({ type: "author", pubkey: A, relays: [] })).toEqual([]);
  });
});

describe("絞り込み", () => {
  it("期間・作者・タグ・除く語", () => {
    const post = event({ created_at: 100, tags: [["t", "Nostr"]], content: "ぺにょったーの話" });
    expect(matchesFilters(post, { ...NO_FILTERS, since: 50, until: 150 })).toBe(true);
    expect(matchesFilters(post, { ...NO_FILTERS, since: 101 })).toBe(false);
    expect(matchesFilters(post, { ...NO_FILTERS, authors: [B] })).toBe(false);
    expect(matchesFilters(post, { ...NO_FILTERS, excludedAuthors: [A] })).toBe(false);
    expect(matchesFilters(post, { ...NO_FILTERS, tags: ["nostr"] })).toBe(true);
    expect(matchesFilters(post, { ...NO_FILTERS, excludedTags: ["NOSTR"] })).toBe(false);
    expect(matchesFilters(post, { ...NO_FILTERS, excludedTerms: ["ぺにょ"] })).toBe(false);
  });

  it("種類とメディア", () => {
    const root = event({ content: "画像 https://x.example/a.jpg?w=1" });
    const reply = event({ tags: [["e", B, "", "root"]], content: "動画 https://x.example/v.mp4" });
    const quote = event({ tags: [["q", B]], content: "リンク https://x.example/page" });
    const comment = event({ kind: 1111, content: "コメント" });
    const by = (postType: "root" | "reply" | "quote" | "comment") => [root, reply, quote, comment].filter((e) => matchesFilters(e, { ...NO_FILTERS, postType })).map((e) => e.content.slice(0, 2));
    expect(by("root")).toEqual(["画像"]);
    expect(by("reply")).toEqual(["動画"]);
    expect(by("quote")).toEqual(["リン"]);
    expect(by("comment")).toEqual(["コメ"]);
    const media = (mediaType: "image" | "video" | "link" | "none") => [root, reply, quote, comment].filter((e) => matchesFilters(e, { ...NO_FILTERS, mediaType })).map((e) => e.content.slice(0, 2));
    expect(media("image")).toEqual(["画像"]);
    expect(media("video")).toEqual(["動画"]);
    expect(media("link")).toEqual(["画像", "動画", "リン"]);
    expect(media("none")).toEqual(["コメ"]);
  });

  it("絞り込みだけの検索と、リレーへのフィルタ", () => {
    const filters = { ...NO_FILTERS, since: 10, until: 20, authors: [A], tags: ["nostr"], excludedTerms: ["広告", "a b"], postType: "comment" as const };
    expect(activeFilters(filters)).toBe(5);
    expect(searchFilters({ type: "text", value: "x" }, 15, filters)).toEqual([
      { kinds: [1111], limit: 100, until: 15, since: 10, authors: [A], search: 'x -広告 -"a b"', "#t": ["nostr"] },
    ]);
    expect(searchFilters({ type: "filtered" }, undefined, filters)).toEqual([{ kinds: [1111], limit: 100, until: 20, since: 10, authors: [A], "#t": ["nostr"] }]);
    expect(searchFilters({ type: "tag", value: "web" }, undefined, { ...NO_FILTERS, tags: ["nostr"] })).toEqual([{ kinds: [1, 1111, 30023], limit: 100, "#t": ["nostr", "web"] }]);
    const old = event({ created_at: 5 });
    expect(matchNotes({ type: "filtered" }, [old, event({ created_at: 12 })], 100, { ...NO_FILTERS, since: 10 }).map((e) => e.created_at)).toEqual([12]);
  });
});
