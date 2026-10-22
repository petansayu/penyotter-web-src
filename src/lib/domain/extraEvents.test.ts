import { describe, expect, it } from "vitest";
import type { Event } from "../nostr/events";
import { buildReport, buildStatus, buildVanish, buildVote, newestStatus, parsePoll, tallyPoll } from "./extraEvents";

const ME = "a".repeat(64);
const OTHER = "b".repeat(64);
let n = 0;
const event = (e: Partial<Event>): Event => ({ id: String(++n).padStart(64, "0"), pubkey: ME, created_at: 100, kind: 1, tags: [], content: "", sig: "", ...e });

describe("ステータス", () => {
  it("前の版のタグを残し、d・emoji を付け直す。時刻は前の版より新しく", () => {
    const base = event({ kind: 30315, created_at: 500, tags: [["d", "general"], ["r", "https://x.test"], ["emoji", "old", "https://x.test/o.png"], ["expiration", "9"]] });
    expect(newestStatus([base, event({ kind: 30315, created_at: 400, tags: [["d", "general"]] })], ME, "general")).toBe(base);
    const built = buildStatus(ME, "general", base, "ねむい :zzz:", [{ shortcode: "zzz", url: "https://x.test/z.png" }], 480);
    expect(built.created_at).toBe(501);
    expect(built.tags).toEqual([["d", "general"], ["r", "https://x.test"], ["emoji", "zzz", "https://x.test/z.png"]]);
    expect(() => buildStatus(ME, "music", undefined, "x".repeat(501), [], 1)).toThrow();
  });
});

describe("投票", () => {
  const poll = parsePoll(event({ kind: 1068, content: "どれ？", tags: [["option", "a", "りんご"], ["option", "b", "みかん"], ["relay", "wss://r.test"], ["endsAt", "1000"]] }))!;
  it("選択肢 2 つ以上、締め切りとリレー", () => {
    expect(poll).toMatchObject({ question: "どれ？", relays: ["wss://r.test"], multiple: false, endsAt: 1000 });
    expect(parsePoll(event({ kind: 1068, tags: [["option", "a", "1"]] }))).toBeNull();
  });
  it("1 人 1 票（締め切り前の最新）、単一選択は最初の response だけ", () => {
    const vote = (pubkey: string, at: number, ...picked: string[]) => event({ kind: 1018, pubkey, created_at: at, tags: [["e", poll.id], ...picked.map((p) => ["response", p])] });
    const tally = tallyPoll(poll, [vote(ME, 10, "a"), vote(ME, 20, "b", "a"), vote(OTHER, 30, "a"), vote(OTHER, 2000, "b")], ME);
    expect([...tally.votes]).toEqual([["a", 1], ["b", 1]]);
    expect(tally.voters).toBe(2);
    expect([...tally.mine]).toEqual(["b"]);
  });
  it("答えは e と response", () => {
    expect(buildVote(poll, new Set(["b", "a"]), 5).tags).toEqual([["e", poll.id], ["response", "a"]]);
    expect(() => buildVote(poll, new Set(), 5)).toThrow();
  });
});

describe("通報と消去の依頼", () => {
  it("投稿は e に種類、人は p に種類", () => {
    const note = event({});
    expect(buildReport({ note, pubkey: ME }, "spam", " 宣伝 ", 1)).toMatchObject({ kind: 1984, tags: [["e", note.id, "spam"], ["p", ME]], content: "宣伝" });
    expect(buildReport({ pubkey: OTHER }, "impersonation", "", 1).tags).toEqual([["p", OTHER, "impersonation"]]);
    expect(() => buildReport({ pubkey: OTHER }, "bad", "", 1)).toThrow();
  });
  it("すべてのリレーは ALL_RELAYS", () => {
    expect(buildVanish(null, "", 1).tags).toEqual([["relay", "ALL_RELAYS"]]);
    expect(buildVanish(["wss://a.test", "wss://a.test", "https://x"], "", 1).tags).toEqual([["relay", "wss://a.test"]]);
  });
});
