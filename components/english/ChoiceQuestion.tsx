"use client";

import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

interface Props {
  prompt: React.ReactNode;
  choices: string[];
  correctIndex: number;
  // 回答直後に一度だけ呼ばれる
  onAnswered?: (correct: boolean) => void;
  // 回答後に表示する解説
  explanation?: React.ReactNode;
  footer?: React.ReactNode;
}

// 4択問題カード。状態をリセットしたいときは親側で key を変える
export function ChoiceQuestion({
  prompt,
  choices,
  correctIndex,
  onAnswered,
  explanation,
  footer,
}: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const answered = selected !== null;

  const pick = (i: number) => {
    if (answered) return;
    setSelected(i);
    onAnswered?.(i === correctIndex);
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4">{prompt}</div>
      <div className="grid gap-2">
        {choices.map((c, i) => {
          let cls =
            "rounded-lg border px-4 py-2.5 text-left text-sm transition-colors ";
          if (!answered) {
            cls +=
              "border-zinc-200 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-zinc-500 dark:hover:bg-zinc-800";
          } else if (i === correctIndex) {
            cls +=
              "border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200";
          } else if (i === selected) {
            cls +=
              "border-rose-500 bg-rose-50 text-rose-900 dark:bg-rose-950 dark:text-rose-200";
          } else {
            cls += "border-zinc-200 opacity-60 dark:border-zinc-700";
          }
          return (
            <button key={i} className={cls} onClick={() => pick(i)} disabled={answered}>
              <span className="mr-2 font-mono text-xs text-zinc-400">
                {String.fromCharCode(65 + i)}
              </span>
              {c}
            </button>
          );
        })}
      </div>
      {answered && (
        <div className="mt-4 space-y-3">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            {selected === correctIndex ? (
              <>
                <CheckCircle2 size={16} className="text-emerald-600" /> 正解
              </>
            ) : (
              <>
                <XCircle size={16} className="text-rose-600" /> 不正解 (正解:{" "}
                {String.fromCharCode(65 + correctIndex)})
              </>
            )}
          </p>
          {explanation && (
            <div className="rounded-lg bg-zinc-50 p-3 text-sm leading-relaxed text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {explanation}
            </div>
          )}
          {footer}
        </div>
      )}
    </div>
  );
}
