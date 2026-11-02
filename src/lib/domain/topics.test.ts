import { describe, expect, it } from "vitest";
import type { Event } from "../nostr/events";
import { related } from "./probableFlow";
import { currentTopics, matching, scriptRuns, summarize, wordsOf } from "./topics";

const ev = (id: string, pubkey: string, created_at: number, content: string, tags: string[][] = []) =>
  ({ id, pubkey, created_at, content, tags, kind: 1, sig: "" }) as Event;
// テストは辞書を使わない区切り方（どの環境でも同じ結果になるように）
const of = (e: Event) => wordsOf(e.content, scriptRuns);

describe("投稿の言葉", () => {
  it("リンク・笑い・短いひらがなを除き、カスタム絵文字は数える", () => {
    const found = wordsOf("ラーメン食べたい www https://example.com/a.png nostr:npub1abc :pien: それな 東京駅", scriptRuns);
    expect(found.has("ラーメン")).toBe(true);
    expect(found.has("東京駅")).toBe(true);
    expect(found.has(":pien:")).toBe(true);
    expect([...found].some((w) => w.startsWith("http") || w.startsWith("nostr"))).toBe(false);
    expect(found.has("www")).toBe(false);
    expect(found.has("それな")).toBe(false);
  });

  it("活用が違っても同じ言葉、全角半角・大文字小文字も同じ", () => {
    expect(wordsOf("活力を取り戻した", scriptRuns)).toEqual(wordsOf("取り戻す活力", scriptRuns));
    expect(wordsOf("ＮＯＳＴＲ", scriptRuns)).toEqual(wordsOf("nostr", scriptRuns));
  });
});

describe("いまの話題", () => {
  it("投稿の数でなく人数で数える", () => {
    const now = 10_000;
    const events = [ev("1", "a", now - 60, "ラーメン"), ev("2", "a", now - 50, "ラーメン"), ev("3", "a", now - 40, "ラーメン"),
      ev("4", "b", now - 30, "地震だ"), ev("5", "c", now - 20, "地震こわい"), ev("6", "d", now - 10, "地震!")];
    const topics = currentTopics(events, now, 3600, of);
    expect(topics.map((t) => t.word)).toEqual(["地震"]);
    expect(topics[0].people).toBe(3);
  });

  it("毎日出る言葉は上がらない", () => {
    const now = 100_000;
    const usual = Array.from({ length: 20 }, (_, i) => i + 1).flatMap((h) => ["a", "b", "c"].map((p) => ev(`u${h}${p}`, p, now - 3600 - h * 3600, "おはよう")));
    const recent = ["a", "b", "c"].flatMap((p) => [ev(`o${p}`, p, now - 100, "おはよう"), ev(`t${p}`, p, now - 50, "停電")]);
    expect(currentTopics([...usual, ...recent], now, 3600, of).map((t) => t.word)).toEqual(["停電"]);
  });

  it("言葉で絞ると、その時間の投稿を古い順に", () => {
    const events = [ev("2", "b", 200, "花火"), ev("1", "a", 100, "花火"), ev("0", "a", 10, "花火"), ev("3", "c", 150, "ねこ")];
    expect(matching(events, "花火", 50, 300, of).map((e) => e.id)).toEqual(["1", "2"]);
  });
});

describe("直前の流れ", () => {
  it("話している人・話題の言葉・言葉の多い投稿・勢い", () => {
    const now = 10_000;
    const events = [ev("1", "a", now - 60, "花火きれい"), ev("2", "b", now - 50, "花火が見えた"), ev("3", "a", now - 40, "ねむい"), ev("4", "c", now - 1000, "昔の話")];
    const summary = summarize(events, now, 900, of);
    expect(summary.people).toEqual([["a", 2], ["b", 1]]);
    expect(summary.topics.map((t) => t.word)).toEqual(["花火"]);
    expect(new Set(summary.highlights.map((e) => e.id))).toEqual(new Set(["1", "2"]));
    expect([summary.count, summary.before]).toEqual([3, 1]);
  });
});

describe("たぶんこの流れ", () => {
  it("珍しい言葉が同じ投稿と、そこから広がった話題をつなぐ", () => {
    const seed = ev("s", "a", 1000, "駅前のラーメン屋が閉店してた");
    const others = [ev("1", "b", 1060, "え、あのラーメン屋閉店したの"), ev("2", "c", 1120, "閉店の貼り紙みた。駅前さみしい"),
      ev("3", "d", 1100, "今日の夕飯はカレー"), ev("4", "e", 1500, "猫がかわいい")];
    expect(related(seed, others, "normal", of).map((l) => l.event.id)).toEqual(["s", "1", "2"]);
  });

  it("選んだ投稿の人と受け答えしている短い投稿も拾う", () => {
    const seed = ev("s", "a", 1000, "新作ゲーム買った");
    const others = [ev("1", "b", 1030, "それな"), ev("2", "a", 1060, "わかる"), ev("3", "b", 1090, "ほんとそれ"), ev("4", "a", 1120, "でしょ"), ev("5", "c", 1050, "おなかすいた")];
    const ids = new Set(related(seed, others, "normal", of).map((l) => l.event.id));
    expect(ids.has("1") && ids.has("3")).toBe(true);
    expect(ids.has("5")).toBe(false);
  });

  it("返信は必ず入る", () => {
    const seed = ev("s", "a", 1000, "眠い");
    const others = [ev("1", "b", 1700, "わかります", [["e", "s"], ["p", "a"]])];
    expect(related(seed, others, "normal", of).map((l) => l.event.id)).toEqual(["s", "1"]);
  });
});
