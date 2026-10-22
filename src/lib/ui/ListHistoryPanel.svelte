<script lang="ts">
  import { diffTags } from "../domain/lists";
  import { displayName } from "../store/cache.svelte";
  import { emojis } from "../store/emojis.svelte";
  import { readVersions, type HistorySource, type Version } from "../store/listHistory";
  import { LIST_LABELS, lists, type ListKind } from "../store/lists.svelte";
  import { relayDraft } from "../store/relayList.svelte";
  import { viewer } from "../store/viewer.svelte";
  import { fullTime } from "./time";

  /**
   * 一覧の履歴（技術資料 7.4、Android 版の FollowHistoryPanel）。版ごとに今の一覧との差を見て、「足りない分だけ足す」か
   * 「この版に戻す」で戻す。戻すときは今の時刻で新しく署名する。
   */
  let kind = $state<ListKind | 10002>(3);
  // 一覧の今の版（タブごと）
  const TAB_LABELS: Record<ListKind | 10002, string> = { ...LIST_LABELS, 10002: "リレーリスト" };
  let versions = $state<Version[]>([]);
  let loading = $state(false);
  let open = $state<string | null>(null);
  let reload = $state(0);

  const SOURCES: Record<HistorySource, string> = { relay: "リレーから取った", local: "このブラウザにあった", app: "このアプリで変えた", "before-restore": "復元の直前" };
  const current = $derived(kind === 10002 ? viewer.relayListEvent : kind === 10030 ? emojis.listEvent : viewer.listOf(kind));

  $effect(() => {
    void reload;
    const me = viewer.pubkey;
    const k = kind;
    if (!me) return;
    loading = true;
    void readVersions(me, k).then((found) => {
      if (viewer.pubkey === me && kind === k) versions = found;
      loading = false;
    });
  });

  const count = (version: Version) => version.event.tags.filter((tag) => ["p", "e", "t", "word", "r", "a", "emoji"].includes(tag[0])).length;
  const label = (tag: string[]) => (tag[0] === "p" ? displayName(tag[1]) : tag[0] === "t" ? `#${tag[1]}` : tag[0] === "e" ? `投稿 ${tag[1].slice(0, 10)}…` : tag[0] === "emoji" ? `:${tag[1]}:` : tag[1]);
  // 絵文字リストのタブを開いたら、今の版を読む
  $effect(() => {
    if (kind === 10030) void emojis.load();
  });

  async function restore(version: Version, mode: "merge" | "exact") {
    if (await lists.restore(version.event, mode)) reload++;
  }
</script>

<section class="history">
  <h2>一覧の履歴</h2>
  <p class="muted">このブラウザに残した、フォロー一覧・ミュート一覧・ブックマーク・リレーリストの版です（一覧ごとに 100 版まで）。リレーリストは送らずに、リレー設定の画面へ読み込みます。取り違えた一覧を戻すときに使います。「保存分を消す」や「別の人に切り替える」では消えません。</p>
  <div class="tabs" role="tablist">
    {#each [3, 10000, 10003, 10030, 10002] as const as k (k)}
      <button type="button" role="tab" aria-selected={kind === k} class:active={kind === k} onclick={() => { kind = k; open = null; }}>{TAB_LABELS[k]}</button>
    {/each}
  </div>
  {#if loading}<p class="muted">読んでいます…</p>{:else if versions.length === 0}<p class="muted">まだ履歴がありません。</p>{/if}
  <ul>
    {#each versions as version (version.id)}
      {@const diff = diffTags(current?.tags ?? [], version.event.tags)}
      {@const isCurrent = current?.id === version.id}
      <li>
        <button type="button" class="row" onclick={() => (open = open === version.id ? null : version.id)} aria-expanded={open === version.id}>
          <span class="when">{fullTime(version.event.created_at)}</span>
          <span class="meta">{count(version)} 件・{SOURCES[version.source]}{version.pinned ? "・固定" : ""}{isCurrent ? "・今の版" : ""}</span>
          {#if !isCurrent}<span class="diff">今と比べて +{diff.added.length} / −{diff.removed.length}</span>{/if}
        </button>
        {#if open === version.id}
          <div class="detail">
            {#if diff.added.length > 0}<p><strong>今はない（戻すと増える）:</strong> {diff.added.slice(0, 30).map(label).join("、")}{diff.added.length > 30 ? ` ほか ${diff.added.length - 30} 件` : ""}</p>{/if}
            {#if diff.removed.length > 0}<p><strong>今だけある（この版に戻すと外れる）:</strong> {diff.removed.slice(0, 30).map(label).join("、")}{diff.removed.length > 30 ? ` ほか ${diff.removed.length - 30} 件` : ""}</p>{/if}
            {#if viewer.canSign && !isCurrent && kind === 10002}
              <div class="actions">
                <button type="button" onclick={() => { relayDraft.pending = version.event; location.hash = "#/settings/relays"; }}>リレー設定に読み込む</button>
              </div>
            {:else if viewer.canSign && !isCurrent && kind !== 10002}
              <div class="actions">
                <button type="button" disabled={lists.busy.has(kind as ListKind) || diff.added.length === 0} onclick={() => restore(version, "merge")}>足りない分だけ足す</button>
                <button type="button" disabled={lists.busy.has(kind as ListKind)} onclick={() => restore(version, "exact")}>この版に戻す</button>
              </div>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</section>

<style>
  .history {
    padding: 12px 16px 24px;
  }
  h2 {
    margin: 4px 0 8px;
    font-size: 1.2rem;
  }
  .muted {
    color: var(--muted);
    font-size: 0.9em;
    margin: 4px 0;
  }
  .tabs {
    display: flex;
    gap: 6px;
    margin: 12px 0;
  }
  .tabs button {
    font: inherit;
    padding: 6px 14px;
    color: var(--muted);
    background: none;
    border: 1px solid var(--outline-variant);
    border-radius: 999px;
    cursor: pointer;
  }
  .tabs button.active {
    color: var(--text);
    background: var(--secondary-container);
    border-color: transparent;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    border-bottom: 1px solid var(--outline-variant);
  }
  .row {
    display: grid;
    width: 100%;
    gap: 2px;
    padding: 8px 4px;
    font: inherit;
    text-align: left;
    color: var(--text);
    background: none;
    border: none;
    cursor: pointer;
  }
  .meta,
  .diff {
    font-size: 0.85em;
    color: var(--muted);
  }
  .detail {
    padding: 0 4px 10px;
    font-size: 0.9em;
  }
  .detail p {
    margin: 4px 0;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }
  .actions button {
    font: inherit;
    font-size: 0.9em;
    padding: 5px 14px;
    color: var(--primary);
    background: none;
    border: 1px solid var(--outline);
    border-radius: 999px;
    cursor: pointer;
  }
  .actions button:disabled {
    color: var(--outline);
    cursor: default;
  }
</style>
