/**
 * 投稿の時刻（Android 版の PostTime）。相対なら「いま」「N分前」「N時間前」「N日前」「Nか月前」「N年前」、
 * 絶対なら「YYYY/M/D H:mm」。
 */
export function postTime(seconds: number, mode: "relative" | "absolute" = "relative", now = Date.now()): string {
  if (mode === "absolute") {
    const date = new Date(seconds * 1000);
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  const elapsed = Math.max(0, Math.floor(now / 1000 - seconds));
  if (elapsed < 60) return "いま";
  if (elapsed < 3_600) return `${Math.floor(elapsed / 60)}分前`;
  if (elapsed < 86_400) return `${Math.floor(elapsed / 3_600)}時間前`;
  if (elapsed < 2_592_000) return `${Math.floor(elapsed / 86_400)}日前`;
  if (elapsed < 31_536_000) return `${Math.floor(elapsed / 2_592_000)}か月前`;
  return `${Math.floor(elapsed / 31_536_000)}年前`;
}

export function fullTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString("ja-JP");
}
