import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Event } from "../nostr/events";
import { deleteHistory, latestVersion, MAX_PINNED, MAX_VERSIONS, readVersions, recordVersion } from "./listHistory";

const VIEWER = "a".repeat(64);
let next = 1;
const list = (kind = 3, created_at = next): Event =>
  ({ id: (next++).toString(16).padStart(64, "0"), pubkey: VIEWER, created_at, kind, tags: [["p", "b".repeat(64)]], content: "", sig: "f".repeat(128) });

beforeEach(async () => {
  await deleteHistory(VIEWER);
});

describe("一覧の履歴", () => {
  it("一覧ごとに新しい順。署名は残さない。同じ版は 1 回だけ", async () => {
    const old = list(3, 10);
    const latest = list(3, 20);
    const mute = list(10000, 30);
    expect(await recordVersion(VIEWER, old, "relay")).toBe(true);
    await recordVersion(VIEWER, latest, "app");
    await recordVersion(VIEWER, latest, "app");
    await recordVersion(VIEWER, mute, "relay");
    const versions = await readVersions(VIEWER, 3);
    expect(versions.map((v) => v.id)).toEqual([latest.id, old.id]);
    expect(versions[0].event.sig).toBe("");
    expect((await latestVersion(VIEWER, 3))?.id).toBe(latest.id);
    expect((await readVersions(VIEWER, 10000)).map((v) => v.id)).toEqual([mute.id]);
  });

  it("あふれたら固定していない古い版から消し、固定は 20 版まで", async () => {
    const pinnedOld = list(3, 1);
    await recordVersion(VIEWER, pinnedOld, "local", true);
    for (let i = 0; i < MAX_VERSIONS + 5; i++) await recordVersion(VIEWER, list(3, 100 + i), "relay");
    const versions = await readVersions(VIEWER, 3);
    expect(versions).toHaveLength(MAX_VERSIONS);
    expect(versions.some((v) => v.id === pinnedOld.id)).toBe(true);
    for (let i = 0; i < MAX_PINNED + 3; i++) await recordVersion(VIEWER, list(3, 1000 + i), "relay", true);
    const pinned = (await readVersions(VIEWER, 3)).filter((v) => v.pinned);
    expect(pinned).toHaveLength(MAX_PINNED);
    expect(pinned.some((v) => v.id === pinnedOld.id)).toBe(false);
  });
});

describe("画面の状態のイベント", () => {
  it("Proxy のイベントも残せる", async () => {
    const proxied = new Proxy(list(3, 5000), {});
    expect(await recordVersion(VIEWER, proxied, "relay")).toBe(true);
  });
});
