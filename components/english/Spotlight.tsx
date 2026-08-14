"use client";

import { useEffect, useRef, useState } from "react";

// チュートリアルのスポットライト。画面全体を暗くし、`data-tour` を付けた要素だけ
// 明るく抜いて、その隣に1行だけ説明を出す。
//
// **なぜこの形か。** 前の版は説明バナーをスクロールコンテナの先頭に置いていたが、
// ユーザーからの指摘は2つで「文章が長くて読む気にならない」「どこを見ればいいか
// 分からない」だった。どちらも同じ処方で直る。対象を1つに絞れば、指すものが
// 決まるので文章が1行で済む。バナーは対象を指せないぶん、文章で位置を
// 説明せざるをえず (「左上のスライダーが…」)、それが本文を長くしていた。
//
// 実装上の要点:
//
// - **暗い部分はタップを遮り、穴だけ通す。** 暗幕は1枚の box-shadow ではなく、
//   穴の上下左右を囲む4枚の板で作る。板が当たり判定を持ち、穴の位置には
//   要素が無いので下のUIへそのまま届く。**これは飾りではなく進行の要**で、
//   穴の位置がそのまま「次にできる操作」の限定になる。○ボタンだけ抜けば
//   スワイプできず、カードだけ抜けばボタンを押せない。デモを
//   「ボタンで答える → スワイプで答える」に分けられるのはこの性質のおかげ。
// - **矩形は毎フレーム測り直す。** カードは飛んでいくしシートは開閉するし、
//   ヘッダーは保存エラーの帯で伸びる。1回測って固定すると、穴だけ前の位置に
//   取り残される。変化したときだけ setState するので再描画は起きない。
// - **対象が見つからないときは暗幕も板も出さず、吹き出しだけ画面上部に出す。**
//   測定の10問のように、ステップの途中で対象が消える場面がある。ここで
//   板を残すと画面全体が操作不能になる。位置を下端にしていたときは
//   カードの回答ボタンに丸被りしていた (ユーザー指摘)。下端はこのアプリの
//   操作ゾーンなので、行き場を失った吹き出しの置き場にしてはいけない。

interface Props {
  // 対象の data-tour の値。**配列を渡すと、見つかった最初のものを使う。**
  // 1つのステップの途中で対象が別の要素に入れ替わる場面があるため
  // (測定は「測定をはじめる」ボタン → 結果パネル と移る)。
  // どれも見つからなければ暗幕を出さず、吹き出しだけ画面上部に出す
  target: string | string[];
  // 説明。**1行で書くこと。** 2行以上要るなら、それはステップを割るべき合図
  body: string;
  step: number;
  total: number;
  // 穴の中で指を左右に動かして、スワイプを促す
  gesture?: "right" | "left";
  // **穴は開けるが押させない。** 見せたいだけで操作させたくない場面で使う
  // (「ここに単語が並びます」と示すだけのステップなど)。
  // 穴の上に透明な板をもう1枚重ねてタップを吸う
  blockHole?: boolean;
  // **画面のどこを触っても何も起きない状態。** 操作を褒めてから自動で次へ送る
  // 短い間に使う。穴も塞ぎ、スキップ・戻る・次へも出さない
  frozen?: boolean;
  // **押して進むステップだけ渡す。** 省略すると進むボタンを出さない。
  // 操作で進むステップは、その操作を検知した側が勝手に次へ送る
  onNext?: () => void;
  onSkip: () => void;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6; // 穴を対象より少し大きく取る (切り取りより前に足す)
const GAP = 12; // 穴と吹き出しの間隔
const TIP_MAX = 320; // 吹き出しの最大幅
const DIM = "rgba(0,0,0,0.72)";

// 候補を順に引いて、最初に見つかった印の要素を**すべて**返す。
// 同じ印を複数の要素に付けると、それらを囲む1つの穴になる
// (表の1列まるごとを抜くのに使う。見出しと各セルに同じ印を付ける)
function findTargets(key: string): Element[] {
  // **デモの全画面が出ているあいだは、その中の要素だけを対象にする。**
  // 2周目は下の単語タブに本物のカードが出ているので、`answer-known` などの印が
  // デモ側と本物側の2つに当たり、その和集合が穴になって位置がずれていた
  // (初回は測定前でカードが無いため1つしか当たらず、気づかれなかった)
  const demo = document.querySelector('[data-tour-layer="demo"]');
  for (const cand of key.split("|")) {
    // `+` でつなぐと、離れた場所を**同時に**抜ける (穴が2つ以上になる)。
    // 「単語の列」と「下タブの単語リスト」のように、画面の別々の場所を
    // まとめて指したいときに使う
    let els: Element[] = [];
    for (const t of cand.split("+")) {
      // `~=` は空白区切りの値のどれかに一致すればよい。
      // 1つの要素に複数の役割を持たせられる (単語列の先頭セルは
      // 「単語列の一部」でもあり「シールをめくらせる1枚」でもある)
      els.push(...document.querySelectorAll(`[data-tour~="${t}"]`));
    }
    if (demo) els = els.filter((e) => demo.contains(e));
    if (els.length > 0) return els;
  }
  return [];
}

// 重なっている / くっついている矩形をまとめる。
// 表の1列のように連続した要素は1つの穴になり、下タブのように離れたものは別の穴で残る
function mergeBoxes(list: Box[]): Box[] {
  const out: Box[] = [];
  for (const b of list) {
    let cur = b;
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < out.length; i++) {
        const o = out[i];
        const gap = 2;
        const apart =
          cur.left > o.left + o.width + gap ||
          o.left > cur.left + cur.width + gap ||
          cur.top > o.top + o.height + gap ||
          o.top > cur.top + cur.height + gap;
        if (apart) continue;
        const top = Math.min(cur.top, o.top);
        const left = Math.min(cur.left, o.left);
        const right = Math.max(cur.left + cur.width, o.left + o.width);
        const bottom = Math.max(cur.top + cur.height, o.top + o.height);
        cur = { top, left, width: right - left, height: bottom - top };
        out.splice(i, 1);
        merged = true;
        break;
      }
    }
    out.push(cur);
  }
  return out;
}

// すべての穴を囲む最小の矩形 (吹き出しの位置決めと、通す当たり判定に使う)
function outerBox(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  let { top, left } = boxes[0];
  let right = boxes[0].left + boxes[0].width;
  let bottom = boxes[0].top + boxes[0].height;
  for (const b of boxes.slice(1)) {
    top = Math.min(top, b.top);
    left = Math.min(left, b.left);
    right = Math.max(right, b.left + b.width);
    bottom = Math.max(bottom, b.top + b.height);
  }
  return { top, left, width: right - left, height: bottom - top };
}

// 穴を「対象を実際に切り取っている枠」の内側に収める。
// 単語リストの表は min-w-[820px] が overflow-x-auto の枠に入っているので、
// 列や行の矩形は枠からはみ出して画面の外まで伸びる。そのまま穴にすると、
// 表の外 (左右の余白やヘッダーの下) まで明るく抜けてしまう。
// overflow が visible でない祖先をすべて辿って交差を取る
function clipToClippers(box: Box, el: Element): Box | null {
  let out = box;
  let node: Element | null = el;
  while (node && node !== document.body && node !== document.documentElement) {
    // **position:fixed に行き当たったら打ち切る。** fixed はビューポート基準に
    // 置かれるので、DOM 上の祖先の overflow には切り取られない。
    // 単語詳細は fixed なのに単語リスト (= 本文のスクロールコンテナの中) から
    // 描かれているため、ここで止めないとコンテナと交差を取ってしまう。
    // 詳細の ↓ ボタンは画面上端 (top:12) にあってコンテナより上なので、
    // 交差が空になり穴ごと消えていた
    if (getComputedStyle(node).position === "fixed") break;
    const parent: Element | null = node.parentElement;
    if (!parent) break;
    const st = getComputedStyle(parent);
    if (st.overflowX !== "visible" || st.overflowY !== "visible") {
      const r = parent.getBoundingClientRect();
      const top = Math.max(out.top, r.top);
      const left = Math.max(out.left, r.left);
      const right = Math.min(out.left + out.width, r.right);
      const bottom = Math.min(out.top + out.height, r.bottom);
      // 完全に枠の外へ出ていたら穴を出さない (退避して吹き出しだけになる)
      if (right <= left || bottom <= top) return null;
      out = { top, left, width: right - left, height: bottom - top };
    }
    node = parent;
  }
  return out;
}

function sameBox(a: Box, b: Box) {
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

function sameBoxes(a: Box[], b: Box[]) {
  return a.length === b.length && a.every((x, i) => sameBox(x, b[i]));
}

// 対象の矩形を測って、余白を足し、それぞれ自分を切り取っている枠に収め、
// 重なるものをまとめる。**要素ごとに切り取る**のが要点で、
// 単語の列 (表の枠に収める) と下タブのボタン (枠が別) を同時に扱える
function measureBoxes(key: string): Box[] {
  const out: Box[] = [];
  for (const el of findTargets(key)) {
    const r = el.getBoundingClientRect();
    // 幅か高さが 0 の要素 (display:none の名残など) は無いものとして扱う
    if (r.width <= 0 || r.height <= 0) continue;
    const padded = {
      top: r.top - PAD,
      left: r.left - PAD,
      width: r.width + PAD * 2,
      height: r.height + PAD * 2,
    };
    const clipped = clipToClippers(padded, el);
    if (clipped) out.push(clipped);
  }
  return mergeBoxes(out);
}

export function Spotlight({
  target,
  body,
  step,
  total,
  gesture,
  blockHole = false,
  frozen = false,
  onNext,
  onSkip,
}: Props) {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const boxesRef = useRef<Box[]>([]);
  // 依存配列に配列そのものを置くと毎レンダー別物になるので、文字列に畳んで渡す
  const key = Array.isArray(target) ? target.join("|") : target;

  // 対象が画面外にあれば寄せる。単語リストの列は min-w-[820px] の
  // 横スクロール枠の中にあり、375px幅では初期位置から見えない。
  // scrollIntoView は縦横ともスクロール可能な祖先を全部辿ってくれる
  useEffect(() => {
    const el = findTargets(key)[0];
    if (!el) return;
    // **画面より広い対象を横に中央寄せしない。** 単語リストの表は
    // min-w-[820px] の横スクロール枠に入っていて、行そのものも 820px ある。
    // inline:"center" だと「820px の行の中央」に合わせようとして表が
    // 右へ 222px 流れ、単語の列が画面外へ消えていた (ユーザー報告)。
    // 狭い対象 (学習進捗度の列など) は初期位置から見えないので中央寄せが要る
    const wide = el.getBoundingClientRect().width > window.innerWidth * 0.9;
    el.scrollIntoView({
      block: "center",
      inline: wide ? "nearest" : "center",
      behavior: "smooth",
    });
  }, [key]);

  // 毎フレーム測り直す。値が動いたときだけ state を更新する
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const next = measureBoxes(key);
      if (!sameBoxes(boxesRef.current, next)) {
        boxesRef.current = next;
        setBoxes(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [key]);

  const vh = typeof window === "undefined" ? 0 : window.innerHeight;

  const tip = (
    <div
      className="mx-auto w-full rounded-2xl border border-[#4A99EA] bg-black p-3 shadow-xl"
      style={{ maxWidth: TIP_MAX }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-[#4A99EA]">
          {step} / {total}
        </span>
        {!frozen && (
          <button
            onClick={onSkip}
            className="rounded-full px-2 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300"
          >
            スキップ
          </button>
        )}
      </div>
      <p className="mt-1 text-[13px] font-medium leading-relaxed text-zinc-100">
        {body}
      </p>
      {!frozen && onNext && (
        <div className="mt-2.5">
          <button
            onClick={onNext}
            className="w-full rounded-full bg-[#4A99EA] py-1.5 text-[11px] font-bold text-white hover:bg-[#3d87d4]"
          >
            次へ
          </button>
        </div>
      )}
    </div>
  );

  // 対象が見つからないとき。暗幕も板も出さず (出すと画面全体が操作不能になる)、
  // 吹き出しだけヘッダーの下に置く
  if (boxes.length === 0) {
    return (
      <div className="pointer-events-none fixed inset-0 z-[65]">
        <div
          className="pointer-events-auto absolute inset-x-0 px-4"
          style={{
            // ヘッダー (49px + セーフエリア) の下、さらに進捗の行 (「レベル測定 n / 10 問」)
            // を避けた位置。真下に置くとその行を隠してしまう。
            // ここならカード上部の余白に重なるだけで、読むものを隠さない
            top: "calc(49px + max(0.75rem, env(safe-area-inset-top)) + 56px)",
          }}
        >
          {tip}
        </div>
      </div>
    );
  }

  // 穴が複数あることがあるので、位置決めは「全部を囲む矩形」で行う
  const outer = outerBox(boxes)!;
  const hTop = outer.top;
  const hLeft = outer.left;
  const hW = outer.width;
  const hH = outer.height;
  const topH = Math.max(0, hTop);
  const bottomTop = Math.max(0, hTop + hH);
  const leftW = Math.max(0, hLeft);
  const rightLeft = Math.max(0, hLeft + hW);
  // **根は pointer-events-none のまま、板にだけ auto を戻す。**
  // 根に当たり判定を持たせると、根は全画面なので穴の位置のタップまで吸ってしまう
  // (実際これで ○ ボタンが押せなくなった。elementFromPoint が根を返していた)。
  // 板は当たり判定だけを持つ。**暗さは下の SVG が描く**ので背景は要らない
  const panel = {
    position: "absolute" as const,
    pointerEvents: "auto" as const,
  };

  // 吹き出しの置き場所。下 → 上 → 穴の中、の順に空いているところを使う。
  // **「穴の中」が要る。** スワイプを促すステップの対象はカード全体で、
  // 375×812 だと下に97px・上に57pxしか残らず、どちらに置いてもはみ出す。
  // カードの上部は余白なので、そこへ重ねても読むものを隠さない。
  // 吹き出し自身は pointer-events-auto だが、カードは広いので
  // 少し下をなぞればスワイプできる
  const TIP_H = 130;
  const place: "below" | "above" | "inside" =
    vh - (hTop + hH) >= TIP_H ? "below" : hTop >= TIP_H ? "above" : "inside";
  // 穴の中に置くときは、穴の形で上下を選ぶ。
  // **細くて縦長の穴 (表の1列) は下端に回す。** 上に置くと列の見出しを隠すが、
  // 説明文がその見出しの名前を指しているので隠してはいけない。
  // 幅の広い穴 (カード) は上に置く。中央に見出し語があり、下には指の演出が動く
  const vw = typeof window === "undefined" ? 0 : window.innerWidth;
  const narrow = hW < vw * 0.6;
  const tipStyle =
    place === "below"
      ? { top: hTop + hH + GAP, left: 0, right: 0 }
      : place === "above"
        ? { bottom: vh - hTop + GAP, left: 0, right: 0 }
        : narrow
          ? { bottom: "calc(88px + env(safe-area-inset-bottom))", left: 0, right: 0 }
          : { top: hTop + GAP, left: 0, right: 0 };

  return (
    // z は ボトムナビ(40) と Sheet(45〜50) とデモの全画面(60) より上。
    // 根は当たり判定を持たない (下の panel のコメント参照)
    <div className="pointer-events-none fixed inset-0 z-[65]">
      {/* **暗幕は SVG のマスクで描く。** 穴を何個でも開けられるので、
          「単語の列」と「下タブの単語リスト」のように離れた場所を同時に指せる。
          白が暗いところ、黒が穴。見た目だけなので当たり判定は持たせない */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden
      >
        <defs>
          <mask id="tour-holes">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {boxes.map((b, i) => (
              <rect
                key={i}
                x={b.left}
                y={b.top}
                width={b.width}
                height={b.height}
                rx="12"
                fill="black"
              />
            ))}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill={DIM}
          mask="url(#tour-holes)"
        />
      </svg>
      {/* 穴を囲む4枚の板。これがタップを吸う。穴の位置には何も置かないので、
          そこだけ下のUIへ届く。穴が複数のときは「全部を囲む矩形」の外を塞ぐ
          (中はどのみち blockHole で塞ぐ使い方しかしていない) */}
      <div style={{ ...panel, top: 0, left: 0, right: 0, height: topH }} />
      <div style={{ ...panel, top: bottomTop, left: 0, right: 0, bottom: 0 }} />
      <div
        style={{ ...panel, top: topH, left: 0, width: leftW, height: hH }}
      />
      <div
        style={{ ...panel, top: topH, left: rightLeft, right: 0, height: hH }}
      />
      {/* 見せるだけのステップでは、穴の上に透明な板を重ねてタップを吸う */}
      {(blockHole || frozen) && (
        <div
          style={{
            position: "absolute",
            top: topH,
            left: leftW,
            width: hW,
            height: hH,
            pointerEvents: "auto",
          }}
        />
      )}
      {/* 穴の輪郭。穴ごとに1つ。当たり判定を持たせない */}
      {boxes.map((b, i) => (
        <div
          key={i}
          className="pointer-events-none absolute rounded-xl"
          style={{
            top: b.top,
            left: b.left,
            width: b.width,
            height: b.height,
            outline: "2px solid #4A99EA",
          }}
        />
      ))}
      {/* スワイプを促す指。穴の中央で左右に往復する */}
      {gesture && (
        // 指は穴の中央ではなく少し下に置く。カードだと中央に見出し語があり、
        // 真上を横切ると語が読めなくなる
        <div
          className="pointer-events-none absolute flex items-center justify-center"
          style={{
            top: hTop + hH * 0.66,
            left: hLeft,
            width: hW,
            height: Math.min(hH * 0.34, 120),
          }}
        >
          <span
            className={
              gesture === "right" ? "tour-swipe-right" : "tour-swipe-left"
            }
          >
            <span className="block h-12 w-12 rounded-full border-2 border-[#4A99EA] bg-[#4A99EA]/30 shadow-[0_0_20px_rgba(74,153,234,0.6)]" />
          </span>
        </div>
      )}
      <div className="pointer-events-none absolute px-4" style={tipStyle}>
        <div className="pointer-events-auto">{tip}</div>
      </div>
    </div>
  );
}
