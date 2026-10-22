import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { finalizeEvent, generateSecretKey } from "nostr-tools";
import { startTestRelay } from "../../../scripts/test-relay.mjs";
import { publish, pool } from "./pool";

/** リレーの認証（NIP-42）。手元のテスト用リレーを、認証を求める動きで使う。 */
describe("リレーの認証", () => {
  let relay: { url: string; close: () => Promise<void>; ready: Promise<void>; events: Map<string, unknown> };
  const secret = generateSecretKey();
  const sign = (url: string, challenge: string) =>
    Promise.resolve(finalizeEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [["relay", url], ["challenge", challenge]], content: "" }, secret));
  const post = () => finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: "認証のテスト" }, secret);

  beforeAll(async () => {
    relay = startTestRelay(17779, { auth: true });
    await relay.ready;
  });
  afterAll(() => relay.close());
  afterEach(() => {
    pool.authenticator = null;
  });

  it("答えないときは、断られたまま", async () => {
    const result = await publish([relay.url], post());
    expect(result.accepted).toBe(0);
    expect(result.relays.get(relay.url)?.message).toMatch(/^auth-required:/);
  });

  it("答えるときは、認証してから送り直して受理される。読むこともできる", async () => {
    pool.authenticator = sign;
    const event = post();
    const result = await publish([relay.url], event);
    expect(result.accepted).toBe(1);
    expect(relay.events.has(event.id)).toBe(true);
    const fetched = await pool.fetch([relay.url], [{ ids: [event.id] }]);
    expect(fetched.events.has(event.id)).toBe(true);
  }, 20_000);
});
