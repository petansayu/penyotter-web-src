/**
 * PWA の Service Worker（ビルドしたものだけ。開発用のサーバーでは登録しない）。新しい版が入ったら updateReady に
 * して、画面の上に「新しい版があります」を出す。
 */
class Pwa {
  updateReady = $state(false);

  register() {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").then((registration) => {
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            // 前の版が動いているところに新しい版が入ったときだけ知らせる（初めて入れたときは知らせない）
            if (worker.state === "activated" && navigator.serviceWorker.controller) this.updateReady = true;
          });
        });
      }).catch(() => {
        // 登録できなくても、ふつうのページとして動く
      });
    });
  }

  reload() {
    location.reload();
  }
}

export const pwa = new Pwa();
