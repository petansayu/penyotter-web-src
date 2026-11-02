import { SvelteMap } from "svelte/reactivity";
import { addressParts, AWARD, badgeHolders, badgeOf, badgePairs, createdBadges, DEFINITION, LEGACY_PROFILE_BADGES, newestDefinitions, PROFILE_BADGES, profileBadgeList, receivedBadges, resolveBadges, type Badge, type ReceivedBadge } from "../domain/badges";
import type { Event } from "../nostr/events";
import { fetchFromAuthor } from "../nostr/outbox";
import { eventsOf, pool } from "../nostr/pool";
import { relaySet } from "../nostr/relayUrl";
import { lists } from "./lists.svelte";
import { viewer } from "./viewer.svelte";

/** 定義（kind 30009）を、作った人ごとにその人の書き込みリレーと読み込みリレーから読む。 */
async function fetchDefinitions(addresses: string[]): Promise<Event[]> {
  const byIssuer = new Map<string, string[]>();
  for (const address of addresses) {
    const parts = addressParts(address);
    if (parts) byIssuer.set(parts.issuer, [...(byIssuer.get(parts.issuer) ?? []), parts.identifier]);
  }
  const found: Event[] = [];
  await Promise.all([...byIssuer].map(async ([issuer, identifiers]) => {
    found.push(...eventsOf(await fetchFromAuthor(issuer, [{ kinds: [DEFINITION], authors: [issuer], "#d": [...new Set(identifiers)] }], viewer.readRelays)));
  }));
  return found;
}

/**
 * 自分のバッジ（NIP-58、Android 版の BadgesController）。shown はプロフィールに飾っているもの、received はもらった
 * もの（授与した人自身のバッジだけ）。order は並べ替え中の一覧（定義のアドレス）で、save で kind 10008 を公開する。
 * kept は、定義を読めずに出していないが、保存するときに残す項目。通知のカードに出す定義は definitions に覚える。
 */
class Badges {
  definitions = new SvelteMap<string, Badge>();
  private requested = new Set<string>();

  loading = $state(false);
  loaded = $state(false);
  saving = $state(false);
  message = $state<string | null>(null);
  shown = $state<ReceivedBadge[]>([]);
  received = $state<ReceivedBadge[]>([]);
  order = $state<string[]>([]);
  kept = $state<[string, string][]>([]);
  private owner: string | null = null;

  get changed() {
    return this.order.join("\n") !== this.shown.map((b) => b.badge.address).join("\n");
  }

  /** 定義のアドレスから、すべての分かっているバッジ（飾っているものの授与を先に）。 */
  get byAddress(): Map<string, ReceivedBadge> {
    return new Map([...this.received, ...this.shown].map((b) => [b.badge.address, b]));
  }

  /** 通知のカードに出すバッジの定義を読む（まだ読んでいないものだけ）。 */
  request(addresses: string[]) {
    const wanted = addresses.filter((a) => !this.requested.has(a));
    if (wanted.length === 0) return;
    for (const address of wanted) this.requested.add(address);
    void fetchDefinitions(wanted).then((events) => {
      for (const [address, definition] of newestDefinitions(events)) {
        const badge = wanted.includes(address) ? badgeOf(address, definition) : null;
        if (badge) this.definitions.set(address, badge);
      }
    });
  }

  /** バッジをもらった人（作った人の授与を、作った人のリレーから読む）。 */
  async holders(badge: Badge): Promise<string[]> {
    const fetched = await fetchFromAuthor(badge.issuer, [{ kinds: [AWARD], authors: [badge.issuer], "#a": [badge.address], limit: 500 }], viewer.readRelays);
    return badgeHolders(badge.address, eventsOf(fetched));
  }

  /** pubkey が作ったバッジ（プロフィールの「作ったバッジ」）。 */
  async created(pubkey: string, hints: string[] = []): Promise<Badge[]> {
    const fetched = await fetchFromAuthor(pubkey, [{ kinds: [DEFINITION], authors: [pubkey], limit: 60 }], viewer.readRelays, hints);
    return createdBadges(pubkey, eventsOf(fetched));
  }

  /** 自分のバッジを読む（見る人が変わったら読み直す）。 */
  async load(force = false) {
    const me = viewer.pubkey;
    if (!me || this.loading || (this.loaded && this.owner === me && !force)) return;
    if (this.owner !== me) {
      this.owner = me;
      this.shown = []; this.received = []; this.order = []; this.kept = []; this.loaded = false;
    }
    this.loading = true;
    this.message = null;
    try {
      const relays = relaySet([...viewer.readRelays, ...viewer.writeRelays]);
      const lists = await pool.fetch(relays, [{ kinds: [PROFILE_BADGES, LEGACY_PROFILE_BADGES], authors: [me], limit: 10 }]);
      if (!lists.complete) throw new Error("最新のプロフィールのバッジを取得できませんでした。少し待ってからもう一度試してください。");
      const list = profileBadgeList(eventsOf(lists), me);
      const pairs = list ? badgePairs(list) : [];
      // 授与は受け取る人の読み込みリレーへ届く。一覧が指す分は ID でも読む
      const awards = new Map<string, Event>();
      for (const event of eventsOf(await pool.fetch(viewer.readRelays, [{ kinds: [AWARD], "#p": [me], limit: 300 }]))) awards.set(event.id, event);
      if (pairs.length > 0) for (const event of eventsOf(await pool.fetch(relays, [{ kinds: [AWARD], ids: pairs.map((p) => p[1]) }]))) awards.set(event.id, event);
      const addresses = [...new Set([...[...awards.values()].flatMap((a) => (a.tags.filter((t) => t[0] === "a" && t[1]).map((t) => t[1]))), ...pairs.map((p) => p[0])])];
      const definitions = await fetchDefinitions(addresses);
      if (viewer.pubkey !== me) return;
      const resolved = new Map(resolveBadges(me, pairs, awards.values(), definitions).map((b) => [b.address, b]));
      this.shown = pairs.flatMap(([address, awardId]) => {
        const badge = resolved.get(address);
        return badge ? [{ badge, awardId, time: awards.get(awardId)?.created_at ?? 0 }] : [];
      }).filter((b, i, all) => all.findIndex((x) => x.badge.address === b.badge.address) === i);
      this.kept = pairs.filter(([address]) => !resolved.has(address));
      this.received = receivedBadges(me, awards.values(), definitions);
      this.order = this.shown.map((b) => b.badge.address);
      this.loaded = true;
    } catch (e) {
      this.message = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }

  show(address: string) {
    if (!this.order.includes(address)) this.order = [...this.order, address];
  }

  hide(address: string) {
    this.order = this.order.filter((a) => a !== address);
  }

  move(address: string, by: number) {
    const from = this.order.indexOf(address);
    const to = from + by;
    if (from < 0 || to < 0 || to >= this.order.length) return;
    const next = [...this.order];
    next.splice(to, 0, ...next.splice(from, 1));
    this.order = next;
  }

  revert() {
    this.order = this.shown.map((b) => b.badge.address);
  }

  /** 並べた順で kind 10008 を公開する（一覧の書き換えの手順を通す。結果はトースト）。 */
  async save() {
    if (!viewer.canSign || this.saving) return;
    const known = this.byAddress;
    const order = [...this.order];
    const pairs: [string, string][] = [...order.flatMap((address): [string, string][] => {
      const badge = known.get(address);
      return badge ? [[address, badge.awardId]] : [];
    }), ...this.kept];
    this.saving = true;
    try {
      if (await lists.setProfileBadges(pairs)) this.shown = order.flatMap((address) => known.get(address) ?? []);
    } finally {
      this.saving = false;
    }
  }
}

export const badges = new Badges();
