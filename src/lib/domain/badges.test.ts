import { describe, expect, it } from "vitest";
import type { Event } from "../nostr/events";
import { badgePairs, profileBadgeList, resolveBadges } from "./badges";

const OWNER = "a".repeat(64);
const ISSUER = "b".repeat(64);
const OTHER = "c".repeat(64);
const AWARD_ID = "1".repeat(64);
const ADDRESS = `30009:${ISSUER}:early`;
let n = 0;
const event = (e: Partial<Event>): Event => ({ id: String(++n).padStart(64, "0"), pubkey: OWNER, created_at: 100, kind: 1, tags: [], content: "", sig: "", ...e });

describe("バッジ（NIP-58）", () => {
  const list = event({ kind: 10008, tags: [["a", ADDRESS], ["e", AWARD_ID], ["e", "2".repeat(64)], ["a", `30009:${ISSUER}:lonely`]] });
  const definition = event({ kind: 30009, pubkey: ISSUER, tags: [["d", "early"], ["name", "はやおき"], ["image", "https://x.test/a.png"], ["thumb", "https://x.test/t32.png", "32x32"], ["thumb", "https://x.test/t64.png", "64x64"]] });

  it("一覧は a と e が続いているものだけ", () => {
    expect(badgePairs(list)).toEqual([[ADDRESS, AWARD_ID]]);
    expect(profileBadgeList([list, event({ kind: 30008, created_at: 200, tags: [["d", "other"]] })], OWNER)).toBe(list);
  });

  it("授与の作者が定義の作者で、a と p が合うものだけ。サムネイルは 64 以上でいちばん小さいもの", () => {
    const award = { ...event({ kind: 8, pubkey: ISSUER, tags: [["a", ADDRESS], ["p", OWNER]] }), id: AWARD_ID };
    expect(resolveBadges(OWNER, [[ADDRESS, AWARD_ID]], [award], [definition])).toMatchObject([{ name: "はやおき", thumb: "https://x.test/t64.png", image: "https://x.test/a.png" }]);
    expect(resolveBadges(OWNER, [[ADDRESS, AWARD_ID]], [{ ...award, pubkey: OTHER }], [definition])).toEqual([]);
    expect(resolveBadges(OWNER, [[ADDRESS, AWARD_ID]], [{ ...award, tags: [["a", ADDRESS], ["p", OTHER]] }], [definition])).toEqual([]);
    expect(resolveBadges(OWNER, [[ADDRESS, AWARD_ID]], [award], [])).toEqual([]);
  });
});
