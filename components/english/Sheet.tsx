"use client";

import { useRef, useState } from "react";

// 画面の端から出てくるポップアップ。
// - side="top": ヘッダーの裏から降りてきて、ボトムナビの少し上で止まる (設定)
// - side="bottom": 画面の下から上がってきて、上のタブの少し下で止まる (スワイプ設定・会話設定)
// 閉じ方はどちらも3つ: 呼び出したボタンをもう一度押す / 端の方向へスワイプ / はみ出した余白をタップ。
//
// マウントは常に維持し、open の切り替えだけで出し入れする
// (出し入れのたびに作り直すと、開くアニメーションを1フレーム待つ必要が出るため)。
const CLOSE_THRESHOLD = 70; // この距離だけ引いたら閉じる

export function Sheet({
  side,
  open,
  onClose,
  top,
  bottom,
  children,
}: {
  side: "top" | "bottom";
  open: boolean;
  onClose: () => void;
  top: number | string;
  bottom: number | string;
  children: React.ReactNode;
}) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 閉じる向き。上のシートは上へ、下のシートは下へ引く
  const away = side === "top" ? -1 : 1;

  // 中身をスクロールできる場所から引き始めたときは、スクロールを優先する。
  // 引く向きの端まで読み切っているときと、つまみからの操作だけ閉じる動きにする
  const canDragFrom = (target: EventTarget | null) => {
    const sc = scrollRef.current;
    if (!sc || !(target instanceof Node) || !sc.contains(target)) return true;
    const rest = sc.scrollHeight - sc.clientHeight;
    if (rest <= 1) return true;
    return side === "top" ? sc.scrollTop >= rest - 1 : sc.scrollTop <= 1;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!open || !canDragFrom(e.target)) return;
    startY.current = e.clientY;
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startY.current === null) return;
    // 閉じる向きにだけ動かす (逆向きはすでに端まで来ている)
    const d = e.clientY - startY.current;
    setDragY(away < 0 ? Math.min(0, d) : Math.max(0, d));
  };
  const onPointerUp = () => {
    if (startY.current === null) return;
    startY.current = null;
    setDragging(false);
    if (Math.abs(dragY) > CLOSE_THRESHOLD && Math.sign(dragY) === away)
      onClose();
    setDragY(0);
  };

  const handle = (
    <div className="flex shrink-0 cursor-grab justify-center py-2.5">
      <span className="h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
    </div>
  );

  return (
    <>
      {/* ポップアップ以外の全面。どこを触っても閉じる。
          ボトムナビ (z-40) や呼び出したボタンより上に置くので、開いている間は
          それらへのタップも「閉じる」になる (呼び出したボタンを押したときと同じ結果) */}
      <div
        onClick={onClose}
        aria-hidden={!open}
        className={`fixed inset-0 z-[45] transition-opacity duration-300 ${
          open ? "bg-black/30 opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* スライド中にはみ出した部分を隠す枠 */}
      <div
        className="pointer-events-none fixed inset-x-0 z-50 overflow-hidden"
        style={{ top, bottom }}
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-hidden={!open}
          style={{
            transform: open
              ? `translateY(${dragY}px)`
              : `translateY(${away * 101}%)`,
            transition: dragging
              ? "none"
              : "transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
          className={`flex h-full w-full flex-col border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-black ${
            side === "top" ? "rounded-b-3xl border-b" : "rounded-t-3xl border-t"
          } ${open ? "pointer-events-auto" : "pointer-events-none"}`}
        >
          {side === "bottom" && handle}
          <div
            ref={scrollRef}
            // 下からのシートは画面下端まで伸びるので、ボトムナビのぶん余白を足す
            className={`flex-1 overflow-y-auto overscroll-contain px-4 py-4 ${
              side === "bottom" ? "pb-24" : ""
            }`}
          >
            {children}
          </div>
          {side === "top" && handle}
        </div>
      </div>
    </>
  );
}
