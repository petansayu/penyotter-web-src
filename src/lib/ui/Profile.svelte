<script lang="ts">
  import { nip19 } from "nostr-tools";
  import { untrack } from "svelte";
  import { fetchFromAuthor } from "../nostr/outbox";
  import { eventsOf } from "../nostr/pool";
  import type { Badge } from "../domain/badges";
  import type { Event } from "../nostr/events";
  import { resolveNip05 } from "../nostr/nip05";
  import { profileHref, relayHref, writeHref } from "../router.svelte";
  import { displayName, keepProfiles, profiles, requestProfiles } from "../store/cache.svelte";
  import { countFollowers, loadBadges, loadFollowers, loadFollowing, loadPinned, loadReactions, loadRelays } from "../store/profileExtras";
  import { requestStatuses, statuses } from "../store/statuses.svelte";
  import NoteCard from "./NoteCard.svelte";
  import { quoteCardId } from "../domain/content";
  import { parent } from "../domain/threads";
  import type { Card } from "../store/feed.svelte";
  import ReportDialog from "./ReportDialog.svelte";
  import StatusEditor from "./StatusEditor.svelte";
  import { Feed, PROFILE_KINDS } from "../store/feed.svelte";
  import { articlesSource, profileSource } from "../store/sources";
  import { lists } from "../store/lists.svelte";
  import { viewer } from "../store/viewer.svelte";
  import Avatar from "./Avatar.svelte";
  import Content from "./Content.svelte";
  import Icon from "./Icon.svelte";
  import ProfileEditor from "./ProfileEditor.svelte";
  import Timeline from "./Timeline.svelte";

  /** プロフィール（技術資料 5.5、Android 版の ProfilePanel）。タブは投稿・記事・リアクション・リレー、数を押すとフォロー・フォロワー。 */
  let { pubkey, relays = [] }: { pubkey: string; relays?: string[] } = $props();

  const profile = $derived(profiles.get(pubkey)?.profile);
  const petname = $derived(viewer.petnames.get(pubkey));
  const name = $derived(petname ? `📛${petname}` : profile?.displayName || profile?.name || `${nip19.npubEncode(pubkey).slice(0, 16)}…`);
  let editingPetname = $state<string | null>(null);
  const npub = $derived(nip19.npubEncode(pubkey));
  let copied = $state(false);
  const self = $derived(pubkey === viewer.pubkey);
  const following = $derived(viewer.follows.includes(pubkey));
  const muted = $derived(viewer.mutedPubkeys.has(pubkey));
  let editing = $state(false);

  /** 投稿タブの印: 引用・返信（kind 1111 はコメント）・メンション。リポストには付けない（Android 版の ProfileActivityLabel）。 */
  function activityLabel(card: Card): string | null {
    if (card.repost || card.reaction) return null;
    const note = card.note;
    if (quoteCardId(note) !== null) return "引用";
    if (parent(note) !== null) return note.kind === 1111 ? "コメント" : "返信";
    if (note.tags.some((tag) => tag[0] === "p" && tag[1])) return "メンション";
    return null;
  }
  let editingStatus = $state(false);
  let reporting = $state(false);
  const TABS: [Tab, string][] = [["posts", "投稿"], ["articles", "記事"], ["reactions", "リアクション"], ["relays", "リレー"]];

  let feed = $state<Feed>();
  let articles = $state<Feed>();
  type Tab = "posts" | "articles" | "reactions" | "relays" | "following" | "followers";
  let tab = $state<Tab>("posts");

  let pinned = $state<Event[]>([]);
  let badges = $state<Badge[]>([]);
  let followingIds = $state<string[] | null>(null);
  let followerCount = $state<{ count: number; approximate: boolean } | null>(null);
  let followerIds = $state<string[] | null>(null);
  let followersComplete = $state(false);
  let reactions = $state<{ reaction: Event; target: Event }[] | null>(null);
  let relayRows = $state<{ url: string; read: boolean; write: boolean }[] | null | undefined>(undefined);
  let nip05State = $state<"idle" | "checking" | "verified" | "mismatch" | "failed">("idle");
  let nip05Message = $state<string | null>(null);
  const statusList = $derived(statuses.get(pubkey) ?? []);

  function select(next: Tab) {
    tab = next;
    if (next === "articles") return openArticles();
    const key = pubkey;
    if (next === "reactions" && reactions === null) void loadReactions(key, relays).then((r) => key === pubkey && (reactions = r)).catch(() => (reactions = []));
    if (next === "relays" && relayRows === undefined) void loadRelays(key).then((r) => key === pubkey && (relayRows = r));
    if (next === "following" && followingIds) requestProfiles(followingIds.slice(0, 200));
    if (next === "followers" && followerIds === null) {
      void loadFollowers(key).then((r) => {
        if (key !== pubkey) return;
        followerIds = r.ids;
        followersComplete = r.complete;
      });
    }
  }

  async function verifyNip05() {
    if (!profile?.nip05 || nip05State === "checking") return;
    nip05State = "checking";
    nip05Message = "NIP-05を確認中…";
    try {
      const resolved = await resolveNip05(profile.nip05);
      nip05State = resolved === pubkey ? "verified" : "mismatch";
      nip05Message = resolved === pubkey ? "公開鍵との一致を確認しました" : "公開鍵がプロフィールと一致しません";
    } catch (e) {
      nip05State = "failed";
      nip05Message = e instanceof Error && e.message.startsWith("NIP-05") ? e.message : "NIP-05を確認できませんでした。再試行できます";
    }
  }

  const birthday = $derived.by(() => {
    const b = profile?.birthday;
    return b ? `${b.year ? `${b.year}年` : ""}${b.month ? `${b.month}月` : ""}${b.day ? `${b.day}日` : ""}` : null;
  });

  /** 記事のタブは、初めて開いたときに読む。 */
  function openArticles() {
    if (articles) return;
    const current = new Feed([30023], articlesSource(pubkey, relays));
    articles = current;
    void current.start();
  }

  // 相手が変わったときだけ読み直す（読み込み中に変わる状態では読み直さない）
  $effect(() => {
    const [key, hints] = [pubkey, relays];
    return untrack(() => {
      const current = new Feed(PROFILE_KINDS, profileSource(key, hints));
      feed = current;
      // 相手が変わったら、タブの中身を読み直す
      tab = "posts";
      articles = undefined;
      pinned = [];
      badges = [];
      followingIds = null;
      followerCount = null;
      followerIds = null;
      reactions = null;
      relayRows = undefined;
      nip05State = "idle";
      nip05Message = null;
      requestStatuses([key]);
      void loadPinned(key, hints).then((r) => key === pubkey && (pinned = r)).catch(() => {});
      void loadBadges(key, hints).then((r) => key === pubkey && (badges = r)).catch(() => {});
      void loadFollowing(key, hints).then((r) => key === pubkey && (followingIds = r.complete ? r.ids : null));
      void countFollowers(key).then((r) => key === pubkey && (followerCount = r));
      void fetchFromAuthor(key, [{ kinds: [0], authors: [key], limit: 1 }], viewer.readRelays, hints).then((fetched) =>
        keepProfiles(eventsOf(fetched)),
      );
      // 手元にあるその人の投稿を先に出してから、リレーに問い合わせる
      void current.showSaved();
      void current.start();
      return () => current.stop();
    });
  });

  async function copy() {
    await navigator.clipboard.writeText(npub);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<section class="profile">
  {#if profile?.banner}<img class="banner" src={profile.banner} alt="" referrerpolicy="no-referrer" />{:else}<div class="banner"></div>{/if}
  <div class="head">
    <span class="icon"><Avatar {pubkey} size={80} alwaysPicture /></span>
    {#if viewer.canSign && self && !editing}
      <div class="buttons">
        <button type="button" class="outline" onclick={() => (editing = true)}>プロフィールを編集</button>
      </div>
    {/if}
    {#if viewer.canSign && !self}
      <div class="buttons">
        {#if following}
          <button type="button" class="outline" disabled={lists.busy.has(3) || !viewer.ready} onclick={() => lists.unfollow(pubkey)}>フォローを外す</button>
        {:else}
          <button type="button" class="filled" disabled={lists.busy.has(3) || !viewer.ready} onclick={() => lists.follow(pubkey)}>フォローする</button>
        {/if}
        <button type="button" class="outline" disabled={lists.busy.has(10000) || !viewer.ready} onclick={() => (muted ? lists.unmuteUser(pubkey) : lists.muteUser(pubkey))}>{muted ? "ミュートを解除" : "ミュート"}</button>
        <button type="button" class="outline" onclick={() => (reporting = true)}>通報</button>
      </div>
    {/if}
    <h1>{name}{#if profile?.bot}<span class="bot">BOT</span>{/if}</h1>
    {#if !self && viewer.ready && following}<div class="badge">フォロー中</div>{/if}
    {#if petname}<div class="petname">設定中 · 📛{petname}{#if profile?.displayName || profile?.name}（{profile?.displayName || profile?.name}）{/if}</div>{/if}
    {#if viewer.canSign && following && !self}
      {#if editingPetname === null}
        <button type="button" class="link" onclick={() => (editingPetname = petname ?? "")}>📛 ペットネームを編集</button>
      {:else}
        <div class="petname-edit">
          <input type="text" maxlength="160" bind:value={editingPetname} placeholder="空にすると消します" aria-label="ペットネーム" />
          <button type="button" class="link" disabled={lists.busy.has(3)} onclick={async () => { if (await lists.renamePetname(pubkey, editingPetname ?? "")) editingPetname = null; }}>保存</button>
          <button type="button" class="link" onclick={() => (editingPetname = null)}>やめる</button>
        </div>
      {/if}
    {/if}
    {#if profile?.name && profile.displayName && profile.name !== profile.displayName}<div class="muted">@{profile.name}</div>{/if}
    {#if profile?.nip05}
      <div class="nip05">
        <span class="muted">{profile.nip05.replace(/^_@/, "")}</span>
        {#if nip05State === "verified"}<span class="verified" title="確認済み">✓</span>{:else if nip05State === "mismatch"}<span class="mismatch" title="不一致">！</span>{:else if nip05State === "checking"}<span class="muted">…</span>{/if}
        {#if nip05State !== "verified" && nip05State !== "checking"}<button type="button" class="link" onclick={verifyNip05}>{nip05State === "idle" ? "確認" : "再確認"}</button>{/if}
      </div>
      {#if nip05Message}<div class="small" class:ok={nip05State === "verified"}>{nip05Message}</div>{/if}
    {/if}
    <button type="button" class="npub" onclick={copy} title="npub をコピー"><Icon name="contentCopy" size={14} />{copied ? "コピーしました" : `${npub.slice(0, 20)}…`}</button>
    {#if profile?.about}<div class="about"><Content text={profile.about} emojis={new Map()} /></div>{/if}
    {#each statusList as status (status.type)}
      <div class="status"><span class="dot">{status.type === "music" ? "♫" : "●"}</span>{status.content}</div>
    {/each}
    {#if self && viewer.canSign}
      {#if editingStatus}<StatusEditor close={() => (editingStatus = false)} />
      {:else}<button type="button" class="link status-edit" onclick={() => (editingStatus = true)}>{statusList.length > 0 ? "ステータスを変更" : "● ステータスを設定"}</button>{/if}
    {/if}
    {#if birthday}<div class="muted small">誕生日: {birthday}</div>{/if}
    {#if badges.length > 0}
      <div class="badges">
        {#each badges as badge (badge.address)}
          <span class="badge-item" title={badge.description ? `${badge.name}\n${badge.description}` : badge.name}>
            {#if badge.thumb}<img src={badge.thumb} alt={badge.name} referrerpolicy="no-referrer" loading="lazy" />{:else}<span class="badge-name">{badge.name}</span>{/if}
          </span>
        {/each}
      </div>
    {/if}
    {#if profile?.lud16}<div class="muted small">⚡ {profile.lud16}</div>{/if}
    {#if profile?.website}<a href={profile.website} target="_blank" rel="noopener noreferrer nofollow">{profile.website}</a>{/if}
    <div class="counts">
      <button type="button" onclick={() => select("following")}><strong>{followingIds ? followingIds.length : "—"}</strong> フォロー</button>
      <button type="button" onclick={() => select("followers")}><strong>{followerCount ? `${followerCount.approximate ? "約" : ""}${followerCount.count}` : "—"}</strong> フォロワー</button>
    </div>
  </div>
</section>

{#if editing}<ProfileEditor close={() => (editing = false)} />{/if}
{#if reporting}<ReportDialog target={{ pubkey }} close={() => (reporting = false)} />{/if}

<div class="tabs" role="tablist">
  {#each TABS as [key, label] (key)}
    <button type="button" role="tab" aria-selected={tab === key} class:active={tab === key} onclick={() => select(key)}>{label}</button>
  {/each}
</div>
{#if tab === "following" || tab === "followers"}
  {@const ids = tab === "following" ? followingIds : followerIds}
  <div class="list-head"><strong>{tab === "following" ? "フォロー" : "フォロワー"}</strong><button type="button" class="link" onclick={() => (tab = "posts")}>閉じる</button></div>
  {#if ids === null}
    <p class="empty">{tab === "followers" ? "読み込んでいます…" : "まだ取得できていません"}</p>
  {:else if ids.length === 0}
    <p class="empty">{tab === "following" || followersComplete ? "該当するユーザーはいません" : "まだ取得できていません"}</p>
  {:else}
    {#if tab === "followers"}<p class="note">一覧は、相手を入れた最新のフォロー一覧から作ります（500 人まで）。数とは合わないことがあります。</p>{/if}
    <ul class="people">
      {#each ids as id (id)}
        <li><a href={profileHref(id)}><Avatar pubkey={id} size={40} /><span><strong>{displayName(id)}</strong><small>{nip19.npubEncode(id).slice(0, 20)}…</small></span></a></li>
      {/each}
    </ul>
  {/if}
{/if}
{#if tab === "posts"}
  {#each pinned as note (note.id)}
    <div class="pinned-label"><Icon name="pushPin" size={12} />ピン留め</div>
    <NoteCard {note} />
  {/each}
  {#if feed}<Timeline {feed} label={activityLabel} />{/if}
{/if}
{#if tab === "articles" && self && viewer.canSign}<a class="write" href={writeHref()}>＋ 記事を書く</a>{/if}
{#if tab === "articles" && articles}<Timeline feed={articles} empty="記事はありません" />{/if}
{#if tab === "reactions"}
  {#if reactions === null}<p class="empty">読み込んでいます…</p>
  {:else if reactions.length === 0}<p class="empty">表示できるリアクションはありません</p>
  {:else}
    {#each reactions as item (item.reaction.id)}<NoteCard note={item.target} reaction={item.reaction} />{/each}
  {/if}
{/if}
{#if tab === "relays"}
  <div class="relays">
    <p class="note">この人が NIP-65 で公開している、投稿の読み取り先・書き込み先です。</p>
    {#if relayRows === undefined}<p class="empty">読み込んでいます…</p>
    {:else if relayRows === null || relayRows.length === 0}<p class="empty">公開されているリレー情報は見つかりませんでした</p>
    {:else}
      {#each relayRows as row (row.url)}
        <div class="relay"><code>{row.url}</code><small>{[row.read && "読み取り", row.write && "書き込み"].filter(Boolean).join("・")}</small><a class="link" href={relayHref(row.url)}>情報</a></div>
      {/each}
    {/if}
  </div>
{/if}

<style>
  .banner {
    display: block;
    width: 100%;
    height: 140px;
    object-fit: cover;
    background: var(--primary-container);
  }
  .head {
    padding: 0 16px 16px;
    border-bottom: 1px solid var(--outline-variant);
  }
  .icon {
    display: inline-block;
    margin-top: -40px;
    border: 3px solid var(--background);
    border-radius: 50%;
    line-height: 0;
  }
  .buttons {
    float: right;
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }
  .buttons button {
    font: inherit;
    font-size: 0.9em;
    font-weight: 600;
    padding: 6px 16px;
    border-radius: 999px;
    cursor: pointer;
  }
  .buttons .filled {
    color: var(--on-primary);
    background: var(--primary);
    border: none;
  }
  .buttons .outline {
    color: var(--primary);
    background: none;
    border: 1px solid var(--outline);
  }
  .buttons button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .badge {
    display: inline-block;
    margin-top: 4px;
    padding: 1px 8px;
    font-size: 0.75rem;
    color: var(--secondary);
    background: var(--secondary-container);
    border-radius: 999px;
  }
  h1 {
    margin: 8px 0 0;
    font-size: 1.3rem;
  }
  .muted {
    color: var(--muted);
    font-size: 0.9em;
  }
  .npub {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin: 6px 0;
    font: inherit;
    font-size: 0.85em;
    color: var(--secondary);
    background: var(--secondary-container);
    border: none;
    border-radius: 999px;
    padding: 4px 12px;
    cursor: pointer;
  }
  .about {
    margin: 8px 0;
  }
  a {
    color: var(--primary);
    overflow-wrap: anywhere;
  }
  .bot {
    margin-left: 8px;
    padding: 1px 6px;
    font-size: 0.6em;
    vertical-align: middle;
    color: var(--muted);
    border: 1px solid var(--outline);
    border-radius: 6px;
  }
  .petname {
    font-size: 0.85em;
    color: var(--primary);
  }
  .petname-edit {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 4px 0;
  }
  .petname-edit input {
    flex: 1;
    min-width: 0;
    font: inherit;
    padding: 4px 8px;
    color: var(--text);
    background: var(--background);
    border: 1px solid var(--outline);
    border-radius: 8px;
  }
  .nip05 {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .verified {
    color: var(--primary);
    font-weight: 700;
  }
  .mismatch {
    color: #d33;
    font-weight: 700;
  }
  .link {
    padding: 2px 6px;
    font: inherit;
    font-size: 0.85em;
    color: var(--primary);
    background: none;
    border: none;
    cursor: pointer;
  }
  .write {
    display: inline-block;
    padding: 10px 16px;
    color: var(--primary);
    text-decoration: none;
  }
  .status-edit {
    padding-left: 0;
  }
  .small {
    font-size: 0.8em;
    color: var(--muted);
  }
  .small.ok {
    color: var(--primary);
  }
  .status {
    display: flex;
    gap: 8px;
    margin: 4px 0;
  }
  .dot {
    color: var(--primary);
  }
  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 6px 0;
  }
  .badge-item img {
    width: 32px;
    height: 32px;
    object-fit: cover;
    border-radius: 6px;
  }
  .badge-name {
    font-size: 0.75em;
    padding: 2px 6px;
    border: 1px solid var(--outline-variant);
    border-radius: 6px;
  }
  .counts {
    display: flex;
    gap: 16px;
    margin-top: 6px;
  }
  .counts button {
    padding: 0;
    font: inherit;
    font-size: 0.9em;
    color: var(--muted);
    background: none;
    border: none;
    cursor: pointer;
  }
  .counts strong {
    color: var(--text);
  }
  .list-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    border-bottom: 1px solid var(--outline-variant);
  }
  .empty,
  .note {
    margin: 0;
    padding: 16px;
    color: var(--muted);
    font-size: 0.9em;
  }
  .note {
    padding: 8px 16px;
    font-size: 0.8em;
  }
  .people {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .people a {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    color: var(--text);
    text-decoration: none;
    border-bottom: 1px solid var(--outline-variant);
  }
  .people span {
    display: grid;
    min-width: 0;
  }
  .people small {
    color: var(--muted);
    font-size: 0.75em;
  }
  .pinned-label {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 6px 16px 0 68px;
    font-size: 0.75em;
    color: var(--primary);
  }
  .relays .relay {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    margin: 4px 12px;
    padding: 8px 12px;
    background: var(--surface-low);
    border-radius: 10px;
  }
  .relay code {
    overflow-wrap: anywhere;
  }
  .relay small {
    color: var(--primary);
  }
  .tabs {
    display: flex;
    border-bottom: 1px solid var(--outline-variant);
  }
  .tabs button {
    flex: 1;
    font: inherit;
    font-weight: 600;
    padding: 12px;
    color: var(--muted);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
  }
  .tabs button.active {
    color: var(--primary);
    border-bottom-color: var(--primary);
  }
</style>
