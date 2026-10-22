/**
 * 画像ビューアの指の操作（Android 版の ViewerImage）。2 本指で拡大・縮小（ピンチ）、ダブルタップで 2.5 倍と元の大きさを
 * 切り替え、拡大中は 1 本指で動かす。拡大していないときに左右へスワイプすると前後の画像へ（拡大中は移らない）。
 */

export interface ZoomState {
  scale: number;
  x: number;
  y: number;
}

const MAX_SCALE = 5;
const DOUBLE_TAP_MS = 300;
const SWIPE_DISTANCE = 60;

export function attachZoom(element: HTMLElement, change: (state: ZoomState) => void, swipe: (direction: -1 | 1) => void): () => void {
  let state: ZoomState = { scale: 1, x: 0, y: 0 };
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchStart: { distance: number; scale: number } | null = null;
  let panStart: { x: number; y: number; stateX: number; stateY: number } | null = null;
  let swipeStart: { x: number; y: number } | null = null;
  let lastTap = 0;

  const set = (next: ZoomState) => {
    const scale = Math.min(MAX_SCALE, Math.max(1, next.scale));
    state = scale === 1 ? { scale: 1, x: 0, y: 0 } : { ...next, scale };
    change(state);
  };
  const distance = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const down = (event: PointerEvent) => {
    element.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      pinchStart = { distance: distance(), scale: state.scale };
      panStart = null;
      swipeStart = null;
      return;
    }
    const now = Date.now();
    if (now - lastTap < DOUBLE_TAP_MS) {
      // ダブルタップ: 押した場所を中心に拡大、拡大中なら元に戻す
      lastTap = 0;
      if (state.scale > 1) set({ scale: 1, x: 0, y: 0 });
      else {
        const box = element.getBoundingClientRect();
        const dx = event.clientX - (box.left + box.width / 2);
        const dy = event.clientY - (box.top + box.height / 2);
        set({ scale: 2.5, x: -dx * 1.5, y: -dy * 1.5 });
      }
      return;
    }
    lastTap = now;
    if (state.scale > 1) panStart = { x: event.clientX, y: event.clientY, stateX: state.x, stateY: state.y };
    else swipeStart = { x: event.clientX, y: event.clientY };
  };

  const move = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinchStart && pointers.size === 2) {
      set({ ...state, scale: (pinchStart.scale * distance()) / pinchStart.distance });
    } else if (panStart) {
      set({ ...state, x: panStart.stateX + event.clientX - panStart.x, y: panStart.stateY + event.clientY - panStart.y });
    }
  };

  const up = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (swipeStart && pointers.size === 0) {
      const dx = event.clientX - swipeStart.x;
      const dy = event.clientY - swipeStart.y;
      if (Math.abs(dx) >= SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy) * 1.5) swipe(dx < 0 ? 1 : -1);
    }
    swipeStart = null;
    if (pointers.size === 0) panStart = null;
  };

  element.addEventListener("pointerdown", down);
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", up);
  element.addEventListener("pointercancel", up);
  return () => {
    element.removeEventListener("pointerdown", down);
    element.removeEventListener("pointermove", move);
    element.removeEventListener("pointerup", up);
    element.removeEventListener("pointercancel", up);
  };
}
