import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Event } from "nostr-tools";
import { readScope, saveScope } from "./db";
import { globalRelays, saveGlobalRelays } from "./global";
import { readRelaySetting, saveRelaySetting } from "./relaySettings";

const VIEWER = "c".repeat(64);
const event = (id: string): Event =>
  ({ id: id.repeat(64), pubkey: "b".repeat(64), created_at: 1, kind: 1, tags: [], content: "", sig: "0".repeat(128) }) as Event;

const memory = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => void memory.set(key, value),
  removeItem: (key) => void memory.delete(key),
  clear: () => memory.clear(),
  key: () => null,
  length: 0,
} as Storage;

beforeEach(() => memory.clear());

describe("リレーの設定", () => {
  it("1 行に 1 件、wss:// だけ、重複なし", () => {
    expect(saveRelaySetting("x", VIEWER, "wss://a.example/\n\nwss://a.example\nwss://b.example")).toEqual({ ok: true, relays: ["wss://a.example", "wss://b.example"] });
    expect(readRelaySetting("x", VIEWER, ["wss://default"])).toEqual(["wss://a.example", "wss://b.example"]);
    expect(saveRelaySetting("x", VIEWER, "wss://ok.example\nhttps://bad.example")).toEqual({ ok: false, line: "https://bad.example" });
    expect(readRelaySetting("y", VIEWER, ["wss://default"])).toEqual(["wss://default"]);
  });

  it("グローバルで読むリレーを変えたら、グローバルの保存分を消す", async () => {
    await saveScope(VIEWER, "global", [event("1")]);
    await saveScope(VIEWER, "home", [event("2")]);
    await saveGlobalRelays(VIEWER, "wss://yabu.me");
    expect(globalRelays(VIEWER)).toEqual(["wss://yabu.me"]);
    expect(await readScope(VIEWER, "global")).toEqual([]);
    expect((await readScope(VIEWER, "home")).length).toBe(1);
    // 同じ値なら消さない
    await saveScope(VIEWER, "global", [event("3")]);
    await saveGlobalRelays(VIEWER, "wss://yabu.me/");
    expect((await readScope(VIEWER, "global")).length).toBe(1);
  });
});
