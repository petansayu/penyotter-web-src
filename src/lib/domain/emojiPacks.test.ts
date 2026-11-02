import { describe, expect, it } from "vitest";
import type { Event } from "nostr-tools";
import { emojiPack, newestPacks, packAddressIn, packsContaining, packsNamed, popularReferences } from "./emojiPacks";
import { emojiTag } from "./emojis";
import { buildEvent } from "./publishing";

const MAKER = "a".repeat(64);
const CAT = { shortcode: "cat", url: "https://example.com/cat.png" };
const DOG = { shortcode: "dog", url: "https://example.com/dog.png" };
const set = (identifier: string, time: number, emojis: { shortcode: string; url: string }[], title?: string, id = "e".repeat(64)): Event =>
  ({ id, pubkey: MAKER, created_at: time, kind: 30030, sig: "0".repeat(128), content: "",
    tags: [["d", identifier], ...(title ? [["title", title]] : []), ...emojis.map((e) => ["emoji", e.shortcode, e.url])] }) as Event;

describe("絵文字パック（Android 版の EmojiPacksTest）", () => {
  it("emoji タグの 4 つめがパックを指す", () => {
    const address = `30030:${MAKER}:cats`;
    expect(packAddressIn([["emoji", "cat", CAT.url, address]], CAT.url)).toEqual({ author: MAKER, identifier: "cats" });
    // 4 つめがない・読めない・ほかの絵文字のタグなら、なし
    expect(packAddressIn([["emoji", "cat", CAT.url]], CAT.url)).toBeNull();
    expect(packAddressIn([["emoji", "cat", CAT.url, "30030:short:cats"]], CAT.url)).toBeNull();
    expect(packAddressIn([["emoji", "dog", DOG.url, address]], CAT.url)).toBeNull();
  });

  it("セットは題名と絵文字のあるパックになる", () => {
    const pack = emojiPack(set("cats", 10, [CAT], "ねこパック"))!;
    expect(pack.address).toBe(`30030:${MAKER}:cats`);
    expect(pack.title).toBe("ねこパック");
    expect(pack.emojis).toEqual([{ ...CAT, set: `30030:${MAKER}:cats` }]);
    // 題名がなければ識別子。識別子がなければパックではない
    expect(emojiPack(set("cats", 10, [CAT]))!.title).toBe("cats");
    expect(emojiPack({ ...set("", 10, [CAT]), tags: [["emoji", "cat", CAT.url]] })).toBeNull();
  });

  it("パックの絵文字を使うと、送るタグにパックのアドレスが付き、読み戻せる", () => {
    const address = `30030:${MAKER}:cats`;
    const fromPack = { ...CAT, set: address };
    expect(emojiTag(fromPack)).toEqual(["emoji", "cat", CAT.url, address]);
    // ひとつだけ足した絵文字（パックがない）や、読めないアドレスには付けない
    expect(emojiTag(CAT)).toEqual(["emoji", "cat", CAT.url]);
    expect(emojiTag({ ...CAT, set: "b".repeat(64) })).toEqual(["emoji", "cat", CAT.url]);
    const target = { id: "c".repeat(64), pubkey: "d".repeat(64), created_at: 1, kind: 1, tags: [], content: "x", sig: "0".repeat(128) } as Event;
    const post = buildEvent(MAKER, { mode: "post", body: "にゃ :cat:", customEmojis: [fromPack] }, 2, { clientTag: false });
    const reaction = buildEvent(MAKER, { mode: "like", body: ":cat:", target, emoji: fromPack }, 2, { clientTag: false });
    for (const event of [post, reaction]) expect(packAddressIn(event.tags, CAT.url)).toEqual({ author: MAKER, identifier: "cats" });
  });

  it("いちばん新しい版を使い、その絵文字が入っているパックだけを出す", () => {
    const old = set("cats", 10, [CAT], "古い");
    const fresh = set("cats", 20, [CAT, DOG], "新しい", "1".repeat(64));
    const other = set("dogs", 15, [DOG]);
    const packs = newestPacks([old, other, fresh]);
    expect(new Set(packs.map((p) => p.title))).toEqual(new Set(["新しい", "dogs"]));
    expect(packsContaining(packs, CAT.url).map((p) => p.title)).toEqual(["新しい"]);
    expect(new Set(packsContaining(packs, DOG.url).map((p) => p.title))).toEqual(new Set(["新しい", "dogs"]));
  });

  it("画像の URL が変わった絵文字は、名前が同じ絵文字のパックで探す", () => {
    const packs = newestPacks([set("cats", 10, [{ shortcode: "cat", url: "https://example.com/new/cat.png" }]), set("dogs", 10, [DOG])]);
    expect(packsContaining(packs, CAT.url)).toEqual([]);
    expect(packsNamed(packs, "cat").map((p) => p.address)).toEqual([`30030:${MAKER}:cats`]);
    expect(packsNamed(packs, "bird")).toEqual([]);
  });

  it("フォロー中の人の絵文字リストのパックは、指している人の多い順", () => {
    const list = (pubkey: string, identifiers: string[]): Event =>
      ({ id: pubkey, pubkey, created_at: 1, kind: 10030, sig: "0".repeat(128), content: "", tags: identifiers.map((d) => ["a", `30030:${MAKER}:${d}`]) }) as Event;
    const lists = [list("1".repeat(64), ["cats", "dogs"]), list("2".repeat(64), ["dogs", "birds"]), list("3".repeat(64), ["dogs", "birds"])];
    expect(popularReferences(lists, 10).map((r) => r.identifier)).toEqual(["dogs", "birds", "cats"]);
    expect(popularReferences(lists, 1).map((r) => r.identifier)).toEqual(["dogs"]);
  });
});
