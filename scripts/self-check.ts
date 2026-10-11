import assert from "node:assert/strict";
import { deltaE00, rgbToLab } from "../src/lib/color.ts";
import { cornerColor, defaultBeadWidth, flipHorizontal, sampleGrid } from "../src/lib/grid.ts";
import type { Raster } from "../src/lib/grid.ts";
import { closestColors, indexToSymbol, maskColor, matchColors, paintMask, paintRegion, regionColor } from "../src/lib/match.ts";
import { createMask, forEachCellOnLine, maskCount, maskHas, maskXor, maskXorAll, togglePath } from "../src/lib/selection.ts";
import { guideMarks, pdfCapacity, planTiles } from "../src/lib/renderPattern.ts";
import { brands, findPalette } from "../src/palettes/index.ts";

const white = rgbToLab({ r: 255, g: 255, b: 255 });
assert.ok(Math.abs(white.l - 100) < 0.05, `white L ${white.l}`);
assert.ok(Math.abs(white.a) < 0.05 && Math.abs(white.b) < 0.05, "white a/b");

assert.equal(deltaE00(white, white), 0);

const sharma = deltaE00(
  { l: 50, a: 2.6772, b: -79.7751 },
  { l: 50, a: 0, b: -82.7485 },
);
assert.ok(Math.abs(sharma - 2.0425) < 0.001, `CIEDE2000 ${sharma}`);

assert.equal(indexToSymbol(0), "A");
assert.equal(indexToSymbol(25), "Z");
assert.equal(indexToSymbol(26), "AA");

function solid(width: number, height: number, fill: (x: number, y: number) => [number, number, number, number]): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = fill(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { width, height, data };
}

const scaled = solid(4, 4, (x, y) => {
  if (y < 2 && x < 2) return [180, 6, 14, 255];
  if (y < 2) return [2, 118, 67, 255];
  if (x < 2) return [2, 57, 163, 255];
  return [20, 19, 21, 255];
});
const grid = sampleGrid(scaled, 2);
assert.deepEqual([grid.width, grid.height], [2, 2]);
assert.deepEqual([grid.pixels[0].r, grid.pixels[1].r, grid.pixels[2].b, grid.pixels[3].r], [180, 2, 163, 20]);

const seam = solid(6, 1, (x) => {
  if (x === 1 || x === 4) return [0, 0, 0, 255];
  if (x < 3) return [180, 6, 14, 255];
  return [2, 57, 163, 255];
});
const seamGrid = sampleGrid(seam, 2);
assert.equal(seamGrid.pixels[0].r, 180);
assert.equal(seamGrid.pixels[1].b, 163);
const flipped = flipHorizontal(seam);
assert.equal(flipped.data[0], 2);
assert.equal(flipped.data[2], 163);
assert.equal(flipped.data[4 * 5], 180);
assert.equal(flipHorizontal(flipped).data[0], seam.data[0]);

assert.equal(defaultBeadWidth(32), 32);
assert.equal(defaultBeadWidth(800), 64);

const hama = findPalette("hama-midi-basic");
const mard24 = findPalette("mard-24");
const mard72 = findPalette("mard-72");
const mard96 = findPalette("mard-96");
const mard221 = findPalette("mard-221");
assert.deepEqual(brands.map((brand) => brand.id), ["mard", "perler", "artkal", "hama", "nabbi"]);
assert.equal(mard24.colors.length, 24);
assert.equal(mard221.colors.length, 221);
assert.equal(findPalette("mard-291").colors.length, 291);
assert.ok(mard72.colors.every((color) => mard96.colors.some((larger) => larger.code === color.code)));
assert.equal(hama.colors.length, 22);
assert.equal(findPalette("perler").colors.length, 103);
assert.equal(findPalette("artkal-s").colors.length, 199);
for (const color of hama.colors) {
  const chip = solid(1, 1, () => {
    const rgb = color.hex;
    return [
      Number.parseInt(rgb.slice(1, 3), 16),
      Number.parseInt(rgb.slice(3, 5), 16),
      Number.parseInt(rgb.slice(5, 7), 16),
      255,
    ];
  });
  const matched = matchColors(sampleGrid(chip, 1), hama, { background: null, threshold: 0 });
  assert.equal(hama.colors[matched.cells[0]].code, color.code, color.code);
}

const scene = solid(3, 3, (x, y) => (x === 1 && y === 1 ? [180, 6, 14, 255] : [229, 236, 241, 255]));
const bg = cornerColor(scene);
assert.deepEqual(bg, { r: 229, g: 236, b: 241 });
const punched = matchColors(sampleGrid(scene, 3), hama, { background: bg, threshold: 8 });
assert.equal(punched.totalBeads, 1);
assert.equal(hama.colors[punched.cells[4]].code, "H05");
const nearest = closestColors({ r: 180, g: 6, b: 14 }, hama, 3);
assert.equal(nearest.length, 3);
assert.equal(hama.colors[nearest[0].colorIndex].code, "H05");
assert.ok(nearest[0].distance <= nearest[1].distance);
assert.equal(punched.cells[0], -1);

const transparent = solid(1, 1, () => [255, 0, 0, 0]);
const empty = matchColors(sampleGrid(transparent, 1), hama, { background: null, threshold: 0 });
assert.equal(empty.totalBeads, 0);

const painted = paintRegion(punched, { x: 0, y: 0, width: 2, height: 1 }, 4, hama.colors.length);
assert.equal(painted.cells[0], 4);
assert.equal(painted.cells[1], 4);
assert.equal(painted.cells[4], punched.cells[4]);
assert.equal(painted.totalBeads, punched.totalBeads + 2);
assert.equal(regionColor(painted, { x: 0, y: 0, width: 2, height: 1 }), 4);
assert.equal(regionColor(painted, { x: 0, y: 0, width: 3, height: 3 }), "mixed");
const cleared = paintRegion(painted, { x: 1, y: 1, width: 1, height: 1 }, -1, hama.colors.length);
assert.equal(cleared.cells[4], -1);
assert.equal(cleared.totalBeads, painted.totalBeads - 1);

const bits = createMask(40);
maskXor(bits, 0);
maskXor(bits, 31);
maskXor(bits, 32);
maskXor(bits, 0);
assert.equal(maskHas(bits, 0), false);
assert.equal(maskHas(bits, 31), true);
assert.equal(maskHas(bits, 32), true);
assert.equal(maskCount(bits), 2);
const stroke = createMask(40);
maskXor(stroke, 31);
maskXor(stroke, 7);
const toggled = maskXorAll(bits, stroke);
assert.equal(maskHas(toggled, 31), false);
assert.equal(maskHas(toggled, 32), true);
assert.equal(maskHas(toggled, 7), true);
const traced: number[] = [];
forEachCellOnLine(4, { col: 0, row: 0 }, { col: 3, row: 0 }, (index) => traced.push(index));
assert.deepEqual(traced, [0, 1, 2, 3]);
const diagonal: number[] = [];
forEachCellOnLine(4, { col: 0, row: 0 }, { col: 2, row: 2 }, (index) => diagonal.push(index));
assert.ok(diagonal.includes(0) && diagonal.includes(10));
assert.ok(diagonal.length >= 3);
const roundTrip = createMask(4);
maskXor(roundTrip, 0);
togglePath(roundTrip, 4, { col: 0, row: 0 }, { col: 2, row: 0 });
togglePath(roundTrip, 4, { col: 2, row: 0 }, { col: 0, row: 0 });
assert.equal(maskHas(roundTrip, 0), false);
assert.equal(maskHas(roundTrip, 1), false);
assert.equal(maskHas(roundTrip, 2), true);
const path = createMask(punched.cells.length);
maskXor(path, 0);
maskXor(path, 1);
const paintedByMask = paintMask(punched, path, 2, hama.colors.length);
assert.equal(paintedByMask.cells[0], 2);
assert.equal(paintedByMask.cells[1], 2);
assert.equal(maskColor(paintedByMask, path), 2);
const mixedMask = createMask(punched.cells.length);
maskXor(mixedMask, 0);
maskXor(mixedMask, 4);
assert.equal(maskColor(paintedByMask, mixedMask), "mixed");

const capacity = pdfCapacity(23);
assert.ok(capacity.cols >= 29, `cols ${capacity.cols}`);
assert.ok(capacity.rows >= 12, `rows ${capacity.rows}`);
const tiles = planTiles(40, 40, 29, 23);
assert.equal(tiles[0].width, Math.min(29, capacity.cols));
assert.ok(tiles.length > 1);
assert.equal(planTiles(8, 8, 0, 4).length, 1);
const marks = guideMarks(0, 32);
assert.deepEqual(
  marks.map((mark) => mark.offset),
  [5, 10, 15, 20, 25, 30],
);
assert.deepEqual(
  marks.map((mark) => mark.major),
  [false, true, false, true, false, true],
);
assert.deepEqual(
  guideMarks(8, 10).map((mark) => [mark.offset, mark.major]),
  [
    [2, true],
    [7, false],
  ],
);

console.log("self-check ok", capacity, "tiles", tiles.length);
