/**
 * ほかのアプリからの共有の受け取り（PWA の share_target。Android 版の ComposerController.receiveShared）。共有された
 * 文（text）とリンク（url）を投稿欄の本文の後ろに足す。リンクが文に入っていれば重ねない。題名（title）は文もリンクも
 * ないときだけ使う。画像の共有はまだ受け取らない（POST と Service Worker が要るため）。
 */
export function sharedText(params: URLSearchParams): string | null {
  const text = (params.get("text") ?? "").trim();
  const url = (params.get("url") ?? "").trim();
  const title = (params.get("title") ?? "").trim();
  const parts = [text, url && !text.includes(url) ? url : ""].filter(Boolean);
  const joined = (parts.length > 0 ? parts : [title]).join("\n").trim();
  return joined ? joined.slice(0, 20_000) : null;
}

/** いまの本文の後ろに足す（空なら、そのまま）。 */
export const appendShared = (body: string, shared: string) => (body.trim() ? `${body.trimEnd()}\n${shared}` : shared);
