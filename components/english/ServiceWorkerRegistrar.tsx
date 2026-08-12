"use client";

import { useEffect } from "react";

/**
 * /english 専用の Service Worker を登録する。画面には何も描かない。
 *
 * 開発中は登録しない。`next dev` の /_next/static はハッシュが固定されず
 * HMR も走るので、キャッシュ優先で掴むと更新が反映されなくなる。
 * さらに、いったん本番ビルドを localhost で動かして登録が残ったまま
 * `next dev` に戻ると同じ罠を踏むので、開発時は逆に登録を外しにいく。
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) {
          if (reg.active?.scriptURL.endsWith("/english-sw.js")) reg.unregister();
        }
      });
      return;
    }

    // スクリプトは public 直下だが、スコープは /english に絞る
    // (同じオリジンに別のアプリが同居しているため。詳細は english-sw.js の冒頭)
    navigator.serviceWorker
      .register("/english-sw.js", { scope: "/english" })
      .catch(() => {
        // 登録できなくてもアプリはそのまま動く (オフラインにならないだけ)
      });
  }, []);

  return null;
}
