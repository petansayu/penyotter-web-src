import { isHex64 } from "../nostr/events";
import { normalizeRelay } from "../nostr/relayUrl";

/** カラム表示の列（横長の画面で、画面を縦の列にして横に並べる）。 */

export type ColumnType = "home" | "global" | "notifications" | "search" | "profile" | "posts" | "reactions" | "relays" | "list";
export type ColumnWidth = "narrow" | "normal" | "wide" | "widest";

/** 列ごとの絞り込み（一覧の列だけ）。 */
export interface ColumnFilter {
  /** どれかを含むものだけ（空白区切り）。 */
  include?: string;
  /** どれかを含むものは出さない（空白区切り）。 */
  exclude?: string;
  /** ひらがな・カタカナを含むものだけ。 */
  japanese?: boolean;
  /** リポストを出さない。 */
  hideReposts?: boolean;
}

export interface DeckColumn {
  id: string;
  type: ColumnType;
  /**
   * 検索は検索語、プロフィール・投稿・リアクションは公開鍵（16 進）、リレーはリレーの URL（空白区切り）、
   * リストはアドレス（`30000:<公開鍵>:<d>`）。
   */
  param?: string;
  width: ColumnWidth;
  /** 見出しに出す名前（なければ種類から決める）。 */
  name?: string;
  filter?: ColumnFilter;
}

export const COLUMN_TYPES: { type: ColumnType; label: string }[] = [
  { type: "home", label: "ホーム（フォロー中）" },
  { type: "global", label: "グローバル" },
  { type: "notifications", label: "通知" },
  { type: "search", label: "検索" },
  { type: "relays", label: "リレー" },
  { type: "list", label: "リスト" },
  { type: "posts", label: "投稿" },
  { type: "reactions", label: "リアクション" },
  { type: "profile", label: "プロフィール" },
];

/** 絞り込みを使える列（投稿の一覧の列）。 */
export const FILTERABLE: ReadonlySet<ColumnType> = new Set(["home", "global", "relays", "list", "posts", "reactions"]);

/** 列の幅（ピクセル）。狭い順に並べる。 */
export const COLUMN_WIDTHS: Record<ColumnWidth, number> = { narrow: 320, normal: 400, wide: 480, widest: 560 };
export const WIDTH_LABELS: Record<ColumnWidth, string> = { narrow: "小", normal: "中", wide: "大", widest: "特大" };
/** 列の数の上限。 */
export const MAX_COLUMNS = 10;
/** リレーの列に置けるリレーの数。 */
export const MAX_COLUMN_RELAYS = 12;
const MAX_NAME = 40;
const MAX_WORDS = 200;

let serial = 0;
const newId = () => `c${Date.now().toString(36)}${(serial++).toString(36)}`;

/** 最初の並び（ホームと通知）。 */
export function defaultColumns(): DeckColumn[] {
  return [
    { id: newId(), type: "home", width: "normal" },
    { id: newId(), type: "notifications", width: "normal" },
  ];
}

const TYPES = new Set<ColumnType>(COLUMN_TYPES.map((t) => t.type));
const WIDTHS = new Set<ColumnWidth>(Object.keys(COLUMN_WIDTHS) as ColumnWidth[]);

/** リレーの URL を揃えて、重ねずに並べる（空白・改行・カンマ区切り）。 */
export function parseRelayParam(raw: string): string[] {
  const urls = raw.split(/[\s,、]+/).map(normalizeRelay).filter((url): url is string => !!url);
  return [...new Set(urls)].slice(0, MAX_COLUMN_RELAYS);
}

/** リストのアドレス（`30000:<公開鍵>:<d>`）を分ける。 */
export function parseListAddress(raw: string | undefined): { pubkey: string; identifier: string } | null {
  const match = raw?.match(/^30000:([0-9a-f]{64}):(.{1,200})$/s);
  return match ? { pubkey: match[1], identifier: match[2] } : null;
}

/** 種類に合う param にする。合わなければ null（その列は作らない）。 */
export function normalizeParam(type: ColumnType, raw: string | undefined): string | undefined | null {
  switch (type) {
    case "search":
      return (raw ?? "").slice(0, 500);
    case "profile":
    case "posts":
    case "reactions":
      return isHex64(raw) ? raw : null;
    case "relays": {
      const urls = parseRelayParam(raw ?? "");
      return urls.length > 0 ? urls.join(" ") : null;
    }
    case "list":
      return parseListAddress(raw) ? raw : null;
    default:
      return undefined;
  }
}

function parseFilter(raw: unknown): ColumnFilter | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const f = raw as Record<string, unknown>;
  const filter: ColumnFilter = {};
  if (typeof f.include === "string" && f.include.trim()) filter.include = f.include.slice(0, MAX_WORDS);
  if (typeof f.exclude === "string" && f.exclude.trim()) filter.exclude = f.exclude.slice(0, MAX_WORDS);
  if (f.japanese === true) filter.japanese = true;
  if (f.hideReposts === true) filter.hideReposts = true;
  return Object.keys(filter).length > 0 ? filter : undefined;
}

function build(id: string, type: ColumnType, width: ColumnWidth, param: string | undefined, name?: unknown, filter?: unknown): DeckColumn {
  const column: DeckColumn = { id, type, width };
  if (param !== undefined) column.param = param;
  if (typeof name === "string" && name.trim()) column.name = name.trim().slice(0, MAX_NAME);
  const parsed = FILTERABLE.has(type) ? parseFilter(filter) : undefined;
  if (parsed) column.filter = parsed;
  return column;
}

/** 保存した並びを読む。壊れた列は捨て、何も残らなければ最初の並び。 */
export function parseColumns(raw: unknown): DeckColumn[] {
  if (!Array.isArray(raw)) return defaultColumns();
  const result: DeckColumn[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const c = item as Record<string, unknown>;
    if (typeof c.type !== "string" || !TYPES.has(c.type as ColumnType)) continue;
    const type = c.type as ColumnType;
    const width = typeof c.width === "string" && WIDTHS.has(c.width as ColumnWidth) ? (c.width as ColumnWidth) : "normal";
    const param = normalizeParam(type, typeof c.param === "string" ? c.param : undefined);
    if (param === null) continue;
    const id = typeof c.id === "string" && c.id && !result.some((r) => r.id === c.id) ? c.id : newId();
    result.push(build(id, type, width, param, c.name, c.filter));
    if (result.length >= MAX_COLUMNS) break;
  }
  return result.length > 0 ? result : defaultColumns();
}

/** 列を右端に足す（上限を超える・param が合わないなら足さない）。 */
export function addColumn(columns: DeckColumn[], type: ColumnType, param?: string, extra: { name?: string; filter?: ColumnFilter } = {}): DeckColumn[] {
  if (columns.length >= MAX_COLUMNS) return columns;
  const normalized = normalizeParam(type, param);
  if (normalized === null) return columns;
  return [...columns, build(newId(), type, "normal", normalized, extra.name, extra.filter)];
}

export function removeColumn(columns: DeckColumn[], id: string): DeckColumn[] {
  return columns.filter((c) => c.id !== id);
}

/** 列を左（-1）か右（+1）へ動かす。 */
export function moveColumn(columns: DeckColumn[], id: string, delta: -1 | 1): DeckColumn[] {
  const index = columns.findIndex((c) => c.id === id);
  const to = index + delta;
  if (index < 0 || to < 0 || to >= columns.length) return columns;
  const next = [...columns];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** 列を index の位置へ動かす（左のメニューでのドラッグ）。 */
export function moveColumnTo(columns: DeckColumn[], id: string, index: number): DeckColumn[] {
  const from = columns.findIndex((c) => c.id === id);
  if (from < 0) return columns;
  const to = Math.max(0, Math.min(columns.length - 1, index));
  if (from === to) return columns;
  const next = [...columns];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** 幅・param・名前・絞り込みを変える。param が種類に合わないときは変えない。 */
export function updateColumn(columns: DeckColumn[], id: string, change: Partial<Pick<DeckColumn, "width" | "param" | "name" | "filter">>): DeckColumn[] {
  return columns.map((c) => {
    if (c.id !== id) return c;
    const param = "param" in change ? normalizeParam(c.type, change.param) : c.param;
    if (param === null) return c;
    const width = change.width && WIDTHS.has(change.width) ? change.width : c.width;
    return build(c.id, c.type, width, param, "name" in change ? change.name : c.name, "filter" in change ? change.filter : c.filter);
  });
}

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** 絞り込みのための形（全角・半角と大文字・小文字を区別しない）。 */
const fold = (text: string) => text.normalize("NFKC").toLowerCase();
const words = (text: string | undefined) => (text ? fold(text).split(/\s+/).filter(Boolean) : []);

/** 本文 text の投稿（リポストなら repost）を、この絞り込みで出すか。 */
export function passesFilter(filter: ColumnFilter | undefined, text: string, repost: boolean): boolean {
  if (!filter) return true;
  if (filter.hideReposts && repost) return false;
  if (filter.japanese && !KANA.test(text)) return false;
  const body = fold(text);
  const include = words(filter.include);
  if (include.length > 0 && !include.some((word) => body.includes(word))) return false;
  return !words(filter.exclude).some((word) => body.includes(word));
}
