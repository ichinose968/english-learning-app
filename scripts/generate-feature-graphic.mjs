// Google Play のフィーチャーグラフィック (1024×500) を生成する。
//
//   node scripts/generate-feature-graphic.mjs
//   → assets/english-icon/dist/feature-graphic-1024x500.png
//
// **アイコンと同じアウトラインを使う。** `assets/english-icon/icon.svg` から
// パスをそのまま引き写すので、ストアの並びでアイコンと字が完全に一致する。
// フォント指定にすると Didot が無い環境で別の字になる (docs 5章「アプリ名の表記」)。
//
// **アルファを持たせない。** Play のフィーチャーグラフィックは透過不可なので、
// 最後に黒地へ焼き込む。サイズは 1024×500 ちょうど、15MB 以下。
import sharp from "sharp";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "assets/english-icon");
const OUT = join(SRC, "dist/feature-graphic-1024x500.png");

// icon.svg から <path> を全部取り出す (白いロゴタイプ + アクセント色のピリオド)
const icon = await readFile(join(SRC, "icon.svg"), "utf8");
const paths = icon.match(/<path[^>]*\/>/g);
if (!paths || paths.length === 0) throw new Error("icon.svg からパスを取り出せない");

// 内側の <svg> に viewBox を与えて、インクの外接矩形だけを切り出す。
// この値は Wordmark.tsx と同じ (実際に描画して測ったもの。パスの座標から
// 計算しようとすると V / H コマンドで壊れる)
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500">
  <rect width="1024" height="500" fill="#000000"/>
  <svg x="362" y="150" width="300" height="148" viewBox="102 309.5 820 405">
    <g transform="translate(87.5201 596.0514) scale(0.402160)">
      ${paths.join("\n      ")}
    </g>
  </svg>
  <text x="512" y="360" text-anchor="middle" font-family="Hiragino Sans, Hiragino Kaku Gothic ProN, sans-serif" font-size="34" fill="#d4d4d8">知らない単語を、指で仕分ける。</text>
  <text x="512" y="410" text-anchor="middle" font-family="Hiragino Sans, Hiragino Kaku Gothic ProN, sans-serif" font-size="24" fill="#71717a">単語 ・ 文法 ・ 長文読解</text>
</svg>`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(join(SRC, "dist/feature-graphic.svg"), svg);
const info = await sharp(Buffer.from(svg), { density: 144 })
  .resize(1024, 500)
  .flatten({ background: "#000000" })
  .png({ compressionLevel: 9 })
  .toFile(OUT);

console.log(`${OUT.replace(ROOT + "/", "")} : ${info.width}x${info.height} / ${Math.round(info.size / 1024)}KB`);
