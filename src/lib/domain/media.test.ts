import { describe, expect, it } from "vitest";
import { blossomAlternatives, buildBlossomServers, buildFileMetadata, buildMediaPost, checkNip96Response, checkUploadResponse, imetaTags, isNip96, normalizeServer, uploadAuth, withAttachments } from "./media";

const SHA = "a".repeat(64);
const OTHER = "b".repeat(64);

describe("画像の投稿", () => {
  it("投稿先は https のオリジンだけ", () => {
    expect(normalizeServer("https://blossom.band/")).toBe("https://blossom.band");
    expect(normalizeServer("http://blossom.band")).toBeNull();
    expect(normalizeServer("https://a.example/upload")).toBeNull();
    expect(normalizeServer("https://user:pw@a.example")).toBeNull();
    expect(normalizeServer("http://127.0.0.1:7779", "http://127.0.0.1:7779")).toBe("http://127.0.0.1:7779");
  });

  it("応答を確かめる（変換して別のハッシュで返すサーバーも、URL にそのハッシュがあればよい）", () => {
    expect(checkUploadResponse("https://blossom.band", { url: `https://cdn.blossom.band/${OTHER}.webp`, sha256: OTHER, type: "image/webp", size: 10 }, "image/jpeg", 99))
      .toEqual({ url: `https://cdn.blossom.band/${OTHER}.webp`, sha256: OTHER, type: "image/webp", size: 10 });
    expect(checkUploadResponse("https://blossom.band", { url: `https://blossom.band/${SHA}`, sha256: SHA }, "image/png", 5)).toMatchObject({ type: "image/png", size: 5 });
    expect(() => checkUploadResponse("https://blossom.band", { url: `https://evil.example/${SHA}`, sha256: SHA }, "image/png", 5)).toThrow(/サーバー/);
    expect(() => checkUploadResponse("https://blossom.band", { url: `http://blossom.band/${SHA}`, sha256: SHA }, "image/png", 5)).toThrow();
    expect(() => checkUploadResponse("https://blossom.band", { url: `https://blossom.band/x.png`, sha256: SHA }, "image/png", 5)).toThrow(/ハッシュ/);
    expect(() => checkUploadResponse("https://blossom.band", { url: `https://blossom.band/${SHA}` }, "image/png", 5)).toThrow();
    expect(checkUploadResponse("http://127.0.0.1:7779", { url: `http://127.0.0.1:7779/${SHA}.png`, sha256: SHA }, "image/png", 5).url).toContain("127.0.0.1");
  });

  it("本文の後ろに URL、imeta、認可", () => {
    const a = { url: `https://blossom.band/${SHA}.jpg`, type: "image/jpeg", sha256: SHA, size: 3, dim: "10x20" };
    expect(withAttachments("こんにちは\n", [a])).toBe(`こんにちは\n${a.url}`);
    expect(withAttachments("  ", [a, a])).toBe(`${a.url}\n${a.url}`);
    expect(imetaTags([a])).toEqual([["imeta", `url ${a.url}`, "m image/jpeg", `x ${SHA}`, "size 3", "dim 10x20"]]);
    expect(uploadAuth(SHA, "photo.jpg", 100)).toEqual({ kind: 24242, created_at: 100, tags: [["t", "upload"], ["x", SHA], ["expiration", "400"]], content: "Upload photo.jpg" });
  });
});

describe("NIP-96・画像の投稿・サーバー一覧", () => {
  const a = { url: "https://x.test/" + "a".repeat(64) + ".jpg", type: "image/jpeg", sha256: "a".repeat(64), size: 10, dim: "2x3" };
  it("NIP-96 の応答（nip94_event）を読む", () => {
    expect(checkNip96Response({ status: "success", nip94_event: { tags: [["url", a.url], ["ox", "b".repeat(64)], ["m", "image/png"]] } }, "image/jpeg", 5, "c".repeat(64)))
      .toMatchObject({ url: a.url, sha256: "b".repeat(64), type: "image/png", size: 5 });
    expect(() => checkNip96Response({ status: "error", message: "だめ" }, "image/jpeg", 5, "c")).toThrow("だめ");
    expect(isNip96("https://nostr.build")).toBe(true);
    expect(isNip96("https://blossom.band")).toBe(false);
  });
  it("kind 1063・kind 20・kind 10063・代わりの URL", () => {
    expect(buildFileMetadata(a, 1).tags).toEqual([["url", a.url], ["m", "image/jpeg"], ["x", a.sha256], ["size", "10"], ["dim", "2x3"]]);
    const post = buildMediaPost(20, " 説明 ", [a], 100, 3600);
    expect(post.content).toBe("説明");
    expect(post.tags).toEqual([["imeta", `url ${a.url}`, "m image/jpeg", `x ${a.sha256}`, "dim 2x3"], ["m", "image/jpeg"], ["x", a.sha256], ["expiration", "3700"]]);
    expect(buildBlossomServers(["https://b.test/", "http://c", "https://b.test"], 1).tags).toEqual([["server", "https://b.test"]]);
    expect(blossomAlternatives(a.url, ["https://x.test", "https://y.test"])).toEqual([`https://y.test/${"a".repeat(64)}.jpg`]);
    expect(uploadAuth("d".repeat(64), "p", 1, "https://blossom.band").tags).toContainEqual(["server", "blossom.band"]);
  });
});
