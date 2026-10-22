import { describe, expect, it } from "vitest";
import type { Event } from "../nostr/events";
import { buildChannel, buildMessage, channelMeta, chatPlacement, joinedChannels, messageChannel, messageReplyTo } from "./chat";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const ev = (fields: Partial<Event>): Event => ({ id: C, pubkey: A, created_at: 100, kind: 1, tags: [], content: "", sig: "", ...fields });

describe("パブリックチャット", () => {
  it("チャンネルの情報は作成者の更新のいちばん新しいものを重ねる", () => {
    const create = ev({ kind: 40, content: JSON.stringify({ name: "ぺにょ", about: "説明", relays: ["wss://yabu.me/", "http://bad"] }) });
    const update = (pubkey: string, created_at: number, content: object) => ev({ id: String(created_at).padStart(64, "0"), kind: 41, pubkey, created_at, tags: [["e", C]], content: JSON.stringify(content) });
    expect(channelMeta(create)).toEqual({ name: "ぺにょ", about: "説明", picture: null, relays: ["wss://yabu.me"] });
    const meta = channelMeta(create, [update(A, 200, { name: "新しい名前" }), update(A, 150, { name: "古い" }), update(B, 300, { name: "ほかの人" })]);
    expect(meta.name).toBe("新しい名前");
    expect(meta.about).toBe("説明");
    expect(channelMeta(ev({ kind: 40, content: "壊れた" })).name).toBe("（名前のないチャンネル）");
  });

  it("メッセージのチャンネルと返信先、組み立て", () => {
    const message = ev({ kind: 42, tags: [["e", B, "", "reply"], ["e", C, "wss://r", "root"]] });
    expect(messageChannel(message)).toBe(C);
    expect(messageReplyTo(message)).toBe(B);
    const reply = ev({ id: B, pubkey: B, kind: 42 });
    expect(buildMessage(C, "wss://r", "こんにちは", 5, reply, false)).toEqual({
      kind: 42, created_at: 5, content: "こんにちは",
      tags: [["e", C, "wss://r", "root"], ["e", B, "wss://r", "reply"], ["p", B, "wss://r"]],
    });
    expect(() => buildMessage(C, "", " ", 5)).toThrow();
  });

  it("チャンネルを作る・参加中", () => {
    const channel = buildChannel(" 雑談 ", "", ["wss://yabu.me/", "wss://yabu.me", "ws://x"], 9);
    expect(JSON.parse(channel.content)).toEqual({ name: "雑談", about: "", relays: ["wss://yabu.me"] });
    expect(() => buildChannel("x", "", [], 9)).toThrow();
    expect(joinedChannels(ev({ kind: 10005, tags: [["e", B, "wss://r"], ["e", "bad"], ["p", A]] }))).toEqual([B]);
  });

  it("吹き出しの並べ方（5 分以内の同じ人はまとめ、日が変わると区切り）", () => {
    const m = (pubkey: string, created_at: number) => ev({ pubkey, created_at });
    const day = Date.UTC(2026, 9, 21, 12) / 1000;
    const placement = chatPlacement([m(A, day), m(A, day + 100), m(B, day + 150), m(B, day + 1000), m(B, day + 86400)], 0);
    expect(placement.map((p) => p.grouped)).toEqual([false, true, false, false, false]);
    expect(placement.map((p) => p.day)).toEqual(["2026/10/21", null, null, null, "2026/10/22"]);
  });
});
