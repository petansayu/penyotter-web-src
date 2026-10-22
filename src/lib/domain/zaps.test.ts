import { describe, expect, it } from "vitest";
import type { Event } from "../nostr/events";
import { buildZapRequest, checkZapInfo, lnurlOf, lnurlpEndpoint, parseLightningAddress } from "./zaps";

describe("zap", () => {
  it("Lightning アドレスを読み、LNURL にする", () => {
    const address = parseLightningAddress("Pe@Example.COM");
    expect(address).toEqual({ user: "Pe", domain: "example.com" });
    expect(lnurlpEndpoint(address)).toBe("https://example.com/.well-known/lnurlp/Pe");
    expect(lnurlOf("https://example.com/.well-known/lnurlp/Pe")).toMatch(/^lnurl1[02-9ac-hj-np-z]+$/);
    expect(() => parseLightningAddress("a@b.local")).toThrow();
    expect(() => parseLightningAddress("nope")).toThrow();
  });

  it("allowsNostr と nostrPubkey と金額の範囲を確かめる", () => {
    const info = { allowsNostr: true, nostrPubkey: "a".repeat(64), minSendable: 1000, maxSendable: 100000, callback: "https://x.test/cb" };
    expect(checkZapInfo(info, 21000)).toEqual({ callback: "https://x.test/cb" });
    expect(() => checkZapInfo({ ...info, allowsNostr: false }, 21000)).toThrow();
    expect(() => checkZapInfo(info, 500000)).toThrow();
  });

  it("relays・amount・lnurl・p・e・k", () => {
    const note = { id: "1".repeat(64), pubkey: "b".repeat(64), kind: 1 } as Event;
    expect(buildZapRequest(note, 21000, "lnurl1x", ["wss://a", "wss://a", "wss://b"], "ありがとう", 5).tags).toEqual([
      ["relays", "wss://a", "wss://b"], ["amount", "21000"], ["lnurl", "lnurl1x"], ["p", note.pubkey], ["e", note.id], ["k", "1"],
    ]);
  });
});
