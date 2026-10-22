import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { verifyEvent } from "nostr-tools";
import { startTestRelay } from "../../../scripts/test-relay.mjs";
import { startTestBunker } from "../../../scripts/test-bunker.mjs";
import { connectRemote, forgetRemote, parseBunker, remoteState, resumeRemote, startNostrConnect } from "./remoteSigner";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  };
}
globalThis.localStorage = memoryStorage();
globalThis.sessionStorage = memoryStorage();

describe("parseBunker", () => {
  it("bunker:// だけを受け付け、wss:// のリレーだけを使う", async () => {
    const pubkey = "a".repeat(64);
    expect(await parseBunker(`bunker://${pubkey}?relay=wss://relay.example/&relay=ws://insecure.example&secret=x`))
      .toEqual({ pubkey, relays: ["wss://relay.example"], secret: "x" });
    await expect(parseBunker("nsec1abc")).rejects.toThrow("秘密鍵");
    await expect(parseBunker("https://example.com")).rejects.toThrow("bunker://");
    await expect(parseBunker(`bunker://${pubkey}?relay=ws://insecure.example`)).rejects.toThrow("リレー");
  });
});

describe("リモート署名（手元のテスト用リレーと bunker）", () => {
  let relay: { url: string; close: () => Promise<void>; ready: Promise<void> };
  let bunker: { pubkey: string; uri: string; close: () => void; acceptNostrConnect: (uri: string) => Promise<void> };
  const pointer = () => {
    const url = new URL(bunker.uri.replace("bunker://", "https://"));
    return { pubkey: bunker.pubkey, relays: [relay.url], secret: url.searchParams.get("secret") };
  };

  beforeAll(async () => {
    relay = startTestRelay(17778);
    await relay.ready;
    bunker = startTestBunker(relay.url);
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
  afterAll(async () => {
    bunker.close();
    await relay.close();
  });
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("記憶しないときはタブの間だけ（sessionStorage）。つなぎ直して署名できる", async () => {
    const signer = await connectRemote(pointer(), false);
    expect(signer.pubkey).toBe(bunker.pubkey);
    expect(remoteState(signer.pubkey)).toBe("tab");
    expect(localStorage.length).toBe(0);
    const signed = await resumeRemote(signer.pubkey)!.sign({ kind: 1, created_at: 1, tags: [], content: "テスト" });
    expect(signed.pubkey).toBe(bunker.pubkey);
    expect(verifyEvent(signed)).toBe(true);
  }, 20_000);

  it("記憶するときは localStorage。消すと、つなぎ直せない", async () => {
    const signer = await connectRemote(pointer(), true);
    expect(remoteState(signer.pubkey)).toBe("remembered");
    expect(sessionStorage.length).toBe(0);
    forgetRemote(signer.pubkey);
    expect(remoteState(signer.pubkey)).toBeNull();
    expect(resumeRemote(signer.pubkey)).toBeNull();
  }, 20_000);

  it("nostrconnect:// を出し、署名アプリが承認したらつながって署名できる", async () => {
    const session = startNostrConnect(false, [relay.url]);
    expect(session.uri).toMatch(/^nostrconnect:\/\/[0-9a-f]{64}\?/);
    expect(new URL(session.uri.replace("nostrconnect://", "https://")).searchParams.get("name")).toBe("ぺにょったー Web");
    await new Promise((resolve) => setTimeout(resolve, 300));
    await bunker.acceptNostrConnect(session.uri);
    const signer = await session.done;
    expect(signer.pubkey).toBe(bunker.pubkey);
    expect(remoteState(signer.pubkey)).toBe("tab");
    const signed = await signer.sign({ kind: 1, created_at: 1, tags: [], content: "nostrconnect のテスト" });
    expect(verifyEvent(signed)).toBe(true);
  }, 20_000);

  it("待つのをやめたら、つながない", async () => {
    const session = startNostrConnect(false, [relay.url]);
    session.cancel();
    await expect(session.done).rejects.toThrow("待つのをやめました");
  }, 20_000);

  it("secret が違えば、つながない", async () => {
    await expect(connectRemote({ ...pointer(), secret: "wrong" }, false)).rejects.toThrow("つなげませんでした");
  }, 20_000);
});
