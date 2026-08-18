"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Database,
  ExternalLink,
  FileText,
  List,
  PenLine,
  Settings,
} from "lucide-react";
import { EnglishData, EMPTY_DATA, VocabAction } from "@/lib/english/types";
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
import { siteUrl } from "@/lib/english/net";
import {
  DEMO_EXPECTED,
  isDemoStep,
  isFinalStep,
  isWelcomeStep,
  STEP,
  TUTORIAL_STEP_COUNT,
  TutorialDemo,
  TutorialSpotlight,
  TutorialOverlay,
  TutorialWelcome,
  tutorialTabForStep,
} from "./TutorialFlow";
import { VocabTab } from "./VocabTab";
import { GrammarTab } from "./GrammarTab";
import { ReadingTab } from "./ReadingTab";
import { WordListView } from "./WordListView";
import { Sheet } from "./Sheet";
import { Wordmark } from "./Wordmark";
import { ConfirmButton } from "./ConfirmButton";
import { useAndroidBack } from "./useAndroidBack";
import { setSpeechRate } from "@/lib/english/speech";

// シールをめくってから次のステップへ進むまでの間。
// めくれた単語を読む時間を取る (この後、表が横へスクロールする)。
// この 1 秒は「いいですね。」に文言を差し替え、画面のどこも押させない
const PEEL_PAUSE_MS = 1000;

type Tab = "vocab" | "database" | "grammar" | "reading";
type SettingsView = "menu" | "data";

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: "vocab", label: "単語", icon: <BookOpen size={22} /> },
  { key: "database", label: "単語リスト", icon: <List size={22} /> },
  { key: "grammar", label: "文法", icon: <PenLine size={22} /> },
  { key: "reading", label: "読解", icon: <FileText size={22} /> },
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
  // Android の戻るボタン: 設定が開いていれば閉じる (アプリごと終了させない)
  useAndroidBack(settingsOpen, closeSettings);
  // タブを切り替えたら中身のスクロールを先頭へ戻す
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
  }, [tab]);
  // チュートリアル。初回 (tutorialDone が false) は自動で始まり、設定からも見直せる。
  // ステップをここで持つのは、タブを切り替えるためと、達成条件の判定に data が要るため。
  // 各ステップの意味は TutorialFlow の STEP を見る (番号は直書きしない)
  const [tourStep, setTourStep] = useState<number | null>(null);
  // 演習のステップ (13) に入った時点の総回答数。ここから1つでも増えたら達成とみなす。
  // 回数そのものを見るので、どのカードにどう答えたかは問わない
  const [tourAnswerMark, setTourAnswerMark] = useState(0);
  // シールを1枚めくった直後の短い間だけ true。文言を褒め言葉に差し替え、
  // 画面を止めてから次のステップへ送る
  const [sealPeeled, setSealPeeled] = useState(false);
  const answerCount = useMemo(
    () =>
      Object.values(data.vocab).reduce(
        (n, e) => n + e.knownCount + e.unsureCount + e.unknownCount,
        0,
      ),
    [data.vocab],
  );
  const goTourStep = (n: number) => {
    if (n >= TUTORIAL_STEP_COUNT) {
      finishTutorial();
      return;
    }
    const next = Math.max(0, n);
    setTourStep(next);
    setSealPeeled(false);
    // 演習のステップは「入ってから1語答える」が条件なので、入った時点で基準を取る。
    // 測定の10問がすでに数に入っているため、基準を取らずに総数を見ると最初から達成扱いになる
    // 「入ってから1回操作する」が条件のステップは、入った時点で基準を取る。
    // 基準を取らずに総数を見ると、それまでの回答のせいで最初から達成扱いになる
    if (next === STEP.reviewUnsure) setTourAnswerMark(answerCount);
    // タブのステップに入った瞬間、そのタブへ切り替える。
    // 以後ユーザーが他のタブを覗くのは自由 (強制的に戻したりしない)
    const target = tutorialTabForStep(next);
    if (target) setTab(target);
  };
  const finishTutorial = () => {
    setTourStep(null);
    setTab("vocab");
    setData((prev) => ({ ...prev, tutorialDone: true }));
  };
  const measured = data.vocabLevel.current !== null;
  const answered = answerCount > tourAnswerMark;
  // **測定中はボトムナビと歯車を塞ぐ。** 他のステップはスポットライトの板が
  // 画面を覆うので勝手に塞がるが、10問のあいだだけは対象が見つからず
  // 板が出ないので、ここだけ素通しになっていた。タブを移ると VocabTab ごと
  // アンマウントされて答えた分が丸ごと消える (docs の既知課題)
  const tourLockChrome = tourStep === STEP.placement && !measured;
  // **チュートリアル中の戻るボタンは何もしない。** 何も登録しないとアプリごと終了し、
  // 初回の利用者が最初の1分で落とすことになる。かといって戻るで飛ばしてしまうのも
  // 乱暴なので、進めるのは画面上の「スキップ」だけにする
  useAndroidBack(tourStep !== null, () => {});
  const tourNav = tourStep !== null && {
    step: tourStep,
    measured,
    answered,
    sealPeeled,
    masterCount: data.settings.vocab.masterKnownCount,
    onNext: () => goTourStep(tourStep + 1),
    onSkip: finishTutorial,
  };

  // デモの回答。待っている回答が来たら、そのまま次のステップへ送る。
  // 入力方法 (ボタン / スワイプ) は見ない。Spotlight の穴がその時できる操作を
  // 1つに限定しているので、区別する必要がそもそも無い
  // 暗記シールの演習。貼った / めくった操作から直に呼ばれるので、
  // 効果を挟まずそのまま次のステップへ送れる
  const onSealAction = (kind: "seal" | "peel") => {
    if (tourStep === STEP.sealOn && kind === "seal") goTourStep(STEP.sealPeel);
    // **めくったら少し置いてから進める。** 次のステップは学習進捗度の列を指すので
    // 表が右へスクロールする。すぐ進めると、めくれた単語を見る前に画面が動いて
    // 「めくれたのかどうか分からない」状態になる (ユーザー報告)
    if (tourStep === STEP.sealPeel && kind === "peel") {
      setSealPeeled(true);
      window.setTimeout(() => {
        // 待っているあいだにスキップされたり戻られたりしたら何もしない。
        // 関数更新で今の値を見るので、古い値を掴む心配がない。
        // **どちらも単語リストのタブなので setTab は要らない。**
        // 順番を入れ替えるときはここも見直すこと
        setTourStep((cur) =>
          cur === STEP.sealPeel ? STEP.progressColumn : cur,
        );
        setSealPeeled(false);
      }, PEEL_PAUSE_MS);
    }
  };
  // 先頭行を押して単語詳細が開いた瞬間
  const onDetailOpen = () => {
    if (tourStep === STEP.firstRow) goTourStep(STEP.detail);
  };
  // 「単語の設定」を開いた瞬間
  const onFilterOpen = () => {
    if (tourStep === STEP.cardSettings) goTourStep(STEP.filterSection);
  };
  // 復習タブへ切り替えた瞬間
  const onModeChange = (m: "drill" | "review") => {
    if (tourStep === STEP.toReview && m === "review")
      goTourStep(STEP.reviewBasics);
  };
  // 右上の ↓ で自分で閉じた瞬間。**「次へ」で勝手に閉じない。**
  // 画面が急に単語リストへ戻ると驚かせるので、閉じる操作はユーザーに委ねる
  const onDetailClose = () => {
    if (tourStep === STEP.detailClose) goTourStep(STEP.sealOn);
  };

  const onDemoAction = (a: VocabAction) => {
    if (tourStep === null || !isDemoStep(tourStep)) return;
    if (DEMO_EXPECTED[tourStep] === a) goTourStep(tourStep + 1);
  };

  // 操作で進むステップの自動進行。デモと違って達成が data の変化として届くので、
  // 描画の外で拾うしかない。ステップ4は10問を終えた瞬間、ステップ16は △ で答えた瞬間。
  // 「望みの行動を達成したら次へを押さずに進む」というユーザーの指定
  useEffect(() => {
    // VocabTab の props は data と setData の2つだけという決まりなので、
    // 「10問終わった」「1語答えた」を直接受け取る口が無い。data の変化として
    // 拾うしかなく、ここは set-state-in-effect が本来想定している
    // 「外部の状態の変化に同期する」用途にあたる。
    // 条件は tourStep で1回しか通らないので、連鎖描画にはならない
    /* eslint-disable react-hooks/set-state-in-effect */
    if (tourStep === STEP.placement && measured)
      goTourStep(STEP.placementResult);
    if (tourStep === STEP.reviewUnsure && answered)
      goTourStep(STEP.cardSettings);
    /* eslint-enable react-hooks/set-state-in-effect */
    // goTourStep は毎レンダー新しい関数になるが、発火の条件は上の3つだけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourStep, measured, answered]);

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
            <ChevronRight
              size={16}
              className="ml-auto shrink-0 text-zinc-400"
            />
          </button>
        ))}
        <button
          onClick={() => {
            closeSettings();
            goTourStep(STEP.welcome);
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

      {/* **アプリの中からもポリシーとサポートへ行けるようにする。**
          両ストアとも掲載情報として URL を出すが、アプリ内にも導線が無いと
          「アプリ内で連絡手段が見つからない」という指摘を受けうる。
          **開くのは同梱物ではなく公開URL**（`target="_blank"`）。
          ネイティブ版は端末内の写しを持っているので、そちらを開くと
          内容を直したときに古い文面が残り、掲載URLと食い違う */}
      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black">
        {(
          [
            {
              href: siteUrl("/english/privacy"),
              title: "プライバシーポリシー",
            },
            {
              href: siteUrl("/english/support"),
              title: "サポート・お問い合わせ",
            },
          ] as const
        ).map((row) => (
          <a
            key={row.href}
            href={row.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center gap-3 border-b border-zinc-100 px-4 py-4 text-left last:border-b-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
          >
            <span className="text-sm font-medium">{row.title}</span>
            <ExternalLink
              size={15}
              className="ml-auto shrink-0 text-zinc-400"
            />
          </a>
        ))}
      </div>
    </div>
  );

  // 単語レベルの表示と再測定は「単語の設定」(カード画面の左上) へ移した。
  // 難易度の設定と同じ場所にあるほうが探しやすいため。
  // ここに残るのは、読解が使う興味テーマだけ
  const settingsData = (
    <div className="space-y-4">
      <SubHeader title="学習データ" onBack={() => setSettingsView("menu")} />
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-black">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          単語 {Object.keys(data.vocab).length} 語 / 文法{" "}
          {data.stats.grammarAnswered} 問 / 長文 {data.readings.length}{" "}
          本の記録があります。
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
        // **backdrop-blur は使わない。** 地色が黒で、下の中身はここを通り抜けない
        // (スクロールするのは header と nav に挟まれたコンテナだけ) のでぼかしは
        // 見た目に何も足さず、合成の層を1枚増やすだけだった。
        // (閉じる ↓ の白が割れて見えた件は当初これを疑ったが外しても変わらず、
        //  正体はボタン自体への UA の描画だった。globals.css を見ること)
        className="flex shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4 pb-3 dark:border-zinc-800 dark:bg-black"
      >
        {/* ワードマーク。**アイコンと同じアウトライン**を使うので、
            ホーム画面のアイコンと画面の中で字が食い違わない (Wordmark.tsx)。
            高さで指定して幅は縦横比 (2.025) に任せる。
            **h-5 (20px) では小さすぎた** — 幅40pxで、元の「英語学習」(約80px) の半分。
            ワードマークは `g` の下がりを高さに含むので、同じ px でも
            文字より見た目が小さくなる。ヘッダーの内容高は歯車ボタンと同じ36pxなので、
            h-7 (28px) で上下に4pxずつ余る */}
        <h1 className="flex items-center">
          <Wordmark className="h-7 w-auto" />
        </h1>
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
          disabled={tourLockChrome}
          className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:pointer-events-none disabled:opacity-30 ${
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
        {tab === "vocab" && (
          <VocabTab
            data={data}
            setData={setData}
            // チュートリアル中はカード右下の ↑ を出さない。
            // 開くと CardDetailSheet がスポットライトの板の下に潜って詰む
            tourActive={tourStep !== null}
            // 復習の説明に入るとき、学習中の語が無ければサンプルを1枚出す
            tourSampleReview={tourStep !== null && tourStep >= STEP.toReview}
            onModeChange={onModeChange}
            onFilterOpen={onFilterOpen}
            // 設定のステップを抜けたら閉じる。開いたままだと締めの画面の裏に残る
            hideFilter={tourStep !== null && tourStep > STEP.swipeSection}
            // 説明している大分類だけを開く
            tourOpenSection={
              tourStep === STEP.filterSection
                ? "filter"
                : tourStep === STEP.swipeSection
                  ? "swipe"
                  : null
            }
          />
        )}
        {tab === "database" && (
          <WordListView
            data={data}
            setData={setData}
            onSealAction={onSealAction}
            onDetailOpen={onDetailOpen}
            onDetailClose={onDetailClose}
            // 詳細のステップ (8〜9) を抜けても開いたままなら閉じる。
            // 通常は 9 でユーザー自身が ↓ を押して閉じるので、これは保険。
            // チュートリアル中だけの制御で、終わったら手を出さない
            hideDetail={tourStep !== null && tourStep > STEP.detailClose}
          />
        )}
        {tab === "grammar" && <GrammarTab data={data} setData={setData} />}
        {tab === "reading" && <ReadingTab data={data} setData={setData} />}
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
        {settingsView === "menu" ? settingsMenu : settingsData}
      </Sheet>

      {/* X風のボトムナビ (アクティブは前景色+太字、色は使わない)。
          fixed ではなくシェルの最下段に置く。fixed だとビューポートの高さ変動に追随して動いてしまう */}
      <nav
        // ヘッダーと同じ理由で backdrop-blur を外す (合成の境目を作らない)
        className="relative z-40 shrink-0 border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black"
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
                disabled={tourLockChrome}
                // チュートリアルのスポットライトの対象 (単語リストを指すステップ)
                data-tour={t.key === "database" ? "nav-database" : undefined}
                className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 transition-colors disabled:pointer-events-none disabled:opacity-30 ${
                  active
                    ? "text-zinc-900 dark:text-white"
                    : "text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
                }`}
              >
                {t.icon}
                {/* 選択中は太字にするが、太字ぶんの幅を常に確保しておく。
                    そうしないと選んだ瞬間にラベルの幅が変わってタブがずれる */}
                {/* 常に見えるラベルなので、最小級の 10px からは上げる。
                    タブが4つになって横幅に余裕ができたぶんを回す */}
                <span className="grid text-[11px]">
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

      {/* 答え方のデモ (z-[60])。本物の WordCard を出すだけの全画面で、
          何をすればよいかの指示はこの上のスポットライトが受け持つ */}
      {tourNav && isWelcomeStep(tourNav.step) && (
        <TutorialWelcome {...tourNav} />
      )}
      {tourNav && isDemoStep(tourNav.step) && (
        <TutorialDemo onAction={onDemoAction} />
      )}
      {/* 締めの全画面 (z-[60])。閉じた瞬間にそのまま単語タブが出る */}
      {tourNav && isFinalStep(tourNav.step) && <TutorialOverlay {...tourNav} />}
      {/* スポットライト (z-[65])。デモの上にも実画面の上にも同じものを重ねる。
          暗い部分がタップを吸い、穴だけが押せるので、穴の位置が
          そのまま「次にできる操作」の限定になる */}
      {tourNav &&
        !isFinalStep(tourNav.step) &&
        !isWelcomeStep(tourNav.step) && <TutorialSpotlight {...tourNav} />}
    </div>
  );
}
