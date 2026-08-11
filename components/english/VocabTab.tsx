"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BookOpen,
  Flame,
  Gauge,
  Loader2,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  EnglishData,
  Level,
  LEVELS,
  VocabAction,
  WordDbEntry,
} from "@/lib/english/types";
import {
  buildIndex,
  buildQueue,
  dbStats,
  estimatePlacement,
  evaluateLevelShift,
  fetchAllWordDbs,
  LEVEL_ORDER,
  LEVEL_SHIFT_WINDOW,
  PLACEMENT_SIZE,
  samplePlacementWord,
  WordDbMap,
} from "@/lib/english/worddb";

interface Props {
  data: EnglishData;
  setData: React.Dispatch<React.SetStateAction<EnglishData>>;
}

type Phase =
  | "loading"
  | "placementIntro"
  | "placement"
  | "placementDone"
  | "idle"
  | "quiz"
  | "done";
type Mode = "normal" | "weak";

const QUIZ_SIZE = 10;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const ACTION_LABEL: Record<VocabAction, string> = {
  known: "知っていた",
  unsure_correct: "怪しい → 正解",
  unsure_wrong: "怪しい → 誤答",
  unknown: "知らなかった",
};

function isCorrect(action: VocabAction): boolean {
  return action === "known" || action === "unsure_correct";
}

function levelLabel(level: Level): string {
  const def = LEVELS.find((l) => l.key === level);
  return def ? `${def.key} ${def.label}` : level;
}

// 1単語分のカード (自己判定 → 必要なら4択 → 意味の確認)。
// 状態のリセットは親が key={item.word} を変えることで行う
function WordCard({
  item,
  onAction,
  onNext,
  nextLabel,
}: {
  item: WordDbEntry;
  onAction: (action: VocabAction) => void;
  onNext: () => void;
  nextLabel: string;
}) {
  const [step, setStep] = useState<"ask" | "choices" | "reveal">("ask");
  const [choices, setChoices] = useState<string[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [action, setAction] = useState<VocabAction | null>(null);

  const finish = (a: VocabAction) => {
    setAction(a);
    setStep("reveal");
    onAction(a);
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-5 text-center">
        <p className="text-3xl font-semibold tracking-tight">{item.word}</p>
        <p className="mt-1 text-xs text-zinc-400">{item.pos}</p>
      </div>

      {step === "ask" && (
        <div className="grid gap-2">
          <button
            onClick={() => finish("known")}
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 dark:hover:bg-emerald-900"
          >
            知っている
          </button>
          <button
            onClick={() => {
              setChoices(shuffle([item.meaningJa, ...item.distractors]));
              setPicked(null);
              setStep("choices");
            }}
            className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900"
          >
            知っているか怪しい (4択で確認)
          </button>
          <button
            onClick={() => finish("unknown")}
            className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300 dark:hover:bg-rose-900"
          >
            知らない
          </button>
        </div>
      )}

      {step === "choices" && (
        <div className="grid gap-2">
          <p className="mb-1 text-center text-xs text-zinc-500">意味はどれ？</p>
          {choices.map((c, i) => (
            <button
              key={i}
              onClick={() => {
                if (picked !== null) return;
                setPicked(i);
                finish(c === item.meaningJa ? "unsure_correct" : "unsure_wrong");
              }}
              className="rounded-lg border border-zinc-200 px-4 py-2.5 text-left text-sm transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-zinc-500 dark:hover:bg-zinc-800"
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {step === "reveal" && action && (
        <div className="space-y-3">
          <p
            className={`text-center text-sm font-medium ${
              isCorrect(action) ? "text-emerald-600" : "text-rose-600"
            }`}
          >
            {ACTION_LABEL[action]}
            {action === "unsure_wrong" && picked !== null && (
              <span className="mt-0.5 block text-xs font-normal text-zinc-500">
                選択: {choices[picked]}
              </span>
            )}
          </p>
          <div className="rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-800">
            <p className="font-medium">
              {item.word} = {item.meaningJa}
            </p>
            <p className="mt-1 text-zinc-600 dark:text-zinc-300">{item.exampleEn}</p>
            <p className="mt-0.5 text-xs text-zinc-500">{item.exampleJa}</p>
          </div>
          <button
            onClick={onNext}
            className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            {nextLabel}
          </button>
        </div>
      )}
    </div>
  );
}

export function VocabTab({ data, setData }: Props) {
  const [dbs, setDbs] = useState<WordDbMap | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [mode, setMode] = useState<Mode>("normal");
  const [queue, setQueue] = useState<WordDbEntry[]>([]);
  const [index, setIndex] = useState(0);
  const [sessionResults, setSessionResults] = useState<
    { word: WordDbEntry; action: VocabAction }[]
  >([]);
  const [shiftMsg, setShiftMsg] = useState<string | null>(null);
  // レベル測定の状態
  const [pLadder, setPLadder] = useState(2);
  const [pTrack, setPTrack] = useState<number[]>([]);
  const [pSeen, setPSeen] = useState<Set<string>>(new Set());
  const [pItem, setPItem] = useState<WordDbEntry | null>(null);
  const [pCount, setPCount] = useState(0);
  const [placementResult, setPlacementResult] = useState<Level | null>(null);

  const wordIndex = useMemo(() => (dbs ? buildIndex(dbs) : null), [dbs]);

  useEffect(() => {
    let cancelled = false;
    fetchAllWordDbs()
      .then((d) => {
        if (cancelled) return;
        setDbs(d);
        setPhase("idle");
      })
      .catch((e) => {
        if (!cancelled) setDbError(e instanceof Error ? e.message : "読み込み失敗");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const vocabLevel = data.vocabLevel;
  const now = new Date();
  const stats =
    dbs && vocabLevel.current
      ? dbStats(dbs, vocabLevel.current, data.vocab, data.settings.vocab, now)
      : null;

  // 学習記録を更新する。countRecent が真なら直近正解率のウィンドウにも加える
  const record = (word: WordDbEntry, action: VocabAction, countRecent: boolean) => {
    const nowIso = new Date().toISOString();
    const correct = isCorrect(action);
    const wordLevel =
      wordIndex?.get(word.word)?.level ?? vocabLevel.current ?? "B1";
    setSessionResults((prev) => [...prev, { word, action }]);
    setData((prev) => {
      const e = prev.vocab[word.word];
      const history = [...(e?.history ?? []), { t: nowIso, r: action }].slice(-50);
      return {
        ...prev,
        vocab: {
          ...prev.vocab,
          [word.word]: {
            word: word.word,
            level: wordLevel,
            meaningJa: word.meaningJa,
            knownCount: (e?.knownCount ?? 0) + (action === "known" ? 1 : 0),
            unsureCount:
              (e?.unsureCount ?? 0) +
              (action === "unsure_correct" || action === "unsure_wrong" ? 1 : 0),
            unknownCount: (e?.unknownCount ?? 0) + (action === "unknown" ? 1 : 0),
            correctCount: (e?.correctCount ?? 0) + (action === "unsure_correct" ? 1 : 0),
            wrongCount: (e?.wrongCount ?? 0) + (action === "unsure_wrong" ? 1 : 0),
            needsReview: !correct,
            lastCorrectAt: correct ? nowIso : (e?.lastCorrectAt ?? null),
            lastSeenAt: nowIso,
            history,
          },
        },
        vocabLevel: countRecent
          ? {
              ...prev.vocabLevel,
              recent: [...prev.vocabLevel.recent, correct].slice(-LEVEL_SHIFT_WINDOW),
            }
          : prev.vocabLevel,
        stats: {
          ...prev.stats,
          vocabAnswered: prev.stats.vocabAnswered + 1,
          vocabCorrect: prev.stats.vocabCorrect + (correct ? 1 : 0),
        },
      };
    });
  };

  // ---- レベル測定 ----

  const startPlacement = () => {
    if (!dbs) return;
    const seen = new Set<string>();
    const item = samplePlacementWord(dbs, LEVEL_ORDER[2], seen);
    if (!item) return;
    seen.add(item.word);
    setPLadder(2);
    setPTrack([]);
    setPSeen(seen);
    setPItem(item);
    setPCount(0);
    setSessionResults([]);
    setPhase("placement");
  };

  const onPlacementAction = (action: VocabAction) => {
    if (!pItem) return;
    record(pItem, action, false);
    const next = isCorrect(action)
      ? Math.min(LEVEL_ORDER.length - 1, pLadder + 1)
      : Math.max(0, pLadder - 1);
    setPTrack((prev) => [...prev, next]);
    setPLadder(next);
  };

  const onPlacementNext = () => {
    if (!dbs) return;
    const done = pCount + 1;
    if (done >= PLACEMENT_SIZE) {
      const est = estimatePlacement(pTrack);
      setPlacementResult(est);
      setData((prev) => ({
        ...prev,
        vocabLevel: { current: est, recent: [] },
      }));
      setPhase("placementDone");
      return;
    }
    // 次の段の単語を選ぶ (出題済みは除外。尽きたら隣の段から)
    let item = samplePlacementWord(dbs, LEVEL_ORDER[pLadder], pSeen);
    if (!item) {
      for (const lv of LEVEL_ORDER) {
        item = samplePlacementWord(dbs, lv, pSeen);
        if (item) break;
      }
    }
    if (!item) return;
    setPSeen((prev) => new Set(prev).add(item!.word));
    setPItem(item);
    setPCount(done);
  };

  // ---- 通常の出題 ----

  const start = (m: Mode) => {
    if (!dbs || !vocabLevel.current) return;
    const q = buildQueue(
      dbs,
      vocabLevel.current,
      data.vocab,
      data.settings.vocab,
      m,
      QUIZ_SIZE,
      new Date(),
    );
    if (q.length === 0) return;
    setMode(m);
    setQueue(q);
    setIndex(0);
    setSessionResults([]);
    setShiftMsg(null);
    setPhase("quiz");
  };

  const next = () => {
    if (index + 1 >= queue.length) {
      // セッション終了時に直近正解率でレベルを自動調整する
      const shift = evaluateLevelShift(data.vocabLevel);
      if (shift) {
        setData((prev) => ({
          ...prev,
          vocabLevel: { current: shift.next, recent: [] },
        }));
        setShiftMsg(
          shift.direction === "up"
            ? `直近の正解率が${Math.round(shift.acc * 100)}%と高いため、単語レベルを ${levelLabel(shift.next)} に上げました。`
            : `直近の正解率が${Math.round(shift.acc * 100)}%のため、単語レベルを ${levelLabel(shift.next)} に下げました。`,
        );
      }
      setPhase("done");
    } else {
      setIndex(index + 1);
    }
  };

  const resetPlacement = () => {
    if (
      !window.confirm(
        "単語レベルを再測定します。学習記録は保持されます。よろしいですか？",
      )
    )
      return;
    setData((prev) => ({ ...prev, vocabLevel: { current: null, recent: [] } }));
    setPhase("idle");
  };

  // ---- 表示 ----

  if (dbError) {
    return (
      <div className="rounded-xl border border-rose-200 bg-white p-6 text-center text-sm text-rose-600 dark:border-rose-900 dark:bg-zinc-900">
        {dbError}
      </div>
    );
  }

  if (!dbs || phase === "loading") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-zinc-200 bg-white py-16 dark:border-zinc-800 dark:bg-zinc-900">
        <Loader2 className="animate-spin text-indigo-500" size={28} />
        <p className="text-sm text-zinc-500">単語データベースを読み込み中...</p>
      </div>
    );
  }

  // 未測定 → 測定フロー
  if (vocabLevel.current === null && phase !== "placement" && phase !== "placementDone") {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <Gauge className="mx-auto text-indigo-500" size={28} />
        <h3 className="mt-2 text-base font-semibold">まず単語レベルを測定します</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-zinc-600 dark:text-zinc-300">
          {PLACEMENT_SIZE}問に答えると、あなたの単語レベル (A1〜C1)
          を判定します。正解すると次は難しい単語、間違えると易しい単語が出る方式です。
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          測定後も、直近の正解率に応じてレベルは自動で上下します。
        </p>
        <button
          onClick={startPlacement}
          className="mt-4 rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          測定をはじめる ({PLACEMENT_SIZE}問)
        </button>
      </div>
    );
  }

  if (phase === "placement" && pItem) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm text-zinc-500">
          <span>
            レベル測定 {pCount + 1} / {PLACEMENT_SIZE} 問
          </span>
          <span className="text-xs">
            いま {levelLabel(LEVEL_ORDER[Math.min(pLadder, 4)])} の単語
          </span>
        </div>
        <WordCard
          key={pItem.word}
          item={pItem}
          onAction={onPlacementAction}
          onNext={onPlacementNext}
          nextLabel={pCount + 1 >= PLACEMENT_SIZE ? "判定を見る" : "次へ"}
        />
      </div>
    );
  }

  if (phase === "placementDone" && placementResult) {
    const def = LEVELS.find((l) => l.key === placementResult);
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-500">あなたの単語レベル</p>
        <p className="mt-2 text-4xl font-semibold text-indigo-600 dark:text-indigo-400">
          {placementResult}
          <span className="ml-2 text-2xl">{def?.label}</span>
        </p>
        <p className="mt-1 text-sm text-zinc-500">{def?.guide}</p>
        <p className="mx-auto mt-3 max-w-md text-xs text-zinc-400">
          このレベルから出題をはじめます。今後は直近{LEVEL_SHIFT_WINDOW}
          問の正解率が85%以上で1段上に、50%以下で1段下に自動調整されます。
        </p>
        <button
          onClick={() => setPhase("idle")}
          className="mt-5 rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          学習をはじめる
        </button>
      </div>
    );
  }

  if (phase === "quiz" && queue[index]) {
    const item = queue[index];
    const correctSoFar = sessionResults.filter((r) => isCorrect(r.action)).length;
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm text-zinc-500">
          <span>
            {index + 1} / {queue.length} 語
            {mode === "weak" && (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                苦手演習
              </span>
            )}
          </span>
          <span>{correctSoFar} 正解</span>
        </div>
        <WordCard
          key={item.word}
          item={item}
          onAction={(a) => record(item, a, mode === "normal")}
          onNext={next}
          nextLabel={index + 1 >= queue.length ? "結果を見る" : "次へ"}
        />
      </div>
    );
  }

  if (phase === "done") {
    const counts = {
      known: sessionResults.filter((r) => r.action === "known").length,
      unsure_correct: sessionResults.filter((r) => r.action === "unsure_correct").length,
      unsure_wrong: sessionResults.filter((r) => r.action === "unsure_wrong").length,
      unknown: sessionResults.filter((r) => r.action === "unknown").length,
    };
    const missed = sessionResults.filter((r) => !isCorrect(r.action));
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-center text-sm text-zinc-500">結果</p>
          <div className="mx-auto mt-3 grid max-w-sm grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-emerald-50 p-2.5 text-center dark:bg-emerald-950">
              <p className="text-xs text-emerald-700 dark:text-emerald-400">知っていた</p>
              <p className="text-xl font-semibold text-emerald-700 dark:text-emerald-300">
                {counts.known}
              </p>
            </div>
            <div className="rounded-lg bg-emerald-50 p-2.5 text-center dark:bg-emerald-950">
              <p className="text-xs text-emerald-700 dark:text-emerald-400">怪しい → 正解</p>
              <p className="text-xl font-semibold text-emerald-700 dark:text-emerald-300">
                {counts.unsure_correct}
              </p>
            </div>
            <div className="rounded-lg bg-rose-50 p-2.5 text-center dark:bg-rose-950">
              <p className="text-xs text-rose-700 dark:text-rose-400">怪しい → 誤答</p>
              <p className="text-xl font-semibold text-rose-700 dark:text-rose-300">
                {counts.unsure_wrong}
              </p>
            </div>
            <div className="rounded-lg bg-rose-50 p-2.5 text-center dark:bg-rose-950">
              <p className="text-xs text-rose-700 dark:text-rose-400">知らなかった</p>
              <p className="text-xl font-semibold text-rose-700 dark:text-rose-300">
                {counts.unknown}
              </p>
            </div>
          </div>

          {shiftMsg && (
            <div className="mt-4 flex items-start gap-2 rounded-lg bg-indigo-50 p-3 text-left text-sm text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
              {shiftMsg.includes("上げました") ? (
                <TrendingUp size={16} className="mt-0.5 shrink-0" />
              ) : (
                <TrendingDown size={16} className="mt-0.5 shrink-0" />
              )}
              <span>{shiftMsg}</span>
            </div>
          )}

          {missed.length > 0 && (
            <div className="mt-4 rounded-lg bg-amber-50 p-3 text-left text-sm dark:bg-amber-950">
              <p className="font-medium text-amber-800 dark:text-amber-300">
                復習リストに追加 (長文読解の題材にも使われます)
              </p>
              <ul className="mt-1 space-y-0.5 text-amber-700 dark:text-amber-400">
                {missed.map((r) => (
                  <li key={r.word.word}>
                    {r.word.word} = {r.word.meaningJa}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              onClick={() => start("normal")}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
            >
              <RefreshCw size={15} /> 次の{QUIZ_SIZE}語へ
            </button>
            {stats && stats.mistaken > 0 && (
              <button
                onClick={() => start("weak")}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-400 px-5 py-2.5 text-sm font-medium text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950"
              >
                <Flame size={15} /> 苦手演習
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // idle
  const recentAcc =
    vocabLevel.recent.length > 0
      ? Math.round(
          (vocabLevel.recent.filter(Boolean).length / vocabLevel.recent.length) * 100,
        )
      : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 dark:border-indigo-900 dark:bg-indigo-950">
        <div className="flex items-center gap-2 text-sm">
          <Activity size={16} className="text-indigo-600 dark:text-indigo-400" />
          <span className="font-medium text-indigo-900 dark:text-indigo-200">
            単語レベル: {vocabLevel.current ? levelLabel(vocabLevel.current) : "未測定"}
          </span>
          {recentAcc !== null && (
            <span className="text-xs text-indigo-700 dark:text-indigo-400">
              直近{vocabLevel.recent.length}問の正解率 {recentAcc}%
            </span>
          )}
        </div>
        <button
          onClick={resetPlacement}
          className="text-xs text-indigo-600 underline dark:text-indigo-400"
        >
          再測定する
        </button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">習得済み</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600">
              {stats.mastered}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">学習中</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{stats.learning}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">要復習</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-600">
              {stats.review + stats.stale}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">未学習</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{stats.new}</p>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <BookOpen className="mx-auto text-indigo-500" size={28} />
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
          「知っている / 怪しい / 知らない」で自己判定し、怪しい場合だけ4択で確認します。復習単語はレベルをまたいで再出題されます。
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          間違いが多い単語ほど頻繁に出題。「知っている」
          {data.settings.vocab.masterKnownCount}回で出題から外れ、最終正解から
          {data.settings.vocab.reviewIntervalDays}日で再出現します (設定タブで変更可)。
        </p>
        <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
          <button
            onClick={() => start("normal")}
            className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            {QUIZ_SIZE}語を出題する
          </button>
          <button
            onClick={() => start("weak")}
            disabled={!stats || stats.mistaken === 0}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-400 px-6 py-2.5 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950"
          >
            <Flame size={15} /> 苦手演習 ({stats?.mistaken ?? 0}語)
          </button>
        </div>
      </div>
    </div>
  );
}
