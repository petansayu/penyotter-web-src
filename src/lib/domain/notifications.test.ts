import { describe, expect, it } from "vitest";
import { nip19, type Event } from "nostr-tools";
import { actionLines, bolt11Msats, eligible, formatSats, notificationGroups, notificationTarget, notificationType, sats, zapReceipt } from "./notifications";

const ME = "a".repeat(64);
const OTHER = "b".repeat(64);
const THIRD = "c".repeat(64);
const POST = "1".repeat(64);
let next = 100;
const event = (fields: Partial<Event>): Event =>
  ({ id: (next++).toString(16).padStart(64, "0"), pubkey: OTHER, created_at: next, kind: 1, tags: [["p", ME]], content: "", sig: "0".repeat(128), ...fields }) as Event;
const zap = (sender: string, amount: string, bolt11?: string) => event({
  kind: 9735, pubkey: "d".repeat(64),
  tags: [["p", ME], ["e", POST], ["description", JSON.stringify({ pubkey: sender, content: "ありがとう", tags: [["amount", amount]] })], ...(bolt11 ? [["bolt11", bolt11]] : [])],
});

describe("通知の判定", () => {
  it("自分宛てで、自分以外が作ったものだけ", () => {
    expect(eligible(event({ tags: [["p", ME], ["e", POST, "", "root"]] }), ME)).toBe(true);
    expect(eligible(event({ pubkey: ME, tags: [["p", ME], ["e", POST, "", "root"]] }), ME)).toBe(false);
    expect(eligible(event({ tags: [["e", POST, "", "root"]] }), ME)).toBe(false);
    expect(eligible(event({ tags: [["p", ME]] }), ME)).toBe(false); // 何についての通知か決まらない
    expect(eligible(event({ kind: 3, tags: [["p", ME]] }), ME)).toBe(false);
  });

  it("zap は中のリクエストの作者がした人。自分の zap は出さない", () => {
    const receipt = zap(OTHER, "21000", "lnbc210n1pxyz");
    expect(zapReceipt(receipt)).toEqual({ sender: OTHER, msats: 21000, message: "ありがとう" });
    expect(eligible(receipt, ME)).toBe(true);
    expect(eligible(zap(ME, "1000"), ME)).toBe(false);
  });

  it("種類と対象", () => {
    const nevent = nip19.neventEncode({ id: POST });
    expect(notificationType(event({ tags: [["p", ME], ["q", POST]] }))).toBe("quotes");
    expect(notificationType(event({ content: `見て nostr:${nevent}` }))).toBe("quotes");
    expect(notificationTarget(event({ content: `見て nostr:${nevent}` }))).toBe(POST);
    expect(notificationType(event({ kind: 1111, tags: [["p", ME], ["e", POST]] }))).toBe("replies");
    expect(notificationTarget(event({ kind: 7, tags: [["e", THIRD], ["e", POST], ["p", ME]] }))).toBe(POST);
    expect(notificationType(event({ kind: 16, tags: [["e", POST], ["p", ME]] }))).toBe("reposts");
  });
});

describe("まとめ方", () => {
  it("返信は 1 件ずつ、反応は投稿ごと、新しいものは 1 件ずつ", () => {
    const reply = event({ tags: [["p", ME], ["e", POST, "", "root"]] });
    const like1 = event({ kind: 7, content: "+", tags: [["e", POST], ["p", ME]] });
    const like2 = event({ kind: 7, pubkey: THIRD, content: "+", tags: [["e", POST], ["p", ME]] });
    const repost = event({ kind: 6, tags: [["e", POST], ["p", ME]] });
    const groups = notificationGroups([reply, like1, like2, repost], ME, { type: "all" });
    expect(groups.map((g) => g.key)).toEqual([`actions:${POST}`, `reply:${reply.id}`]);
    expect(actionLines(groups[0])).toEqual([{ type: "reposts", actors: [OTHER] }, { type: "reaction", content: "+", emoji: null, actors: [THIRD, OTHER] }]);
    const separate = notificationGroups([reply, like1, like2, repost], ME, { type: "all", separate: new Set([repost.id]) });
    expect(separate.map((g) => g.kind)).toEqual(["action", "actions", "reply"]);
  });

  it("絞り込みとミュート", () => {
    const reply = event({ tags: [["p", ME], ["e", POST, "", "root"]] });
    const like = event({ kind: 7, pubkey: THIRD, tags: [["e", POST], ["p", ME]] });
    expect(notificationGroups([reply, like], ME, { type: "reactions" }).map((g) => g.kind)).toEqual(["actions"]);
    expect(notificationGroups([reply, like], ME, { type: "all", follows: new Set([OTHER]) }).map((g) => g.kind)).toEqual(["reply"]);
    expect(notificationGroups([reply, like], ME, { type: "all", muted: new Set([OTHER]) }).map((g) => g.kind)).toEqual(["actions"]);
    expect(notificationGroups([reply, like], ME, { type: "all", mutedNotes: new Set([POST]) })).toEqual([]);
  });
});

describe("zap の金額", () => {
  it("bolt11 の金額", () => {
    expect(bolt11Msats("lnbc1500n1abc")).toBe(150_000);
    expect(bolt11Msats("lnbc2m1abc")).toBe(200_000_000);
    expect(bolt11Msats("LIGHTNING:lnbc10u1abc")).toBe(1_000_000);
    expect(bolt11Msats("lnbc15p1abc")).toBeNull();
    expect(bolt11Msats("nonsense")).toBeNull();
    expect(formatSats(sats(1_234_000))).toBe("1,234 sats");
    expect(formatSats(null)).toBe("金額不明");
  });
});
