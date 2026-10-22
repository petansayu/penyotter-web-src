import { describe, expect, it } from "vitest";
import type { Event } from "../nostr/events";
import { confirmReason, diffTags, nextCreatedAt, restoreList, suspiciousDrop, withoutTag, withTag } from "./lists";

const hex = (n: number) => n.toString(16).padStart(64, "0");
const list = (tags: string[][], created_at = 100, content = ""): Event => ({ id: hex(999), pubkey: hex(1), created_at, kind: 3, tags, content, sig: "" });
const people = (n: number, from = 10) => Array.from({ length: n }, (_, i) => ["p", hex(from + i)]);

describe("置き換え可能な一覧", () => {
  it("差はタグの名前と値で比べる（p はリレーのヒントやペットネームを見ない）", () => {
    const before = [["p", hex(1), "wss://a.example", "ねこ"], ["t", "nostr"], ["emoji", "neko", "https://a.example/1.png"]];
    const after = [["p", hex(1)], ["t", "nostr"], ["emoji", "neko", "https://a.example/2.png"], ["p", hex(2)]];
    const diff = diffTags(before, after);
    expect(diff.added).toEqual([["emoji", "neko", "https://a.example/2.png"], ["p", hex(2)]]);
    expect(diff.removed).toEqual([["emoji", "neko", "https://a.example/1.png"]]);
  });

  it("確認を求める条件", () => {
    expect(confirmReason(undefined, [["p", hex(1)]], true)).toBe("missing");
    expect(confirmReason(list(people(1)), [], true)).toBe("emptied");
    expect(confirmReason(list(people(10)), people(9), true)).toBeNull();
    expect(confirmReason(list(people(100)), people(95), false)).toBe("many-removed");
    expect(confirmReason(list(people(10)), people(8), false)).toBe("many-removed");
    expect(confirmReason(list(people(20)), people(19), false)).toBeNull();
    expect(confirmReason(list(people(20)), people(18), false)).toBeNull();
  });

  it("大きく減った版", () => {
    expect(suspiciousDrop(list(people(5)), list([]))).toBe(true);
    expect(suspiciousDrop(list(people(4)), list([]))).toBe(false);
    expect(suspiciousDrop(list(people(20)), list(people(10)))).toBe(true);
    expect(suspiciousDrop(list(people(30)), list(people(20)))).toBe(false);
  });

  it("足す・外すはほかのタグを残す", () => {
    const tags = [["p", hex(1), "", "ねこ"], ["unknown", "x"]];
    expect(withTag(tags, ["p", hex(1)])).toBe(tags);
    expect(withTag(tags, ["p", hex(2)])).toEqual([...tags, ["p", hex(2)]]);
    expect(withoutTag(tags, "p", hex(1))).toEqual([["unknown", "x"]]);
    expect(nextCreatedAt(50, list([], 100))).toBe(101);
    expect(nextCreatedAt(500, list([], 100))).toBe(500);
  });

  it("復元", () => {
    const current = list([["p", hex(1)], ["p", hex(2)]], 200, "今");
    const old = list([["p", hex(2)], ["p", hex(3)], ["d", "x"]], 100, "昔");
    expect(restoreList(current, old, "merge", 150)).toMatchObject({ created_at: 201, content: "今", tags: [["p", hex(1)], ["p", hex(2)], ["p", hex(3)]] });
    expect(restoreList(current, old, "exact", 300)).toMatchObject({ created_at: 300, content: "昔", tags: old.tags });
  });
});
