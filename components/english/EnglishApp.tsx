"use client";

import { useEffect, useState } from "react";
import { BookOpen, FileText, PenLine, Settings } from "lucide-react";
import { EnglishData, EMPTY_DATA, Level, LEVELS } from "@/lib/english/types";
import { clearData, loadData, saveData } from "@/lib/english/storage";
import { SetupPanel } from "./SetupPanel";
import { VocabTab } from "./VocabTab";
import { GrammarTab } from "./GrammarTab";
import { ReadingTab } from "./ReadingTab";

type Tab = "vocab" | "grammar" | "reading" | "settings";

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: "vocab", label: "単語", icon: <BookOpen size={16} /> },
  { key: "grammar", label: "文法", icon: <PenLine size={16} /> },
  { key: "reading", label: "長文読解", icon: <FileText size={16} /> },
  { key: "settings", label: "設定", icon: <Settings size={16} /> },
];

export function EnglishApp() {
  const [data, setData] = useState<EnglishData>(EMPTY_DATA);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>("vocab");
  // 初期設定画面用の一時状態
  const [draftLevel, setDraftLevel] = useState<Level | null>(null);
  const [draftInterests, setDraftInterests] = useState<string[]>([]);

  useEffect(() => {
    setData(loadData());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) saveData(data);
  }, [data, loaded]);

  if (!loaded) {
    return (
      <div className="py-24 text-center text-sm text-zinc-500">読み込み中...</div>
    );
  }

  // 初期設定 (レベル未設定なら最初に選ばせる)
  if (data.settings.level === null) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">はじめに設定してください</h2>
        <p className="mb-5 mt-1 text-sm text-zinc-500">
          レベルと興味に合わせて、AIが単語・文法・長文の教材を自動生成します。あとから設定タブで変更できます。
        </p>
        <SetupPanel
          level={draftLevel}
          interests={draftInterests}
          onLevelChange={setDraftLevel}
          onInterestsChange={setDraftInterests}
        />
        <button
          disabled={draftLevel === null}
          onClick={() =>
            setData((prev) => ({
              ...prev,
              settings: { ...prev.settings, level: draftLevel, interests: draftInterests },
            }))
          }
          className="mt-6 w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          この設定ではじめる
        </button>
      </div>
    );
  }

  const levelDef = LEVELS.find((l) => l.key === data.settings.level);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex gap-1 overflow-x-auto rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors ${
                tab === t.key
                  ? "bg-white font-medium shadow-sm dark:bg-zinc-700"
                  : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
        <span className="ml-3 hidden shrink-0 text-xs text-zinc-400 sm:block">
          {levelDef ? `${levelDef.key} ${levelDef.label}` : ""}
        </span>
      </div>

      {tab === "vocab" && <VocabTab data={data} setData={setData} />}
      {tab === "grammar" && <GrammarTab data={data} setData={setData} />}
      {tab === "reading" && <ReadingTab data={data} setData={setData} />}
      {tab === "settings" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <SetupPanel
              level={data.settings.level}
              interests={data.settings.interests}
              onLevelChange={(level) =>
                setData((prev) => ({
                  ...prev,
                  settings: { ...prev.settings, level },
                }))
              }
              onInterestsChange={(interests) =>
                setData((prev) => ({
                  ...prev,
                  settings: { ...prev.settings, interests },
                }))
              }
            />
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h3 className="mb-1 text-sm font-medium">単語学習の設定</h3>
            <p className="mb-3 text-xs text-zinc-500">
              出題アルゴリズムのしきい値です。間違いが多い単語ほど頻繁に出題されます。
            </p>
            <div className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800">
              <span>
                現在の単語レベル:{" "}
                <span className="font-medium">
                  {data.vocabLevel.current ?? "未測定"}
                </span>
                <span className="block text-xs text-zinc-500">
                  最初の10問で測定し、直近の正解率で自動調整されます
                </span>
              </span>
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      "単語レベルを再測定します。学習記録は保持されます。よろしいですか？",
                    )
                  ) {
                    setData((prev) => ({
                      ...prev,
                      vocabLevel: { current: null, recent: [] },
                    }));
                  }
                }}
                className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-700"
              >
                再測定
              </button>
            </div>
            <div className="space-y-3">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  習得とみなす「知っている」回数
                  <span className="block text-xs text-zinc-500">
                    この回数以上「知っている」と答えた単語は出題から除外
                  </span>
                </span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={data.settings.vocab.masterKnownCount}
                  onChange={(e) => {
                    const v = Math.max(1, Math.min(10, Number(e.target.value) || 1));
                    setData((prev) => ({
                      ...prev,
                      settings: {
                        ...prev.settings,
                        vocab: { ...prev.settings.vocab, masterKnownCount: v },
                      },
                    }));
                  }}
                  className="w-20 rounded-lg border border-zinc-200 bg-transparent px-3 py-1.5 text-right text-sm outline-none focus:border-indigo-400 dark:border-zinc-700"
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  再出現までの日数
                  <span className="block text-xs text-zinc-500">
                    最終正解からこの日数が経過した単語は再び出題される
                  </span>
                </span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={data.settings.vocab.reviewIntervalDays}
                  onChange={(e) => {
                    const v = Math.max(1, Math.min(365, Number(e.target.value) || 1));
                    setData((prev) => ({
                      ...prev,
                      settings: {
                        ...prev.settings,
                        vocab: { ...prev.settings.vocab, reviewIntervalDays: v },
                      },
                    }));
                  }}
                  className="w-20 rounded-lg border border-zinc-200 bg-transparent px-3 py-1.5 text-right text-sm outline-none focus:border-indigo-400 dark:border-zinc-700"
                />
              </label>
            </div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h3 className="text-sm font-medium">学習データ</h3>
            <p className="mt-1 text-xs text-zinc-500">
              単語 {Object.keys(data.vocab).length} 語 / 文法{" "}
              {data.stats.grammarAnswered} 問 / 長文 {data.readings.length} 本の記録があります。
            </p>
            <button
              onClick={() => {
                if (window.confirm("学習記録をすべて削除します。よろしいですか？")) {
                  clearData();
                  setData(EMPTY_DATA);
                }
              }}
              className="mt-3 rounded-lg border border-rose-300 px-4 py-1.5 text-xs text-rose-600 hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-950"
            >
              学習データをリセット
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
