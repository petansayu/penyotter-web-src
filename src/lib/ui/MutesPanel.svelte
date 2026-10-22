<script lang="ts">
  import { profileHref, threadHref } from "../router.svelte";
  import { displayName, requestProfiles } from "../store/cache.svelte";
  import { lists } from "../store/lists.svelte";
  import { viewer } from "../store/viewer.svelte";
  import Avatar from "./Avatar.svelte";

  /** ミュート（Android 版の設定「ミュート」）。公開の分だけを出し、解除できる。非公開の分（暗号化）は読まないが、書き換えても残す。 */
  const people = $derived([...viewer.mutedPubkeys]);
  const posts = $derived([...viewer.mutedEvents]);
  const others = $derived(viewer.muteList?.tags.filter((tag) => (tag[0] === "t" || tag[0] === "word") && tag[1]) ?? []);
  const hasPrivate = $derived(!!viewer.muteList?.content);

  $effect(() => {
    requestProfiles(people);
  });
</script>

<section class="mutes">
  <h2>ミュート</h2>
  {#if !viewer.ready}<p class="muted">読んでいます…</p>{/if}
  {#if hasPrivate}<p class="muted">非公開のミュート（暗号化した分）は、この画面では読みません。書き換えてもそのまま残します。</p>{/if}

  <h3>ユーザー（{people.length}）</h3>
  {#if people.length === 0}<p class="muted">ありません</p>{/if}
  <ul>
    {#each people as pubkey (pubkey)}
      <li>
        <a href={profileHref(pubkey)}><Avatar {pubkey} size={28} /><span>{displayName(pubkey)}</span></a>
        {#if viewer.canSign}<button type="button" disabled={lists.busy.has(10000)} onclick={() => lists.unmuteUser(pubkey)}>解除</button>{/if}
      </li>
    {/each}
  </ul>

  <h3>投稿（{posts.length}）</h3>
  {#if posts.length === 0}<p class="muted">ありません</p>{/if}
  <ul>
    {#each posts as id (id)}
      <li>
        <a href={threadHref(id)}><span class="mono">{id.slice(0, 16)}…</span></a>
        {#if viewer.canSign}<button type="button" disabled={lists.busy.has(10000)} onclick={() => lists.unmutePost(id)}>解除</button>{/if}
      </li>
    {/each}
  </ul>

  {#if others.length > 0}
    <h3>語・ハッシュタグ（{others.length}）</h3>
    <p class="muted">この Web 版では、語とハッシュタグのミュートはまだ使っていません（ほかのアプリで設定したものは残します）。</p>
    <ul>{#each others as tag, i (i)}<li><span>{tag[0] === "t" ? `#${tag[1]}` : tag[1]}</span></li>{/each}</ul>
  {/if}
</section>

<style>
  .mutes {
    padding: 12px 16px 24px;
  }
  h2 {
    margin: 4px 0 8px;
    font-size: 1.2rem;
  }
  h3 {
    margin: 16px 0 6px;
    font-size: 1rem;
  }
  .muted {
    color: var(--muted);
    font-size: 0.9em;
    margin: 4px 0;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid var(--outline-variant);
  }
  li a {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    color: var(--text);
    text-decoration: none;
  }
  li a span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mono {
    font-family: ui-monospace, monospace;
    font-size: 0.9em;
  }
  button {
    flex: none;
    font: inherit;
    font-size: 0.85em;
    padding: 4px 14px;
    color: var(--primary);
    background: none;
    border: 1px solid var(--outline);
    border-radius: 999px;
    cursor: pointer;
  }
  button:disabled {
    color: var(--outline);
    cursor: default;
  }
</style>
