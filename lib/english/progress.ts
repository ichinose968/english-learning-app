// 学習記録の書き換えのうち、複数の画面から使うもの
import {
  EnglishData,
  LastResult,
  Level,
  Progress,
  VocabEntry,
  WordDbEntry,
} from "./types";

// 手動指定の対象。前回結果と学習進捗度は別の軸なので、それぞれ独立に付け替えられる
export type OverrideAxis = "result" | "progress";

function emptyEntry(def: WordDbEntry, level: Level): VocabEntry {
  return {
    word: def.word,
    level,
    meaningJa: def.meaningJa,
    knownCount: 0,
    unsureCount: 0,
    unknownCount: 0,
    correctCount: 0,
    wrongCount: 0,
    needsReview: false,
    lastSeenAt: new Date().toISOString(),
    history: [],
  };
}

// 指定のためだけに作られたエントリ (回答履歴も手動指定も無い) か
function isUntouched(entry: VocabEntry): boolean {
  return (
    entry.history.length === 0 &&
    entry.knownCount === 0 &&
    entry.unsureCount === 0 &&
    entry.unknownCount === 0 &&
    !entry.resultOverride &&
    !entry.progressOverride
  );
}

// 手動でステータスを指定する。null なら指定を外して学習記録どおりの判定に戻す。
// 記録の無い語に指定する場合は、持たせるために空のエントリを作る
export function setStatusOverride(
  data: EnglishData,
  def: WordDbEntry,
  level: Level,
  axis: OverrideAxis,
  next: LastResult | Progress | null,
): EnglishData {
  const vocab = { ...data.vocab };
  const entry = vocab[def.word];
  if (!entry && next === null) return data;

  const base = { ...(entry ?? emptyEntry(def, level)) };
  if (axis === "result") {
    if (next === null) delete base.resultOverride;
    else base.resultOverride = next as LastResult;
  } else {
    if (next === null) delete base.progressOverride;
    else base.progressOverride = next as Progress;
  }

  if (isUntouched(base)) delete vocab[def.word];
  else vocab[def.word] = base;
  return { ...data, vocab };
}

// 回答したら手動指定は両方とも外す。記録と食い違ったまま固定されると、
// タブの件数や出題対象が実態とずれるため
export function clearStatusOverride(entry: VocabEntry): VocabEntry {
  if (!entry.resultOverride && !entry.progressOverride) return entry;
  const rest = { ...entry };
  delete rest.resultOverride;
  delete rest.progressOverride;
  return rest;
}
