/**
 * 投稿カレンダー（Android 版の PostCalendar）。その人が日ごとにどれだけ投稿したかを、週の列（日曜〜土曜）に
 * 並べて濃さで出す。日付は見ている人の端末の時刻で区切る。
 */

/** 何週分を出すか。 */
export const WEEKS = 12;

/** その時刻（秒）の、端末の時刻での日付（YYYY-MM-DD）。 */
export function dayKey(seconds: number): string {
  const date = new Date(seconds * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** 日付ごとの投稿の数。 */
export function countByDay(times: number[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const time of times) {
    const key = dayKey(time);
    result.set(key, (result.get(key) ?? 0) + 1);
  }
  return result;
}

/**
 * today を含む週までの weeks 週分の日付。週は日曜から土曜で、古い週から。today より後の日は null。各日は、その日の
 * 0 時（秒）。
 */
export function calendarWeeks(today: Date, weeks = WEEKS): (number | null)[][] {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end);
  start.setDate(end.getDate() - end.getDay() - (weeks - 1) * 7);
  const result: (number | null)[][] = [];
  for (let w = 0; w < weeks; w++) {
    const week: (number | null)[] = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
      week.push(day.getTime() > end.getTime() ? null : day.getTime() / 1000);
    }
    result.push(week);
  }
  return result;
}

/** 濃さ（0〜4）。0 件・1 件・2〜4 件・5〜9 件・10 件以上。 */
export function level(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count < 5) return 2;
  if (count < 10) return 3;
  return 4;
}
