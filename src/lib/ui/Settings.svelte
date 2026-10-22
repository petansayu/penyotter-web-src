<script lang="ts">
  import { nip19 } from "nostr-tools";
  import { UPLOAD_SERVERS } from "../domain/media";
  import { MAX_EACH, relayChanges, relayEntries, relayProblem, type RelayEntry } from "../domain/relayList";
  import { DEFAULT_RELAYS } from "../nostr/outbox";
  import { normalizeRelay } from "../nostr/relayUrl";
  import { publishRelayList, relayDraft, RelayListChanged } from "../store/relayList.svelte";
  import { dms } from "../store/dm.svelte";
  import { summary } from "../store/publishSummary";
  import { remoteState } from "../nostr/remoteSigner";
  import { SETTINGS_TITLES, type SettingsPage } from "../router.svelte";
  import { deleteViewerData } from "../store/db";
  import { emojis } from "../store/emojis.svelte";
  import { GLOBAL_RELAY_SUGGESTIONS, globalRelays, saveGlobalRelays } from "../store/global";
  import { home } from "../store/home.svelte";
  import { DEFAULT_SEARCH_RELAYS, saveSearchRelays, searchRelays } from "../store/search.svelte";
  import { settings, TEXT_SCALES, type OneTap } from "../store/settings.svelte";
  import { TEST_BLOSSOM, saveUploadServer, uploadServer } from "../store/upload";
  import { viewer } from "../store/viewer.svelte";
  import BunkerLogin from "./BunkerLogin.svelte";
  import UnicodeEmojiPicker from "./UnicodeEmojiPicker.svelte";
  import { loadOwnBlossomServers, publishBlossomServers } from "../store/blossomServers.svelte";
  import Avatar from "./Avatar.svelte";
  import { displayName, requestProfiles } from "../store/cache.svelte";
  import Icon, { type IconName } from "./Icon.svelte";
  import { GROUP_LABELS, schemeFor, THEMES } from "./themes";

  /**
   * 設定（Android 版の SettingsPanel と、そこから入る小画面）。トップの並びは Android 版と同じ（Android 版では
   * 「設定のトップは変えないでほしい」と言われている）。Web 版だけのもの（アカウント・カラム・検索リレーなど）は、
   * 近い小画面に入れる。秘密鍵の 2 つの行は、秘密鍵をブラウザに置かないので出さない。
   */
  let { page = null }: { page?: SettingsPage | null } = $props();

  const NEWLINE = String.fromCharCode(10);

  const ROWS: { icon: IconName; title: string; detail: string; href: string }[] = [
    { icon: "manageAccounts", title: "アカウント", detail: "見る人、署名のしかた、別の人に切り替える", href: "#/settings/account" },
    { icon: "hub", title: "リレー", detail: "読み込み・書き込み・グローバル・検索、認証", href: "#/settings/relays" },
    { icon: "cloudUpload", title: "画像投稿先", detail: "画像・動画を保存するBlossomサーバー", href: "#/settings/uploads" },
    { icon: "favoriteBorder", title: "リアクション", detail: "♡ボタンで送る1タップリアクション", href: "#/settings/reactions" },
    { icon: "palette", title: "見た目", detail: "テーマ、文字サイズ、画像、投稿密度、カラム", href: "#/settings/appearance" },
  ];
  const ROWS_AFTER: { icon: IconName; title: string; detail: string; href: string }[] = [
    { icon: "block", title: "ミュート", detail: "ユーザー、投稿", href: "#/mutes" },
    { icon: "history", title: "一覧の履歴", detail: "フォロー・ミュートの変更前の確認と復元", href: "#/history" },
    { icon: "storage", title: "ストレージ", detail: "このブラウザに保存した投稿・プロフィール", href: "#/settings/storage" },
    { icon: "info", title: "このアプリについて", detail: `バージョン ${__APP_VERSION__}・ご利用にあたって・プライバシー・ライセンス`, href: "#/settings/about" },
  ];

  // ---- リレー（kind 10002 の編集）
  /** 編集を始めたときの版（公開する前に取り直して比べる）。 */
  let relayBase = $state(viewer.relayListEvent);
  let relayRows = $state<RelayEntry[]>(initialRows());
  let newRelay = $state("");
  let relayMessage = $state<string | null>(null);
  let relayConfirm = $state(false);
  let relayBusy = $state(false);
  const relayOriginal = $derived(relayBase ? relayEntries(relayBase) : rowsFromViewer());
  const relayDiff = $derived(relayChanges(relayOriginal, relayRows));
  const relayIssue = $derived(relayProblem(relayRows));

  function rowsFromViewer(): RelayEntry[] {
    const urls = [...new Set([...viewer.readRelays, ...viewer.writeRelays])];
    return urls.map((url) => ({ url, read: viewer.readRelays.includes(url), write: viewer.writeRelays.includes(url) }));
  }

  function initialRows(): RelayEntry[] {
    // 取り込んでいない変更があるときは、今使っている一覧を出す
    return viewer.relayListEvent && !viewer.relayListChange ? relayEntries(viewer.relayListEvent) : rowsFromViewer();
  }

  // 一覧の履歴から「リレー設定に読み込む」を選んだら、その版を読み込む（公開は利用者が確かめてから）
  $effect(() => {
    const pending = relayDraft.pending;
    if (!pending || page !== "relays") return;
    relayDraft.pending = null;
    relayRows = relayEntries(pending);
    relayMessage = "一覧の履歴の版を読み込みました。確かめてから「リレーリストを公開」を押してください。";
  });

  function addRelay() {
    const url = normalizeRelay(newRelay);
    if (!url) {
      relayMessage = "wss:// で始まるリレーの URL を入れてください";
      return;
    }
    if (relayRows.some((row) => row.url === url)) {
      relayMessage = "もう入っています";
      return;
    }
    relayRows = [...relayRows, { url, read: true, write: true }];
    newRelay = "";
    relayMessage = null;
  }

  function reloadRelays(event = viewer.relayListEvent) {
    relayBase = event;
    relayRows = event ? relayEntries(event) : rowsFromViewer();
    relayConfirm = false;
  }

  async function publishRelays() {
    if (viewer.relayListChange) {
      relayMessage = "先に、見つかったリレーリストの変更を取り込むかどうか選んでください。";
      relayConfirm = false;
      return;
    }
    relayBusy = true;
    relayMessage = "公開しています…";
    try {
      const result = await publishRelayList(relayRows, relayBase);
      relayMessage = summary(result);
      if (result.accepted > 0) reloadRelays(viewer.relayListEvent);
    } catch (e) {
      if (e instanceof RelayListChanged) {
        reloadRelays(e.latest);
        relayMessage = `${e.message}（ほかのアプリの版を読み込みました）`;
      } else relayMessage = e instanceof Error ? e.message : String(e);
    } finally {
      relayBusy = false;
      relayConfirm = false;
    }
  }

  // ---- DM 受信リレー（kind 10050）
  let inboxText = $state("");
  let inboxMessage = $state<string | null>(null);
  let inboxLoaded = $state(false);
  let inboxBusy = $state(false);
  $effect(() => {
    if (page !== "relays" || inboxLoaded || !viewer.canSign || !viewer.ready) return;
    inboxLoaded = true;
    void dms.loadInbox(true).then(({ relays, complete }) => {
      inboxText = relays.join(NEWLINE);
      if (!complete) inboxMessage = "今の DM 受信リレーを読み切れませんでした（このままでは公開できません）。";
    });
  });

  async function publishInbox() {
    inboxBusy = true;
    inboxMessage = "公開しています…";
    try {
      inboxMessage = summary(await dms.publishInbox(inboxText.split(NEWLINE).map((line) => line.trim()).filter(Boolean)));
    } catch (e) {
      inboxMessage = e instanceof Error ? e.message : String(e);
    } finally {
      inboxBusy = false;
    }
  }

  // ---- リレー（このブラウザだけの設定）
  let searchText = $state(searchRelays(viewer.pubkey).join(NEWLINE));
  let searchMessage = $state<string | null>(null);
  let globalText = $state(globalRelays(viewer.pubkey).join(NEWLINE));
  let globalMessage = $state<string | null>(null);

  function saveSearch() {
    if (!viewer.pubkey) return;
    const result = saveSearchRelays(viewer.pubkey, searchText);
    if (result.ok) {
      searchText = result.relays.join(NEWLINE);
      searchMessage = result.relays.length > 0 ? "保存しました" : "空にしました（キーワードの検索は使えません）";
    } else searchMessage = `wss:// で始まるリレーを 1 行に 1 件入れてください（${result.line}）`;
  }

  async function saveGlobal() {
    if (!viewer.pubkey) return;
    const result = await saveGlobalRelays(viewer.pubkey, globalText);
    if (result.ok) {
      globalText = result.relays.join(NEWLINE);
      globalMessage = result.relays.length > 0 ? "保存しました" : "空にしました（読み込みリレーから読みます）";
      home.resetGlobal();
    } else globalMessage = `wss:// で始まるリレーを 1 行に 1 件入れてください（${result.line}）`;
  }

  // ---- 画像投稿先
  let uploadChoice = $state(uploadServer(viewer.pubkey));
  let protocolMessage = $state<string | null>(null);
  // アカウントの一覧の名前とアイコン
  $effect(() => {
    if (page === "account") requestProfiles(viewer.accounts.map((a) => a.pubkey));
  });
  let blossomList = $state<string | null>(null);
  let blossomBusy = $state(false);
  let blossomMessage = $state<string | null>(null);
  async function loadBlossomList() {
    blossomMessage = "読み込んでいます…";
    try {
      const servers = await loadOwnBlossomServers();
      blossomList = (servers.length > 0 ? servers : [uploadChoice]).join(NEWLINE);
      blossomMessage = servers.length > 0 ? null : "まだ公開していません。今の投稿先を入れました。";
    } catch (e) {
      blossomMessage = e instanceof Error ? e.message : String(e);
    }
  }
  async function sendBlossomList() {
    blossomBusy = true;
    try {
      const result = await publishBlossomServers((blossomList ?? "").split(NEWLINE));
      blossomMessage = result.accepted > 0 ? `Blossomサーバー一覧を公開しました（${summary(result)}）` : summary(result);
    } catch (e) {
      blossomMessage = e instanceof Error ? e.message : String(e);
    } finally {
      blossomBusy = false;
    }
  }
  let customServer = $state("");
  let serverMessage = $state<string | null>(null);

  function chooseServer(raw: string) {
    if (!viewer.pubkey) return;
    if (!saveUploadServer(viewer.pubkey, raw)) {
      serverMessage = "https:// で始まるサーバーの URL（パスなし）を入れてください";
      return;
    }
    uploadChoice = uploadServer(viewer.pubkey);
    customServer = "";
    serverMessage = `${new URL(uploadChoice).host} を使います`;
  }

  // ---- アカウント
  /** リモート署名の接続の状態を読み直すための数（保存先は localStorage・sessionStorage で、$state ではないため）。 */
  let remoteVersion = $state(0);

  // ---- リアクション
  let reactionTab = $state<"standard" | "custom">("standard");
  const chooseOneTap = (value: OneTap) => (settings.oneTap = value);
  $effect(() => {
    if (page === "reactions") void emojis.load();
  });

  // ---- ストレージ
  let cleared = $state(false);
  let usage = $state<string | null>(null);
  $effect(() => {
    if (page !== "storage" || !navigator.storage?.estimate) return;
    void navigator.storage.estimate().then((estimate) => {
      usage = estimate.usage !== undefined ? `${(estimate.usage / 1024 / 1024).toFixed(1)} MB` : null;
    });
  });

  /** 見る人の保存分（投稿・プロフィール）と、相手のリレーリスト・削除の依頼の覚えを消す。既読と見た目、一覧の履歴は残す。 */
  async function clearSaved() {
    if (!viewer.pubkey || !confirm("このブラウザに保存した投稿・プロフィール・リレーの情報を消します。次に開いたときにリレーから読み直します。")) return;
    await deleteViewerData(viewer.pubkey);
    try {
      localStorage.removeItem("relay-lists");
      localStorage.removeItem("deleted-notes");
    } catch {
      // 何もしない
    }
    cleared = true;
  }

  const groups = $derived(Object.keys(GROUP_LABELS).map((group) => ({ group, themes: THEMES.filter((theme) => theme.group === group) })));
  const currentTheme = $derived(settings.currentTheme);

  const LIBRARIES = [
    { name: "Svelte", holder: "Svelte contributors", license: "MIT License" },
    { name: "nostr-tools", holder: "fiatjaf ほか", license: "Unlicense" },
    { name: "noble-curves・noble-hashes・noble-ciphers・scure-base", holder: "Paul Miller", license: "MIT License" },
    { name: "markdown-it", holder: "Vitaly Puzrin, Alex Kocharin", license: "MIT License" },
    { name: "linkify-it・mdurl・uc.micro（markdown-it に同梱）", holder: "Vitaly Puzrin, Alex Kocharin", license: "MIT License" },
    { name: "entities（markdown-it に同梱）", holder: "Felix Boehm", license: "BSD 2-Clause License" },
    { name: "punycode.js（markdown-it に同梱）", holder: "Mathias Bynens", license: "MIT License" },
    { name: "uqr", holder: "Anthony Fu", license: "MIT License" },
    { name: "emojibase-data（絵文字ピッカーの絵文字と名前）", holder: "Miles Johnson", license: "MIT License" },
    { name: "Material Design Icons", holder: "Google LLC", license: "Apache License 2.0" },
  ];
</script>

{#snippet switchRow(label: string, checked: boolean, change: (value: boolean) => void, detail?: string)}
  <label class="switch-row">
    <span><span class="label">{label}</span>{#if detail}<span class="detail">{detail}</span>{/if}</span>
    <input type="checkbox" role="switch" {checked} onchange={(event) => change(event.currentTarget.checked)} />
  </label>
{/snippet}

{#snippet segmented(label: string, options: [string, string][], value: string, change: (value: string) => void)}
  <div class="field-label">{label}</div>
  <div class="segmented" role="radiogroup" aria-label={label}>
    {#each options as [key, text] (key)}
      <button type="button" role="radio" aria-checked={value === key} class:active={value === key} onclick={() => change(key)}>{text}</button>
    {/each}
  </div>
{/snippet}

{#if page === null}
  <p class="heading">選択中のアカウントに適用する設定</p>
  <ul class="rows">
    {#each ROWS as row (row.href)}
      <li><a href={row.href}><Icon name={row.icon} /><span class="text"><span class="label">{row.title}</span><span class="detail">{row.detail}</span></span><Icon name="chevronRight" /></a></li>
    {/each}
    <li>
      <label class="row-switch">
        <span class="spacer-icon"></span>
        <span class="text"><span class="label">投稿にクライアント情報を付ける</span><span class="detail">NIP-89のタグで「ぺにょったーから投稿」と示します。公開したくない場合はオフにできます。</span></span>
        <input type="checkbox" role="switch" bind:checked={settings.clientTag} />
      </label>
    </li>
    {#each ROWS_AFTER as row (row.href)}
      <li><a href={row.href}><Icon name={row.icon} /><span class="text"><span class="label">{row.title}</span><span class="detail">{row.detail}</span></span><Icon name="chevronRight" /></a></li>
    {/each}
    {#if viewer.canSign}
      <li><a class="danger-row" href="#/settings/vanish"><Icon name="delete" /><span class="text"><span class="label">消去の依頼（NIP-62）</span><span class="detail">このアカウントの投稿をすべて消すよう、リレーに頼む。取り消せません</span></span><Icon name="chevronRight" /></a></li>
    {/if}
  </ul>
{:else}
  <div class="page">
    <h2>{SETTINGS_TITLES[page]}</h2>

    {#if page === "account"}
      {#if viewer.pubkey}<p class="muted npub">{nip19.npubEncode(viewer.pubkey)}</p>{/if}
      <p class="muted">署名: {viewer.mode === "nip07" ? "ブラウザ拡張（NIP-07）" : viewer.mode === "nip46" ? "リモート署名（NIP-46）" : "なし（見るだけ）"}</p>
      {#if viewer.mode === "nip46" && viewer.pubkey}
        {@const state = (void remoteVersion, remoteState(viewer.pubkey))}
        <h3>リモート署名</h3>
        <p class="muted">
          {state === "remembered" ? "接続用の鍵をこのブラウザに記憶しています。" : state === "tab" ? "このタブを閉じると接続が切れます（記憶していません）。" : "接続が切れています。投稿するには bunker:// を貼り直してください。"}
        </p>
        {#if state}
          <button type="button" class="outline" onclick={() => { viewer.forgetBunker(); remoteVersion++; }}>{state === "remembered" ? "記憶を消す" : "接続を切る"}</button>
        {:else}
          <BunkerLogin done={() => remoteVersion++} />
          <div class="spaced">
            {#await import("./NostrConnectLogin.svelte") then { default: NostrConnectLogin }}<NostrConnectLogin done={() => remoteVersion++} />{/await}
          </div>
        {/if}
      {/if}
      <h3>アカウント</h3>
      <ul class="accounts">
        {#each viewer.accounts as account (account.pubkey)}
          <li class:current={account.pubkey === viewer.pubkey}>
            <Avatar pubkey={account.pubkey} size={32} />
            <span class="who"><strong>{displayName(account.pubkey)}</strong><small>{account.mode === "nip07" ? "ブラウザ拡張" : account.mode === "nip46" ? "リモート署名" : "見るだけ"}</small></span>
            {#if account.pubkey === viewer.pubkey}<small class="using">使用中</small>
            {:else}<button type="button" class="outline" onclick={() => viewer.switchTo(account.pubkey)}>切り替える</button>{/if}
          </li>
        {/each}
      </ul>
      <button type="button" class="outline" onclick={() => { viewer.adding = true; location.hash = "#/"; }}>アカウントを追加</button>
      <p class="muted">ブラウザ拡張（NIP-07）のアカウントを切り替えるときは、拡張の側でも同じ鍵を選んでください。</p>
      <h3>このアカウントを外す</h3>
      <p class="muted">このアカウントの保存分（投稿・プロフィール・既読・リレーの設定）をこのブラウザから消します。ほかのアカウントがあれば、そちらに切り替えます。一覧の履歴は残ります。</p>
      <button type="button" class="outline" onclick={() => { viewer.clear(); location.hash = "#/"; }}>このアカウントを外す</button>

    {:else if page === "relays"}
      {#if viewer.relayListChange}
        {@const change = relayEntries(viewer.relayListChange)}
        <div class="change">
          <strong>プロフィールのリレーリストに変更があります</strong>
          <p class="muted">ほかのアプリで更新されたようです（{new Date(viewer.relayListChange.created_at * 1000).toLocaleString("ja-JP")}）。取り込むと、この一覧を使います。</p>
          <ul>{#each change as row (row.url)}<li>{row.url.replace(/^wss:\/\//, "")}（{[row.read && "読み込み", row.write && "書き込み"].filter(Boolean).join("・")}）</li>{/each}</ul>
          <div class="actions">
            <button type="button" class="outline" onclick={() => { const event = viewer.relayListChange; viewer.acceptRelayListChange(); reloadRelays(event); relayMessage = "取り込みました"; }}>取り込む</button>
            <button type="button" class="outline" onclick={() => { viewer.declineRelayListChange(); relayMessage = "取り込みませんでした。今の一覧を公開すると、その変更は上書きされます。"; }}>取り込まない</button>
          </div>
        </div>
      {/if}
      <h3>読み込みリレー・書き込みリレー</h3>
      <p class="muted">リレーリスト（NIP-65、kind 10002）です。読み込み・書き込みはそれぞれ 1〜{MAX_EACH} 件。公開すると、ほかのアプリもこの一覧を使います。</p>
      <ul class="relay-rows">
        {#each relayRows as row, i (row.url)}
          <li>
            <span class="relay-url">{row.url.replace(/^wss:\/\//, "")}</span>
            <button type="button" class="chip" class:active={row.read} aria-pressed={row.read} disabled={!viewer.canSign} onclick={() => (relayRows[i].read = !row.read)}>読み込み</button>
            <button type="button" class="chip" class:active={row.write} aria-pressed={row.write} disabled={!viewer.canSign} onclick={() => (relayRows[i].write = !row.write)}>書き込み</button>
            {#if viewer.canSign}<button type="button" class="remove" aria-label="{row.url} を外す" title="外す" onclick={() => (relayRows = relayRows.filter((r) => r.url !== row.url))}><Icon name="close" size={18} /></button>{/if}
          </li>
        {/each}
      </ul>
      {#if viewer.canSign}
        <div class="actions">
          <input bind:value={newRelay} placeholder="wss://…" aria-label="足すリレー" onkeydown={(event) => event.key === "Enter" && addRelay()} />
          <button type="button" class="outline" onclick={addRelay}>追加</button>
          <button type="button" class="text" onclick={() => (relayRows = DEFAULT_RELAYS.map((url) => ({ url, read: true, write: true })))}>おすすめを入れる</button>
          {#if relayDiff.length > 0}<button type="button" class="text" onclick={() => reloadRelays()}>元に戻す</button>{/if}
        </div>
        {#if relayIssue && relayDiff.length > 0}<p class="error">{relayIssue}</p>{/if}
        {#if relayConfirm}
          <div class="confirm-box">
            <p><strong>公開する前に確かめてください</strong></p>
            <ul>{#each relayDiff as change (change.url)}<li>{change.url.replace(/^wss:\/\//, "")}: {change.before} → {change.after}</li>{/each}</ul>
            <div class="actions">
              <button type="button" class="text" onclick={() => (relayConfirm = false)}>やめる</button>
              <button type="button" class="filled" disabled={relayBusy} onclick={publishRelays}>公開する</button>
            </div>
          </div>
        {:else}
          <div class="actions">
            <button type="button" class="filled" disabled={relayBusy || relayDiff.length === 0 || !!relayIssue} onclick={() => (relayConfirm = true)}>リレーリストを公開</button>
          </div>
        {/if}
        {#if relayMessage}<p class="muted" role="status">{relayMessage}</p>{/if}
      {:else}
        <p class="muted">見るだけのアカウントでは公開できません。</p>
      {/if}
      {#if viewer.canSign}
        <h3>DM 受信リレー</h3>
        <p class="muted">NIP-17 の DM を受け取るリレー（kind 10050）です。1 行に 1 件、3 件まで。公開すると、相手はここへ DM を送ります。</p>
        <textarea bind:value={inboxText} rows="3" spellcheck="false" aria-label="DM 受信リレー"></textarea>
        <div class="actions">
          <button type="button" class="outline" disabled={inboxBusy} onclick={publishInbox}>DM 受信リレーを公開</button>
          {#if inboxMessage}<span class="muted">{inboxMessage}</span>{/if}
        </div>
      {/if}
      <h3>グローバルで読むリレー</h3>
      <p class="muted">ホームの「グローバル」で読むリレーです。1 行に 1 件、12 件まで。空なら読み込みリレーから読みます。このブラウザだけに保存し、リレーリスト（kind 10002）には載せません。変えると、グローバルの保存分は消します。</p>
      <textarea bind:value={globalText} rows="3" spellcheck="false" aria-label="グローバルで読むリレー"></textarea>
      <div class="actions">
        <button type="button" class="outline" onclick={saveGlobal}>保存</button>
        <button type="button" class="text" onclick={() => (globalText = GLOBAL_RELAY_SUGGESTIONS.join(NEWLINE))}>日本のリレーの例を入れる</button>
        {#if globalMessage}<span class="muted">{globalMessage}</span>{/if}
      </div>
      <h3>検索リレー</h3>
      <p class="muted">キーワードの検索（NIP-50）に使うリレーです。1 行に 1 件、12 件まで。この見る人の分を、このブラウザに保存します。</p>
      <textarea bind:value={searchText} rows="3" spellcheck="false" aria-label="検索リレー"></textarea>
      <div class="actions">
        <button type="button" class="outline" onclick={saveSearch}>保存</button>
        <button type="button" class="text" onclick={() => (searchText = DEFAULT_SEARCH_RELAYS.join(NEWLINE))}>最初の値に戻す</button>
        {#if searchMessage}<span class="muted">{searchMessage}</span>{/if}
      </div>
      {#if viewer.canSign}
        <h3>認証</h3>
        {@render switchRow("認証を求めるリレーに答える（NIP-42）", settings.relayAuth, (value) => (settings.relayAuth = value), "オンにすると、読み書きに認証が要るリレーに、署名して答えます。ブラウザ拡張によっては、リレーにつなぐたびに確認の画面が出ます。オフのときは答えないので、そのリレーからは読めない・送れないことがあります。")}
      {/if}

    {:else if page === "uploads"}
      <p class="muted">画像や動画をアップロードするサーバーを選択します。設定は見る人ごとにこのブラウザに保存され、投稿欄とプロフィール編集で共用します。画像はこのブラウザで描き直して、撮影した場所などの情報を落としてから送ります。{#if TEST_BLOSSOM}テストモードでは手元のテスト用の投稿先（{TEST_BLOSSOM}）だけを使います。{/if}</p>
      <h3>投稿先</h3>
      <ul class="choices">
        {#each UPLOAD_SERVERS as option (option.url)}
          <li><label><input type="radio" name="upload-server" checked={uploadChoice === option.url} onchange={() => chooseServer(option.url)} />{option.label}</label></li>
        {/each}
      </ul>
      <h3>ほかの Blossom サーバー</h3>
      <div class="actions">
        <input bind:value={customServer} placeholder="https://…" aria-label="ほかの投稿先" />
        <button type="button" class="outline" onclick={() => chooseServer(customServer)}>使う</button>
      </div>
      {#if serverMessage}<p class="muted">{serverMessage}</p>{/if}
      {#if viewer.canSign}
        <h3>Blossomサーバー一覧（kind 10063）</h3>
        <p class="muted">公開すると、ほかのアプリが、あなたの画像を読めないときにこれらのサーバーから探します。1 行に 1 つ、https のサーバーを 12 件まで。</p>
        {#if blossomList === null}
          <button type="button" class="outline" onclick={loadBlossomList}>今の一覧を読む</button>
        {:else}
          <textarea class="servers" rows="4" bind:value={blossomList} aria-label="Blossomサーバー一覧"></textarea>
          <div class="actions"><button type="button" class="outline" disabled={blossomBusy} onclick={sendBlossomList}>一覧を公開</button></div>
        {/if}
        {#if blossomMessage}<p class="muted">{blossomMessage}</p>{/if}
      {/if}

    {:else if page === "reactions"}
      <h3>1タップリアクション</h3>
      <p class="muted">投稿カードの♡ボタンを押したときに送るリアクションを選びます。送信後は、その投稿に選んだ絵文字が表示されます。</p>
      <p class="current">現在: {#if settings.oneTap.emoji}<img src={settings.oneTap.emoji.url} alt={settings.oneTap.content} referrerpolicy="no-referrer" />{settings.oneTap.content}{:else if settings.oneTap.content === "+"}♡ いいね（標準）{:else}{settings.oneTap.content}{/if}</p>
      <button type="button" class="outline" class:selected={settings.oneTap.content === "+"} onclick={() => chooseOneTap({ content: "+" })}>♡ いいね（標準）</button>
      <div class="segmented tabs">
        <button type="button" class:active={reactionTab === "standard"} onclick={() => (reactionTab = "standard")}>標準絵文字</button>
        <button type="button" class:active={reactionTab === "custom"} onclick={() => (reactionTab = "custom")}>カスタム絵文字</button>
      </div>
      {#if reactionTab === "standard"}
        <UnicodeEmojiPicker selected={settings.oneTap.content} pick={(emoji) => chooseOneTap({ content: emoji })} />
      {:else if emojis.loading}
        <p class="muted">読み込んでいます…</p>
      {:else if emojis.custom.length === 0}
        <p class="muted">カスタム絵文字がありません</p>
      {:else}
        <div class="emoji-grid">
          {#each emojis.custom.slice(0, 500) as item (item.shortcode + item.url)}
            <button type="button" class:selected={settings.oneTap.content === `:${item.shortcode}:`} title=":{item.shortcode}:" aria-label=":{item.shortcode}:" onclick={() => chooseOneTap({ content: `:${item.shortcode}:`, emoji: item })}>
              <img src={item.url} alt=":{item.shortcode}:" loading="lazy" referrerpolicy="no-referrer" />
            </button>
          {/each}
        </div>
      {/if}

    {:else if page === "appearance"}
      <h3>テーマ</h3>
      {@render segmented("明るさ", [["system", "端末に合わせる"], ["light", "ライト"], ["dark", "ダーク"]], settings.mode, (value) => (settings.mode = value as typeof settings.mode))}
      <a class="theme-row" href="#/settings/theme">
        <span class="swatch" style:background={schemeFor(currentTheme, settings.dark).primary}></span>
        <span class="text"><span class="label">カラーテーマ</span><span class="detail">{currentTheme.label}</span></span>
        <Icon name="chevronRight" />
      </a>
      <h3>文字と時刻</h3>
      {@render segmented("投稿時刻", [["relative", "相対時間"], ["absolute", "絶対時間"]], settings.timeDisplay, (value) => (settings.timeDisplay = value as typeof settings.timeDisplay))}
      {@render segmented("文字サイズ", TEXT_SCALES.map((scale, i) => [String(scale), ["小", "標準", "大", "特大"][i]] as [string, string]), String(settings.textScale), (value) => (settings.textScale = Number(value) as typeof settings.textScale))}
      <h3>タイムラインの表示</h3>
      {@render switchRow("投稿間隔をコンパクトにする", settings.compactPosts, (value) => (settings.compactPosts = value))}
      {@render switchRow("アバターを表示", settings.showAvatars, (value) => (settings.showAvatars = value))}
      {@render switchRow("投稿元クライアントを表示", settings.showClientTags, (value) => (settings.showClientTags = value))}
      {@render switchRow("ステータスを投稿に表示", settings.showStatuses, (value) => (settings.showStatuses = value))}
      {@render switchRow("横長の画面ではカラムに並べる", settings.columns, (value) => (settings.columns = value), "幅が 1,100 ピクセル以上の画面では、ホーム・通知などを横に並べて表示します（Web 版だけ）。")}
      <h3>画像と通信量</h3>
      {@render switchRow("アイコン画像を読み込む", settings.avatarPictures, (value) => (settings.avatarPictures = value))}
      {@render switchRow("投稿画像を自動表示", settings.showImages, (value) => (settings.showImages = value))}
      {@render switchRow("動画プレーヤーを表示", settings.showVideos, (value) => (settings.showVideos = value))}
      {@render switchRow("埋め込み（YouTube・X など）を自動で読み込む", settings.autoEmbeds, (value) => (settings.autoEmbeds = value), "オフのときは、押したときだけ読み込みます。読み込むと、そのサービスにこのブラウザの IP アドレスなどが伝わります（Web 版だけ）。")}
      <p class="muted">画像の自動表示をオフにすると、本文と操作だけを先に表示して通信量を抑えます。アイコン画像の読み込みをオフにすると、ほかの人のプロフィール画面を除いて、ぺにょったーのオリジナルアバターで表示します。リンクプレビューは、Web 版ではまだありません。</p>
      <h3>センシティブ</h3>
      {@render switchRow("センシティブ投稿を常に表示", settings.revealSensitive, (value) => (settings.revealSensitive = value))}

    {:else if page === "theme"}
      {#each groups as { group, themes } (group)}
        {#if GROUP_LABELS[group as keyof typeof GROUP_LABELS]}<h3>{GROUP_LABELS[group as keyof typeof GROUP_LABELS]}</h3>{/if}
        <div class="themes">
          {#each themes as theme (theme.id)}
            {@const scheme = schemeFor(theme, settings.dark)}
            <button type="button" class="theme" class:active={settings.theme === theme.id} onclick={() => (settings.theme = theme.id)}
              style:background={scheme.background} style:color={scheme.text}>
              <span class="swatch" style:background={scheme.primary} style:border-color={scheme.surface}></span>
              {theme.label}
            </button>
          {/each}
        </div>
      {/each}
      {#await import("./CustomThemePanel.svelte") then { default: CustomThemePanel }}<CustomThemePanel />{/await}

    {:else if page === "storage"}
      <p class="muted">開いたときにすぐ出せるよう、見た投稿・プロフィール・通知をこのブラウザに保存しています（ホームと見た投稿はそれぞれ新しい 2,000 件、通知は 500 件）。リレーから読み直せるものだけです。</p>
      {#if usage}<p>このサイトが使っている保存領域: {usage}</p>{/if}
      <button type="button" class="outline" onclick={clearSaved} disabled={cleared}>{cleared ? "消しました（再読み込みで読み直します）" : "保存分を消す"}</button>
      <p class="muted">一覧の履歴（フォロー・ミュートの昔の版）は、ここでは消しません。</p>

    {:else if page === "vanish"}
      {#await import("./VanishPanel.svelte") then { default: VanishPanel }}<VanishPanel />{/await}
    {:else if page === "about"}
      {#if typeof navigator.registerProtocolHandler === "function"}
        <h3>nostr: のリンク</h3>
        <p class="muted">ほかのサイトの <code>web+nostr:</code> のリンク（npub・nprofile・note・nevent・naddr）を、このアプリで開けるようにします。ブラウザの決まりで、<code>nostr:</code> そのままのリンクは受け取れません。</p>
        <button type="button" class="outline" onclick={() => { try { navigator.registerProtocolHandler("web+nostr", `${location.origin}${location.pathname}#/open?uri=%s`); protocolMessage = "ブラウザに登録を頼みました（ブラウザの確かめの表示が出ることがあります）"; } catch (e) { protocolMessage = e instanceof Error ? e.message : String(e); } }}>このアプリで開くようにする</button>
        {#if protocolMessage}<p class="muted">{protocolMessage}</p>{/if}
      {/if}
      <p class="app-name">ぺにょったー（Web 版）</p>
      <p class="muted">バージョン {__APP_VERSION__}（{__BUILD_DATE__}）</p>
      <p>ぺぇのつくった Nostr クライアント</p>
      <h3>ご利用にあたって</h3>
      <ul class="notes">
        <li>ぺにょったーは、個人が作っている Nostr クライアントです。無料・無保証で提供しています。不具合などで生じた損害について、作者は責任を負えません。</li>
        <li>Nostr への投稿・リアクション・プロフィールなどは公開され、多くのリレーに複製されます。削除を依頼しても、すべてのリレーやアプリから消えるとは限りません。</li>
        <li>秘密鍵（nsec）はアカウントそのものです。なくすと元に戻せず、他人に知られるとアカウントを使われてしまいます。Web 版では秘密鍵を入力しないでください（ブラウザ拡張かリモート署名で使います）。</li>
        <li>リレーや画像投稿先には、それぞれの運営者の規約があります。</li>
      </ul>
      <h3>プライバシー</h3>
      <ul class="notes">
        <li>ぺにょったーは、作者や作者のサーバーに情報を送りません。利用状況の収集や広告もありません。</li>
        <li>このページは Cloudflare Pages から配信しています。ページを開いたときの通信（IP アドレスなど）は Cloudflare に届きます。</li>
        <li>通信するのは、リレー、表示する投稿の作者が使うリレー、画像投稿先、表示する画像やリンク先、NIP-05 の確認先などです。通信先には、IP アドレスなどが伝わります。</li>
        <li>秘密鍵はこのブラウザに置きません。署名はブラウザ拡張（NIP-07）かリモート署名（NIP-46）に頼みます。</li>
        <li>投稿には初めから「ぺにょったーから投稿」というクライアント情報（NIP-89）が付きます。設定で外せます。</li>
        <li>書きかけ・一覧の履歴・保存分は、このブラウザの中にだけ保存されます。</li>
      </ul>
      <h3>オープンソースライセンス</h3>
      <p class="muted">このアプリは、次のオープンソースソフトウェアを使っています。</p>
      <ul class="libraries">
        {#each LIBRARIES as library (library.name)}<li><span class="label">{library.name}</span><span class="detail">{library.holder} · {library.license}</span></li>{/each}
      </ul>
      <a class="outline" href="./licenses.txt" target="_blank" rel="noopener">ライセンス文を読む</a>
    {/if}
  </div>
{/if}

<style>
  .accounts {
    margin: 0 0 8px;
    padding: 0;
    list-style: none;
  }
  .accounts li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px solid var(--outline-variant);
  }
  .accounts .who {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .accounts small {
    color: var(--muted);
    font-size: 0.8em;
  }
  .accounts .using {
    color: var(--primary);
  }
  .change {
    margin: 8px 0;
    padding: 10px 12px;
    background: var(--secondary-container);
    border-radius: 10px;
  }
  .change ul {
    margin: 4px 0;
    padding-left: 20px;
    font-size: 0.9em;
  }
  .servers {
    width: 100%;
    box-sizing: border-box;
    font: inherit;
    padding: 6px 8px;
    color: var(--text);
    background: var(--background);
    border: 1px solid var(--outline);
    border-radius: 8px;
  }
  .danger-row {
    color: #c33 !important;
  }
  .heading {
    margin: 0;
    padding: 16px 16px 8px;
    font-size: 0.9em;
    font-weight: 600;
    color: var(--muted);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .rows li {
    border-bottom: 1px solid var(--outline-variant);
  }
  .rows a,
  .row-switch {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 16px;
    color: var(--text);
    text-decoration: none;
    cursor: pointer;
  }
  .rows a:hover,
  .row-switch:hover {
    background: var(--surface-low);
  }
  .rows :global(svg) {
    flex: none;
    color: var(--muted);
  }
  .spacer-icon {
    flex: none;
    width: 24px;
  }
  .text {
    display: grid;
    flex: 1;
    min-width: 0;
    gap: 2px;
  }
  .label {
    font-weight: 500;
  }
  .detail {
    display: block;
    font-size: 0.85em;
    color: var(--muted);
  }
  .page {
    padding: 8px 16px 32px;
  }
  h2 {
    margin: 8px 0 4px;
    font-size: 1.2rem;
  }
  h3 {
    margin: 20px 0 6px;
    font-size: 0.95rem;
    color: var(--muted);
  }
  .muted {
    color: var(--muted);
    font-size: 0.9em;
    margin: 4px 0 8px;
  }
  .npub {
    font-family: ui-monospace, monospace;
    overflow-wrap: anywhere;
  }
  .switch-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 0;
    cursor: pointer;
  }
  .field-label {
    margin: 10px 0 4px;
    font-size: 0.85em;
    font-weight: 600;
    color: var(--muted);
  }
  .segmented {
    display: flex;
    border: 1px solid var(--outline);
    border-radius: 999px;
    overflow: hidden;
  }
  .segmented button {
    flex: 1;
    font: inherit;
    font-size: 0.9em;
    padding: 7px 4px;
    color: var(--text);
    background: none;
    border: none;
    border-right: 1px solid var(--outline);
    cursor: pointer;
  }
  .segmented button:last-child {
    border-right: none;
  }
  .segmented button.active {
    font-weight: 600;
    background: var(--secondary-container);
  }
  .segmented.tabs {
    margin: 12px 0 8px;
  }
  .theme-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 10px;
    padding: 10px 4px;
    color: var(--text);
    text-decoration: none;
    border-radius: 8px;
  }
  .theme-row:hover {
    background: var(--surface-low);
  }
  .theme-row .swatch {
    width: 24px;
    height: 24px;
    border-radius: 50%;
  }
  .outline {
    display: inline-block;
    font: inherit;
    color: var(--primary);
    background: none;
    border: 1px solid var(--outline);
    border-radius: 999px;
    padding: 6px 16px;
    cursor: pointer;
    text-decoration: none;
  }
  .outline.selected {
    background: var(--secondary-container);
  }
  .text {
    color: inherit;
  }
  button.text {
    font: inherit;
    color: var(--primary);
    background: none;
    border: none;
    padding: 6px 8px;
    cursor: pointer;
  }
  textarea {
    width: 100%;
    font: inherit;
    font-size: 0.9em;
    padding: 8px 10px;
    border: 1px solid var(--outline);
    border-radius: 8px;
    background: var(--surface-low);
    color: var(--text);
    resize: vertical;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
  }
  .actions input {
    flex: 1;
    min-width: 200px;
    font: inherit;
    font-size: 0.9em;
    padding: 6px 10px;
    border: 1px solid var(--outline);
    border-radius: 8px;
    background: var(--surface-low);
    color: var(--text);
  }
  .spaced {
    margin-top: 16px;
  }
  .relay-rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .relay-rows li {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 0;
    border-bottom: 1px solid var(--outline-variant);
  }
  .relay-url {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.9em;
  }
  .chip {
    flex: none;
    font: inherit;
    font-size: 0.75em;
    padding: 3px 10px;
    color: var(--muted);
    background: none;
    border: 1px solid var(--outline-variant);
    border-radius: 999px;
    cursor: pointer;
  }
  .chip.active {
    color: var(--text);
    font-weight: 600;
    background: var(--secondary-container);
    border-color: transparent;
  }
  .remove {
    display: grid;
    place-items: center;
    flex: none;
    width: 28px;
    height: 28px;
    color: var(--muted);
    background: none;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }
  .filled {
    font: inherit;
    font-weight: 600;
    color: var(--on-primary);
    background: var(--primary);
    border: none;
    border-radius: 999px;
    padding: 7px 18px;
    cursor: pointer;
  }
  .filled:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .confirm-box {
    margin-top: 10px;
    padding: 10px 12px;
    border: 1px solid var(--outline-variant);
    border-radius: 12px;
    background: var(--surface-low);
    font-size: 0.9em;
  }
  .confirm-box p {
    margin: 0 0 4px;
  }
  .confirm-box ul {
    margin: 0;
    padding-left: 20px;
  }
  .error {
    margin: 6px 0;
    color: #d33;
    font-size: 0.9em;
  }
  .choices {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .choices label {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    cursor: pointer;
  }
  .current {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .current img {
    width: 22px;
    height: 22px;
    object-fit: contain;
  }
  .emoji-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
    gap: 4px;
  }
  .emoji-grid button {
    display: grid;
    place-items: center;
    height: 40px;
    font-size: 1.3rem;
    background: none;
    border: 1px solid transparent;
    border-radius: 8px;
    cursor: pointer;
  }
  .emoji-grid button:hover {
    background: var(--surface-low);
  }
  .emoji-grid button.selected {
    border-color: var(--primary);
    background: var(--secondary-container);
  }
  .emoji-grid img {
    width: 26px;
    height: 26px;
    object-fit: contain;
  }
  .themes {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 8px;
  }
  .theme {
    display: flex;
    align-items: center;
    gap: 8px;
    font: inherit;
    padding: 10px;
    border: 1px solid var(--outline-variant);
    border-radius: 12px;
    text-align: left;
    cursor: pointer;
  }
  .theme.active {
    outline: 2px solid var(--primary);
    outline-offset: 1px;
  }
  .theme .swatch {
    flex: none;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid;
  }
  .app-name {
    margin: 12px 0 0;
    font-size: 1.4rem;
    font-weight: 700;
  }
  .notes {
    margin: 0;
    padding-left: 20px;
  }
  .notes li {
    margin: 4px 0;
  }
  .libraries {
    list-style: none;
    margin: 0 0 12px;
    padding: 0;
  }
  .libraries li {
    display: grid;
    padding: 8px 0;
    border-bottom: 1px solid var(--outline-variant);
  }
</style>
