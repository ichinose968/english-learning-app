"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

// 折りたためる設定セクション。既定は閉じていて、下の教材が隠れないようにする。
// 閉じているあいだも今の選択が1行で分かるよう summary を出す
export function Collapsible({
  title,
  summary,
  children,
  // 「生成条件」の中に入れ子で並べるとき。枠と背景を外し、上の区切り線だけ残す
  nested = false,
  defaultOpen = false,
  accent = false,
  dataTour,
  open: forcedOpen,
}: {
  title: string;
  summary: string;
  children: React.ReactNode;
  nested?: boolean;
  defaultOpen?: boolean;
  // 外枠の見出し (生成条件) を目立たせる
  accent?: boolean;
  // チュートリアルのスポットライトの対象にするときの印
  dataTour?: string;
  // 外から開閉を決めたいとき。**渡したあいだは自前の状態より優先する**
  // (チュートリアルが「今説明している側だけ開く」ために使う)
  open?: boolean;
}) {
  const [innerOpen, setInnerOpen] = useState(defaultOpen);
  const open = forcedOpen ?? innerOpen;
  const setOpen = setInnerOpen;
  return (
    <div
      data-tour={dataTour}
      className={
        nested
          ? "border-t border-zinc-100 first:border-t-0 dark:border-zinc-800"
          : "overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black"
      }
    >
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-center gap-3 text-left ${
          nested ? "px-1 py-3" : "px-4 py-3"
        }`}
      >
        <span
          className={`shrink-0 text-sm ${
            accent ? "font-bold text-[#4A99EA]" : "font-medium"
          }`}
        >
          {title}
        </span>
        <span className="min-w-0 flex-1 truncate text-right text-xs text-zinc-500">
          {summary}
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-zinc-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div className={nested ? "px-1 pb-4" : "px-4 pb-4"}>{children}</div>
      )}
    </div>
  );
}

// 設定の選択肢に使う丸いチップ
export const chipCls = (on: boolean) =>
  `rounded-full border px-3 py-1.5 text-xs transition-colors ${
    on
      ? "border-[#4A99EA] bg-[#4A99EA]/10 text-[#4A99EA]"
      : "border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400"
  }`;
