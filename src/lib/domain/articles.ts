import MarkdownIt, { type Token } from "markdown-it";
import { nip19 } from "nostr-tools";
import { tagValue, type Event } from "../nostr/events";

/** 記事（NIP-23、kind 30023。Android 版の Articles・ArticleView、技術資料 8.9）。 */

export interface ArticleInfo { title: string; summary: string; image: string | null; publishedAt: number | null; hashtags: string[] }

export function articleInfo(event: Event): ArticleInfo {
  const title = (tagValue(event, "title") ?? "").trim().slice(0, 300);
  const summaryTag = tagValue(event, "summary")?.trim();
  const summary = summaryTag ? summaryTag.slice(0, 600) : plainText(event.content).slice(0, 300);
  const image = tagValue(event, "image")?.trim();
  const published = Number(tagValue(event, "published_at"));
  const hashtags = [...new Set(event.tags.filter((t) => t.length >= 2 && t[0] === "t" && t[1].trim()).map((t) => t[1]))].slice(0, 10);
  return { title, summary, image: image?.startsWith("https://") ? image : null, publishedAt: Number.isInteger(published) && published > 0 ? published : null, hashtags };
}

/** 一覧の概要用に Markdown を文字だけにする（画像なし、リンクは文字だけ、見出し・リストの印なし）。 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/(\*\*|__|\*|_|~~|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type ArticlePart = { type: "markdown"; text: string } | { type: "embed"; id: string; relays: string[]; author?: string };

const EMBED_LINE = /^\s*(?:nostr:)?((?:note|nevent)1[023456789acdefghjklmnpqrstuvwxyz]+)\s*$/i;

/** 本文を、Markdown の部分と、投稿へのリンクだけの行（引用カードとして埋め込む）に分ける。コードブロックの中は分けない。 */
export function splitArticle(markdown: string): ArticlePart[] {
  const parts: ArticlePart[] = [];
  let buffer: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (buffer.join("").trim()) parts.push({ type: "markdown", text: buffer.join("\n") });
    buffer = [];
  };
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (fence === null || marker.startsWith(fence))) fence = fence === null ? marker[0].repeat(3) : null;
    const embed = fence === null ? EMBED_LINE.exec(line) : null;
    if (embed) {
      try {
        const decoded = nip19.decode(embed[1].toLowerCase());
        if (decoded.type === "note") {
          flush();
          parts.push({ type: "embed", id: decoded.data, relays: [] });
          continue;
        }
        if (decoded.type === "nevent") {
          flush();
          parts.push({ type: "embed", id: decoded.data.id, relays: decoded.data.relays ?? [], author: decoded.data.author });
          continue;
        }
      } catch {
        // 読めない参照はただの文字
      }
    }
    buffer.push(line);
  }
  flush();
  return parts;
}

export interface LinkTargets {
  /** nostr: の参照を、アプリ内のリンク先にする。読めなければ null。 */
  href(bech32: string): string | null;
  /** nostr:npub・nprofile を本文に出すときの文字（「@名前」）。 */
  label(bech32: string): string;
}

const NOSTR_REF = /nostr:((?:npub|nprofile|note|nevent|naddr)1[023456789acdefghjklmnpqrstuvwxyz]+)/gi;
const BR = /^<br\s*\/?>$/i;

/**
 * Markdown を HTML にする（CommonMark と GFM の表・取り消し線・自動リンク）。HTML のタグは取り除いて文字だけを
 * 出し、`<br>` は改行にする。リンクは https・http・nostr: だけ（nostr: はアプリ内へ）、画像は https だけ。
 */
export function renderMarkdown(markdown: string, targets: LinkTargets): string {
  const md = new MarkdownIt({ html: true, linkify: true, breaks: false });
  const escape = md.utils.escapeHtml;

  // HTML はタグを取り除いて文字だけ
  md.renderer.rules.html_block = (tokens, index) => {
    const text = tokens[index].content.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim();
    return text ? `<p>${escape(text).replace(/\n/g, "<br>")}</p>\n` : "";
  };
  md.renderer.rules.html_inline = (tokens, index) => (BR.test(tokens[index].content.trim()) ? "<br>" : "");

  // 本文中の nostr: の参照をリンクにする（リンクの中は除く）
  md.core.ruler.push("nostr_refs", (state) => {
    for (const block of state.tokens) {
      if (block.type !== "inline" || !block.children) continue;
      const children: Token[] = [];
      let insideLink = 0;
      for (const token of block.children) {
        if (token.type === "link_open") insideLink++;
        if (token.type === "link_close") insideLink--;
        if (token.type !== "text" || insideLink > 0 || !NOSTR_REF.test(token.content)) {
          children.push(token);
          continue;
        }
        NOSTR_REF.lastIndex = 0;
        let last = 0;
        for (const match of token.content.matchAll(NOSTR_REF)) {
          const before = token.content.slice(last, match.index);
          if (before) children.push(Object.assign(new state.Token("text", "", 0), { content: before }));
          const open = new state.Token("link_open", "a", 1);
          open.attrs = [["href", match[0]]];
          children.push(open, Object.assign(new state.Token("text", "", 0), { content: targets.label(match[1].toLowerCase()) }), new state.Token("link_close", "a", -1));
          last = match.index! + match[0].length;
        }
        if (last < token.content.length) children.push(Object.assign(new state.Token("text", "", 0), { content: token.content.slice(last) }));
      }
      block.children = children;
    }
  });

  // nostr: を通すため、リンクの確かめは自分で行う
  md.validateLink = (url) => /^(https?:|nostr:)/i.test(url.trim());

  md.renderer.rules.link_open = (tokens, index, options, _env, self) => {
    const token = tokens[index];
    const href = String(token.attrGet("href") ?? "");
    if (/^nostr:/i.test(href)) {
      const inApp = targets.href(href.slice(6).toLowerCase());
      if (inApp) token.attrSet("href", inApp);
      else token.attrs = [];
    } else {
      token.attrSet("target", "_blank");
      token.attrSet("rel", "noopener noreferrer nofollow");
    }
    return self.renderToken(tokens, index, options);
  };

  md.renderer.rules.image = (tokens, index) => {
    const token = tokens[index];
    const src = String(token.attrGet("src") ?? "");
    const alt = token.children ? md.renderer.renderInlineAsText(token.children, md.options, {}) : token.content;
    if (!src.startsWith("https://")) return escape(alt);
    return `<img src="${escape(src)}" alt="${escape(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
  };

  return md.render(markdown);
}
