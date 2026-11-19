<script lang="ts">
  import { untrack } from "svelte";
  import { feedRelays, MAX_SET_TITLE } from "../domain/relaySets";
  import { relayFeedHref, relaySetHref } from "../router.svelte";
  import { Feed, HOME_KINDS } from "../store/feed.svelte";
  import { relaySets } from "../store/relaySets.svelte";
  import { relaysSource } from "../store/sources";
  import { viewer } from "../store/viewer.svelte";
  import Timeline from "./Timeline.svelte";

  /**
   * リレーセット（NIP-51 の kind 30002。Android 版の「その他」→「リスト」の「リレーセット」）。一覧から選ぶと、そのリレー
   * （はじめの 12 件）にあるだれの投稿でも新しい順に出す。署名できるアカウントでは、作る・リレーを足す・外す・名前を変える。
   */
  let { identifier = null }: { identifier?: string | null } = $props();

  let newTitle = $state("");
  let newRelay = $state("");
  let rename = $state("");
  let editing = $state(false);

  $effect(() => {
    if (!viewer.pubkey) return;
    untrack(() => void relaySets.load());
  });

  const chosen = $derived(identifier ? relaySets.find(identifier) : undefined);
  const relays = $derived(chosen ? feedRelays(chosen) : []);

  let feed = $state<Feed>();
  $effect(() => {
    const key = relays.join(" ");
    if (!key) return;
    return untrack(() => {
      const current = new Feed(HOME_KINDS, relaysSource(relays));
      feed = current;
      void current.start();
      return () => current.stop();
    });
  });

  async function create() {
    const id = await relaySets.create(newTitle);
    if (id) {
      newTitle = "";
      location.hash = relaySetHref(id);
    }
  }

  async function addRelay() {
    if (!identifier) return;
    if (await relaySets.change(identifier, { type: "add", relay: newRelay })) newRelay = "";
  }
</script>

{#if identifier}
  <section class="sets">
    <a class="back" href="#/relaysets">← リレーセットの一覧</a>
    <h2>{chosen?.title ?? identifier}</h2>
    {#if chosen}
      <p class="muted">{chosen.relays.length + chosen.privateRelays.length} 件{chosen.relays.length + chosen.privateRelays.length > 12 ? "（はじめの 12 件から読みます）" : ""}{chosen.privateRelays.length > 0 ? `・非公開 ${chosen.privateRelays.length} 件` : ""}</p>
      {#if viewer.canSign}<button type="button" class="outline" onclick={() => { editing = !editing; rename = chosen?.title ?? ""; }} aria-expanded={editing}>{editing ? "編集を閉じる" : "編集する"}</button>{/if}
      {#if editing && viewer.canSign}
        {@const id = identifier}
        <div class="edit">
          <div class="row">
            <input bind:value={rename} maxlength={MAX_SET_TITLE} aria-label="リレーセットの名前" />
            <button type="button" class="outline" disabled={relaySets.busy || !rename.trim() || rename.trim() === chosen.title} onclick={() => relaySets.change(id, { type: "rename", title: rename })}>名前を変える</button>
          </div>
          <div class="row">
            <input bind:value={newRelay} placeholder="wss://…" aria-label="足すリレー" />
            <button type="button" class="outline" disabled={relaySets.busy || !newRelay.trim()} onclick={addRelay}>リレーを足す</button>
          </div>
          <ul>
            {#each chosen.relays as url (url)}
              <li><a href={relayFeedHref(url)}>{url.replace(/^wss:\/\//, "")}</a><button type="button" class="outline" disabled={relaySets.busy} onclick={() => relaySets.change(id, { type: "remove", relay: url })}>外す</button></li>
            {/each}
            {#each chosen.privateRelays as url (url)}
              <li><a href={relayFeedHref(url)}>{url.replace(/^wss:\/\//, "")}</a><small>非公開（ここでは変えません）</small></li>
            {/each}
          </ul>
        </div>
      {/if}
    {:else if relaySets.sets !== null}<p class="muted">このリレーセットは見つかりませんでした。</p>{/if}
  </section>
  {#if chosen && relays.length === 0}<p class="note">このリレーセットにはリレーがありません。</p>
  {:else if feed && chosen}<Timeline {feed} empty="このリレーの投稿はありません" />{/if}
{:else}
  <section class="sets">
    <nav class="tabs"><a href="#/lists">フォローセット</a><span class="active">リレーセット</span></nav>
    <p class="muted">自分のリレーセット（NIP-51 の kind 30002）です。選ぶと、そのリレーにあるだれの投稿でも新しい順に出します。</p>
    {#if viewer.canSign}
      <div class="row">
        <input bind:value={newTitle} maxlength={MAX_SET_TITLE} placeholder="新しいリレーセットの名前" aria-label="新しいリレーセットの名前" />
        <button type="button" class="outline" disabled={relaySets.busy || !newTitle.trim()} onclick={create}>作る</button>
      </div>
    {/if}
    {#if relaySets.message}<p class="muted">{relaySets.message}</p>{/if}
    {#if relaySets.sets === null}<p class="muted">読み込んでいます…</p>
    {:else if relaySets.sets.length === 0}<p class="muted">リレーセットがありません</p>
    {:else}
      <ul>
        {#each relaySets.sets as set (set.identifier)}
          <li><a class="set" href={relaySetHref(set.identifier)}><strong>{set.title}</strong><small>{set.relays.length} 件{set.privateRelays.length > 0 ? `＋非公開 ${set.privateRelays.length}` : ""}</small></a></li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .sets {
    padding: 12px 16px;
    border-bottom: 1px solid var(--outline-variant);
  }
  h2 {
    margin: 4px 0 8px;
    font-size: 1.2rem;
  }
  .muted,
  .note {
    margin: 4px 0;
    color: var(--muted);
    font-size: 0.9em;
  }
  .note {
    padding: 16px;
  }
  .tabs {
    display: flex;
    gap: 16px;
    margin-bottom: 8px;
    font-weight: 600;
  }
  .tabs a {
    color: var(--muted);
    text-decoration: none;
  }
  .tabs .active {
    color: var(--text);
    border-bottom: 2px solid var(--primary);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 8px 0;
  }
  input {
    flex: 1;
    min-width: 140px;
    font: inherit;
    padding: 6px 8px;
    color: var(--text);
    background: var(--background);
    border: 1px solid var(--outline);
    border-radius: 8px;
  }
  .outline {
    padding: 4px 12px;
    font: inherit;
    font-size: 0.9em;
    color: var(--primary);
    background: none;
    border: 1px solid var(--outline);
    border-radius: 999px;
    cursor: pointer;
  }
  .outline:disabled {
    opacity: 0.5;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 4px;
    border-bottom: 1px solid var(--outline-variant);
  }
  li a {
    color: var(--text);
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  .set {
    display: flex;
    flex: 1;
    align-items: baseline;
    justify-content: space-between;
    padding: 4px 0;
  }
  small {
    color: var(--muted);
  }
  .back {
    color: var(--primary);
    text-decoration: none;
    font-size: 0.9em;
  }
</style>
