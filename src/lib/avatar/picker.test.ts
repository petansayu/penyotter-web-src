import { describe, expect, it } from "vitest";
import { nip19 } from "nostr-tools";
import { art, chooseAvatar, normalize } from "./picker";

// 期待値は Android 版の AvatarPickerTest と同じ（Node で別に計算した値）
const fiatjaf = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";

describe("chooseAvatar", () => {
  it("Android 版と同じものを選ぶ", () => {
    expect(chooseAvatar(fiatjaf)).toEqual({ character: 7, palette: 15, expression: 1, accent: 0 });
    expect(chooseAvatar("0".repeat(63) + "1")).toEqual({ character: 26, palette: 18, expression: 0, accent: null });
    expect(chooseAvatar("f".repeat(64))).toEqual({ character: 24, palette: 12, expression: 2, accent: null });
    expect(art.characters[chooseAvatar(fiatjaf)!.character].slug).toBe("futaba");
  });

  it("npub・大文字・空白でも同じ", () => {
    const npub = nip19.npubEncode(fiatjaf);
    const expected = chooseAvatar(fiatjaf);
    expect(normalize(npub)).toBe(fiatjaf);
    expect(chooseAvatar(npub)).toEqual(expected);
    expect(chooseAvatar(`  ${fiatjaf.toUpperCase()} `)).toEqual(expected);
    expect(chooseAvatar(npub.toUpperCase())).toEqual(expected);
  });

  it("不正な鍵は null", () => {
    for (const bad of ["", "   ", "abc", "g".repeat(64), "a".repeat(63), "npub1", "npub1qqqqqqqq",
      nip19.npubEncode(fiatjaf).slice(0, -1) + "x", "nsec1" + "q".repeat(58)]) {
      expect(chooseAvatar(bad)).toBeNull();
    }
  });

  it("定義の形", () => {
    expect(art.version).toBe("penyotter-avatar-v1");
    expect(art.characters).toHaveLength(30);
    expect(art.characters[16].slug).toBe("shizukumochi");
    expect(art.characters[20].slug).toBe("kuragemochi");
  });
});
