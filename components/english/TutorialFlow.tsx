"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  Gauge,
  PenLine,
  Sparkles,
} from "lucide-react";
import { CardFieldKey, WordDbEntry } from "@/lib/english/types";
import { statusBadges } from "@/lib/english/worddb";
import { EXIT_MS, FlyingCard, WordCard } from "./VocabTab";

// 初回チュートリアル。以前の「はじめに設定してください」(SetupPanel) と
// その後の単語力測定への一連のフローを、これで置き換えた。
//
// 説明はスライドで先に読ませるのではなく、**実際のタブを順に開いて体験させる**。
// - 全画面で出すのは最初 (ようこそ / カード操作デモ) と最後だけ。
//   カード操作デモは本物の WordCard を使い、回答は学習記録に一切残さない。
// - タブのステップ (単語 / 単語リスト / 文法 / 読解 / AI会話) では、実タブの上に
//   説明バナー (TutorialBanner) を出すだけで、画面はそのまま触れる。
//   単語のステップで本物の単語力測定 (10問) をそのまま実施する。
// - いつでもスキップでき、設定 (歯車) から何度でも見直せる。
//
// ステップは EnglishApp が持つ (タブの切り替えと絡むため)。ここは見た目だけ。

export const TUTORIAL_STEP_COUNT = 8;

// タブ体験のステップ → 開くタブ。全画面のステップ (0,1,7) は null
export function tutorialTabForStep(
  step: number,
): "vocab" | "database" | "grammar" | "reading" | "chat" | null {
  switch (step) {
    case 2:
      return "vocab";
    case 3:
      return "database";
    case 4:
      return "grammar";
    case 5:
      return "reading";
    case 6:
      return "chat";
    default:
      return null;
  }
}

interface Nav {
  step: number;
  // 単語レベルを測定済みか。文言を変える (未測定なら測定へ誘導する)
  measured: boolean;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

// デモ用のカード。DBから引かず、ここに固定で持つ (チュートリアルはDB読込を待たない)
const DEMO_ITEMS: WordDbEntry[] = [
  {
    word: "hello",
    pos: "間投詞",
    meaningJa: "こんにちは",
    distractors: ["さようなら", "ありがとう", "おやすみ"],
    exampleEn: "Hello! How are you?",
    exampleJa: "こんにちは！元気ですか？",
    ipa: "/həˈloʊ/",
  },
  {
    word: "water",
    pos: "名詞",
    meaningJa: "水",
    distractors: ["火", "土", "風"],
    exampleEn: "Can I have some water?",
    exampleJa: "お水をもらえますか？",
    ipa: "/ˈwɔːtər/",
  },
  {
    word: "apple",
    pos: "名詞",
    meaningJa: "りんご",
    distractors: ["みかん", "ぶどう", "もも"],
    exampleEn: "She ate an apple.",
    exampleJa: "彼女はりんごを食べた。",
    ipa: "/ˈæpl/",
  },
  {
    word: "smile",
    pos: "動詞",
    meaningJa: "ほほえむ",
    distractors: ["泣く", "怒る", "眠る"],
    exampleEn: "The baby smiled at me.",
    exampleJa: "赤ちゃんが私にほほえんだ。",
    ipa: "/smaɪl/",
  },
];

const DEMO_FIELDS: Record<CardFieldKey, boolean> = {
  word: true,
  ipa: true,
  pos: true,
  meaning: false,
  tags: false,
  example: false,
  related: false,
  note: false,
};

// カード操作デモの3つのゴール。順番に達成させる
const GOALS = [
  {
    icon: <ArrowRight size={16} />,
    text: "右へスワイプ = ○ 知っている",
    match: (a: string) => a === "known",
  },
  {
    icon: <ArrowLeft size={16} />,
    text: "左へスワイプ = × 知らない",
    match: (a: string) => a === "unknown",
  },
  {
    icon: <ArrowUp size={16} />,
    text: "上へスワイプ = △ 4択で確認",
    match: (a: string) => a === "unsure_correct" || a === "unsure_wrong",
  },
] as const;

function Row({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-zinc-900 p-4">
      <span className="mt-0.5 shrink-0 text-[#4A99EA]">{icon}</span>
      <span className="min-w-0 text-sm font-medium">
        {title}
        <span className="mt-0.5 block text-xs font-normal leading-relaxed text-zinc-400">
          {desc}
        </span>
      </span>
    </div>
  );
}

// ---- 全画面のステップ (0: ようこそ / 1: カード操作デモ / 7: おわり) ----

export function TutorialOverlay({ step, measured, onNext, onBack, onSkip }: Nav) {
  // ---- カード操作デモ ----
  const [goal, setGoal] = useState(0);
  const [demoIndex, setDemoIndex] = useState(0);
  const [flying, setFlying] = useState<(FlyingCard & { key: number })[]>([]);
  const flightRef = useRef(0);
  const allDone = goal >= GOALS.length;

  // 全ゴール達成から少し置いて次へ (飛んでいくカードを見せてから)
  useEffect(() => {
    if (!allDone || step !== 1) return;
    const id = window.setTimeout(onNext, 1100);
    return () => window.clearTimeout(id);
    // onNext は毎レンダー新しい関数になるが、発火は一度きりなので依存に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone, step]);

  const demoStatus = statusBadges(undefined, 3);
  const item = DEMO_ITEMS[demoIndex % DEMO_ITEMS.length];
  const nextItem = DEMO_ITEMS[(demoIndex + 1) % DEMO_ITEMS.length];

  // VocabTab と同じ「触れないコピー」方式。デモでも飛んでいく演出を本物と揃える
  const startFlight = (f: FlyingCard) => {
    flightRef.current += 1;
    const key = flightRef.current;
    setFlying((cur) => [...cur, { ...f, key }]);
    window.setTimeout(() => {
      setFlying((cur) => cur.filter((c) => c.key !== key));
    }, EXIT_MS + 80);
  };

  const noop = () => {};

  return (
    // PCでは本体と同じ列幅に収める (fixed は viewport 基準になるため)
    <div className="fixed inset-0 z-[60] mx-auto flex max-w-2xl flex-col bg-black text-zinc-100">
      <div className="flex shrink-0 items-center justify-between px-4 py-3">
        <span className="text-xs text-zinc-500">
          チュートリアル {step + 1} / {TUTORIAL_STEP_COUNT}
        </span>
        {step < TUTORIAL_STEP_COUNT - 1 && (
          <button
            onClick={onSkip}
            className="rounded-full px-3 py-1 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          >
            スキップ
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
        {step === 0 && (
          <div className="mx-auto w-full max-w-md">
            <div className="mb-4 flex flex-col items-center text-center">
              <span className="text-[#4A99EA]">
                <Sparkles size={30} />
              </span>
              <h2 className="mt-2 text-lg font-bold">ようこそ</h2>
              <p className="mt-1 text-xs text-zinc-400">
                レベルと興味に合わせて教材が自動で用意される英語学習アプリです
              </p>
            </div>
            <div className="space-y-2.5">
              <Row
                icon={<BookOpen size={18} />}
                title="スワイプで覚える単語カード"
                desc="7,000語以上の単語・イディオムを、めくって仕分けるだけ。間違いが多い単語ほどよく出てきます。"
              />
              <Row
                icon={<Gauge size={18} />}
                title="レベルは自動調整"
                desc="最初の10問で単語レベル (A1〜C1) を測定。以後も正解率に合わせて自動で上下します。"
              />
              <Row
                icon={<PenLine size={18} />}
                title="文法・読解・AI会話"
                desc="文法4択、あなた向けに生成される長文、英語での雑談まで。各タブを実際に触りながら案内します。"
              />
              <p className="pt-2 text-center text-xs text-zinc-500">
                まずはカードの操作から。実際に触って覚えましょう。
              </p>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="flex h-full min-h-0 flex-col">
            <div className="shrink-0 pb-3">
              <div className="mx-auto flex max-w-md flex-col gap-1.5">
                {GOALS.map((g, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      i < goal
                        ? "border-[#4A99EA]/40 text-zinc-500 line-through"
                        : i === goal
                          ? "border-[#4A99EA] bg-[#4A99EA]/10 font-bold text-[#4A99EA]"
                          : "border-zinc-800 text-zinc-500"
                    }`}
                  >
                    {i < goal ? <Check size={16} /> : g.icon}
                    {g.text}
                  </div>
                ))}
                <p className="text-center text-[11px] text-zinc-500">
                  下のボタンでも答えられます。ここでの回答は記録に残りません。
                </p>
              </div>
            </div>
            {allDone && (
              <p className="shrink-0 pb-2 text-center text-sm font-bold text-[#4A99EA]">
                ばっちりです！
              </p>
            )}
            {/* 本物の WordCard。記録系のコールバックはすべて空にしてある */}
            <div className="relative min-h-0 flex-1">
              <div className="absolute inset-0 flex flex-col">
                <WordCard
                  key={`demo-${demoIndex}`}
                  item={item}
                  note={undefined}
                  nextItem={nextItem}
                  nextNote={undefined}
                  skipReveal
                  showUnsure
                  cardFields={DEMO_FIELDS}
                  status={demoStatus}
                  onAction={(a) =>
                    setGoal((g) =>
                      g < GOALS.length && GOALS[g].match(a) ? g + 1 : g,
                    )
                  }
                  onNext={() => setDemoIndex((i) => i + 1)}
                  onFly={startFlight}
                  onSaveNote={noop}
                  onSaveEdit={noop}
                  onUndo={noop}
                  onSetResult={noop}
                  onSetProgress={noop}
                  settleButtons={flying.length > 0}
                />
              </div>
              {flying.map((f) => (
                <div
                  key={f.key}
                  aria-hidden
                  className="pointer-events-none absolute inset-0 z-30 flex flex-col"
                >
                  <WordCard
                    ghost
                    flyDir={f.dir}
                    flyFrom={f.from}
                    initialStep={f.step}
                    initialAction={f.action}
                    initialPicked={f.picked}
                    initialChoices={f.choices}
                    item={f.item}
                    note={f.note}
                    nextItem={undefined}
                    nextNote={undefined}
                    status={demoStatus}
                    cardFields={DEMO_FIELDS}
                    showUnsure
                    skipReveal={false}
                    onAction={noop}
                    onNext={noop}
                    onFly={noop}
                    onSaveNote={noop}
                    onSaveEdit={noop}
                    onUndo={noop}
                    onSetResult={noop}
                    onSetProgress={noop}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {step === TUTORIAL_STEP_COUNT - 1 && (
          <div className="mx-auto w-full max-w-md">
            <div className="mb-4 flex flex-col items-center text-center">
              <span className="text-[#4A99EA]">
                <Check size={30} />
              </span>
              <h2 className="mt-2 text-lg font-bold">準備完了！</h2>
              <p className="mt-1 text-xs text-zinc-400">
                チュートリアルはいつでも設定 (歯車) から見直せます
              </p>
            </div>
            <div className="space-y-2.5">
              {!measured && (
                <Row
                  icon={<Gauge size={18} />}
                  title="まずは単語力測定から"
                  desc="閉じると単語タブに測定画面が出ます。10問に答えるとあなたのレベルに合った出題が始まります。"
                />
              )}
              <Row
                icon={<Sparkles size={18} />}
                title="細かい設定はあとからでOK"
                desc="出題範囲や表示項目はカード画面左上の「スワイプ設定」、興味のあるテーマは設定 (歯車) から変えられます。"
              />
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 space-y-3 px-4 pb-6 pt-2">
        <Dots step={step} />
        <div className="mx-auto flex max-w-md items-center gap-3">
          {step > 0 && (
            <button
              onClick={onBack}
              className="rounded-full border border-zinc-700 px-5 py-2.5 text-sm text-zinc-300 hover:bg-zinc-900"
            >
              戻る
            </button>
          )}
          <button
            onClick={onNext}
            className="flex-1 rounded-full bg-[#4A99EA] py-2.5 text-sm font-bold text-white hover:bg-[#3d87d4]"
          >
            {step === TUTORIAL_STEP_COUNT - 1
              ? measured
                ? "閉じる"
                : "単語力測定へ"
              : "次へ"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Dots({ step }: { step: number }) {
  return (
    <div className="flex items-center justify-center gap-1.5">
      {Array.from({ length: TUTORIAL_STEP_COUNT }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 rounded-full transition-all ${
            i === step ? "w-5 bg-[#4A99EA]" : "w-1.5 bg-zinc-700"
          }`}
        />
      ))}
    </div>
  );
}

// ---- タブ体験のステップ (2〜6)。実タブの上に出す説明バナー ----
//
// スクロールコンテナの先頭 (タブの中身の上) に通常フローで置く。
// オーバーレイにしないのは、カード画面の回答ボタンなどを覆わないため。
// 邪魔ならスクロールで画面の外へ送れる。

const BANNER_COPY: Record<
  number,
  { title: string; body: (measured: boolean) => string; tryIt: string }
> = {
  2: {
    title: "カード (単語学習)",
    body: (measured) =>
      measured
        ? "演習は新しい単語を × ○ で高速に仕分け、復習は学習中の単語を × △ ○ で覚え直します。間違いが多い単語ほどよく出ます。← で取り消し、↑ でカード詳細、左上がスワイプ設定。"
        : "まずは単語力測定。下の10問に、さっき覚えたスワイプでそのまま答えてください。正解すると難しく、間違えると易しい単語が出て、あなたのレベル (A1〜C1) を判定します。",
    tryIt: "実際に答えてみましょう",
  },
  3: {
    title: "単語リスト",
    body: () =>
      "全単語の一覧です。学習進捗度や前回結果 (○△×) で絞り込み・並べ替え・検索。見出しの目のアイコンで単語や意味を隠して、めくりながら暗記チェックもできます (赤シートの感覚)。スピーカーで発音、行をタップで詳細。",
    tryIt: "シールやスピーカーを試してみましょう",
  },
  4: {
    title: "文法",
    body: () =>
      "レベルに合わせた文法4択を無限に出題します。トピック (時制・仮定法など) を選ぶと集中練習、選ばなければ苦手なトピックが優先して出ます。答えた瞬間に解説つき。",
    tryIt: "1問解いてみましょう",
  },
  5: {
    title: "読解",
    body: () =>
      "あなたのレベルと興味に合わせた長文をAIがその場で生成します。カードで × や △ だった単語が本文に織り込まれ、ハイライトをタップすると単語詳細が開きます。語注・全文和訳・内容理解クイズつき。",
    tryIt: "「長文を生成」で試せます (数十秒かかります)",
  },
  6: {
    title: "AI会話",
    body: () =>
      "AIと英語で雑談できます。返事はあなたのレベルの英語で返ってきます。メッセージ添削をオンにすると、あなたの英文の直しどころも返信とは別に教えてくれます。日本語で書いてもOK。",
    tryIt: "ひとこと話しかけてみましょう",
  },
};

export function TutorialBanner({ step, measured, onNext, onBack, onSkip }: Nav) {
  const copy = BANNER_COPY[step];
  if (!copy) return null;
  return (
    <div className="mb-4 rounded-2xl border-2 border-[#4A99EA] bg-white p-4 dark:bg-black">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-[#4A99EA]">
          チュートリアル {step + 1} / {TUTORIAL_STEP_COUNT}
        </span>
        <button
          onClick={onSkip}
          className="rounded-full px-2 py-0.5 text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
        >
          スキップ
        </button>
      </div>
      <h3 className="mt-1 text-sm font-bold">{copy.title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
        {copy.body(measured)}
      </p>
      <p className="mt-1.5 text-[11px] font-medium text-[#4A99EA]">
        ▶ {copy.tryIt}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={onBack}
          className="rounded-full border border-zinc-300 px-4 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          戻る
        </button>
        <button
          onClick={onNext}
          className="flex-1 rounded-full bg-[#4A99EA] py-1.5 text-xs font-bold text-white hover:bg-[#3d87d4]"
        >
          次へ
        </button>
      </div>
    </div>
  );
}
