"use client";

import { useEffect, useState } from "react";
import { Loader2, PenLine, RefreshCw } from "lucide-react";
import { ChoiceQuestion } from "./ChoiceQuestion";
import {
  EnglishData,
  GrammarDb,
  GrammarDbItem,
  GRAMMAR_TOPICS,
} from "@/lib/english/types";
import { buildGrammarQueue, fetchGrammarDb } from "@/lib/english/grammardb";

interface Props {
  data: EnglishData;
  setData: React.Dispatch<React.SetStateAction<EnglishData>>;
}

type Phase = "idle" | "quiz" | "done";

const QUIZ_SIZE = 5;

export function GrammarTab({ data, setData }: Props) {
  const [db, setDb] = useState<GrammarDb | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [topic, setTopic] = useState<string | null>(null);
  const [items, setItems] = useState<GrammarDbItem[]>([]);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);
  const [answeredCurrent, setAnsweredCurrent] = useState(false);

  const level = data.settings.level;

  useEffect(() => {
    if (!level) return;
    let cancelled = false;
    setDb(null);
    setDbError(null);
    fetchGrammarDb(level)
      .then((d) => {
        if (!cancelled) setDb(d);
      })
      .catch((e) => {
        if (!cancelled) setDbError(e instanceof Error ? e.message : "読み込み失敗");
      });
    return () => {
      cancelled = true;
    };
  }, [level]);

  // 正答率が低いトピック (3問以上解答済みで正答率60%未満)
  const weakTopics = GRAMMAR_TOPICS.filter((t) => {
    const r = data.grammar[t];
    if (!r) return false;
    const total = r.correct + r.wrong;
    return total >= 3 && r.correct / total < 0.6;
  });

  const start = () => {
    if (!db) return;
    const q = buildGrammarQueue(db, topic, weakTopics, data.grammarSeen, QUIZ_SIZE);
    if (q.length === 0) return;
    setItems(q);
    setIndex(0);
    setResults([]);
    setAnsweredCurrent(false);
    setPhase("quiz");
  };

  const onAnswered = (correct: boolean) => {
    const item = items[index];
    setAnsweredCurrent(true);
    setResults((prev) => [...prev, correct]);
    setData((prev) => {
      const existing = prev.grammar[item.topic] ?? { correct: 0, wrong: 0 };
      return {
        ...prev,
        grammar: {
          ...prev.grammar,
          [item.topic]: {
            correct: existing.correct + (correct ? 1 : 0),
            wrong: existing.wrong + (correct ? 0 : 1),
          },
        },
        grammarSeen: [...prev.grammarSeen, item.id].slice(-300),
        stats: {
          ...prev.stats,
          grammarAnswered: prev.stats.grammarAnswered + 1,
          grammarCorrect: prev.stats.grammarCorrect + (correct ? 1 : 0),
        },
      };
    });
  };

  const next = () => {
    if (index + 1 >= items.length) {
      setPhase("done");
    } else {
      setIndex(index + 1);
      setAnsweredCurrent(false);
    }
  };

  if (!level) return null;

  if (dbError) {
    return (
      <div className="rounded-xl border border-rose-200 bg-white p-6 text-center text-sm text-rose-600 dark:border-rose-900 dark:bg-zinc-900">
        {dbError}
      </div>
    );
  }

  if (!db) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-zinc-200 bg-white py-16 dark:border-zinc-800 dark:bg-zinc-900">
        <Loader2 className="animate-spin text-indigo-500" size={28} />
        <p className="text-sm text-zinc-500">文法問題データベースを読み込み中...</p>
      </div>
    );
  }

  if (phase === "quiz") {
    const item = items[index];
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm text-zinc-500">
          <span>
            {index + 1} / {items.length} 問
            <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
              {item.topic}
            </span>
          </span>
          <span>正解 {results.filter(Boolean).length}</span>
        </div>
        <ChoiceQuestion
          key={item.id}
          prompt={<p className="text-lg leading-relaxed">{item.question}</p>}
          choices={item.choices}
          correctIndex={item.answerIndex}
          onAnswered={onAnswered}
          explanation={<p className="whitespace-pre-wrap">{item.explanationJa}</p>}
          footer={
            answeredCurrent ? (
              <button
                onClick={next}
                className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
              >
                {index + 1 >= items.length ? "結果を見る" : "次へ"}
              </button>
            ) : null
          }
        />
      </div>
    );
  }

  if (phase === "done") {
    const correctCount = results.filter(Boolean).length;
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-500">結果</p>
        <p className="mt-1 text-4xl font-semibold tabular-nums">
          {correctCount}
          <span className="text-lg font-normal text-zinc-500"> / {items.length}</span>
        </p>
        <button
          onClick={start}
          className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          <RefreshCw size={15} /> 同じ条件でもう{QUIZ_SIZE}問
        </button>
        <button
          onClick={() => setPhase("idle")}
          className="mt-2 block w-full text-sm text-zinc-500 underline"
        >
          トピックを選び直す
        </button>
      </div>
    );
  }

  // idle: トピック選択
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="mb-2 text-sm font-medium">出題トピック</h3>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setTopic(null)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              topic === null
                ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950 dark:text-indigo-300"
                : "border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400"
            }`}
          >
            おまかせ{weakTopics.length > 0 ? " (苦手を優先)" : ""}
          </button>
          {GRAMMAR_TOPICS.map((t) => {
            const r = data.grammar[t];
            const total = r ? r.correct + r.wrong : 0;
            const rate = total > 0 ? Math.round((r!.correct / total) * 100) : null;
            return (
              <button
                key={t}
                onClick={() => setTopic(t)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  topic === t
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950 dark:text-indigo-300"
                    : weakTopics.includes(t)
                      ? "border-amber-400 text-amber-700 hover:border-amber-500 dark:border-amber-600 dark:text-amber-400"
                      : "border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400"
                }`}
              >
                {t}
                {rate !== null && <span className="ml-1 text-[10px]">{rate}%</span>}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          %は正答率。黄色は苦手トピック (正答率60%未満) で、おまかせ時に優先出題されます。
        </p>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <PenLine className="mx-auto text-indigo-500" size={28} />
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
          収録 {db.count} 問 ({db.level}) から
          {topic ? `「${topic}」の` : ""}4択問題を{QUIZ_SIZE}問出題します。未出題の問題が優先されます。
        </p>
        <button
          onClick={start}
          className="mt-4 rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          {QUIZ_SIZE}問を出題する
        </button>
      </div>
    </div>
  );
}
