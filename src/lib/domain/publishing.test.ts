import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, type Event } from "nostr-tools";
import { addressee, buildDeletion, buildEvent, buildRepost, buildUndo, CLIENT_TAG } from "./publishing";
import { publish } from "../nostr/pool";
import { startTestRelay } from "../../../scripts/test-relay.mjs";

const ME = "a".repeat(64);
const OTHER = "b".repeat(64);
const THIRD = "c".repeat(64);
const POST = "1".repeat(64);
const ROOT = "2".repeat(64);
const target = (fields: Partial<Event>): Event =>
  ({ id: POST, pubkey: OTHER, created_at: 1, kind: 1, tags: [], content: "", sig: "0".repeat(128), ...fields }) as Event;

describe("buildEvent", () => {
  it("投稿: ハッシュタグ・メンション・引用とクライアントタグ", () => {
    const body = `こんにちは #Nostr と #ぺにょ と#除外 a#no https://x/#y nostr:${nip19.npubEncode(OTHER)} nostr:${nip19.npubEncode(ME)} nostr:${nip19.neventEncode({ id: POST, author: THIRD })}`;
    const event = buildEvent(ME, { mode: "post", body }, 100);
    expect(event.kind).toBe(1);
    expect(event.created_at).toBe(100);
    expect(event.content).toBe(body);
    expect(event.tags).toEqual([
      ["q", POST, "", THIRD], ["p", THIRD], ["p", OTHER], ["t", "nostr"], ["t", "ぺにょ"], CLIENT_TAG,
    ]);
    expect(buildEvent(ME, { mode: "post", body: "x" }, 1, { clientTag: false }).tags).toEqual([]);
  });

  it("投稿できない下書き", () => {
    expect(() => buildEvent(ME, { mode: "post", body: "  " }, 1)).toThrow("本文を入力してください");
    expect(() => buildEvent(ME, { mode: "post", body: "x".repeat(20_001) }, 1)).toThrow("20,000");
    expect(() => buildEvent(ME, { mode: "reply", body: "x" }, 1)).toThrow("相手の投稿");
  });

  it("kind 1 への返信（NIP-10）", () => {
    const top = buildEvent(ME, { mode: "reply", body: "返信", target: target({ tags: [["p", THIRD]] }) }, 1);
    expect(top.tags.slice(0, 3)).toEqual([["e", POST, "", "root", OTHER], ["p", THIRD], ["p", OTHER]]);
    const nested = buildEvent(ME, { mode: "reply", body: "返信", target: target({ tags: [["e", ROOT, "wss://r", "root", THIRD], ["subject", "件名"]] }) }, 1);
    expect(nested.tags.slice(0, 3)).toEqual([["e", ROOT, "wss://r", "root", THIRD], ["e", POST, "", "reply", OTHER], ["p", OTHER]]);
    expect(nested.tags).toContainEqual(["subject", "Re: 件名"]);
    expect(nested.kind).toBe(1);
  });

  it("記事への返信（NIP-22）はアドレスと ID の両方", () => {
    const article = target({ kind: 30023, tags: [["d", "x"]] });
    const event = buildEvent(ME, { mode: "reply", body: "コメント", target: article }, 1);
    expect(event.kind).toBe(1111);
    expect(event.tags.slice(0, 7)).toEqual([
      ["A", `30023:${OTHER}:x`, ""], ["K", "30023"], ["P", OTHER], ["a", `30023:${OTHER}:x`, ""], ["e", POST, "", OTHER], ["k", "30023"], ["p", OTHER],
    ]);
  });

  it("引用とリアクション", () => {
    const quote = buildEvent(ME, { mode: "quote", body: "見て ", target: target({}) }, 1);
    expect(quote.content).toBe(`見て\n\nnostr:${nip19.noteEncode(POST)}`);
    expect(quote.tags.slice(0, 2)).toEqual([["q", POST, "", OTHER], ["p", OTHER]]);
    const like = buildEvent(ME, { mode: "like", body: "+", target: target({}) }, 1);
    expect(like).toMatchObject({ kind: 7, content: "+" });
    expect(like.tags).toEqual([["e", POST, "", OTHER], ["p", OTHER], ["k", "1"], CLIENT_TAG]);
  });
});

describe("注意書きと消える投稿", () => {
  it("content-warning（200 文字まで）と expiration。付けなければどちらもない", () => {
    const post = buildEvent(ME, { mode: "post", body: "ねたばれ", contentWarning: "x".repeat(250), expiresAfter: 3600 }, 1000, { clientTag: false });
    expect(post.tags).toContainEqual(["content-warning", "x".repeat(200)]);
    expect(post.tags).toContainEqual(["expiration", "4600"]);
    const plain = buildEvent(ME, { mode: "post", body: "a" }, 1000, { clientTag: false });
    expect(plain.tags.some((t) => t[0] === "content-warning" || t[0] === "expiration")).toBe(false);
  });
});

describe("リポストと取り消し", () => {
  it("kind 1 は kind 6、ほかは kind 16 と k。中身は元の投稿の JSON（/ はそのまま）", () => {
    const original = target({ content: "https://example.com/a" });
    const repost = buildRepost(original, "wss://yabu.me", 5);
    expect(repost).toMatchObject({ kind: 6, created_at: 5 });
    expect(repost.tags).toEqual([["e", POST, "wss://yabu.me"], ["p", OTHER], CLIENT_TAG]);
    expect(repost.content).toBe(JSON.stringify(original));
    expect(repost.content).toContain("https://example.com/a");
    const comment = buildRepost(target({ kind: 1111 }), "", 5, { clientTag: false });
    expect(comment.kind).toBe(16);
    expect(comment.tags).toEqual([["e", POST, ""], ["p", OTHER], ["k", "1111"]]);
  });

  it("保護された投稿（NIP-70）は中身を空にする", () => {
    expect(buildRepost(target({ tags: [["-"]] }), "", 1).content).toBe("");
  });

  it("取り消しは kind 5", () => {
    expect(buildUndo(target({ kind: 7 }), 9)).toEqual({ kind: 5, created_at: 9, tags: [["e", POST], ["k", "7"]], content: "リアクションを取り消しました" });
    expect(buildUndo(target({ kind: 6 }), 9).content).toBe("リポストを取り消しました");
    expect(() => buildUndo(target({ kind: 1 }), 9)).toThrow();
  });
});

describe("publish（手元のテスト用リレー）", () => {
  let relay: { url: string; events: Map<string, Event>; close: () => Promise<void>; ready: Promise<void> };
  beforeAll(async () => {
    relay = startTestRelay(17777);
    await relay.ready;
  });
  afterAll(() => relay.close());

  it("受理された数と、署名の正しくないイベントの拒否", async () => {
    const secret = generateSecretKey();
    const event = finalizeEvent(buildEvent(getPublicKey(secret), { mode: "post", body: "テスト" }, Math.floor(Date.now() / 1000)), secret);
    const result = await publish([relay.url], event);
    expect(result.accepted).toBe(1);
    expect(relay.events.has(event.id)).toBe(true);
    const broken = { ...event, content: "書き換え" };
    const rejected = await publish([relay.url], broken);
    expect(rejected.accepted).toBe(0);
    expect(rejected.relays.get(relay.url)?.state).toBe("rejected");
  });
});

describe("投稿の削除", () => {
  const me = "a".repeat(64);
  const other = "b".repeat(64);
  const note = (fields: Partial<Event>): Event => ({ id: "c".repeat(64), pubkey: me, created_at: 1, kind: 1, tags: [], content: "", sig: "", ...fields });

  it("e・k、記事には a も付ける。自分の投稿だけ", () => {
    expect(buildDeletion(note({}), me, 10)).toEqual({ kind: 5, created_at: 10, tags: [["e", "c".repeat(64)], ["k", "1"]], content: "" });
    expect(buildDeletion(note({ kind: 30023, tags: [["d", "hello"]] }), me, 10).tags).toContainEqual(["a", `30023:${me}:hello`]);
    expect(() => buildDeletion(note({ pubkey: other }), me, 10)).toThrow();
  });

  it("届けたい相手は引用の相手、なければ最初の p", () => {
    expect(addressee(note({ tags: [["p", other], ["q", "d".repeat(64), "", "e".repeat(64)]] }))).toBe("e".repeat(64));
    expect(addressee(note({ tags: [["p", me], ["p", other]] }))).toBe(other);
    expect(addressee(note({}))).toBeNull();
  });
});

describe("画像を付けた投稿", () => {
  it("本文の後ろに URL、imeta タグ。本文がなくても画像だけで送れる", () => {
    const me = "a".repeat(64);
    const media = [{ url: `https://blossom.band/${"c".repeat(64)}.jpg`, type: "image/jpeg", sha256: "c".repeat(64) }];
    const event = buildEvent(me, { mode: "post", body: "", media }, 1, { clientTag: false });
    expect(event.content).toBe(media[0].url);
    expect(event.tags).toContainEqual(["imeta", `url ${media[0].url}`, "m image/jpeg", `x ${"c".repeat(64)}`]);
    expect(() => buildEvent(me, { mode: "post", body: "x", media: [...media, ...media, ...media, ...media, ...media] }, 1)).toThrow();
  });
});

describe("本文のカスタム絵文字", () => {
  it("本文にある :名前: だけを emoji タグにする", () => {
    const me = "a".repeat(64);
    const customEmojis = [{ shortcode: "neko", url: "https://e.example/neko.png" }, { shortcode: "inu", url: "https://e.example/inu.png" }, { shortcode: "neko", url: "https://e.example/2.png" }];
    const event = buildEvent(me, { mode: "post", body: "かわいい :neko: :neko: :unknown:", customEmojis }, 1, { clientTag: false });
    expect(event.tags.filter((t) => t[0] === "emoji")).toEqual([["emoji", "neko", "https://e.example/neko.png"]]);
  });
});
