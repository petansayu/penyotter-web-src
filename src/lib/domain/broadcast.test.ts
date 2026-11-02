import { describe, expect, it } from "vitest";
import type { Event } from "../nostr/events";
import { broadcastRefusal } from "./broadcast";

const me = "a".repeat(64);
const other = "b".repeat(64);
const ev = (pubkey: string, tags: string[][] = []) => ({ id: "c".repeat(64), pubkey, created_at: 100, kind: 1, tags, content: "", sig: "" }) as Event;

describe("ブロードキャスト", () => {
  it("ほかの人の投稿も、自分の保護された投稿も送れる", () => {
    expect(broadcastRefusal(ev(other), me, new Set(), 200)).toBeNull();
    expect(broadcastRefusal(ev(me, [["-"]]), me, new Set(), 200)).toBeNull();
  });

  it("ほかの人の保護された投稿・期限切れ・削除が依頼されたものは送らない", () => {
    expect(broadcastRefusal(ev(other, [["-"]]), me, new Set(), 200)).toContain("保護された投稿");
    expect(broadcastRefusal(ev(other, [["expiration", "150"]]), me, new Set(), 200)).toContain("期限");
    expect(broadcastRefusal(ev(other), me, new Set(["c".repeat(64)]), 200)).toContain("削除");
  });
});
