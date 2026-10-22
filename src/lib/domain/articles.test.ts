import { describe, expect, it } from "vitest";
import { nip19, type Event } from "nostr-tools";
import { articleInfo, plainText, renderMarkdown, splitArticle } from "./articles";

const A = "a".repeat(64);
const B = "b".repeat(64);
const targets = {
  href: (bech: string) => (bech.startsWith("npub") ? `#/p/${bech}` : bech.startsWith("note") ? `#/e/${bech}` : null),
  label: (bech: string) => (bech.startsWith("npub") ? "@ぺぇ" : `${bech.slice(0, 10)}…`),
};
const article = (fields: Partial<Event>): Event =>
  ({ id: A, pubkey: B, created_at: 1, kind: 30023, tags: [], content: "", sig: "0".repeat(128), ...fields }) as Event;

describe("articleInfo", () => {
  it("題名・概要・画像", () => {
    const info = articleInfo(article({ tags: [["title", "題"], ["image", "http://x/a.png"], ["published_at", "100"], ["t", "nostr"], ["t", "nostr"]], content: "# 見出し\n本文の**太字**と[リンク](https://x)" }));
    expect(info).toEqual({ title: "題", summary: "見出し 本文の太字とリンク", image: null, publishedAt: 100, hashtags: ["nostr"] });
    expect(plainText("```\ncode\n```\n![画像](https://x/a.png) - 項目")).toBe("項目");
  });
});

describe("splitArticle", () => {
  it("投稿へのリンクだけの行を埋め込みにする（コードブロックの中は除く）", () => {
    const note = nip19.noteEncode(A);
    const nevent = nip19.neventEncode({ id: B, author: A, relays: ["wss://yabu.me"] });
    const parts = splitArticle(`前\nnostr:${note}\n\`\`\`\nnostr:${note}\n\`\`\`\n${nevent}\n後`);
    expect(parts.map((p) => p.type)).toEqual(["markdown", "embed", "markdown", "embed", "markdown"]);
    expect(parts[1]).toEqual({ type: "embed", id: A, relays: [] });
    expect(parts[3]).toEqual({ type: "embed", id: B, relays: ["wss://yabu.me"], author: A });
  });
});

describe("renderMarkdown", () => {
  it("GFM の表と取り消し線", () => {
    const html = renderMarkdown("|a|b|\n|-|-|\n|1|2|\n\n~~消す~~", targets);
    expect(html).toContain("<table>");
    expect(html).toContain("<s>消す</s>");
  });

  it("HTML はタグを取り除き、br は改行", () => {
    const html = renderMarkdown('<div onclick="x()">中身<script>alert(1)</script></div>\n\n行<br>次 <b>太</b>', targets);
    expect(html).not.toContain("<div");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick");
    expect(html).toContain("中身alert(1)");
    expect(html).toContain("行<br>次 太");
  });

  it("リンクと画像は安全なものだけ", () => {
    const html = renderMarkdown("[a](javascript:alert(1)) [b](https://example.com) ![c](http://x/c.png) ![d](https://x/d.png)", targets);
    // javascript: はリンクにせず、文字のまま出す
    expect(html).not.toContain('href="javascript');
    expect(html).toContain("[a](javascript:alert(1))");
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">b</a>');
    expect(html).not.toContain("http://x/c.png");
    expect(html).toContain('<img src="https://x/d.png" alt="d"');
  });

  it("nostr: の参照はアプリ内へ、npub は名前で", () => {
    const npub = nip19.npubEncode(A);
    const html = renderMarkdown(`こんにちは nostr:${npub} さん [リンク](nostr:${npub}) \`nostr:${npub}\``, targets);
    expect(html).toContain(`<a href="#/p/${npub}">@ぺぇ</a> さん`);
    expect(html).toContain(`<a href="#/p/${npub}">リンク</a>`);
    expect(html).toContain(`<code>nostr:${npub}</code>`);
  });
});
