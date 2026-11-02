<script lang="ts">
  import { miniAppsDialog } from "../store/miniApps.svelte";

  /** ミニアプリの一覧（Android 版の MiniAppsSheet と同じ中身）。作者の Web アプリを別のタブで開く。アカウントは渡さない。 */
  const APPS = [
    { name: "じぶん分析", description: "自分の投稿から新聞や鑑定書を作って遊びます", url: "https://petansayu.github.io/nosce/" },
    { name: "いそ通信", description: "雲丹川とお話しできます（20回/日）", url: "https://unikawa-iso-shinkai.petan-sayu.chatgpt.site/" },
    { name: "ぽよの庭", description: "謎の生物をつついて育ててください", url: "https://poyo-no-niwa-1022.petan-sayu.chatgpt.site/" },
    { name: "きもち魚鑑定", description: "その時の気持ちを魚にします", url: "https://kimochi-sakana-kantei.vercel.app/" },
    { name: "会話不成立AI", description: "１日３往復の会話にならない会話ができます", url: "https://conversation-mismatch-ai.vercel.app/" },
    { name: "役に立たないミニアプリ集", description: "１０個あります", url: "https://10-tiny-useless-tools.vercel.app/" },
    { name: "応援しないカレンダー", description: "予定を応援しません", url: "https://unsupportive-calendar.vercel.app/add" },
    { name: "今日のプロフィール", description: "今日のあなたのプロフィールです", url: "https://web-1-web-vite-react-typescript.vercel.app/" },
    { name: "架空韓国料理ガチャ", description: "架空の韓国料理を作ります", url: "https://mat-ppopgi-korean-gacha.vercel.app/" },
    { name: "さぼてんさんぽ", description: "さぼてんが歩きます", url: "https://cactus-walk.vercel.app/" },
    { name: "あたらない天気予報", description: "ぜんぶが雰囲気の天気予報です", url: "https://files-mentioned-by-the-user-web-alpha.vercel.app/" },
    { name: "ぺぇのつくったもの", description: "ほかのアプリやグッズの紹介ページです", url: "https://petansayu.github.io/portfolio/" },
  ];

  let dialog = $state<HTMLDialogElement>();

  $effect(() => {
    if (miniAppsDialog.open && dialog) dialog.showModal();
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialog} onclose={() => (miniAppsDialog.open = false)} aria-label="ミニアプリ" data-testid="mini-apps-dialog"
  onclick={(event) => { event.stopPropagation(); if (event.target === dialog) dialog?.close(); }} onkeydown={(event) => event.stopPropagation()}>
  <div class="list">
    {#each APPS as app (app.url)}
      <a href={app.url} target="_blank" rel="noopener noreferrer" onclick={() => dialog?.close()}>
        <span class="name">{app.name}</span>
        <span class="description">{app.description}</span>
      </a>
    {/each}
  </div>
</dialog>

<style>
  dialog {
    width: min(92vw, 380px);
    max-height: 85dvh;
    padding: 8px 0;
    color: var(--text);
    background: var(--container);
    border: 1px solid var(--outline-variant);
    border-radius: 16px;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  .list {
    display: grid;
  }
  a {
    display: grid;
    gap: 2px;
    padding: 10px 20px;
    color: var(--text);
    text-decoration: none;
  }
  a:hover {
    background: var(--surface-low);
  }
  .description {
    font-size: 0.85em;
    color: var(--muted);
  }
</style>
