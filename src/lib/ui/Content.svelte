<script lang="ts">
  import { segments } from "../domain/content";
  import { mightHide, splitHidden } from "../domain/hiddenMessages";
  import HiddenMessage from "./HiddenMessage.svelte";
  import { displayName, requestProfiles } from "../store/cache.svelte";
  import { profileHref, searchHref, threadHref } from "../router.svelte";

  /**
   * 本文。リンク・カスタム絵文字・ハッシュタグ・nostr: の参照を出し分ける。改行はそのまま。hidden なら隠しメッセージ
   * （セクシー餃子）を読んで出す（Android 版の EmojiText(hiddenMessages = true)）。
   */
  let { text, emojis, hidden = false }: { text: string; emojis: Map<string, string>; hidden?: boolean } = $props();

  const parts = $derived(segments(text, emojis));

  $effect(() => {
    requestProfiles(parts.flatMap((part) => (part.type === "profile" ? [part.pubkey] : [])));
  });

  const shortLink = (url: string) => (url.length > 60 ? `${url.slice(0, 57)}…` : url);
  const shortId = (raw: string) => {
    const bech = raw.replace(/^nostr:/i, "");
    return `${bech.slice(0, 12)}…${bech.slice(-4)}`;
  };
</script>

<div class="content">{#each parts as part, i (i)}{#if part.type === "text"}{#if hidden && mightHide(part.text)}{#each splitHidden(part.text) as piece, j (j)}{#if piece.type === "text"}{piece.text}{:else}<HiddenMessage visible={piece.visible} message={piece.message} />{/if}{/each}{:else}{part.text}{/if}{:else if part.type === "link"}<a
        href={part.url}
        target="_blank"
        rel="noopener noreferrer nofollow">{shortLink(part.url)}</a
      >{:else if part.type === "emoji"}<img
        class="emoji"
        src={part.url}
        alt=":{part.shortcode}:"
        title=":{part.shortcode}:"
        loading="lazy"
        referrerpolicy="no-referrer"
      />{:else if part.type === "hashtag"}<a class="hashtag" href={searchHref(`#${part.tag}`)}>#{part.tag}</a>{:else if part.type === "profile"}<a
        class="mention"
        href={profileHref(part.pubkey, part.relays)}>@{displayName(part.pubkey)}</a
      >{:else if part.type === "event"}<a class="ref" href={threadHref(part.id, part.author, part.relays)}>{shortId(part.raw)}</a
      >{:else}<span class="ref">{shortId(part.raw)}</span>{/if}{/each}</div>

<style>
  .content {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.6;
  }
  a {
    color: var(--primary);
    text-decoration: none;
  }
  a:hover {
    text-decoration: underline;
  }
  .hashtag {
    color: var(--secondary);
  }
  .ref {
    color: var(--muted);
  }
  a.ref {
    color: var(--primary);
  }
  .emoji {
    height: 1.6em;
    max-width: 6em;
    vertical-align: middle;
    object-fit: contain;
  }
</style>
