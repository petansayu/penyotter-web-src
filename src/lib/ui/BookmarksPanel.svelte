<script lang="ts">
  import { untrack } from "svelte";
  import { latest, type Event } from "../nostr/events";
  import { fetchFromAuthor } from "../nostr/outbox";
  import { eventsOf, pool } from "../nostr/pool";
  import { threadHref } from "../router.svelte";
  import { keepNotes, notes } from "../store/cache.svelte";
  import { viewer } from "../store/viewer.svelte";
  import NoteCard from "./NoteCard.svelte";

  /**
   * ブックマーク（公開ブックマーク、NIP-51 の kind 10003。Android 版の「その他」→「ブックマーク」）。新しく足したものを
   * 上に出す。非公開の分（content の暗号化）は読まない。外すのは投稿の「…」から。
   */
  const refs = $derived(
    (viewer.bookmarkList?.tags ?? [])
      .filter((tag) => (tag[0] === "e" && /^[0-9a-f]{64}$/.test(tag[1])) || (tag[0] === "a" && /^\d+:[0-9a-f]{64}:/.test(tag[1] ?? "")))
      .map((tag) => ({ type: tag[0] as "e" | "a", value: tag[1], hint: tag[2] }))
      .reverse(),
  );
  const addressed = new Map<string, Event>();
  let version = $state(0);
  let loading = $state(false);

  $effect(() => {
    const list = refs;
    untrack(() => void load(list));
  });

  async function load(list: typeof refs) {
    loading = true;
    try {
      const ids = list.filter((r) => r.type === "e" && !notes.has(r.value)).map((r) => r.value);
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        keepNotes(eventsOf(await pool.fetch(viewer.readRelays, [{ ids: chunk, limit: chunk.length }])));
      }
      await Promise.all(list.filter((r) => r.type === "a" && !addressed.has(r.value)).map(async (r) => {
        const [kind, pubkey, ...rest] = r.value.split(":");
        const fetched = await fetchFromAuthor(pubkey, [{ kinds: [Number(kind)], authors: [pubkey], "#d": [rest.join(":")], limit: 3 }], viewer.readRelays, r.hint ? [r.hint] : []);
        const found = latest(eventsOf(fetched));
        if (found) {
          addressed.set(r.value, found);
          keepNotes([found]);
        }
      }));
    } finally {
      loading = false;
      version++;
    }
  }

  const noteOf = (ref: (typeof refs)[number]) => (void version, ref.type === "e" ? notes.get(ref.value) : addressed.get(ref.value));
</script>

<section class="bookmarks">
  <h2>ブックマーク</h2>
  <p class="muted">公開ブックマーク（NIP-51 の kind 10003）です。足す・外すは、投稿の「…」から。非公開のブックマークは、この画面では読みません。</p>
  {#if !viewer.ready}
    <p class="muted">読んでいます…</p>
  {:else if refs.length === 0}
    <p class="muted">ブックマークはありません。</p>
  {/if}
</section>
{#each refs as ref (ref.type + ref.value)}
  {@const note = noteOf(ref)}
  {#if note}
    <NoteCard {note} />
  {:else if ref.type === "e"}
    <a class="missing" href={threadHref(ref.value)}>{loading ? "読み込んでいます…" : "投稿を読み込めませんでした（押すと探します）"}</a>
  {:else}
    <p class="missing">{loading ? "読み込んでいます…" : `読み込めませんでした（${ref.value.slice(0, 24)}…）`}</p>
  {/if}
{/each}

<style>
  .bookmarks {
    padding: 12px 16px 4px;
    border-bottom: 1px solid var(--outline-variant);
  }
  h2 {
    margin: 4px 0 8px;
    font-size: 1.2rem;
  }
  .muted {
    color: var(--muted);
    font-size: 0.9em;
    margin: 4px 0 8px;
  }
  .missing {
    display: block;
    margin: 0;
    padding: 12px 16px;
    color: var(--muted);
    font-size: 0.9em;
    border-bottom: 1px solid var(--outline-variant);
    text-decoration: none;
  }
</style>
