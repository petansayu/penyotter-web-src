<script lang="ts">
  import { untrack } from "svelte";
  import { notes, requestNote } from "../store/cache.svelte";
  import { threadHref } from "../router.svelte";
  import NoteCard from "./NoteCard.svelte";

  /** 引用カード。ID で読み、読めないときは投稿へのリンクだけ出す。 */
  let { id, relays = [], author }: { id: string; relays?: string[]; author?: string } = $props();

  const note = $derived(notes.get(id));
  let missing = $state(false);

  $effect(() => {
    const [key, hints, by] = [id, relays, author];
    untrack(() => {
      missing = false;
      requestNote(key, hints, by).then((event) => (missing = !event));
    });
  });
</script>

{#if note}
  <NoteCard {note} nested />
{:else}
  <a class="placeholder" href={threadHref(id, author, relays)}>{missing ? "引用された投稿を読み込めませんでした" : "引用された投稿を読み込んでいます…"}</a>
{/if}

<style>
  .placeholder {
    display: block;
    margin-top: 8px;
    padding: 10px 12px;
    border: 1px dashed var(--outline);
    border-radius: 12px;
    color: var(--muted);
    font-size: 0.9em;
    text-decoration: none;
  }
</style>
