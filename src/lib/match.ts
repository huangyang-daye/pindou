import { deltaE00, rgbToLab } from "./color.ts";
import type { Rgb } from "./color.ts";
import type { SampledGrid } from "./grid.ts";
import type { CellMask } from "./selection.ts";
import { maskForEach } from "./selection.ts";
import type { Palette } from "../palettes/index.ts";

export type Usage = {
  colorIndex: number;
  count: number;
  symbol: string;
};

export type Pattern = {
  width: number;
  height: number;
  cells: Int16Array;
  usage: Usage[];
  totalBeads: number;
};

export type MatchOptions = {
  background: Rgb | null;
  threshold: number;
};

export function indexToSymbol(index: number): string {
  let n = index + 1;
  let symbol = "";
  while (n > 0) {
    n -= 1;
    symbol = String.fromCharCode(65 + (n % 26)) + symbol;
    n = Math.floor(n / 26);
  }
  return symbol;
}

export type ColorMatch = {
  colorIndex: number;
  distance: number;
};

/** 按 CIEDE2000 取出当前色盘里最接近的若干色，距离小的在前。 */
export function closestColors(rgb: Rgb, palette: Palette, limit = 3): ColorMatch[] {
  const lab = rgbToLab(rgb);
  return palette.colors
    .map((color, colorIndex) => ({ colorIndex, distance: deltaE00(lab, color.lab) }))
    .sort((a, b) => a.distance - b.distance || a.colorIndex - b.colorIndex)
    .slice(0, Math.max(0, limit));
}

export function matchColors(
  grid: SampledGrid,
  palette: Palette,
  options: MatchOptions,
): Pattern {
  const cells = new Int16Array(grid.pixels.length);
  const cache = new Map<string, number>();
  const backgroundLab = options.background ? rgbToLab(options.background) : null;

  for (let i = 0; i < grid.pixels.length; i += 1) {
    const pixel = grid.pixels[i];
    if (pixel.a < 128) {
      cells[i] = -1;
      continue;
    }

    const key = `${pixel.r},${pixel.g},${pixel.b}`;
    let matched = cache.get(key);
    if (matched === undefined) {
      const lab = rgbToLab(pixel);
      if (backgroundLab && deltaE00(lab, backgroundLab) <= options.threshold) {
        matched = -1;
      } else {
        let best = 0;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let colorIndex = 0; colorIndex < palette.colors.length; colorIndex += 1) {
          const distance = deltaE00(lab, palette.colors[colorIndex].lab);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = colorIndex;
          }
        }
        matched = best;
      }
      cache.set(key, matched);
    }

    cells[i] = matched;
  }

  return recountPattern(grid.width, grid.height, cells, palette.colors.length);
}

export function recountPattern(
  width: number,
  height: number,
  cells: Int16Array,
  colorCount: number,
): Pattern {
  const counts = new Array<number>(colorCount).fill(0);
  let totalBeads = 0;
  for (const cell of cells) {
    if (cell < 0 || cell >= colorCount) continue;
    counts[cell] += 1;
    totalBeads += 1;
  }

  const usage: Usage[] = [];
  let symbolIndex = 0;
  for (let colorIndex = 0; colorIndex < counts.length; colorIndex += 1) {
    if (counts[colorIndex] === 0) continue;
    usage.push({
      colorIndex,
      count: counts[colorIndex],
      symbol: indexToSymbol(symbolIndex),
    });
    symbolIndex += 1;
  }

  return { width, height, cells, usage, totalBeads };
}

export function paintRegion(
  pattern: Pattern,
  region: { x: number; y: number; width: number; height: number },
  colorIndex: number,
  colorCount: number,
): Pattern {
  const cells = new Int16Array(pattern.cells);
  const x0 = Math.max(0, region.x);
  const y0 = Math.max(0, region.y);
  const x1 = Math.min(pattern.width, region.x + region.width);
  const y1 = Math.min(pattern.height, region.y + region.height);
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      cells[y * pattern.width + x] = colorIndex;
    }
  }
  return recountPattern(pattern.width, pattern.height, cells, colorCount);
}

export function paintMask(
  pattern: Pattern,
  mask: CellMask,
  colorIndex: number,
  colorCount: number,
): Pattern {
  const cells = new Int16Array(pattern.cells);
  maskForEach(mask, (index) => {
    if (index < cells.length) cells[index] = colorIndex;
  });
  return recountPattern(pattern.width, pattern.height, cells, colorCount);
}

export function maskColor(pattern: Pattern, mask: CellMask): number | "mixed" {
  let found: number | null = null;
  let mixed = false;
  maskForEach(mask, (index) => {
    if (index >= pattern.cells.length) return;
    const cell = pattern.cells[index];
    if (found === null) found = cell;
    else if (found !== cell) mixed = true;
  });
  if (mixed || found === null) return "mixed";
  return found;
}

export function regionColor(
  pattern: Pattern,
  region: { x: number; y: number; width: number; height: number },
): number | "mixed" {
  let found: number | null = null;
  const x1 = Math.min(pattern.width, region.x + region.width);
  const y1 = Math.min(pattern.height, region.y + region.height);
  for (let y = Math.max(0, region.y); y < y1; y += 1) {
    for (let x = Math.max(0, region.x); x < x1; x += 1) {
      const cell = pattern.cells[y * pattern.width + x];
      if (found === null) found = cell;
      else if (found !== cell) return "mixed";
    }
  }
  return found ?? "mixed";
}
