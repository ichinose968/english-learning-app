"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { ReadingSheet } from "./ReadingSheet";
import { CardDetailSheet } from "./CardDetailSheet";
import {
  applyEdit,
  EnglishData,
  INTEREST_PRESETS,
  Level,
  LEVELS,
  MAX_PURPOSE_LEN,
  MAX_TOPIC_LEN,
  READING_LENGTHS,
  READING_PURPOSES,
  ReadingResult,
  SavedReading,
  WordDbEntry,
} from "@/lib/english/types";
import {
  buildIndex,
  fetchAllWordDbs,
  lastResult,
  LastResult,
  statusBadges,
} from "@/lib/english/worddb";
import { setStatusOverride } from "@/lib/english/progress";
import { apiUrl, readApiJson, requestErrorMessage } from "@/lib/english/net";
import { authHeaders } from "@/lib/english/appToken";
import { chipCls, Collapsible } from "./Collapsible";

interface Props {
  data: EnglishData;
  setData: React.Dispatch<React.SetStateAction<EnglishData>>;
}

type Phase = "idle" | "loading";

// 長文リストで最初に見せる本数
const READING_LIST_LIMIT = 5;

/**
 * 自分で足した項目 (出題テーマ / 勉強目的) の編集。
 * **「追加・削除」を押したときだけ編集の姿になる。**
 * 入力欄と × を常に出しておくと、選ぶだけのときに邪魔で、
 * しかも選ぼうとして × を踏む事故が起きる
 */
function CustomEditor({
  items,
  placeholder,
  maxLength,
  onAdd,
  onRemove,
}: {
  items: string[];
  placeholder: string;
  // 上限は lib/english/types.ts が持ち、APIも同じ値で切る。
  // 画面側にも入れておかないと、通ったように見えて生成時に黙って途中で切られる
  maxLength: number;
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  const add = () => {
    const v = value.trim();
    setValue("");
    if (v) onAdd(v);
  };

  return (
    <div className="mt-2">
      <button
        onClick={() => setEditing((v) => !v)}
        className="flex items-center gap-1 text-xs text-[#4A99EA]"
      >
        <Plus size={13} />
        {editing ? "閉じる" : "追加・削除"}
      </button>
      {editing && (
        <div className="mt-2 rounded-xl border border-zinc-200 p-2 dark:border-zinc-700">
          <div className="flex gap-2">
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
              placeholder={placeholder}
              maxLength={maxLength}
              className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-[#4A99EA] dark:border-zinc-700"
            />
            <button
              onClick={add}
              className="shrink-0 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              追加
            </button>
          </div>
          {items.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {items.map((t) => (
                <span
                  key={t}
                  className="flex items-center gap-1 rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
                >
                  {t}
                  <button onClick={() => onRemove(t)} aria-label={`${t}を削除`}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          {items.length === 0 && (
            <p className="mt-2 text-xs text-zinc-400">
              まだ自分で追加した項目はありません。
            </p>
          )}
          {/* **ここで書いた文字列はほぼ原文のまま Anthropic へ渡る**
              (route.ts が <user_topics> / <user_purpose> で囲んで送る)。
              端末の外へ出る数少ない経路なので、断りを画面に出しておく。
              プライバシーポリシーの記載ともここで揃える */}
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">
            入力した内容は教材を作るためにAIへ送られます。個人が特定できる情報は書かないでください。
          </p>
        </div>
      )}
    </div>
  );
}

export function ReadingTab({ data, setData }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  // ポップアップで開いている長文のid
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 長文リストは直近5件だけ出し、残りは「さらに表示」で開く
  const [showAllReadings, setShowAllReadings] = useState(false);
  // ハイライトから開いた単語の詳細
  const [wordDetail, setWordDetail] = useState<{
    def: WordDbEntry;
    level: Level;
  } | null>(null);
  // ハイライトの単語を引くための索引 (小文字キー)。語彙とイディオムの両方を対象にする
  const [wordIndex, setWordIndex] = useState<Map<
    string,
    { def: WordDbEntry; level: Level }
  > | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAllWordDbs("both")
      .then((d) => {
        if (cancelled) return;
        const lower = new Map(
          [...buildIndex(d)].map(([k, v]) => [k.toLowerCase(), v]),
        );
        setWordIndex(lower);
      })
      // 索引が読めなくてもハイライトが押せなくなるだけなので黙って続ける
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // 本文中の表記 (大文字・活用形) から単語DBのエントリを探す
  const resolveWord = useMemo(() => {
    return (text: string) => {
      if (!wordIndex) return null;
      const t = text.trim().toLowerCase();
      const candidates = [t];
      // 完全な語形還元はせず、よくある活用だけ剥がして試す
      if (t.endsWith("ies")) candidates.push(t.slice(0, -3) + "y");
      if (t.endsWith("es")) candidates.push(t.slice(0, -2));
      if (t.endsWith("s")) candidates.push(t.slice(0, -1));
      if (t.endsWith("ing")) candidates.push(t.slice(0, -3), t.slice(0, -3) + "e");
      if (t.endsWith("ed")) candidates.push(t.slice(0, -2), t.slice(0, -1));
      for (const c of candidates) {
        const hit = wordIndex.get(c);
        if (hit) return hit;
      }
      // DBに無い語 (旧DB由来の学習記録など) は、記録にある意味で簡易エントリを作って開く
      for (const c of candidates) {
        const entry = data.vocab[c];
        if (entry) {
          return {
            def: {
              word: entry.word,
              pos: "",
              meaningJa: entry.meaningJa,
              distractors: [],
              exampleEn: "",
              exampleJa: "",
            },
            level: entry.level,
          };
        }
      }
      return null;
    };
  }, [wordIndex, data.vocab]);

  const reading = data.settings.reading;
  // 本文に織り込む単語。×を先に、足りなければ△から古い順に足す
  const byStatus = (want: LastResult) =>
    Object.values(data.vocab)
      .filter((e) => lastResult(e) === want)
      .sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt));
  const targetWords = [...byStatus("unknown"), ...byStatus("fuzzy")]
    .slice(0, 8)
    .map((e) => ({ word: e.word, meaningJa: e.meaningJa }));

  // 文章難易度。自動なら単語学習で測ったレベルに追随する
  // 測定前かつ旧フローの settings.level も無ければ B1 から始める
  const autoLevel = data.vocabLevel.current ?? data.settings.level ?? "B1";
  const activeLevel: Level | null =
    reading.levelMode === "manual" ? reading.manualLevel : autoLevel;

  const setReading = (patch: Partial<typeof reading>) =>
    setData((prev) => ({
      ...prev,
      settings: { ...prev.settings, reading: { ...prev.settings.reading, ...patch } },
    }));

  // 自分で足したテーマ。**保存先は settings.interests のまま**。
  // 元は設定 (歯車) の「興味のあるテーマ」だったが、出題テーマと役割が
  // 被っていたのでこのタブへ統合した。保存先を変えると既存の記録が消えるので、
  // 場所だけ移して入れ物はそのまま使っている
  const customTopics = data.settings.interests.filter(
    (t) => !INTEREST_PRESETS.includes(t),
  );
  const addTopic = (t: string) => {
    if (INTEREST_PRESETS.includes(t) || customTopics.includes(t)) return;
    setData((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        interests: [...prev.settings.interests, t],
        // 足したテーマはそのまま選んだ状態にする (足して選ぶ、の2手間を省く)
        reading: {
          ...prev.settings.reading,
          topics: [...prev.settings.reading.topics, t],
        },
      },
    }));
  };

  // 消したテーマが選ばれたままだと、無いテーマで生成しにいくので一緒に外す
  const removeTopic = (t: string) =>
    setData((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        interests: prev.settings.interests.filter((x) => x !== t),
        reading: {
          ...prev.settings.reading,
          topics: prev.settings.reading.topics.filter((x) => x !== t),
        },
      },
    }));

  const addPurpose = (p: string) => {
    if (
      READING_PURPOSES.some((x) => x.key === p || x.label === p) ||
      data.settings.customPurposes.includes(p)
    )
      return;
    setData((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        customPurposes: [...prev.settings.customPurposes, p],
        // 足した目的をそのまま選んだ状態にする
        purpose: p,
      },
    }));
  };

  // 消した目的が選ばれたままだと、無い目的で生成しにいくので既定へ戻す
  const removePurpose = (p: string) =>
    setData((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        customPurposes: prev.settings.customPurposes.filter((x) => x !== p),
        purpose: prev.settings.purpose === p ? "general" : prev.settings.purpose,
      },
    }));

  const toggleTopic = (t: string) =>
    setReading({
      topics: reading.topics.includes(t)
        ? reading.topics.filter((x) => x !== t)
        : [...reading.topics, t],
    });

  const generate = async () => {
    setPhase("loading");
    setError(null);
    try {
      // **相対パス直書きにしない。** Capacitor 版はオリジンが変わるので
      // 同梱物の中を探しにいって必ず失敗する (apiUrl が NEXT_PUBLIC_API_BASE を前置する)
      const res = await fetch(apiUrl("/api/english/reading"), {
        method: "POST",
        // 無記名トークン。レート制限を端末単位で数えるためだけのもので、
        // 本人確認ではない (lib/english/appToken.ts)
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          level: activeLevel,
          // 出題テーマ。**おまかせ (空) はそのまま空で渡す**。
          // 以前は設定の「興味のあるテーマ」を代わりに送っていたが、
          // 役割が被るのでこのタブへ統合した。空ならAI側が題材を決める
          interests: reading.topics,
          purpose: data.settings.purpose,
          length: reading.length,
          targetWords,
        }),
      });
      // **`res.json()` を直に呼ばないこと。** 504・404・本文0バイトの500 が
      // 全部この行を通るので、JSONと決めつけるとパースエラーが画面に出る
      const result = await readApiJson<ReadingResult>(res, "生成に失敗しました");
      const saved: SavedReading = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        title: result.title,
        passageEn: result.passageEn,
        translationJa: result.translationJa,
        glossary: result.glossary,
        questions: result.questions,
        score: null,
      };
      setData((prev) => ({
        ...prev,
        readings: [saved, ...prev.readings].slice(0, 10),
      }));
      setPhase("idle");
      setOpenId(saved.id);
    } catch (e) {
      setError(requestErrorMessage(e, "生成に失敗しました"));
      setPhase("idle");
    }
  };

  const saveScore = (id: string, score: { correct: number; total: number }) =>
    setData((prev) => ({
      ...prev,
      readings: prev.readings.map((r) => (r.id === id ? { ...r, score } : r)),
    }));

  const openReading = data.readings.find((r) => r.id === openId) ?? null;
  const visibleReadings = showAllReadings
    ? data.readings
    : data.readings.slice(0, READING_LIST_LIMIT);
  const hiddenReadings = data.readings.length - visibleReadings.length;
  const lengthDef = READING_LENGTHS.find((l) => l.key === reading.length);
  const purposeDef = READING_PURPOSES.find((p) => p.key === data.settings.purpose);

  // 設定はタブの中に折りたたんで置く (設定画面へ行き来しなくて済むように)
  const panels = (
    <Collapsible
      accent
      title="生成条件"
      summary={`${
        reading.topics.length > 0 ? reading.topics.join("・") : "おまかせ"
      }・${activeLevel ?? "未測定"}・${lengthDef?.label ?? "ふつう"}`}
    >
      <Collapsible
        nested
        title="出題テーマ"
        summary={
          reading.topics.length > 0 ? reading.topics.join("・") : "おまかせ"
        }
      >
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setReading({ topics: [] })}
            className={chipCls(reading.topics.length === 0)}
          >
            おまかせ
          </button>
          {INTEREST_PRESETS.map((t) => (
            <button
              key={t}
              onClick={() => toggleTopic(t)}
              className={chipCls(reading.topics.includes(t))}
            >
              {t}
            </button>
          ))}
          {/* 自分で足したテーマ。用意した分と同じ並びに混ぜる */}
          {customTopics.map((t) => (
            <button
              key={t}
              onClick={() => toggleTopic(t)}
              className={chipCls(reading.topics.includes(t))}
            >
              {t}
            </button>
          ))}
        </div>
        <CustomEditor
          items={customTopics}
          placeholder="テーマを追加 (例: 宇宙、サッカー)"
          maxLength={MAX_TOPIC_LEN}
          onAdd={addTopic}
          onRemove={removeTopic}
        />
        <p className="mt-2 text-xs text-zinc-500">
          複数選べます。おまかせのときはAIが題材を決めます。
        </p>
      </Collapsible>

      <Collapsible
        nested
        title="文章難易度"
        summary={
          reading.levelMode === "auto"
            ? `自動 (${autoLevel ?? "未測定"})`
            : `手動 (${reading.manualLevel})`
        }
      >
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setReading({ levelMode: "auto" })}
            className={chipCls(reading.levelMode === "auto")}
          >
            自動で設定 ({autoLevel ?? "未測定"})
          </button>
          <button
            onClick={() => setReading({ levelMode: "manual" })}
            className={chipCls(reading.levelMode === "manual")}
          >
            手動で設定
          </button>
        </div>
        {reading.levelMode === "manual" && (
          <div className="mt-2 flex flex-wrap gap-2">
            {LEVELS.map((l) => (
              <button
                key={l.key}
                onClick={() => setReading({ manualLevel: l.key })}
                className={chipCls(reading.manualLevel === l.key)}
              >
                {l.key} {l.label}
              </button>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-zinc-500">
          自動は単語学習で測定したレベルに追随します。
        </p>
      </Collapsible>

      <Collapsible
        nested
        title="文章の長さ"
        summary={
          lengthDef ? `${lengthDef.label} ${lengthDef.words}` : "ふつう"
        }
      >
        <div className="flex flex-wrap gap-2">
          {READING_LENGTHS.map((l) => (
            <button
              key={l.key}
              onClick={() => setReading({ length: l.key })}
              className={chipCls(reading.length === l.key)}
            >
              {l.label} {l.words}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-zinc-500">{lengthDef?.desc}</p>
      </Collapsible>

      <Collapsible nested title="勉強目的" summary={purposeDef?.label ?? "一般"}>
        <div className="flex flex-wrap gap-2">
          {READING_PURPOSES.map((p) => (
            <button
              key={p.key}
              onClick={() =>
                setData((prev) => ({
                  ...prev,
                  settings: { ...prev.settings, purpose: p.key },
                }))
              }
              className={chipCls(data.settings.purpose === p.key)}
            >
              {p.label}
            </button>
          ))}
          {/* 自分で足した目的。用意した分と同じ並びに混ぜる */}
          {data.settings.customPurposes.map((p) => (
            <button
              key={p}
              onClick={() =>
                setData((prev) => ({
                  ...prev,
                  settings: { ...prev.settings, purpose: p },
                }))
              }
              className={chipCls(data.settings.purpose === p)}
            >
              {p}
            </button>
          ))}
        </div>
        <CustomEditor
          items={data.settings.customPurposes}
          placeholder="目的を追加 (例: 医療英語、IELTS対策)"
          maxLength={MAX_PURPOSE_LEN}
          onAdd={addPurpose}
          onRemove={removePurpose}
        />
        <p className="mt-2 text-xs text-zinc-500">
          {purposeDef?.desc ?? "この目的に合う題材と文体で長文を作ります。"}
        </p>
      </Collapsible>
    </Collapsible>
  );

  if (phase === "loading") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 bg-white py-16 dark:border-zinc-800 dark:bg-black">
        <Loader2 className="animate-spin text-[#4A99EA]" size={28} />
        <p className="text-sm text-zinc-500">
          あなた専用の英文を生成中... (1分ほどかかります)
        </p>
      </div>
    );
  }

  // idle
  return (
    <div className="space-y-3">
      {panels}
      <div>
        <button
          onClick={generate}
          className="w-full rounded-2xl bg-[#4A99EA] py-3.5 text-sm font-medium text-white hover:bg-[#3d87d4]"
        >
          長文を生成する
        </button>
        {error && (
          <p className="mt-2 text-center text-sm text-red-500">{error}</p>
        )}
      </div>

      {data.readings.length > 0 && (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-black">
          <p className="mb-2 text-xs font-medium text-zinc-500">これまでの長文</p>
          <div className="space-y-2">
            {visibleReadings.map((r) => (
              <button
                key={r.id}
                onClick={() => setOpenId(r.id)}
                className="flex w-full items-center gap-3 rounded-lg border border-zinc-100 px-3 py-2.5 text-left transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-600"
              >
                <span className="min-w-0 flex-1 text-sm font-medium">
                  {r.title}
                </span>
                <span className="shrink-0 text-xs text-zinc-400">
                  {r.score ? `${r.score.correct}/${r.score.total}` : "未回答"} ・{" "}
                  {r.createdAt.slice(0, 10)}
                </span>
              </button>
            ))}
          </div>
          {hiddenReadings > 0 && (
            <button
              onClick={() => setShowAllReadings(true)}
              className="mt-2 w-full rounded-lg border border-zinc-200 py-2 text-xs text-zinc-500 transition-colors hover:border-zinc-400 dark:border-zinc-700"
            >
              さらに表示 (残り {hiddenReadings} 本)
            </button>
          )}
        </div>
      )}

      {/* 長文はポップアップで開く。設問の答え合わせもこの中で行う */}
      {openReading && (
        <ReadingSheet
          key={openReading.id}
          reading={openReading}
          onClose={() => setOpenId(null)}
          onScored={(score) => saveScore(openReading.id, score)}
          // 単語詳細を重ねているあいだは背面クリックで閉じない
          dismissOnBackdrop={wordDetail === null}
          wordAction={(text) => {
            const hit = resolveWord(text);
            return hit ? () => setWordDetail(hit) : null;
          }}
        />
      )}

      {/* ハイライトから開く単語詳細。一覧と同じモジュールなので、
          ここでの編集・メモ・ステータスもアプリ共通の記録に入る */}
      {wordDetail && (
        <CardDetailSheet
          tagProps={data.tagProps}
          onChangeTagProps={(next) =>
            setData((prev) => ({ ...prev, tagProps: next }))
          }
          item={applyEdit(wordDetail.def, data.edits[wordDetail.def.word])}
          note={data.notes[wordDetail.def.word]}
          onClose={() => setWordDetail(null)}
          onSaveEdit={(patch) =>
            setData((prev) => ({
              ...prev,
              edits: {
                ...prev.edits,
                [wordDetail.def.word]: {
                  ...prev.edits[wordDetail.def.word],
                  ...patch,
                },
              },
            }))
          }
          onSaveNote={(text) =>
            setData((prev) => {
              const notes = { ...prev.notes };
              if (text) notes[wordDetail.def.word] = text;
              else delete notes[wordDetail.def.word];
              return { ...prev, notes };
            })
          }
          status={statusBadges(
            data.vocab[wordDetail.def.word],
            data.settings.vocab.masterKnownCount,
          )}
          onSetResult={(next) =>
            setData((prev) =>
              setStatusOverride(
                prev,
                wordDetail.def,
                wordDetail.level,
                "result",
                next,
              ),
            )
          }
          onSetProgress={(next) =>
            setData((prev) =>
              setStatusOverride(
                prev,
                wordDetail.def,
                wordDetail.level,
                "progress",
                next,
              ),
            )
          }
        />
      )}
    </div>
  );
}
