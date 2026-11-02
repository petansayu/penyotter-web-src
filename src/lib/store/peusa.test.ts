import { describe, expect, it, vi } from "vitest";
import { PEUSA_CLEAR, PEUSA_FACES } from "./peusa-faces";
import { settings } from "./settings.svelte";

// 設定はブラウザの保存と画面の色に触れるので、テストでは値だけのものに置き換える
vi.mock("./settings.svelte", () => ({ settings: { peusaMode: false, peusaLevel: "medium" } }));
import { emojiTag } from "../domain/emojis";
import { encodeHidden, splitHidden } from "../domain/hiddenMessages";
import { PEUSA_PARTY, peusa, peusaAvatars, peusaClearOf, peusaFace, peusaFaceOf, peusaFailure, peusaMood, peusaStrong } from "./peusa.svelte";

describe("スーパーぺぇうさモード", () => {
  it("季節の顔", () => {
    expect([1, 4, 7, 10, 12].map(peusaFace)).toEqual(["peusa/face-winter.webp", "peusa/face-spring.webp", "peusa/face-summer.webp", "peusa/face-autumn.webp", "peusa/face-winter.webp"]);
  });
  it("ほかの人の顔は公開鍵で決まり、Android 版と同じ（Java の String.hashCode）", () => {
    const alice = "a".repeat(64);
    expect(peusaFaceOf(alice)).toBe(peusaFaceOf(alice));
    // "a" × 64 の hashCode は 1926890496（Java でも同じ）、95 で割った余りは 81 なので 82 番目の顔。Android 版の PeusaTest と同じ
    expect(PEUSA_FACES.length).toBe(95);
    expect(peusaFaceOf(alice)).toBe("peusa/face-peeusa-24.webp");
    expect(new Set(Array.from({ length: 3000 }, (_, i) => peusaFaceOf((i * 7919).toString(16).padStart(64, "0")))).size).toBe(95);
    // 季節の顔（自分のアイコン用）はほかの人には使わない
    expect(PEUSA_FACES).not.toContain("face-spring");
  });
  it("強さ（弱はアイコンそのまま、強はアプリのアイコンも）", () => {
    settings.peusaMode = true;
    settings.peusaLevel = "weak";
    expect([peusaAvatars(), peusaStrong()]).toEqual([false, false]);
    settings.peusaLevel = "medium";
    expect([peusaAvatars(), peusaStrong()]).toEqual([true, false]);
    settings.peusaLevel = "strong";
    expect([peusaAvatars(), peusaStrong()]).toEqual([true, true]);
    settings.peusaMode = false;
    expect([peusaAvatars(), peusaStrong()]).toEqual([false, false]);
    settings.peusaLevel = "medium";
  });
  it("タブとメニューのぺぇうさは背景を透明にした顔で、どれも違う（Android 版の Peusa.clearOf と同じ）", () => {
    expect(PEUSA_CLEAR.length).toBe(PEUSA_FACES.length);
    expect(new Set(Array.from({ length: 20 }, (_, i) => peusaClearOf(i))).size).toBe(20);
    expect(peusaClearOf(0)).toBe(`peusa/${PEUSA_CLEAR[0]}.webp`);
  });
  it("時間ごとのぺぇうさ", () => {
    expect(peusaMood(7, 0)).toBe("peusa/morning.webp");
    expect(peusaMood(12, 0)).toBe("peusa/hungry.webp");
    expect(peusaMood(19, 59)).toBe("peusa/hungry.webp");
    expect(peusaMood(23, 30)).toBe("peusa/sleepy2.webp");
    expect(peusaMood(3, 0)).toBe("peusa/sleepy.webp");
    expect(peusaMood(15, 0)).toBeNull();
  });
  it("受理されたときのぺぇうさ（まれにサプライズ）", () => {
    peusa.celebrate("posted", 3);
    expect(peusa.celebration?.picture).toBe("peusa/posted.webp");
    peusa.celebrate("reacted", 0);
    expect(peusa.celebration?.picture).toBe("peusa/haguki.webp");
  });
  it("隠しメッセージの :party_pe: はパックの住所付きの emoji タグで送る", () => {
    expect(emojiTag(PEUSA_PARTY)).toEqual(["emoji", "party_pe", PEUSA_PARTY.url, PEUSA_PARTY.set]);
    // 本文では絵文字の後ろにメッセージが続き、絵文字のあとの文は見える文字なしの隠しメッセージから始まる（Content が絵文字ごと囲む）
    const encoded = encodeHidden(":party_pe:", "ひみつ");
    expect(splitHidden(encoded.slice(":party_pe:".length))).toEqual([{ type: "hidden", visible: "", message: "ひみつ" }]);
  });
  it("うまくいかなかった知らせ", () => {
    expect(peusaFailure("ブロードキャストできませんでした")).toBe(true);
    expect(peusaFailure("書き込みリレーへ送りました")).toBe(false);
  });
});
