"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { INTEREST_PRESETS, Level, LEVELS } from "@/lib/english/types";

interface Props {
  level: Level | null;
  interests: string[];
  onLevelChange: (level: Level) => void;
  onInterestsChange: (interests: string[]) => void;
}

// レベルと興味の設定UI。初期設定画面と設定タブの両方で使う
export function SetupPanel({ level, interests, onLevelChange, onInterestsChange }: Props) {
  const [custom, setCustom] = useState("");

  const toggleInterest = (t: string) => {
    onInterestsChange(
      interests.includes(t) ? interests.filter((x) => x !== t) : [...interests, t],
    );
  };

  const addCustom = () => {
    const t = custom.trim();
    if (!t || interests.includes(t)) {
      setCustom("");
      return;
    }
    onInterestsChange([...interests, t]);
    setCustom("");
  };

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-1 text-sm font-medium">レベル (文法・長文読解で使用)</h3>
        <p className="mb-2 text-xs text-zinc-500">
          単語のレベルはここでは選びません。単語タブ最初の10問で測定され、以後は正解率に応じて自動調整されます。
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {LEVELS.map((l) => (
            <button
              key={l.key}
              onClick={() => onLevelChange(l.key)}
              className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                level === l.key
                  ? "border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950"
                  : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500"
              }`}
            >
              <p className="text-sm font-semibold">
                {l.key} <span className="font-normal">{l.label}</span>
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">{l.guide}</p>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">興味のあるテーマ</h3>
        <p className="mb-2 text-xs text-zinc-500">
          長文読解の題材に使われます。複数選択できます。
        </p>
        <div className="flex flex-wrap gap-2">
          {INTEREST_PRESETS.map((t) => (
            <button
              key={t}
              onClick={() => toggleInterest(t)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                interests.includes(t)
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950 dark:text-indigo-300"
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
                className="flex items-center gap-1 rounded-full border border-indigo-500 bg-indigo-50 px-3 py-1 text-xs text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950 dark:text-indigo-300"
              >
                {t}
                <button onClick={() => toggleInterest(t)} aria-label={`${t}を削除`}>
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
            className="flex-1 rounded-lg border border-zinc-200 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-indigo-400 dark:border-zinc-700"
          />
          <button
            onClick={addCustom}
            className="flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <Plus size={14} /> 追加
          </button>
        </div>
      </section>
    </div>
  );
}
