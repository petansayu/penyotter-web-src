import type { PublishResult } from "../nostr/pool";

/** 送った結果の知らせ（技術資料 4.5）。 */
export function summary(result: PublishResult): string {
  const total = result.relays.size;
  if (total === 0) return "送り先のリレーがありません。";
  if (result.accepted > 0) return `${result.accepted}/${total} リレーが受理しました`;
  const values = [...result.relays.values()];
  const rejected = values.filter((value) => value.state === "rejected");
  if (values.some((value) => value.state === "unknown")) return "受理を確認できませんでした（届いている可能性があります）。再送できます。";
  return `受理されませんでした（${rejected.map((value) => value.message || "理由なし").slice(0, 2).join("、")}）。再送できます。`;
}
