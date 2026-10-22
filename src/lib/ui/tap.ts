/**
 * カードを押したとき（Android 版の NoteCell の clickable「投稿詳細を開く」など）。中のリンク・ボタン・入力・動画を
 * 押したときと、文字を選んでいるとき、修飾キーつきのときは、カードを開かない。
 */
const INTERACTIVE = "a, button, input, textarea, select, label, video, audio, summary, dialog, [role='button'], [role='menu'], [role='dialog'], [contenteditable]";

export function plainTap(event: MouseEvent): boolean {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return false;
  const target = event.target as Element | null;
  if (!target || target.closest(INTERACTIVE)) return false;
  const selection = window.getSelection();
  return !(selection && !selection.isCollapsed && selection.toString().trim());
}
