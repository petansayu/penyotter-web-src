import { describe, expect, it } from "vitest";
import type { Event } from "../nostr/events";
import { createRelaySet, editRelaySet, feedRelays, normalizeSetRelay, parseRelaySets } from "./relaySets";

const ME = "a".repeat(64);
let next = 0;
const set = (fields: Partial<Event>): Event =>
  ({ id: (next++).toString(16).padStart(64, "0"), pubkey: ME, created_at: 100, kind: 30002, tags: [["d", "s1"]], content: "", sig: "0".repeat(128), ...fields }) as Event;

describe("リレーセット（Android 版の RelaySets・RelaySetEditing と同じ）", () => {
  it("アドレスは wss だけ、最後の / は落とす", () => {
    expect(normalizeSetRelay(" wss://yabu.me/ ")).toBe("wss://yabu.me");
    expect(normalizeSetRelay("ws://yabu.me")).toBeNull();
    expect(normalizeSetRelay("wss://u:p@yabu.me")).toBeNull();
    expect(normalizeSetRelay("wss://yabu.me#x")).toBeNull();
  });
  it("識別子ごとのいちばん新しい版、名前は title か name か d、非公開のリレーは公開のものと別に", () => {
    const old = set({ created_at: 1, tags: [["d", "s1"], ["title", "古い"]] });
    const fresh = set({ created_at: 5, tags: [["d", "s1"], ["name", "日本"], ["relay", "wss://yabu.me/"], ["relay", "wss://yabu.me"]], content: "暗号文" });
    const plain = set({ tags: [["d", "s2"]] });
    const sets = parseRelaySets([old, fresh, plain], ME, (e) => (e.id === fresh.id ? [["relay", "wss://r.kojira.io"], ["relay", "wss://yabu.me"]] : []));
    expect(sets.map((s) => [s.title, s.relays, s.privateRelays])).toEqual([["s2", [], []], ["日本", ["wss://yabu.me"], ["wss://r.kojira.io"]]]);
    expect(sets[1].address).toBe(`30002:${ME}:s1`);
    const many = { ...sets[0], relays: Array.from({ length: 13 }, (_, i) => `wss://r${i}.test`) };
    expect(feedRelays(many)).toHaveLength(12);
  });
  it("作る・足す・外す・名前を変える。ほかのタグと content は残す", () => {
    expect(createRelaySet("s1", " 日本の  リレー ", ["wss://yabu.me/"], 10).tags).toEqual([["d", "s1"], ["title", "日本の リレー"], ["relay", "wss://yabu.me"]]);
    expect(() => createRelaySet("s1", "x", ["https://yabu.me"], 10)).toThrow("wss://");
    const base = set({ tags: [["d", "s1"], ["title", "日本"], ["relay", "wss://yabu.me"], ["x", "残す"]], content: "暗号文" });
    const added = editRelaySet(ME, base, { type: "add", relay: "wss://r.kojira.io/" }, 50);
    expect(added.tags).toEqual([["d", "s1"], ["title", "日本"], ["relay", "wss://yabu.me"], ["x", "残す"], ["relay", "wss://r.kojira.io"]]);
    expect(added.content).toBe("暗号文");
    expect(added.created_at).toBe(101);
    expect(editRelaySet(ME, base, { type: "add", relay: "wss://yabu.me/" }, 200).tags).toEqual(base.tags);
    expect(editRelaySet(ME, base, { type: "remove", relay: "wss://yabu.me/" }, 200).tags.some((t) => t[0] === "relay")).toBe(false);
    expect(editRelaySet(ME, base, { type: "rename", title: "新しい名前" }, 200).tags[1]).toEqual(["title", "新しい名前"]);
    expect(() => editRelaySet(ME, set({ pubkey: "b".repeat(64) }), { type: "rename", title: "x" }, 200)).toThrow("自分のリレーセットではありません");
  });
});
