"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  EyeOff,
  Filter,
  Loader2,
  Plus,
  Search,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import {
  applyEdit,
  EnglishData,
  Level,
  LEVELS,
  VocabEntry,
  WordDbEntry,
} from "@/lib/english/types";
import {
  fetchAllWordDbs,
  LEVEL_ORDER,
  lastResult,
  LastResult,
  PROGRESS_BADGE,
  progressOf,
  Progress,
  RESULT_BADGE,
  statusBadges,
  WordDbMap,
} from "@/lib/english/worddb";
import { setStatusOverride } from "@/lib/english/progress";
import { primeSpeech, speak } from "@/lib/english/speech";
import { CardDetailSheet } from "./CardDetailSheet";

const PAGE_SIZE = 100;

type LevelFilter = Level | "all";
type SortKey =
  | "word"
  | "result"
  | "progress"
  | "meaning"
  | "known"
  | "fuzzy"
  | "unknown"
  | "lastSeen";
type SortDir = "asc" | "desc";
type DateOp = "before" | "after" | "on";

// ステータスは前回結果と学習進捗度の2軸。フィルタは軸ごとに持ち、両方指定したら AND で絞る。
// 既定は未学習を外して、一度でも出題した語に集中できるようにする
const RESULT_FILTERS: LastResult[] = ["known", "fuzzy", "unknown"];
const PROGRESS_FILTERS: Progress[] = ["new", "learning", "done"];
const DEFAULT_PROGRESS_FILTER: Progress[] = ["learning", "done"];

// 並べ替えの順序。フィルタのチップの並び (○△× の読み順) とは別に持つ。
// 昇順は「まだ身についていない側」から始める。
// 前回結果: × → △ → ○ / 学習進捗度: 未学習 → 学習中 → 学習完了。
// 未回答 (前回結果なし) は -1 として × より前に置く
const RESULT_ORDER: LastResult[] = ["unknown", "fuzzy", "known"];
const PROGRESS_ORDER: Progress[] = ["new", "learning", "done"];

type ColType = "text" | "number" | "date" | "status";

// 列の定義 (見出し・ソートキー・並べ替えの表記に使う型)。
// 画面に出す順番は COLUMN_ORDER が持つ
const COLUMNS: Record<
  SortKey,
  { label: string; type: ColType; title?: string; align?: "center" }
> = {
  word: { label: "単語", type: "text" },
  meaning: { label: "意味", type: "text" },
  progress: { label: "学習進捗度", type: "status" },
  result: { label: "前回結果", type: "status" },
  known: { label: "○", type: "number", title: "○ と回答した回数", align: "center" },
  fuzzy: {
    label: "△",
    type: "number",
    title: "△ と回答した回数 (4択の正誤は問わない)",
    align: "center",
  },
  unknown: { label: "×", type: "number", title: "× と回答した回数", align: "center" },
  lastSeen: { label: "最終閲覧", type: "date" },
};

// 列の並び順。ここを書き換えれば表の並びが変わる
const COLUMN_ORDER: SortKey[] = [
  "word",
  "meaning",
  "progress",
  "result",
  "known",
  "fuzzy",
  "unknown",
  "lastSeen",
];

// シールを貼れる列 (中身を隠して自分でめくる、暗記用の使い方)
type SealColumn = "word" | "meaning";
const SEAL_COLUMNS: SealColumn[] = ["word", "meaning"];

// 並べ替えの向きの表記。分かりやすさを優先して昇順・降順で統一する
const DIR_LABEL = { asc: "昇順", desc: "降順" };

interface SortRule {
  key: SortKey;
  dir: SortDir;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "−";
  return new Date(iso).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Props {
  data: EnglishData;
  setData: React.Dispatch<React.SetStateAction<EnglishData>>;
}

// データベース一覧タブ。出題範囲の設定 (語彙 / イディオム / 両方) に従って読み込む
export function WordListView({ data, setData }: Props) {
  const settings = data.settings.vocab;
  const unit = settings.cardSource === "idioms" ? "個" : "語";
  const kindLabel = settings.cardSource === "idioms" ? "イディオム" : "単語";
  const [dbs, setDbs] = useState<WordDbMap | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [level, setLevel] = useState<LevelFilter>("all");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [detail, setDetail] = useState<{ def: WordDbEntry; level: Level } | null>(
    null,
  );

  // ツールバー (フィルタ / ソート / 検索)
  const [panel, setPanel] = useState<"filter" | "sort" | "search" | null>(null);
  const [query, setQuery] = useState("");
  const [fWord, setFWord] = useState("");
  const [fMeaning, setFMeaning] = useState("");
  // ステータスは複数選択 (空 = すべて)。既定は学習に関わるものだけ出し、未学習は隠す
  const [fResult, setFResult] = useState<LastResult[]>([]);
  const [fProgress, setFProgress] = useState<Progress[]>(
    DEFAULT_PROGRESS_FILTER,
  );
  const [fDateOp, setFDateOp] = useState<DateOp>("after");
  const [fDate, setFDate] = useState("");
  // 既定の並べ替え。まだ身についていないものが上に来るようにしておく
  // (前回結果 × から、次に学習進捗度の未学習から、同点なら単語のアルファベット順)
  const [sorts, setSorts] = useState<SortRule[]>([
    { key: "result", dir: "asc" },
    { key: "progress", dir: "asc" },
    { key: "word", dir: "asc" },
  ]);
  // シールを貼っている列と、めくり済みの単語
  const [sealed, setSealed] = useState<Record<SealColumn, boolean>>({
    word: false,
    meaning: false,
  });
  const [peeled, setPeeled] = useState<Record<SealColumn, Set<string>>>({
    word: new Set(),
    meaning: new Set(),
  });

  useEffect(() => {
    let cancelled = false;
    setDbs(null);
    setDbError(null);
    fetchAllWordDbs(settings.cardSource)
      .then((d) => {
        if (!cancelled) setDbs(d);
      })
      .catch((e) => {
        if (!cancelled) setDbError(e instanceof Error ? e.message : "読み込み失敗");
      });
    return () => {
      cancelled = true;
    };
  }, [settings.cardSource]);

  const rows = useMemo(() => {
    if (!dbs) return [];
    const levels: Level[] = level === "all" ? LEVEL_ORDER : [level];
    return levels.flatMap((lv) =>
      dbs[lv].words.map((w) => ({ def: w as WordDbEntry, level: lv })),
    );
  }, [dbs, level]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const w = fWord.trim().toLowerCase();
    const m = fMeaning.trim();
    const dateBound = fDate ? new Date(fDate) : null;

    const list = rows.filter(({ def }) => {
      const entry: VocabEntry | undefined = data.vocab[def.word];
      if (q && !def.word.toLowerCase().includes(q) && !def.meaningJa.includes(q)) {
        return false;
      }
      if (w && !def.word.toLowerCase().includes(w)) return false;
      if (m && !def.meaningJa.includes(m)) return false;
      if (fResult.length > 0) {
        const r = lastResult(entry);
        if (!r || !fResult.includes(r)) return false;
      }
      if (
        fProgress.length > 0 &&
        !fProgress.includes(progressOf(entry, settings.masterKnownCount))
      ) {
        return false;
      }
      if (dateBound) {
        if (!entry) return false;
        const seen = new Date(entry.lastSeenAt);
        if (fDateOp === "before" && !(seen < dateBound)) return false;
        if (fDateOp === "after" && !(seen > dateBound)) return false;
        if (fDateOp === "on") {
          const same =
            seen.getFullYear() === dateBound.getFullYear() &&
            seen.getMonth() === dateBound.getMonth() &&
            seen.getDate() === dateBound.getDate();
          if (!same) return false;
        }
      }
      return true;
    });

    if (sorts.length === 0) return list;
    const valueOf = (r: { def: WordDbEntry }, key: SortKey): string | number => {
      const e = data.vocab[r.def.word];
      switch (key) {
        case "word":
          return r.def.word.toLowerCase();
        case "meaning":
          return r.def.meaningJa;
        case "result": {
          const r = lastResult(e);
          return r ? RESULT_ORDER.indexOf(r) : -1;
        }
        case "progress":
          return PROGRESS_ORDER.indexOf(
            progressOf(e, settings.masterKnownCount),
          );
        case "known":
          return e?.knownCount ?? -1;
        case "fuzzy":
          return e?.unsureCount ?? -1;
        case "unknown":
          return e?.unknownCount ?? -1;
        case "lastSeen":
          return e ? new Date(e.lastSeenAt).getTime() : 0;
      }
    };
    // 先に指定した規則を優先し、同値なら次の規則で比べる (Notionと同じ順序)
    return [...list].sort((a, b) => {
      for (const rule of sorts) {
        const dir = rule.dir === "asc" ? 1 : -1;
        const va = valueOf(a, rule.key);
        const vb = valueOf(b, rule.key);
        const cmp =
          typeof va === "string" && typeof vb === "string"
            ? va.localeCompare(vb, "ja")
            : (va as number) - (vb as number);
        if (cmp !== 0) return cmp * dir;
      }
      return 0;
    });
  }, [
    rows,
    data.vocab,
    settings.masterKnownCount,
    query,
    fWord,
    fMeaning,
    fResult,
    fProgress,
    fDate,
    fDateOp,
    sorts,
  ]);

  const shown = filtered.slice(0, visible);
  const resetPage = () => setVisible(PAGE_SIZE);
  const activeFilters =
    (fWord ? 1 : 0) +
    (fMeaning ? 1 : 0) +
    (fResult.length > 0 ? 1 : 0) +
    (fProgress.length > 0 ? 1 : 0) +
    (fDate ? 1 : 0);

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs transition-colors ${
      active
        ? "border-[#4A99EA] bg-[#4A99EA]/10 text-[#4A99EA]"
        : "border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400"
    }`;

  const toolBtn = (on: boolean) =>
    `flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
      on
        ? "bg-[#4A99EA]/15 text-[#4A99EA]"
        : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
    }`;

  // ---- シール (中身を隠して、タップでめくる) ----

  const toggleSeal = (col: SealColumn) => {
    setSealed((s) => ({ ...s, [col]: !s[col] }));
    // 貼り直すときも剥がすときも、めくった記録はまっさらに戻す
    setPeeled((p) => ({ ...p, [col]: new Set() }));
  };

  const isSealed = (col: SealColumn, word: string) =>
    sealed[col] && !peeled[col].has(word);

  const peel = (col: SealColumn, word: string) =>
    setPeeled((p) => ({ ...p, [col]: new Set(p[col]).add(word) }));

  // 並べ替えの変更は下の「ソート」パネルからだけ。見出しは押しても何も起きない
  // (表を読んでいる最中や、シールをめくろうとした指が当たって並びが変わるのを防ぐ)。
  // 見出しには今どの規則で並んでいるかの表示だけ残す
  const addSort = () => {
    const used = new Set(sorts.map((r) => r.key));
    const next = COLUMN_ORDER.find((k) => !used.has(k));
    if (next) {
      setSorts([...sorts, { key: next, dir: "asc" }]);
      resetPage();
    }
  };

  const updateSort = (i: number, patch: Partial<SortRule>) => {
    setSorts(sorts.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    resetPage();
  };

  const removeSort = (i: number) => {
    setSorts(sorts.filter((_, j) => j !== i));
    resetPage();
  };

  if (dbError) {
    return (
      <div className="rounded-2xl border border-red-500/40 bg-white p-6 text-center text-sm text-red-500 dark:bg-black">
        {dbError}
      </div>
    );
  }

  if (!dbs) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 bg-white py-16 dark:border-zinc-800 dark:bg-black">
        <Loader2 className="animate-spin text-[#4A99EA]" size={28} />
        <p className="text-sm text-zinc-500">データベースを読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {detail && (
        <CardDetailSheet
          item={applyEdit(detail.def, data.edits[detail.def.word])}
          note={data.notes[detail.def.word]}
          onClose={() => setDetail(null)}
          onSaveEdit={(patch) =>
            setData((prev) => ({
              ...prev,
              edits: {
                ...prev.edits,
                [detail.def.word]: {
                  ...prev.edits[detail.def.word],
                  ...patch,
                },
              },
            }))
          }
          status={statusBadges(
            data.vocab[detail.def.word],
            settings.masterKnownCount,
          )}
          onSetResult={(next) =>
            setData((prev) =>
              setStatusOverride(prev, detail.def, detail.level, "result", next),
            )
          }
          onSetProgress={(next) =>
            setData((prev) =>
              setStatusOverride(
                prev,
                detail.def,
                detail.level,
                "progress",
                next,
              ),
            )
          }
          onSaveNote={(text) =>
            setData((prev) => {
              const notes = { ...prev.notes };
              if (text) notes[detail.def.word] = text;
              else delete notes[detail.def.word];
              return { ...prev, notes };
            })
          }
        />
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm font-bold">
          {kindLabel}リスト
          <span className="ml-2 text-xs font-normal text-zinc-400">
            {filtered.length} {unit}
          </span>
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setPanel(panel === "filter" ? null : "filter")}
            aria-label="フィルタ"
            className={toolBtn(panel === "filter" || activeFilters > 0)}
          >
            <Filter size={18} />
          </button>
          <button
            onClick={() => setPanel(panel === "sort" ? null : "sort")}
            aria-label="ソート"
            className={toolBtn(panel === "sort" || sorts.length > 0)}
          >
            <ArrowDownUp size={18} />
            {sorts.length > 0 && (
              <span className="ml-0.5 text-[10px] font-bold">{sorts.length}</span>
            )}
          </button>
          <button
            onClick={() => setPanel(panel === "search" ? null : "search")}
            aria-label="検索"
            className={toolBtn(panel === "search" || query !== "")}
          >
            <Search size={18} />
          </button>
        </div>
      </div>

      {panel === "search" && (
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              resetPage();
            }}
            placeholder={`${kindLabel}・意味で検索`}
            className="w-full rounded-full border border-zinc-200 bg-transparent py-2 pl-8 pr-3 text-sm outline-none focus:border-[#4A99EA] dark:border-zinc-700"
          />
        </div>
      )}

      {panel === "filter" && (
        <div className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
          <div>
            <label className="mb-1 block text-xs text-zinc-500">レベル</label>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => {
                  setLevel("all");
                  resetPage();
                }}
                className={chip(level === "all")}
              >
                全レベル
              </button>
              {LEVELS.map((l) => (
                <button
                  key={l.key}
                  onClick={() => {
                    setLevel(l.key);
                    resetPage();
                  }}
                  className={chip(level === l.key)}
                >
                  {l.key} ({dbs[l.key].count})
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">単語を含む</label>
            <input
              value={fWord}
              onChange={(e) => {
                setFWord(e.target.value);
                resetPage();
              }}
              className="w-full rounded-full border border-zinc-200 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-[#4A99EA] dark:border-zinc-700"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">意味を含む</label>
            <input
              value={fMeaning}
              onChange={(e) => {
                setFMeaning(e.target.value);
                resetPage();
              }}
              className="w-full rounded-full border border-zinc-200 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-[#4A99EA] dark:border-zinc-700"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">
              前回結果が一致 (複数選択可)
            </label>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => {
                  setFResult([]);
                  resetPage();
                }}
                className={chip(fResult.length === 0)}
              >
                すべて
              </button>
              {RESULT_FILTERS.map((st) => (
                <button
                  key={st}
                  onClick={() => {
                    setFResult(
                      fResult.includes(st)
                        ? fResult.filter((x) => x !== st)
                        : [...fResult, st],
                    );
                    resetPage();
                  }}
                  className={chip(fResult.includes(st))}
                >
                  {RESULT_BADGE[st].label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">
              学習進捗度が一致 (複数選択可)
            </label>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => {
                  setFProgress([]);
                  resetPage();
                }}
                className={chip(fProgress.length === 0)}
              >
                すべて
              </button>
              {PROGRESS_FILTERS.map((st) => (
                <button
                  key={st}
                  onClick={() => {
                    setFProgress(
                      fProgress.includes(st)
                        ? fProgress.filter((x) => x !== st)
                        : [...fProgress, st],
                    );
                    resetPage();
                  }}
                  className={chip(fProgress.includes(st))}
                >
                  {PROGRESS_BADGE[st].label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">最終閲覧</label>
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  ["before", "より前"],
                  ["after", "より後"],
                  ["on", "と一致"],
                ] as [DateOp, string][]
              ).map(([op, label]) => (
                <button
                  key={op}
                  onClick={() => {
                    setFDateOp(op);
                    resetPage();
                  }}
                  className={chip(fDateOp === op)}
                >
                  {label}
                </button>
              ))}
              <input
                type="date"
                value={fDate}
                onChange={(e) => {
                  setFDate(e.target.value);
                  resetPage();
                }}
                className="rounded-full border border-zinc-200 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-[#4A99EA] dark:border-zinc-700"
              />
            </div>
          </div>
          {activeFilters > 0 && (
            <button
              onClick={() => {
                setFWord("");
                setFMeaning("");
                setFResult([]);
                setFProgress([]);
                setFDate("");
                resetPage();
              }}
              className="flex items-center gap-1 text-xs text-zinc-500 underline"
            >
              <X size={12} /> フィルタを解除
            </button>
          )}
        </div>
      )}

      {panel === "sort" && (
        <div className="rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
          {sorts.length === 0 && (
            <p className="mb-2 px-1 text-xs text-zinc-500">
              並べ替えの規則がありません。上から順に優先して並べ替えます。
            </p>
          )}
          <div className="space-y-2">
            {sorts.map((rule, i) => {
              return (
                <div key={`${rule.key}-${i}`} className="flex items-center gap-2">
                  <span className="w-4 shrink-0 text-center text-[11px] text-zinc-400">
                    {i + 1}
                  </span>
                  <select
                    value={rule.key}
                    onChange={(e) =>
                      updateSort(i, { key: e.target.value as SortKey })
                    }
                    className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-[#4A99EA] dark:border-zinc-700 dark:bg-black"
                  >
                    {COLUMN_ORDER.map((k) => (
                      <option key={k} value={k}>
                        {COLUMNS[k].label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={rule.dir}
                    onChange={(e) =>
                      updateSort(i, { dir: e.target.value as SortDir })
                    }
                    className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-[#4A99EA] dark:border-zinc-700 dark:bg-black"
                  >
                    <option value="asc">{DIR_LABEL.asc}</option>
                    <option value="desc">{DIR_LABEL.desc}</option>
                  </select>
                  <button
                    onClick={() => removeSort(i)}
                    aria-label="この並べ替えを削除"
                    className="shrink-0 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                  >
                    <X size={16} />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="mt-2 space-y-1">
            {sorts.length < COLUMN_ORDER.length && (
              <button
                onClick={addSort}
                className="flex items-center gap-1.5 rounded-lg px-1 py-1 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              >
                <Plus size={15} /> 並べ替えを追加
              </button>
            )}
            {sorts.length > 0 && (
              <button
                onClick={() => {
                  setSorts([]);
                  resetPage();
                }}
                className="flex items-center gap-1.5 rounded-lg px-1 py-1 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              >
                <Trash2 size={15} /> 並べ替えを削除する
              </button>
            )}
          </div>
        </div>
      )}

      {/* overflow-x だけ auto にすると overflow-y も auto に格上げされ、
          縦に伸びない枠が縦スワイプを飲み込んで外側のスクロールに渡らなくなる。
          overflow-y を明示的に hidden にして、縦は外側のコンテナに任せる */}
      <div className="overflow-x-auto overflow-y-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black">
        {shown.length === 0 ? (
          <p className="p-6 text-center text-sm text-zinc-500">該当なし</p>
        ) : (
          <table className="w-full min-w-[820px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-zinc-200 text-[11px] text-zinc-400 dark:border-zinc-700">
                {COLUMN_ORDER.map((key) => {
                  const c = COLUMNS[key];
                  const sealCol = SEAL_COLUMNS.find((s) => s === key);
                  return (
                    <th
                      key={key}
                      title={c.title}
                      // 列名は途中で折り返さない (表は最小幅で横スクロールするので、
                      // 折り返すと見出しだけ2行になって行の高さが揺れる)
                      className={`select-none whitespace-nowrap px-3 py-2 font-medium ${
                        c.align === "center" ? "text-center" : ""
                      } ${sorts.some((r) => r.key === key) ? "text-[#4A99EA]" : ""}`}
                    >
                      <span className="inline-flex items-center gap-1">
                        {sealCol && (
                          <button
                            onClick={() => toggleSeal(sealCol)}
                            aria-label={`${c.label}にシールを貼る`}
                            aria-pressed={sealed[sealCol]}
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors ${
                              sealed[sealCol]
                                ? "bg-[#4A99EA] text-white"
                                : "text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                            }`}
                          >
                            <EyeOff size={12} />
                          </button>
                        )}
                        {c.label}
                        {(() => {
                          const i = sorts.findIndex((r) => r.key === key);
                          if (i < 0) return null;
                          return (
                            <>
                              {sorts[i].dir === "asc" ? (
                                <ArrowUp size={11} />
                              ) : (
                                <ArrowDown size={11} />
                              )}
                              {sorts.length > 1 && (
                                <span className="text-[9px]">{i + 1}</span>
                              )}
                            </>
                          );
                        })()}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {shown.map(({ def, level: lv }) => {
                const entry = data.vocab[def.word];
                const r = lastResult(entry);
                const resultBadge = r ? RESULT_BADGE[r] : null;
                const progressBadge =
                  PROGRESS_BADGE[progressOf(entry, settings.masterKnownCount)];
                const num = (n: number) =>
                  n === 0 ? (
                    <span className="text-zinc-300 dark:text-zinc-600">0</span>
                  ) : (
                    <span className="tabular-nums">{n}</span>
                  );
                const blank = <span className="text-zinc-300 dark:text-zinc-600">−</span>;
                // シールを貼っている列は中身を隠す。幅が動かないよう、
                // 中身は消さずに invisible にして、上からシールを重ねる
                const cell = (key: SortKey) => {
                  switch (key) {
                    case "word":
                      // 2行構成。1行目に単語とスピーカー、2行目に品詞・レベル。
                      // 1行に全部並べると長い語で横幅を食うので、縦に分ける (ユーザー指定)
                      return (
                        <span className="inline-flex flex-col gap-0.5">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="font-medium">{def.word}</span>
                            <button
                              type="button"
                              aria-label={`${def.word} を読み上げる`}
                              onClick={(e) => {
                                // 行のクリックはカード詳細を開くので、ここで止める
                                e.stopPropagation();
                                primeSpeech();
                                speak(def.word);
                              }}
                              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                            >
                              <Volume2 size={14} />
                            </button>
                          </span>
                          <span className="text-[10px] text-zinc-400">
                            {def.pos}・{lv}
                          </span>
                        </span>
                      );
                    case "meaning":
                      return data.edits[def.word]?.meaningJa ?? def.meaningJa;
                    case "result":
                      return resultBadge ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] ${resultBadge.cls}`}
                        >
                          {resultBadge.label}
                        </span>
                      ) : (
                        blank
                      );
                    case "progress":
                      return (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] ${progressBadge.cls}`}
                        >
                          {progressBadge.label}
                        </span>
                      );
                    case "known":
                      return entry ? num(entry.knownCount) : blank;
                    case "fuzzy":
                      return entry ? num(entry.unsureCount) : blank;
                    case "unknown":
                      return entry ? num(entry.unknownCount) : blank;
                    case "lastSeen":
                      return entry ? formatDateTime(entry.lastSeenAt) : blank;
                  }
                };
                const cellCls: Record<SortKey, string> = {
                  word: "whitespace-nowrap px-3 py-1.5",
                  meaning:
                    "max-w-[220px] truncate px-3 py-1.5 text-zinc-600 dark:text-zinc-300",
                  result: "whitespace-nowrap px-3 py-1.5",
                  progress: "whitespace-nowrap px-3 py-1.5",
                  known: "px-3 py-1.5 text-center",
                  fuzzy: "px-3 py-1.5 text-center",
                  unknown: "px-3 py-1.5 text-center",
                  lastSeen:
                    "whitespace-nowrap px-3 py-1.5 text-[12px] text-zinc-500",
                };
                return (
                  <tr
                    key={`${lv}-${def.word}`}
                    onClick={() => setDetail({ def, level: lv })}
                    className="cursor-pointer border-b border-zinc-100 transition-colors last:border-b-0 hover:bg-zinc-900/5 dark:border-zinc-800 dark:hover:bg-white/10"
                  >
                    {COLUMN_ORDER.map((key) => {
                      const sealCol = SEAL_COLUMNS.find((s) => s === key);
                      const covered = sealCol
                        ? isSealed(sealCol, def.word)
                        : false;
                      return (
                        <td
                          key={key}
                          className={`relative ${cellCls[key]}`}
                          onClick={
                            covered && sealCol
                              ? (e) => {
                                  // シールをめくるだけ。行のカード詳細は開かない
                                  e.stopPropagation();
                                  peel(sealCol, def.word);
                                }
                              : undefined
                          }
                        >
                          <span className={covered ? "invisible" : undefined}>
                            {cell(key)}
                          </span>
                          {covered && (
                            <span
                              aria-label="タップしてめくる"
                              className="seal inset-x-1.5 inset-y-1"
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {visible < filtered.length && (
        <button
          onClick={() => setVisible(visible + PAGE_SIZE)}
          className="w-full rounded-2xl border border-zinc-200 bg-white py-2.5 text-sm font-medium text-[#4A99EA] hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
        >
          さらに表示 (残り {filtered.length - visible} {unit})
        </button>
      )}
    </div>
  );
}
