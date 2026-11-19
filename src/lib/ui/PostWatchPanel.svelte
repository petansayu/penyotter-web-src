<script lang="ts">
  import { watchSummary, type WatchRule } from "../domain/watchedPosts";
  import { profileHref } from "../router.svelte";
  import { displayName, requestProfiles } from "../store/cache.svelte";
  import { postWatch } from "../store/postWatch.svelte";
  import { viewer } from "../store/viewer.svelte";
  import Avatar from "./Avatar.svelte";
  import PostWatchDialog from "./PostWatchDialog.svelte";

  /** 投稿のお知らせに出している人の一覧（`#/post-watch`、Android 版の PostWatchPanel）。通知の調整のアイコンから開く。 */
  const me = $derived(viewer.pubkey);
  const rules = $derived(me ? postWatch.rules(me) : []);
  let editing = $state<WatchRule | null>(null);

  $effect(() => {
    requestProfiles(rules.map((rule) => rule.pubkey));
  });
</script>

<p class="intro">ここにいる人の新しい投稿を、通知の「投稿」に出します。追加はその人のプロフィールから。この一覧はこのブラウザだけに保存します。</p>
{#each rules as rule (rule.pubkey)}
  <div class="row">
    <a class="who" href={profileHref(rule.pubkey)}>
      <Avatar pubkey={rule.pubkey} size={40} />
      <span class="text"><strong>{displayName(rule.pubkey)}</strong><small>{watchSummary(rule)}</small></span>
    </a>
    <button type="button" class="change" onclick={() => (editing = rule)}>変更</button>
  </div>
{:else}
  <p class="intro">まだだれもいません</p>
{/each}

{#if me && editing}
  <PostWatchDialog {me} pubkey={editing.pubkey} rule={editing} close={() => (editing = null)} />
{/if}

<style>
  .intro {
    margin: 10px 16px;
    font-size: 0.85em;
    color: var(--muted);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--outline-variant);
  }
  .who {
    display: flex;
    flex: 1;
    min-width: 0;
    align-items: center;
    gap: 12px;
    color: inherit;
    text-decoration: none;
  }
  .text {
    display: grid;
    min-width: 0;
  }
  .text strong,
  .text small {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .text small {
    color: var(--muted);
  }
  .change {
    padding: 4px 12px;
    font: inherit;
    color: var(--primary);
    background: none;
    border: none;
    cursor: pointer;
  }
</style>
