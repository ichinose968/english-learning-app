"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowDown,
  Circle,
  ImagePlus,
  Pencil,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import {
  DOMAIN_LABEL_JA,
  LastResult,
  Progress,
  PROGRESS_OPTIONS,
  RESULT_OPTIONS,
  THEME_LABEL_JA,
  WordDbEntry,
  WordEdit,
  WORD_DOMAINS,
  WORD_EXAMS,
  WORD_THEMES,
} from "@/lib/english/types";
import { primeSpeech, speak } from "@/lib/english/speech";

type SectionKey = "status" | "meaning" | "tags" | "example" | "related" | "note";

// カード画面から詳細を開くときの開始位置。カードが画面いっぱいに広がり、
// ↑ ボタンは ↓ へ回りながら上へ、× ? ○ は画面下端へ移動する
export interface SheetOrigin {
  card: Rect;
  arrow: Rect | null;
  buttons: Rect | null;
}
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const centerOf = (b: Rect) => ({
  x: b.left + b.width / 2,
  y: b.top + b.height / 2,
});

export const rectOf = (el: Element | null | undefined): Rect | null => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
// 閉じるときも開くときと同じ曲線を使う。数式どおりに反転した
// cubic-bezier(0.64, 0, 0.78, 0) は出だしが止まって見え、押しても反応しないように感じる
const EASE_BACK = EASE;
const DURATION = 0.38;

// ---- 下へ引いて閉じる ----
//
// ↓ ボタンは開くときの逆再生 (カードの矩形へ縮んで戻る) だが、こちらは
// 引いた指のまま下へ抜けていく別の動き。指の延長で閉じるほうが自然なため。
// 判定はカードのスワイプ (VocabTab の committed) と同じ考え方で、
// 距離と速さの両方を見る。距離だけだと毎回大きく引くことになる
const DISMISS_PX = 110; // これだけ引けば閉じる
const DISMISS_FLICK_PX = 24; // 弾いて閉じるときの最低距離
const DISMISS_FLICK_SPEED = 0.5; // px/ms
// これ未満は指の揺れとみなして無視する。
// **ブラウザが「タップ」とみなす移動量より必ず大きくすること。**
// iOS Safari は約10pt、Android Chrome は約8dp まで動いても click を出すので、
// ここを 6px にすると「下へ8pxぶれたふつうのタップ」でも引く操作と判定され、
// 直後の click を握りつぶしてしまう (詳細内の編集ボタンやチップが1回効かなくなる)。
// ついでにタップのたびにパネルが数px沈んで戻る
const DISMISS_SLOP = 14;
const DISMISS_S = 0.3; // 下へ抜けるまでの時間

// アプリ本体の列幅。app/english/page.tsx の max-w-2xl (42rem = 672px) と必ず揃える。
// PCでは画面いっぱいに広がらず、この幅の列に収まる
const COLUMN_MAX_PX = 672;
const columnWidth = () => Math.min(window.innerWidth, COLUMN_MAX_PX);

// 関連語は「word = 意味」の行として編集する
function relatedToText(list: { word: string; meaningJa: string }[]): string {
  return list.map((r) => `${r.word} = ${r.meaningJa}`).join("\n");
}
function textToRelated(text: string): { word: string; meaningJa: string }[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [w, ...rest] = l.split("=");
      return { word: w.trim(), meaningJa: rest.join("=").trim() };
    })
    .filter((r) => r.word);
}

// Tinder風の丸枠セクション。右下の「編集」で中身を書き換えられる
function Box({
  icon,
  label,
  children,
  editing,
  onEdit,
  onSave,
  onCancel,
}: {
  icon?: React.ReactNode;
  label: string;
  children: React.ReactNode;
  editing: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-2xl bg-zinc-900 p-4">
      <div className="mb-2 flex items-center gap-1.5 text-xs text-zinc-500">
        {icon}
        <span>{label}</span>
      </div>
      {children}
      <div className="mt-3 flex justify-end gap-2">
        {editing ? (
          <>
            <button
              onClick={onCancel}
              className="rounded-full border border-zinc-700 px-4 py-1.5 text-sm text-zinc-400"
            >
              キャンセル
            </button>
            <button
              onClick={onSave}
              className="rounded-full bg-[#4A99EA] px-5 py-1.5 text-sm font-bold text-white hover:bg-[#3d87d4]"
            >
              保存
            </button>
          </>
        ) : (
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 rounded-full border border-zinc-700 px-4 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            <Pencil size={14} className="text-[#4A99EA]" /> 編集
          </button>
        )}
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-zinc-700 bg-transparent px-3 py-2 text-sm outline-none focus:border-[#4A99EA]";

// 背景画像は localStorage に data URL で入るため、長辺1000pxのJPEGに縮めてから保存する
const MAX_IMAGE_EDGE = 1000;
const MAX_IMAGE_CHARS = 1_200_000;

function shrinkImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error("画像を読み込めませんでした。"));
    const reader = new FileReader();
    reader.onerror = fail;
    reader.onload = () => {
      const img = new Image();
      img.onerror = fail;
      img.onload = () => {
        const scale = Math.min(
          1,
          MAX_IMAGE_EDGE / Math.max(img.width, img.height),
        );
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("画像を変換できませんでした。"));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export function CardDetailSheet({
  item,
  note,
  onClose,
  onSaveEdit,
  onSaveNote,
  onAnswer,
  showUnsure = true,
  initialEdit,
  origin,
  status,
  onSetResult,
  onSetProgress,
}: {
  item: WordDbEntry; // 編集内容を反映済みのエントリ
  note: string | undefined;
  // 開いた直後に編集状態にする項目 (メモボタンから開いたとき)
  initialEdit?: SectionKey;
  onClose: () => void;
  onSaveEdit: (patch: WordEdit) => void;
  onSaveNote: (text: string) => void;
  // 出題中に開いた場合のみ渡す。○ / ? / × を表示する
  onAnswer?: (kind: "known" | "unsure" | "unknown") => void;
  // ? を出すか。カード画面のボタン列と揃える (演習モードは ○ / × の2つだけ)。
  // 既定は3つ。単語一覧や長文から開いたときは回答バー自体が出ないので影響しない
  showUnsure?: boolean;
  // カード画面から開いたときの開始位置。渡されない場合は中央から拡大する
  origin?: SheetOrigin;
  // 学習状況。ラベルと色は呼び出し側 (単語一覧と共通の定義) から受け取る。
  // 前回結果は未回答なら label が空文字になり、バッジを描かない
  status: {
    result: { label: string; cls: string; manual: LastResult | null };
    progress: { label: string; cls: string; manual: Progress | null };
    // これまでの回答回数 (statusBadges が組み立てる)
    counts: { known: number; fuzzy: number; unknown: number };
  };
  // null を渡すと手動指定を解除し、学習記録から導かれる状態に戻す
  onSetResult: (next: LastResult | null) => void;
  onSetProgress: (next: Progress | null) => void;
}) {
  const [editing, setEditing] = useState<SectionKey | null>(initialEdit ?? null);
  const [dMeaning, setDMeaning] = useState(item.meaningJa);
  const [dExEn, setDExEn] = useState(item.exampleEn);
  const [dExJa, setDExJa] = useState(item.exampleJa);
  const [dExams, setDExams] = useState<string[]>(item.exams ?? []);
  const [dDomains, setDDomains] = useState<string[]>(item.domains ?? []);
  const [dThemes, setDThemes] = useState<string[]>(item.themes ?? []);
  const [dRelated, setDRelated] = useState(relatedToText(item.related ?? []));
  const [dNote, setDNote] = useState(note ?? "");
  const fileRef = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [loadingImage, setLoadingImage] = useState(false);
  // start: 開始位置を1フレームだけ描く / open: 最終位置へ /
  // closing: 開始位置へ戻す (↓ ボタン) / dismissing: 下へ抜ける (引いて閉じる)
  const [phase, setPhase] = useState<
    "start" | "open" | "closing" | "dismissing"
  >("start");
  const shown = phase === "open";
  const closeRef = useRef<HTMLButtonElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  // ↓ ボタンと回答バーは、最終位置を実測してから開始位置との差を出す
  const [offset, setOffset] = useState<{
    close: { x: number; y: number };
    bar: { x: number; y: number };
  } | null>(null);

  useLayoutEffect(() => {
    if (!origin) return;
    const close = rectOf(closeRef.current);
    const bar = rectOf(barRef.current);
    const delta = (from: Rect | null, to: Rect | null) => {
      if (!from || !to) return { x: 0, y: 0 };
      const a = centerOf(from);
      const b = centerOf(to);
      return { x: a.x - b.x, y: a.y - b.y };
    };
    setOffset({
      close: delta(origin.arrow, close),
      bar: { x: 0, y: delta(origin.buttons, bar).y },
    });
  }, [origin]);

  const measured = !origin || offset !== null;
  useEffect(() => {
    if (!measured || phase !== "start") return;
    const id = requestAnimationFrame(() => setPhase("open"));
    return () => cancelAnimationFrame(id);
  }, [measured, phase]);

  // ↓ を押したら開くときと逆再生してから、実際に閉じる
  const closeWithAnimation = () => {
    if (phase !== "open") return;
    setPhase("closing");
    window.setTimeout(onClose, DURATION * 1000);
  };

  // ---- 下へ引いて閉じる ----
  //
  // 引き始めた時点で中身が先頭まで戻っているときだけ効かせる。
  // 途中から効かせると、本文を読み進めようとした指で閉じてしまう
  // (Sheet.tsx の閉じるスワイプと同じ考え方)。
  // 先頭にいるあいだは下へ引いてもスクロールする余地が無いので、
  // overscroll-contain を添えておけば preventDefault なしで指に追従できる
  const panelRef = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    y0: number;
    active: boolean;
    hist: { y: number; t: number }[];
  } | null>(null);
  // 引いて閉じたあとに、下にあったボタンのクリックが発火しないようにする目印
  const swallowClickRef = useRef(false);

  // ハンドラは**スクロールしない根の要素**に置く (Sheet.tsx と同じ構造)。
  // パネル (スクロールする要素) 自身に置くと、ブラウザがジェスチャをスクロールと
  // 判定した瞬間に pointercancel が来て、以後 pointermove が届かなくなる。
  // 根に置けば、パネルが先頭まで来ていて下へ引けない状況では
  // ブラウザに奪うスクロールが無く、pointer イベントが流れ続ける
  const rootRef = useRef<HTMLDivElement>(null);

  // 追跡の本体。タッチとマウスの両方から同じ関数を呼ぶ
  const beginDrag = (y: number) => {
    // 前回の引き終わりに立てた目印は、ここで必ず下ろす。
    // 引いて離したあとクリックが発生しないこともあり
    // (指を大きく動かすとブラウザがクリックを出さない)、
    // 下ろさないと目印が残って **次のふつうのタップ** を食ってしまう
    swallowClickRef.current = false;
    if (phaseRef.current !== "open") return;
    // 引き始めた時点で中身が先頭まで戻っているときだけ効かせる。
    // 途中から効かせると、本文を読み進めようとした指で閉じてしまう
    if ((panelRef.current?.scrollTop ?? 0) > 0) return;
    dragRef.current = {
      y0: y,
      active: false,
      hist: [{ y, t: performance.now() }],
    };
  };

  const moveDrag = (y: number) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = y - d.y0;
    // 上へ動かしたら引くのをやめて、ふつうのスクロールに返す
    if (dy <= 0) {
      if (d.active) {
        d.active = false;
        setDragging(false);
        setDragY(0);
      }
      return;
    }
    if (!d.active) {
      if (dy < DISMISS_SLOP) return;
      d.active = true;
      setDragging(true);
    }
    const now = performance.now();
    d.hist.push({ y, t: now });
    // 速さは直近120msから出す。窓を広げると、動かしてから止めて離しても速いと判定される
    while (d.hist.length > 2 && now - d.hist[0].t > 120) d.hist.shift();
    setDragY(dy);
  };

  const finishDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || !d.active) return;
    const first = d.hist[0];
    const last = d.hist[d.hist.length - 1];
    const dy = last.y - d.y0;
    const dt = last.t - first.t;
    const speed = dt > 0 ? (last.y - first.y) / dt : 0;
    const commit =
      dy > DISMISS_PX ||
      (dy > DISMISS_FLICK_PX && speed > DISMISS_FLICK_SPEED);
    // 引いたぶんの上で指を離しているので、下のボタンのクリックは握りつぶす
    swallowClickRef.current = true;
    if (commit) {
      setPhase("dismissing");
      window.setTimeout(onClose, DISMISS_S * 1000);
      return;
    }
    setDragging(false);
    setDragY(0);
  };

  // beginDrag はネイティブリスナー (下の useEffect) からも呼ぶので、
  // phase は ref 越しに読む (マウント時のクロージャに古い値が残るため)
  const phaseRef = useRef(phase);
  useLayoutEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // ドラッグ関数もマウント時のクロージャから最新を呼べるよう ref に写す
  const beginRef = useRef(beginDrag);
  const moveRef = useRef(moveDrag);
  const finishRef = useRef(finishDrag);
  useLayoutEffect(() => {
    beginRef.current = beginDrag;
    moveRef.current = moveDrag;
    finishRef.current = finishDrag;
  });

  // タッチはネイティブの touch イベントで追跡する。pointer イベントに頼らない。
  //
  // **理由1 (pointercancel):** pointer イベントはブラウザがジェスチャをスクロールと
  // 判定した瞬間に pointercancel で途切れる。その判定のスロップ (8〜10px) は
  // こちらの発動しきい値 (14px) より小さいので、pointer 追跡は競争に必ず負ける。
  // touchmove はスクロールが始まっても配送され続けるので、こちらは途切れない。
  // **理由2 (preventDefault):** React の onTouchMove はルートに passive で付くため
  // preventDefault が無視される。ref + addEventListener({ passive: false }) が必須。
  //
  // preventDefault は「先頭から下向きに動いている」あいだずっと呼ぶ。
  // 先頭 (scrollTop 0) にいる以上、下向きの引きで動かせるスクロールは存在しないので、
  // 正当なスクロールを殺すことはない。上向き (dy < 0) は止めず、ふつうのスクロールに返す
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      beginRef.current(e.touches[0].clientY);
    };
    const onMove = (e: TouchEvent) => {
      const d = dragRef.current;
      const t = e.touches[0];
      if (!d || !t) return;
      if (t.clientY - d.y0 > 0 && e.cancelable) e.preventDefault();
      moveRef.current(t.clientY);
    };
    const onEnd = () => finishRef.current();
    root.addEventListener("touchstart", onStart, { passive: true });
    root.addEventListener("touchmove", onMove, { passive: false });
    root.addEventListener("touchend", onEnd);
    root.addEventListener("touchcancel", onEnd);
    return () => {
      root.removeEventListener("touchstart", onStart);
      root.removeEventListener("touchmove", onMove);
      root.removeEventListener("touchend", onEnd);
      root.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  // マウスは pointer イベントで拾う。タッチは上のネイティブリスナーが拾うので二重に始めない。
  //
  // **ポインタを掴んでおくこと (setPointerCapture)。**
  // マウスには touch のような暗黙のキャプチャが無いので、掴まないと
  // 「ポインタが根の上にある間」しか pointermove / pointerup が届かない。
  // 根は列幅 (max-w-2xl) に絞ってあるため、横に少し逸れただけで外れてしまい、
  // そのまま離すと finishDrag が呼ばれず、パネルが引いた位置に取り残される。
  // 掴むのは e.target (根ではなく実際に触れた要素)。根を掴むと
  // 中のボタンへの click まで根に付け替えられてしまう
  const onRootPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    beginDrag(e.clientY);
    if (dragRef.current) {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    }
  };
  const onRootPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    moveDrag(e.clientY);
  };
  const endRootDrag = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    finishDrag();
  };

  // 開始位置へ「飛ばす」ときは一瞬で、「戻す」ときはアニメーションさせる
  const backTransition =
    phase === "closing"
      ? `transform ${DURATION}s ${EASE_BACK}, opacity 0.24s ease-in 0.1s`
      : "none";

  // パネル本体。カードの矩形から画面全体へ広がる
  const panelStyle: React.CSSProperties = shown
    ? {
        transform: "none",
        opacity: 1,
        transition: `transform ${DURATION}s ${EASE}, opacity 0.22s ease-out`,
      }
    : origin
      ? (() => {
          // 拡大率は **パネルの幅** を基準にする。画面幅ではない。
          // PCではパネルが列幅 (max-w-2xl) で止まるので、画面幅で割ると
          // カードが実際より小さく見積もられ、開くときに一段小さいところから飛んでくる
          const panelW = columnWidth();
          const s = origin.card.width / panelW;
          const c = centerOf(origin.card);
          // パネルは mx-auto で画面中央に置かれるので、中心は画面の中心と一致する
          return {
            transform: `translate(${c.x - window.innerWidth / 2}px, ${
              c.y - window.innerHeight / 2
            }px) scale(${s})`,
            opacity: 0,
            transition: backTransition,
          };
        })()
      : { transform: "scale(0.92)", opacity: 0, transition: backTransition };

  // 引いているあいだ、および下へ抜けていくあいだの上書き。
  // パネル・閉じるボタン・回答バーの3つに同じだけ効かせる。
  // 閉じるボタンと回答バーはパネルの外にあるので、ここで一緒に動かさないと
  // パネルだけが下がって2つが宙に取り残される
  const dismissStyle: React.CSSProperties | null =
    phase === "dismissing"
      ? {
          // 画面の高さは vh で渡す (window を見るとサーバー描画で落ちる)
          transform: "translateY(100vh)",
          opacity: 1,
          transition: `transform ${DISMISS_S}s ${EASE}`,
        }
      : dragging
        ? {
            transform: `translateY(${dragY}px)`,
            opacity: 1,
            // 指に追従させるあいだは補間しない
            transition: "none",
          }
        : null;

  // 開始位置へ飛ばすときはアニメーションさせず、そこから最終位置へ動かす
  const flyStyle = (
    d: { x: number; y: number } | undefined,
    rotate = 0,
  ): React.CSSProperties =>
    shown
      ? {
          transform: "none",
          opacity: 1,
          transition: `transform ${DURATION}s ${EASE}, opacity 0.22s ease-out`,
        }
      : d
        ? {
            transform: `translate(${d.x}px, ${d.y}px) rotate(${rotate}deg)`,
            opacity: 1,
            transition: backTransition,
          }
        : { opacity: 0, transition: backTransition };

  const pickImage = async (file: File) => {
    setImageError(null);
    setLoadingImage(true);
    try {
      const dataUrl = await shrinkImage(file);
      if (dataUrl.length > MAX_IMAGE_CHARS) {
        setImageError("画像が大きすぎます。別の画像を選んでください。");
        return;
      }
      onSaveEdit({ bgImage: dataUrl });
    } catch (e) {
      setImageError(
        e instanceof Error ? e.message : "画像を読み込めませんでした。",
      );
    } finally {
      setLoadingImage(false);
    }
  };

  const startEdit = (key: SectionKey) => {
    // 開くたびに現在値を読み込む
    setDMeaning(item.meaningJa);
    setDExEn(item.exampleEn);
    setDExJa(item.exampleJa);
    setDExams(item.exams ?? []);
    setDDomains(item.domains ?? []);
    setDThemes(item.themes ?? []);
    setDRelated(relatedToText(item.related ?? []));
    setDNote(note ?? "");
    setEditing(key);
  };

  const toggle = (list: string[], v: string, set: (x: string[]) => void) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const tagChip = (active: boolean) =>
    `rounded-full px-2.5 py-0.5 text-xs transition-colors ${
      active
        ? "bg-[#4A99EA]/15 text-[#4A99EA]"
        : "border border-zinc-700 text-zinc-400"
    }`;

  const TagRow = ({ label, items }: { label: string; items: string[] }) => (
    <div className="flex flex-wrap items-baseline gap-1.5">
      <span className="w-10 shrink-0 text-xs text-zinc-500">{label}</span>
      {items.length > 0 ? (
        items.map((t) => (
          <span key={t} className={tagChip(true)}>
            {t}
          </span>
        ))
      ) : (
        <span className="text-xs text-zinc-400">なし</span>
      )}
    </div>
  );

  return (
    <div
      ref={rootRef}
      // 引いて閉じる操作はスクロールしない根で拾う (パネルに置くと、
      // ブラウザがスクロールと判定した瞬間 pointercancel で途切れる)
      onPointerDown={onRootPointerDown}
      onPointerMove={onRootPointerMove}
      onPointerUp={endRootDrag}
      onPointerCancel={endRootDrag}
      // 引いて離した指の下にあったボタンを押してしまわないようにする
      onClickCapture={(e) => {
        if (!swallowClickRef.current) return;
        swallowClickRef.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
      // PCでは本体と同じ列幅に収める (fixed は viewport 基準になるため)
      className="fixed inset-0 z-50 mx-auto max-w-2xl"
    >
      {/* パネル本体。白いカードの矩形から画面いっぱいまで広がる */}
      <div
        ref={panelRef}
        className="absolute inset-0 overflow-y-auto overscroll-y-contain bg-black pb-32 text-zinc-100"
        style={{ ...panelStyle, ...dismissStyle }}
      >
        <div className="mx-auto max-w-2xl">
          <header className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-black/85 px-4 py-3 backdrop-blur-md">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-2xl font-bold tracking-tight">{item.word}</p>
                <button
                  type="button"
                  aria-label={`${item.word} を読み上げる`}
                  onClick={() => {
                    primeSpeech();
                    speak(item.word);
                  }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                >
                  <Volume2 size={17} />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                {item.ipa && <span className="font-mono">{item.ipa}</span>}
                {/* 品詞はカード画面・単語一覧と同じ日本語表記に揃える */}
                <span>{item.pos}</span>
              </div>
            </div>
            {/* 閉じるボタンの場所だけ空けておく (本体はパネルの外で動かす) */}
            <span className="h-10 w-10 shrink-0" />
          </header>

        <div className="space-y-3 px-4 pb-6">
          {/* 意味・発音 */}
          <Box
            label="意味"
            editing={editing === "meaning"}
            onEdit={() => startEdit("meaning")}
            onCancel={() => setEditing(null)}
            onSave={() => {
              onSaveEdit({ meaningJa: dMeaning.trim() });
              setEditing(null);
            }}
          >
            {editing === "meaning" ? (
              <input
                value={dMeaning}
                onChange={(e) => setDMeaning(e.target.value)}
                placeholder="意味"
                className={inputCls}
              />
            ) : (
              <p className="text-base">{item.meaningJa}</p>
            )}
          </Box>

          {/* 例文 */}
          <Box
            label="例文"
            editing={editing === "example"}
            onEdit={() => startEdit("example")}
            onCancel={() => setEditing(null)}
            onSave={() => {
              onSaveEdit({ exampleEn: dExEn.trim(), exampleJa: dExJa.trim() });
              setEditing(null);
            }}
          >
            {editing === "example" ? (
              <div className="space-y-2">
                <textarea
                  value={dExEn}
                  onChange={(e) => setDExEn(e.target.value)}
                  rows={2}
                  placeholder="英文"
                  className={inputCls}
                />
                <textarea
                  value={dExJa}
                  onChange={(e) => setDExJa(e.target.value)}
                  rows={2}
                  placeholder="和訳"
                  className={inputCls}
                />
              </div>
            ) : (
              <>
                <div className="flex items-start gap-2">
                  <p className="flex-1 text-sm leading-relaxed">
                    {item.exampleEn}
                  </p>
                  <button
                    type="button"
                    aria-label="例文を読み上げる"
                    onClick={() => {
                      primeSpeech();
                      speak(item.exampleEn);
                    }}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                  >
                    <Volume2 size={15} />
                  </button>
                </div>
                <p className="mt-1 text-xs text-zinc-500">{item.exampleJa}</p>
              </>
            )}
          </Box>

          {/* 派生語・関連語 */}
          <Box
            label="派生語・関連語"
            editing={editing === "related"}
            onEdit={() => startEdit("related")}
            onCancel={() => setEditing(null)}
            onSave={() => {
              onSaveEdit({ related: textToRelated(dRelated) });
              setEditing(null);
            }}
          >
            {editing === "related" ? (
              <textarea
                value={dRelated}
                onChange={(e) => setDRelated(e.target.value)}
                rows={5}
                placeholder={"1行に1語\nnegotiation = 交渉"}
                className={inputCls}
              />
            ) : item.related && item.related.length > 0 ? (
              <div className="space-y-1.5">
                {item.related.map((r) => (
                  <div key={r.word} className="flex items-baseline gap-2">
                    <span className="text-sm font-medium">{r.word}</span>
                    <span className="text-xs text-zinc-500">{r.meaningJa}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-400">まだ登録がありません</p>
            )}
          </Box>

          {/* メモ */}
          <Box
            label="メモ"
            editing={editing === "note"}
            onEdit={() => startEdit("note")}
            onCancel={() => setEditing(null)}
            onSave={() => {
              onSaveNote(dNote.trim());
              setEditing(null);
            }}
          >
            {editing === "note" ? (
              <textarea
                value={dNote}
                onChange={(e) => setDNote(e.target.value)}
                rows={4}
                placeholder="覚え方、使い方、間違えた理由など"
                className={inputCls}
              />
            ) : note ? (
              <p className="whitespace-pre-wrap text-sm">{note}</p>
            ) : (
              <p className="text-sm text-zinc-400">
                まだメモはありません (編集から追加できます)
              </p>
            )}
          </Box>

          {/* タグ */}
          <Box
            label="タグ (試験・分野・テーマ)"
            editing={editing === "tags"}
            onEdit={() => startEdit("tags")}
            onCancel={() => setEditing(null)}
            onSave={() => {
              onSaveEdit({ exams: dExams, domains: dDomains, themes: dThemes });
              setEditing(null);
            }}
          >
            {editing === "tags" ? (
              <div className="space-y-3">
                <div>
                  <p className="mb-1 text-xs text-zinc-500">試験</p>
                  <div className="flex flex-wrap gap-1.5">
                    {WORD_EXAMS.map((t) => (
                      <button
                        key={t}
                        onClick={() => toggle(dExams, t, setDExams)}
                        className={tagChip(dExams.includes(t))}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-xs text-zinc-500">分野</p>
                  <div className="flex flex-wrap gap-1.5">
                    {WORD_DOMAINS.map((t) => (
                      <button
                        key={t}
                        onClick={() => toggle(dDomains, t, setDDomains)}
                        className={tagChip(dDomains.includes(t))}
                      >
                        {DOMAIN_LABEL_JA[t] ?? t}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-xs text-zinc-500">テーマ</p>
                  <div className="flex flex-wrap gap-1.5">
                    {WORD_THEMES.map((t) => (
                      <button
                        key={t}
                        onClick={() => toggle(dThemes, t, setDThemes)}
                        className={tagChip(dThemes.includes(t))}
                      >
                        {THEME_LABEL_JA[t] ?? t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <TagRow label="試験" items={item.exams ?? []} />
                <TagRow
                  label="分野"
                  items={(item.domains ?? []).map((d) => DOMAIN_LABEL_JA[d] ?? d)}
                />
                <TagRow
                  label="テーマ"
                  items={(item.themes ?? []).map((t) => THEME_LABEL_JA[t] ?? t)}
                />
              </div>
            )}
          </Box>

          {/* 学習状況。編集すると学習記録より優先される */}
          <Box
            label="ステータス"
            editing={editing === "status"}
            onEdit={() => setEditing("status")}
            onCancel={() => setEditing(null)}
            onSave={() => setEditing(null)}
          >
            {editing === "status" ? (
              <div className="space-y-3">
                <div>
                  <p className="mb-1.5 text-xs text-zinc-500">前回結果</p>
                  <div className="flex flex-wrap gap-1.5">
                    {RESULT_OPTIONS.map((m) => (
                      <button
                        key={m.key}
                        onClick={() => onSetResult(m.key)}
                        className={tagChip(status.result.manual === m.key)}
                      >
                        {m.label}
                      </button>
                    ))}
                    <button
                      onClick={() => onSetResult(null)}
                      className={tagChip(status.result.manual === null)}
                    >
                      自動
                    </button>
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-xs text-zinc-500">学習進捗度</p>
                  <div className="flex flex-wrap gap-1.5">
                    {PROGRESS_OPTIONS.map((m) => (
                      <button
                        key={m.key}
                        onClick={() => onSetProgress(m.key)}
                        className={tagChip(status.progress.manual === m.key)}
                      >
                        {m.label}
                      </button>
                    ))}
                    <button
                      onClick={() => onSetProgress(null)}
                      className={tagChip(status.progress.manual === null)}
                    >
                      自動
                    </button>
                  </div>
                </div>
                <p className="text-xs text-zinc-500">
                  「自動」は学習記録どおりの判定に戻します。手で指定した場合も、次にこのカードへ回答すると両方とも自動に戻ります。
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {status.result.label && (
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs ${status.result.cls}`}
                  >
                    {status.result.label}
                  </span>
                )}
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs ${status.progress.cls}`}
                >
                  {status.progress.label}
                </span>
                {(status.result.manual || status.progress.manual) && (
                  <span className="text-xs text-zinc-500">手動で指定</span>
                )}
              </div>
            )}
            {/* これまでの回答回数。編集中も出しっぱなしにする
                (手で付け替えるとき、実際の記録が横に見えていた方が判断しやすい)。
                色は前回結果のバッジ (RESULT_BADGE) と同じ系統に揃える */}
            <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
              <span>これまでの回答</span>
              <span className="text-[#4A99EA]">○ {status.counts.known}回</span>
              <span className="text-yellow-500">△ {status.counts.fuzzy}回</span>
              <span className="text-red-500">× {status.counts.unknown}回</span>
            </p>
          </Box>

          {/* 背景画像。次回以降このカードの背面に敷かれる */}
          <div className="rounded-2xl bg-zinc-900 p-4">
            <div className="mb-2 flex items-center gap-1.5 text-xs text-zinc-500">
              <span>背景画像</span>
            </div>
            {item.bgImage ? (
              <div
                className="h-32 w-full rounded-xl bg-cover bg-center"
                style={{ backgroundImage: `url(${item.bgImage})` }}
              />
            ) : (
              <p className="text-sm text-zinc-400">
                まだ背景画像はありません。カードの背面に敷く画像を選べます。
              </p>
            )}
            {imageError && (
              <p className="mt-2 text-xs text-red-500">{imageError}</p>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = ""; // 同じ画像を続けて選べるようにする
                if (file) void pickImage(file);
              }}
              className="hidden"
            />
            <div className="mt-3 flex justify-end gap-2">
              {item.bgImage && (
                <button
                  onClick={() => {
                    setImageError(null);
                    onSaveEdit({ bgImage: "" });
                  }}
                  className="flex items-center gap-1.5 rounded-full border border-red-500/60 px-4 py-1.5 text-sm text-red-500 hover:bg-red-500/10"
                >
                  <Trash2 size={14} /> 削除
                </button>
              )}
              <button
                onClick={() => fileRef.current?.click()}
                disabled={loadingImage}
                className="flex items-center gap-1.5 rounded-full border border-zinc-700 px-4 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              >
                <ImagePlus size={14} className="text-[#4A99EA]" />
                {loadingImage ? "読み込み中..." : item.bgImage ? "変更" : "画像を選ぶ"}
              </button>
            </div>
          </div>
          </div>
        </div>
      </div>

      {/* 閉じるボタン。カードの ↑ の位置から、回りながら右上へ移動して ↓ になる */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-30 mx-auto flex max-w-2xl justify-end px-4 py-3">
        <button
          ref={closeRef}
          onClick={closeWithAnimation}
          aria-label="詳細を閉じる"
          style={{ ...flyStyle(offset?.close, -180), ...dismissStyle }}
          className="pointer-events-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-black"
        >
          <ArrowDown size={20} strokeWidth={3} />
        </button>
      </div>

      {/* Tinder風: 詳細を開いたままでも回答できるボタン。カード画面の位置から下へ移動する */}
      {onAnswer && (
        <div
          ref={barRef}
          style={{ ...flyStyle(offset?.bar), ...dismissStyle }}
          // 間隔はカード画面のボタン列と揃える (gap-3)。
          // ここがずれると、閉じるアニメーションの着地点が実際のボタン位置と食い違う
          // 列幅に収める。中央寄せは mx-auto で行う
          // (この要素は flyStyle / dismissStyle でインラインの transform を受け取るので、
          //  translateX(-50%) を使うと上書きされて中央から外れる)
          className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-2xl items-center justify-center gap-3 bg-gradient-to-t from-black via-black/95 to-transparent py-4"
        >
          <button
            onClick={() => onAnswer("unknown")}
            title="×"
            className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-red-500 bg-black text-red-500 transition-colors hover:bg-red-500/10"
          >
            <X size={28} strokeWidth={3} />
          </button>
          {showUnsure && (
            <button
              onClick={() => onAnswer("unsure")}
              title="△"
              className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-yellow-500 bg-black text-lg font-bold text-yellow-500 transition-colors hover:bg-yellow-500/10"
            >
              △
            </button>
          )}
          <button
            onClick={() => onAnswer("known")}
            title="○"
            className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-[#4A99EA] bg-black text-[#4A99EA] transition-colors hover:bg-[#4A99EA]/10"
          >
            <Circle size={26} strokeWidth={3} />
          </button>
        </div>
      )}
    </div>
  );
}
