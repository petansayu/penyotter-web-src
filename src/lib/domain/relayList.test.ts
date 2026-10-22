import { describe, expect, it } from "vitest";
import type { Event } from "../nostr/events";
import { buildRelayList, relayChanges, relayEntries, relayProblem } from "./relayList";

const list = (tags: string[][], created_at = 100, content = ""): Event => ({ id: "1".repeat(64), pubkey: "a".repeat(64), created_at, kind: 10002, tags, content, sig: "" });

describe("リレーリストの編集", () => {
  it("r タグを読む（同じ URL はまとめる、知らない印は使わない）", () => {
    const entries = relayEntries(list([
      ["r", "wss://yabu.me/"],
      ["r", "wss://nos.lol", "read"],
      ["r", "wss://nos.lol", "write"],
      ["r", "wss://r.kojira.io", "write"],
      ["r", "wss://x.example", "other"],
      ["r", "https://bad.example"],
      ["alt", "relay list"],
    ]));
    expect(entries).toEqual([
      { url: "wss://yabu.me", read: true, write: true },
      { url: "wss://nos.lol", read: true, write: true },
      { url: "wss://r.kojira.io", read: false, write: true },
    ]);
  });

  it("公開できるか", () => {
    expect(relayProblem([{ url: "wss://a.example", read: true, write: false }])).toMatch(/書き込み/);
    expect(relayProblem([{ url: "wss://a.example", read: false, write: true }])).toMatch(/読み込み/);
    expect(relayProblem([{ url: "ws://a.example", read: true, write: true }])).toMatch(/wss/);
    const many = Array.from({ length: 13 }, (_, i) => ({ url: `wss://r${i}.example`, read: true, write: i === 0 }));
    expect(relayProblem(many)).toMatch(/12/);
    expect(relayProblem([{ url: "wss://a.example", read: true, write: true }])).toBeNull();
  });

  it("次の版は r 以外のタグと content を残し、時刻は前の版より後", () => {
    const base = list([["r", "wss://old.example"], ["alt", "x"]], 500, "メモ");
    const next = buildRelayList(base, [
      { url: "wss://a.example/", read: true, write: true },
      { url: "wss://b.example", read: true, write: false },
      { url: "wss://c.example", read: false, write: true },
      { url: "wss://d.example", read: false, write: false },
    ], 100);
    expect(next).toEqual({ kind: 10002, created_at: 501, content: "メモ", tags: [["r", "wss://a.example"], ["r", "wss://b.example", "read"], ["r", "wss://c.example", "write"], ["alt", "x"]] });
  });

  it("違い", () => {
    expect(relayChanges(
      [{ url: "wss://a.example", read: true, write: true }, { url: "wss://b.example", read: true, write: false }],
      [{ url: "wss://a.example", read: true, write: false }, { url: "wss://c.example", read: true, write: true }],
    )).toEqual([
      { url: "wss://a.example", before: "読み書き", after: "読み込み" },
      { url: "wss://b.example", before: "読み込み", after: "なし" },
      { url: "wss://c.example", before: "なし", after: "読み書き" },
    ]);
  });
});
