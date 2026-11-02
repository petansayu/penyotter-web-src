import { describe, expect, it } from "vitest";
import { isEmptyCard, kindCard, kindLabel, kindLine } from "./kindCards";

describe("知らない種類の投稿のカード", () => {
  it("よくあるタグから題名・概要・画像・リンクを拾う", () => {
    const card = kindCard(30402, [["title", "手作りのマグカップ"], ["summary", "一点もの"], ["image", "https://example.com/a.png"], ["r", "https://example.com/shop"], ["r", "http://insecure"]], "");
    expect([card.title, card.summary, card.image]).toEqual(["手作りのマグカップ", "一点もの", "https://example.com/a.png"]);
    expect(card.links).toEqual(["https://example.com/shop"]);
    expect(kindLabel(card)).toBe("kind 30402・出品");
    expect(isEmptyCard(card)).toBe(false);
  });

  it("ふつうの文章の本文は概要にする", () => {
    const card = kindCard(12345, [], "ふつうの文章です");
    expect(card.summary).toBe("ふつうの文章です");
    expect(kindLabel(card)).toBe("kind 12345");
    expect(kindCard(30402, [], "## 見出し\n**太字**の説明").summary).toBe("見出し\n太字の説明");
  });

  it("JSON や暗号文は出さない", () => {
    const json = kindCard(30078, [["d", "settings"]], '{"theme":"dark"}');
    expect(json.summary).toBeNull();
    expect(isEmptyCard(json)).toBe(true);
    expect(kindLine(json)).toBe("非公開の記録です（kind 30078・アプリのデータ）");
    expect(kindCard(4, [], "c2VjcmV0IG1lc3NhZ2UgZW5jcnlwdGVkIHRleHQgaGVyZQ==?iv=YWJjZGVmZ2hpamtsbW5vcA==").private).toBe(true);
  });

  it("ほかに何もなければ alt", () => {
    const card = kindCard(5300, [["alt", "おすすめの投稿を探す依頼"]], "");
    expect(kindLine(card)).toBe("おすすめの投稿を探す依頼");
    expect(kindLabel(card)).toBe("kind 5300・DVM への依頼");
  });
});
