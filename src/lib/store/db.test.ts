import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Event } from "nostr-tools";
import { deleteViewerData, readEvents, readProfiles, readScope, saveProfiles, saveScope, SCOPE_LIMITS } from "./db";

const VIEWER = "a".repeat(64);
let next = 1;
const event = (fields: Partial<Event> = {}): Event =>
  ({ id: (next++).toString(16).padStart(64, "0"), pubkey: "b".repeat(64), created_at: next, kind: 1, tags: [], content: "", sig: "0".repeat(128), ...fields }) as Event;

beforeEach(async () => {
  await deleteViewerData(VIEWER);
});

describe("db", () => {
  it("一覧ごとに新しい順に読み、上限で削る", async () => {
    const events = Array.from({ length: SCOPE_LIMITS.notifications + 5 }, () => event({ kind: 7 }));
    await saveScope(VIEWER, "notifications", events);
    const read = await readScope(VIEWER, "notifications");
    expect(read).toHaveLength(SCOPE_LIMITS.notifications);
    expect(read[0].id).toBe(events.at(-1)!.id);
    expect(await readScope(VIEWER, "home")).toEqual([]);
  });

  it("保存しない種類と期限切れは入れない", async () => {
    const kept = event();
    await saveScope(VIEWER, "home", [kept, event({ kind: 3 }), event({ tags: [["expiration", "1"]] })]);
    expect((await readScope(VIEWER, "home")).map((e) => e.id)).toEqual([kept.id]);
    expect((await readEvents(VIEWER, [kept.id, "f".repeat(64)])).map((e) => e.id)).toEqual([kept.id]);
  });

  it("プロフィールは新しいものだけ残す", async () => {
    const older = event({ kind: 0, created_at: 10, content: "{\"name\":\"old\"}" });
    const newerOne = event({ kind: 0, created_at: 20, content: "{\"name\":\"new\"}" });
    await saveProfiles(VIEWER, [newerOne]);
    await saveProfiles(VIEWER, [older]);
    expect((await readProfiles(VIEWER, ["b".repeat(64)])).map((e) => e.content)).toEqual(["{\"name\":\"new\"}"]);
  });

  it("見る人の保存分を消す", async () => {
    await saveScope(VIEWER, "home", [event()]);
    await deleteViewerData(VIEWER);
    expect(await readScope(VIEWER, "home")).toEqual([]);
  });
});
