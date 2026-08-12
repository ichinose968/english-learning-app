"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Filter,
  Loader2,
  Plus,
  Search,
  Trash2,
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
  STATUS_BADGE,
  WordDbMap,
  WordStatus,
  wordStatus,
} from "@/lib/english/worddb";
import { setStatusOverride } from "@/lib/english/progress";
import { CardDetailSheet } from "./CardDetailSheet";

const PAGE_SIZE = 100;

type LevelFilter = Level | "all";
type SortKey =
  | "word"
  | "status"
  | "meaning"
  | "known"
  | "unsureCorrect"
  | "unsureWrong"
  | "unknown"
  | "lastSeen";
type SortDir = "asc" | "desc";
type DateOp = "before" | "after" | "on";

// 既定で表示するステータス。未学習と再出現待ちは外して、学習中の語に集中できるようにする
const DEFAULT_STATUS_FILTER: WordStatus[] = [
  "learning",
  "review",
  "mastered",
  "preknown",
];

// フィルタに出すステータス。再出現待ちは「再出現までの日数」を設定したときだけ
// 現れる状態で、既定 (設定しない) では該当が0件なので選択肢に出さない
const FILTER_STATUSES: WordStatus[] = [
  "new",
  "learning",
  "review",
  "mastered",
  "preknown",
];

// 並べ替えのときの順序。こちらは全状態を持つ
const STATUS_ORDER: WordStatus[] = [
  "new",
  "learning",
  "review",
  "stale",
  "mastered",
  "preknown",
];

type ColType = "text" | "number" | "date" | "status";

// 列の定義 (見出し・ソートキー・並べ替えの表記に使う型)
const COLUMNS: {
  key: SortKey;
  label: string;
  type: ColType;
  title?: string;
  align?: "center";
}[] = [
  { key: "word", label: "単語", type: "text" },
  { key: "status", label: "ステータス", type: "status" },
  { key: "meaning", label: "意味", type: "text" },
  { key: "known", label: "○", type: "number", title: "Mastered と回答した回数", align: "center" },
  { key: "unsureCorrect", label: "?→○", type: "number", title: "Fuzzy → 4択で正解した回数", align: "center" },
  { key: "unsureWrong", label: "?→×", type: "number", title: "Fuzzy → 4択で誤答した回数", align: "center" },
  { key: "unknown", label: "×", type: "number", title: "New と回答した回数", align: "center" },
  { key: "lastSeen", label: "最終閲覧", type: "date" },
];

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
  const [fStatus, setFStatus] = useState<WordStatus[]>(DEFAULT_STATUS_FILTER);
  const [fDateOp, setFDateOp] = useState<DateOp>("after");
  const [fDate, setFDate] = useState("");
  const [sorts, setSorts] = useState<SortRule[]>([]);

  const now = useMemo(() => new Date(), []);

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
      if (
        fStatus.length > 0 &&
        !fStatus.includes(wordStatus(entry, settings, now))
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
        case "status":
          return STATUS_ORDER.indexOf(wordStatus(e, settings, now));
        case "known":
          return e?.knownCount ?? -1;
        case "unsureCorrect":
          return e?.correctCount ?? -1;
        case "unsureWrong":
          return e?.wrongCount ?? -1;
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
    settings,
    now,
    query,
    fWord,
    fMeaning,
    fStatus,
    fDate,
    fDateOp,
    sorts,
  ]);

  const shown = filtered.slice(0, visible);
  const resetPage = () => setVisible(PAGE_SIZE);
  const activeFilters =
    (fWord ? 1 : 0) + (fMeaning ? 1 : 0) + (fStatus.length > 0 ? 1 : 0) + (fDate ? 1 : 0);

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

  // 見出しクリック: 先頭の規則ならの向きを反転、そうでなければその列だけの並べ替えにする
  const toggleSort = (key: SortKey) => {
    setSorts((prev) =>
      prev.length > 0 && prev[0].key === key
        ? [{ key, dir: prev[0].dir === "asc" ? "desc" : "asc" }, ...prev.slice(1)]
        : [{ key, dir: "asc" }],
    );
    resetPage();
  };

  const addSort = () => {
    const used = new Set(sorts.map((r) => r.key));
    const next = COLUMNS.find((c) => !used.has(c.key));
    if (next) {
      setSorts([...sorts, { key: next.key, dir: "asc" }]);
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
          status={{
            ...STATUS_BADGE[
              wordStatus(data.vocab[detail.def.word], settings, new Date())
            ],
            manual: data.vocab[detail.def.word]?.statusOverride ?? null,
          }}
          onSetStatus={(next) =>
            setData((prev) =>
              setStatusOverride(prev, detail.def, detail.level, next),
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
              ステータスが一致 (複数選択可)
            </label>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => {
                  setFStatus([]);
                  resetPage();
                }}
                className={chip(fStatus.length === 0)}
              >
                すべて
              </button>
              {FILTER_STATUSES.map((st) => (
                <button
                  key={st}
                  onClick={() => {
                    setFStatus(
                      fStatus.includes(st)
                        ? fStatus.filter((x) => x !== st)
                        : [...fStatus, st],
                    );
                    resetPage();
                  }}
                  className={chip(fStatus.includes(st))}
                >
                  {STATUS_BADGE[st].label}
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
                setFStatus([]);
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
                    {COLUMNS.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
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
            {sorts.length < COLUMNS.length && (
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
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    title={c.title}
                    onClick={() => toggleSort(c.key)}
                    className={`cursor-pointer select-none px-3 py-2 font-medium hover:text-zinc-600 dark:hover:text-zinc-200 ${
                      c.align === "center" ? "text-center" : ""
                    } ${sorts.some((r) => r.key === c.key) ? "text-[#4A99EA]" : ""}`}
                  >
                    <span className="inline-flex items-center gap-0.5">
                      {c.label}
                      {(() => {
                        const i = sorts.findIndex((r) => r.key === c.key);
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
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(({ def, level: lv }) => {
                const entry = data.vocab[def.word];
                const s = wordStatus(entry, settings, now);
                const badge = STATUS_BADGE[s];
                const num = (n: number) =>
                  n === 0 ? (
                    <span className="text-zinc-300 dark:text-zinc-600">0</span>
                  ) : (
                    <span className="tabular-nums">{n}</span>
                  );
                const blank = <span className="text-zinc-300 dark:text-zinc-600">−</span>;
                return (
                  <tr
                    key={`${lv}-${def.word}`}
                    onClick={() => setDetail({ def, level: lv })}
                    className="cursor-pointer border-b border-zinc-100 transition-colors last:border-b-0 hover:bg-zinc-900/5 dark:border-zinc-800 dark:hover:bg-white/10"
                  >
                    <td className="whitespace-nowrap px-3 py-1.5">
                      <span className="font-medium">{def.word}</span>
                      <span className="ml-1.5 text-[10px] text-zinc-400">
                        {def.pos}・{lv}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-1.5 text-zinc-600 dark:text-zinc-300">
                      {data.edits[def.word]?.meaningJa ?? def.meaningJa}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      {entry ? num(entry.knownCount) : blank}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      {entry ? num(entry.correctCount) : blank}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      {entry ? num(entry.wrongCount) : blank}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      {entry ? num(entry.unknownCount) : blank}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-[12px] text-zinc-500">
                      {entry ? formatDateTime(entry.lastSeenAt) : blank}
                    </td>
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
