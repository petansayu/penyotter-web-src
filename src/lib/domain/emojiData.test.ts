import { describe, expect, it } from "vitest";
import { groupEmojis, insertAt, searchEmojis, withRecent, type EmojiEntry } from "./emojiData";

const entries: EmojiEntry[] = [
  { unicode: "🐰", label: "ウサギの顔", group: 3, order: 2, tags: ["うさぎ", "動物"] },
  { unicode: "🐇", label: "ウサギ", group: 3, order: 1, tags: ["うさぎ"] },
  { unicode: "😊", label: "笑顔", group: 0, order: 1, tags: ["にこにこ"] },
  { unicode: "🏻", label: "肌の色1", group: 2, order: 1 },
  { unicode: "🇦", label: "地域指標 A" },
];

describe("絵文字ピッカー", () => {
  it("種類ごとに並び順で（部品と種類なしは出さない）", () => {
    const groups = groupEmojis(entries);
    expect(groups.get(3)?.map((e) => e.unicode)).toEqual(["🐇", "🐰"]);
    expect(groups.has(2)).toBe(false);
  });

  it("名前とタグで探す（ひらがな・カタカナ、全角・半角を区別しない）", () => {
    expect(searchEmojis(entries, "うさぎ").map((e) => e.unicode)).toEqual(["🐇", "🐰"]);
    expect(searchEmojis(entries, "ﾆｺﾆｺ").map((e) => e.unicode)).toEqual(["😊"]);
    expect(searchEmojis(entries, "肌")).toEqual([]);
    expect(searchEmojis(entries, " ")).toEqual([]);
  });

  it("最近使ったもの", () => {
    expect(withRecent(["😊", "🐰"], "🐰")).toEqual(["🐰", "😊"]);
  });

  it("カーソルの位置に入れる（サロゲートペアの途中には入れない）", () => {
    expect(insertAt("ab", 1, 1, "🐰")).toEqual({ text: "a🐰b", cursor: 3 });
    expect(insertAt("a🐰b", 2, 2, "!")).toEqual({ text: "a🐰!b", cursor: 4 });
    expect(insertAt("abc", 2, 0, "X")).toEqual({ text: "Xc", cursor: 1 });
    expect(insertAt("abc", 0, 0, "XY", 4)).toBeNull();
  });
});
