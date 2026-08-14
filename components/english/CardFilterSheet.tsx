"use client";

import { useState } from "react";
import { AlertCircle, ArrowDown } from "lucide-react";
import {
  CARD_FIELDS,
  CardSource,
  EnglishData,
  Level,
  LEVELS,
  Progress,
  VocabSettings,
} from "@/lib/english/types";
import { Collapsible } from "./Collapsible";
import { ConfirmButton } from "./ConfirmButton";

// 出題範囲はチェックの組み合わせで決める (両方オンなら混ぜて出す)
function sourceOf(words: boolean, idioms: boolean): CardSource {
  return words && idioms ? "both" : words ? "words" : "idioms";
}

interface Props {
  settings: VocabSettings;
  data: EnglishData;
  onChange: (next: VocabSettings) => void;
  setData: React.Dispatch<React.SetStateAction<EnglishData>>;
  onClose: () => void;
  // チュートリアル中だけ、説明している大分類を開いてもう一方を閉じる
  openSection?: "filter" | "swipe" | null;
}

const rowCls =
  "flex items-center gap-3 border-b border-zinc-100 px-4 py-3.5 last:border-b-0 dark:border-zinc-800";
const boxCls =
  "overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800";
const numCls =
  "w-20 shrink-0 rounded-full border border-zinc-200 bg-transparent px-3 py-1.5 text-right text-sm outline-none focus:border-[#4A99EA] dark:border-zinc-700";

/*
 * 「単語の設定」。カード画面の左上ボタンから開く全画面シート。
 *
 * **2階層の折りたたみで並べる。** 以前は section を縦に7つ並べただけで、
 * 「どれが出題するカードを絞る設定で、どれが見え方の設定か」が読めなかった。
 * 大分類は2つだけで、分ける基準は「出題される集合が変わるかどうか」:
 *   1. 出題の設定 (どのカードが出るか)
 *   2. スワイプ時オプション (出たカードがどう見えるか)
 * 歯車の中にあった単語レベルの表示と再測定も、難易度の設定と同じ場所にある
 * ほうが自然なのでここへ移した。
 */
export function CardFilterSheet({
  settings,
  data,
  onChange,
  setData,
  onClose,
  openSection,
}: Props) {
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [levelError, setLevelError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const set = <K extends keyof VocabSettings>(
    key: K,
    value: VocabSettings[K],
  ) => onChange({ ...settings, [key]: value });

  // タグの絞り込み。**data.tagProps から毎回組み立てる**ので、
  // プロパティを足したり消したりしても、条件の側は勝手に追随する。
  // 消えたプロパティのキーが tagFilter に残っても、
  // passesTagFilter が tagProps しか見ないので無視される
  const tagFilter = settings.tagFilter ?? {};
  const setTagFilter = (id: string, values: string[]) =>
    set("tagFilter", { ...tagFilter, [id]: values });
  const tagSummary =
    data.tagProps
      .filter((p) => (tagFilter[p.id] ?? []).length > 0)
      .map((p) => `${p.label}: ${(tagFilter[p.id] ?? []).length}`)
      .join("・") || "すべて";
  // 選択チップの見た目 (単語リストのフィルタと揃える)
  const chipCls = (on: boolean) =>
    `rounded-full border px-3 py-1 text-xs transition-colors ${
      on
        ? "border-[#4A99EA] bg-[#4A99EA]/10 text-[#4A99EA]"
        : "border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400"
    }`;

  const useWords = settings.cardSource !== "idioms";
  const useIdioms = settings.cardSource !== "words";

  const toggleSource = (kind: "words" | "idioms", checked: boolean) => {
    const next = kind === "words" ? [checked, useIdioms] : [useWords, checked];
    if (!next[0] && !next[1]) {
      setSourceError("語彙とイディオムのどちらかは選んでください。");
      return;
    }
    setSourceError(null);
    set("cardSource", sourceOf(next[0], next[1]));
  };

  const toggleField = (key: string, checked: boolean) => {
    const next = { ...settings.cardFields, [key]: checked };
    if (Object.values(next).every((v) => !v)) {
      setFieldError("表示する項目は少なくとも1つ選んでください。");
      return;
    }
    setFieldError(null);
    set("cardFields", next as VocabSettings["cardFields"]);
  };

  const toggleLevel = (level: Level, checked: boolean) => {
    const next = checked
      ? [...settings.manualLevels, level]
      : settings.manualLevels.filter((l) => l !== level);
    if (next.length === 0) {
      setLevelError("出題するレベルは少なくとも1つ選んでください。");
      return;
    }
    setLevelError(null);
    // 表示順を LEVELS に合わせて保つ
    set(
      "manualLevels",
      LEVELS.filter((l) => next.includes(l.key)).map((l) => l.key),
    );
  };

  const toggleReview = (p: Progress, checked: boolean) => {
    const next = checked
      ? [...settings.reviewProgress, p]
      : settings.reviewProgress.filter((x) => x !== p);
    if (next.length === 0) {
      setReviewError("学習中と学習完了のどちらかは選んでください。");
      return;
    }
    setReviewError(null);
    set("reviewProgress", next);
  };

  const errorLine = (msg: string) => (
    <p className="mt-2 flex items-center gap-1.5 text-xs text-red-500">
      <AlertCircle size={14} /> {msg}
    </p>
  );

  // 折りたたんだままでも今の設定が分かるよう、見出しの右に1行で出す
  const sourceSummary = [useWords && "語彙", useIdioms && "イディオム"]
    .filter(Boolean)
    .join("・");
  const levelSummary =
    settings.levelMode === "auto"
      ? `自動 (${data.vocabLevel.current ?? "未測定"})`
      : settings.manualLevels.join("・");
  const reviewSummary = settings.reviewProgress
    .map((p) => (p === "learning" ? "学習中" : "学習完了"))
    .join("・");
  const fieldSummary = CARD_FIELDS.filter((f) => settings.cardFields[f.key])
    .map((f) => f.label)
    .join("・");
  const revealSummary = [
    !settings.skipReveal.drill && "演習",
    !settings.skipReveal.review && "復習",
  ]
    .filter(Boolean)
    .join("・");

  const checkbox = (checked: boolean, onChangeChecked: (v: boolean) => void) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChangeChecked(e.target.checked)}
      className="h-5 w-5 shrink-0 accent-[#4A99EA]"
    />
  );

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold">単語の設定</h2>
        <button
          onClick={onClose}
          aria-label="設定を閉じる"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-white dark:bg-white dark:text-black"
        >
          <ArrowDown size={18} strokeWidth={3} />
        </button>
      </div>

      <div className="space-y-3">
        {/* ---- 1. 出題の設定 ---- */}
        <Collapsible
          accent
          defaultOpen
          dataTour="filter-section"
          // チュートリアル中だけ、説明している側を開いてもう一方を閉じる
          open={openSection ? openSection === "filter" : undefined}
          title="出題の設定"
          summary=""
        >
          <p className="mb-1 px-1 text-xs text-zinc-500">
            ここで選んだ条件に当てはまるカードだけが出題されます。
          </p>

          <Collapsible nested title="語彙とイディオム" summary={sourceSummary}>
            <p className="mb-2 text-xs text-zinc-500">
              カードに出す種類です。両方選ぶと混ぜて出題します。
            </p>
            <div className={boxCls}>
              <label className={rowCls}>
                <span className="flex-1 text-sm font-medium">語彙</span>
                {checkbox(useWords, (v) => toggleSource("words", v))}
              </label>
              <label className={rowCls}>
                <span className="flex-1 text-sm font-medium">イディオム</span>
                {checkbox(useIdioms, (v) => toggleSource("idioms", v))}
              </label>
            </div>
            {sourceError && errorLine(sourceError)}
          </Collapsible>

          <Collapsible nested title="難易度 (レベル)" summary={levelSummary}>
            <p className="mb-2 text-xs text-zinc-500">
              出題するカードのレベルの決め方です。
            </p>

            {/* 現在のレベルと再測定。歯車の「単語学習の設定」から移した */}
            <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-900">
              <span className="min-w-0 flex-1">
                いまの難易度:{" "}
                <span className="font-medium">
                  {data.vocabLevel.current ?? "未測定"}
                </span>
                <span className="block text-xs text-zinc-500">
                  最初の10問で測り、以後は直近の正解率で自動調整します
                </span>
              </span>
              <ConfirmButton
                label="再測定"
                question="レベルを測り直しますか？ (学習記録は残ります)"
                confirmLabel="測り直す"
                className="shrink-0 rounded-full border border-zinc-300 px-3 py-1.5 text-xs whitespace-nowrap hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
                onConfirm={() =>
                  setData((prev) => ({
                    ...prev,
                    vocabLevel: { current: null, recent: [] },
                  }))
                }
              />
            </div>

            <div className={boxCls}>
              {(
                [
                  {
                    key: "auto" as const,
                    title: "自動設定",
                    desc: "測ったレベルに合わせて自動で上下します",
                  },
                  {
                    key: "manual" as const,
                    title: "手動設定",
                    desc: "出題するレベルを自分で選びます",
                  },
                ] as const
              ).map((o) => (
                <label key={o.key} className={rowCls}>
                  <span className="flex-1 text-sm font-medium">
                    {o.title}
                    <span className="mt-0.5 block text-xs font-normal text-zinc-500">
                      {o.desc}
                    </span>
                  </span>
                  <input
                    type="radio"
                    name="levelMode"
                    checked={settings.levelMode === o.key}
                    onChange={() => set("levelMode", o.key)}
                    className="h-5 w-5 shrink-0 accent-[#4A99EA]"
                  />
                </label>
              ))}
            </div>

            {settings.levelMode === "manual" && (
              <>
                <div className={`mt-2 ${boxCls}`}>
                  {LEVELS.map((l) => (
                    <label key={l.key} className={rowCls}>
                      <span className="flex-1 text-sm">
                        {l.key}{" "}
                        <span className="text-zinc-500">({l.label})</span>
                        <span className="mt-0.5 block text-xs text-zinc-500">
                          {l.guide}
                        </span>
                      </span>
                      {checkbox(settings.manualLevels.includes(l.key), (v) =>
                        toggleLevel(l.key, v),
                      )}
                    </label>
                  ))}
                </div>
                {levelError && errorLine(levelError)}
              </>
            )}
          </Collapsible>

          <Collapsible
            nested
            title="演習モードの出題設定"
            summary={`新出 ${settings.drillNewRatio}%`}
          >
            <p className="mb-2 text-xs text-zinc-500">
              演習では、まだ見ていないカード (新出) と一度でも回答したカード
              (既出) を混ぜて出します。その比率です。
            </p>
            <div className={boxCls}>
              <label className={rowCls}>
                <span className="flex-1 text-sm font-medium">
                  新出の割合
                  <span className="mt-0.5 block text-xs font-normal text-zinc-500">
                    10枚あたり新出 {Math.round(settings.drillNewRatio / 10)} 枚 /
                    既出 {10 - Math.round(settings.drillNewRatio / 10)} 枚。
                    在庫が尽きた側はもう片方で埋めます
                  </span>
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={10}
                    value={settings.drillNewRatio}
                    onChange={(e) =>
                      set(
                        "drillNewRatio",
                        Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                      )
                    }
                    className={numCls}
                  />
                  <span className="text-sm text-zinc-500">%</span>
                </div>
              </label>
            </div>
          </Collapsible>

          <Collapsible
            nested
            title="復習モードの出題設定"
            summary={reviewSummary}
          >
            <p className="mb-2 text-xs text-zinc-500">
              復習に出すカードを学習進捗度で選びます。間違えた回数が多いカードほど
              先に出ます。
            </p>
            <div className={boxCls}>
              <label className={rowCls}>
                <span className="flex-1 text-sm font-medium">
                  学習中
                  <span className="mt-0.5 block text-xs font-normal text-zinc-500">
                    まだ身についていないカード
                  </span>
                </span>
                {checkbox(settings.reviewProgress.includes("learning"), (v) =>
                  toggleReview("learning", v),
                )}
              </label>
              <label className={rowCls}>
                <span className="flex-1 text-sm font-medium">
                  学習完了
                  <span className="mt-0.5 block text-xs font-normal text-zinc-500">
                    覚えたカード。抜き打ちで確認したいときに足します
                  </span>
                </span>
                {checkbox(settings.reviewProgress.includes("done"), (v) =>
                  toggleReview("done", v),
                )}
              </label>
            </div>
            {reviewError && errorLine(reviewError)}

            <p className="mt-3 mb-2 text-xs text-zinc-500">
              学習完了とみなす条件です。初回で正解したカードは、その時点で学習完了になります。
            </p>
            <div className={boxCls}>
              <label className={rowCls}>
                <span className="flex-1 text-sm font-medium">
                  学習完了とみなす回数
                  <span className="mt-0.5 block text-xs font-normal text-zinc-500">
                    この回数連続で ○ なら学習完了。△ や × を挟むと数え直し
                  </span>
                </span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={settings.masterKnownCount}
                  onChange={(e) =>
                    set(
                      "masterKnownCount",
                      Math.max(1, Math.min(10, Number(e.target.value) || 1)),
                    )
                  }
                  className={numCls}
                />
              </label>
            </div>
          </Collapsible>

          {/* タグでの絞り込み。**data.tagProps から毎回組み立てる**ので、
              プロパティの追加・削除にそのまま追随する。
              同じプロパティ内は OR、プロパティ同士は AND (単語リストのフィルタと同じ) */}
          <Collapsible nested title="タグ" summary={tagSummary}>
            <p className="mb-2 text-xs text-zinc-500">
              選んだタグが付いたカードだけを出題します。同じ項目の中はどれか1つ、
              項目どうしは両方に当てはまるものが出ます。
            </p>
            {data.tagProps.length === 0 ? (
              <p className="text-xs text-zinc-400">
                プロパティがありません (カード詳細のタグから追加できます)
              </p>
            ) : (
              <div className="space-y-3">
                {data.tagProps.map((prop) => (
                  <div key={prop.id}>
                    <p className="mb-1 text-xs font-medium">{prop.label}</p>
                    {prop.options.length === 0 ? (
                      <p className="text-xs text-zinc-400">
                        タグがありません (単語詳細のタグから追加できます)
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          onClick={() => setTagFilter(prop.id, [])}
                          className={chipCls(
                            (tagFilter[prop.id] ?? []).length === 0,
                          )}
                        >
                          すべて
                        </button>
                        {prop.options.map((o) => (
                          <button
                            key={o.value}
                            onClick={() => {
                              const cur = tagFilter[prop.id] ?? [];
                              setTagFilter(
                                prop.id,
                                cur.includes(o.value)
                                  ? cur.filter((x) => x !== o.value)
                                  : [...cur, o.value],
                              );
                            }}
                            className={chipCls(
                              (tagFilter[prop.id] ?? []).includes(o.value),
                            )}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Collapsible>
        </Collapsible>

        {/* ---- 2. スワイプ時オプション ---- */}
        <Collapsible
          accent
          dataTour="swipe-section"
          open={openSection ? openSection === "swipe" : undefined}
          title="スワイプ時オプション"
          summary=""
        >
          <Collapsible
            nested
            title="自動で読み上げる"
            summary={settings.autoSpeak ? "オン" : "オフ"}
          >
            <p className="mb-2 text-xs text-zinc-500">
              オフでも、単語の横のスピーカーを押せばいつでも聞けます。
            </p>
            <div className={boxCls}>
              <label className={rowCls}>
                <span className="flex-1 text-sm font-medium">
                  カードが出たら自動で読む
                </span>
                {checkbox(settings.autoSpeak, (v) => set("autoSpeak", v))}
              </label>
            </div>
          </Collapsible>

          <Collapsible
            nested
            title="回答する前に見せる項目"
            summary={fieldSummary}
          >
            <p className="mb-2 text-xs text-zinc-500">
              カードをめくる前 (回答する前) の面に出す情報です。意味を出せば
              思い出す前に答えが見えます。
            </p>
            <div className={boxCls}>
              {CARD_FIELDS.map((f) => (
                <label key={f.key} className={rowCls}>
                  <span className="flex-1 text-sm">{f.label}</span>
                  {checkbox(settings.cardFields[f.key], (v) =>
                    toggleField(f.key, v),
                  )}
                </label>
              ))}
            </div>
            {fieldError && errorLine(fieldError)}
          </Collapsible>

          <Collapsible
            nested
            title="回答した後に解説を出す"
            summary={revealSummary || "出さない"}
          >
            <p className="mb-2 text-xs text-zinc-500">
              オンにすると、回答後にカードが裏返って意味と例文が出ます。オフなら
              そのまま次のカードへ進みます。
            </p>
            <div className={boxCls}>
              <label className={rowCls}>
                <span className="flex-1 text-sm font-medium">
                  演習で解説を表示
                  <span className="mt-0.5 block text-xs font-normal text-zinc-500">
                    演習は速く仕分けるのが目的なので、既定はオフ
                  </span>
                </span>
                {checkbox(!settings.skipReveal.drill, (v) =>
                  set("skipReveal", { ...settings.skipReveal, drill: !v }),
                )}
              </label>
              <label className={rowCls}>
                <span className="flex-1 text-sm font-medium">
                  復習で解説を表示
                  <span className="mt-0.5 block text-xs font-normal text-zinc-500">
                    復習は覚え直すのが目的なので、既定はオン
                  </span>
                </span>
                {checkbox(!settings.skipReveal.review, (v) =>
                  set("skipReveal", { ...settings.skipReveal, review: !v }),
                )}
              </label>
            </div>
          </Collapsible>
        </Collapsible>
      </div>
    </div>
  );
}
