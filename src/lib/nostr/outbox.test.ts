import { describe, expect, it, vi } from "vitest";

// relayLists はブラウザの保存分を読むので、先に代わりを置く
vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
const { planAuthors, relayLists } = await import("./outbox");

describe("何人分かを読むときのリレーの選び方（4.4.3）", () => {
  const people = Array.from({ length: 13 }, (_, i) => i.toString(16).padStart(64, "0"));
  const me = "f".repeat(64);
  // 13 人がそれぞれ別のリレー 2 つ（人数の多いリレー 12 件に入らないものが出る）
  for (const [i, p] of people.entries()) relayLists.set(p, { read: [], write: [`wss://r${i}.test`, "wss://popular.test"] });
  relayLists.set(me, { read: [], write: ["wss://mine.test"] });

  it("人数の多いリレーから 12 件。自分の書き込みリレーは人数が少なくて枠に入らない", () => {
    const plans = planAuthors([...people, me]);
    expect(new Set(plans.map((p) => p.relay)).size).toBe(12);
    expect(plans.some((p) => p.relay === "wss://mine.test")).toBe(false);
  });

  it("pinned の人は、枠の外でもそのリレーへ問い合わせる", () => {
    const plans = planAuthors([...people, me], [{ author: me, relays: ["wss://mine.test", "wss://popular.test"] }]);
    expect(plans).toContainEqual({ relay: "wss://mine.test", authors: [me] });
    // 枠に入っているリレーでも、その人が入っていなければ足す（1 回だけ）
    expect(plans.filter((p) => p.relay === "wss://popular.test" && p.authors.includes(me))).toHaveLength(1);
    expect(planAuthors([...people, me], [{ author: me, relays: ["wss://mine.test"] }, { author: me, relays: ["wss://mine.test"] }]).filter((p) => p.relay === "wss://mine.test")).toHaveLength(1);
  });
});
