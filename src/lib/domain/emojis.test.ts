import { describe, expect, it } from "vitest";
import type { Event } from "nostr-tools";
import { PALETTE, reactionDisplay, resolveCatalog, setReferences } from "./emojis";
import { buildEvent } from "./publishing";

const ME = "a".repeat(64);
const SETTER = "b".repeat(64);
const event = (fields: Partial<Event>): Event =>
  ({ id: "1".repeat(64), pubkey: ME, created_at: 1, kind: 1, tags: [], content: "", sig: "0".repeat(128), ...fields }) as Event;

describe("カスタム絵文字の一覧", () => {
  it("直接のものとセットのもの。古い版のセット・壊れたものは使わない", () => {
    const list = event({ kind: 10030, tags: [
      ["emoji", "pe", "https://e.example/pe.png"],
      ["emoji", "bad name", "https://e.example/x.png"],
      ["emoji", "http", "http://e.example/x.png"],
      ["a", `30030:${SETTER}:cats`],
      ["a", "30030:short:x"],
    ] });
    const old = event({ kind: 30030, pubkey: SETTER, created_at: 1, tags: [["d", "cats"], ["emoji", "old", "https://e.example/old.png"]] });
    const latest = event({ id: "2".repeat(64), kind: 30030, pubkey: SETTER, created_at: 2, tags: [["d", "cats"], ["emoji", "neko", "https://e.example/neko.png"], ["emoji", "pe", "https://e.example/pe.png"]] });
    expect(setReferences(list)).toEqual([{ author: SETTER, identifier: "cats" }]);
    expect(resolveCatalog(list, [old, latest])).toEqual([
      { shortcode: "pe", url: "https://e.example/pe.png" },
      { shortcode: "neko", url: "https://e.example/neko.png" },
    ]);
  });

  it("パレットは Android 版と同じ 36 個", () => {
    expect(PALETTE).toHaveLength(36);
    expect(PALETTE[0]).toEqual({ text: "😊", label: "笑顔" });
  });
});

describe("絵文字のリアクション", () => {
  const target = event({ id: "3".repeat(64), pubkey: SETTER });

  it("標準の絵文字とカスタム絵文字", () => {
    expect(buildEvent(ME, { mode: "like", body: "🎉", target }, 1, { clientTag: false })).toMatchObject({ kind: 7, content: "🎉" });
    const custom = buildEvent(ME, { mode: "like", body: ":neko:", target, emoji: { shortcode: "neko", url: "https://e.example/neko.png" } }, 1, { clientTag: false });
    expect(custom.tags).toContainEqual(["emoji", "neko", "https://e.example/neko.png"]);
    expect(() => buildEvent(ME, { mode: "like", body: ":neko:", target }, 1)).toThrow("画像");
    expect(() => buildEvent(ME, { mode: "like", body: "長い 文", target }, 1)).toThrow("1 つ選んで");
  });

  it("見せ方", () => {
    expect(reactionDisplay(event({ kind: 7, content: "+" }))).toEqual({ type: "like" });
    expect(reactionDisplay(event({ kind: 7, content: "🎉" }))).toEqual({ type: "text", text: "🎉" });
    expect(reactionDisplay(event({ kind: 7, content: ":neko:", tags: [["emoji", "neko", "https://e.example/neko.png"]] })))
      .toEqual({ type: "image", url: "https://e.example/neko.png", shortcode: "neko" });
  });
});
