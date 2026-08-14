"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BookOpen,
  Circle,
  Flame,
  Gauge,
  Loader2,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  RefreshCw,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  Volume2,
  X,
} from "lucide-react";
import {
  applyEdit,
  CardFieldKey,
  DOMAIN_LABEL_JA,
  EnglishData,
  Level,
  LEVELS,
  THEME_LABEL_JA,
  LastResult,
  Progress,
  VocabAction,
  VocabEntry,
  VocabSettings,
  DEFAULT_TAG_PROPS,
  TagProp,
  WordDbEntry,
  WordEdit,
} from "@/lib/english/types";
import { primeSpeech, speak, stopSpeaking } from "@/lib/english/speech";
import { CardDetailSheet, rectOf, SheetOrigin } from "./CardDetailSheet";
import { ConfirmButton } from "./ConfirmButton";
import { clearStatusOverride, setStatusOverride } from "@/lib/english/progress";
import { requestErrorMessage } from "@/lib/english/net";
import { CardFilterSheet } from "./CardFilterSheet";
import { Sheet } from "./Sheet";
import {
  buildIndex,
  buildQueue,
  DbKind,
  dbStats,
  dbStatsAsOf,
  estimatePlacement,
  evaluateLevelShift,
  fetchAllWordDbs,
  LEVEL_ORDER,
  LEVEL_SHIFT_WINDOW,
  PLACEMENT_SIZE,
  reviewProgressOf,
  statusBadges,
  QuizMode,
  samplePlacementWord,
  WordDbMap,
} from "@/lib/english/worddb";

interface Props {
  data: EnglishData;
  setData: React.Dispatch<React.SetStateAction<EnglishData>>;
  // チュートリアルが動いているあいだ true。**このタブの props は data と setData の
  // 2つだけ、という原則の例外。** チュートリアル中にカード詳細を開かれると、
  // CardDetailSheet がスポットライトの板の下に潜って操作できなくなり詰む
  // (ユーザー報告)。詳細を開く ↑ ボタンを消すためだけに受け取る
  tourActive?: boolean;
  // 復習の説明ステップ用。**復習に出せる語が1つも無いときサンプルを1枚用意する。**
  // 測定10問で全部 ○ だったユーザーは学習中の語を持たないので、
  // これが無いと「復習する単語はありません」の空画面でチュートリアルが詰む
  tourSampleReview?: boolean;
  // 出題モードを切り替えたときに知らせる (チュートリアルが次のステップへ進む)
  onModeChange?: (m: QuizMode) => void;
  // 「単語の設定」シートを開いたときに知らせる (チュートリアルが次へ進む)
  onFilterOpen?: () => void;
  // チュートリアルが設定のステップを抜けたら閉じる
  hideFilter?: boolean;
  // チュートリアル中だけ、設定のどちらの大分類を開くか
  tourOpenSection?: "filter" | "swipe" | null;
}

type Phase =
  | "loading"
  | "placementIntro"
  | "placement"
  | "placementDone"
  | "idle"
  | "quiz";

// 上部タブは出題モードそのもの。演習で仕分けて、こぼれた語を復習で覚え直す
const MODE_TABS: { key: QuizMode; label: string }[] = [
  { key: "drill", label: "演習" },
  { key: "review", label: "復習" },
];
// キューを使い切るたびに補充する単位 (出題自体は無限に続く)
const BATCH_SIZE = 10;
// カードが回りながら飛んでいく時間。globals.css の card-fly-* と必ず揃える。
// 短すぎるとコピーを消すのが早すぎて、飛びきる前にアニメーションが切れる
export const EXIT_MS = 600;

// 飛んでいくカードのコピー。飛ばすと決めた瞬間の見た目をそのまま持たせる
export interface FlyingCard {
  item: WordDbEntry;
  note: string | undefined;
  dir: "left" | "right" | "up";
  // 指を離した場所と傾き (ここから続けて飛ばす)
  from: { x: string; y: string; r: string };
  step: "ask" | "choices" | "reveal";
  action: VocabAction | null;
  picked: number | null;
  choices: string[];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function isCorrect(action: VocabAction): boolean {
  return action === "known" || action === "unsure_correct";
}

function levelLabel(level: Level): string {
  const def = LEVELS.find((l) => l.key === level);
  return def ? `${def.key} ${def.label}` : level;
}

// 出題対象のレベル。手動設定なら選んだレベル、自動なら測定した1レベル
function activeLevels(
  settings: VocabSettings,
  measured: Level | null,
): Level[] {
  if (settings.levelMode === "manual") return settings.manualLevels;
  return measured ? [measured] : [];
}

// 表以外の場面でカードに乗せる地色。4択中は黄、回答後は正解が青 / 不正解が赤。
// カードは白地・黒文字を保ちたいので、色は塗り替えずに白の上へ薄く重ねる
// (backgroundImage を使うと Tailwind の bg-white がそのまま下に残る)。
// 上を濃く・下を薄くして、いちばん見せたい判定ラベル側に色が寄るようにしてある。
//
// fill は地色の濃さの倍率。青 (#4A99EA) は黄や赤より明度が高く、
// 同じ不透明度だと白地に沈んで「色が付いていない」ように見えるので、正解のときだけ上げる。
// 枠と影は倍率をかけない (かけると枠だけ不透明になって、他の2色と輪郭の強さが揃わない)
function cardTone(rgb: string, fill = 1) {
  const a = (v: number) => Math.min(1, v * fill).toFixed(3);
  return {
    image: `linear-gradient(180deg, rgba(${rgb},${a(0.22)}) 0%, rgba(${rgb},${a(0.06)}) 55%, rgba(${rgb},${a(0.03)}) 100%)`,
    border: `rgba(${rgb},0.55)`,
    glow: `0 0 26px 2px rgba(${rgb},0.28)`,
  };
}

const CARD_TONE = {
  // 4択を開いているあいだ。まだ正誤は決まっていないので △ と同じ黄
  unsure: cardTone("234,179,8"),
  correct: cardTone("74,153,234", 2.6),
  wrong: cardTone("239,68,68"),
};

// ---- スワイプの判定 ----

// これだけ動かせば、指の速さに関わらず確定する
const SWIPE_THRESHOLD = 60;
// 速く弾いたときは、この距離だけで確定させる。
// 距離だけで見ると毎回大きく指を動かすことになるので、速さでも拾う
const FLICK_MIN_PX = 22;
const FLICK_SPEED = 0.4; // px/ms (= 400px/秒)
// 手ぶれと区別するための無反応域。ここを超えてから演出を出しはじめる
const SWIPE_DEADZONE = 8;

// ---- スワイプ中のエフェクト (○=青 / ×=赤 / △=黄) ----

type SwipeDir = "known" | "unknown" | "unsure";

// 影の色。ライト・ダークどちらの地の上でも見える濃さにする
const SWIPE_GLOW: Record<SwipeDir, (a: number) => string> = {
  known: (a) => `rgba(74, 153, 234, ${a})`,
  unknown: (a) => `rgba(239, 68, 68, ${a})`,
  unsure: (a) => `rgba(234, 179, 8, ${a})`,
};

// スワイプ中に出す大きな記号。位置と傾きは向きごとに変える。
// max はフォントサイズの上限。どれも1文字なので大きく出せる
// (英字だった頃は "Mastered" が8文字あり、はみ出さないよう小さく抑えていた)
const SWIPE_HINT: Record<
  SwipeDir,
  { text: string; cls: string; rotate: number; origin: string; max: number }
> = {
  known: {
    text: "○",
    cls: "left-6 top-6",
    rotate: -10,
    origin: "0% 50%",
    max: 96,
  },
  unknown: {
    text: "×",
    cls: "right-7 top-6",
    rotate: 10,
    origin: "100% 50%",
    max: 96,
  },
  unsure: {
    text: "△",
    cls: "left-1/2 top-6",
    rotate: 0,
    origin: "50% 0%",
    max: 96,
  },
};

// カードの周囲に出すグラデーションの影。指を離す直前がいちばん濃くなる
function swipeShadow(dir: SwipeDir, t: number): string {
  const glow = SWIPE_GLOW[dir];
  const e = t * t; // 終盤で強くする
  return `0 0 ${22 + 52 * e}px ${2 + 10 * e}px ${glow(0.1 + 0.3 * e)}`;
}

// カードの表面。今のカードと、その後ろに重ねる次のカードで共用する。
//
// スピーカーは背面カードと飛んでいくコピーにも同じ大きさで描く。
// 手前のカードにだけ描くと、カードが飛んで背面が手前に来た瞬間に
// アイコンが生えて見え、単語の位置も横にずれる。
// 触れるのは手前のカードだけなので、onSpeak が無いときは pointer-events を切る
function CardFront({
  item,
  note,
  cardFields,
  onSpeak,
}: {
  item: WordDbEntry;
  note: string | undefined;
  cardFields: Record<CardFieldKey, boolean>;
  onSpeak?: () => void;
}) {
  return (
    <div className="relative z-10 space-y-3 py-4 text-center">
      {cardFields.word && (
        <div className="flex items-center justify-center gap-2">
          {/* 単語を中央に保つため、右のスピーカーと同じ幅の見えない枠を左に置く */}
          <span className="w-8 shrink-0" aria-hidden />
          <p className="text-4xl font-bold tracking-tight">{item.word}</p>
          <button
            type="button"
            aria-label={`${item.word} を読み上げる`}
            onClick={
              onSpeak
                ? (e) => {
                    // カードのタップ (詳細を開く / スワイプ) に巻き込まれないようにする
                    e.stopPropagation();
                    onSpeak();
                  }
                : undefined
            }
            onPointerDown={(e) => e.stopPropagation()}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors ${
              onSpeak ? "hover:bg-zinc-100 hover:text-zinc-700" : "pointer-events-none"
            }`}
          >
            <Volume2 size={18} />
          </button>
        </div>
      )}
      {(cardFields.ipa || cardFields.pos) && (
        <p className="text-sm text-zinc-400">
          {[cardFields.ipa && item.ipa, cardFields.pos && item.pos]
            .filter(Boolean)
            .join("  ")}
        </p>
      )}
      {cardFields.meaning && <p className="text-lg">{item.meaningJa}</p>}
      {cardFields.tags &&
        (item.exams?.length || item.domains?.length || item.themes?.length) && (
          <div className="flex flex-wrap justify-center gap-1.5">
            {[
              ...(item.exams ?? []),
              ...(item.domains ?? []).map((d) => DOMAIN_LABEL_JA[d] ?? d),
              ...(item.themes ?? []).map((t) => THEME_LABEL_JA[t] ?? t),
            ].map((t) => (
              <span
                key={t}
                className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-600"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      {/* 答えが分かってしまうため、表面では英文だけ出す */}
      {cardFields.example && <p className="text-sm">{item.exampleEn}</p>}
      {cardFields.related && item.related && item.related.length > 0 && (
        <p className="text-xs text-zinc-500">
          {item.related.map((r) => r.word).join(" ・ ")}
        </p>
      )}
      {cardFields.note && note && (
        <p className="text-xs text-zinc-500">メモ: {note}</p>
      )}
    </div>
  );
}

// 今のカードの後ろに重ねておく次のカード。横へずらすと中身がのぞく。
// t は今のカードを引っぱった強さ (0〜1) で、引くほど手前へせり上がる
function NextCard({
  item,
  note,
  cardFields,
  t,
  follow,
  hidden,
}: {
  item: WordDbEntry;
  note: string | undefined;
  cardFields: Record<CardFieldKey, boolean>;
  t: number;
  // 指の動きに即座に追従させるか (ドラッグ中)
  follow: boolean;
  // カードをめくっているあいだは隠す (次の単語が一瞬読めてしまうため)
  hidden: boolean;
}) {
  return (
    <div
      aria-hidden
      style={{
        transform: `scale(${0.95 + 0.05 * t}) translateY(${18 * (1 - t)}px)`,
        opacity: hidden ? 0 : 1,
        transition: follow
          ? "opacity 0.15s linear"
          : "transform 0.22s ease-out, opacity 0.15s linear",
      }}
      // 手前のカードと同じく、ダークテーマでも白地・黒文字にする
      className="pointer-events-none absolute inset-0 flex select-none flex-col justify-center overflow-hidden rounded-2xl border border-zinc-200 bg-white p-6 text-zinc-900"
    >
      {item.bgImage && (
        <div
          className="pointer-events-none absolute inset-0 z-0 rounded-2xl bg-cover bg-center opacity-40"
          style={{ backgroundImage: `url(${item.bgImage})` }}
        />
      )}
      <CardFront item={item} note={note} cardFields={cardFields} />
    </div>
  );
}

// 1単語分のカード (Tinder風)。スワイプまたは下部のボタンで回答する。
// 回答するとカードが裏返って意味を表示し、「次へ」でカードが飛んでいく。
// 状態のリセットは親が key を変えることで行う (`単語#出題連番`。同じ語が続いても作り直す)
export function WordCard({
  item,
  note,
  nextItem,
  nextNote,
  onAction,
  onNext,
  onFly,
  onSaveNote,
  onSaveEdit,
  onUndo,
  skipReveal,
  showUnsure,
  cardFields,
  status,
  onSetResult,
  onSetProgress,
  tagProps = DEFAULT_TAG_PROPS,
  onChangeTagProps = () => {},
  ghost = false,
  noDetail = false,
  flyDir = null,
  flyFrom,
  initialStep = "ask",
  initialAction = null,
  initialPicked = null,
  initialChoices = [],
  settleButtons = false,
  autoSpeak = false,
}: {
  item: WordDbEntry;
  note: string | undefined;
  // タグのプロパティ定義。カード詳細から追加・削除するのでそのまま渡す。
  // 飛んでいくコピー (ghost) とチュートリアルのデモは詳細を開けないので省略できる
  tagProps?: TagProp[];
  onChangeTagProps?: (next: TagProp[]) => void;
  // 後ろに重ねて見せる次のカード (キューの末尾やレベル測定中は無い)
  nextItem: WordDbEntry | undefined;
  nextNote: string | undefined;
  // 回答後に解説を飛ばして次へ進むか
  skipReveal: boolean;
  // ? (4択) を出すか。演習モードは ○ / × の2択だけなので false
  showUnsure: boolean;
  onAction: (action: VocabAction) => void;
  onNext: () => void;
  // 飛ばすと決まった瞬間に呼ぶ。親はこの見た目を別レイヤーへ写して飛ばし、
  // 本体はすぐ次の単語に差し替える (飛んでいるカードが操作を遮らないようにするため)
  onFly: (flying: FlyingCard) => void;
  onSaveNote: (text: string) => void;
  onSaveEdit: (patch: WordEdit) => void;
  onUndo: (action: VocabAction) => void;
  cardFields: Record<CardFieldKey, boolean>;
  status: {
    result: { label: string; cls: string; manual: LastResult | null };
    progress: { label: string; cls: string; manual: Progress | null };
    counts: { known: number; fuzzy: number; unknown: number };
  };
  onSetResult: (next: LastResult | null) => void;
  onSetProgress: (next: Progress | null) => void;
  // 飛んでいく最中の見た目だけを描くコピー。触れず、ボタン列も詳細も持たない
  ghost?: boolean;
  // チュートリアル中は詳細を開かせない。開くと CardDetailSheet が
  // スポットライトの板の下に潜って操作できなくなり、詰む (ユーザー報告)
  noDetail?: boolean;
  flyDir?: "left" | "right" | "up" | null;
  flyFrom?: { x: string; y: string; r: string };
  // コピーは飛んだ瞬間の面をそのまま見せる (表 / 4択 / 解説)
  initialStep?: "ask" | "choices" | "reveal";
  initialAction?: VocabAction | null;
  initialPicked?: number | null;
  initialChoices?: string[];
  // 直前のカードを飛ばした直後か。ボタン列を跳ねながら通常状態へ戻す
  settleButtons?: boolean;
  // カードが出た時点で単語を自動で読み上げるか (速さは speech.ts が持つ)
  autoSpeak?: boolean;
}) {
  const [step, setStep] = useState<"ask" | "choices" | "reveal">(initialStep);
  const [choices, setChoices] = useState<string[]>(initialChoices);
  const [picked, setPicked] = useState<number | null>(initialPicked);
  const [action, setAction] = useState<VocabAction | null>(initialAction);
  // **1枚のカードに2回答えさせない。** step も picked も state なので、
  // 素早く連打すると更新が届く前に2回目のハンドラが走り、同じ語に2回記録される
  // (「○ を連打すると1枚に ○ が2つ付く」というユーザー報告の正体)。
  // ref なら同じフレームでも即座に効く。key が「単語#出題連番」なので、
  // 次のカードでは新しくマウントされて自動的に戻る
  const answeredRef = useRef(false);
  // 同じ理由で、次のカードへ送るのも1回だけにする。
  // 裏面の「次へ」を連打すると onNext が2回走り、カードを1枚読み飛ばしていた
  const flownRef = useRef(false);
  // 直前のカードを飛ばした直後にマウントされたか。マウント時の値で固定する。
  // prop をそのまま見ると、親が飛行中のコピーを片付けた時点でクラスが外れ、
  // 0.26秒の跳ねが途中で切れてしまう
  const [settle] = useState(settleButtons);
  // 読み上げ。速さは speech.ts が1つ持っているので、ここでは渡さない
  const speakText = (text: string) => {
    primeSpeech();
    speak(text);
  };
  // 自動読み上げ。表面が出たときだけ読む (4択や解説へ移ったときは読み直さない)。
  // コピーでは鳴らさない。本体で既に読んでいるので二重になる
  useEffect(() => {
    if (ghost || !autoSpeak || step !== "ask") return;
    speak(item.word);
  }, [ghost, autoSpeak, step, item.word]);
  // カード画面から離れるときは読み上げを止める。
  // 止めないと、タブを移ったあとも前の単語を読み続ける。
  // **コピー側では止めない。** コピーは飛び終えた 0.98秒後に片付けられるので、
  // ここで止めると、その頃には手前に出ている次のカードの読み上げを切ってしまう
  useEffect(() => {
    if (ghost) return;
    return () => stopSpeaking();
  }, [ghost]);

  // ドラッグ (スワイプ) の状態
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  // 4択へ移るときの跳ね返りの開始位置 (指を離した高さ)
  const [bounceFrom, setBounceFrom] = useState(-40);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  // 退出アニメーションの向き
  const [flip, setFlip] = useState(false);
  // カード詳細 (カード右下の ↑ から開く)
  const [detailOpen, setDetailOpen] = useState(false);
  // 詳細を開くアニメーションの開始位置 (カード / ↑ボタン / 下部のボタン列)
  const [detailOrigin, setDetailOrigin] = useState<SheetOrigin | undefined>();
  const cardRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLButtonElement>(null);
  const buttonsRef = useRef<HTMLDivElement>(null);
  // 指の軌跡 (直近120ms分)。指を離した瞬間の速さを出すのに使う
  const histRef = useRef<{ x: number; y: number; t: number }[]>([]);

  // 直近の移動速度 (px/ms)。サンプルが1つしかない (ほぼ動いていない) ときは 0
  const flickSpeed = () => {
    const h = histRef.current;
    if (h.length < 2) return { x: 0, y: 0 };
    const first = h[0];
    const last = h[h.length - 1];
    const dt = last.t - first.t;
    if (dt <= 0) return { x: 0, y: 0 };
    return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
  };

  // その向きへ確定させるか。距離が足りなくても、速く弾いたなら通す
  const committed = (d: number, v: number) =>
    Math.abs(d) > SWIPE_THRESHOLD ||
    (Math.abs(d) > FLICK_MIN_PX && Math.abs(v) > FLICK_SPEED);

  const openDetail = () => {
    const card = rectOf(cardRef.current);
    setDetailOrigin(
      card
        ? {
            card,
            arrow: rectOf(arrowRef.current),
            buttons: rectOf(buttonsRef.current),
          }
        : undefined,
    );
    setDetailOpen(true);
  };


  // 裏返してから内容を差し替える (めくる演出)
  const flipTo = (next: "choices" | "reveal") => {
    setFlip(true);
    window.setTimeout(() => {
      setStep(next);
      setFlip(false);
    }, 160);
  };

  // 飛ばすと決まった瞬間に、今の見た目を親へ渡してすぐ次の単語へ進む。
  // 飛んでいくカードは親が別レイヤーに描く「触れないコピー」になるので、
  // ここで待たない。待つと飛びきるまで下のカードもボタンも触れなくなる。
  // 指を離した位置から続けて飛ばすため、開始位置も一緒に渡す
  // (0 から始めるといったん中央へ戻ってから飛ぶように見える)
  const flyAway = (
    dir: "left" | "right" | "up",
    nextAction?: VocabAction,
    // コピーに描かせる面。既定は今の面だが、詳細から答えたときは
    // 裏返していないので必ず表を描かせる
    faceStep: "ask" | "choices" | "reveal" = step,
  ) => {
    if (flownRef.current) return;
    flownRef.current = true;
    onFly({
      item,
      note,
      dir,
      from: drag
        ? { x: `${drag.x}px`, y: `${drag.y}px`, r: `${drag.x * 0.05}deg` }
        : { x: "0px", y: "0px", r: "0deg" },
      step: faceStep,
      action: nextAction ?? action,
      picked,
      choices,
    });
    onNext();
  };

  // fromDetail: カード詳細の下部バーから答えたとき。
  // 詳細で意味も例文も読んだ直後なので、「解説を飛ばす」設定が
  // オフでも裏面は見せず、そのまま次のカードへ送る
  const answer = (a: VocabAction, fromDetail = false) => {
    if (answeredRef.current) return;
    answeredRef.current = true;
    // **ここでも解錠する。** 下部のボタン列はカード本体の外にある兄弟要素なので、
    // ボタンだけで仕分けているとカードの onPointerDown を一度も通らない。
    // 演習は「× ○ の2ボタンで高速に仕分ける」のが本来の使い方なので、これが主経路。
    // 解錠しないと iOS では自動読み上げが永久に無音のままになる
    primeSpeech();
    setAction(a);
    onAction(a);
    if (skipReveal || fromDetail) {
      const dir = a === "known" ? "right" : a === "unknown" ? "left" : "up";
      flyAway(dir, a, fromDetail ? "ask" : step);
      return;
    }
    setDrag(null);
    flipTo("reveal");
  };

  // 4択を開く。ここだけはカードを裏返さない。
  // 上へ引っぱったカードは指を離した高さから跳ね返りながら元の位置へ戻り、
  // 単語が中央から上へ動いて、入れ替わりに選択肢が下からせり上がる
  // (演出は globals.css の card-bounce-back / choices-rise)
  const openChoices = () => {
    // △ を出さないモードでは 4択そのものを使わない
    if (!showUnsure) return;
    // △ ボタンもカード本体の外なので、ここでも解錠しておく
    primeSpeech();
    setChoices(shuffle([item.meaningJa, ...item.distractors]));
    setPicked(null);
    // 跳ね返りの開始位置。ボタンから開いたときはドラッグが無いので軽く跳ねるだけにする
    setBounceFrom(drag ? drag.y : -40);
    setDrag(null);
    setStep("choices");
  };

  // 4択を開いたのをやめて表に戻す。まだ回答は記録していないので取り消すものはない
  const cancelChoices = () => {
    setStep("ask");
    setPicked(null);
    setDrag(null);
  };

  // 回答を取り消してカードの表側に戻す
  const flipBack = () => {
    if (!action) return;
    // 取り消したらもう一度答えられるようにする (カードはまだ生きている)
    answeredRef.current = false;
    onUndo(action);
    setFlip(true);
    window.setTimeout(() => {
      setStep("ask");
      setAction(null);
      setPicked(null);
      setDrag(null);
      setFlip(false);
    }, 160);
  };

  // 「次へ」: 回答の向きにカードを飛ばしてから次の単語へ
  const flyOut = () => {
    flyAway(action === "known" ? "right" : action === "unknown" ? "left" : "up");
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (step !== "ask" && step !== "reveal") return;
    // iOS Safari は「ユーザー操作の中から呼ばれた speak」でしか音を出さない。
    // カードが出た瞬間の自動読み上げは操作ではないので、
    // 最初にカードへ触れたこのタイミングで解錠しておく (2回目以降は何もしない)
    primeSpeech();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    startRef.current = { x: e.clientX, y: e.clientY };
    histRef.current = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    setDrag({ x: 0, y: 0 });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!startRef.current) return;
    // 直近120msぶんだけ残す。長く取ると、止めてから離しても速いと判定されてしまう
    const now = performance.now();
    const h = histRef.current;
    h.push({ x: e.clientX, y: e.clientY, t: now });
    while (h.length > 2 && now - h[0].t > 120) h.shift();
    setDrag({
      x: e.clientX - startRef.current.x,
      y: e.clientY - startRef.current.y,
    });
  };
  const onPointerUp = () => {
    if (!drag) return;
    startRef.current = null;
    const v = flickSpeed();
    // 回答後はどの向きにスワイプしても次のカードへ進む
    if (step === "reveal") {
      if (committed(drag.x, v.x) || committed(drag.y, v.y)) {
        flyAway(drag.x >= 0 ? "right" : "left");
      } else {
        setDrag(null);
      }
      return;
    }
    // 大きく動いた向きで決める。演出 (swipe) と同じ基準にして、
    // 見えている向きとは違う回答が確定しないようにする
    const ax = Math.abs(drag.x);
    const ay = Math.abs(drag.y);
    if (ax >= ay) {
      if (committed(drag.x, v.x)) {
        answer(drag.x > 0 ? "known" : "unknown");
        return;
      }
    } else if (showUnsure && drag.y < 0 && committed(drag.y, v.y)) {
      openChoices();
      return;
    }
    setDrag(null);
  };

  // スワイプの向きと強さ (0〜1)。カードのグラデーション影とボタンの反転に使う
  const swipe: { dir: SwipeDir; t: number } | null = (() => {
    // コピーは指を離した瞬間の演出 (色と大きな記号) を保ったまま飛んでいく
    if (ghost) {
      if (!flyDir) return null;
      // 裏面から飛ばしたときは回答ではなく「次へ」なので、飛ぶ向きでは決めない。
      // 向きだけで決めると、左へ飛ばした瞬間に色が化けて見える。
      // 実際の色は glowDir がカードの地色 (正解=青 / 不正解=赤) に合わせる
      if (step === "reveal") return { dir: "known", t: 1 };
      const dir: SwipeDir =
        flyDir === "right" ? "known" : flyDir === "left" ? "unknown" : "unsure";
      return { dir, t: 1 };
    }
    // 裏面はどちらへスワイプしても「次のカードへ」なので、向きによらず → と同じ扱いにする
    if (step === "reveal") {
      if (!drag) return null;
      const d = Math.max(Math.abs(drag.x), Math.abs(drag.y));
      if (d < SWIPE_DEADZONE) return null;
      return { dir: "known", t: Math.min(1, d / SWIPE_THRESHOLD) };
    }
    if (!drag || step !== "ask") return null;
    const ax = Math.abs(drag.x);
    const ay = Math.abs(drag.y);
    if (ax < SWIPE_DEADZONE && ay < SWIPE_DEADZONE) return null;
    if (ax >= ay) {
      return {
        dir: drag.x > 0 ? "known" : "unknown",
        t: Math.min(1, ax / SWIPE_THRESHOLD),
      };
    }
    // 上方向だけが「怪しい」。下向きのドラッグと、? の無いモードでは何も出さない
    if (drag.y > 0 || !showUnsure) return null;
    return { dir: "unsure", t: Math.min(1, ay / SWIPE_THRESHOLD) };
  })();

  // ボタンの色を反転させるのは、そのまま指を離せば確定する強さになってから
  const lit = (dir: SwipeDir) => swipe?.dir === dir && swipe.t >= 0.35;

  // 指を離せば確定する強さに達した瞬間だけ、短く振動させる (対応端末のみ)
  const swipeDir = swipe?.dir ?? null;
  const swipeT = swipe?.t ?? 0;
  const buzzed = useRef(false);
  useEffect(() => {
    if (ghost) return;
    if (swipeT >= 1 && !buzzed.current) {
      buzzed.current = true;
      navigator.vibrate?.(14);
    } else if (swipeT < 0.9) {
      buzzed.current = false;
    }
  }, [ghost, swipeDir, swipeT]);

  const fxTransition = drag
    ? "transform 0.07s linear, box-shadow 0.07s linear, opacity 0.1s linear, background-color 0.12s ease-out, color 0.12s ease-out"
    : "transform 0.3s cubic-bezier(0.2, 1.5, 0.4, 1), box-shadow 0.25s ease-out, opacity 0.2s ease-out, background-color 0.15s ease-out, color 0.15s ease-out";

  // 狙っている向き以外のボタンは、引っぱるほど消えていく
  const fadedOut = swipe ? Math.max(0, 1 - swipe.t * 2.2) : 1;

  // カードの地色。4択中は黄、回答後は正解なら青・不正解なら赤。表には色を付けない
  const tone =
    step === "choices"
      ? CARD_TONE.unsure
      : step === "reveal" && action
        ? CARD_TONE[isCorrect(action) ? "correct" : "wrong"]
        : null;

  // スワイプ中の影の色。表は向き (○=青 / ×=赤 / △=黄) で決めるが、
  // **裏面はカードの地色に合わせる**。不正解 (赤地) のカードを引いたとき、
  // 向き基準のままだと赤いカードに青い影が付いて見える (ユーザー指摘)。
  // ボタンの反応 (lit / buttonFx) は「次へ」の → に付けたままにするので swipe.dir は変えない
  const glowDir: SwipeDir =
    step === "reveal" && action && !isCorrect(action)
      ? "unknown"
      : (swipe?.dir ?? "known");

  // 反応中のボタンは大きく + 発光させ、他のボタンは縮めて消す。
  // off はその場面で使えないボタン (4択中の ? と →)。押せないことが分かるよう薄くする
  const buttonFx = (dir: SwipeDir, off = false): React.CSSProperties => {
    const on = swipe?.dir === dir;
    const t = on ? swipe.t : 0;
    return {
      transform: `scale(${on ? 1 + 0.42 * t * t : swipe ? 0.86 : 1})`,
      boxShadow: on
        ? `0 0 ${10 + 46 * t * t}px ${SWIPE_GLOW[dir](0.2 + 0.6 * t)}`
        : undefined,
      opacity: off ? 0.25 : on ? 1 : fadedOut,
      transition: fxTransition,
    };
  };

  // ← は表に戻す役。4択を開いているあいだも押せる (まだ回答していないので取り消すものはない)
  const backLabel =
    step === "ask"
      ? "×"
      : step === "choices"
        ? "4択をやめてカードの表に戻る"
        : "回答を取り消してカードの表に戻る";

  // スワイプ中に出す大きな文字。引っぱるほど大きく、濃くなる。
  // 飛んでいくあいだも付けたままにして、回りながら一緒に遠ざかるようにする。
  // 裏面のスワイプは回答ではなく「次へ」なので、文字は出さずに色とボタンだけ反応させる
  const hint =
    swipe && swipe.t >= 0.18 && step === "ask" ? SWIPE_HINT[swipe.dir] : null;

  // 飛んでいくあいだの位置は card-fly-* が持つので、ここでは指の動きだけを見る
  const transform = drag
    ? `translate(${drag.x}px, ${drag.y}px) rotate(${drag.x * 0.05}deg) scale(${
        1 + 0.05 * swipeT * swipeT
      })`
    : undefined;

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col ${
        // 飛んでいくコピーは見た目だけ。触れないので、下のカードをそのまま操作できる
        ghost ? "pointer-events-none" : ""
      }`}
    >
      <div className="relative min-h-0 flex-1">
        {/* 背面のカード。次の単語が分かっていれば中身ごと重ねる */}
        {nextItem && (
          <NextCard
            item={nextItem}
            note={nextNote}
            cardFields={cardFields}
            t={swipeT}
            follow={!!drag}
            hidden={flip}
          />
        )}
        {/* 次の単語が分からないときは枠だけ置いて奥行きを出す。
            ただし飛んでいくコピーには置かない。コピーは本体に重ねてあるので、
            中身のない枠線だけが下のカードの上に浮いて見えてしまう */}
        {!nextItem && !ghost && (
          <div className="absolute inset-x-3 bottom-[-8px] top-2 rounded-2xl border border-zinc-200 dark:border-zinc-800" />
        )}
        <div
          ref={cardRef}
          // チュートリアルのスポットライトの対象 (スワイプを促すステップ)
          // card-area はカードと回答ボタン列の共通の印。
          // Spotlight が同じ印をまとめて1つの穴にするので、
          // 「カードも4択もボタンも触れる」1つの領域になる (復習の △ の演習で使う)
          data-tour={ghost ? undefined : "card card-area"}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{
            transform:
              `${transform ?? ""} ${flip ? "scaleX(0.02)" : ""}`.trim() ||
              undefined,
            // 飛んでいるあいだは transition を切る。transition はアニメーションより
            // 優先されるので、残しておくと card-fly-* が効かない
            transition: ghost
              ? "none"
              : drag
                ? "box-shadow 0.12s linear"
                : "transform 0.22s ease-out, opacity 0.22s ease-out, box-shadow 0.22s ease-out, background-image 0.2s ease-out, border-color 0.2s ease-out",
            // 裏面の地色。bg-white の上に重ねるので backgroundImage で入れる
            backgroundImage: tone?.image,
            borderColor: tone?.border,
            // スワイプ中の影を優先する (指の向きが分からなくなるため)
            boxShadow: swipe
              ? swipeShadow(glowDir, swipe.t)
              : (tone?.glow ?? undefined),
            touchAction: "none",
            // 4択へ移るときの跳ね返りの開始位置 (card-bounce-back が読む)
            "--bounce-from": `${bounceFrom}px`,
            // 飛んでいくときの開始位置 (card-fly-* が読む)
            "--fly-x": flyFrom?.x ?? "0px",
            "--fly-y": flyFrom?.y ?? "0px",
            "--fly-r": flyFrom?.r ?? "0deg",
          } as React.CSSProperties}
          // カードだけはダークテーマでも白地・黒文字にする (紙の単語カードに寄せる)
          className={`absolute inset-0 flex select-none flex-col justify-center overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-6 text-zinc-900 ${
            ghost && flyDir
              ? `card-fly-${flyDir}`
              : step === "choices"
                ? "card-bounce"
                : ""
          }`}
        >
          {/* 背景画像 (カード詳細で設定)。文字が読めるよう薄くしてカードの地色に重ねる */}
          {item.bgImage && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-0 rounded-2xl bg-cover bg-center opacity-40"
              style={{ backgroundImage: `url(${item.bgImage})` }}
            />
          )}

          {/* スワイプの向きへ広がる色。引っぱるほどカード全体が染まる */}
          {swipe && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-0 rounded-2xl"
              style={{
                background: `radial-gradient(circle at ${
                  swipe.dir === "known"
                    ? "100% 50%"
                    : swipe.dir === "unknown"
                      ? "0% 50%"
                      : "50% 0%"
                  // 色は影と同じく地色に合わせる (裏面の不正解カードは赤)
                }, ${SWIPE_GLOW[glowDir](0.22 * swipe.t)} 0%, ${SWIPE_GLOW[
                  glowDir
                ](0)} 70%)`,
              }}
            />
          )}

          {hint && swipe && (
            <span
              aria-hidden
              className={`pointer-events-none absolute z-20 whitespace-nowrap font-black uppercase italic tracking-tighter ${hint.cls}`}
              style={{
                fontSize: `${hint.max * (0.32 + 0.68 * swipe.t)}px`,
                lineHeight: 1,
                opacity: Math.min(1, (swipe.t - 0.12) * 3),
                color: SWIPE_GLOW[swipe.dir](1),
                transformOrigin: hint.origin,
                transform: `${
                  swipe.dir === "unsure" ? "translateX(-50%) " : ""
                }rotate(${hint.rotate * swipe.t}deg)`,
                textShadow: `0 0 ${4 + 14 * swipe.t}px ${SWIPE_GLOW[swipe.dir](
                  0.45,
                )}`,
              }}
            >
              {hint.text}
            </span>
          )}

          {step === "ask" ? (
            <CardFront
              item={item}
              note={note}
              cardFields={cardFields}
              // コピーと背面カードには持たせない (触れないので押しても何も起きない)
              onSpeak={ghost ? undefined : () => speakText(item.word)}
            />
          ) : (
            <div
              // 4択へ移るときは、中央にあった単語が上へ動いたように見せる
              className={`relative z-10 py-4 text-center ${
                step === "choices" ? "choices-rise" : ""
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                {/* 表面と同じ組み方。単語を中央に保つため左に同じ幅の枠を置く */}
                <span className="w-8 shrink-0" aria-hidden />
                <p className="text-4xl font-bold tracking-tight">{item.word}</p>
                <button
                  type="button"
                  aria-label={`${item.word} を読み上げる`}
                  onClick={
                    ghost
                      ? undefined
                      : (e) => {
                          e.stopPropagation();
                          speakText(item.word);
                        }
                  }
                  onPointerDown={(e) => e.stopPropagation()}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors ${
                    ghost ? "pointer-events-none" : "hover:bg-white/60 hover:text-zinc-700"
                  }`}
                >
                  <Volume2 size={18} />
                </button>
              </div>
              {/* 回答後も表と同じ情報 (発音記号・品詞) を出す */}
              <p className="mt-1 text-sm text-zinc-400">
                {[item.ipa, item.pos].filter(Boolean).join("  ")}
              </p>
            </div>
          )}

          {step === "choices" && (
            <div
              className="choices-rise-late relative z-10 grid gap-2"
              // チュートリアルのスポットライトの対象。△ のステップは
              // ["choices", "answer-unsure"] を候補に渡してあるので、
              // 4択が出た瞬間に穴が △ ボタンからここへ移る
              data-tour={ghost ? undefined : "choices"}
            >
              <p className="mb-1 text-center text-xs text-zinc-500">
                意味はどれ？
              </p>
              {choices.map((c, i) => (
                <button
                  key={i}
                  onClick={() => {
                    if (answeredRef.current) return;
                    answeredRef.current = true;
                    const a =
                      c === item.meaningJa ? "unsure_correct" : "unsure_wrong";
                    setPicked(i);
                    setAction(a);
                    onAction(a);
                    // 設定がオンなら正誤も見せずにそのまま次のカードへ送る。
                    // △ は上へ飛ばす (下部ボタンの「次へ」と同じ向き)
                    if (skipReveal) {
                      flyAway("up", a);
                      return;
                    }
                    flipTo("reveal");
                  }}
                  // 黄色の地の上なので、解説の枠と同じく白を透かして重ねる
                  className="rounded-full border border-zinc-300 bg-white/70 px-4 py-2.5 text-left text-sm transition-colors hover:border-zinc-400 hover:bg-white"
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          {step === "reveal" && action && (
            <div className="relative z-10 space-y-3">
              {/* 判定は地色と同じ系統で、いちばん濃く出す。
                  記号は塗りつぶしのバッジ、その横に正解 / 不正解と書く */}
              <p
                className={`flex items-center justify-center gap-2 text-center text-base font-bold ${
                  isCorrect(action) ? "text-[#4A99EA]" : "text-red-500"
                }`}
              >
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-sm text-white ${
                    isCorrect(action) ? "bg-[#4A99EA]" : "bg-red-500"
                  }`}
                >
                  {isCorrect(action) ? "○" : "×"}
                </span>
                {isCorrect(action) ? "正解" : "不正解"}
              </p>
              {/* △ で答えたときだけ、4択で何を選んだかを添える */}
              {(action === "unsure_correct" || action === "unsure_wrong") && (
                <p className="-mt-1 text-center text-xs text-zinc-500">
                  △ で回答
                  {action === "unsure_wrong" &&
                    picked !== null &&
                    ` ・ 選択: ${choices[picked]}`}
                </p>
              )}
              {/* 地色の上なので、白を透かして重ねる (bg-zinc-100 だと色が濁る) */}
              <div className="rounded-2xl bg-white/75 p-3 text-sm">
                <p className="font-bold">{item.meaningJa}</p>
                <div className="mt-1 flex items-start gap-2">
                  <p className="flex-1 text-zinc-600">{item.exampleEn}</p>
                  <button
                    type="button"
                    aria-label="例文を読み上げる"
                    onClick={
                      ghost
                        ? undefined
                        : (e) => {
                            e.stopPropagation();
                            speakText(item.exampleEn);
                          }
                    }
                    onPointerDown={(e) => e.stopPropagation()}
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors ${
                      ghost ? "pointer-events-none" : "hover:bg-white hover:text-zinc-700"
                    }`}
                  >
                    <Volume2 size={15} />
                  </button>
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">{item.exampleJa}</p>
              </div>
            </div>
          )}

          {/* Tinder風: カード右下の ↑ でカードの詳細を開く */}
          {!noDetail && (
          <button
            ref={arrowRef}
            onClick={() => openDetail()}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="カードの詳細を見る"
            className="absolute bottom-4 right-4 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-600 transition-colors hover:bg-zinc-50"
          >
            <ArrowUp size={20} strokeWidth={2.5} />
          </button>
          )}

          {note && step !== "choices" && (
            <p className="relative z-10 mt-3 rounded-2xl border border-zinc-200 px-3 py-2 text-xs text-zinc-500">
              メモ: {note}
            </p>
          )}
        </div>
      </div>

      {/* Tinder風の操作ボタン。演習は × ○ の2つ、復習は × △ ○ の3つ。
          飛んでいくコピーは本体のボタン列と二重に見えるので描かない */}
      <div
        ref={buttonsRef}
        // チュートリアルのスポットライトの対象。飛んでいくコピーは invisible な
        // 二重の列なので印を付けない (付けると querySelector が先に当たった
        // ほうを掴んで、穴が見えないボタン列の上に開く)
        data-tour={ghost ? undefined : "answer-buttons card-area"}
        className={`mt-4 flex shrink-0 items-center justify-center gap-3 ${
          ghost ? "invisible" : ""
        } ${settle ? "buttons-settle" : ""}`}
      >
        <button
          onClick={() =>
            step === "ask"
              ? answer("unknown")
              : step === "choices"
                ? cancelChoices()
                : flipBack()
          }
          title={backLabel}
          aria-label={backLabel}
          data-tour={ghost ? undefined : "answer-unknown"}
          style={buttonFx("unknown")}
          className={`flex h-16 w-16 items-center justify-center rounded-full border-2 border-red-500 disabled:opacity-30 ${
            lit("unknown")
              ? "bg-red-500 text-white"
              : "bg-white text-red-500 hover:bg-red-500/10 dark:bg-black"
          }`}
        >
          {step === "ask" ? (
            <X size={28} strokeWidth={3} />
          ) : (
            <ArrowLeft size={28} strokeWidth={3} />
          )}
        </button>
        {showUnsure && (
          <button
            onClick={openChoices}
            disabled={step !== "ask"}
            title="△"
            aria-label="△"
            data-tour={ghost ? undefined : "answer-unsure"}
            style={buttonFx("unsure", step !== "ask")}
            className={`flex h-14 w-14 items-center justify-center rounded-full border-2 border-yellow-500 text-lg font-bold disabled:opacity-30 ${
              lit("unsure")
                ? "bg-yellow-500 text-white"
                : "bg-white text-yellow-500 hover:bg-yellow-500/10 dark:bg-black"
            }`}
          >
            △
          </button>
        )}
        <button
          onClick={() => (step === "ask" ? answer("known") : flyOut())}
          disabled={step === "choices"}
          title={step === "ask" ? "○" : "次のカードへ"}
          aria-label={step === "ask" ? "○" : "次のカードへ"}
          data-tour={ghost ? undefined : "answer-known"}
          style={buttonFx("known", step === "choices")}
          className={`flex h-16 w-16 items-center justify-center rounded-full border-2 border-[#4A99EA] disabled:opacity-30 ${
            lit("known")
              ? "bg-[#4A99EA] text-white"
              : "bg-white text-[#4A99EA] hover:bg-[#4A99EA]/10 dark:bg-black"
          }`}
        >
          {step === "ask" ? (
            <Circle size={26} strokeWidth={3} />
          ) : (
            <ArrowRight size={28} strokeWidth={3} />
          )}
        </button>
      </div>

      {detailOpen && (
        <CardDetailSheet
          tagProps={tagProps}
          onChangeTagProps={onChangeTagProps}
          item={item}
          note={note}
          onClose={() => setDetailOpen(false)}
          onSaveEdit={onSaveEdit}
          onSaveNote={onSaveNote}
          origin={detailOrigin}
          status={status}
          onSetResult={onSetResult}
          onSetProgress={onSetProgress}
          showUnsure={showUnsure}
          onAnswer={(kind) => {
            setDetailOpen(false);
            // 回答済みなら取り消してから回答し直す (カード画面と同じボタンを出す)
            if (step === "reveal" && action) {
              onUndo(action);
              setAction(null);
              setPicked(null);
              setStep("ask");
            }
            if (kind === "known") answer("known", true);
            else if (kind === "unknown") answer("unknown", true);
            // 詳細からは4択を出せない (意味がもう見えているので出す意味がない)。
            // △ は「怪しい → 不正解」= unsure_wrong として数える
            else answer("unsure_wrong", true);
          }}
        />
      )}
    </div>
  );
}

export function VocabTab({
  data,
  setData,
  tourActive = false,
  tourSampleReview = false,
  onModeChange,
  onFilterOpen,
  hideFilter = false,
  tourOpenSection = null,
}: Props) {
  // 出題範囲は「単語の設定」で決める (語彙 / イディオム / 両方)
  const kind = data.settings.vocab.cardSource;
  const unit = kind === "idioms" ? "個" : "語";
  const kindLabel = kind === "idioms" ? "イディオム" : "単語";
  const [filterOpen, setFilterOpen] = useState(false);
  // チュートリアルが設定のステップを抜けたら閉じる。開きっぱなしで
  // チュートリアルが終わると、締めの画面の裏にシートが残る
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hideFilter) setFilterOpen(false);
  }, [hideFilter]);
  const [dbs, setDbs] = useState<WordDbMap | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [mode, setMode] = useState<QuizMode>("drill");
  // タブを切り替えたときのスライド方向 (右のタブへ動いたら正)
  const [slideFrom, setSlideFrom] = useState(24);
  const [queue, setQueue] = useState<WordDbEntry[]>([]);
  const [index, setIndex] = useState(0);
  // 出題のたびに1つ増える。WordCard の key に混ぜて、**同じ語が2回続いても
  // 必ず作り直させる**ための番号。復習の対象が1語しか無いとき
  // (測定10問で1問だけ×だった直後など) キューは [a] のまま作り直されるので、
  // key が item.word だけだとカードが解説面のまま固まって先へ進めなくなる
  const [cardSeq, setCardSeq] = useState(0);
  // 飛んでいる最中のカードのコピー (触れない見た目だけの層)。
  // 1枚に限らず配列で持つ。演習モードは続けて仕分ける前提なので、
  // 前のカードが飛びきる前に次を飛ばすことがよくある。1枚しか持たないと
  // そこで前のコピーが差し替わって、飛んでいる途中でふっと消える
  const [flying, setFlying] = useState<(FlyingCard & { key: number })[]>([]);
  // セッション中の回答数と正解数 (無限出題なので件数だけ持つ)
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
    fetchAllWordDbs(kind)
      .then((d) => {
        if (cancelled) return;
        setDbs(d);
        // 出題対象レベルが決まっていれば、ボタンを押さずにランダム出題を始める
        const lvs = activeLevels(data.settings.vocab, data.vocabLevel.current);
        if (lvs.length > 0) {
          const q = buildQueue(
            d,
            lvs,
            data.vocab,
            data.settings.vocab,
            "drill",
            BATCH_SIZE,
            new Date(),
            new Set(),
            data.tagProps,
            data.edits,
          );
          setMode("drill");
          setQueue(q);
          setIndex(0);
          setPhase("quiz");
          return;
        }
        setPhase("idle");
      })
      .catch((e) => {
        if (!cancelled) setDbError(requestErrorMessage(e, "読み込み失敗"));
      });
    return () => {
      cancelled = true;
    };
    // 初回ロード時のみ自動出題する (data を依存に入れると回答のたびに作り直してしまう)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const vocabLevel = data.vocabLevel;
  // 出題対象のレベル。自動なら測定値の1つ、手動なら設定で選んだぶんすべて
  const levels = activeLevels(data.settings.vocab, vocabLevel.current);
  const stats =
    dbs && levels.length > 0
      ? dbStats(dbs, levels, data.vocab, data.settings.vocab.masterKnownCount)
      : null;

  // 先週比 (7日前時点の統計を回答履歴から復元して差分を出す)
  const deltas = useMemo(() => {
    if (!dbs || levels.length === 0) return null;
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const master = data.settings.vocab.masterKnownCount;
    const past = dbStatsAsOf(dbs, levels, data.vocab, master, weekAgo);
    const cur = dbStats(dbs, levels, data.vocab, master);
    return {
      known: cur.known - past.known,
      fuzzy: cur.fuzzy - past.fuzzy,
      unknown: cur.unknown - past.unknown,
      new: cur.new - past.new,
    };
    // levels は settings と測定値から毎回作り直すので、依存はその元だけを見る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbs, vocabLevel.current, data.vocab, data.settings.vocab]);

  // 学習記録を更新する。countRecent が真なら直近正解率のウィンドウにも加える
  const record = (
    word: WordDbEntry,
    action: VocabAction,
    countRecent: boolean,
  ) => {
    const nowIso = new Date().toISOString();
    const correct = isCorrect(action);
    const wordLevel =
      wordIndex?.get(word.word)?.level ?? vocabLevel.current ?? "B1";
    setData((prev) => {
      // 回答したら、カード詳細で手動指定したステータスは外して記録どおりに戻す
      const prevEntry = prev.vocab[word.word];
      const e = prevEntry ? clearStatusOverride(prevEntry) : undefined;
      const history = [...(e?.history ?? []), { t: nowIso, r: action }].slice(
        -50,
      );
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
              (action === "unsure_correct" || action === "unsure_wrong"
                ? 1
                : 0),
            unknownCount:
              (e?.unknownCount ?? 0) + (action === "unknown" ? 1 : 0),
            correctCount:
              (e?.correctCount ?? 0) + (action === "unsure_correct" ? 1 : 0),
            wrongCount:
              (e?.wrongCount ?? 0) + (action === "unsure_wrong" ? 1 : 0),
            needsReview: !correct,
            lastSeenAt: nowIso,
            history,
          },
        },
        vocabLevel: countRecent
          ? {
              ...prev.vocabLevel,
              recent: [...prev.vocabLevel.recent, correct].slice(
                -LEVEL_SHIFT_WINDOW,
              ),
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
      // 測ったその場で最初のキューを作っておく。結果画面の「学習をはじめる」から
      // そのままカードへ移れるようにするため。ここで作らずに idle へ落とすと
      // 「出題できる単語がありません」の画面に突き当たって先へ進めない
      setMode("drill");
      setQueue(
        buildQueue(
          dbs,
          activeLevels(data.settings.vocab, est),
          data.vocab,
          data.settings.vocab,
          "drill",
          BATCH_SIZE,
          new Date(),
          // 測定で出したばかりの語がそのまま続けて出ないようにする
          pSeen,
          data.tagProps,
          data.edits,
        ),
      );
      setIndex(0);
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

  // 直前の回答を取り消す (カードの表側に戻るときに記録も巻き戻す)
  const undoAnswer = (
    word: string,
    action: VocabAction,
    countedRecent: boolean,
  ) => {
    const correct = isCorrect(action);
    setData((prev) => {
      const e = prev.vocab[word];
      if (!e) return prev;
      const history = e.history.slice(0, -1);
      const last = history[history.length - 1];
      const rolledBack: VocabEntry = {
        ...e,
        knownCount: e.knownCount - (action === "known" ? 1 : 0),
        unsureCount:
          e.unsureCount -
          (action === "unsure_correct" || action === "unsure_wrong" ? 1 : 0),
        unknownCount: e.unknownCount - (action === "unknown" ? 1 : 0),
        correctCount: e.correctCount - (action === "unsure_correct" ? 1 : 0),
        wrongCount: e.wrongCount - (action === "unsure_wrong" ? 1 : 0),
        needsReview: last
          ? last.r === "unsure_wrong" || last.r === "unknown"
          : false,
        lastSeenAt: last ? last.t : e.lastSeenAt,
        history,
      };
      return {
        ...prev,
        vocab: { ...prev.vocab, [word]: rolledBack },
        vocabLevel: countedRecent
          ? { ...prev.vocabLevel, recent: prev.vocabLevel.recent.slice(0, -1) }
          : prev.vocabLevel,
        stats: {
          ...prev.stats,
          vocabAnswered: Math.max(0, prev.stats.vocabAnswered - 1),
          vocabCorrect: Math.max(
            0,
            prev.stats.vocabCorrect - (correct ? 1 : 0),
          ),
        },
      };
    });
  };

  // カード詳細で編集した内容を保存する (DBの値を上書きする)
  const saveEdit = (word: string, patch: WordEdit) => {
    setData((prev) => ({
      ...prev,
      edits: { ...prev.edits, [word]: { ...prev.edits[word], ...patch } },
    }));
  };

  // 単語ごとのメモを保存する (空文字なら削除)
  const saveNote = (word: string, text: string) => {
    setData((prev) => {
      const notes = { ...prev.notes };
      if (text) notes[word] = text;
      else delete notes[word];
      return { ...prev, notes };
    });
  };

  // カード詳細に出すステータス。手動指定があればそれを、無ければ学習記録から導く
  const statusOf = (word: string) =>
    statusBadges(data.vocab[word], data.settings.vocab.masterKnownCount);
  const levelOf = (def: WordDbEntry) =>
    wordIndex?.get(def.word)?.level ?? vocabLevel.current ?? "B1";
  const setResultOf =
    (def: WordDbEntry) => (next: LastResult | null) =>
      setData((prev) =>
        setStatusOverride(prev, def, levelOf(def), "result", next),
      );
  const setProgressOf =
    (def: WordDbEntry) => (next: Progress | null) =>
      setData((prev) =>
        setStatusOverride(prev, def, levelOf(def), "progress", next),
      );

  // 飛んでいくカードのコピーを立てる。飛び終えたぶんから順に片付ける。
  // key を毎回変えて、連続で飛ばしたときも1枚ずつ別のアニメーションとして走らせる
  const flightRef = useRef(0);
  const startFlight = (f: FlyingCard) => {
    flightRef.current += 1;
    const key = flightRef.current;
    setFlying((cur) => [...cur, { ...f, key }]);
    window.setTimeout(() => {
      // 自分のぶんだけ消す。まだ飛んでいる他のコピーには触らない
      setFlying((cur) => cur.filter((c) => c.key !== key));
    }, EXIT_MS + 80);
  };

  // 飛んでいくカードのコピー。触れない見た目だけの層として本体に重ねる。
  // 本体はもう次の単語に変わっているので、飛んでいる最中でもそのまま操作できる。
  // showUnsure / skipReveal はコピーの見た目に影響しない (ボタン列を出さないため)
  const flyingLayer = flying.map((f) => (
    // z-30 はカード内で使う最大の z-20 (スワイプ中の大きな英字) より上、
    // Sheet (z-40〜) より下。z-10 だと本体カードの中身 (z-10) と同点になり、
    // DOM順で後の本体側が勝って、下のカードの文字が飛んでいるカードの上に描かれる
    // (本体カードは stacking context を作らないので、中身の z がここまで届く)
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
        status={statusOf(f.item.word)}
        cardFields={data.settings.vocab.cardFields}
        showUnsure
        skipReveal={false}
        // コピーは触れないので、以下はどれも呼ばれない
        onAction={() => {}}
        onNext={() => {}}
        onFly={() => {}}
        onSaveNote={() => {}}
        onSaveEdit={() => {}}
        onUndo={() => {}}
        onSetResult={() => {}}
        onSetProgress={() => {}}
      />
    </div>
  ));

  // **設定を閉じたら出題キューを作り直す。** ここは「どのカードが出るか」を
  // 変える設定 (語彙/イディオム・難易度・タグ・復習の範囲) が入っているのに、
  // 作り直さないと今のバッチを使い切るまで前の条件のカードが出続ける。
  // タグで絞ったのに条件に合わない語が出てきて、効いていないように見えていた
  const closeFilter = () => {
    setFilterOpen(false);
    if (phase === "quiz") switchMode(mode);
  };

  // モードを切り替える (出題はそのまま続く)
  const switchMode = (m: QuizMode) => {
    if (!dbs || levels.length === 0) return;
    const from = MODE_TABS.findIndex((t) => t.key === mode);
    const to = MODE_TABS.findIndex((t) => t.key === m);
    setSlideFrom(to >= from ? 24 : -24);
    let q = buildQueue(
      dbs,
      levels,
      data.vocab,
      data.settings.vocab,
      m,
      BATCH_SIZE,
      new Date(),
      new Set(),
      data.tagProps,
      data.edits,
    );
    // チュートリアルの復習ステップで学習中の語が1つも無いときは、
    // 出題対象レベルから1語だけ借りてサンプルにする。空画面で詰ませない
    if (m === "review" && q.length === 0 && tourSampleReview) {
      const sample = levels
        .flatMap((lv) => dbs[lv].words as WordDbEntry[])
        .find((w) => w);
      if (sample) q = [sample];
    }
    setMode(m);
    onModeChange?.(m);
    setQueue(q);
    setIndex(0);
    setShiftMsg(null);
    setPhase("quiz");
  };

  // 次のバッチを作る。このタイミングで直近正解率によるレベル自動調整も判定する
  // (手動設定のときは行わない)
  const buildNextBatch = (exclude: Set<string>): WordDbEntry[] => {
    if (!dbs || levels.length === 0) return [];
    let nextLevels = levels;
    const shift =
      mode === "drill" && data.settings.vocab.levelMode === "auto"
        ? evaluateLevelShift(data.vocabLevel)
        : null;
    if (shift) {
      nextLevels = [shift.next];
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
    const q = buildQueue(
      dbs,
      nextLevels,
      data.vocab,
      data.settings.vocab,
      mode,
      BATCH_SIZE,
      new Date(),
      exclude,
      data.tagProps,
      data.edits,
    );
    // 除外すると1語も残らないなら、除外なしで作り直す
    return q.length > 0
      ? q
      : buildQueue(
          dbs,
          nextLevels,
          data.vocab,
          data.settings.vocab,
          mode,
          BATCH_SIZE,
          new Date(),
          new Set(),
          data.tagProps,
          data.edits,
        );
  };

  // 次の1問へ。キューを使い切る前に継ぎ足して無限に出題を続ける
  const next = () => {
    setCardSeq((n) => n + 1);
    const remaining = queue.length - (index + 1);
    if (remaining < 1) {
      // 継ぎ足せていなかったときの保険。作り直して先頭から出し直す
      const q = buildNextBatch(new Set(queue.map((w) => w.word)));
      if (q.length === 0) return;
      setQueue(q);
      setIndex(0);
      return;
    }
    if (remaining > 1) {
      setIndex(index + 1);
      return;
    }
    // 残り1枚になった。背面に重ねる次のカードを切らさないよう、ここで継ぎ足す。
    // 直前に出した語がすぐ再登場しないように、末尾1バッチぶんは除外する
    const add = buildNextBatch(
      new Set(queue.slice(-BATCH_SIZE).map((w) => w.word)),
    );
    if (add.length === 0) {
      setIndex(index + 1);
      return;
    }
    // キューが伸び続けないよう、古いぶんは切り捨てて index をずらす
    const merged = [...queue, ...add];
    const drop = Math.max(0, merged.length - BATCH_SIZE * 3);
    setQueue(merged.slice(drop));
    setIndex(index + 1 - drop);
  };

  const resetPlacement = () => {
    setData((prev) => ({ ...prev, vocabLevel: { current: null, recent: [] } }));
    setPhase("idle");
  };

  // ---- 表示 ----

  // 出題モードの切替タブ。件数は buildQueue が同じモードで拾う範囲に合わせる
  // (復習の件数 = 学習中)。演習は無限に出し続けるので件数を出さない
  const modeCount: Record<QuizMode, number | null> = {
    drill: null,
    // **buildQueue(review) が拾う集合と必ず一致させる。**
    // 復習の対象は設定 (reviewProgress) で選べるので、件数もそれに従う
    review: stats
      ? reviewProgressOf(data.settings.vocab).reduce(
          (n, p) => n + stats[p],
          0,
        )
      : null,
  };
  const modeTabs = (
    <div className="flex items-stretch border-b border-zinc-200 dark:border-zinc-800">
      <button
        onClick={() => {
          if (!filterOpen) onFilterOpen?.();
          setFilterOpen((v) => !v);
        }}
        aria-label="単語の設定"
        aria-expanded={filterOpen}
        data-tour="card-settings"
        className="mr-1 flex w-11 shrink-0 items-center justify-center text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
      >
        <SlidersHorizontal size={20} />
      </button>
      {/* タブは2つだけなので横スクロールにせず、残り幅を等分する */}
      {MODE_TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => switchMode(t.key)}
          data-tour={`mode-${t.key}`}
          className={`relative flex-1 py-3 text-sm transition-colors ${
            mode === t.key
              ? "font-bold"
              : "text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          }`}
        >
          {t.label}
          {modeCount[t.key] !== null && (
            <span className="ml-1 text-[10px] text-zinc-400">
              {modeCount[t.key]}
            </span>
          )}
          {mode === t.key && (
            <span className="absolute inset-x-0 bottom-0 mx-auto h-1 w-14 rounded-full bg-[#4A99EA]" />
          )}
        </button>
      ))}
    </div>
  );

  // 単語の設定。上のタブの下から画面の下へ向けて開く。
  // **modeTabs ともども早期 return より前で定義する。** 出題できない状態の画面
  // (イディオムだけ + 未測定 など) からも、ここを開いて出題範囲を戻せないと
  // 抜け道が無くなる
  const filterSheet = (
    <Sheet
      side="bottom"
      open={filterOpen}
      onClose={closeFilter}
      top={138}
      bottom={0}
    >
      <CardFilterSheet
        openSection={tourOpenSection}
        settings={data.settings.vocab}
        data={data}
        setData={setData}
        onChange={(next) =>
          setData((prev) => ({
            ...prev,
            settings: { ...prev.settings, vocab: next },
          }))
        }
        onClose={closeFilter}
      />
    </Sheet>
  );

  if (dbError) {
    return (
      <div className="rounded-2xl border border-red-500/40 bg-white p-6 text-center text-sm text-red-500 dark:bg-black">
        {dbError}
      </div>
    );
  }

  if (!dbs || phase === "loading") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 bg-white py-16 dark:border-zinc-800 dark:bg-black">
        <Loader2 className="animate-spin text-[#4A99EA]" size={28} />
        <p className="text-sm text-zinc-500">単語データベースを読み込み中...</p>
      </div>
    );
  }

  // イディオム部門は語彙タブで測定した単語レベルを使う
  // イディオムだけ + 未測定。**ここは完全な行き止まりだった。**
  // この枝には modeTabs (単語の設定を開く唯一のボタン) も測定のボタンも無く、
  // 歯車の中にも出題範囲を戻す導線が無いので、
  // 「学習データをリセット」で全記録を捨てる以外に抜け道が無かった。
  // しかも文面は存在しない「語彙タブ」を案内していた。
  // 出口を2つ (測定を始める / 単語の設定を開く) 置く
  if (kind === "idioms" && vocabLevel.current === null) {
    return (
      <div className="flex h-full flex-col">
        {modeTabs}
        <div className="mt-3 rounded-2xl border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-black">
          <Gauge className="mx-auto text-[#4A99EA]" size={28} />
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
            イディオムの出題には単語レベルを使います。先にレベル測定 (
            {PLACEMENT_SIZE}問) を行ってください。
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            左上の「単語の設定」から出題範囲に「語彙」を足すこともできます。
          </p>
          <button
            onClick={startPlacement}
            className="mt-4 rounded-lg bg-[#4A99EA] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#3d87d4]"
          >
            測定をはじめる ({PLACEMENT_SIZE}問)
          </button>
        </div>
        {filterSheet}
      </div>
    );
  }

  // 未測定 → 測定フロー
  if (
    vocabLevel.current === null &&
    phase !== "placement" &&
    phase !== "placementDone"
  ) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-black">
        <Gauge className="mx-auto text-[#4A99EA]" size={28} />
        <h3 className="mt-2 text-base font-semibold">
          まず単語レベルを測定します
        </h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-zinc-600 dark:text-zinc-300">
          {PLACEMENT_SIZE}問に答えると、あなたの単語レベル (A1〜C1)
          を判定します。正解すると次は難しい単語、間違えると易しい単語が出る方式です。
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          測定後も、直近の正解率に応じてレベルは自動で上下します。
        </p>
        <button
          onClick={startPlacement}
          data-tour="placement-start"
          className="mt-4 rounded-lg bg-[#4A99EA] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#3d87d4]"
        >
          測定をはじめる ({PLACEMENT_SIZE}問)
        </button>
      </div>
    );
  }

  if (phase === "placement" && pItem) {
    return (
      <div className="relative flex h-full flex-col gap-3">
        <div
          className="flex items-center justify-between text-sm text-zinc-500"
          // 測定中のスポットライトの対象。「測定をはじめる」ボタンは押した時点で
          // 消えるので、10問のあいだ指すものが無くなる。ここを指せば吹き出しが
          // カード上部の余白に収まり、下端の回答ボタンに被らない
          data-tour="placement-progress"
        >
          <span>
            レベル測定 {pCount + 1} / {PLACEMENT_SIZE} 問
          </span>
          <span className="text-xs">
            いま {levelLabel(LEVEL_ORDER[Math.min(pLadder, 4)])} の単語
          </span>
        </div>
        {flyingLayer}
        <WordCard
          key={pItem.word}
          noDetail={tourActive}
          onFly={startFlight}
          tagProps={data.tagProps}
          onChangeTagProps={(next) =>
            setData((prev) => ({ ...prev, tagProps: next }))
          }
          autoSpeak={data.settings.vocab.autoSpeak}
          settleButtons={flying.length > 0}
          item={applyEdit(pItem, data.edits[pItem.word])}
          note={data.notes[pItem.word]}
          status={statusOf(pItem.word)}
          onSetResult={setResultOf(pItem)}
          onSetProgress={setProgressOf(pItem)}
          // 次に出す単語はこの回答の正誤で決まるので、背面に重ねるカードは無い
          nextItem={undefined}
          nextNote={undefined}
          onAction={onPlacementAction}
          onNext={onPlacementNext}
          onSaveNote={(text) => saveNote(pItem.word, text)}
          onSaveEdit={(patch) => saveEdit(pItem.word, patch)}
          cardFields={data.settings.vocab.cardFields}
          onUndo={(a) => {
            undoAnswer(pItem.word, a, false);
            const next = pTrack.slice(0, -1);
            setPTrack(next);
            setPLadder(next.length > 0 ? next[next.length - 1] : 2);
          }}
          // 測定は演習と同じ ○ / × の2択にする。チュートリアルが「この10問の答え方が
          // そのまま普段の演習です」と説明できるようにするため (ユーザーの指定)。
          // 解説だけは残す。測定は初めて見る単語が続くので、答えた直後に意味が出ないと
          // 10問がただの作業になる
          showUnsure={false}
          skipReveal={false}
        />
      </div>
    );
  }

  if (phase === "placementDone" && placementResult) {
    const def = LEVELS.find((l) => l.key === placementResult);
    return (
      <div
        className="rounded-2xl border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-black"
        data-tour="placement-result"
      >
        <p className="text-sm text-zinc-500">あなたの単語レベル</p>
        <p className="mt-2 text-4xl font-semibold text-[#4A99EA]">
          {placementResult}
          <span className="ml-2 text-2xl">{def?.label}</span>
        </p>
        <p className="mt-1 text-sm text-zinc-500">{def?.guide}</p>
        {/* **チュートリアル中は「学習をはじめる」を出さない。** 押すと phase が
            quiz に飛んで、チュートリアルが用意した順序 (結果 → 単語リスト → 演習)
            から外れてしまう。チュートリアルは結果のステップの「次へ」で進むので
            この出口は要らない。
            ただし**チュートリアルの外では消せない。** 設定から測り直したときは
            この画面が終端で、ボタンが無いと phase === "placementDone" のまま
            出口を失う (単語タブが結果表示のまま固まる) */}
        {!tourActive && (
        <button
          onClick={() => setPhase("quiz")}
          className="mt-5 rounded-lg bg-[#4A99EA] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#3d87d4]"
        >
          学習をはじめる
        </button>
        )}
      </div>
    );
  }

  // 学習履歴の数値表示は一旦取り下げ (再実装の可能性あり)。統計はタブの件数にのみ使う
  const statsRowRetired = stats && (
    <div className="rounded-2xl border border-zinc-200 bg-white px-2 py-4 dark:border-zinc-800 dark:bg-black">
      <div className="flex justify-around">
        {[
          {
            key: "known" as const,
            label: "○",
            sub: null,
            value: stats.known,
            ring: "border-[#4A99EA]",
            good: (d: number) => d > 0,
          },
          {
            key: "fuzzy" as const,
            label: "△",
            sub: null,
            value: stats.fuzzy,
            ring: "border-yellow-500",
            good: (d: number) => d > 0,
          },
          {
            key: "unknown" as const,
            label: "×",
            sub: null,
            value: stats.unknown,
            ring: "border-red-500",
            good: (d: number) => d < 0,
          },
          {
            key: "new" as const,
            label: "未学習",
            sub: null,
            value: stats.new,
            ring: "border-zinc-300 dark:border-zinc-700",
            good: (d: number) => d < 0,
          },
        ].map((c) => {
          const d = deltas ? deltas[c.key] : 0;
          return (
            <div key={c.label} className="flex flex-col items-center gap-1.5">
              <div
                className={`flex h-14 w-14 items-center justify-center rounded-full border-2 text-base font-bold tabular-nums ${c.ring}`}
              >
                {c.value}
              </div>
              <span className="text-[11px] text-zinc-500">
                {c.label}
                {c.sub && <span className="ml-0.5 text-zinc-400">{c.sub}</span>}
              </span>
              <span
                className={`text-[11px] font-medium tabular-nums ${
                  d === 0
                    ? "text-zinc-300 dark:text-zinc-600"
                    : c.good(d)
                      ? "text-[#4A99EA]"
                      : "text-red-500"
                }`}
              >
                {d > 0 ? `+${d}` : d}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-1 text-center text-[10px] text-zinc-400">
        {vocabLevel.current ? `${levelLabel(vocabLevel.current)} ・ ` : ""}
        下段は先週比
      </p>
    </div>
  );

  if (phase === "quiz") {
    const item = queue[index];
    // 背面に重ねるカード。キューは残り1枚で継ぎ足すので、通常は必ず存在する
    const nextItem = queue[index + 1];
    return (
      <div className="flex h-full flex-col gap-3">
        {filterSheet}
        {modeTabs}
        {shiftMsg && (
          <div className="flex items-start gap-2 rounded-2xl bg-[#4A99EA]/10 p-3 text-sm text-[#4A99EA]">
            {shiftMsg.includes("上げました") ? (
              <TrendingUp size={16} className="mt-0.5 shrink-0" />
            ) : (
              <TrendingDown size={16} className="mt-0.5 shrink-0" />
            )}
            <span className="flex-1">{shiftMsg}</span>
            <button
              onClick={() => setShiftMsg(null)}
              className="shrink-0 text-xs underline"
            >
              閉じる
            </button>
          </div>
        )}
        {item ? (
          <div
            key={mode}
            style={{ "--tab-slide-from": `${slideFrom}px` } as React.CSSProperties}
            className="tab-slide relative flex min-h-0 flex-1 flex-col"
          >
            {flyingLayer}
            <WordCard
              key={`${item.word}#${cardSeq}`}
              noDetail={tourActive}
              onFly={startFlight}
              tagProps={data.tagProps}
              onChangeTagProps={(next) =>
                setData((prev) => ({ ...prev, tagProps: next }))
              }
              autoSpeak={data.settings.vocab.autoSpeak}
              settleButtons={flying.length > 0}
              item={applyEdit(item, data.edits[item.word])}
              note={data.notes[item.word]}
              nextItem={
                nextItem
                  ? applyEdit(nextItem, data.edits[nextItem.word])
                  : undefined
              }
              nextNote={nextItem ? data.notes[nextItem.word] : undefined}
              status={statusOf(item.word)}
              onSetResult={setResultOf(item)}
              onSetProgress={setProgressOf(item)}
              onAction={(a) => {
                record(item, a, mode === "drill" && kind === "words");
              }}
              onNext={next}
              onSaveNote={(text) => saveNote(item.word, text)}
              onSaveEdit={(patch) => saveEdit(item.word, patch)}
              cardFields={data.settings.vocab.cardFields}
              onUndo={(a) => {
                undoAnswer(item.word, a, mode === "drill" && kind === "words");
              }}
              // 演習は ○ / × の2択で仕分けるだけ。復習は ? を足して解説まで見る
              showUnsure={mode === "review"}
              skipReveal={data.settings.vocab.skipReveal[mode]}
            />
          </div>
        ) : (
          <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-black">
            <Flame
              className="mx-auto text-zinc-300 dark:text-zinc-600"
              size={28}
            />
            {levels.length === 0 ? (
              // 自動設定なのにまだ測定していない (手動から切り替えた直後など)
              <>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                  単語レベルがまだ測定されていません。
                </p>
                <button
                  onClick={startPlacement}
                  className="mt-3 rounded-full bg-[#4A99EA] px-5 py-2 text-sm font-medium text-white hover:bg-[#3d87d4]"
                >
                  レベルを測定する ({PLACEMENT_SIZE}問)
                </button>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                  {mode === "review"
                    ? `復習する${kindLabel}はありません。`
                    : `出題できる${unit}がありません。`}
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  {mode === "review"
                    ? `演習で取りこぼした${unit}がここに溜まります。`
                    : "単語の設定で出題範囲やレベルを見直してください。"}
                </p>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  // idle
  const recentAcc =
    vocabLevel.recent.length > 0
      ? Math.round(
          (vocabLevel.recent.filter(Boolean).length /
            vocabLevel.recent.length) *
            100,
        )
      : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#4A99EA]/40 bg-[#4A99EA]/10 px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <Activity size={16} className="text-[#4A99EA]" />
          <span className="font-medium text-[#4A99EA]">
            単語レベル:{" "}
            {vocabLevel.current ? levelLabel(vocabLevel.current) : "未測定"}
          </span>
          {kind === "words" && recentAcc !== null && (
            <span className="text-xs text-[#4A99EA]">
              直近{vocabLevel.recent.length}問の正解率 {recentAcc}%
            </span>
          )}
          {kind === "idioms" && (
            <span className="text-xs text-[#4A99EA]">
              (語彙タブで測定・自動調整)
            </span>
          )}
        </div>
        {kind === "words" && (
          <ConfirmButton
            label="再測定する"
            question="レベルを測り直しますか？ (学習記録は残ります)"
            confirmLabel="測り直す"
            className="text-xs text-[#4A99EA] underline dark:text-[#4A99EA]"
            onConfirm={resetPlacement}
          />
        )}
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-black">
        <BookOpen className="mx-auto text-[#4A99EA]" size={28} />
        {levels.length === 0 ? (
          // 出題対象レベルが1つも無いと switchMode が何もできないので、
          // 「出題する」ではなく設定を直す導線を出す
          <>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              出題対象のレベルが選ばれていません。単語の設定で難易度を選ぶか、レベルを測り直してください。
            </p>
            <button
              onClick={startPlacement}
              className="mt-4 rounded-full bg-[#4A99EA] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#3d87d4]"
            >
              レベルを測定する ({PLACEMENT_SIZE}問)
            </button>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              出題できる{kindLabel}
              がありません。設定を見直すか、レベルを再測定してください。
            </p>
            <button
              onClick={() => switchMode("drill")}
              className="mt-4 rounded-full bg-[#4A99EA] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#3d87d4]"
            >
              <RefreshCw size={15} className="mr-1 inline" />
              出題する
            </button>
          </>
        )}
      </div>
    </div>
  );
}
