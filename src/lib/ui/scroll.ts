/**
 * 要素を含むスクロールの入れ物（カラムの列など）を一番上へ動かす。入れ物がなければ画面全体を動かす。
 */
export function scrollOwnerToTop(element: Element | undefined, behavior: ScrollBehavior = "auto") {
  const owner = scrollOwner(element);
  if (owner) owner.scrollTo({ top: 0, behavior });
  else window.scrollTo({ top: 0, behavior });
}

/** 要素を含むスクロールの入れ物。なければ null（画面全体）。 */
export function scrollOwner(element: Element | undefined): HTMLElement | null {
  let node = element?.parentElement ?? null;
  while (node) {
    const overflow = getComputedStyle(node).overflowY;
    // 本当に中身がはみ出してスクロールしている入れ物だけ（overflow: auto でも、はみ出していなければ画面全体が動く）
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight + 1) return node;
    node = node.parentElement;
  }
  return null;
}

/** 要素を含む入れ物（なければ画面全体）が、一番上からどれだけ下がっているか。 */
export function scrolledFromTop(element: Element | undefined): number {
  const owner = scrollOwner(element);
  return owner ? owner.scrollTop : window.scrollY;
}
