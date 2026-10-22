import { acceptable, type Event, type Filter } from "./events";
import { TEST_RELAY } from "./testMode";

/**
 * リレーとの接続（Android 版の技術資料 4.2・4.3）。1 つのリレーにつき WebSocket は 1 本で、REQ は相乗りする。
 * AUTH（NIP-42）には、RelayPool.authenticator が設定されているとき（設定でオンにして、署名できるとき）だけ答える
 * （技術資料 4.2.2）。
 */

const CONNECT_TIMEOUT = 10_000;
const IDLE_CLOSE = 60_000;
const UNAVAILABLE_FOR = 3 * 60_000;
const MAX_MESSAGE = 256_000;
const ONE_SHOT_LIMIT = 9_000;
/**
 * 1 本の接続に同時に送る REQ の数。残りは順番待ちにして、前のものが閉じたら送る（Web 版だけ。多くのリレーは
 * 同時購読数に上限があり、超えると答えなくなるため）。
 */
const MAX_ACTIVE = 10;

interface SubHandlers {
  filters: Filter[];
  /** REQ を送ったか（順番待ちのものは false）。 */
  sent?: boolean;
  /** 認証が要ると断られ、認証が通るのを待っている。 */
  waitingAuth?: boolean;
  onEvent: (event: Event) => void;
  onEose?: () => void;
  onClosed?: (reason: string) => void;
}

let nextId = 0;
const subId = () => `p${(nextId++).toString(36)}`;

class RelayConnection {
  private ws: WebSocket | null = null;
  private open = false;
  private readonly subs = new Map<string, SubHandlers>();
  /** 送った EVENT のうち、OK を待っているもの。つなぎ直したら送り直す。 */
  private readonly pending = new Map<string, { event: Event; done: (accepted: boolean, message: string) => void; waitingAuth?: boolean }>();
  /** リレーから届いた AUTH の challenge。 */
  private challenge: string | null = null;
  /** 送った AUTH のイベントの ID（OK を待っている）。 */
  private authEventId: string | null = null;
  private authing = false;
  private authed = false;
  private retries = 0;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(readonly url: string, private readonly pool: RelayPool) {}

  /** REQ を送る（または順番待ちに入れる）。close で閉じ、sent でもう送ったかを返す。 */
  req(filters: Filter[], handlers: Omit<SubHandlers, "filters" | "sent">): { close: () => void; sent: () => boolean } {
    const id = subId();
    const sub: SubHandlers = { filters, ...handlers, sent: false };
    this.subs.set(id, sub);
    clearTimeout(this.idleTimer);
    if (this.open) this.pump();
    else this.connect();
    return {
      close: () => {
        if (!this.subs.delete(id)) return;
        if (this.open && sub.sent) this.send(["CLOSE", id]);
        this.pump();
        this.scheduleIdle();
      },
      sent: () => sub.sent === true,
    };
  }

  /** EVENT を送る。OK が届いたら done を呼ぶ。返した関数で待つのをやめる。 */
  publish(event: Event, done: (accepted: boolean, message: string) => void): () => void {
    this.pending.set(event.id, { event, done });
    clearTimeout(this.idleTimer);
    if (this.open) this.send(["EVENT", event]);
    else this.connect();
    return () => {
      this.pending.delete(event.id);
      this.scheduleIdle();
    };
  }

  /** 順番待ちの REQ を、同時に MAX_ACTIVE 件までになるよう送る。 */
  private pump() {
    if (!this.open) return;
    let active = 0;
    for (const sub of this.subs.values()) if (sub.sent) active++;
    for (const [id, sub] of this.subs) {
      if (active >= MAX_ACTIVE) break;
      if (sub.sent || sub.waitingAuth) continue;
      sub.sent = true;
      active++;
      this.send(["REQ", id, ...sub.filters]);
    }
  }

  private connect() {
    if (this.ws) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.failed();
      return;
    }
    this.ws = ws;
    const timer = setTimeout(() => ws.close(), CONNECT_TIMEOUT);
    ws.onopen = () => {
      clearTimeout(timer);
      this.open = true;
      this.retries = 0;
      this.failures = 0;
      // 認証は接続ごと。つなぎ直したら、もう一度 AUTH が届くのを待つ
      this.challenge = null;
      this.authEventId = null;
      this.authing = false;
      this.authed = false;
      for (const sub of this.subs.values()) {
        sub.sent = false;
        sub.waitingAuth = false;
      }
      for (const waiting of this.pending.values()) waiting.waitingAuth = false;
      this.pump();
      for (const { event } of this.pending.values()) this.send(["EVENT", event]);
      this.scheduleIdle();
    };
    ws.onmessage = (message) => this.receive(message.data);
    ws.onclose = () => {
      clearTimeout(timer);
      const wasOpen = this.open;
      this.ws = null;
      this.open = false;
      if (!wasOpen) this.failed();
      if (this.subs.size > 0 || this.pending.size > 0) this.retry();
    };
    ws.onerror = () => ws.close();
  }

  /** 2 回続けて接続に失敗したら、3 分間「使えない」とみなす。 */
  private failed() {
    if (++this.failures >= 2) this.pool.markUnavailable(this.url);
  }

  /** 1 秒・2 秒・4 秒…と倍にしながら（32 秒まで）、0〜0.5 秒をランダムに足して、つなぎ直す。 */
  private retry() {
    clearTimeout(this.retryTimer);
    const delay = Math.min(32_000, 1000 * 2 ** this.retries++) + Math.random() * 500;
    this.retryTimer = setTimeout(() => {
      if (this.subs.size > 0 || this.pending.size > 0) this.connect();
    }, delay);
  }

  /** 使われなくなった接続は 60 秒残してから閉じる。 */
  private scheduleIdle() {
    clearTimeout(this.idleTimer);
    if (this.subs.size > 0 || this.pending.size > 0) return;
    this.idleTimer = setTimeout(() => {
      if (this.subs.size === 0 && this.pending.size === 0) this.ws?.close();
    }, IDLE_CLOSE);
  }

  private send(message: unknown[]) {
    this.ws?.send(JSON.stringify(message));
  }

  /** 認証が要ると断られたものを、認証が通るまで取っておくか。 */
  private canWaitForAuth(reason: string) {
    return reason.startsWith("auth-required:") && !this.authed && this.pool.authenticator !== null;
  }

  /** AUTH の challenge に答える（kind 22242 に署名して送る）。 */
  private authenticate() {
    const challenge = this.challenge;
    const authenticator = this.pool.authenticator;
    if (!challenge || !authenticator || this.authing || this.authed) return;
    this.authing = true;
    authenticator(this.url, challenge).then((event) => {
      if (!event || !this.open || this.challenge !== challenge) {
        this.authing = false;
        return;
      }
      this.authEventId = event.id;
      this.send(["AUTH", event]);
    }).catch(() => {
      this.authing = false;
    });
  }

  /** 認証が通ったら、待っていた REQ と EVENT を送り直す。 */
  private authenticated() {
    this.authed = true;
    this.authing = false;
    for (const [id, sub] of this.subs) {
      if (sub.waitingAuth) sub.waitingAuth = false;
      else if (sub.sent) this.send(["REQ", id, ...sub.filters]);
    }
    this.pump();
    for (const waiting of this.pending.values()) {
      waiting.waitingAuth = false;
      this.send(["EVENT", waiting.event]);
    }
  }

  private receive(data: unknown) {
    if (typeof data !== "string") return;
    if (data.length > MAX_MESSAGE) {
      this.ws?.close();
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (!Array.isArray(message) || typeof message[1] !== "string") return;
    if (message[0] === "AUTH") {
      // challenge が空か 1,024 文字を超えるときは答えない
      const challenge = message[1];
      if (!challenge || challenge.length > 1024) return;
      this.challenge = challenge;
      this.authed = false;
      this.authenticate();
      return;
    }
    if (message[0] === "OK") {
      const reason = typeof message[3] === "string" ? message[3].slice(0, 300) : "";
      if (message[1] === this.authEventId) {
        this.authEventId = null;
        if (message[2] === true) this.authenticated();
        else this.authing = false;
        return;
      }
      const waiting = this.pending.get(message[1]);
      if (!waiting) return;
      if (message[2] !== true && this.canWaitForAuth(reason)) {
        waiting.waitingAuth = true;
        this.authenticate();
        return;
      }
      this.pending.delete(message[1]);
      waiting.done(message[2] === true, reason);
      this.scheduleIdle();
      return;
    }
    const sub = this.subs.get(message[1]);
    switch (message[0]) {
      case "EVENT":
        if (sub && acceptable(message[2], sub.filters)) sub.onEvent(message[2]);
        break;
      case "EOSE":
        sub?.onEose?.();
        break;
      case "CLOSED":
        if (sub && this.canWaitForAuth(typeof message[2] === "string" ? message[2] : "")) {
          sub.sent = false;
          sub.waitingAuth = true;
          this.authenticate();
          break;
        }
        if (sub) {
          this.subs.delete(message[1]);
          sub.onClosed?.(typeof message[2] === "string" ? message[2] : "");
          this.pump();
          this.scheduleIdle();
        }
        break;
    }
  }
}

export interface Fetched {
  /** ID ごとのイベントと、それが届いたリレー。 */
  events: Map<string, { event: Event; relays: Set<string> }>;
  /** 送ったすべてのリレーが EOSE を返したか、打ち切ったときに半分以上が返していたか（技術資料 4.3）。 */
  complete: boolean;
}

export class RelayPool {
  private readonly connections = new Map<string, RelayConnection>();
  /**
   * AUTH（NIP-42）に答える署名役。リレーの URL と challenge から kind 22242 の署名済みイベントを作る。null なら
   * 答えない（見るだけのときと、設定でオフのとき）。
   */
  authenticator: ((url: string, challenge: string) => Promise<Event | null>) | null = null;
  private readonly unavailable = new Map<string, number>();

  connection(url: string): RelayConnection {
    return this.relay(url);
  }

  private relay(url: string): RelayConnection {
    let connection = this.connections.get(url);
    if (!connection) {
      connection = new RelayConnection(url, this);
      this.connections.set(url, connection);
    }
    return connection;
  }

  markUnavailable(url: string) {
    this.unavailable.set(url, Date.now() + UNAVAILABLE_FOR);
  }

  available(url: string): boolean {
    const until = this.unavailable.get(url);
    if (until === undefined) return true;
    if (until > Date.now()) return false;
    this.unavailable.delete(url);
    return true;
  }

  /**
   * 一回きりの取得（技術資料 4.3）。使えないリレーには送らない。すべて EOSE を返したら終わり、最初の EOSE から
   * それまでにかかった時間（少なくとも 1 秒）待って残りを打ち切る。全体は limit（既定 9 秒）で打ち切る。
   */
  fetch(relays: string[], filters: Filter[], options: { limit?: number; onEvent?: (event: Event, relay: string) => void } = {}): Promise<Fetched> {
    const targets = relays.filter((url) => this.available(url));
    const events: Fetched["events"] = new Map();
    if (targets.length === 0 || filters.length === 0) return Promise.resolve({ events, complete: false });
    const limit = options.limit ?? ONE_SHOT_LIMIT;
    const started = Date.now();
    return new Promise((resolve) => {
      const done = new Set<string>();
      const eosed = new Set<string>();
      const heard = new Set<string>();
      const requests = new Map<string, { close: () => void; sent: () => boolean }>();
      let cutoff: ReturnType<typeof setTimeout> | undefined;
      let finished = false;
      const finish = (cut: boolean, timedOut = false) => {
        if (finished) return;
        finished = true;
        clearTimeout(cutoff);
        clearTimeout(overall);
        // 順番待ちのまま打ち切られたリレーは、答えなかったとはみなさない
        const unsent = new Set([...requests].filter(([, request]) => !request.sent()).map(([url]) => url));
        requests.forEach((request) => request.close());
        // 「使えない」とみなすのは、9 秒の打ち切りまで EOSE もイベントも返さなかったリレーだけ（技術資料 4.2）。
        // 最初の EOSE のあとの打ち切りや、短い打ち切り（アウトボックスの 4 秒）で答えていないだけのリレーは外さない
        if (timedOut && limit >= ONE_SHOT_LIMIT) for (const url of targets) if (!heard.has(url) && !unsent.has(url)) this.markUnavailable(url);
        const complete = eosed.size === targets.length || (cut && eosed.size * 2 >= targets.length);
        resolve({ events, complete });
      };
      const overall = setTimeout(() => finish(false, true), limit);
      const settle = (url: string, eose: boolean) => {
        if (done.has(url)) return;
        done.add(url);
        heard.add(url);
        if (eose) eosed.add(url);
        if (done.size === targets.length) return finish(false);
        if (eose && cutoff === undefined) {
          const waited = Math.max(1000, Date.now() - started);
          cutoff = setTimeout(() => finish(true), waited);
        }
      };
      for (const url of targets) {
        requests.set(url, this.relay(url).req(filters, {
          onEvent: (event) => {
            heard.add(url);
            const entry = events.get(event.id);
            if (entry) entry.relays.add(url);
            else events.set(event.id, { event, relays: new Set([url]) });
            options.onEvent?.(event, url);
          },
          onEose: () => settle(url, true),
          onClosed: () => settle(url, false),
        }));
      }
    });
  }

  /** 購読。返した関数で止める。 */
  subscribe(relays: string[], filters: Filter[], onEvent: (event: Event, relay: string) => void): () => void {
    if (filters.length === 0) return () => {};
    const requests = relays.map((url) => this.relay(url).req(filters, { onEvent: (event) => onEvent(event, url) }));
    return () => requests.forEach((request) => request.close());
  }
}

export const pool = new RelayPool();

export type PublishState = "waiting" | "accepted" | "rejected" | "unknown";
export interface PublishResult {
  /** リレーごとの結果。 */
  relays: Map<string, { state: PublishState; message: string }>;
  accepted: number;
}

const PUBLISH_LIMIT = 12_000;

/**
 * イベントを送る（技術資料 4.5）。どれか 1 つが受理するか、すべてが答えるか、12 秒たつと、その時点の結果を返す。
 * 受理されたあとも答えていないリレーがあれば、さらに最大 12 秒待ち、onUpdate で結果を直す。答えなかったリレーは
 * 「確認できない」。テストモードでは、手元のテスト用リレー以外へは送らない。
 */
export function publish(relays: string[], event: Event, onUpdate?: (result: PublishResult) => void): Promise<PublishResult> {
  const targets = [...new Set(TEST_RELAY ? relays.filter((url) => url === TEST_RELAY) : relays)];
  const states = new Map(targets.map((url) => [url, { state: "waiting" as PublishState, message: "" }]));
  const snapshot = (): PublishResult => ({
    relays: new Map([...states].map(([url, value]) => [url, { ...value }])),
    accepted: [...states.values()].filter((value) => value.state === "accepted").length,
  });
  return new Promise((resolve) => {
    if (targets.length === 0) return resolve(snapshot());
    let returned = false;
    const stops: (() => void)[] = [];
    const finishAll = () => {
      clearTimeout(firstTimer);
      clearTimeout(lastTimer);
      stops.forEach((stop) => stop());
      for (const value of states.values()) if (value.state === "waiting") value.state = "unknown";
      if (!returned) {
        returned = true;
        resolve(snapshot());
      } else onUpdate?.(snapshot());
    };
    const check = () => {
      const values = [...states.values()];
      const allAnswered = values.every((value) => value.state !== "waiting");
      if (allAnswered) return finishAll();
      if (!returned && values.some((value) => value.state === "accepted")) {
        returned = true;
        resolve(snapshot());
        clearTimeout(firstTimer);
        lastTimer = setTimeout(finishAll, PUBLISH_LIMIT);
      } else if (returned) onUpdate?.(snapshot());
    };
    const firstTimer = setTimeout(finishAll, PUBLISH_LIMIT);
    let lastTimer: ReturnType<typeof setTimeout> | undefined;
    for (const url of targets) {
      stops.push(pool.connection(url).publish(event, (accepted, message) => {
        states.set(url, { state: accepted ? "accepted" : "rejected", message });
        check();
      }));
    }
  });
}

/** 結果のイベントを新しい順の配列にする。 */
export function eventsOf(fetched: Fetched): Event[] {
  return [...fetched.events.values()].map((entry) => entry.event);
}

/** 複数の取得の結果を合わせる。 */
export function merge(results: Fetched[]): Fetched {
  const events: Fetched["events"] = new Map();
  for (const result of results) {
    for (const [id, entry] of result.events) {
      const existing = events.get(id);
      if (existing) entry.relays.forEach((url) => existing.relays.add(url));
      else events.set(id, { event: entry.event, relays: new Set(entry.relays) });
    }
  }
  return { events, complete: results.length > 0 && results.every((result) => result.complete) };
}

export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
