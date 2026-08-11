"use client";

import { useState } from "react";
import { ChevronDown, FileText, Loader2 } from "lucide-react";
import { ChoiceQuestion } from "./ChoiceQuestion";
import { EnglishData, ReadingResult, SavedReading } from "@/lib/english/types";

interface Props {
  data: EnglishData;
  setData: React.Dispatch<React.SetStateAction<EnglishData>>;
}

type Phase = "idle" | "loading" | "reading";

// **word** のマーカーをハイライトに変換して本文を描画する
function renderPassage(passage: string) {
  return passage.split(/\n+/).map((para, pi) => (
    <p key={pi} className="mb-3 leading-relaxed">
      {para.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
        const m = part.match(/^\*\*([^*]+)\*\*$/);
        if (m) {
          return (
            <mark
              key={i}
              className="rounded bg-amber-100 px-0.5 font-medium text-amber-900 dark:bg-amber-900 dark:text-amber-100"
            >
              {m[1]}
            </mark>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </p>
  ));
}

export function ReadingTab({ data, setData }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [current, setCurrent] = useState<SavedReading | null>(null);
  const [answers, setAnswers] = useState<boolean[]>([]);
  const [showTranslation, setShowTranslation] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reviewEntries = Object.values(data.vocab)
    .filter((e) => e.needsReview)
    .sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt));
  const targetWords = reviewEntries.slice(0, 8).map((e) => ({
    word: e.word,
    meaningJa: e.meaningJa,
  }));

  const generate = async () => {
    setPhase("loading");
    setError(null);
    try {
      const res = await fetch("/api/english/reading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level: data.settings.level,
          interests: data.settings.interests,
          targetWords,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? "生成に失敗しました");
      const result = json as ReadingResult;
      const saved: SavedReading = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        title: result.title,
        passageEn: result.passageEn,
        translationJa: result.translationJa,
        glossary: result.glossary,
        questions: result.questions,
        score: null,
      };
      setCurrent(saved);
      setAnswers([]);
      setShowTranslation(false);
      setData((prev) => ({
        ...prev,
        readings: [saved, ...prev.readings].slice(0, 10),
      }));
      setPhase("reading");
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成に失敗しました");
      setPhase("idle");
    }
  };

  const onQuestionAnswered = (correct: boolean) => {
    if (!current) return;
    const newAnswers = [...answers, correct];
    setAnswers(newAnswers);
    if (newAnswers.length === current.questions.length) {
      const score = {
        correct: newAnswers.filter(Boolean).length,
        total: current.questions.length,
      };
      setData((prev) => ({
        ...prev,
        readings: prev.readings.map((r) => (r.id === current.id ? { ...r, score } : r)),
      }));
    }
  };

  if (phase === "loading") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-zinc-200 bg-white py-16 dark:border-zinc-800 dark:bg-zinc-900">
        <Loader2 className="animate-spin text-indigo-500" size={28} />
        <p className="text-sm text-zinc-500">
          あなた専用の英文を生成中... (1分ほどかかります)
        </p>
      </div>
    );
  }

  if (phase === "reading" && current) {
    const allAnswered = answers.length === current.questions.length;
    return (
      <div className="space-y-4">
        <article className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="mb-3 text-xl font-semibold tracking-tight">{current.title}</h3>
          <div className="text-[15px]">{renderPassage(current.passageEn)}</div>

          {current.glossary.length > 0 && (
            <div className="mt-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
              <p className="mb-1.5 text-xs font-medium text-zinc-500">語注</p>
              <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                {current.glossary.map((g, i) => (
                  <li key={i}>
                    <span className="font-medium">{g.word}</span>
                    <span className="text-zinc-500"> : {g.meaningJa}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            onClick={() => setShowTranslation(!showTranslation)}
            className="mt-3 flex items-center gap-1 text-sm text-indigo-600 dark:text-indigo-400"
          >
            <ChevronDown
              size={15}
              className={`transition-transform ${showTranslation ? "rotate-180" : ""}`}
            />
            全文和訳を{showTranslation ? "隠す" : "表示"}
          </button>
          {showTranslation && (
            <p className="mt-2 whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-sm leading-relaxed text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {current.translationJa}
            </p>
          )}
        </article>

        <div className="space-y-3">
          <h4 className="text-sm font-medium text-zinc-500">内容理解クイズ</h4>
          {current.questions.map((q, qi) => (
            <ChoiceQuestion
              key={`${current.id}-${qi}`}
              prompt={
                <p className="text-sm font-medium leading-relaxed">
                  Q{qi + 1}. {q.question}
                </p>
              }
              choices={q.choices}
              correctIndex={q.answerIndex}
              onAnswered={onQuestionAnswered}
              explanation={<p className="whitespace-pre-wrap">{q.explanationJa}</p>}
            />
          ))}
        </div>

        {allAnswered && (
          <div className="rounded-xl border border-zinc-200 bg-white p-5 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm text-zinc-500">読解クイズの結果</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">
              {answers.filter(Boolean).length}
              <span className="text-base font-normal text-zinc-500">
                {" "}
                / {current.questions.length}
              </span>
            </p>
            <p className="mt-2 text-xs text-zinc-500">
              ハイライトされた復習単語は、単語学習タブで正解すると復習リストから外れます。
            </p>
            <button
              onClick={() => setPhase("idle")}
              className="mt-4 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
            >
              完了
            </button>
          </div>
        )}
      </div>
    );
  }

  // idle
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <FileText className="mx-auto text-indigo-500" size={28} />
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
          あなたの興味 (
          {data.settings.interests.length > 0
            ? data.settings.interests.slice(0, 3).join("・") +
              (data.settings.interests.length > 3 ? " など" : "")
            : "未設定"}
          ) とレベルに合わせた英文を生成します。
        </p>
        {targetWords.length > 0 ? (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            単語クイズで間違えた {targetWords.length} 語 (
            {targetWords
              .slice(0, 4)
              .map((t) => t.word)
              .join(", ")}
            {targetWords.length > 4 ? " ..." : ""}) を本文に織り込みます。
          </p>
        ) : (
          <p className="mt-1 text-xs text-zinc-400">
            単語クイズで間違えた単語があると、その単語を織り込んだ英文になります。
          </p>
        )}
        <button
          onClick={generate}
          className="mt-4 rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          長文を生成する
        </button>
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      </div>

      {data.readings.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-2 text-xs font-medium text-zinc-500">これまでの長文</p>
          <div className="space-y-2">
            {data.readings.map((r) => (
              <details key={r.id} className="group rounded-lg border border-zinc-100 dark:border-zinc-800">
                <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm">
                  <span className="font-medium">{r.title}</span>
                  <span className="text-xs text-zinc-400">
                    {r.score ? `${r.score.correct}/${r.score.total}` : "未回答"} ・{" "}
                    {r.createdAt.slice(0, 10)}
                  </span>
                </summary>
                <div className="border-t border-zinc-100 px-3 py-3 text-sm dark:border-zinc-800">
                  <div className="text-[14px]">{renderPassage(r.passageEn)}</div>
                  <p className="mt-1 whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                    {r.translationJa}
                  </p>
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
