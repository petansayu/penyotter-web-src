import { describe, expect, it } from "vitest";
import { calendarWeeks, countByDay, dayKey, level } from "./calendar";

describe("投稿カレンダー", () => {
  it("日付ごとに数える（端末の時刻で区切る）", () => {
    const noon = new Date(2026, 9, 20, 12).getTime() / 1000;
    const late = new Date(2026, 9, 20, 23, 59).getTime() / 1000;
    const next = new Date(2026, 9, 21, 0, 1).getTime() / 1000;
    expect(dayKey(noon)).toBe("2026-10-20");
    expect([...countByDay([noon, late, next])]).toEqual([["2026-10-20", 2], ["2026-10-21", 1]]);
  });

  it("週は日曜から土曜で古い週から。今日より後は空", () => {
    // 2026-10-21 は水曜日
    const weeks = calendarWeeks(new Date(2026, 9, 21, 15), 2);
    expect(weeks).toHaveLength(2);
    expect(dayKey(weeks[0][0]!)).toBe("2026-10-11");
    expect(dayKey(weeks[1][3]!)).toBe("2026-10-21");
    expect(weeks[1].slice(4)).toEqual([null, null, null]);
  });

  it("濃さは 0・1・2〜4・5〜9・10 以上", () => {
    expect([0, 1, 2, 4, 5, 9, 10, 50].map(level)).toEqual([0, 1, 2, 2, 3, 3, 4, 4]);
  });
});
