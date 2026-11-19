import { describe, expect, it } from "vitest";
import type { Event } from "../nostr/events";
import { notificationGroups, shownAsNotification } from "./notifications";
import { decodeWatches, MAX_PEOPLE, putWatch, watchMatch, watchWords, type WatchRule } from "./watchedPosts";

const ME = "a".repeat(64);
const PODCASTER = "b".repeat(64);
const OTHER = "c".repeat(64);
let next = 1;
const post = (content: string, fields: Partial<Event> = {}): Event =>
  ({ id: (next++).toString(16).padStart(64, "0"), pubkey: PODCASTER, created_at: 2000, kind: 1, tags: [], content, sig: "0".repeat(128), ...fields }) as Event;
const rule = (fields: Partial<WatchRule> = {}): WatchRule => ({ pubkey: PODCASTER, mode: "links", words: [], replies: false, since: 1000, ...fields });

describe("投稿のお知らせ", () => {
  it("リンクを含む投稿は、画像・動画ではない Web のリンクがあるもの", () => {
    expect(watchMatch(post("第12回を公開しました https://example.com/ep12"), ME, [rule()])).not.toBeNull();
    expect(watchMatch(post("今日はいい天気"), ME, [rule()])).toBeNull();
    expect(watchMatch(post("写真 https://example.com/a.jpg"), ME, [rule()])).toBeNull();
  });

  it("選んだ時刻より前と、返信（選ばなければ）は出さない", () => {
    expect(watchMatch(post("https://example.com", { created_at: 999 }), ME, [rule()])).toBeNull();
    const reply = post("返信 https://example.com", { tags: [["e", "d".repeat(64), "", "reply"]] });
    expect(watchMatch(reply, ME, [rule()])).toBeNull();
    expect(watchMatch(reply, ME, [rule({ replies: true })])).not.toBeNull();
  });

  it("言葉は大文字小文字・全角半角・カタカナひらがなを区別せず、t タグも見る", () => {
    const rules = [rule({ mode: "words", words: ["ぺにょラジオ", "#podcast"] })];
    expect(watchMatch(post("ペニョラジオ 更新"), ME, rules)).not.toBeNull();
    expect(watchMatch(post("新しい回", { tags: [["t", "Podcast"]] }), ME, rules)).not.toBeNull();
    expect(watchMatch(post("#ＰＯＤＣＡＳＴ"), ME, rules)).not.toBeNull();
    expect(watchMatch(post("関係ない話"), ME, rules)).toBeNull();
  });

  it("ほかの人・自分・ほかの種類は出さない", () => {
    expect(watchMatch(post("https://example.com", { pubkey: OTHER }), ME, [rule({ mode: "all" })])).toBeNull();
    expect(watchMatch(post("+", { kind: 7 }), ME, [rule({ mode: "all" })])).toBeNull();
    expect(watchMatch(post("x", { pubkey: ME }), ME, [rule({ pubkey: ME, mode: "all", since: 0 })])).toBeNull();
  });

  it("入力の言葉・保存の形・上限", () => {
    expect(watchWords("a, b、c  d\ne f")).toEqual(["a", "b", "c", "d", "e"]);
    const rules = [rule({ mode: "words", words: ["番組"], replies: true }), rule({ pubkey: OTHER, since: 5 })];
    expect(decodeWatches(JSON.stringify(rules))).toEqual(rules);
    expect(decodeWatches("壊れた")).toEqual([]);
    const changed = putWatch([rule()], rule({ mode: "all", since: 9999 }));
    expect(changed).toEqual([rule({ mode: "all" })]);
    const full = Array.from({ length: MAX_PEOPLE }, (_, i) => rule({ pubkey: i.toString(16).padStart(64, "0") }));
    expect(() => putWatch(full, rule())).toThrow();
    expect(() => putWatch([], rule({ mode: "words" }))).toThrow();
  });

  it("通知では 1 件ずつのカードになり、ミュートが優先する", () => {
    const watches = [rule()];
    const update = post("更新 https://example.com/ep");
    const mention = post("@you https://example.com", { tags: [["p", ME]] });
    const keys = (options: Parameters<typeof notificationGroups>[2]) => notificationGroups([update, mention], ME, options).map((g) => g.key).sort();
    expect(keys({ type: "all", watches })).toEqual([`reply:${mention.id}`, `watch:${update.id}`].sort());
    expect(keys({ type: "posts", watches })).toEqual([`watch:${update.id}`]);
    // 「フォロー中」はふつうの通知だけを絞る
    expect(keys({ type: "all", follows: new Set(), watches })).toEqual([`watch:${update.id}`]);
    expect(keys({ type: "all", muted: new Set([PODCASTER]), watches })).toEqual([]);
    expect(keys({ type: "all", words: { words: new Set(["更新"]), hashtags: new Set() }, watches: [rule()] })).toEqual([`reply:${mention.id}`]);
    expect(shownAsNotification(update, ME, watches)).toBe(true);
    expect(shownAsNotification(update, ME, [])).toBe(false);
  });
});
