import { describe, expect, it } from "vitest";
import type { Event } from "../nostr/events";
import { earliestAfter, FIRST_SPAN, MAX_SPAN, nextSpan } from "./around";

const event = (id: string, created_at: number): Event => ({ id: id.padStart(64, "0"), pubkey: "a".repeat(64), created_at, kind: 1, tags: [], content: "", sig: "" });

describe("前後の投稿（直後を古いほうから読む）", () => {
  it("区切りの中から、古いほうから決まった数。足りたら最後の時刻から読み直す", () => {
    const events = [event("5", 150), event("3", 130), event("4", 140), event("1", 100), event("2", 120)];
    const { taken, next } = earliestAfter(events, 100, 3, new Set([event("1", 0).id]));
    expect(taken.map((e) => e.created_at)).toEqual([120, 130, 140]);
    expect(next).toBe(140);
    // 残りが少なければ、区切りの終わりまで使い切った（next は null）
    expect(earliestAfter(events, 145, 3, new Set()).next).toBeNull();
  });

  it("見つからなければ区切りを広げ、見つかったら最初の長さに戻す", () => {
    expect(nextSpan(FIRST_SPAN, false)).toBe(FIRST_SPAN * 4);
    expect(nextSpan(MAX_SPAN, false)).toBe(MAX_SPAN);
    expect(nextSpan(FIRST_SPAN * 16, true)).toBe(FIRST_SPAN);
  });
});
