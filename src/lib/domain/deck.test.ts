import { describe, expect, it } from "vitest";
import { addColumn, defaultColumns, MAX_COLUMNS, moveColumn, moveColumnTo, parseColumns, parseListAddress, parseRelayParam, passesFilter, removeColumn, updateColumn } from "./deck";

const A = "a".repeat(64);

describe("カラムの並び", () => {
  it("最初はホームと通知", () => {
    expect(defaultColumns().map((c) => c.type)).toEqual(["home", "notifications"]);
  });

  it("保存したものを読む。壊れたものは捨てる", () => {
    const columns = parseColumns([
      { id: "x", type: "search", param: "#nostr", width: "wide" },
      { id: "x", type: "profile", param: A },
      { type: "home", width: "widest" },
      { type: "home", width: "huge" },
      { type: "profile", param: "short" },
      { type: "unknown" },
      "壊れた",
    ]);
    expect(columns.map((c) => [c.type, c.param, c.width])).toEqual([
      ["search", "#nostr", "wide"],
      ["profile", A, "normal"],
      ["home", undefined, "widest"],
      ["home", undefined, "normal"],
    ]);
    expect(new Set(columns.map((c) => c.id)).size).toBe(4);
    expect(parseColumns(null).map((c) => c.type)).toEqual(["home", "notifications"]);
    expect(parseColumns([]).map((c) => c.type)).toEqual(["home", "notifications"]);
  });

  it("足す・動かす・幅・消す", () => {
    let columns = defaultColumns();
    columns = addColumn(columns, "global");
    columns = addColumn(columns, "profile", "bad");
    expect(columns.map((c) => c.type)).toEqual(["home", "notifications", "global"]);
    const global = columns[2].id;
    columns = moveColumn(columns, global, -1);
    expect(columns.map((c) => c.type)).toEqual(["home", "global", "notifications"]);
    expect(moveColumn(columns, columns[0].id, -1)).toBe(columns);
    columns = updateColumn(columns, global, { width: "narrow" });
    expect(columns[1].width).toBe("narrow");
    columns = removeColumn(columns, global);
    expect(columns.map((c) => c.type)).toEqual(["home", "notifications"]);
    let many = defaultColumns();
    many = addColumn(addColumn(many, "global"), "search", "nostr");
    const [home, notif, glob, search] = many.map((c) => c.id);
    expect(moveColumnTo(many, search, 0).map((c) => c.id)).toEqual([search, home, notif, glob]);
    expect(moveColumnTo(many, home, 9).map((c) => c.id)).toEqual([notif, glob, search, home]);
    expect(moveColumnTo(many, notif, 1)).toBe(many);
    for (let i = 0; i < 20; i++) many = addColumn(many, "global");
    expect(many).toHaveLength(MAX_COLUMNS);
  });
});

describe("列の種類と絞り込み", () => {
  it("種類ごとに param を確かめる", () => {
    const columns = parseColumns([
      { type: "relays", param: "wss://yabu.me/ wss://yabu.me ws://bad.example https://no.example, wss://r.kojira.io" },
      { type: "relays", param: "ws://only-bad.example" },
      { type: "posts", param: A },
      { type: "reactions", param: "npub..." },
      { type: "list", param: `30000:${A}:friends` },
      { type: "list", param: `30001:${A}:x` },
      { type: "home", name: "  ともだち  ", filter: { include: "猫", japanese: true, hideReposts: false, extra: 1 } },
      { type: "notifications", filter: { include: "猫" } },
    ]);
    expect(columns.map((c) => [c.type, c.param])).toEqual([
      ["relays", "wss://yabu.me wss://r.kojira.io"],
      ["posts", A],
      ["list", `30000:${A}:friends`],
      ["home", undefined],
      ["notifications", undefined],
    ]);
    expect(columns[3]).toMatchObject({ name: "ともだち", filter: { include: "猫", japanese: true } });
    expect(columns[3].filter).not.toHaveProperty("hideReposts");
    expect(columns[4].filter).toBeUndefined();
    expect(parseListAddress(`30000:${A}:a:b`)).toEqual({ pubkey: A, identifier: "a:b" });
    expect(parseRelayParam("wss://a.example\nwss://b.example")).toEqual(["wss://a.example", "wss://b.example"]);
  });

  it("名前・絞り込みを変え、合わない param は変えない", () => {
    let columns = addColumn([], "relays", "wss://yabu.me", { name: "日本語", filter: { japanese: true } });
    const id = columns[0].id;
    expect(columns[0]).toMatchObject({ name: "日本語", filter: { japanese: true } });
    expect(updateColumn(columns, id, { param: "nope" })[0].param).toBe("wss://yabu.me");
    columns = updateColumn(columns, id, { name: "", filter: {} });
    expect(columns[0].name).toBeUndefined();
    expect(columns[0].filter).toBeUndefined();
    expect(addColumn([], "posts", "bad")).toEqual([]);
  });

  it("絞り込み", () => {
    expect(passesFilter(undefined, "なんでも", true)).toBe(true);
    expect(passesFilter({ hideReposts: true }, "a", true)).toBe(false);
    expect(passesFilter({ japanese: true }, "hello", false)).toBe(false);
    expect(passesFilter({ japanese: true }, "漢字だけ", false)).toBe(true);
    expect(passesFilter({ japanese: true }, "漢字", false)).toBe(false);
    expect(passesFilter({ japanese: true }, "ｶﾀｶﾅ", false)).toBe(true);
    expect(passesFilter({ include: "nostr 猫" }, "NOSTR はいいぞ", false)).toBe(true);
    expect(passesFilter({ include: "ｎｏｓｔｒ" }, "nostr", false)).toBe(true);
    expect(passesFilter({ include: "犬" }, "猫", false)).toBe(false);
    expect(passesFilter({ exclude: "広告　宣伝" }, "これは宣伝です", false)).toBe(false);
    expect(passesFilter({ exclude: "広告" }, "ふつう", false)).toBe(true);
  });
});
