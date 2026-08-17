// 英語学習アプリのアイコンを assets/english-icon/*.svg から一括生成する。
// 生成物は手で触らない。直すときは SVG を直してこれを流し直す。
//   node scripts/generate-english-icons.mjs
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "assets/english-icon");
const DIST = join(SRC, "dist");

// SVG を密度指定で 4 倍に描いてから縮めると、Didot の細い線が飛ばずに残る
const SUPERSAMPLE = 4;

async function png(svg, size, out, { alpha = false } = {}) {
  let img = sharp(join(SRC, svg), { density: 72 * SUPERSAMPLE }).resize(size, size, {
    kernel: "lanczos3",
  });
  // ストア提出用はアルファ非対応。黒地に焼き込んでおく
  if (!alpha) img = img.flatten({ background: "#000000" });
  await mkdir(dirname(out), { recursive: true });
  await img.png({ compressionLevel: 9 }).toFile(out);
  return out;
}

// ICO は PNG をそのまま格納できる。sharp が .ico を書けないので自前で組む
async function ico(svg, sizes, out) {
  const images = await Promise.all(
    sizes.map((s) =>
      sharp(join(SRC, svg), { density: 72 * SUPERSAMPLE })
        .resize(s, s, { kernel: "lanczos3" })
        .png({ compressionLevel: 9 })
        .toBuffer(),
    ),
  );
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(sizes.length, 4);

  let offset = 6 + 16 * sizes.length;
  const entries = images.map((buf, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 0); // 0 は 256 の意味
    e.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 1);
    e.writeUInt8(0, 2); // パレット無し
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buf.length;
    return e;
  });

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, Buffer.concat([header, ...entries, ...images]));
  return out;
}

const made = [];
const p = (...a) => png(...a).then((f) => made.push(f));

await Promise.all([
  // --- Web / PWA が実際に配信するもの ---
  p("icon.svg", 192, join(ROOT, "public/icons/icon-192.png")),
  p("icon.svg", 512, join(ROOT, "public/icons/icon-512.png")),
  p("icon.svg", 1024, join(ROOT, "public/icons/icon-1024.png")),
  p("icon.svg", 180, join(ROOT, "public/icons/apple-touch-icon.png")),
  p("icon-maskable.svg", 512, join(ROOT, "public/icons/icon-maskable-512.png")),

  // --- ストア提出用 ---
  p("icon.svg", 1024, join(DIST, "app-store-icon-1024.png")),
  p("icon.svg", 512, join(DIST, "play-store-icon-512.png")),

  // --- Capacitor の @capacitor/assets が読む名前 ---
  p("icon.svg", 1024, join(DIST, "capacitor/icon-only.png")),
  p("icon-foreground.svg", 1024, join(DIST, "capacitor/icon-foreground.png"), { alpha: true }),
  p("icon-background.svg", 1024, join(DIST, "capacitor/icon-background.png")),
  p("splash.svg", 2732, join(DIST, "capacitor/splash.png")),
  p("splash.svg", 2732, join(DIST, "capacitor/splash-dark.png")),

  // --- ブラウザのタブ。16px では Eng. が潰れるのでモノグラムに切り替える ---
  ico("icon-compact.svg", [16, 32, 48], join(ROOT, "app/favicon.ico")).then((f) => made.push(f)),
]);

for (const f of made.sort()) console.log("  " + f.replace(ROOT + "/", ""));
console.log(`\n${made.length} ファイル生成`);
