import { describe, expect, it } from "vitest";
import { finalizeEvent, generateSecretKey } from "nostr-tools";
import { acceptable } from "./events";

describe("届いたイベントの確かめ", () => {
  // リレーから届くものと同じく JSON から作る（finalizeEvent の結果には「確かめ済み」の印が付いていて、写すと引き継がれる）
  const event = JSON.parse(JSON.stringify(finalizeEvent({ kind: 1, created_at: 1000, tags: [], content: "やあ" }, generateSecretKey())));
  const filters = [{ kinds: [1] }];

  it("同じイベントが何度届いても通す。署名を確かめたあとでも、中身や署名を変えたものは通さない", () => {
    expect(acceptable({ ...event }, filters, 2000)).toBe(true);
    expect(acceptable({ ...event }, filters, 2000)).toBe(true);
    expect(acceptable({ ...event, content: "ちがう" }, filters, 2000)).toBe(false);
    expect(acceptable({ ...event, sig: "0".repeat(128) }, filters, 2000)).toBe(false);
    expect(acceptable({ ...event, kind: 7 }, filters, 2000)).toBe(false);
  });
});
