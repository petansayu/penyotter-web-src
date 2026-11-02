import { describe, expect, it, vi } from "vitest";
import { Feed, type FeedSource } from "./feed.svelte";
import type { Fetched } from "../nostr/pool";

vi.mock("./settings.svelte", () => ({ settings: {} }));

const empty: Fetched = { events: new Map(), complete: true };

/** page を手で終わらせられる読み先。live を呼んだ数と止めた数を数える。 */
function source() {
  const finish: (() => void)[] = [];
  const closed = vi.fn();
  const live = vi.fn(() => closed);
  const page = vi.fn(() => new Promise<Fetched>((resolve) => finish.push(() => resolve(empty))));
  return { feed: new Feed([1], { page, live } as FeedSource), finish, live, closed };
}

describe("Feed の購読", () => {
  it("読み終わったら購読する", async () => {
    const { feed, finish, live } = source();
    const started = feed.start();
    finish[0]();
    await started;
    expect(live).toHaveBeenCalledTimes(1);
  });

  it("読み込みの途中で止めたら購読を始めない", async () => {
    const { feed, finish, live } = source();
    const started = feed.start();
    feed.stop();
    finish[0]();
    await started;
    expect(live).not.toHaveBeenCalled();
  });

  it("読み込みの途中で始め直しても、購読は 1 つだけ", async () => {
    const { feed, finish, live, closed } = source();
    const first = feed.start();
    const second = feed.start();
    finish[0]();
    await Promise.all([first, second]);
    expect(live).toHaveBeenCalledTimes(1);
    feed.stop();
    expect(closed).toHaveBeenCalledTimes(1);
  });
});
