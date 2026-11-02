import { latest, type Event, type Filter } from "./events";
import { delay, eventsOf, merge, pool, type Fetched } from "./pool";
import { publicRelay, relaySet } from "./relayUrl";
import { TEST_RELAY } from "./testMode";

/** 新しいアカウントの最初のリレー（Android 版と同じ）。閲覧する人のリレーリストが見つからないときに使う。 */
export const DEFAULT_RELAYS = TEST_RELAY ? [TEST_RELAY] : ["wss://yabu.me", "wss://relay-jp.nostr.wirednet.jp", "wss://nos.lol"];

/**
 * kind 0・10002 を集めているリレー。相手のリレーリストとプロフィールを探すときに足す。読み込みリレーが受信専用
 * （inbox）のリレーばかりの人だと、自分のリレーだけではフォロー中の人のリストが見つからないため（Web 版だけの追加）。
 */
export const INDEXER_RELAYS = TEST_RELAY ? [] : ["wss://purplepag.es", "wss://directory.yabu.me"];

export interface RelayList { read: string[]; write: string[] }

/**
 * kind 10002 の `r` タグを読む（技術資料 4.4.1）。3 つ目の値が read・write 以外のものは使わない。12 件まで、
 * `wss://` で公開のアドレスだけ。
 */
export function parseRelayList(event: Event): RelayList {
  const read: string[] = [];
  const write: string[] = [];
  let count = 0;
  for (const tag of event.tags) {
    if (tag[0] !== "r" || tag.length < 2 || count >= 12) continue;
    const marker = tag[2];
    if (marker !== undefined && marker !== "" && marker !== "read" && marker !== "write") continue;
    const url = publicRelay(tag[1]);
    if (!url) continue;
    count++;
    if (marker !== "write" && !read.includes(url)) read.push(url);
    if (marker !== "read" && !write.includes(url)) write.push(url);
  }
  return { read, write };
}

interface Cached { list: RelayList | null; at: number }
const FOUND_FOR = 6 * 3600_000;
const MISSING_FOR = 10 * 60_000;
const STORAGE_KEY = "relay-lists";

/** 相手の kind 10002。見つかったら 6 時間、見つからなかったら 10 分覚える（ブラウザに保存）。 */
class RelayListCache {
  private readonly lists = new Map<string, Cached>();

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, Cached>;
      for (const [pubkey, value] of Object.entries(saved)) if (this.fresh(value)) this.lists.set(pubkey, value);
    } catch {
      // 保存分が読めなければ取り直す
    }
  }

  private fresh(value: Cached) {
    return Date.now() - value.at < (value.list ? FOUND_FOR : MISSING_FOR);
  }

  get(pubkey: string): Cached | undefined {
    const value = this.lists.get(pubkey);
    return value && this.fresh(value) ? value : undefined;
  }

  set(pubkey: string, list: RelayList | null) {
    this.lists.set(pubkey, { list, at: Date.now() });
  }

  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  /** ブラウザに保存する。続けて呼ばれても、まとめて 2 秒後に 1 回だけ書く（数千人分の JSON を書くので重い）。 */
  save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.write();
    }, 2000);
  }

  private write() {
    try {
      const found = [...this.lists].filter(([, value]) => this.fresh(value)).slice(-3000);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(found)));
    } catch {
      // 保存できなくても動く
    }
  }
}

export const relayLists = new RelayListCache();

/**
 * 何人分かの kind 10002 を探す（200 人ずつ、同時に 3 つまで）。探す先はヒントと自分のリレー（4 件まで）に
 * インデックス用のリレーを足したもの。
 */
export async function loadRelayLists(pubkeys: string[], lookIn: string[]): Promise<void> {
  const missing = [...new Set(pubkeys)].filter((pubkey) => !relayLists.get(pubkey));
  if (missing.length === 0) return;
  const relays = relaySet([...relaySet(lookIn, 4), ...INDEXER_RELAYS]);
  const chunks: string[][] = [];
  for (let i = 0; i < missing.length; i += 200) chunks.push(missing.slice(i, i + 200));
  await runLimited(chunks, 3, async (authors) => {
    const fetched = await pool.fetch(relays, [{ kinds: [10002], authors }]);
    const byAuthor = new Map<string, Event[]>();
    for (const event of eventsOf(fetched)) byAuthor.set(event.pubkey, [...(byAuthor.get(event.pubkey) ?? []), event]);
    for (const author of authors) {
      const event = latest(byAuthor.get(author) ?? []);
      if (event) relayLists.set(author, parseRelayList(event));
      else if (fetched.complete) relayLists.set(author, null);
    }
  });
  relayLists.save();
}

/** 相手の書き込みリレー（6 件まで）。分からなければ空。 */
export function writeRelays(pubkey: string): string[] {
  return relayLists.get(pubkey)?.list?.write.slice(0, 6) ?? [];
}

/**
 * 一人分を読む（技術資料 4.4.2）。相手の書き込みリレー（ヒントを先頭に）へ送り、0.7 秒後にそこに含まれない
 * 自分の読み込みリレーへも送って、合わせる。
 */
export async function fetchFromAuthor(pubkey: string, filters: Filter[], readRelays: string[], hints: string[] = [],
  onEvent?: (event: Event) => void): Promise<Fetched> {
  await loadRelayLists([pubkey], [...hints, ...readRelays]);
  const theirs = relaySet([...hints.map((url) => publicRelay(url) ?? ""), ...writeRelays(pubkey)].filter(Boolean));
  const first = pool.fetch(theirs, filters, { onEvent });
  const rest = relaySet(readRelays).filter((url) => !theirs.includes(url));
  const second = delay(theirs.length > 0 ? 700 : 0).then(() => pool.fetch(rest, filters, { onEvent }));
  return merge(await Promise.all([first, second]));
}

export interface AuthorPlan { relay: string; authors: string[] }

/** 12 件の枠とは別に、必ず問い合わせる人とリレー（ホームの自分と、自分の書き込みリレー）。 */
export interface PinnedAuthor { author: string; relays: string[] }

/**
 * 1 つの REQ に入れる相手の数。REQ の中は 100 人ずつのフィルタに分ける（`chunkAuthors`）。リレーは同時に開ける
 * REQ の数（10 前後）や 1 つの REQ のフィルタの数（10 前後）を限っているので、人数が多くても REQ を増やしすぎない
 * ように、100 人のフィルタを 5 つまとめる（2026-10-23 に日本のリレーで確かめた）。
 */
export const AUTHORS_PER_REQ = 500;

/** 何人分かを AUTHORS_PER_REQ 人ずつに分ける。 */
export function groupAuthors(authors: string[]): string[][] {
  const groups: string[][] = [];
  for (let i = 0; i < authors.length; i += AUTHORS_PER_REQ) groups.push(authors.slice(i, i + AUTHORS_PER_REQ));
  return groups;
}

/**
 * 何人分かを、リレーごとにまとめる（技術資料 4.4.3）。相手の数は限らない（以前は 500 人までで、それより多く
 * フォローしている人のホームで、あとからフォローした人の投稿が出なかった）。相手の多いリレーから 12 件、
 * 1 つの REQ の authors は AUTHORS_PER_REQ 人まで。pinned の人は、そのリレーが 12 件に入らなくても問い合わせる
 * （自分の書き込みリレーがフォロー中の人とあまり重ならないと、自分の投稿がホームに出なかったため）。
 */
export function planAuthors(pubkeys: string[], pinned: PinnedAuthor[] = []): AuthorPlan[] {
  const byRelay = new Map<string, string[]>();
  for (const pubkey of new Set(pubkeys)) {
    for (const url of writeRelays(pubkey)) {
      const authors = byRelay.get(url);
      if (authors) authors.push(pubkey);
      else byRelay.set(url, [pubkey]);
    }
  }
  const chosen = [...byRelay].sort((a, b) => b[1].length - a[1].length).slice(0, 12);
  const plans = chosen.flatMap(([relay, authors]) => groupAuthors(authors).map((group) => ({ relay, authors: group })));
  for (const { author, relays } of pinned) {
    for (const relay of relays) {
      if (!plans.some((plan) => plan.relay === relay && plan.authors.includes(author))) plans.push({ relay, authors: [author] });
    }
  }
  return plans;
}

/** authors を 100 人ずつのフィルタに分ける。 */
export function chunkAuthors(base: Filter, authors: string[]): Filter[] {
  const filters: Filter[] = [];
  for (let i = 0; i < authors.length; i += 100) filters.push({ ...base, authors: authors.slice(i, i + 100) });
  return filters;
}

/**
 * 何人分かを読む（技術資料 4.4.3）。選んだリレーへ同時に 8 つまで、1 つあたり 4 秒で打ち切る。0.7 秒後に
 * 常時接続リレーへ全員分を送る（取りこぼしを防ぐため）。
 */
export async function fetchFromAuthors(pubkeys: string[], base: Filter, alwaysOn: string[],
  onEvent?: (event: Event) => void, perRelayLimit = 4000, pinned: PinnedAuthor[] = []): Promise<Fetched> {
  await loadRelayLists(pubkeys, alwaysOn);
  const plans = planAuthors(pubkeys, pinned);
  const outbox = runLimited(plans, 8, (plan) => pool.fetch([plan.relay], chunkAuthors(base, plan.authors), { limit: perRelayLimit, onEvent }));
  const everyone = delay(700).then(async () => merge(await Promise.all(groupAuthors([...new Set(pubkeys)]).map((group) => pool.fetch(alwaysOn, chunkAuthors(base, group), { onEvent })))));
  const [outboxResults, everyoneResult] = await Promise.all([outbox, everyone]);
  // 完了かどうかは常時接続リレーの分で決める（アウトボックスの分は打ち切りが短く、届かないリレーも多い）
  return { ...merge([...outboxResults, everyoneResult]), complete: everyoneResult.complete };
}

/** 何人分かを購読する（4.4.3 と同じ分け方。打ち切りはない）。 */
export function subscribeAuthors(pubkeys: string[], base: Filter, alwaysOn: string[], onEvent: (event: Event) => void, pinned: PinnedAuthor[] = []): () => void {
  const closers = planAuthors(pubkeys, pinned).map((plan) => pool.subscribe([plan.relay], chunkAuthors(base, plan.authors), onEvent));
  for (const group of groupAuthors([...new Set(pubkeys)])) closers.push(pool.subscribe(alwaysOn, chunkAuthors(base, group), onEvent));
  return () => closers.forEach((close) => close());
}

async function runLimited<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
