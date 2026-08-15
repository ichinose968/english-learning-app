"use client";

import { useRef, useState } from "react";
import { BookMarked, PenLine } from "lucide-react";
import { CardFieldKey, VocabAction, WordDbEntry } from "@/lib/english/types";
import { statusBadges } from "@/lib/english/worddb";
import { EXIT_MS, FlyingCard, WordCard } from "./VocabTab";
import { Spotlight } from "./Spotlight";

// 全画面の層 (ようこそ / デモ / 準備完了) の共通クラスと、セーフエリアの逃げ。
// **この3つは fixed でヘッダーの上に被さるので、本体の逃げを一切継がない。**
// 本体のヘッダーは EnglishApp が max(0.75rem, env(safe-area-inset-top)) で
// 押し下げているが、そこを覆ってしまうため自分で避ける必要がある。
// 入れないと「チュートリアル n / N」とスキップが時計・Dynamic Island に潜る
// (ホーム画面から起動した実機で報告された。ブラウザのタブで開いている間は
// 上下にブラウザのUIがあってインセットが 0 になるため、絶対に再現しない)。
// 下端も同じ理由でホームインジケータに掛かるので、まとめてここで避ける
const FULL_LAYER =
  "fixed inset-0 z-[60] mx-auto flex max-w-2xl flex-col bg-black text-zinc-100";
const FULL_LAYER_SAFE = {
  paddingTop: "env(safe-area-inset-top)",
  paddingBottom: "env(safe-area-inset-bottom)",
};

// 初回チュートリアル。以前の「はじめに設定してください」(SetupPanel) と
// その後の単語力測定への一連のフローを、これで置き換えた。
//
// **形はスポットライト。** 画面を暗くして対象を1つだけ抜き、隣に1行添える。
// 前の版は説明バナーを画面上部に置いていたが、ユーザーの指摘は
// 「文章が長くて読む気にならない」「どこを見ればいいか分からない」の2つで、
// どちらも同じ原因だった。**バナーは対象を指せないので位置を文章で説明するしかなく**
// (「左上のスライダーが…」)、それが本文を段落まで膨らませていた。指せるなら1行で足りる。
//
// **暗い部分はタップを通さない。穴だけが押せる** (Spotlight の4枚の板)。
// これは飾りではなく進行の仕組みそのもので、穴の位置がそのまま
// 「次にできる操作」の限定になる。だからデモを
// 「○ボタンで答える → 右スワイプで答える → ×ボタン → 左スワイプ」の4つに割っても、
// 各ステップで意図した操作しかできない (ボタンを抜けばスワイプできず、
// カードを抜けばボタンを押せない)。入力方法を判別するコードは要らない。
//
// **操作で進むステップに「次へ」は無い。** 望みの操作をした時点で次へ送る。
// 読むだけのステップにだけ「次へ」を出す。
//
// ステップは EnglishApp が持つ (タブの切り替えと、達成条件の判定に data が要るため)。

// **ステップは番号ではなく名前で参照する。** 途中に1つ挟むたびに
// あちこちの数字を付け替えることになり、実際に何度か取りこぼした。
// ここだけ直せば、順序の入れ替えも挿入も追随する
export const STEP = {
  welcome: 0, // ようこそ (全画面)
  demoIntro: 1, // デモのカードを見せる
  demoKnown: 2, // ○ ボタン
  demoSwipeRight: 3, // 右スワイプ
  demoUnknown: 4, // × ボタン
  demoSwipeLeft: 5, // 左スワイプ
  placement: 6, // レベル測定10問
  placementResult: 7, // 測定の結果
  wordColumn: 8, // 単語の列
  firstRow: 9, // 先頭行を押して詳細を開く
  detail: 10, // 単語詳細の説明
  detailClose: 11, // ↓ で単語リストへ戻る
  sealOn: 12, // 暗記シールを貼る
  sealPeel: 13, // 暗記シールをめくる
  progressColumn: 14, // 学習進捗度の列そのものを示す
  progressIntro: 15, // 学習完了と学習中の分類
  progressCount: 16, // 学習完了までの連続 ○ の回数
  toReview: 17, // 復習へ切り替える
  reviewBasics: 18, // 復習の ○ と × の説明
  reviewUnsure: 19, // 復習の △ を演習する
  cardSettings: 20, // 単語の設定を開かせる
  filterSection: 21, // 出題の設定
  swipeSection: 22, // スワイプ時オプション
  done: 23, // おわり (全画面)
} as const;

export const TUTORIAL_STEP_COUNT = STEP.done + 1;

export const isWelcomeStep = (step: number) => step === STEP.welcome;
// デモの全画面が出ているあいだ (カードを見せる〜左スワイプ)
export const isDemoStep = (step: number) =>
  step >= STEP.demoIntro && step <= STEP.demoSwipeLeft;
export const isFinalStep = (step: number) => step === STEP.done;

// デモの各ステップで待っている回答。これが来たら次へ送る。
// 入力方法 (ボタン / スワイプ) は Spotlight の穴が限定するので、ここでは見ない
export const DEMO_EXPECTED: Record<number, VocabAction> = {
  [STEP.demoKnown]: "known",
  [STEP.demoSwipeRight]: "known",
  [STEP.demoUnknown]: "unknown",
  [STEP.demoSwipeLeft]: "unknown",
};

// タブのステップ → 開くタブ。ようこそ・デモ・締めは null
export function tutorialTabForStep(
  step: number,
): "vocab" | "database" | "grammar" | "reading" | null {
  switch (step) {
    case STEP.placement:
    case STEP.placementResult:
      return "vocab";
    case STEP.wordColumn:
    case STEP.firstRow:
    case STEP.detail:
    case STEP.detailClose:
    case STEP.sealOn:
    case STEP.sealPeel:
    case STEP.progressColumn:
    case STEP.progressIntro:
    case STEP.progressCount:
      return "database";
    case STEP.toReview:
    case STEP.reviewBasics:
    case STEP.reviewUnsure:
    case STEP.cardSettings:
    case STEP.filterSection:
    case STEP.swipeSection:
      return "vocab";
    default:
      return null;
  }
}

interface Nav {
  step: number;
  // 単語レベルを測定済みか (ステップ4の達成条件)
  measured: boolean;
  // このステップに入ってから1語以上答えたか (ステップ12の達成条件)
  answered: boolean;
  // シールを1枚めくった直後の短い間。褒めて画面を止める
  sealPeeled: boolean;
  // 学習完了とみなす連続 ○ の回数 (設定で変えられるので直書きしない)
  masterCount: number;
  onNext: () => void;
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

// ---- デモ (ステップ 0〜3) ----
//
// 本物の WordCard を使う。回答は学習記録に一切残さない。
// 進行の判定は上 (EnglishApp) が onAction で受ける。ここは見た目だけ持つ。
// △ は出さない。測定も演習も ○ と × の2ボタンなので、ここで3つ目を教えると
// 直後の画面に無いものを覚えさせることになる (△ は復習で初めて出る)

export function TutorialDemo({
  onAction,
}: {
  onAction: (a: VocabAction) => void;
}) {
  const [demoIndex, setDemoIndex] = useState(0);
  const [flying, setFlying] = useState<(FlyingCard & { key: number })[]>([]);
  // **採番は ref で行う (VocabTab と同じ)。** useState だと反映が非同期なので、
  // 続けて飛ばすと同じ番号が2回出て key が衝突する
  // (React が "two children with the same key" を出す)
  const flightRef = useRef(0);

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
    <div
      className={FULL_LAYER}
      style={FULL_LAYER_SAFE}
      // これが出ているあいだ、Spotlight はこの中の印だけを対象にする。
      // 下の単語タブにも同じ印のカードがあるため (2周目)
      data-tour-layer="demo"
    >
      <div className="shrink-0 px-4 pb-1 pt-4 text-center">
        <h2 className="text-base font-bold">カードの答え方</h2>
        <p className="mt-0.5 text-[11px] text-zinc-500">
          ここでの回答は記録に残りません。
        </p>
      </div>
      <div className="relative min-h-0 flex-1 px-4 pb-6">
        <div className="absolute inset-x-4 bottom-6 top-0 flex flex-col">
          <WordCard
            key={`demo-${demoIndex}`}
            // デモは詳細を持たない (tagProps も渡していない)。
            // 開かせるとスポットライトの板の下に潜って詰む
            noDetail
            item={item}
            note={undefined}
            nextItem={nextItem}
            nextNote={undefined}
            skipReveal
            showUnsure={false}
            cardFields={DEMO_FIELDS}
            status={demoStatus}
            onAction={onAction}
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
            className="pointer-events-none absolute inset-x-4 bottom-6 top-0 z-30 flex flex-col"
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
              showUnsure={false}
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
  );
}

// ---- 締めの全画面 (最後のステップ) ----

function Row({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-2xl bg-zinc-900 p-4">
      <span className="text-sm font-medium">
        {title}
        <span className="mt-0.5 block text-xs font-normal leading-relaxed text-zinc-400">
          {desc}
        </span>
      </span>
    </div>
  );
}

// ようこそ。**チュートリアルで唯一「先に読ませる」画面。**
// ここだけは何を触ればよいか以前に「このアプリは何なのか」が要る。
// 以降は全部、実物を指して1行ずつ
export function TutorialWelcome({ step, masterCount, onNext, onSkip }: Nav) {
  return (
    <div className={FULL_LAYER} style={FULL_LAYER_SAFE}>
      <div className="flex shrink-0 items-center justify-between px-4 py-3">
        <span className="text-xs text-zinc-500">
          チュートリアル {step + 1} / {TUTORIAL_STEP_COUNT}
        </span>
        <button
          onClick={onSkip}
          className="rounded-full px-3 py-1 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
        >
          スキップ
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-4 flex flex-col items-center text-center">
            <span className="text-[#4A99EA]">
              <BookMarked size={30} />
            </span>
            <h2 className="mt-2 text-lg font-bold">ようこそ</h2>
            <p className="mt-1 text-xs text-zinc-400">
              知らない単語を繰り返し復習できる英単語アプリです
            </p>
          </div>
          <div className="space-y-2.5">
            <Row
              title="指で仕分けるだけ"
              desc="知っている単語は右、知らない単語は左へスワイプ。知らない単語とイディオムを高速で洗い出します。"
            />
            <Row
              title="間違えた単語ほどたくさん復習"
              // 回数は設定で変えられるので直書きしない (既定は3)
              desc={`間違えた単語ほど、復習でたくさん出てきます。${masterCount}回続けて正解すると「学習完了」です。`}
            />
            <Row
              title="文法・長文演習も"
              desc="文法4択問題の演習も可能。長文はあなたが知らなかった単語を用いてAIが生成します。"
            />
            <p className="pt-1 text-center text-xs text-zinc-500">
              このチュートリアルは、実際に触りながら進みます。
            </p>
          </div>
        </div>
      </div>
      <div className="shrink-0 space-y-3 px-4 pb-6 pt-2">
        <Dots step={step} />
        <div className="mx-auto flex max-w-md">
          <button
            onClick={onNext}
            className="flex-1 rounded-full bg-[#4A99EA] py-2.5 text-sm font-bold text-white hover:bg-[#3d87d4]"
          >
            次へ
          </button>
        </div>
      </div>
    </div>
  );
}

export function TutorialOverlay({ step, measured, masterCount, onNext }: Nav) {
  return (
    <div className={FULL_LAYER} style={FULL_LAYER_SAFE}>
      <div className="flex shrink-0 items-center justify-between px-4 py-3">
        <span className="text-xs text-zinc-500">
          チュートリアル {step + 1} / {TUTORIAL_STEP_COUNT}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-4 flex flex-col items-center text-center">
            <span className="text-[#4A99EA]">
              <PenLine size={30} />
            </span>
            <h2 className="mt-2 text-lg font-bold">準備完了</h2>
            <p className="mt-1 text-xs text-zinc-400">
              {measured
                ? "閉じると、さっきの演習の画面に戻ります"
                : "閉じると単語タブに測定画面が出ます"}
            </p>
          </div>
          <div className="space-y-2.5">
            {/* **通ってきた3つの振り返りにする。** 以前はここで文法と読解を
                紹介していたが、まだ触っていない機能を最後に足しても像が結ばない。
                やったことを言い直すほうが定着する */}
            <Row
              title="演習"
              desc="知っている単語は ○、知らない単語は ×。指で仕分けて、覚えていない単語を洗い出します。"
            />
            <Row
              title="単語リスト"
              desc="答えた単語がここに溜まります。暗記シールで隠して、知らない単語をまとめて覚え直せます。"
            />
            <Row
              title="復習"
              desc={`覚えたかどうかを確かめます。うろ覚えは △。○ が${masterCount}回続いた単語は学習完了です。`}
            />
            <p className="pt-1 text-xs leading-relaxed text-zinc-500">
              文法と読解は下のタブから。チュートリアルはいつでも設定 (歯車) から見直せます。
            </p>
          </div>
        </div>
      </div>

      <div className="shrink-0 space-y-3 px-4 pb-6 pt-2">
        <Dots step={step} />
        {/* **「戻る」はチュートリアル全体で出さない** (ユーザーの指定)。
            前へ戻れると、達成済みのステップをもう一度やり直すことになり、
            測定や暗記シールのように状態を持つステップは戻り先が壊れる */}
        <div className="mx-auto flex max-w-md">
          <button
            onClick={onNext}
            className="flex-1 rounded-full bg-[#4A99EA] py-2.5 text-sm font-bold text-white hover:bg-[#3d87d4]"
          >
            {measured ? "はじめる" : "単語力測定へ"}
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

// ---- スポットライトのステップ (0〜9) ----
//
// **1ステップ = 対象1つ = 1行。** 2行要ると思ったら、それはステップを割る合図。
// `unlocked` が false のステップは操作で進むので「次へ」を出さない。

interface SpotStep {
  // ハイライトする要素の data-tour。配列なら見つかった最初のものを使う
  target: string | string[];
  // **1行で書くこと**
  body: string;
  // 穴の中で指を左右に動かしてスワイプを促す
  gesture?: "right" | "left";
  // 穴は開けるが押させない (見せるだけのステップ)
  blockHole?: boolean;
  // 何も押させない短い間 (操作を褒めてから自動で次へ)
  frozen?: boolean;
  // true なら「次へ」を出す。false は操作待ち (押して進むボタンを出さない)
  unlocked: boolean;
}

function spotStep(
  step: number,
  sealPeeled: boolean,
  masterCount: number,
): SpotStep | undefined {
  switch (step) {
    // --- デモ。穴が操作を限定するので、押す/スワイプの判別コードは要らない ---
    // デモのカードが出た直後。まだ何も指さず、これから何をするかだけ言う
    case STEP.demoIntro:
      return {
        target: "card",
        body: "早速、単語の演習をしてみましょう。",
        blockHole: true,
        unlocked: true,
      };
    case STEP.demoKnown:
      return {
        target: "answer-known",
        body: "知っている単語は ○。押してみましょう。",
        unlocked: false,
      };
    case STEP.demoSwipeRight:
      return {
        target: "card",
        body: "カードを右へスワイプしても ○ になります。",
        gesture: "right",
        unlocked: false,
      };
    case STEP.demoUnknown:
      return {
        target: "answer-unknown",
        body: "知らない単語は ×。押してみましょう。",
        unlocked: false,
      };
    case STEP.demoSwipeLeft:
      return {
        target: "card",
        body: "左へスワイプしても × になります。",
        gesture: "left",
        unlocked: false,
      };
    // --- 測定 ---
    // 10問のあいだは「測定をはじめる」ボタンが消えて対象が無くなる。
    // Spotlight はそのとき暗幕も板も出さないので、カードを自由に触れる
    case STEP.placement:
      return {
        target: "placement-start",
        body: "10問の演習であなたの単語レベルを測定します。",
        unlocked: false,
      };
    case STEP.placementResult:
      return {
        target: "placement-result",
        body: "レベルが決まりました。答えた10語を見てみましょう。",
        unlocked: true,
      };
    // --- 単語リスト ---
    // まず何が並んでいるかを見せ、詳細を1つ開かせてから、暗記シールの演習に入る
    // `+` でつないだ対象は同時に抜ける。表の列と下タブの2か所を指す
    case STEP.wordColumn:
      return {
        target: "col-word+nav-database",
        body: "学習した単語は単語リストに表示されます。",
        // 見せるだけ。ここで単語を押されると詳細が開いて順序が崩れる
        blockHole: true,
        unlocked: true,
      };
    case STEP.firstRow:
      return {
        target: "first-row",
        body: "単語を確認しましょう。一番上の単語を押してみてください。",
        unlocked: false,
      };
    case STEP.detail:
      return {
        target: "word-detail",
        body: "ここで意味・例文・メモを確認できます。",
        // 詳細の中は触らせない。編集や回答を始められると順序が崩れる
        blockHole: true,
        unlocked: true,
      };
    // **閉じるのはユーザーの操作にする。** 「次へ」で勝手に閉じていた頃は、
    // 画面が急に単語リストへ戻って驚かせていた (ユーザー報告)
    case STEP.detailClose:
      return {
        target: "detail-close",
        body: "確認できたら、右上の ↓ で単語リストに戻りましょう。",
        unlocked: false,
      };
    // --- 暗記シールを実際に貼ってめくらせる ---
    case STEP.sealOn:
      return {
        target: "seal-button",
        body: "暗記シールで単語を隠せます。押してみましょう。",
        unlocked: false,
      };
    // めくったあと1秒だけ、褒めて画面を止める。**穴は同じ場所のまま**なので、
    // 現れた単語をその場で確認できる。次のステップは表を右へスクロールするので、
    // すぐ進めると「めくれたのか分からない」ままになる (ユーザー報告)
    case STEP.sealPeel:
      return sealPeeled
        ? {
            target: "first-word",
            body: "いいですね。めくれました。",
            frozen: true,
            unlocked: false,
          }
        : {
            target: "first-word",
            body: "タップすると1枚ずつめくれます。めくってみましょう。",
            unlocked: false,
          };
    case STEP.progressColumn:
      return {
        target: "col-progress",
        body: "この列で単語の学習進捗度を確認できます。",
        // 見せるだけ。押されると単語詳細が開いて順序が崩れる
        blockHole: true,
        unlocked: true,
      };
    case STEP.progressIntro:
      return {
        target: "col-progress",
        body: "初回に ○ だった単語は「学習完了」、× だった単語は「学習中」に分類されます。",
        // 見せるだけ。押されると単語詳細が開いて順序が崩れる (ユーザー報告)
        blockHole: true,
        unlocked: true,
      };
    case STEP.progressCount:
      return {
        target: "col-progress",
        body: `学習中の単語は、復習で ○ を${masterCount}回続けて取ると学習完了になります (回数は設定で変えられます)。`,
        blockHole: true,
        unlocked: true,
      };
    // --- 復習モード。学習中の語を1枚出して △ まで体験させる ---
    case STEP.toReview:
      return {
        target: "mode-review",
        body: "学習中の単語を、復習モードで復習してみましょう。",
        unlocked: false,
      };
    case STEP.reviewBasics:
      return {
        target: "card-area",
        body: "覚えていれば ○、忘れていれば ×。ここまでは演習と同じです。",
        // 説明だけ。ここで答えられると △ の演習にたどり着けない
        blockHole: true,
        unlocked: true,
      };
    // **押す前は △ だけ、押したあとは4択だけを抜く。**
    // 候補を順に引く仕組みを使い、4択が出た瞬間に穴がそちらへ移る。
    // △ のステップで他のボタンまで抜くと、○ や × で答えられてしまう
    case STEP.reviewUnsure:
      return {
        target: ["choices", "answer-unsure"],
        body: "うろ覚えのときは真ん中の △。押すと意味の4択が出るので、選んでみましょう。",
        unlocked: false,
      };
    // --- 単語の設定。開かせてから、中の2つを順に見せる ---
    case STEP.cardSettings:
      return {
        target: "card-settings",
        body: "最後に設定です。ここを押してみましょう。",
        unlocked: false,
      };
    case STEP.filterSection:
      return {
        target: "filter-section",
        body: "どのカードを出題するかはここで設定できます。単語難易度の設定や各モードの出題範囲などが設定できます。",
        // 見せるだけ。開いたり閉じたりされると次の対象を見失う
        blockHole: true,
        unlocked: true,
      };
    case STEP.swipeSection:
      return {
        target: "swipe-section",
        body: "カードスワイプ時の設定はここでできます。カード出題時に見える項目や読み上げ機能などが設定できます。",
        blockHole: true,
        unlocked: true,
      };
    default:
      return undefined;
  }
}

export function TutorialSpotlight({
  step,
  sealPeeled,
  masterCount,
  onNext,
  onSkip,
}: Nav) {
  const s = spotStep(step, sealPeeled, masterCount);
  if (!s) return null;
  return (
    <Spotlight
      target={s.target}
      body={s.body}
      gesture={s.gesture}
      blockHole={s.blockHole}
      frozen={s.frozen}
      step={step + 1}
      total={TUTORIAL_STEP_COUNT}
      // 操作待ちのあいだは「次へ」を出さない。何をすれば進むかは body にある
      onNext={s.unlocked ? onNext : undefined}
      onSkip={onSkip}
    />
  );
}
