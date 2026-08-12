"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, PenLine } from "lucide-react";
import { ChoiceQuestion } from "./ChoiceQuestion";
import {
  EnglishData,
  GrammarDbItem,
  GRAMMAR_TOPICS,
  Level,
  LEVELS,
} from "@/lib/english/types";
import { Collapsible } from "./Collapsible";
import {
  buildGrammarQueue,
  fetchGrammarPool,
  GrammarPool,
} from "@/lib/english/grammardb";

interface Props {
  data: EnglishData;
  setData: React.Dispatch<React.SetStateAction<EnglishData>>;
}

// キューを使い切るたびに補充する単位 (出題自体は無限に続く)
const BATCH_SIZE = 10;

// トピックのチップ。苦手 (正答率60%以下) は赤で出すので4状態ある
const chipCls = (state: "on" | "weak" | "weakOn" | "off") =>
  `rounded-full border px-3 py-1 text-xs transition-colors ${
    state === "weakOn"
      ? "border-red-500 bg-red-500/10 text-red-500"
      : state === "on"
        ? "border-[#4A99EA] bg-[#4A99EA]/10 text-[#4A99EA]"
        : state === "weak"
          ? "border-red-500/60 text-red-500 hover:border-red-500"
          : "border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400"
  }`;

export function GrammarTab({ data, setData }: Props) {
  const [pool, setPool] = useState<GrammarPool | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  // 空ならおまかせ。複数選ぶとそのトピックだけから出題する
  const [topics, setTopics] = useState<string[]>([]);
  const [items, setItems] = useState<GrammarDbItem[]>([]);
  const [index, setIndex] = useState(0);
  const [answeredCurrent, setAnsweredCurrent] = useState(false);

  // 出題難易度。未設定なら単語学習の測定値に追随する
  // (初回設定でレベルを選ぶフローは廃止したので、settings.level は無いことがある。
  //  測定もまだなら B1 から始める)
  const levels: Level[] =
    data.settings.grammarLevels.length > 0
      ? data.settings.grammarLevels
      : [data.vocabLevel.current ?? data.settings.level ?? "B1"];
  const levelKey = levels.join(",");

  // 読み込み完了時の自動出題で使う。読み込みをやり直さずに最新値を読むための控え
  const topicsRef = useRef<string[]>([]);
  const weakTopicsRef = useRef<string[]>([]);
  const seenRef = useRef<string[]>([]);

  useEffect(() => {
    if (levels.length === 0) return;
    let cancelled = false;
    setPool(null);
    setDbError(null);
    fetchGrammarPool(levels)
      .then((p) => {
        if (cancelled) return;
        setPool(p);
        // 読み込みが終わったら、ボタンを押さずにそのまま出題を始める
        const q = buildGrammarQueue(
          p.items,
          topicsRef.current,
          weakTopicsRef.current,
          seenRef.current,
          BATCH_SIZE,
        );
        setItems(q);
        setIndex(0);
        setAnsweredCurrent(false);
      })
      .catch((e) => {
        if (!cancelled) setDbError(e instanceof Error ? e.message : "読み込み失敗");
      });
    return () => {
      cancelled = true;
    };
    // 読み込みは難易度が変わったときだけ。出題条件は ref から読む
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelKey]);

  // 正答率が60%以下のトピック。1問でも解いていれば対象にする
  const weakTopics = GRAMMAR_TOPICS.filter((t) => {
    const r = data.grammar[t];
    if (!r) return false;
    const total = r.correct + r.wrong;
    return total > 0 && r.correct / total <= 0.6;
  });

  useEffect(() => {
    topicsRef.current = topics;
    weakTopicsRef.current = weakTopics;
    seenRef.current = data.grammarSeen;
  });

  // トピックを変えたときは、その場で出題し直せるよう引数で受け取る
  const restart = (nextTopics: string[] = topics) => {
    if (!pool) return;
    const q = buildGrammarQueue(
      pool.items,
      nextTopics,
      weakTopics,
      data.grammarSeen,
      BATCH_SIZE,
    );
    setItems(q);
    setIndex(0);
    setAnsweredCurrent(false);
  };

  const toggleTopic = (t: string) => {
    const next = topics.includes(t)
      ? topics.filter((x) => x !== t)
      : [...topics, t];
    setTopics(next);
    restart(next);
  };

  const toggleLevel = (lv: Level) => {
    const cur = levels;
    const next = cur.includes(lv) ? cur.filter((x) => x !== lv) : [...cur, lv];
    if (next.length === 0) return; // 最後の1つは外させない
    setData((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        grammarLevels: LEVELS.filter((l) => next.includes(l.key)).map(
          (l) => l.key,
        ),
      },
    }));
  };

  const onAnswered = (correct: boolean) => {
    const item = items[index];
    setAnsweredCurrent(true);
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

  // 次の1問へ。キューを使い切ったら補充して無限に出題を続ける
  const next = () => {
    setAnsweredCurrent(false);
    if (index + 1 < items.length) {
      setIndex(index + 1);
      return;
    }
    if (!pool) return;
    const q = buildGrammarQueue(
      pool.items,
      topics,
      weakTopics,
      data.grammarSeen,
      BATCH_SIZE,
    );
    setItems(q);
    setIndex(0);
  };

  if (dbError) {
    return (
      <div className="rounded-2xl border border-red-500/40 bg-white p-6 text-center text-sm text-red-500 dark:bg-black">
        {dbError}
      </div>
    );
  }

  if (levels.length === 0) return null;

  const topicSummary =
    topics.length === 0
      ? `おまかせ${weakTopics.length > 0 ? " (苦手を優先)" : ""}`
      : topics.join("・");

  const panels = (
    <Collapsible
      accent
      title="生成条件"
      summary={`${topicSummary}・${levels.join("・")}`}
    >
      <Collapsible title="出題トピック" summary={topicSummary} nested>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              setTopics([]);
              restart([]);
            }}
            className={chipCls(topics.length === 0 ? "on" : "off")}
          >
            おまかせ{weakTopics.length > 0 ? " (苦手を優先)" : ""}
          </button>
          {GRAMMAR_TOPICS.map((t) => {
            const r = data.grammar[t];
            const total = r ? r.correct + r.wrong : 0;
            const rate = total > 0 ? Math.round((r!.correct / total) * 100) : null;
            const on = topics.includes(t);
            const weak = weakTopics.includes(t);
            return (
              <button
                key={t}
                onClick={() => toggleTopic(t)}
                className={chipCls(
                  on ? (weak ? "weakOn" : "on") : weak ? "weak" : "off",
                )}
              >
                {t}
                {rate !== null && <span className="ml-1 text-[10px]">{rate}%</span>}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          複数選べます。%は正答率。赤は苦手トピック (正答率60%以下) で、おまかせ時に優先出題されます。
        </p>
      </Collapsible>

      <Collapsible title="出題難易度" summary={levels.join("・")} nested>
        <div className="flex flex-wrap gap-2">
          {LEVELS.map((l) => (
            <button
              key={l.key}
              onClick={() => toggleLevel(l.key)}
              className={chipCls(levels.includes(l.key) ? "on" : "off")}
            >
              {l.key} {l.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          複数選べます。選んだレベルの問題をまとめて出題します。
        </p>
      </Collapsible>
    </Collapsible>
  );

  if (!pool) {
    return (
      <div className="space-y-3">
        {panels}
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 bg-white py-16 dark:border-zinc-800 dark:bg-black">
          <Loader2 className="animate-spin text-[#4A99EA]" size={28} />
          <p className="text-sm text-zinc-500">文法問題データベースを読み込み中...</p>
        </div>
      </div>
    );
  }

  const item = items[index];

  return (
    <div className="space-y-3">
      {panels}
      {item ? (
        <>
          <div className="flex items-center text-sm text-zinc-500">
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
              {item.topic}
            </span>
          </div>
          <ChoiceQuestion
            key={item.id}
            prompt={<p className="text-lg leading-relaxed">{item.question}</p>}
            choices={item.choices}
            correctIndex={item.answerIndex}
            onAnswered={onAnswered}
            explanation={
              <p className="whitespace-pre-wrap">{item.explanationJa}</p>
            }
            footer={
              answeredCurrent ? (
                <button
                  onClick={next}
                  className="w-full rounded-lg bg-[#4A99EA] py-2.5 text-sm font-medium text-white hover:bg-[#3d87d4]"
                >
                  次へ
                </button>
              ) : null
            }
          />
        </>
      ) : (
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-black">
          <PenLine className="mx-auto text-zinc-300 dark:text-zinc-600" size={28} />
          <p className="mt-2 text-sm text-zinc-500">
            選んだ条件に出題できる問題がありません。
          </p>
        </div>
      )}
    </div>
  );
}
