/**
 * スマホでの指の操作（1 列の画面）。Android 版と同じく、左右のスワイプで隣のタブへ（端でループ）、いちばん上で
 * 下に引っぱって離すと読み直す（PullToRefreshBox）。
 */

export interface GestureHandlers {
  /** 左右のスワイプ。-1 は前（右へスワイプ）、1 は次（左へスワイプ）。 */
  swipe(direction: -1 | 1): void;
  /** 引っぱって更新できる画面か。 */
  canPull(): boolean;
  pull(): Promise<void> | void;
  /** 引っぱっている距離（0 で隠す）。 */
  pulling(distance: number, ready: boolean): void;
}

const SWIPE_DISTANCE = 70;
const SWIPE_TIME = 700;
export const PULL_READY = 110;

/** 横にスクロールできる場所や、入力・ダイアログの中では、スワイプしない。 */
function blocksSwipe(target: Element | null): boolean {
  if (!target || target.closest("input, textarea, select, dialog, [contenteditable], [data-no-swipe]")) return true;
  for (let node: Element | null = target; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    if ((style.overflowX === "auto" || style.overflowX === "scroll") && node.scrollWidth > node.clientWidth) return true;
  }
  return false;
}

/** スワイプ・引っぱりのすぐ後に来るクリック（指を離した場所のカードを開いてしまう）を捨てる。 */
function swallowClick() {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 400);
}

export function attachGestures(element: HTMLElement, handlers: GestureHandlers): () => void {
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let tracking = false;
  let pullStart: number | null = null;
  let distance = 0;

  const start = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      tracking = false;
      return;
    }
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    startTime = Date.now();
    tracking = !blocksSwipe(event.target as Element | null);
    pullStart = window.scrollY <= 0 && handlers.canPull() ? touch.clientY : null;
    distance = 0;
  };

  const move = (event: TouchEvent) => {
    if (pullStart === null || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const dy = touch.clientY - pullStart;
    // 横に動かしているときと、上に戻したときは引っぱりにしない
    if (dy <= 0 || Math.abs(touch.clientX - startX) > dy || window.scrollY > 0) {
      if (distance > 0) handlers.pulling(0, false);
      distance = 0;
      return;
    }
    distance = dy;
    handlers.pulling(Math.min(dy / 2, 80), dy >= PULL_READY);
  };

  const end = (event: TouchEvent) => {
    const touch = event.changedTouches[0];
    if (pullStart !== null && distance > 0) {
      const ready = distance >= PULL_READY;
      handlers.pulling(0, false);
      pullStart = null;
      distance = 0;
      swallowClick();
      if (ready) void handlers.pull();
      return;
    }
    pullStart = null;
    if (!tracking || !touch) return;
    tracking = false;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (Date.now() - startTime > SWIPE_TIME || Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 2) return;
    swallowClick();
    handlers.swipe(dx < 0 ? 1 : -1);
  };

  element.addEventListener("touchstart", start, { passive: true });
  element.addEventListener("touchmove", move, { passive: true });
  element.addEventListener("touchend", end, { passive: true });
  return () => {
    element.removeEventListener("touchstart", start);
    element.removeEventListener("touchmove", move);
    element.removeEventListener("touchend", end);
  };
}

/** タブの並び（Android 版の下のタブと同じく、端でループ）で、隣の番号。 */
export const neighbor = (index: number, direction: -1 | 1, count: number) => (index + direction + count) % count;
