import { describe, expect, it } from "vitest";
import type { Event } from "../nostr/events";
import { createPack, editPack, newPackIdentifier, ownPacks, packEmojis, packTitle, suggestedShortcode, validEmoji } from "./emojiPackEditing";

const ME = "a".repeat(64);
const OTHER = "b".repeat(64);
let next = 0;
const pack = (fields: Partial<Event>): Event =>
  ({ id: (next++).toString(16).padStart(64, "0"), pubkey: ME, created_at: 100, kind: 30030, tags: [["d", "p1"], ["title", "前の名前"]], content: "", sig: "0".repeat(128), ...fields }) as Event;

describe("自分の絵文字パック（Android 版の EmojiPackEditing と同じ）", () => {
  it("作る: d と title。名前の空白は 1 つにまとめ、空や長すぎる名前は断る", () => {
    expect(createPack("p1", "  ぺぇ   うさ ", 10)).toEqual({ kind: 30030, created_at: 10, tags: [["d", "p1"], ["title", "ぺぇ うさ"]], content: "" });
    expect(() => createPack("p1", " ", 10)).toThrow("パックの名前");
    expect(() => createPack("p1", "x".repeat(101), 10)).toThrow("100 文字");
    expect(newPackIdentifier(36, 0x1_0010)).toBe("penyotter-10-g");
  });
  it("足す・外す・名前を変える。知らないタグと content は残し、時刻は前の版より後", () => {
    const base = pack({ tags: [["d", "p1"], ["title", "前の名前"], ["x-other", "残す"]], content: "秘密" });
    const added = editPack(ME, base, { type: "add", shortcode: "pe", url: "https://x.test/pe.png" }, 50);
    expect(added.tags).toEqual([["d", "p1"], ["title", "前の名前"], ["x-other", "残す"], ["emoji", "pe", "https://x.test/pe.png"]]);
    expect(added.content).toBe("秘密");
    expect(added.created_at).toBe(101);
    const withEmoji = { ...base, tags: added.tags };
    expect(() => editPack(ME, withEmoji, { type: "add", shortcode: "pe", url: "https://x.test/other.png" }, 200)).toThrow("もうあります");
    expect(editPack(ME, withEmoji, { type: "add", shortcode: "pe", url: "https://x.test/pe.png" }, 200).tags).toEqual(added.tags);
    expect(editPack(ME, withEmoji, { type: "remove", shortcode: "pe", url: "https://x.test/pe.png" }, 200).tags.some((t) => t[0] === "emoji")).toBe(false);
    expect(editPack(ME, base, { type: "rename", title: "新しい名前" }, 200).tags[1]).toEqual(["title", "新しい名前"]);
    expect(editPack(ME, pack({ tags: [["d", "p1"]] }), { type: "rename", title: "名前" }, 200).tags).toEqual([["d", "p1"], ["title", "名前"]]);
    expect(() => editPack(ME, pack({ pubkey: OTHER }), { type: "rename", title: "x" }, 200)).toThrow("自分の絵文字パックではありません");
    expect(() => editPack(ME, base, { type: "add", shortcode: "空白 あり", url: "https://x.test/a.png" }, 200)).toThrow("名前");
  });
  it("絵文字の名前と画像、ファイル名からの名前の候補", () => {
    expect(validEmoji("party_pe", "https://x.test/a.gif")).toBe(true);
    expect(validEmoji("party_pe", "http://x.test/a.gif")).toBe(false);
    expect(validEmoji("ぺ", "https://x.test/a.gif")).toBe(false);
    expect(suggestedShortcode("ぺぇうさ smile.v2.png")).toBe("smile_v2");
    expect(suggestedShortcode("party-cat.gif")).toBe("party-cat");
  });
  it("自分のパックの、識別子ごとのいちばん新しい版（新しい順）", () => {
    const old = pack({ created_at: 1 });
    const fresh = pack({ created_at: 5, tags: [["d", "p1"], ["title", "新"], ["emoji", "a", "https://x.test/a.png"]] });
    const second = pack({ created_at: 3, tags: [["d", "p2"]] });
    const others = pack({ pubkey: OTHER, created_at: 9 });
    expect(ownPacks([old, fresh, second, others], ME).map((p) => p.id)).toEqual([fresh.id, second.id]);
    expect(packTitle(second)).toBe("p2");
    expect(packEmojis(fresh)).toEqual([{ shortcode: "a", url: "https://x.test/a.png" }]);
  });
});
