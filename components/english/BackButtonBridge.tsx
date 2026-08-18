"use client";

import { useEffect } from "react";
import { startBackButtonBridge } from "@/lib/english/platform";

/**
 * Android の戻るボタンの受け口を1つだけ作る。描画はしない。
 *
 * 各画面は `useAndroidBack(open, close)` で「開いているあいだの閉じ方」を登録し、
 * ここはその一番手前のものを呼ぶだけ。**何も開いていなければアプリを終了する**
 * （それが Android の既定の振る舞い）。
 *
 * Web と開発では `window.Capacitor` が無いので何もしない。
 */
export function BackButtonBridge() {
  useEffect(() => startBackButtonBridge(), []);
  return null;
}
