import { describe, expect, it, vi } from "vitest";
import { nip19 } from "nostr-tools";

// router は読み込んだときに今の URL を読むので、先にブラウザの代わりを置く
vi.stubGlobal("location", { hash: "" });
vi.stubGlobal("window", { addEventListener: () => {} });
const { parseRoute } = await import("./router.svelte");

describe("web+nostr: のリンク", () => {
  const pubkey = "a".repeat(64);
  const open = (uri: string) => parseRoute(`#/open?uri=${encodeURIComponent(uri)}`);
  it("npub はプロフィール、note は投稿、naddr は検索", () => {
    expect(open(`web+nostr:${nip19.npubEncode(pubkey)}`)).toEqual({ name: "profile", pubkey, relays: [] });
    expect(open(`nostr:${nip19.noteEncode(pubkey)}`)).toEqual({ name: "thread", id: pubkey, relays: [] });
    expect(open(nip19.naddrEncode({ kind: 30023, pubkey, identifier: "x" }))).toMatchObject({ name: "search" });
  });
  it("秘密鍵は開かない。読めないものは見つからない", () => {
    expect(open("web+nostr:nsec1abc")).toEqual({ name: "secretLink" });
    expect(open("web+nostr:ncryptsec1abc")).toEqual({ name: "secretLink" });
    expect(open("web+nostr:hello")).toMatchObject({ name: "notFound" });
  });
});
