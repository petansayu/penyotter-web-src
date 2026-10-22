<script lang="ts">
  import { nip19 } from "nostr-tools";
  import { COLUMN_TYPES, MAX_COLUMNS, parseRelayParam, type ColumnType } from "../domain/deck";
  import { isHex64, tagValue, type Event } from "../nostr/events";
  import { fetchFromAuthor } from "../nostr/outbox";
  import { eventsOf } from "../nostr/pool";
  import { deck } from "../store/deck.svelte";
  import { GLOBAL_RELAY_SUGGESTIONS } from "../store/global";
  import { viewer } from "../store/viewer.svelte";

  /**
   * 列を足す欄。種類を選び、検索は検索語、リレーはリレーの URL、リストは自分のフォローセット、
   * 投稿・リアクション・プロフィールは npub（空なら自分）を入れる。「日本語」はリレーの列のひな形。
   */
  let { close, added }: { close: () => void; added?: (id: string) => void } = $props();

  let type = $state<ColumnType>("home");
  let value = $state("");
  let error = $state<string | null>(null);
  let lists = $state<Event[] | null>(null);
  let listsLoading = $state(false);
  let chosenList = $state("");

  const PERSON_TYPES: ColumnType[] = ["profile", "posts", "reactions"];
  const NEWLINE = String.fromCharCode(10);

  // リストを選んだら、自分のフォローセット（kind 30000）を読む
  $effect(() => {
    if (type !== "list" || lists || listsLoading || !viewer.pubkey) return;
    void loadLists(viewer.pubkey);
  });

  async function loadLists(me: string) {
    listsLoading = true;
    try {
      const fetched = await fetchFromAuthor(me, [{ kinds: [30000], authors: [me], limit: 100 }], viewer.readRelays);
      const latest = new Map<string, Event>();
      for (const event of eventsOf(fetched)) {
        const d = tagValue(event, "d");
        if (event.pubkey !== me || !d || d === "mute") continue;
        const before = latest.get(d);
        if (!before || event.created_at > before.created_at) latest.set(d, event);
      }
      lists = [...latest.values()].sort((a, b) => listName(a).localeCompare(listName(b), "ja"));
      const usable = lists.find((event) => memberCount(event) > 0);
      chosenList = usable ? address(usable) : "";
    } finally {
      listsLoading = false;
    }
  }

  const listName = (event: Event) => tagValue(event, "title") || tagValue(event, "name") || tagValue(event, "d") || "";
  const memberCount = (event: Event) => event.tags.filter((tag) => tag[0] === "p" && isHex64(tag[1])).length;
  const address = (event: Event) => `30000:${event.pubkey}:${tagValue(event, "d") ?? ""}`;

  function person(raw: string): string | undefined {
    const text = raw.trim().replace(/^nostr:/i, "");
    if (!text) return viewer.pubkey ?? undefined;
    if (isHex64(text.toLowerCase())) return text.toLowerCase();
    try {
      const decoded = nip19.decode(text.toLowerCase());
      if (decoded.type === "npub") return decoded.data;
      if (decoded.type === "nprofile") return decoded.data.pubkey;
    } catch {
      // 下で知らせる
    }
    return undefined;
  }

  function finish(id: string | null) {
    if (!id) {
      error = "足せませんでした（入れたものを確かめてください）";
      return;
    }
    close();
    added?.(id);
  }

  function full(): boolean {
    if (deck.columns.length < MAX_COLUMNS) return false;
    error = `列は ${MAX_COLUMNS} 個までです`;
    return true;
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    error = null;
    if (full()) return;
    if (type === "search") return finish(deck.add("search", value.trim()));
    if (type === "relays") {
      const relays = parseRelayParam(value);
      if (relays.length === 0) {
        error = "wss:// で始まるリレーを入れてください";
        return;
      }
      return finish(deck.add("relays", relays.join(" ")));
    }
    if (type === "list") {
      const list = lists?.find((event) => address(event) === chosenList);
      if (!list || memberCount(list) === 0) {
        error = "公開のメンバーがいるリストを選んでください";
        return;
      }
      return finish(deck.add("list", chosenList, { name: listName(list) }));
    }
    if (PERSON_TYPES.includes(type)) {
      const pubkey = person(value);
      if (!pubkey) {
        error = "npub を入れてください（空なら自分）";
        return;
      }
      return finish(deck.add(type, pubkey));
    }
    finish(deck.add(type));
  }

  /** 日本語のひな形: 日本のリレー 3 件から、ひらがな・カタカナを含む投稿だけ。 */
  function addJapanese() {
    error = null;
    if (full()) return;
    finish(deck.add("relays", GLOBAL_RELAY_SUGGESTIONS.join(" "), { name: "日本語", filter: { japanese: true } }));
  }
</script>

<form class="add" onsubmit={submit}>
  <p class="title">列を足す</p>
  <div class="types" role="radiogroup" aria-label="列の種類">
    {#each COLUMN_TYPES as option (option.type)}
      <label class:active={type === option.type}>
        <input type="radio" name="column-type" value={option.type} bind:group={type} />{option.label}
      </label>
    {/each}
  </div>
  {#if type === "search"}
    <input bind:value placeholder="キーワード・#タグ（空なら検索欄だけ）" aria-label="検索語" />
  {:else if type === "relays"}
    <textarea bind:value rows="3" placeholder={"wss://…" + NEWLINE + "（1 行に 1 件、12 件まで）"} aria-label="リレー" spellcheck="false"></textarea>
    <button type="button" class="preset" onclick={addJapanese}>ひな形「日本語」を足す（日本のリレー・かなを含む投稿だけ）</button>
  {:else if type === "list"}
    {#if listsLoading}
      <p class="muted">リストを読んでいます…</p>
    {:else if lists && lists.length === 0}
      <p class="muted">フォローセット（kind 30000）が見つかりませんでした。</p>
    {:else if lists}
      <select bind:value={chosenList} aria-label="リスト">
        {#each lists as list (address(list))}
          <option value={address(list)} disabled={memberCount(list) === 0}>{listName(list)}（{memberCount(list) > 0 ? `公開 ${memberCount(list)} 人` : "公開のメンバーなし"}）</option>
        {/each}
      </select>
      <p class="muted">公開のメンバーの投稿だけを読みます（非公開のメンバーは読みません）。</p>
    {/if}
  {:else if PERSON_TYPES.includes(type)}
    <input bind:value placeholder="npub（空なら自分）" aria-label="npub" spellcheck="false" />
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <div class="actions">
    <button type="button" class="text" onclick={close}>やめる</button>
    <button type="submit" class="ok">足す</button>
  </div>
</form>

<style>
  .add {
    display: grid;
    gap: 10px;
    width: 300px;
    padding: 14px;
    background: var(--container);
    border: 1px solid var(--outline-variant);
    border-radius: 12px;
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.2);
  }
  .title {
    margin: 0;
    font-weight: 700;
  }
  .types {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px 4px;
  }
  .types label {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.9em;
  }
  .types label.active {
    background: var(--secondary-container);
  }
  input:not([type]),
  textarea,
  select {
    font: inherit;
    padding: 8px 10px;
    border: 1px solid var(--outline);
    border-radius: 8px;
    background: var(--background);
    color: var(--text);
    resize: vertical;
  }
  .preset {
    font: inherit;
    font-size: 0.85em;
    text-align: left;
    padding: 6px 10px;
    color: var(--primary);
    background: var(--primary-container);
    border: none;
    border-radius: 8px;
    cursor: pointer;
  }
  .muted {
    margin: 0;
    color: var(--muted);
    font-size: 0.85em;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .actions button {
    font: inherit;
    cursor: pointer;
    border-radius: 999px;
    padding: 6px 16px;
  }
  .text {
    color: var(--primary);
    background: none;
    border: none;
  }
  .ok {
    color: var(--on-primary);
    background: var(--primary);
    border: none;
    font-weight: 600;
  }
  .error {
    margin: 0;
    color: #d33;
    font-size: 0.9em;
  }
</style>
