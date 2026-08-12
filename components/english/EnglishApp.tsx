"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Database,
  FileText,
  GraduationCap,
  List,
  MessagesSquare,
  PenLine,
  Settings,
} from "lucide-react";
import {
  EnglishData,
  EMPTY_DATA,
  Level,
} from "@/lib/english/types";
import { clearData, loadData, saveData } from "@/lib/english/storage";
import { SetupPanel } from "./SetupPanel";
import { VocabTab } from "./VocabTab";
import { GrammarTab } from "./GrammarTab";
import { ReadingTab } from "./ReadingTab";
import { WordListView } from "./WordListView";
import { ChatTab } from "./ChatTab";
import { Sheet } from "./Sheet";
import { ConfirmButton } from "./ConfirmButton";

type Tab = "vocab" | "database" | "grammar" | "reading" | "chat";
type SettingsView = "menu" | "vocab" | "data";

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: "vocab", label: "単語", icon: <BookOpen size={22} /> },
  { key: "database", label: "単語リスト", icon: <List size={22} /> },
  { key: "grammar", label: "文法", icon: <PenLine size={22} /> },
  { key: "reading", label: "読解", icon: <FileText size={22} /> },
  { key: "chat", label: "AI会話", icon: <MessagesSquare size={22} /> },
];

// 設定サブ画面の共通ヘッダー
function SubHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <button
        onClick={onBack}
        className="flex items-center gap-0.5 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
      >
        <ChevronLeft size={18} /> 設定
      </button>
      <span className="text-sm font-semibold">{title}</span>
    </div>
  );
}

export function EnglishApp() {
  const [data, setData] = useState<EnglishData>(EMPTY_DATA);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>("vocab");
  // 設定は下タブではなく、ヘッダーの歯車から上に降りてくるポップアップ
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsView, setSettingsView] = useState<SettingsView>("menu");

  const closeSettings = () => setSettingsOpen(false);
  // タブを切り替えたら中身のスクロールを先頭へ戻す
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
  }, [tab]);
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
      <div className="px-4 py-24 text-center text-sm text-zinc-500">
        読み込み中...
      </div>
    );
  }

  // 初期設定 (レベル未設定なら最初に選ばせる)
  if (data.settings.level === null) {
    return (
      <div className="m-4 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-black">
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
          className="mt-6 w-full rounded-lg bg-[#4A99EA] py-2.5 text-sm font-medium text-white hover:bg-[#3d87d4] disabled:cursor-not-allowed disabled:opacity-40"
        >
          この設定ではじめる
        </button>
      </div>
    );
  }

  const settingsMenu = (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black">
        {(
          [
            {
              view: "vocab" as SettingsView,
              icon: <GraduationCap size={18} className="text-[#4A99EA]" />,
              title: "単語学習の設定",
              desc: "単語レベルの確認と再測定",
            },
            {
              view: "data" as SettingsView,
              icon: <Database size={18} className="text-[#4A99EA]" />,
              title: "学習データ",
              desc: "記録の確認とリセット",
            },
          ] as const
        ).map((row) => (
          <button
            key={row.view}
            onClick={() => setSettingsView(row.view)}
            className="flex w-full items-center gap-3 border-b border-zinc-100 px-4 py-4 text-left last:border-b-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
          >
            {row.icon}
            <span className="text-sm font-medium">
              {row.title}
              <span className="mt-0.5 block text-xs font-normal text-zinc-500">
                {row.desc}
              </span>
            </span>
            <ChevronRight size={16} className="ml-auto shrink-0 text-zinc-400" />
          </button>
        ))}
      </div>
    </div>
  );

  const settingsVocab = (
    <div className="space-y-4">
      <SubHeader title="単語学習の設定" onBack={() => setSettingsView("menu")} />
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-black">
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800">
          <span>
            現在の単語レベル:{" "}
            <span className="font-medium">{data.vocabLevel.current ?? "未測定"}</span>
            <span className="block text-xs text-zinc-500">
              最初の10問で測定し、直近の正解率で自動調整されます
            </span>
          </span>
          <ConfirmButton
            label="再測定"
            question="レベルを測り直しますか？ (学習記録は残ります)"
            confirmLabel="測り直す"
            className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-700"
            onConfirm={() =>
              setData((prev) => ({
                ...prev,
                vocabLevel: { current: null, recent: [] },
              }))
            }
          />
        </div>
        <div className="space-y-3">
          <p className="rounded-2xl border border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800">
            出題範囲 (語彙 / イディオム) と出題条件、スワイプ時の表示項目は、カード画面の左上のボタン「スワイプ設定」から変更します。
          </p>
        </div>
      </div>
    </div>
  );

  const settingsData = (
    <div className="space-y-4">
      <SubHeader title="学習データ" onBack={() => setSettingsView("menu")} />
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-black">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          単語 {Object.keys(data.vocab).length} 語 / 文法 {data.stats.grammarAnswered}{" "}
          問 / 長文 {data.readings.length} 本の記録があります。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ConfirmButton
            label="学習データをリセット"
            question="学習記録をすべて削除しますか？"
            confirmLabel="削除する"
            className="rounded-lg border border-red-500/60 px-4 py-1.5 text-xs text-red-500 hover:bg-red-500/10"
            onConfirm={() => {
              clearData();
              setData(EMPTY_DATA);
              setSettingsView("menu");
            }}
          />
        </div>
      </div>
    </div>
  );

  return (
    // アプリシェル。ページは一切スクロールさせず、中身のコンテナだけをスクロールさせる。
    // ページが縦横にスクロールできる状態になると、ビューポートの高さが再計算されて
    // ボトムナビが一瞬ずれる (実機ではURLバーの開閉も走る) ため
    <div className="flex h-full min-h-0 flex-col">
      {/* ヘッダー。設定は下タブではなくここの歯車から開く */}
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-200 bg-white/85 px-4 py-3 backdrop-blur-md dark:border-zinc-800 dark:bg-black/85">
        <h1 className="text-xl font-bold tracking-tight">英語学習</h1>
        <button
          onClick={() => {
            if (settingsOpen) {
              closeSettings();
              return;
            }
            setSettingsView("menu");
            setSettingsOpen(true);
          }}
          aria-label="設定"
          aria-expanded={settingsOpen}
          className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
            settingsOpen
              ? "bg-zinc-900 text-white dark:bg-white dark:text-black"
              : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
          }`}
        >
          <Settings size={20} />
        </button>
      </header>

      {/* 唯一のスクロールコンテナ。横は常に遮断する (スライド演出のはみ出し対策) */}
      <div
        ref={contentRef}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4"
      >
      {tab === "vocab" && <VocabTab data={data} setData={setData} />}
      {tab === "database" && <WordListView data={data} setData={setData} />}
      {tab === "grammar" && <GrammarTab data={data} setData={setData} />}
      {tab === "reading" && <ReadingTab data={data} setData={setData} />}
      {tab === "chat" && <ChatTab data={data} setData={setData} />}
      </div>

      {/* 設定はヘッダーの裏から降りてくる */}
      <Sheet
        side="top"
        open={settingsOpen}
        onClose={closeSettings}
        top={61}
        bottom={"calc(76px + env(safe-area-inset-bottom))"}
      >
        {settingsView === "menu"
          ? settingsMenu
          : settingsView === "vocab"
            ? settingsVocab
            : settingsData}
      </Sheet>

      {/* X風のボトムナビ (アクティブは前景色+太字、色は使わない)。
          fixed ではなくシェルの最下段に置く。fixed だとビューポートの高さ変動に追随して動いてしまう */}
      <nav
        className="relative z-40 shrink-0 border-t border-zinc-200 bg-white/85 backdrop-blur-md dark:border-zinc-800 dark:bg-black/85"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto flex max-w-2xl items-stretch justify-around">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => {
                  setTab(t.key);
                  closeSettings();
                }}
                className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 transition-colors ${
                  active
                    ? "text-zinc-900 dark:text-white"
                    : "text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
                }`}
              >
                {t.icon}
                {/* 選択中は太字にするが、太字ぶんの幅を常に確保しておく。
                    そうしないと選んだ瞬間にラベルの幅が変わってタブがずれる */}
                <span className="grid text-[10px]">
                  <span
                    aria-hidden
                    className="invisible col-start-1 row-start-1 font-bold"
                  >
                    {t.label}
                  </span>
                  <span
                    className={`col-start-1 row-start-1 ${active ? "font-bold" : ""}`}
                  >
                    {t.label}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
