/** 今の時刻（1 分ごとに進む）。「◯分前」を出し直すために読む（Android 版の LocalMinute）。 */
class Clock {
  now = $state(Date.now());

  constructor() {
    setInterval(() => (this.now = Date.now()), 60_000);
  }
}

export const clock = new Clock();
