<script lang="ts">
  import { untrack } from "svelte";
  import { latest, tagValue, type Event } from "../nostr/events";
  import { fetchFromAuthor } from "../nostr/outbox";
  import { eventsOf } from "../nostr/pool";
  import { Feed, HOME_KINDS } from "../store/feed.svelte";
  import { listSource } from "../store/sources";
  import { viewer } from "../store/viewer.svelte";
  import Timeline from "./Timeline.svelte";

  /**
   * リスト（自分のフォローセット、NIP-51 の kind 30000。Android 版の「その他」→「リスト」、ListsPanel）。一覧から選ぶと、
   * そのメンバーの投稿をホームと同じ読み方で出す。非公開のメンバーは、開いたときに復号する（署名できるときだけ）。
   * `d` が mute のものは出さない。
   */
  let { identifier = null }: { identifier?: string | null } = $props();

  let sets = $state<Event[] | null>(null);
  const name = (event: Event) => tagValue(event, "title") || tagValue(event, "name") || tagValue(event, "d") || "（名前なし）";
  const members = (event: Event) => event.tags.filter((tag) => tag[0] === "p").length;
  const chosen = $derived(identifier ? sets?.find((event) => tagValue(event, "d") === identifier) : undefined);

  $effect(() => {
    const me = viewer.pubkey;
    if (!me) return;
    untrack(() => {
      void fetchFromAuthor(me, [{ kinds: [30000], authors: [me], limit: 100 }], viewer.readRelays).then((fetched) => {
        const byD = new Map<string, Event[]>();
        for (const event of eventsOf(fetched)) {
          const d = tagValue(event, "d") ?? "";
          if (event.pubkey !== me || d === "mute") continue;
          byD.set(d, [...(byD.get(d) ?? []), event]);
        }
        sets = [...byD.values()].map((versions) => latest(versions)!).sort((a, b) => name(a).localeCompare(name(b), "ja"));
      });
    });
  });

  let feed = $state<Feed>();
  $effect(() => {
    const [me, d] = [viewer.pubkey, identifier];
    if (!me || !d) return;
    return untrack(() => {
      const current = new Feed(HOME_KINDS, listSource(me, d));
      feed = current;
      void current.start();
      return () => current.stop();
    });
  });
</script>

{#if identifier}
  <section class="lists">
    <a class="back" href="#/lists">← リストの一覧</a>
    <h2>{chosen ? name(chosen) : identifier}</h2>
  </section>
  {#if feed}<Timeline {feed} empty="このリストの人の投稿はありません" />{/if}
{:else}
  <section class="lists">
    <h2>リスト</h2>
    <p class="muted">自分のフォローセット（NIP-51 の kind 30000）です。選ぶと、その人たちの投稿を出します。</p>
    {#if sets === null}<p class="muted">読み込んでいます…</p>
    {:else if sets.length === 0}<p class="muted">リストがありません</p>
    {:else}
      <ul>
        {#each sets as set (set.id)}
          <li><a href="#/lists/{encodeURIComponent(tagValue(set, 'd') ?? '')}"><strong>{name(set)}</strong><small>{members(set)}人{set.content ? "＋非公開" : ""}</small></a></li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .lists {
    padding: 12px 16px;
    border-bottom: 1px solid var(--outline-variant);
  }
  h2 {
    margin: 4px 0 8px;
    font-size: 1.2rem;
  }
  .muted {
    margin: 4px 0;
    color: var(--muted);
    font-size: 0.9em;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li a {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 10px 4px;
    color: var(--text);
    text-decoration: none;
    border-bottom: 1px solid var(--outline-variant);
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
