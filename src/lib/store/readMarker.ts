import type { ReadMarker } from "../domain/readMarker";

/** しおりは端末（このブラウザ）だけに覚える。リレーには送らない。キーは read-marker.<公開鍵>.<タブ>。 */
const key = (me: string, tab: string) => `read-marker.${me}.${tab}`;

export function loadMarker(me: string, tab: string): ReadMarker | null {
  try {
    const value = JSON.parse(localStorage.getItem(key(me, tab)) ?? "null") as ReadMarker | null;
    return value && typeof value.time === "number" && typeof value.key === "string" ? value : null;
  } catch {
    return null;
  }
}

export function saveMarker(me: string, tab: string, marker: ReadMarker) {
  try {
    localStorage.setItem(key(me, tab), JSON.stringify(marker));
  } catch {
    // 保存できないブラウザでは、しおりなしで動く
  }
}
