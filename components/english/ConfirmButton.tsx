"use client";

import { useEffect, useState } from "react";

// 取り消せない操作の確認。`window.confirm` は環境によっては
// 何も表示せず false を返す (ホーム画面から起動した場合など) ので、画面内で二段階にする。
// 1回目のタップで「本当に？」に変わり、2回目で実行する
export function ConfirmButton({
  label,
  question,
  confirmLabel = "実行",
  icon,
  disabled,
  onConfirm,
  className,
}: {
  label: string;
  question: string;
  confirmLabel?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  onConfirm: () => void;
  className?: string;
}) {
  const [asking, setAsking] = useState(false);

  // 押しっぱなしで放置されないよう、少ししたら元に戻す
  useEffect(() => {
    if (!asking) return;
    const id = window.setTimeout(() => setAsking(false), 6000);
    return () => window.clearTimeout(id);
  }, [asking]);

  if (asking && !disabled) {
    return (
      <span className="flex items-center gap-2">
        <span className="text-xs text-zinc-500">{question}</span>
        <button
          onClick={() => {
            setAsking(false);
            onConfirm();
          }}
          className="rounded-full border border-red-500 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-500"
        >
          {confirmLabel}
        </button>
        <button
          onClick={() => setAsking(false)}
          className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs text-zinc-500 dark:border-zinc-700"
        >
          やめる
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setAsking(true)}
      disabled={disabled}
      className={
        className ??
        "flex items-center gap-1.5 rounded-full border border-zinc-200 px-4 py-1.5 text-xs text-zinc-500 transition-colors hover:border-red-500/60 hover:text-red-500 disabled:opacity-30 dark:border-zinc-700"
      }
    >
      {icon}
      {label}
    </button>
  );
}
