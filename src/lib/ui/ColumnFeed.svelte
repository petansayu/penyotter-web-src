<script lang="ts">
  import { parseListAddress, parseRelayParam, type DeckColumn } from "../domain/deck";
  import { Feed, HOME_KINDS, PROFILE_KINDS, type Card } from "../store/feed.svelte";
  import { listSource, profileSource, reactionsSource, relaysSource } from "../store/sources";
  import { viewer } from "../store/viewer.svelte";
  import Timeline from "./Timeline.svelte";

  /**
   * カラム表示の、列ごとに読む一覧（リレー・リスト・投稿・リアクション）。列を作ったときに読み始め、列を消したら
   * 止める。ホームとグローバルは 1 列のときと同じ一覧を使うので、ここでは扱わない。
   */
  let { column, accept }: { column: DeckColumn; accept?: (card: Card) => boolean } = $props();

  // param が変わったら DeckColumn が作り直すので、作ったときの値で決めてよい
  // svelte-ignore state_referenced_locally
  const feed = create(column);

  function create(c: DeckColumn): Feed | null {
    const param = c.param ?? "";
    switch (c.type) {
      case "relays":
        return new Feed(HOME_KINDS, relaysSource(parseRelayParam(param)));
      case "posts":
        return new Feed(PROFILE_KINDS, profileSource(param));
      case "reactions":
        return new Feed([7], reactionsSource(param));
      case "list": {
        const address = parseListAddress(param);
        return address ? new Feed(HOME_KINDS, listSource(address.pubkey, address.identifier)) : null;
      }
      default:
        return null;
    }
  }

  // 見る人のリレーのリストを読んでから読み始める（リレーの列は決めたリレーだけなので、すぐでよい）
  const canStart = $derived(column.type === "relays" || viewer.ready);
  $effect(() => {
    if (!feed || !canStart) return;
    void feed.start();
    return () => feed.stop();
  });

  const empty = $derived(
    column.type === "list" ? "投稿がありません（リストの公開のメンバーだけを読みます）" : column.type === "reactions" ? "リアクションがありません" : "投稿がありません",
  );
</script>

{#if feed}
  {#if !canStart}<p class="notice">リレーのリストを読んでいます…</p>{/if}
  <Timeline {feed} {empty} {accept} />
{:else}
  <p class="notice">この列の設定を読めませんでした。列を消して足し直してください。</p>
{/if}

<style>
  .notice {
    color: var(--muted);
    padding: 12px 16px;
    margin: 0;
  }
</style>
