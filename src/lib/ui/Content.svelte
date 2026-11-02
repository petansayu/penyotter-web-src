<script lang="ts">
  import { segments } from "../domain/content";
  import { mightHide, splitHidden } from "../domain/hiddenMessages";
  import HiddenMessage from "./HiddenMessage.svelte";
  import PackEmoji from "./PackEmoji.svelte";
  import { emojiPacks } from "../store/emojiPacks.svelte";
  import { nip19 } from "nostr-tools";
  import { profiles, requestProfiles } from "../store/cache.svelte";
  import { profileHref, searchHref, threadHref } from "../router.svelte";
  import { toast } from "../store/toast.svelte";

  /**
   * 本文。リンク・カスタム絵文字・ハッシュタグ・nostr: の参照を出し分ける。改行はそのまま。hidden なら隠しメッセージ
   * （セクシー餃子）を読んで出す（Android 版の EmojiText(hiddenMessages = true)）。emojiFrom（その本文のイベントの
   * タグと作者）があれば、カスタム絵文字を押すとパックの画面を開く。絵文字パック（kind 30030）の naddr も押すと開く。
   */
  let { text, emojis, hidden = false, emojiFrom }: { text: string; emojis: Map<string, string>; hidden?: boolean; emojiFrom?: { tags: string[][]; owner: string | null } } = $props();

  function openPack(event: MouseEvent, pubkey: string, identifier: string, relays: string[]) {
    event.preventDefault();
    event.stopPropagation();
    emojiPacks.openAt(pubkey, identifier, relays);
  }

  // 投稿のタグ（短いカラーコードとハッシュタグの見分けに使う）
  const parts = $derived(segments(text, emojis, emojiFrom?.tags ?? []));

  /**
   * カスタム絵文字のすぐ後ろの隠しメッセージ（:party_pe: のように、見える文字が絵文字のもの）。絵文字の位置 → メッセージ。
   * 絵文字を虹色の枠で囲み、後ろの文からはそのメッセージを除く（Android 版の EmojiText と同じ見え方）。
   */
  const emojiHidden = $derived.by(() => {
    const found = new Map<number, string>();
    if (!hidden) return found;
    parts.forEach((part, i) => {
      const next = parts[i + 1];
      if (part.type !== "emoji" || next?.type !== "text" || !mightHide(next.text)) return;
      const first = splitHidden(next.text)[0];
      if (first?.type === "hidden" && first.visible === "") found.set(i, first.message);
    });
    return found;
  });

  /** カラーコード（色見本か文字）を押すとコピーする。 */
  async function copyColor(event: MouseEvent, code: string) {
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(code);
      toast.show(`${code} をコピーしました`);
    } catch {
      toast.show("コピーできませんでした");
    }
  }

  $effect(() => {
    requestProfiles(parts.flatMap((part) => (part.type === "profile" ? [part.pubkey] : [])));
  });

  const shortLink = (url: string) => (url.length > 60 ? `${url.slice(0, 57)}…` : url);
  const shortId = (raw: string) => {
    const bech = raw.replace(/^nostr:/i, "");
    return `${bech.slice(0, 12)}…${bech.slice(-4)}`;
  };
  /** 名前がわかるまでは「npub1…」と短く出す（Android 版と同じ）。 */
  const mentionName = (pubkey: string) => {
    const profile = profiles.get(pubkey)?.profile;
    return profile?.displayName || profile?.name || `${nip19.npubEncode(pubkey).slice(0, 12)}…`;
  };
</script>

<div class="content">{#each parts as part, i (i)}{#if part.type === "text"}{#if hidden && mightHide(part.text)}{#each splitHidden(part.text).slice(emojiHidden.has(i - 1) ? 1 : 0) as piece, j (j)}{#if piece.type === "text"}{piece.text}{:else}<HiddenMessage visible={piece.visible} message={piece.message} />{/if}{/each}{:else}{part.text}{/if}{:else if part.type === "link"}<a
        href={part.url}
        target="_blank"
        rel="noopener noreferrer nofollow">{shortLink(part.url)}</a
      >{:else if part.type === "emoji" && emojiHidden.has(i)}<HiddenMessage visible=":{part.shortcode}:" message={emojiHidden.get(i) ?? ""}><img
          class="emoji"
          src={part.url}
          alt=":{part.shortcode}:"
          loading="lazy"
          referrerpolicy="no-referrer"
        /></HiddenMessage
      >{:else if part.type === "emoji" && emojiFrom}<PackEmoji class="emoji" shortcode={part.shortcode} url={part.url} tags={emojiFrom.tags} owner={emojiFrom.owner}
      />{:else if part.type === "emoji"}<img
        class="emoji"
        src={part.url}
        alt=":{part.shortcode}:"
        title=":{part.shortcode}:"
        loading="lazy"
        referrerpolicy="no-referrer"
      />{:else if part.type === "color"}<button type="button" class="color" title="{part.code} をコピー" onclick={(event) => copyColor(event, part.code)}><span class="swatch" class:clear={part.alpha < 1}><span style:background={part.css}></span></span>{part.code}</button
      >{:else if part.type === "hashtag"}<a class="hashtag" href={searchHref(`#${part.tag}`)}>#{part.tag}</a>{:else if part.type === "profile"}<a
        class="mention"
        href={profileHref(part.pubkey, part.relays)}>@{mentionName(part.pubkey)}</a
      >{:else if part.type === "address" && part.kind === 30030}<a class="ref" href="#/" onclick={(event) => openPack(event, part.pubkey, part.identifier, part.relays)}>絵文字パック {part.identifier.slice(0, 40)}</a
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
  /* カラーコード: 色見本の四角と、そのコード（押すとコピー） */
  .color {
    display: inline;
    padding: 0;
    font: inherit;
    color: inherit;
    background: none;
    border: none;
    cursor: pointer;
  }
  .swatch {
    display: inline-block;
    position: relative;
    width: 0.95em;
    height: 0.95em;
    margin-right: 0.2em;
    vertical-align: -0.12em;
    border: 1px solid var(--outline);
    border-radius: 0.2em;
    overflow: hidden;
  }
  .swatch > span {
    position: absolute;
    inset: 0;
  }
  /* 透けている色は市松模様の上に */
  .swatch.clear {
    background: repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0 / 0.5em 0.5em;
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
  .content :global(.emoji),
  .emoji {
    height: 1.6em;
    max-width: 6em;
    vertical-align: middle;
    object-fit: contain;
  }
</style>
