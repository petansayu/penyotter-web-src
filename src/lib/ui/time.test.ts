import { describe, expect, it } from "vitest";
import { postTime } from "./time";

describe("投稿の時刻（Android 版の PostTime と同じ）", () => {
  const now = Date.UTC(2026, 9, 21, 12, 0, 0);
  const at = (secondsAgo: number) => now / 1000 - secondsAgo;
  it("相対", () => {
    expect(postTime(at(30), "relative", now)).toBe("いま");
    expect(postTime(at(59 * 60), "relative", now)).toBe("59分前");
    expect(postTime(at(3 * 3600), "relative", now)).toBe("3時間前");
    expect(postTime(at(2 * 86400), "relative", now)).toBe("2日前");
    expect(postTime(at(40 * 86400), "relative", now)).toBe("1か月前");
    expect(postTime(at(400 * 86400), "relative", now)).toBe("1年前");
  });
  it("絶対", () => {
    const local = new Date(2026, 0, 5, 9, 7).getTime() / 1000;
    expect(postTime(local, "absolute")).toBe("2026/1/5 9:07");
  });
});
