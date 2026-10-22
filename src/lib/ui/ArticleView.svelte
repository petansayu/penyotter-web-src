<script lang="ts">
  import { nip19 } from "nostr-tools";
  import { articleInfo, renderMarkdown, splitArticle, type LinkTargets } from "../domain/articles";
  import type { Event } from "../nostr/events";
  import { profileHref, searchHref, threadHref } from "../router.svelte";
  import { displayName, requestProfiles } from "../store/cache.svelte";
  import Avatar from "./Avatar.svelte";
  import QuoteCard from "./QuoteCard.svelte";
  import { fullTime } from "./time";

  /** 記事の本文（技術資料 8.9）。見出し画像・題名・作者・本文（Markdown）。投稿へのリンクだけの行は引用カード。 */
  let { note }: { note: Event } = $props();

  const info = $derived(articleInfo(note));
  const parts = $derived(splitArticle(note.content));

  /** 本文中の nostr: の参照（npub・nprofile は「@名前」、ほかは切り詰めた識別子）。 */
  const targets: LinkTargets = {
    href(bech) {
      try {
        const decoded = nip19.decode(bech);
        switch (decoded.type) {
          case "npub": return profileHref(decoded.data);
          case "nprofile": return profileHref(decoded.data.pubkey, decoded.data.relays ?? []);
          case "note": return threadHref(decoded.data);
          case "nevent": return threadHref(decoded.data.id, decoded.data.author, decoded.data.relays ?? []);
          case "naddr": return searchHref(bech);
        }
      } catch {
        // 読めない参照はリンクにしない
      }
      return null;
    },
    label(bech) {
      try {
        const decoded = nip19.decode(bech);
        const pubkey = decoded.type === "npub" ? decoded.data : decoded.type === "nprofile" ? decoded.data.pubkey : null;
        if (pubkey) return `@${displayName(pubkey)}`;
      } catch {
        // 下で切り詰める
      }
      return `${bech.slice(0, 12)}…${bech.slice(-4)}`;
    },
  };

  // 名前が届いたら描き直す（displayName を読むので $derived が追う）
  const html = $derived(parts.map((part) => (part.type === "markdown" ? renderMarkdown(part.text, targets) : "")));

  $effect(() => {
    const mentioned = [...note.content.matchAll(/nostr:((?:npub|nprofile)1[023456789acdefghjklmnpqrstuvwxyz]+)/gi)].flatMap((match) => {
      try {
        const decoded = nip19.decode(match[1].toLowerCase());
        return decoded.type === "npub" ? [decoded.data] : decoded.type === "nprofile" ? [decoded.data.pubkey] : [];
      } catch {
        return [];
      }
    });
    requestProfiles([note.pubkey, ...mentioned]);
  });
</script>

<article class="article">
  {#if info.image}<img class="cover" src={info.image} alt="" referrerpolicy="no-referrer" />{/if}
  <div class="head">
    <h1>{info.title || "（題名なし）"}</h1>
    <a class="author" href={profileHref(note.pubkey)}>
      <Avatar pubkey={note.pubkey} size={32} />
      <span>{displayName(note.pubkey)}</span>
    </a>
    <div class="meta">
      {#if info.publishedAt}<span>公開 {fullTime(info.publishedAt)}</span>{/if}
      {#if info.publishedAt !== note.created_at}<span>更新 {fullTime(note.created_at)}</span>{/if}
    </div>
    {#if info.hashtags.length > 0}
      <div class="tags">{#each info.hashtags as tag (tag)}<a href={searchHref(`#${tag}`)}>#{tag}</a>{/each}</div>
    {/if}
  </div>
  <div class="body">
    {#each parts as part, i (i)}
      {#if part.type === "markdown"}
        <!-- renderMarkdown は HTML のタグを取り除き、リンクと画像を安全なものだけにしている -->
        {@html html[i]}
      {:else}
        <QuoteCard id={part.id} relays={part.relays} author={part.author} />
      {/if}
    {/each}
  </div>
</article>

<style>
  .article {
    border-bottom: 1px solid var(--outline-variant);
    padding-bottom: 16px;
    background: var(--background);
  }
  .cover {
    display: block;
    width: 100%;
    max-height: 320px;
    object-fit: cover;
  }
  .head {
    padding: 16px 16px 8px;
  }
  h1 {
    margin: 0 0 12px;
    font-size: 1.5rem;
    line-height: 1.4;
  }
  .author {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--text);
    font-weight: 600;
    text-decoration: none;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin-top: 6px;
    color: var(--muted);
    font-size: 0.85em;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  .tags a {
    color: var(--secondary);
    background: var(--secondary-container);
    border-radius: 999px;
    padding: 2px 10px;
    font-size: 0.85em;
    text-decoration: none;
  }
  .body {
    padding: 0 16px;
    line-height: 1.8;
    overflow-wrap: anywhere;
  }
  .body :global(h1),
  .body :global(h2),
  .body :global(h3),
  .body :global(h4) {
    line-height: 1.4;
    margin: 1.4em 0 0.6em;
  }
  .body :global(h1) { font-size: 1.35rem; }
  .body :global(h2) { font-size: 1.2rem; border-bottom: 1px solid var(--outline-variant); padding-bottom: 4px; }
  .body :global(h3) { font-size: 1.05rem; }
  .body :global(a) {
    color: var(--primary);
  }
  .body :global(img) {
    display: block;
    max-width: 100%;
    max-height: 480px;
    margin: 8px 0;
    border-radius: 8px;
  }
  .body :global(blockquote) {
    margin: 1em 0;
    padding: 0 12px;
    border-left: 3px solid var(--outline);
    color: var(--muted);
  }
  .body :global(code) {
    font-family: ui-monospace, Consolas, monospace;
    font-size: 0.9em;
    background: var(--surface);
    border-radius: 4px;
    padding: 1px 4px;
  }
  .body :global(pre) {
    overflow-x: auto;
    background: var(--surface);
    border-radius: 8px;
    padding: 12px;
    line-height: 1.5;
  }
  .body :global(pre code) {
    background: none;
    padding: 0;
  }
  .body :global(table) {
    display: block;
    overflow-x: auto;
    border-collapse: collapse;
    margin: 1em 0;
  }
  .body :global(th),
  .body :global(td) {
    border: 1px solid var(--outline-variant);
    padding: 4px 10px;
  }
  .body :global(th) {
    background: var(--surface-low);
  }
  .body :global(hr) {
    border: none;
    border-top: 1px solid var(--outline-variant);
    margin: 1.5em 0;
  }
</style>
