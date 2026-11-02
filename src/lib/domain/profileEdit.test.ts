import { describe, expect, it } from "vitest";
import type { Event } from "../nostr/events";
import { birthdayText, buildProfile, parseBirthday, profileProblem, profileValues, type ProfileValues } from "./profileEdit";

const base = (content: string, created_at = 100): Event => ({ id: "1".repeat(64), pubkey: "a".repeat(64), created_at, kind: 0, tags: [["alt", "x"]], content, sig: "" });
const empty: ProfileValues = { name: "", display_name: "", about: "", picture: "", banner: "", website: "", nip05: "", lud16: "", bot: "false", birthday: "" };

describe("プロフィールの編集", () => {
  it("変えた項目だけ書き換え、知らない項目は残し、空にした項目は消す", () => {
    const old = base(JSON.stringify({ name: "pe", displayName: "ぺぇ", about: "こんにちは", bot: false, custom: { a: 1 } }));
    const values = { ...profileValues(old), display_name: "ぺぇ🐇", about: "" };
    expect(values.display_name).toBe("ぺぇ🐇");
    const next = buildProfile(old, values, 50);
    expect(next.created_at).toBe(101);
    expect(next.tags).toEqual([["alt", "x"]]);
    expect(JSON.parse(next.content)).toEqual({ name: "pe", displayName: "ぺぇ🐇", display_name: "ぺぇ🐇", bot: false, custom: { a: 1 } });
  });

  it("元の版がなければ新しく作る", () => {
    const next = buildProfile(undefined, { ...empty, name: "new" }, 50);
    expect(JSON.parse(next.content)).toEqual({ name: "new" });
    expect(next.created_at).toBe(50);
  });

  it("URL と NIP-05 を確かめる", () => {
    expect(profileProblem({ ...empty, picture: "http://a.example/x.png" })).toMatch(/https/);
    expect(profileProblem({ ...empty, picture: "https://a.example/x.png", nip05: "pe@example.com", lud16: "pe@example.com" })).toBeNull();
    expect(profileProblem({ ...empty, nip05: "example.com" })).toBeNull();
    expect(profileProblem({ ...empty, lud16: "nope" })).toMatch(/ライトニング/);
    expect(() => buildProfile(undefined, { ...empty, website: "javascript:alert(1)" }, 1)).toThrow();
  });
});

describe("テストモードの投稿先", () => {
  it("手元のテスト用の投稿先（http）だけを通す", () => {
    const values: ProfileValues = { ...empty, picture: "http://127.0.0.1:7779/x.png" };
    expect(profileProblem(values)).toMatch(/https/);
    expect(profileProblem(values, "http://127.0.0.1:7779")).toBeNull();
    expect(profileProblem({ ...values, picture: "http://127.0.0.1:7779.evil.example/x.png" }, "http://127.0.0.1:7779")).toMatch(/https/);
  });
});

describe("BOT と誕生日（NIP-24）", () => {
  it("bot は真偽値、誕生日は 年/月/日（省略できる）。変えたときだけ書き換える", () => {
    const old = base(JSON.stringify({ name: "pe", bot: true, birthday: { month: 4, day: 12 } }));
    const values = profileValues(old);
    expect(values.bot).toBe("true");
    expect(values.birthday).toBe("/4/12");
    const next = JSON.parse(buildProfile(old, { ...values, bot: "false", birthday: "2000/4/12" }, 200).content);
    expect(next).toMatchObject({ name: "pe", bot: false, birthday: { year: 2000, month: 4, day: 12 } });
    expect(JSON.parse(buildProfile(old, { ...values, birthday: "" }, 200).content).birthday).toBeUndefined();
    expect(JSON.parse(buildProfile(old, values, 200).content)).toMatchObject({ bot: true, birthday: { month: 4, day: 12 } });
    expect(parseBirthday("2000//")).toEqual({ year: 2000 });
    expect(() => parseBirthday("2/30/1")).toThrow();
    expect(() => parseBirthday("/2/30")).toThrow();
    expect(birthdayText({ year: 1999 })).toBe("1999//");
    expect(profileProblem({ ...values, birthday: "4月12日" })).toMatch(/年\/月\/日/);
  });
});
