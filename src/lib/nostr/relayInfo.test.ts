import { describe, expect, it } from "vitest";
import { parseRelayDetails } from "./relayInfo";

describe("リレーの情報（NIP-11）", () => {
  it("リンクは https だけ、NIP は数に、料金と制限を読む", () => {
    const details = parseRelayDetails("wss://r.test", {
      name: "テスト", icon: "http://x/i.png", banner: "https://x/b.png", supported_nips: [1, "11", 99999, 1],
      limitation: { auth_required: true, max_subscriptions: 20, min_pow_difficulty: -1 },
      fees: { admission: [{ amount: 1000, unit: "sats" }], subscription: [{ amount: 5, period: 2592000 }] },
      software: "git+https://github.com/x/y", terms_of_service: "javascript:alert(1)", privacy_policy: "https://x/p",
    });
    expect(details).toMatchObject({ name: "テスト", icon: undefined, banner: "https://x/b.png", supportedNips: [1, 11], authRequired: true, software: "https://github.com/x/y" });
    expect(details.limits).toEqual([{ label: "購読数の上限", value: 20 }]);
    expect(details.fees).toEqual(["入会: 1000 sats", "利用: 5 msats・1か月ごと"]);
    expect(details.links).toEqual([{ label: "プライバシー", url: "https://x/p" }]);
  });
});
