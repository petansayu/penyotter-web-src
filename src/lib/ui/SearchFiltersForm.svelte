<script lang="ts">
  import { untrack } from "svelte";
  import { nip19 } from "nostr-tools";
  import { MEDIA_TYPES, NO_FILTERS, POST_TYPES, type MediaType, type PostType, type SearchFilters } from "../domain/search";

  /** 検索の絞り込みの欄（Android 版の検索の絞り込みと同じ項目）。適用で apply を呼ぶ。 */
  let { value, apply }: { value: SearchFilters; apply: (filters: SearchFilters) => void } = $props();

  const day = (seconds?: number) => (seconds === undefined ? "" : new Date(seconds * 1000).toLocaleDateString("sv-SE"));
  const npubs = (keys: string[]) => keys.map((key) => nip19.npubEncode(key)).join("\n");

  // 欄を開いたときの値で始める（開くたびに作り直すので、あとから value が変わっても追わない）
  const initial = untrack(() => value);
  let since = $state(day(initial.since));
  let until = $state(day(initial.until));
  let authors = $state(npubs(initial.authors));
  let excludedAuthors = $state(npubs(initial.excludedAuthors));
  let tags = $state(initial.tags.join(" "));
  let excludedTags = $state(initial.excludedTags.join(" "));
  let excludedTerms = $state(initial.excludedTerms.join(" "));
  let postType = $state<PostType>(initial.postType);
  let mediaType = $state<MediaType>(initial.mediaType);
  let error = $state<string | null>(null);

  /** npub・nprofile・16 進を 1 行に 1 人。読めない行があれば例外。 */
  function people(text: string): string[] {
    const result: string[] = [];
    for (const line of text.split(/[\s,]+/).map((v) => v.trim().replace(/^nostr:/i, "")).filter(Boolean)) {
      if (/^[0-9a-fA-F]{64}$/.test(line)) result.push(line.toLowerCase());
      else {
        try {
          const decoded = nip19.decode(line.toLowerCase());
          if (decoded.type === "npub") result.push(decoded.data);
          else if (decoded.type === "nprofile") result.push(decoded.data.pubkey);
          else throw new Error();
        } catch {
          throw new Error(`作者は npub で入れてください（${line.slice(0, 20)}）`);
        }
      }
    }
    return [...new Set(result)].slice(0, 20);
  }

  const words = (text: string) => [...new Set(text.split(/[\s,、]+/).map((v) => v.trim().replace(/^[#＃]/, "")).filter(Boolean))];

  function submit(event: SubmitEvent) {
    event.preventDefault();
    try {
      // 日付はその日の始まりから、終わりまで（このブラウザの時刻で）
      const start = since ? Math.floor(new Date(`${since}T00:00:00`).getTime() / 1000) : undefined;
      const end = until ? Math.floor(new Date(`${until}T23:59:59`).getTime() / 1000) : undefined;
      if (start !== undefined && end !== undefined && start > end) throw new Error("期間の始まりが終わりより後になっています");
      error = null;
      apply({
        since: start,
        until: end,
        authors: people(authors),
        excludedAuthors: people(excludedAuthors),
        tags: words(tags).map((tag) => tag.toLowerCase()),
        excludedTags: words(excludedTags).map((tag) => tag.toLowerCase()),
        excludedTerms: words(excludedTerms),
        postType,
        mediaType,
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<form class="filters" onsubmit={submit}>
  <div class="row">
    <label>いつから<input type="date" bind:value={since} /></label>
    <label>いつまで<input type="date" bind:value={until} /></label>
  </div>
  <div class="row">
    <label>種類
      <select bind:value={postType}>{#each POST_TYPES as option (option.value)}<option value={option.value}>{option.label}</option>{/each}</select>
    </label>
    <label>メディア
      <select bind:value={mediaType}>{#each MEDIA_TYPES as option (option.value)}<option value={option.value}>{option.label}</option>{/each}</select>
    </label>
  </div>
  <label>作者（npub、20 人まで）<textarea bind:value={authors} rows="2" spellcheck="false"></textarea></label>
  <label>除く作者（npub）<textarea bind:value={excludedAuthors} rows="1" spellcheck="false"></textarea></label>
  <div class="row">
    <label>タグ（すべて含む）<input bind:value={tags} placeholder="nostr 日本語" /></label>
    <label>除くタグ<input bind:value={excludedTags} /></label>
  </div>
  <label>除く語<input bind:value={excludedTerms} placeholder="空白で区切る" /></label>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <div class="actions">
    <button type="button" class="text" onclick={() => apply(NO_FILTERS)}>解除</button>
    <button type="submit" class="apply">適用</button>
  </div>
</form>

<style>
  .filters {
    display: grid;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--outline-variant);
    background: var(--surface-low);
    font-size: 0.9em;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  label {
    display: grid;
    gap: 2px;
    color: var(--muted);
    min-width: 0;
  }
  input,
  select,
  textarea {
    font: inherit;
    width: 100%;
    min-width: 0;
    padding: 6px 8px;
    border: 1px solid var(--outline);
    border-radius: 8px;
    background: var(--background);
    color: var(--text);
  }
  textarea {
    resize: vertical;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  button {
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
  .apply {
    color: var(--on-primary);
    background: var(--primary);
    border: none;
    font-weight: 600;
  }
  .error {
    margin: 0;
    color: #d33;
  }
</style>
