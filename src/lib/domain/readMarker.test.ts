import type { Event } from "nostr-tools";
import { describe, expect, it } from "vitest";
import { beyond, lineIndex } from "./readMarker";

const card = (key: string, time: number) => ({ key, note: { id: key, created_at: time } as Event });
const cards = [card("c", 300), card("b", 200), card("a", 100)];

describe("ここまで読んだ（しおり）", () => {
  it("最後に見た投稿の上に線を引く", () => {
    expect(lineIndex(cards, { time: 200, key: "b" })).toBe(1);
    // 見た投稿がその後消えていても、それより古い投稿の上に引く
    expect(lineIndex(cards, { time: 150, key: "x" })).toBe(2);
  });

  it("新しい投稿がない・しおりがないときは引かない", () => {
    expect(lineIndex(cards, { time: 300, key: "c" })).toBeNull();
    expect(lineIndex(cards, null)).toBeNull();
    expect(lineIndex(cards, { time: 50, key: "z" })).toBeNull();
    expect(beyond(cards, { time: 50, key: "z" })).toBe(true);
    expect(beyond(cards, { time: 100, key: "a" })).toBe(false);
  });

  it("リポストはリポストした時刻で比べる", () => {
    const reposted = [{ key: "r", note: { id: "o", created_at: 10 } as Event, repost: { id: "r", created_at: 400 } as Event }, ...cards];
    expect(lineIndex(reposted, { time: 300, key: "c" })).toBe(1);
  });
});
