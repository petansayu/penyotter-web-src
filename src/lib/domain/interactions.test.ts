import { describe, expect, it } from "vitest";
import type { Event } from "nostr-tools";
import { compact, countInteractions, deletedBy, deletionKeys, ownActions, reactionTarget } from "./interactions";

const AUTHOR = "a".repeat(64);
const OTHER = "b".repeat(64);
const NOTE = "1".repeat(64);
let next = 0;
const event = (fields: Partial<Event>): Event =>
  ({ id: (next++).toString(16).padStart(64, "0"), pubkey: OTHER, created_at: 1, kind: 1, tags: [], content: "", sig: "0".repeat(128), ...fields }) as Event;

describe("countInteractions", () => {
  it("返信・リポスト・リアクションを数える", () => {
    const events = [
      event({ kind: 1, tags: [["e", NOTE, "", "root"]] }),
      event({ kind: 1111, tags: [["E", NOTE], ["e", NOTE]] }),
      event({ kind: 1, tags: [["e", NOTE, "", "root"], ["e", "2".repeat(64), "", "reply"]] }), // 返信の返信は数えない
      event({ kind: 6, tags: [["e", NOTE]] }),
      event({ kind: 16, tags: [["e", NOTE], ["k", "1"]] }),
      event({ kind: 7, content: "+", tags: [["e", "3".repeat(64)], ["e", NOTE]] }),
      event({ kind: 7, content: "+", tags: [["e", NOTE], ["e", "3".repeat(64)]] }), // 最後の e が別の投稿
    ];
    expect(countInteractions([NOTE], events, true).get(NOTE)).toEqual({ replies: 2, reposts: 2, reactions: 1, complete: true });
  });

  it("本人が取り消したものは数えず、ほかの人の kind 5 は無視する", () => {
    const mine = event({ kind: 7, pubkey: OTHER, tags: [["e", NOTE]] });
    const kept = event({ kind: 7, pubkey: "c".repeat(64), tags: [["e", NOTE]] });
    const undo = event({ kind: 5, pubkey: OTHER, tags: [["e", mine.id]] });
    const stranger = event({ kind: 5, pubkey: AUTHOR, tags: [["e", kept.id]] });
    const result = countInteractions([NOTE], [mine, kept, undo, stranger, kept], false).get(NOTE);
    expect(result).toEqual({ replies: 0, reposts: 0, reactions: 1, complete: false });
  });

  it("リアクション先は最後の e", () => {
    expect(reactionTarget(event({ kind: 7, tags: [["e", "3".repeat(64)], ["e", NOTE]] }))).toBe(NOTE);
    expect(reactionTarget(event({ kind: 1, tags: [["e", NOTE]] }))).toBeNull();
  });
});

describe("削除の依頼", () => {
  it("作者本人の kind 5 だけ", () => {
    const note = event({ id: NOTE, pubkey: AUTHOR });
    expect(deletedBy(deletionKeys([event({ kind: 5, pubkey: OTHER, tags: [["e", NOTE]] })]), note)).toBe(false);
    expect(deletedBy(deletionKeys([event({ kind: 5, pubkey: AUTHOR, tags: [["e", NOTE]] })]), note)).toBe(true);
  });
});

describe("compact", () => {
  it("Android 版と同じ書き方", () => {
    expect([0, 7, 999, 1_000, 1_250, 12_345, 999_999, 1_250_000, 12_000_000].map(compact))
      .toEqual(["", "7", "999", "1.0K", "1.2K", "12K", "999K", "1.2M", "12M"]);
  });
});

describe("ownActions", () => {
  it("自分の新しいリアクション・リポストを拾い、取り消したものは除く", () => {
    const old = event({ kind: 7, pubkey: AUTHOR, created_at: 1, tags: [["e", NOTE]] });
    const latest = event({ kind: 7, pubkey: AUTHOR, created_at: 2, tags: [["e", NOTE]] });
    const repost = event({ kind: 6, pubkey: AUTHOR, tags: [["e", NOTE]] });
    const undone = event({ kind: 16, pubkey: AUTHOR, tags: [["e", "9".repeat(64)]] });
    const undo = event({ kind: 5, pubkey: AUTHOR, tags: [["e", undone.id]] });
    const someone = event({ kind: 7, pubkey: OTHER, tags: [["e", "8".repeat(64)]] });
    const result = ownActions([old, latest, repost, undone, undo, someone], AUTHOR);
    expect(result.reactions.get(NOTE)?.id).toBe(latest.id);
    expect(result.reposts.get(NOTE)?.id).toBe(repost.id);
    expect(result.reposts.has("9".repeat(64))).toBe(false);
    expect(result.reactions.has("8".repeat(64))).toBe(false);
    expect(result.removed).toEqual(new Set([undone.id]));
  });
});
