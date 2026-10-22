import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { countInteractions, deletedBy, deletionKeys, ownActions, type Counts } from "../domain/interactions";
import type { Event } from "../nostr/events";
import { fetchFromAuthors, loadRelayLists, relayLists } from "../nostr/outbox";
import { eventsOf, merge, pool } from "../nostr/pool";
import { relaySet } from "../nostr/relayUrl";
import { actions } from "./actions.svelte";
import { viewer } from "./viewer.svelte";

/**
 * 一覧に出た投稿の反応の数と、削除の依頼（技術資料 5.2・8.1）。
 *
 * Android 版は読み込みリレーだけに問い合わせる。Web 版はそれに加えて、投稿の作者の読み込みリレー（NIP-65 で
 * 反応が届く先）と書き込みリレー（作者の kind 5 が置かれる先）にも問い合わせる（Web 版だけ。読み込みリレーが
 * 受信専用のリレーばかりの人だと、ほかの人の投稿への反応がほとんど見つからないため）。
 */

const RELATED_KINDS = [1, 5, 6, 7, 16, 1111];
const BATCH = 100;
const MAX_AUTHOR_RELAYS = 8;
const STORAGE_KEY = "deleted-notes";
const MAX_DELETED = 2000;

export const counts = new SvelteMap<string, Counts>();
/** 作者本人が削除を依頼した投稿（と、本人が取り消したリポスト）の ID。ブラウザに新しい 2,000 件を覚える。 */
export const deletedNotes = new SvelteSet<string>(readDeleted());
/** この間に自分で削除して受理された投稿。一覧から外す（リレーがまだ返しても出さない）。 */
export const droppedNotes = new SvelteSet<string>();

function readDeleted(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((id) => typeof id === "string").slice(-MAX_DELETED) : [];
  } catch {
    return [];
  }
}

export function saveDeleted() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...deletedNotes].slice(-MAX_DELETED)));
  } catch {
    // 保存できなくてもこの間は使える
  }
}

const repostsChecked = new Set<string>();

/**
 * 一覧に出たリポストを、リポストした人が kind 5 で取り消していないか確かめる。その人の書き込みリレーと常時接続
 * リレーへ `{"kinds":[5],"authors":[...],"#e":[リポストの ID]}` を問い合わせ、取り消されていれば deletedNotes に入れる
 * （一覧はそのリポストのカードを出さない）。100 件ずつ。
 */
export function requestRepostDeletions(reposts: Event[]) {
  const fresh = reposts.filter((event) => !repostsChecked.has(event.id));
  for (const event of fresh) repostsChecked.add(event.id);
  for (let i = 0; i < fresh.length; i += BATCH) {
    const batch = fresh.slice(i, i + BATCH);
    const reposters = [...new Set(batch.map((event) => event.pubkey))];
    void fetchFromAuthors(reposters, { kinds: [5], "#e": batch.map((event) => event.id) }, viewer.alwaysOn).then((fetched) => {
      const keys = deletionKeys(eventsOf(fetched));
      let changed = false;
      for (const event of batch) {
        if (deletedBy(keys, event) && !deletedNotes.has(event.id)) {
          deletedNotes.add(event.id);
          changed = true;
        }
      }
      if (changed) saveDeleted();
    });
  }
}

const requested = new Set<string>();
let queue: Event[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

/** 投稿の反応の数と削除の依頼を読む。まとめて（100 件ずつ）問い合わせる。 */
export function requestInteractions(note: Event) {
  if (requested.has(note.id)) return;
  requested.add(note.id);
  queue.push(note);
  timer ??= setTimeout(() => {
    timer = undefined;
    const batch = queue;
    queue = [];
    for (let i = 0; i < batch.length; i += BATCH) void load(batch.slice(i, i + BATCH));
  }, 300);
}

/** 作者の読み込み・書き込みリレーを、そこを使う投稿の多い順に MAX_AUTHOR_RELAYS 件。読み込みリレーは除く。 */
function authorRelays(notes: Event[]): { relay: string; ids: string[] }[] {
  const byRelay = new Map<string, string[]>();
  for (const note of notes) {
    const list = relayLists.get(note.pubkey)?.list;
    if (!list) continue;
    for (const url of relaySet([...list.read.slice(0, 4), ...list.write.slice(0, 4)])) {
      if (viewer.readRelays.includes(url)) continue;
      byRelay.set(url, [...(byRelay.get(url) ?? []), note.id]);
    }
  }
  return [...byRelay].sort((a, b) => b[1].length - a[1].length).slice(0, MAX_AUTHOR_RELAYS).map(([relay, ids]) => ({ relay, ids }));
}

async function load(notes: Event[]) {
  const ids = notes.map((note) => note.id);
  await loadRelayLists(notes.map((note) => note.pubkey), viewer.alwaysOn);
  const filter = (targets: string[]) => [{ kinds: RELATED_KINDS, "#e": targets, limit: 1000 }];
  const [own, ...theirs] = await Promise.all([
    pool.fetch(viewer.readRelays, filter(ids)),
    ...authorRelays(notes).map(({ relay, ids: targets }) => pool.fetch([relay], filter(targets), { limit: 4000 })),
  ]);
  const related = eventsOf(merge([own, ...theirs]));
  // リポスト・リアクションの取り消し（本人の kind 5）
  const undoable = related.filter((event) => event.kind === 6 || event.kind === 7 || event.kind === 16).map((event) => event.id);
  const removals: Event[] = [];
  for (let i = 0; i < undoable.length; i += BATCH) {
    const chunk = undoable.slice(i, i + BATCH);
    removals.push(...eventsOf(await pool.fetch(relaySet([...viewer.readRelays, ...authorRelays(notes).map((plan) => plan.relay)]), [{ kinds: [5], "#e": chunk }])));
  }
  // 完了かどうかは読み込みリレーの分で決める（作者のリレーは打ち切りが短く、届かないものも多い）
  for (const [id, value] of countInteractions(ids, [...related, ...removals], own.complete)) counts.set(id, value);
  // ほかの端末でした自分のいいね・リポストも、ボタンの状態に入れる
  if (viewer.pubkey) actions.adopt(ownActions([...related, ...removals], viewer.pubkey), ids);
  const keys = deletionKeys(related);
  let changed = false;
  for (const note of notes) {
    if (deletedBy(keys, note) && !deletedNotes.has(note.id)) {
      deletedNotes.add(note.id);
      changed = true;
    }
  }
  if (changed) saveDeleted();
}
