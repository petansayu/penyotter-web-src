import { addColumn, moveColumn, moveColumnTo, parseColumns, removeColumn, updateColumn, type ColumnFilter, type ColumnType, type ColumnWidth, type DeckColumn } from "../domain/deck";
import { settings } from "./settings.svelte";
import { viewer } from "./viewer.svelte";

/**
 * カラム表示。画面の幅が広く（1,100 ピクセル以上）、設定の「横長の画面ではカラムに並べる」がオンのときに使う。
 * 列の並びは見る人ごとにブラウザに保存する（`deck.<公開鍵>`）。
 */

const WIDE = "(min-width: 1100px)";

const PIN_KEY = "deck-composer-pinned";

function readPin(): boolean {
  try {
    return localStorage.getItem(PIN_KEY) === "1";
  } catch {
    return false;
  }
}

class Deck {
  columns = $state<DeckColumn[]>([]);
  /** 投稿欄を左に開いたままにする（このブラウザだけ）。 */
  pinComposer = $state(readPin());
  private wide = $state(false);
  private owner: string | null = null;

  constructor() {
    const query = window.matchMedia(WIDE);
    this.wide = query.matches;
    query.addEventListener("change", (event) => (this.wide = event.matches));
  }

  /** カラム表示にするか。 */
  get active() {
    return this.wide && settings.columns;
  }

  /** 見る人が決まったら呼ぶ。保存した並びを読む。 */
  load(pubkey: string) {
    if (this.owner === pubkey) return;
    this.owner = pubkey;
    try {
      this.columns = parseColumns(JSON.parse(localStorage.getItem(`deck.${pubkey}`) ?? "null"));
    } catch {
      this.columns = parseColumns(null);
    }
  }

  private save() {
    const me = viewer.pubkey;
    if (!me) return;
    try {
      localStorage.setItem(`deck.${me}`, JSON.stringify(this.columns));
    } catch {
      // 保存できなくてもこの間は使える
    }
  }

  private set(columns: DeckColumn[]) {
    this.columns = columns;
    this.save();
  }

  /** 列を足す。足した列の id（上限で足せなければ null）。 */
  add(type: ColumnType, param?: string, extra?: { name?: string; filter?: ColumnFilter }): string | null {
    const before = this.columns.length;
    this.set(addColumn(this.columns, type, param, extra));
    return this.columns.length > before ? this.columns[this.columns.length - 1].id : null;
  }

  remove(id: string) {
    this.set(removeColumn(this.columns, id));
  }

  move(id: string, delta: -1 | 1) {
    this.set(moveColumn(this.columns, id, delta));
  }

  moveTo(id: string, index: number) {
    this.set(moveColumnTo(this.columns, id, index));
  }

  setPinComposer(pinned: boolean) {
    this.pinComposer = pinned;
    try {
      localStorage.setItem(PIN_KEY, pinned ? "1" : "0");
    } catch {
      // 保存できなくてもこの間は使える
    }
  }

  setWidth(id: string, width: ColumnWidth) {
    this.set(updateColumn(this.columns, id, { width }));
  }

  setParam(id: string, param: string) {
    this.set(updateColumn(this.columns, id, { param }));
  }

  setName(id: string, name: string) {
    this.set(updateColumn(this.columns, id, { name }));
  }

  setFilter(id: string, filter: ColumnFilter) {
    this.set(updateColumn(this.columns, id, { filter }));
  }
}

export const deck = new Deck();
