<script lang="ts">
  import { untrack } from "svelte";
  import { MAX_SET_TITLE } from "../domain/relaySets";
  import { relayHref, relaySetHref } from "../router.svelte";
  import { Feed, HOME_KINDS } from "../store/feed.svelte";
  import { relaySets } from "../store/relaySets.svelte";
  import { relaysSource } from "../store/sources";
  import { viewer } from "../store/viewer.svelte";
  import Timeline from "./Timeline.svelte";

  /**
   * 1 つのリレーのタイムライン（Android 版の、リレーの情報画面の「このリレーのタイムライン」）。そのリレーにあるだれの
   * 投稿でも新しい順に出す。署名できるアカウントでは、そのリレーを自分のリレーセットに入れる（あるセットか、新しく作る）。
   */
  let { url }: { url: string } = $props();

  let feed = $state<Feed>();
  let target = $state("");
  let newTitle = $state("");
  let message = $state<string | null>(null);

  $effect(() => {
    const relay = url;
    return untrack(() => {
      const current = new Feed(HOME_KINDS, relaysSource([relay]));
      feed = current;
      void current.start();
      return () => current.stop();
    });
  });

  $effect(() => {
    if (viewer.canSign) untrack(() => void relaySets.load());
  });

  async function addTo() {
    message = null;
    const id = target === "" ? await relaySets.create(newTitle, [url]) : await relaySets.change(target, { type: "add", relay: url });
    if (id) {
      message = "リレーセットに入れました";
      newTitle = "";
    }
  }
</script>

<section class="relay-feed">
  <h2>{url.replace(/^wss:\/\//, "")}</h2>
  <p class="muted">このリレーにある投稿を、だれのものでも新しい順に出します。<a href={relayHref(url)}>リレーの情報</a></p>
  {#if viewer.canSign}
    <div class="row">
      <select bind:value={target} aria-label="入れるリレーセット">
        <option value="">新しいリレーセットを作る</option>
        {#each relaySets.sets ?? [] as set (set.identifier)}<option value={set.identifier}>{set.title}</option>{/each}
      </select>
      {#if target === ""}<input bind:value={newTitle} maxlength={MAX_SET_TITLE} placeholder="新しいリレーセットの名前" aria-label="新しいリレーセットの名前" />{/if}
      <button type="button" disabled={relaySets.busy || (target === "" && !newTitle.trim()) || (target !== "" && !!relaySets.find(target)?.relays.includes(url))} onclick={addTo}>リレーセットに入れる</button>
    </div>
    {#if target !== "" && relaySets.find(target)?.relays.includes(url)}<p class="muted">このリレーはもう入っています。<a href={relaySetHref(target)}>リレーセットを開く</a></p>{/if}
    {#if message}<p class="muted" role="status">{message}</p>{/if}
  {/if}
</section>
{#if feed}<Timeline {feed} empty="このリレーの投稿はありません" />{/if}

<style>
  .relay-feed {
    padding: 12px 16px;
    border-bottom: 1px solid var(--outline-variant);
  }
  h2 {
    margin: 4px 0 6px;
    font-size: 1.15rem;
    overflow-wrap: anywhere;
  }
  .muted {
    margin: 4px 0;
    color: var(--muted);
    font-size: 0.9em;
  }
  .muted a {
    color: var(--primary);
    margin-left: 6px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 8px 0 4px;
  }
  select,
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
  button {
    padding: 4px 12px;
    font: inherit;
    font-size: 0.9em;
    color: var(--primary);
    background: none;
    border: 1px solid var(--outline);
    border-radius: 999px;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
  }
</style>
