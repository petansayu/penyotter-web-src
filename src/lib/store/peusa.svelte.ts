/**
 * スーパーぺぇうさモード（Android 版の Peusa）。利用者のオリジナルキャラクター「ぺぇうさ」が出てくるお遊びのモード。
 * 変わるのはこのブラウザの画面だけで、投稿やプロフィールなど、ほかの人に見えるものは何も変えない（自分で送る隠しメッセージの絵文字 PEUSA_PARTY だけは例外）。絵は
 * public/peusa/*.webp（scripts/export-peusa.mjs で Android 版の design/peusa から書き出す）。
 */
import type { CustomEmoji } from "../domain/emojis";
import { PEUSA_CLEAR, PEUSA_FACES } from "./peusa-faces";
import { settings } from "./settings.svelte";

export const peusaPicture = (name: string) => `peusa/${name}.webp`;

/**
 * 隠しメッセージ（セクシー餃子）の🐇の代わりに使う、パーティーのぺぇうさ（penpenpng さんの絵文字パック pemoji の
 * :party_pe:。絵はアプリに入れず、パックの URL を読む）。投稿にはパックの住所付きの emoji タグを付ける。
 */
export const PEUSA_PARTY: CustomEmoji = {
  shortcode: "party_pe",
  url: "https://image.nostr.build/a289ef25d237a5f617226c815f9cfd91d9b561686f0c9773945016a9f35975ad.gif",
  set: "30030:8c59239319637f97e007dad0d681e65ce35b1ace333b629e2d33f9465c132608:pemoji",
};

/** 季節の顔（耳の飾り）。自分のアイコンに使う。 */
export function peusaFace(month: number): string {
  if (month >= 3 && month <= 5) return peusaPicture("face-spring");
  if (month >= 6 && month <= 8) return peusaPicture("face-summer");
  if (month >= 9 && month <= 11) return peusaPicture("face-autumn");
  return peusaPicture("face-winter");
}

/**
 * ほかの人の顔（PEUSA_FACES から、その人の公開鍵で決める。同じ人はいつも同じ顔）。Android 版の Peusa.faceOf と同じ計算
 * （Java の String.hashCode を顔の数で割った余り）なので、どちらの版でも同じ顔になる。
 */
export function peusaFaceOf(pubkey: string): string {
  let hash = 0;
  for (let i = 0; i < pubkey.length; i++) hash = (Math.imul(31, hash) + pubkey.charCodeAt(i)) | 0;
  return peusaPicture(PEUSA_FACES[((hash % PEUSA_FACES.length) + PEUSA_FACES.length) % PEUSA_FACES.length]);
}

/** みんなのアイコンをぺぇうさにするか（モードがオンで、中か強）。 */
export const peusaAvatars = () => settings.peusaMode && settings.peusaLevel !== "weak";
/** アプリのアイコン（タブ・メニュー・チャンネル）もぺぇうさにするか（モードがオンで、強）。 */
export const peusaStrong = () => settings.peusaMode && settings.peusaLevel === "strong";

/**
 * アプリのアイコン（タブ・メニュー）の代わりの、背景を透明にしたぺぇうさ（slot 番目。Android 版の Peusa.clearOf と同じ
 * 選び方で、9 つずつ離して選ぶので、顔の数より少ない番号どうしは重ならない）。
 */
export function peusaClearOf(slot: number): string {
  return peusaPicture(PEUSA_CLEAR[(((slot * 9) % PEUSA_CLEAR.length) + PEUSA_CLEAR.length) % PEUSA_CLEAR.length]);
}

/** 背景を透明にしたぺぇうさのどれか（強のモードで、画面の端からのぞく）。 */
export const peusaClearRandom = () => peusaPicture(PEUSA_CLEAR[Math.floor(Math.random() * PEUSA_CLEAR.length)]);

/** 時間ごとのぺぇうさ（画面の上に出す）。朝・お昼と夜ごはん・夜ふかし。ほかの時間は null。 */
export function peusaMood(hour: number, minute: number): string | null {
  const at = hour * 60 + minute;
  if (at >= 5 * 60 && at < 9 * 60) return peusaPicture("morning");
  if ((at >= 11 * 60 + 30 && at < 13 * 60 + 30) || (at >= 18 * 60 && at < 20 * 60)) return peusaPicture("hungry");
  if (at >= 23 * 60 || at < 2 * 60) return peusaPicture("sleepy2");
  if (at >= 2 * 60 && at < 5 * 60) return peusaPicture("sleepy");
  return null;
}

/** 知らせの文が、うまくいかなかったことを言っているか（「なんてこと!!」を添える）。 */
export const peusaFailure = (message: string) => ["できません", "できなかった", "失敗", "拒否", "見つかりません", "読めません", "未確認"].some((w) => message.includes(w));

export type Celebration = "posted" | "reacted" | "reposted";
/** 受理されたときのぺぇうさが、サプライズになる割合（何回に 1 回）。 */
export const SURPRISE_ONE_IN = 10;
const CELEBRATION_PICTURE: Record<Celebration, string> = { posted: "posted", reacted: "reacted-noChar", reposted: "reposted" };

/** 受理されたときのぽんと出るぺぇうさと、オンにしたときのお祝い。 */
class PeusaEvents {
  celebration = $state<{ picture: string; at: number } | null>(null);
  unlocking = $state(false);
  /** roll が 0 のとき（10 回に 1 回くらい）は、サプライズで歯ぐきを見せるぺぇうさ。 */
  celebrate(kind: Celebration, roll = Math.floor(Math.random() * SURPRISE_ONE_IN)) {
    this.celebration = { picture: peusaPicture(roll === 0 ? "haguki" : CELEBRATION_PICTURE[kind]), at: Date.now() };
  }
}
export const peusa = new PeusaEvents();
