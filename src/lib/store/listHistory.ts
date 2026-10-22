import { isHex64, type Event } from "../nostr/events";

/**
 * 一覧の履歴（技術資料 7.4）。フォロー（3）・ミュート（10000）の版を、見る人ごとにブラウザ（IndexedDB の
 * `penyotter-history-<公開鍵>`）に残す。投稿などの保存分（db.ts）とは別のデータベースにして、「保存分を消す」や
 * 「別の人に切り替える」では消さない（取り違えた一覧を戻すための控えなので）。
 *
 * 一覧ごとに 100 版・2MB まで。あふれたら固定していない古い版から消す。固定した版は 20 版まで。署名は残さない
 * （昔の版をそのまま送り直すことはしないため）。
 */

export type HistorySource = "relay" | "local" | "app" | "before-restore";

export interface Version {
  id: string;
  kind: number;
  /** 署名を除いたイベント。 */
  event: Event;
  source: HistorySource;
  savedAt: number;
  pinned: boolean;
}

export const MAX_VERSIONS = 100;
export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_PINNED = 20;

const databases = new Map<string, Promise<IDBDatabase | null>>();
export const historyDbName = (viewer: string) => `penyotter-history-${viewer}`;

function open(viewer: string): Promise<IDBDatabase | null> {
  if (!isHex64(viewer)) return Promise.resolve(null);
  let db = databases.get(viewer);
  if (!db) {
    db = new Promise((resolve) => {
      try {
        const request = indexedDB.open(historyDbName(viewer), 1);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore("versions", { keyPath: "id" });
          store.createIndex("kind", "kind");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    databases.set(viewer, db);
  }
  return db;
}

const finished = (transaction: IDBTransaction) =>
  new Promise<boolean>((resolve) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
    transaction.onabort = () => resolve(false);
  });

const value = <T>(request: IDBRequest<T>) =>
  new Promise<T | undefined>((resolve) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
  });

const size = (version: Version) => JSON.stringify(version.event).length;

/** 一覧の版を新しい順に。 */
export async function readVersions(viewer: string, kind: number): Promise<Version[]> {
  const db = await open(viewer);
  if (!db) return [];
  const rows = (await value(db.transaction("versions").objectStore("versions").index("kind").getAll(kind))) ?? [];
  return rows.sort((a, b) => b.event.created_at - a.event.created_at || b.savedAt - a.savedAt);
}

/** いちばん新しい版（このブラウザが知っている、その一覧の最後の版）。 */
export async function latestVersion(viewer: string, kind: number): Promise<Event | undefined> {
  return (await readVersions(viewer, kind))[0]?.event;
}

/**
 * 版を残す。もう残っていれば、固定だけを直す。残せなかったら false（書き換えをやめる合図）。
 */
export async function recordVersion(viewer: string, event: Event, source: HistorySource, pinned = false): Promise<boolean> {
  const db = await open(viewer);
  if (!db) return false;
  try {
    const transaction = db.transaction("versions", "readwrite");
    const store = transaction.objectStore("versions");
    const before = await value<Version>(store.get(event.id));
    if (before) {
      if (pinned && !before.pinned) store.put({ ...before, pinned: true });
    } else {
      // 画面の状態（$state）のイベントは Proxy なので、そのままでは IndexedDB に入れられない。素のオブジェクトにする
      const { sig: _sig, ...unsigned } = JSON.parse(JSON.stringify(event)) as Event;
      store.put({ id: event.id, kind: event.kind, event: { ...unsigned, sig: "" }, source, savedAt: Date.now(), pinned } satisfies Version);
    }
    if (!(await finished(transaction))) return false;
    await prune(db, event.kind);
    return true;
  } catch {
    return false;
  }
}

/** あふれた版を消す（固定していない古いものから。固定したものは 20 版まで）。 */
async function prune(db: IDBDatabase, kind: number) {
  const transaction = db.transaction("versions", "readwrite");
  const store = transaction.objectStore("versions");
  const rows = ((await value<Version[]>(store.index("kind").getAll(kind))) ?? []).sort((a, b) => b.event.created_at - a.event.created_at || b.savedAt - a.savedAt);
  const pinned = rows.filter((row) => row.pinned);
  const loose = rows.filter((row) => !row.pinned);
  const drop = new Set<string>(pinned.slice(MAX_PINNED).map((row) => row.id));
  let count = rows.length - drop.size;
  let bytes = rows.filter((row) => !drop.has(row.id)).reduce((sum, row) => sum + size(row), 0);
  for (let i = loose.length - 1; i >= 0 && (count > MAX_VERSIONS || bytes > MAX_BYTES); i--) {
    drop.add(loose[i].id);
    count--;
    bytes -= size(loose[i]);
  }
  for (const id of drop) store.delete(id);
  await finished(transaction);
}

/** 見る人の履歴をすべて消す（テスト用）。 */
export async function deleteHistory(viewer: string): Promise<void> {
  const db = await databases.get(viewer);
  db?.close();
  databases.delete(viewer);
  await new Promise<void>((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(historyDbName(viewer));
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}
