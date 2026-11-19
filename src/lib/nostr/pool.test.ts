import { describe, expect, it } from "vitest";
import { skippedSubscription } from "./pool";

describe("大きすぎるメッセージ", () => {
  it("EVENT なら購読の ID を読み、接続は切らずにそのイベントだけ飛ばす（Android 版の RelayMessage.Skipped と同じ）", () => {
    expect(skippedSubscription(`["EVENT","sub-12",{"id":"${"a".repeat(300000)}"}]`)).toBe("sub-12");
    expect(skippedSubscription(` [ "EVENT" , "x" ,{}]`)).toBe("x");
    expect(skippedSubscription(`["NOTICE","長い"]`)).toBeNull();
  });
});
