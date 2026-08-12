"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { INTEREST_PRESETS } from "@/lib/english/types";

// 興味のあるテーマの編集。長文読解とAI会話の「おまかせ」の題材になる。
// 以前は初回の「はじめに設定してください」(SetupPanel) にあったが、
// そのフローをチュートリアルに置き換えたので、設定 (歯車) に移した
export function InterestsEditor({
  interests,
  onChange,
}: {
  interests: string[];
  onChange: (interests: string[]) => void;
}) {
  const [custom, setCustom] = useState("");

  const toggle = (t: string) => {
    onChange(
      interests.includes(t)
        ? interests.filter((x) => x !== t)
        : [...interests, t],
    );
  };

  const addCustom = () => {
    const t = custom.trim();
    if (!t || interests.includes(t)) {
      setCustom("");
      return;
    }
    onChange([...interests, t]);
    setCustom("");
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {INTEREST_PRESETS.map((t) => (
          <button
            key={t}
            onClick={() => toggle(t)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              interests.includes(t)
                ? "border-[#4A99EA] bg-[#4A99EA]/10 text-[#4A99EA]"
                : "border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400"
            }`}
          >
            {t}
          </button>
        ))}
        {interests
          .filter((t) => !INTEREST_PRESETS.includes(t))
          .map((t) => (
            <span
              key={t}
              className="flex items-center gap-1 rounded-full border border-[#4A99EA] bg-[#4A99EA]/10 px-3 py-1 text-xs text-[#4A99EA]"
            >
              {t}
              <button onClick={() => toggle(t)} aria-label={`${t}を削除`}>
                <X size={12} />
              </button>
            </span>
          ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addCustom();
          }}
          placeholder="自由入力 (例: 宇宙、サッカー)"
          className="flex-1 rounded-lg border border-zinc-200 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-[#4A99EA] dark:border-zinc-700"
        />
        <button
          onClick={addCustom}
          className="flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          <Plus size={14} /> 追加
        </button>
      </div>
    </div>
  );
}
