// MARD 套装色号来自零售盒装清单，色值来自公开色卡。
// Hama、Perler、Artkal、Nabbi 色号整理自 https://github.com/maxcleme/beadcolors 。
// HEX 是屏幕对照色。Lab 在载入时由 HEX 计算一次，匹配时直接使用。
import catalog from "./catalog.json" with { type: "json" };
import { hexToRgb, rgbToLab } from "../lib/color.ts";
import type { Lab } from "../lib/color.ts";

export type BeadColor = {
  code: string;
  name: string;
  nameZh: string;
  hex: string;
  lab: Lab;
};

export type Palette = {
  id: string;
  brand: string;
  name: string;
  note: string;
  default: boolean;
  colors: BeadColor[];
};

export type Brand = {
  id: string;
  name: string;
  ranges: Palette[];
};

type RawColor = {
  code: string;
  name: string;
  nameZh: string;
  hex: string;
};

type RawCatalog = {
  brands: Array<{
    id: string;
    name: string;
    ranges: Array<{
      id: string;
      name: string;
      note: string;
      default?: boolean;
      colors: RawColor[];
    }>;
  }>;
};

function hydrateColor(color: RawColor): BeadColor {
  return { ...color, lab: rgbToLab(hexToRgb(color.hex)) };
}

export const brands: Brand[] = (catalog as RawCatalog).brands.map((brand) => ({
  id: brand.id,
  name: brand.name,
  ranges: brand.ranges.map((range) => ({
    id: range.id,
    brand: brand.name,
    name: `${brand.name} ${range.name}`,
    note: range.note,
    default: range.default === true,
    colors: range.colors.map(hydrateColor),
  })),
}));

export const palettes: Palette[] = brands.flatMap((brand) => brand.ranges);

export function findBrand(id: string): Brand {
  return brands.find((brand) => brand.id === id) ?? brands[0];
}

export function findPalette(id: string): Palette {
  return palettes.find((palette) => palette.id === id) ?? palettes[0];
}

export function defaultPalette(brand: Brand): Palette {
  return brand.ranges.find((range) => range.default) ?? brand.ranges[0];
}
