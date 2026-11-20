<script lang="ts">
  import { nip19 } from "nostr-tools";
  import { untrack } from "svelte";
  import type { LinkBookmark } from "../domain/linkBookmarks";
  import { threadHref } from "../router.svelte";
  import { linkBookmarks } from "../store/linkBookmarks.svelte";
  import { toast } from "../store/toast.svelte";
  import { viewer } from "../store/viewer.svelte";
  import Icon from "./Icon.svelte";
  import LinkBookmarkDialog from "./LinkBookmarkDialog.svelte";

  /** ブックマークの「リンク」タブ（Android 版の LinkBookmarkList）。押すと開き、「…」で元の投稿・コピー・削除。 */
  let adding = $state(false);
  let menuFor = $state<LinkBookmark | null>(null);
  let removing = $state<LinkBookmark | null>(null);

  // 見る人が変わったときだけ読み直す（refresh の中の $state を読むと、読み終わるたびにまた走ってしまう）
  $effect(() => {
    void viewer.pubkey;
    untrack(() => void linkBookmarks.refresh());
  });

  /** 見つけた投稿へのリンク。 */
  function sourceHref(from: string): string | null {
    try {
      const decoded = nip19.decode(from);
      if (decoded.type === "nevent") return threadHref(decoded.data.id, decoded.data.author);
      if (decoded.type === "note") return threadHref(decoded.data);
    } catch {
      // 読めなければ出さない
    }
    return null;
  }

  const day = (seconds: number) => new Date(seconds * 1000).toLocaleDateString("ja-JP");

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.show("リンクをコピーしました");
    } catch {
      toast.show("コピーできませんでした");
    }
  }

  async function remove(bookmark: LinkBookmark) {
    removing = null;
    try {
      await linkBookmarks.remove(bookmark);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e));
    }
  }
</script>

<div class="intro">
  <p>非公開はこのブラウザだけ、公開はリレー（NIP-B0）に保存します。</p>
  <button type="button" class="icon" onclick={() => (adding = true)} aria-label="リンクを追加" title="リンクを追加"><Icon name="add" size={22} /></button>
</div>
{#if linkBookmarks.loading || linkBookmarks.busy}<div class="progress"></div>{/if}
{#each linkBookmarks.all as link ((link.public ? "public:" : "private:") + link.url)}
  <div class="row">
    <a class="link" href={link.url} target="_blank" rel="noopener noreferrer">
      <strong>{link.title || link.url}</strong>
      <span class="url">{link.url}</span>
      <small>{link.public ? "公開" : "非公開"} · {day(link.addedAt)}</small>
    </a>
    <span class="menu-anchor">
      <button type="button" class="icon" onclick={() => (menuFor = menuFor === link ? null : link)} aria-label="リンクの操作" aria-haspopup="menu" aria-expanded={menuFor === link}><Icon name="moreHoriz" size={18} /></button>
      {#if menuFor === link}
        <span class="menu" role="menu">
          {#if link.from && sourceHref(link.from)}<a role="menuitem" href={sourceHref(link.from)} onclick={() => (menuFor = null)}>元の投稿を見る</a>{/if}
          <button type="button" role="menuitem" onclick={() => { menuFor = null; void copy(link.url); }}>リンクをコピー</button>
          <button type="button" role="menuitem" class="danger" onclick={() => { menuFor = null; removing = link; }}>削除</button>
        </span>
      {/if}
    </span>
  </div>
{:else}
  <p class="empty">リンクのブックマークはありません</p>
{/each}

{#if removing}
  {@const target = removing}
  <div class="confirm" role="alertdialog" aria-label="ブックマークから削除">
    <p>{target.public ? "リレーに削除を依頼します。リレーやほかのアプリには残ることがあります。" : "このブラウザから消します。"}</p>
    <button type="button" onclick={() => (removing = null)}>キャンセル</button>
    <button type="button" class="danger" onclick={() => remove(target)}>削除</button>
  </div>
{/if}
{#if adding}<LinkBookmarkDialog close={() => (adding = false)} />{/if}

<style>
  .intro {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px 6px 16px;
    font-size: 0.85em;
    color: var(--muted);
  }
  .intro p {
    flex: 1;
    margin: 0;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    color: var(--text);
    background: none;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }
  .progress {
    height: 2px;
    background: linear-gradient(90deg, transparent, var(--primary), transparent);
  }
  .row {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    padding: 8px 8px 8px 16px;
    border-bottom: 1px solid var(--outline-variant);
  }
  .link {
    display: grid;
    flex: 1;
    min-width: 0;
    gap: 2px;
    color: inherit;
    text-decoration: none;
  }
  .link strong,
  .url {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .url {
    font-size: 0.8em;
    color: var(--primary);
  }
  small {
    color: var(--muted);
  }
  .menu-anchor {
    position: relative;
  }
  .menu {
    position: absolute;
    right: 0;
    top: 36px;
    z-index: 10;
    display: grid;
    min-width: 180px;
    padding: 4px 0;
    background: var(--container);
    border: 1px solid var(--outline-variant);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.2);
  }
  .menu a,
  .menu button {
    padding: 8px 14px;
    font: inherit;
    text-align: left;
    color: var(--text);
    background: none;
    border: none;
    text-decoration: none;
    cursor: pointer;
  }
  .danger {
    color: #c33 !important;
  }
  .empty {
    margin: 12px 24px;
  }
  .confirm {
    position: sticky;
    bottom: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    background: var(--container);
    border-top: 1px solid var(--outline-variant);
  }
  .confirm p {
    flex-basis: 100%;
    margin: 0;
  }
  .confirm button {
    padding: 6px 14px;
    font: inherit;
    background: none;
    border: 1px solid var(--outline);
    border-radius: 999px;
    cursor: pointer;
  }
</style>
