import { describe, expect, it } from "vitest";
import { nip19, type Event } from "nostr-tools";
import { parseRelayList } from "../nostr/outbox";
import { normalizeRelay, publicRelay } from "../nostr/relayUrl";
import { mediaOf, quoteCardId, segments, withoutMedia, withoutQuoteLink } from "./content";
import { chain, parent, root } from "./threads";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const event = (fields: Partial<Event>): Event =>
  ({ id: "1".repeat(64), pubkey: A, created_at: 1, kind: 1, tags: [], content: "", sig: "0".repeat(128), ...fields }) as Event;

describe("relayUrl", () => {
  it("wss だけを揃える", () => {
    expect(normalizeRelay("wss://Yabu.me/")).toBe("wss://yabu.me");
    expect(normalizeRelay("ws://yabu.me")).toBeNull();
    expect(normalizeRelay("wss://user:pass@yabu.me")).toBeNull();
    expect(normalizeRelay("wss://yabu.me/#x")).toBeNull();
  });
  it("相手から来たリレーは公開のアドレスだけ", () => {
    expect(publicRelay("wss://nos.lol")).toBe("wss://nos.lol");
    for (const bad of ["wss://localhost", "wss://192.168.0.1", "wss://relay.local", "wss://intranet", "wss://[::1]"]) expect(publicRelay(bad)).toBeNull();
  });
  it("kind 10002 の r タグ", () => {
    const list = parseRelayList(event({ kind: 10002, tags: [["r", "wss://a.example"], ["r", "wss://b.example", "read"], ["r", "wss://c.example", "write"], ["r", "wss://d.example", "other"], ["r", "wss://localhost"]] }));
    expect(list).toEqual({ read: ["wss://a.example", "wss://b.example"], write: ["wss://a.example", "wss://c.example"] });
  });
});

describe("content", () => {
  it("画像・動画を本文から外す", () => {
    const note = event({ content: "見て\nhttps://example.com/a.jpg\nhttps://example.com/b.mp4。", tags: [["imeta", "url https://example.com/c", "m image/png", "dim 10x20"]] });
    const media = mediaOf(note);
    expect(media.map((m) => [m.url, m.video])).toEqual([["https://example.com/a.jpg", false], ["https://example.com/b.mp4", true], ["https://example.com/c", false]]);
    expect(media[2]).toMatchObject({ width: 10, height: 20 });
    expect(withoutMedia(note.content, media)).toBe("見て\n。");
  });
  it("引用カードとそのリンクを外した本文", () => {
    const nevent = nip19.neventEncode({ id: B });
    const note = event({ content: `これ\nnostr:${nevent}` });
    expect(quoteCardId(note)).toBe(B);
    expect(withoutQuoteLink(note.content, B)).toBe("これ");
    expect(quoteCardId(event({ tags: [["q", C]], content: "x" }))).toBe(C);
  });
  it("本文を分ける", () => {
    const npub = nip19.npubEncode(B);
    const parts = segments(`こんにちは nostr:${npub} :pe: #ぺにょ https://example.com/x)`, new Map([["pe", "https://e.example/pe.png"]]));
    expect(parts.map((p) => p.type)).toEqual(["text", "profile", "text", "emoji", "text", "hashtag", "text", "link", "text"]);
    expect(parts.find((p) => p.type === "link")).toEqual({ type: "link", url: "https://example.com/x" });
    expect(segments(":unknown:", new Map())).toEqual([{ type: "text", text: ":unknown:" }]);
    expect(segments("mail@example.com#x", new Map())).toEqual([{ type: "text", text: "mail@example.com#x" }]);
  });
});

describe("threads", () => {
  it("NIP-10 の親と根", () => {
    expect(parent(event({ tags: [["e", B, "", "root"], ["e", C, "", "reply"]] }))).toBe(C);
    expect(parent(event({ tags: [["e", B, "", "root"]] }))).toBe(B);
    expect(parent(event({ tags: [["e", B], ["e", C]] }))).toBe(C);
    expect(parent(event({ kind: 20, tags: [["e", B]] }))).toBeNull();
    expect(root(event({ tags: [["e", B, "", "root"], ["e", C, "", "reply"]] }))).toBe(B);
  });
  it("NIP-22 はアドレスを優先", () => {
    const comment = event({ kind: 1111, tags: [["A", `30023:${A}:x`], ["a", `30023:${A}:x`], ["e", B]] });
    expect(parent(comment)).toBe(`30023:${A}:x`);
    expect(root(comment)).toBe(`30023:${A}:x`);
  });
  it("返信元をたどる", () => {
    const first = event({ id: B });
    const second = event({ id: C, tags: [["e", B, "", "root"]] });
    const third = event({ id: "d".repeat(64), tags: [["e", B, "", "root"], ["e", C, "", "reply"]] });
    expect(chain(third, [first, second]).ancestors.map((e) => e.id)).toEqual([B, C]);
    expect(chain(third, [second]).missing).toBe(B);
  });
});
