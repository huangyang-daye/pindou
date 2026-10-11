import type { Rgb } from "./color.ts";

export type Raster = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type SampledPixel = Rgb & { a: number };

export type SampledGrid = {
  width: number;
  height: number;
  pixels: SampledPixel[];
};

const SMALL_IMAGE = 160;

export function defaultBeadWidth(imageWidth: number): number {
  if (imageWidth <= SMALL_IMAGE) return Math.max(1, imageWidth);
  return Math.min(64, imageWidth);
}

export function isLargeImage(imageWidth: number): boolean {
  return imageWidth > SMALL_IMAGE;
}

function pixelAt(image: Raster, x: number, y: number): SampledPixel {
  const index = (y * image.width + x) * 4;
  return {
    r: image.data[index] ?? 0,
    g: image.data[index + 1] ?? 0,
    b: image.data[index + 2] ?? 0,
    a: image.data[index + 3] ?? 255,
  };
}

/** 四个角里出现最多的不透明颜色，作为默认背景。 */
export function cornerColor(image: Raster): Rgb {
  const points: Array<[number, number]> = [
    [0, 0],
    [image.width - 1, 0],
    [0, image.height - 1],
    [image.width - 1, image.height - 1],
  ];
  const colors = points
    .map(([x, y]) => pixelAt(image, Math.max(0, x), Math.max(0, y)))
    .filter((color) => color.a >= 128);
  if (colors.length === 0) return { r: 255, g: 255, b: 255 };

  const counts = new Map<string, { color: Rgb; count: number }>();
  for (const color of colors) {
    const key = `${color.r},${color.g},${color.b}`;
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { color, count: 1 });
  }

  let best: Rgb = colors[0];
  let bestCount = 0;
  for (const entry of counts.values()) {
    if (entry.count > bestCount) {
      best = entry.color;
      bestCount = entry.count;
    }
  }
  return { r: best.r, g: best.g, b: best.b };
}

const MAX_CELL_SAMPLES = 12;
const COLOR_BIN = 16;

type ColorBin = { count: number; r: number; g: number; b: number };

/** 一颗豆覆盖原图的一块区域，取这块里的主色，而不是只看正中心的一个像素。 */
function dominantPixel(image: Raster, x0: number, y0: number, x1: number, y1: number): SampledPixel {
  const spanX = Math.max(1e-6, x1 - x0);
  const spanY = Math.max(1e-6, y1 - y0);
  const stepsX = Math.min(MAX_CELL_SAMPLES, Math.max(1, Math.ceil(spanX - 1e-9)));
  const stepsY = Math.min(MAX_CELL_SAMPLES, Math.max(1, Math.ceil(spanY - 1e-9)));
  const seen = new Set<number>();
  const bins = new Map<number, ColorBin>();
  let opaque = 0;
  let transparent = 0;

  for (let iy = 0; iy < stepsY; iy += 1) {
    const sy = Math.min(image.height - 1, Math.floor(y0 + ((iy + 0.5) * spanY) / stepsY));
    for (let ix = 0; ix < stepsX; ix += 1) {
      const sx = Math.min(image.width - 1, Math.floor(x0 + ((ix + 0.5) * spanX) / stepsX));
      const index = sy * image.width + sx;
      if (seen.has(index)) continue;
      seen.add(index);
      const pixel = pixelAt(image, sx, sy);
      if (pixel.a < 128) {
        transparent += 1;
        continue;
      }
      opaque += 1;
      const key = ((pixel.r / COLOR_BIN) | 0) * 289 + ((pixel.g / COLOR_BIN) | 0) * 17 + ((pixel.b / COLOR_BIN) | 0);
      const bin = bins.get(key);
      if (bin) {
        bin.count += 1;
        bin.r += pixel.r;
        bin.g += pixel.g;
        bin.b += pixel.b;
      } else {
        bins.set(key, { count: 1, r: pixel.r, g: pixel.g, b: pixel.b });
      }
    }
  }

  if (opaque === 0 || transparent > opaque) return { r: 0, g: 0, b: 0, a: 0 };

  let best: ColorBin | null = null;
  for (const bin of bins.values()) {
    if (!best || bin.count > best.count) best = bin;
  }
  const chosen = best ?? { count: 1, r: 0, g: 0, b: 0 };
  return {
    r: Math.round(chosen.r / chosen.count),
    g: Math.round(chosen.g / chosen.count),
    b: Math.round(chosen.b / chosen.count),
    a: 255,
  };
}

/** 左右翻转，每一行从右端写回。 */
export function flipHorizontal(image: Raster): Raster {
  const data = new Uint8ClampedArray(image.data.length);
  const { width, height } = image;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;
      const to = (y * width + (width - 1 - x)) * 4;
      data[to] = image.data[from];
      data[to + 1] = image.data[from + 1];
      data[to + 2] = image.data[from + 2];
      data[to + 3] = image.data[from + 3];
    }
  }
  return { width, height, data };
}

/** 读取原图上一块矩形里的主色。只点一个像素时，矩形的四个边界都落在这个像素上。 */
export function sampleArea(image: Raster, x0: number, y0: number, x1: number, y1: number): SampledPixel {
  const left = Math.max(0, Math.min(image.width - 1, Math.min(x0, x1)));
  const top = Math.max(0, Math.min(image.height - 1, Math.min(y0, y1)));
  const right = Math.max(0, Math.min(image.width, Math.max(x0, x1) + 1));
  const bottom = Math.max(0, Math.min(image.height, Math.max(y0, y1) + 1));
  return dominantPixel(image, left, top, right, bottom);
}

/** 按目标豆阵宽度分格取样，高度按原图比例取整。每格取覆盖区域内的主色。 */
export function sampleGrid(image: Raster, beadWidth: number): SampledGrid {
  const srcW = image.width;
  const srcH = image.height;
  const width = Math.max(1, Math.round(beadWidth));
  const height = Math.max(1, Math.round((srcH * width) / srcW));
  const pixels: SampledPixel[] = [];

  for (let y = 0; y < height; y += 1) {
    const y0 = (y * srcH) / height;
    const y1 = ((y + 1) * srcH) / height;
    for (let x = 0; x < width; x += 1) {
      const x0 = (x * srcW) / width;
      const x1 = ((x + 1) * srcW) / width;
      pixels.push(dominantPixel(image, x0, y0, x1, y1));
    }
  }

  return { width, height, pixels };
}
