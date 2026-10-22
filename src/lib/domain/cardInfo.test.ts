import { describe, expect, it } from "vitest";
import type { Event } from "../nostr/events";
import { clientName, contentWarning, isLongBody, latestStatuses, proxyOrigin, subjectToShow } from "./cardInfo";
import { encodeHidden, reactionHidden, reactionVisible, splitHidden, visibleText, withHiddenReaction } from "./hiddenMessages";

const A = "a".repeat(64);
const ev = (fields: Partial<Event>): Event => ({ id: "1".repeat(64), pubkey: A, created_at: 10, kind: 1, tags: [], content: "", sig: "", ...fields });

/** Android 版の HiddenMessages.encode と同じ書き方。 */
function encode(visible: string, message: string) {
  return visible + [...new TextEncoder().encode(message)].map((b) => String.fromCodePoint(b < 16 ? 0xfe00 + b : 0xe0100 + b - 16)).join("");
}

describe("投稿カードの付け足しの情報", () => {
  it("クライアント名は NIP-89 のアドレスとリレーが正しいときだけ", () => {
    expect(clientName(ev({ tags: [["client", "ぺにょったー", `31990:${A}:penyotter`, "wss://yabu.me"]] }))).toBe("ぺにょったー");
    expect(clientName(ev({ tags: [["client", "x"]] }))).toBeNull();
    expect(clientName(ev({ tags: [["client", "x", `31990:${A}:id`, "https://bad"]] }))).toBeNull();
  });

  it("注意書き・件名・橋渡し元", () => {
    expect(contentWarning(ev({ tags: [["content-warning", ""]] }))).toBe("センシティブな内容");
    expect(contentWarning(ev({ tags: [["content-warning", "ネタバレ"]] }))).toBe("ネタバレ");
    expect(contentWarning(ev({}))).toBeNull();
    expect(subjectToShow(ev({ tags: [["subject", " おしらせ  です "]] }), "本文")).toBe("おしらせ です");
    expect(subjectToShow(ev({ tags: [["subject", "おしらせ"]] }), "おしらせ\n本文")).toBeNull();
    expect(proxyOrigin(ev({ tags: [["proxy", "at://did:plc:abc/app.bsky.feed.post/3k", "atproto"]] }))).toEqual({ label: "Bluesky", url: "https://bsky.app/profile/did:plc:abc/post/3k" });
    expect(proxyOrigin(ev({ tags: [["proxy", "http://m.example/1", "activitypub"]] }))).toEqual({ label: "ActivityPub（Mastodon など）", url: null });
  });

  it("ステータスは general・music の最新で、期限切れと空は除く", () => {
    const status = (type: string, content: string, created_at: number, extra: string[][] = []) => ev({ kind: 30315, content, created_at, tags: [["d", type], ...extra], id: String(created_at).padStart(64, "0") });
    const events = [status("general", "古い", 1), status("general", "新しい", 2), status("music", "曲", 3, [["expiration", "5"]]), status("music", "", 4)];
    expect(latestStatuses(events, A, 4).map((s) => s.content)).toEqual(["新しい"]);
    expect(latestStatuses([status("music", "曲", 3, [["expiration", "5"]])], A, 4).map((s) => s.type)).toEqual(["music"]);
  });

  it("長い本文", () => {
    expect(isLongBody("a".repeat(421))).toBe(true);
    expect(isLongBody("a\n".repeat(8))).toBe(true);
    expect(isLongBody("短い")).toBe(false);
  });
});

describe("隠しメッセージ", () => {
  it("作ったものを読める（0〜15 は VS1〜16、16 からは VS17〜）", () => {
    const encoded = encodeHidden("🥟", "やあ\n\u0001");
    expect(splitHidden(`前 ${encoded} 後`)).toContainEqual({ type: "hidden", visible: "🥟", message: "やあ\n\u0001" });
    expect(encodeHidden("a", "\u0000")).toBe("a\u{FE00}");
  });

  it("見える文字の後ろのメッセージを読む", () => {
    const text = `こんにちは ${encode("🥟", "ひみつ")} またね`;
    expect(splitHidden(text)).toEqual([
      { type: "text", text: "こんにちは " },
      { type: "hidden", visible: "🥟", message: "ひみつ" },
      { type: "text", text: " またね" },
    ]);
    expect(visibleText(text)).toBe("こんにちは 🥟 またね");
  });

  it("ふつうの異体字セレクタ・IVS・壊れたものは対象外", () => {
    expect(splitHidden("❤️")).toEqual([{ type: "text", text: "❤️" }]);
    expect(splitHidden("葛\u{E0100}")).toEqual([{ type: "text", text: "葛\u{E0100}" }]);
    expect(splitHidden("x\u{E01EF}\u{E01EF}")).toEqual([{ type: "text", text: "x\u{E01EF}\u{E01EF}" }]);
    // 0〜15 を U+E00F0 からに置く書き方
    const shifted = "🥟" + [...new TextEncoder().encode("A\n")].map((b) => String.fromCodePoint(b < 16 ? 0xe00f0 + b : 0xe0100 + b - 16)).join("");
    expect(splitHidden(shifted)).toEqual([{ type: "hidden", visible: "🥟", message: "A\n" }]);
  });
});

describe("リアクションの隠しメッセージ", () => {
  it("❤️ の見た目の選択（U+FE0F）は絵文字の側に含める", () => {
    expect(splitHidden(encodeHidden("❤️", "やあ"))).toEqual([{ type: "hidden", visible: "❤️", message: "やあ" }]);
  });
  it("content 全体が「絵文字＋セレクタ」のときだけ。「+」は ❤️ にする", () => {
    expect(reactionHidden(withHiddenReaction("+", "ひみつ"))).toEqual({ visible: "❤️", message: "ひみつ" });
    expect(reactionHidden(withHiddenReaction(":pe:", "a"))).toEqual({ visible: ":pe:", message: "a" });
    expect(reactionHidden("❤️")).toBeNull();
    expect(reactionHidden(`あ ${encodeHidden("❤️", "x")}`)).toBeNull();
    expect(reactionVisible(withHiddenReaction("🎉", "おめでとう"))).toBe("🎉");
  });
});
