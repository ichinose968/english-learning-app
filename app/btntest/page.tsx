// 一時的な検証ページ。単語詳細の閉じる ↓ の白丸が上下二色に割れて見える件の
// A/B 比較用 (iOS 26 実機/シミュレータの Safari で見る)。確認が済んだら消す
import { ArrowDown } from "lucide-react";

export default function ButtonTest() {
  return (
    <main className="flex min-h-svh flex-col items-center gap-10 bg-black pt-24 text-white">
      {/* A: 旧実装そのもの。english-app の外なので globals の appearance:none が当たらない */}
      <div className="flex items-center gap-4">
        <button className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black">
          <ArrowDown size={20} strokeWidth={3} />
        </button>
        <span className="text-sm">A: 旧実装 (appearance: button のまま)</span>
      </div>

      {/* B: 旧実装 + appearance-none だけ */}
      <div className="flex items-center gap-4">
        <button className="flex h-10 w-10 appearance-none items-center justify-center rounded-full bg-white text-black">
          <ArrowDown size={20} strokeWidth={3} />
        </button>
        <span className="text-sm">B: + appearance-none</span>
      </div>

      {/* C: 新実装。白丸を子要素で描く */}
      <div className="flex items-center gap-4">
        <button className="relative flex h-10 w-10 items-center justify-center rounded-full text-black">
          <span aria-hidden className="absolute inset-0 rounded-full bg-white" />
          <ArrowDown size={20} strokeWidth={3} className="relative" />
        </button>
        <span className="text-sm">C: 白丸を子要素で描く (新実装)</span>
      </div>
    </main>
  );
}
