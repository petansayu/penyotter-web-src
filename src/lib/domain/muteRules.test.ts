import { describe, expect, it } from "vitest";
import { muteRules, mutedByWords, parsePrivateTags } from "./muteRules";
import { notificationGroups } from "./notifications";
import type { Event } from "../nostr/events";

const ME = "a".repeat(64);
const OTHER = "b".repeat(64);
const POST = "1".repeat(64);

describe("ミュート一覧の言葉・ハッシュタグ・非公開の分（NIP-51、Android 版の MuteList.rules と同じ）", () => {
  it("公開と非公開のタグを合わせて読み、言葉とハッシュタグは小文字にそろえる", () => {
    const hidden = parsePrivateTags(JSON.stringify([["p", OTHER], ["word", " Spoiler "], ["t", "NSFW"]]));
    const rules = muteRules([["e", POST], ["word", ""], ["p", "zz"], ...hidden]);
    expect([...rules.pubkeys]).toEqual([OTHER]);
    expect([...rules.events]).toEqual([POST]);
    expect([...rules.words]).toEqual(["spoiler"]);
    expect([...rules.hashtags]).toEqual(["nsfw"]);
    expect(parsePrivateTags("読めない")).toEqual([]);
  });
  it("本文の言葉（大文字小文字を問わない）と t タグで当たる", () => {
    const rules = { words: new Set(["spoiler"]), hashtags: new Set(["nsfw"]) };
    expect(mutedByWords({ content: "これは SPOILER です", tags: [] }, rules)).toBe(true);
    expect(mutedByWords({ content: "ふつう", tags: [["t", "NSFW"]] }, rules)).toBe(true);
    expect(mutedByWords({ content: "ふつう", tags: [["t", "art"]] }, rules)).toBe(false);
  });
  it("通知の返信・メンションにも当てる（リアクションには当てない）", () => {
    const event = (id: string, kind: number, content: string): Event =>
      ({ id, pubkey: OTHER, created_at: 1, kind, tags: [["p", ME], ["e", POST]], content, sig: "0".repeat(128) }) as Event;
    const groups = notificationGroups([event("2".repeat(64), 1, "spoiler だよ"), event("3".repeat(64), 1, "ふつう"), event("4".repeat(64), 7, "spoiler")], ME,
      { type: "all", words: { words: new Set(["spoiler"]), hashtags: new Set() } });
    expect(groups.flatMap((g) => g.events.map((e) => e.id)).sort()).toEqual(["3".repeat(64), "4".repeat(64)]);
  });
});
