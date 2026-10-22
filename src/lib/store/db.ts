import { expired, isHex64, newer, type Event } from "../nostr/events";

/**
 * ブラウザ内の保存（IndexedDB）。Android 版の Cache と同じく、見る人ごとに別のデータベースにし、リレーから
 * 取り直せるものだけを置く（技術資料 2.3）。読めない・書けないときは何もしない（保存がなくても動く）。
 *
 * - events: 一覧ごとの投稿。キーは `<一覧>:<ID>`。一覧は home（ホーム、2,000 件）・global（グローバル、2,000 件）・notes（リポスト元・引用・
 *   通知の対象など、見た投稿、2,000 件）・notifications（通知、500 件）。
 * - profiles: kind 0。新しいものだけを残す。
 */

export type Scope = "home" | "global" | "notes" | "notifications";
export const SCOPE_LIMITS: Record<Scope, number> = { home: 2000, global: 2000, notes: 2000, notifications: 500 };
/** 保存する種類（技術資料 8.5 の、本文として描く種類とリポスト。kind 7 は「あなたのリアクション」のため、通知の対象だけ）。 */
const SAVED_KINDS = new Set([1, 1111, 42, 30023, 1068, 20, 21, 22, 34235, 34236, 6, 16, 7, 9735]);

interface Row { key: string; scope: Scope; created_at: number; event: Event }

const VERSION = 1;
const databases = new Map<string, Promise<IDBDatabase | null>>();

const dbName = (viewer: string) => `penyotter-${viewer}`;

function open(viewer: string): Promise<IDBDatabase | null> {
  if (!isHex64(viewer)) return Promise.resolve(null);
  let db = databases.get(viewer);
  if (!db) {
    db = new Promise((resolve) => {
      try {
        const request = indexedDB.open(dbName(viewer), VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          const events = database.createObjectStore("events", { keyPath: "key" });
          events.createIndex("scope", ["scope", "created_at"]);
          database.createObjectStore("profiles", { keyPath: "pubkey" });
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

const done = (transaction: IDBTransaction) =>
  new Promise<void>((resolve) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });

const result = <T>(request: IDBRequest<T>) =>
  new Promise<T | undefined>((resolve) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
  });

/** 一覧の新しいものから limit 件（期限切れは除く）。 */
export async function readScope(viewer: string, scope: Scope, limit = SCOPE_LIMITS[scope]): Promise<Event[]> {
  const db = await open(viewer);
  if (!db) return [];
  try {
    const store = db.transaction("events").objectStore("events");
    const range = IDBKeyRange.bound([scope, -Infinity], [scope, Infinity]);
    const events: Event[] = [];
    await new Promise<void>((resolve) => {
      const cursor = store.index("scope").openCursor(range, "prev");
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current || events.length >= limit) return resolve();
        const row = current.value as Row;
        if (!expired(row.event)) events.push(row.event);
        current.continue();
      };
      cursor.onerror = () => resolve();
    });
    return events;
  } catch {
    return [];
  }
}

/** ID で読む（どの一覧でも）。 */
export async function readEvents(viewer: string, ids: string[]): Promise<Event[]> {
  const db = await open(viewer);
  if (!db || ids.length === 0) return [];
  try {
    const store = db.transaction("events").objectStore("events");
    const scopes: Scope[] = ["home", "global", "notes", "notifications"];
    const found = new Map<string, Event>();
    await Promise.all(ids.flatMap((id) => scopes.map(async (scope) => {
      const row = (await result(store.get(`${scope}:${id}`))) as Row | undefined;
      if (row && !expired(row.event)) found.set(id, row.event);
    })));
    return ids.map((id) => found.get(id)).filter((event): event is Event => !!event);
  } catch {
    return [];
  }
}

/** 一覧に入れる。保存しない種類と期限切れは除く。入れたあと、一覧を上限まで削る。 */
export async function saveScope(viewer: string, scope: Scope, events: Event[]): Promise<void> {
  const rows = events.filter((event) => SAVED_KINDS.has(event.kind) && !expired(event))
    .map((event): Row => ({ key: `${scope}:${event.id}`, scope, created_at: event.created_at, event }));
  if (rows.length === 0) return;
  const db = await open(viewer);
  if (!db) return;
  try {
    const transaction = db.transaction("events", "readwrite");
    const store = transaction.objectStore("events");
    for (const row of rows) store.put(row);
    await done(transaction);
    await trim(db, scope);
  } catch {
    // 保存できなくても動く
  }
}

async function trim(db: IDBDatabase, scope: Scope) {
  const transaction = db.transaction("events", "readwrite");
  const index = transaction.objectStore("events").index("scope");
  let seen = 0;
  const cursor = index.openCursor(IDBKeyRange.bound([scope, -Infinity], [scope, Infinity]), "prev");
  cursor.onsuccess = () => {
    const current = cursor.result;
    if (!current) return;
    if (++seen > SCOPE_LIMITS[scope]) current.delete();
    current.continue();
  };
  await done(transaction);
}

/** 一覧をまるごと消す（グローバルで読むリレーを変えたとき）。 */
export async function clearScope(viewer: string, scope: Scope): Promise<void> {
  const db = await open(viewer);
  if (!db) return;
  try {
    const transaction = db.transaction("events", "readwrite");
    const cursor = transaction.objectStore("events").index("scope").openCursor(IDBKeyRange.bound([scope, -Infinity], [scope, Infinity]));
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) return;
      current.delete();
      current.continue();
    };
    await done(transaction);
  } catch {
    // 何もしない
  }
}

/** 一覧から外す。 */
export async function removeFromScope(viewer: string, scope: Scope, ids: string[]): Promise<void> {
  const db = await open(viewer);
  if (!db || ids.length === 0) return;
  try {
    const transaction = db.transaction("events", "readwrite");
    for (const id of ids) transaction.objectStore("events").delete(`${scope}:${id}`);
    await done(transaction);
  } catch {
    // 何もしない
  }
}

/** 保存したプロフィール（kind 0）。 */
export async function readProfiles(viewer: string, pubkeys: string[]): Promise<Event[]> {
  const db = await open(viewer);
  if (!db || pubkeys.length === 0) return [];
  try {
    const store = db.transaction("profiles").objectStore("profiles");
    const rows = await Promise.all(pubkeys.map((pubkey) => result(store.get(pubkey))));
    return rows.filter((row): row is { pubkey: string; event: Event } => !!row).map((row) => row.event);
  } catch {
    return [];
  }
}

/** プロフィールを保存する。保存済みより新しいものだけ。 */
export async function saveProfiles(viewer: string, events: Event[]): Promise<void> {
  const db = await open(viewer);
  if (!db || events.length === 0) return;
  try {
    const transaction = db.transaction("profiles", "readwrite");
    const store = transaction.objectStore("profiles");
    await Promise.all(events.filter((event) => event.kind === 0).map(async (event) => {
      const saved = (await result(store.get(event.pubkey))) as { event: Event } | undefined;
      if (newer(event, saved?.event)) store.put({ pubkey: event.pubkey, event });
    }));
    await done(transaction);
  } catch {
    // 保存できなくても動く
  }
}

/** 見る人の保存分をすべて消す。 */
export async function deleteViewerData(viewer: string): Promise<void> {
  const db = await databases.get(viewer);
  db?.close();
  databases.delete(viewer);
  await new Promise<void>((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(dbName(viewer));
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}
