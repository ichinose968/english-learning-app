"use client";

import { useEffect, useRef } from "react";
import { pushBackHandler } from "@/lib/english/platform";

/**
 * Android の戻るボタンで閉じられるようにする。
 *
 * `open` が true のあいだだけ登録し、false になったら外す。**登録順で後のものが勝つ**ので、
 * 長文シートの上に単語詳細を重ねているような場面でも、手前から順に閉じる。
 *
 * Web と iOS では何も起きない（登録するだけで、呼ばれる口が無い）。
 * ネイティブの受け口は `startBackButtonBridge()` が1つだけ作る。
 *
 * **閉じ方は ref 越しに読む。** 毎レンダー新しい関数が来るので、
 * それを依存配列に入れると1レンダーごとに登録し直すことになる。
 * ref なら登録は `open` が変わったときだけで、呼ばれるのは常に最新の関数。
 */
export function useAndroidBack(open: boolean, onBack: () => void) {
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  });
  useEffect(() => {
    if (!open) return;
    return pushBackHandler(() => onBackRef.current());
  }, [open]);
}
