"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { EnglishData, EMPTY_DATA } from "@/lib/english/types";
import {
  clearData,
  exportData,
  loadData,
  onStorageProblem,
  parseImport,
  replaceData,
  requestPersistentStorage,
  saveData,
  StorageProblem,
} from "@/lib/english/storage";
import { InterestsEditor } from "./InterestsEditor";
import {
  TUTORIAL_STEP_COUNT,
  TutorialBanner,
  TutorialOverlay,
  tutorialTabForStep,
} from "./TutorialFlow";
import { VocabTab } from "./VocabTab";
import { GrammarTab } from "./GrammarTab";
import { ReadingTab } from "./ReadingTab";
import { WordListView } from "./WordListView";
import { ChatTab } from "./ChatTab";
import { Sheet } from "./Sheet";
import { ConfirmButton } from "./ConfirmButton";
import { setSpeechRate } from "@/lib/english/speech";

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
  // チュートリアル。初回 (tutorialDone が false) は自動で始まり、設定からも見直せる。
  // ステップをここで持つのは、タブ体験のステップで実タブを切り替えるため。
  // 0=ようこそ / 1=カード操作デモ (全画面) / 2〜6=各タブの体験 (バナー) / 7=おわり (全画面)
  const [tourStep, setTourStep] = useState<number | null>(null);
  const goTourStep = (n: number) => {
    if (n >= TUTORIAL_STEP_COUNT) {
      finishTutorial();
      return;
    }
    const next = Math.max(0, n);
    setTourStep(next);
    // タブ体験のステップに入った瞬間、そのタブへ切り替える。
    // 以後ユーザーが他のタブを覗くのは自由 (強制的に戻したりしない)
    const target = tutorialTabForStep(next);
    if (target) setTab(target);
  };
  const finishTutorial = () => {
    setTourStep(null);
    setTab("vocab");
    setData((prev) => ({ ...prev, tutorialDone: true }));
  };
  const tourNav = tourStep !== null && {
    step: tourStep,
    measured: data.vocabLevel.current !== null,
    onNext: () => goTourStep(tourStep + 1),
    onBack: () => goTourStep(tourStep - 1),
    onSkip: finishTutorial,
  };

  // 保存に失敗したときだけ出す帯。学習記録は取り返しがつかないので、
  // 黙って失敗させない (元の実装は例外を投げっぱなしにしていた)
  const [storageProblem, setStorageProblem] = useState<StorageProblem | null>(
    null,
  );
  // 帯のぶんだけ設定シートの開始位置を下げる。シートは fixed で
  // ヘッダーの高さ (61) を直に渡しているので、間に何か挟まると重なる。
  // 文言が2〜3行に折り返すため高さは決め打ちにできず、実測する。
  //
  // **ref + useEffect ではなく callback ref で観測する。** このコンポーネントは
  // 読み込み中に早期 return するので、`[]` の useEffect は帯の入れ物がまだ
  // DOM に無いうちに一度走って終わってしまう (実際それで帯がシートの下に隠れた)。
  // setState は ResizeObserver のコールバックからだけ呼ぶ
  const [bannerH, setBannerH] = useState(0);
  const bannerObs = useRef<ResizeObserver | null>(null);
  const bannerRef = useCallback((el: HTMLDivElement | null) => {
    bannerObs.current?.disconnect();
    bannerObs.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setBannerH(el.offsetHeight));
    ro.observe(el);
    bannerObs.current = ro;
  }, []);

  useEffect(() => {
    let cancelled = false;
    onStorageProblem((p) => setStorageProblem(p));
    // ブラウザにこのオリジンのデータを追い出さないよう頼んでおく
    requestPersistentStorage();
    // IndexedDB は非同期。読み終わるまで下の「読み込み中...」を出す
    void loadData().then((d) => {
      if (cancelled) return;
      setData(d);
      setLoaded(true);
      // 初回だけチュートリアルを自動で始める
      if (!d.tutorialDone) setTourStep(0);
    });
    return () => {
      cancelled = true;
      onStorageProblem(null);
    };
  }, []);

  useEffect(() => {
    if (loaded) saveData(data);
  }, [data, loaded]);

  // 書き出し / 読み込み
  const importInputRef = useRef<HTMLInputElement>(null);
  const [transferMsg, setTransferMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const exportToFile = () => {
    try {
      const blob = new Blob([exportData(data)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // 日付だけのファイル名にする (端末をまたいで並べたときに順に並ぶ)
      a.download = `english-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setTransferMsg({ ok: true, text: "書き出しました。" });
    } catch {
      setTransferMsg({ ok: false, text: "書き出しに失敗しました。" });
    }
  };

  const importFromFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 同じファイルを選び直しても onChange が飛ぶようにする
    e.target.value = "";
    if (!file) return;
    try {
      const next = parseImport(await file.text());
      await replaceData(next);
      setData(next);
      setTransferMsg({
        ok: true,
        text: `読み込みました (単語 ${Object.keys(next.vocab).length} 語)。`,
      });
    } catch (err) {
      setTransferMsg({
        ok: false,
        text: err instanceof Error ? err.message : "読み込みに失敗しました。",
      });
    }
  };

  // 読み上げの速さは speech.ts が1つ持っている。設定の持ち主はここなので、
  // ここから同期する (各画面へ prop で配ると、渡し忘れた画面だけ既定に戻る)
  useEffect(() => {
    setSpeechRate(data.settings.vocab.speechRate);
  }, [data.settings.vocab.speechRate]);

  if (!loaded) {
    return (
      <div className="px-4 py-24 text-center text-sm text-zinc-500">
        読み込み中...
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
        <button
          onClick={() => {
            closeSettings();
            goTourStep(0);
          }}
          className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
        >
          <BookOpen size={18} className="text-[#4A99EA]" />
          <span className="text-sm font-medium">
            チュートリアル
            <span className="mt-0.5 block text-xs font-normal text-zinc-500">
              使い方をもう一度見る
            </span>
          </span>
          <ChevronRight size={16} className="ml-auto shrink-0 text-zinc-400" />
        </button>
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
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-black">
        <h3 className="text-sm font-medium">興味のあるテーマ</h3>
        <p className="mb-3 mt-0.5 text-xs text-zinc-500">
          長文読解とAI会話の「おまかせ」の題材に使われます。
        </p>
        <InterestsEditor
          interests={data.settings.interests}
          onChange={(interests) =>
            setData((prev) => ({
              ...prev,
              settings: { ...prev.settings, interests },
            }))
          }
        />
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

        {/* 書き出し / 読み込み。学習記録の唯一のバックアップ手段で、
            端末の紛失・ブラウザによるデータ退去・アプリ版 (別オリジンになる) への
            引っ越しのどれにもこれが要る */}
        <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <p className="text-xs leading-relaxed text-zinc-500">
            記録はこの端末のブラウザにだけ入っています。機種変更やデータ削除で消えるので、ときどき書き出しておいてください。
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={exportToFile}
              className="rounded-lg border border-zinc-300 px-4 py-1.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              書き出し
            </button>
            <button
              onClick={() => importInputRef.current?.click()}
              className="rounded-lg border border-zinc-300 px-4 py-1.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              読み込み
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={importFromFile}
            />
          </div>
          {transferMsg && (
            <p
              className={`mt-2 text-xs ${
                transferMsg.ok ? "text-[#4A99EA]" : "text-red-500"
              }`}
            >
              {transferMsg.text}
            </p>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <ConfirmButton
            label="学習データをリセット"
            question="学習記録をすべて削除しますか？"
            confirmLabel="削除する"
            className="rounded-lg border border-red-500/60 px-4 py-1.5 text-xs text-red-500 hover:bg-red-500/10"
            onConfirm={() => {
              void clearData().then(() => {
                setData(EMPTY_DATA);
                setSettingsView("menu");
              });
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
      {/* ヘッダー。設定は下タブではなくここの歯車から開く。
          ホーム画面から起動 (standalone) すると status-bar-style: black-translucent と
          viewportFit: cover の組み合わせで中身がステータスバーの下まで広がるので、
          その高さぶんだけ上に余白を足す。足さないと Dynamic Island 機 (59px) や
          ノッチ機 (47px) で題名と歯車が時計に潜る */}
      <header
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
        className="flex shrink-0 items-center justify-between border-b border-zinc-200 bg-white/85 px-4 pb-3 backdrop-blur-md dark:border-zinc-800 dark:bg-black/85"
      >
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

      {/* 保存できていないときだけ出す。学習記録は取り返しがつかないので、
          失敗を画面に出さないまま使わせない。閉じるボタンは付けない
          (直るまで出したままにする) */}
      <div ref={bannerRef} className="shrink-0">
        {storageProblem && (
          <div
            role="alert"
            className="border-b border-red-500/40 bg-red-500/10 px-4 py-2 text-xs leading-relaxed text-red-500"
          >
            {storageProblem === "conflict"
              ? "別のタブでこのアプリを開いています。そちらの学習記録を上書きしないよう、この画面では保存を止めました。片方を閉じて再読み込みしてください。"
              : storageProblem === "quota"
                ? "端末の保存容量が上限に達したため、学習記録を保存できませんでした。カードの背景画像を減らすと空きます。"
                : "学習記録を保存できませんでした。この画面を再読み込みしてください。"}
          </div>
        )}
      </div>

      {/* 唯一のスクロールコンテナ。横は常に遮断する (スライド演出のはみ出し対策) */}
      <div
        ref={contentRef}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4"
      >
      {/* タブ体験のステップでは、タブの中身の上に説明バナーを通常フローで置く
          (オーバーレイにするとカード画面の回答ボタンなどを覆ってしまう) */}
      {tourNav && tutorialTabForStep(tourNav.step) && (
        <TutorialBanner {...tourNav} />
      )}
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
        // ヘッダーの下から降ろす。ヘッダーは中身49px＋上下の余白で、
        // 上の余白だけセーフエリア (ノッチ/Dynamic Island) に合わせて伸びる。
        // 61 という数字はこの計算 (49 + 12) が畳まれたもの
        top={`calc(49px + max(0.75rem, env(safe-area-inset-top)) + ${bannerH}px)`}
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

      {/* 最初と最後だけ全画面 (z-[60])。閉じた瞬間にそのまま単語タブが出る */}
      {tourNav && !tutorialTabForStep(tourNav.step) && (
        <TutorialOverlay {...tourNav} />
      )}
    </div>
  );
}
