/**
 * 要素を含むスクロールの入れ物（カラムの列など）を一番上へ動かす。入れ物がなければ画面全体を動かす。
 */
export function scrollOwnerToTop(element: Element | undefined, behavior: ScrollBehavior = "auto") {
  let node = element?.parentElement ?? null;
  while (node) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") {
      node.scrollTo({ top: 0, behavior });
      return;
    }
    node = node.parentElement;
  }
  window.scrollTo({ top: 0, behavior });
}
