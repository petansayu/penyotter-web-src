import { describe, expect, it } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey, nip44, type EventTemplate } from "nostr-tools";
import { buildFileRumor, buildInbox, buildLegacyDm, buildRumor, conversationPeer, decryptFile, encryptFile, fileOf, giftWrap, inboxRelays, randomPast, sealTemplate, unwrap } from "./dm";

/** 秘密鍵で署名役の代わりをする（テストだけ）。 */
function localCipher(secret: Uint8Array) {
  return {
    pubkey: getPublicKey(secret),
    encrypt: async (peer: string, text: string) => nip44.v2.encrypt(text, nip44.v2.utils.getConversationKey(secret, peer)),
    decrypt: async (peer: string, text: string) => nip44.v2.decrypt(text, nip44.v2.utils.getConversationKey(secret, peer)),
    sign: (template: EventTemplate) => finalizeEvent(template, secret),
  };
}

const alice = localCipher(generateSecretKey());
const bob = localCipher(generateSecretKey());
const NOW = 1_800_000_000;

async function send(from: typeof alice, to: string, body: string) {
  const rumor = buildRumor(from.pubkey, to, body, NOW);
  const seal = from.sign(await sealTemplate(rumor, to, from.encrypt, NOW));
  return { rumor, wrap: giftWrap(seal, to, NOW) };
}

describe("DM（NIP-17）", () => {
  it("包んで開ける。受け取る人だけが開ける", async () => {
    const { rumor, wrap } = await send(alice, bob.pubkey, "こんにちは");
    expect(wrap.kind).toBe(1059);
    expect(wrap.pubkey).not.toBe(alice.pubkey);
    expect(wrap.tags).toEqual([["p", bob.pubkey]]);
    expect(wrap.created_at).toBeLessThanOrEqual(NOW);
    expect(wrap.created_at).toBeGreaterThan(NOW - 2 * 24 * 3600 - 1);
    const opened = await unwrap(wrap, bob.decrypt);
    expect(opened).toEqual(rumor);
    expect(await unwrap(wrap, alice.decrypt)).toBeNull();
  });

  it("自分宛ての控えは自分で開ける", async () => {
    const { rumor, wrap } = await send(alice, alice.pubkey, "控え");
    expect((await unwrap(wrap, alice.decrypt))?.content).toBe(rumor.content);
  });

  it("seal の作者と rumor の作者が違うものは捨てる", async () => {
    const forged = { ...buildRumor(bob.pubkey, alice.pubkey, "なりすまし", NOW) };
    const seal = alice.sign({ kind: 13, created_at: NOW, tags: [], content: await alice.encrypt(bob.pubkey, JSON.stringify(forged)) });
    expect(await unwrap(giftWrap(seal, bob.pubkey, NOW), bob.decrypt)).toBeNull();
  });

  it("壊れた gift wrap は捨てる", async () => {
    const secret = generateSecretKey();
    const junk = finalizeEvent({ kind: 1059, created_at: NOW, tags: [["p", bob.pubkey]], content: nip44.v2.encrypt("not json", nip44.v2.utils.getConversationKey(secret, bob.pubkey)) }, secret);
    expect(await unwrap(junk, bob.decrypt)).toBeNull();
  });

  it("受信リレー・会話の相手・時刻", () => {
    expect(inboxRelays({ id: "", pubkey: "", sig: "", kind: 10050, created_at: 0, content: "", tags: [["relay", "wss://a.example/"], ["relay", "ws://bad"], ["relay", "wss://b.example"], ["relay", "wss://c.example"], ["relay", "wss://d.example"]] }))
      .toEqual(["wss://a.example", "wss://b.example", "wss://c.example"]);
    expect(buildInbox(["wss://a.example"], 5).tags).toEqual([["relay", "wss://a.example"]]);
    expect(() => buildInbox(["http://x"], 5)).toThrow();
    expect(conversationPeer({ pubkey: alice.pubkey, tags: [["p", bob.pubkey]] }, alice.pubkey)).toBe(bob.pubkey);
    expect(conversationPeer({ pubkey: bob.pubkey, tags: [["p", alice.pubkey]] }, alice.pubkey)).toBe(bob.pubkey);
    expect(conversationPeer({ pubkey: bob.pubkey, tags: [["p", alice.pubkey], ["p", "c".repeat(64)]] }, alice.pubkey)).toBeNull();
    expect(randomPast(NOW, () => 0)).toBe(NOW);
  });
});

describe("DM のファイル（kind 15）と旧方式", () => {
  const ME = "a".repeat(64);
  const PEER = "b".repeat(64);
  it("AES-256-GCM で暗号化して開ける。ハッシュが違えば開かない", async () => {
    const data = new TextEncoder().encode("ひみつのファイル");
    const sealed = await encryptFile(data);
    expect(sealed.key).toMatch(/^[0-9a-f]{64}$/);
    expect(sealed.nonce).toMatch(/^[0-9a-f]{24}$/);
    expect(new TextDecoder().decode(await decryptFile(sealed.ciphertext, sealed))).toBe("ひみつのファイル");
    await expect(decryptFile(sealed.ciphertext, { ...sealed, x: "0".repeat(64) })).rejects.toThrow();
  });
  it("rumor のタグを書いて読める", () => {
    const rumor = buildFileRumor(ME, PEER, { url: "https://x.test/f", type: "image/png", key: "ab", nonce: "cd", x: "e".repeat(64), ox: "f".repeat(64), size: 3 }, 10);
    expect(rumor.kind).toBe(15);
    expect(fileOf(rumor)).toEqual({ url: "https://x.test/f", type: "image/png", key: "ab", nonce: "cd", x: "e".repeat(64), ox: "f".repeat(64), size: 3 });
    expect(fileOf({ ...rumor, content: "http://x" })).toBeNull();
    expect(buildLegacyDm(PEER, "enc", 1)).toEqual({ kind: 4, created_at: 1, tags: [["p", PEER]], content: "enc" });
  });
});
