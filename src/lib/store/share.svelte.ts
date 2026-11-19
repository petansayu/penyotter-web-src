import { sharedText } from "../domain/share";

/** ほかのアプリから共有されて、まだ投稿欄に入れていない文（App.svelte が、見る人が決まったら入れる）。 */
export const pendingShare = $state<{ text: string | null }>({ text: null });

/**
 * 開いたときのアドレスの ?title=&text=&url=（manifest の share_target）を読み、アドレスからは消す（読み直したときに
 * もう一度入らないように）。main.ts で画面を作る前に呼ぶ。
 */
export function takeSharedFromUrl() {
  if (!location.search) return;
  const params = new URLSearchParams(location.search);
  if (!params.has("text") && !params.has("url") && !params.has("title")) return;
  pendingShare.text = sharedText(params);
  history.replaceState(history.state, "", `${location.pathname}${location.hash}`);
}
