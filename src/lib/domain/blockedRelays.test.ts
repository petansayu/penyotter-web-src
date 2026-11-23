import { describe, expect, it, vi } from "vitest";
import type { Event } from "../nostr/events";
import { RelayPool, publish, pool } from "../nostr/pool";
import { blockAddress, blockedAddresses, relayKey, withBlockedRelay } from "./blockedRelays";

const list = (tags: string[][]): Event => ({ id: "1", pubkey: "a".repeat(64), created_at: 1, kind: 10006, tags, content: "", sig: "" });

describe("リレーのブロック（Android 版の BlockedRelaysTest と同じ）", () => {
  it("書き方が違っても同じリレーは同じ見分け", () => {
    const key = relayKey("wss://relay.example.com");
    expect(key).toBe("relay.example.com");
    for (const url of ["wss://Relay.Example.COM/", "ws://relay.example.com", "wss://relay.example.com:443", "ws://relay.example.com:80/", " wss://relay.example.com// "]) {
      expect(relayKey(url)).toBe(key);
    }
    expect(relayKey("wss://relay.example.com:4433/nostr/")).toBe("relay.example.com:4433/nostr");
    expect(relayKey("wss://relay.example.com/inbox")).not.toBe(key);
  });

  it("リレーのアドレスでなければ見分けはない", () => {
    for (const url of ["https://relay.example.com", "relay.example.com", "", "wss://user@relay.example.com"]) expect(relayKey(url)).toBeNull();
  });

  it("打ったアドレスに wss:// がなければ足す", () => {
    expect(blockAddress("Spam.Example/")).toBe("wss://spam.example");
    expect(blockAddress("ws://spam.example:8080")).toBe("ws://spam.example:8080");
    expect(blockAddress("https://spam.example")).toBeNull();
    expect(blockAddress("   ")).toBeNull();
  });

  it("一覧は relay タグだけを 1 回ずつ読み、変更はほかのタグを残す", () => {
    const event = list([["relay", "wss://a.example/"], ["relay", "ws://a.example"], ["relay", "https://web.example"], ["r", "wss://r.example"], ["relay", "wss://b.example"], ["x", "keep"]]);
    expect(blockedAddresses(event)).toEqual(["wss://a.example", "wss://b.example"]);
    expect(blockedAddresses({ ...event, kind: 10002 })).toEqual([]);
    expect(withBlockedRelay(event.tags, "WSS://A.example/", true)).toBe(event.tags);
    const removed = withBlockedRelay(event.tags, "wss://a.example", false);
    expect(removed.filter((t) => t[0] === "relay").map((t) => t[1])).toEqual(["https://web.example", "wss://b.example"]);
    expect(removed).toContainEqual(["x", "keep"]);
    expect(withBlockedRelay([], "spam.example", true)).toEqual([["relay", "wss://spam.example"]]);
  });

  it("ブロックしたリレーにはソケットを開かない", async () => {
    const opened = vi.fn();
    vi.stubGlobal("WebSocket", class { constructor() { opened(); } close() {} });
    try {
      const own = new RelayPool();
      own.block(["spam.example"]);
      expect(own.isBlocked("WSS://Spam.example/")).toBe(true);
      expect(own.status("ws://spam.example")).toBe("blocked");
      const fetched = await own.fetch(["wss://spam.example"], [{ kinds: [1] }]);
      expect(fetched.complete).toBe(false);
      own.subscribe(["wss://spam.example"], [{ kinds: [1] }], () => {})();
      pool.block(["spam.example"]);
      const result = await publish(["wss://spam.example"], list([]));
      expect(result.accepted).toBe(0);
      expect(result.relays.get("wss://spam.example")?.state).toBe("rejected");
      expect(opened).not.toHaveBeenCalled();
    } finally {
      pool.block([]);
      vi.unstubAllGlobals();
    }
  });
});
