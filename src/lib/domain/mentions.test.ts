import { describe, expect, it } from "vitest";
import { nip19 } from "nostr-tools";
import { insertMention, mentionCandidates, mentionQuery, normalize } from "./mentions";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

describe("メンションの補完", () => {
  it("@ のあとを語として読む。メールアドレスと空白は除く", () => {
    expect(mentionQuery("こんにちは @ぺ", 8)).toEqual({ start: 6, end: 8, text: "ぺ" });
    expect(mentionQuery("＠abc", 4)?.text).toBe("abc");
    expect(mentionQuery("me@example", 10)).toBeNull();
    expect(mentionQuery("@ab cd", 6)).toBeNull();
    expect(mentionQuery("@", 1)?.text).toBe("");
  });

  it("カタカナ・ひらがな、全角・半角、大文字・小文字を区別しない", () => {
    expect(normalize("ペェ")).toBe(normalize("ぺぇ"));
    expect(normalize("ＡＢＣ")).toBe("abc");
  });

  it("先頭 → 単語の先頭 → 途中の順、同じならフォロー中を先に", () => {
    const people = [
      { pubkey: A, displayName: "まぬぺ" },
      { pubkey: B, name: "pe_robo", displayName: "ぺぇロボ" },
      { pubkey: C, displayName: "ペぇ" },
    ];
    expect(mentionCandidates("ぺ", people, new Set([C])).map((p) => p.pubkey)).toEqual([C, B, A]);
    expect(mentionCandidates("robo", people, new Set()).map((p) => p.pubkey)).toEqual([B]);
    expect(mentionCandidates(nip19.npubEncode(A).slice(0, 9), people, new Set()).map((p) => p.pubkey)).toEqual([A]);
  });

  it("選ぶと nostr:npub と空白を入れる", () => {
    const query = mentionQuery("やあ @ぺ", 5)!;
    const result = insertMention("やあ @ぺ", query, A);
    expect(result.text).toBe(`やあ nostr:${nip19.npubEncode(A)} `);
    expect(result.cursor).toBe(result.text.length);
  });
});
