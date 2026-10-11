import { textInk } from "./color.ts";
import type { Pattern } from "./match.ts";
import type { CellMask } from "./selection.ts";
import { maskHas } from "./selection.ts";
import type { Palette } from "../palettes/index.ts";

export type SheetRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LabelMode = "code" | "symbol";

export const PDF = {
  pageWmm: 297,
  pageHmm: 210,
  marginMm: 8,
  headerMm: 16,
  axisMm: 8,
  cellMm: 8,
  gapMm: 3,
  ppm: 6,
};

const FONT = '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

export type LegendMetrics = {
  cols: number;
  rows: number;
  rowH: number;
  itemW: number;
  height: number;
};

export function legendMetrics(colorCount: number, contentWidth: number, rowHeight: number): LegendMetrics {
  const count = Math.max(colorCount, 1);
  const itemW = 248;
  const cols = Math.max(1, Math.min(count, Math.floor(contentWidth / itemW) || 1));
  const rows = Math.ceil(count / cols);
  return {
    cols,
    rows,
    rowH: rowHeight,
    itemW,
    height: rows * rowHeight + rowHeight * 0.85,
  };
}

export function pdfCapacity(colorCount: number): { cols: number; rows: number } {
  const ppm = PDF.ppm;
  const pageW = PDF.pageWmm * ppm;
  const pageH = PDF.pageHmm * ppm;
  const margin = PDF.marginMm * ppm;
  const header = PDF.headerMm * ppm;
  const axis = PDF.axisMm * ppm;
  const cell = PDF.cellMm * ppm;
  const gap = PDF.gapMm * ppm;
  const contentW = pageW - margin * 2;
  const legend = legendMetrics(colorCount, contentW, 5.4 * ppm);
  const availW = contentW - axis;
  const availH = pageH - margin * 2 - header - axis - legend.height - gap;
  return {
    cols: Math.max(1, Math.floor(availW / cell)),
    rows: Math.max(1, Math.floor(availH / cell)),
  };
}

export function planTiles(
  patternWidth: number,
  patternHeight: number,
  boardSize: number,
  colorCount: number,
): SheetRegion[] {
  const capacity = pdfCapacity(colorCount);
  const tileW = boardSize > 0 ? Math.min(boardSize, capacity.cols) : capacity.cols;
  const tileH = boardSize > 0 ? Math.min(boardSize, capacity.rows) : capacity.rows;
  const tiles: SheetRegion[] = [];
  for (let y = 0; y < patternHeight; y += tileH) {
    for (let x = 0; x < patternWidth; x += tileW) {
      tiles.push({
        x,
        y,
        width: Math.min(tileW, patternWidth - x),
        height: Math.min(tileH, patternHeight - y),
      });
    }
  }
  return tiles;
}

export function pickPngCellSize(beadsW: number, beadsH: number): number {
  const maxSide = 8192;
  const overhead = 220;
  const limit = Math.floor((maxSide - overhead) / Math.max(beadsW, beadsH, 1));
  return Math.max(14, Math.min(40, limit));
}

export function detectLabelMode(
  ctx: CanvasRenderingContext2D,
  pattern: Pattern,
  palette: Palette,
  cellSize: number,
): LabelMode {
  const fontSize = Math.max(8, Math.floor(cellSize * 0.34));
  ctx.font = `600 ${fontSize}px ${FONT}`;
  const limit = cellSize * 0.82;
  for (const item of pattern.usage) {
    const code = palette.colors[item.colorIndex]?.code ?? "";
    if (ctx.measureText(code).width > limit) return "symbol";
  }
  return "code";
}

function drawCells(
  ctx: CanvasRenderingContext2D,
  pattern: Pattern,
  palette: Palette,
  region: SheetRegion,
  cellSize: number,
  originX: number,
  originY: number,
  mode: LabelMode,
) {
  const symbols = new Map(pattern.usage.map((item) => [item.colorIndex, item.symbol]));
  const fontSize = Math.max(8, Math.floor(cellSize * (mode === "code" ? 0.32 : 0.46)));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${fontSize}px ${FONT}`;

  for (let row = 0; row < region.height; row += 1) {
    for (let col = 0; col < region.width; col += 1) {
      const cell = pattern.cells[(region.y + row) * pattern.width + (region.x + col)];
      const x = originX + col * cellSize;
      const y = originY + row * cellSize;
      if (cell < 0) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x, y, cellSize, cellSize);
        if (cellSize >= 12) {
          ctx.fillStyle = "#d6d3d1";
          ctx.beginPath();
          ctx.arc(x + cellSize / 2, y + cellSize / 2, Math.max(1.2, cellSize * 0.06), 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        const color = palette.colors[cell];
        ctx.fillStyle = color.hex;
        ctx.fillRect(x, y, cellSize, cellSize);
        const label = mode === "code" ? color.code : (symbols.get(cell) ?? "");
        if (cellSize >= 14 && label) {
          ctx.fillStyle = textInk(color.hex);
          ctx.fillText(label, x + cellSize / 2, y + cellSize / 2 + 0.5);
        }
      }
    }
  }
}

function drawCellBorders(
  ctx: CanvasRenderingContext2D,
  region: SheetRegion,
  cellSize: number,
  originX: number,
  originY: number,
) {
  ctx.strokeStyle = "#f6f2ea";
  ctx.lineWidth = 1;
  for (let row = 0; row < region.height; row += 1) {
    for (let col = 0; col < region.width; col += 1) {
      const x = originX + col * cellSize;
      const y = originY + row * cellSize;
      ctx.strokeRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
    }
  }
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  region: SheetRegion,
  cellSize: number,
  axisSize: number,
) {
  ctx.fillStyle = "#5c564e";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const axisFont = Math.max(9, Math.min(13, Math.floor(cellSize * 0.36)));
  ctx.font = `600 ${axisFont}px ${FONT}`;
  const step = cellSize >= 16 ? 1 : 5;
  for (let col = 0; col < region.width; col += 1) {
    const number = region.x + col + 1;
    if (step !== 1 && (number - 1) % step !== 0) continue;
    ctx.fillText(String(number), axisSize + col * cellSize + cellSize / 2, axisSize / 2);
  }
  for (let row = 0; row < region.height; row += 1) {
    const number = region.y + row + 1;
    if (step !== 1 && (number - 1) % step !== 0) continue;
    ctx.fillText(String(number), axisSize / 2, axisSize + row * cellSize + cellSize / 2);
  }
}

/** 绝对格号上每 5 格一条辅助线，其中每 10 格是大格线。offset 是相对当前区域的边界。 */
export function guideMarks(origin: number, length: number): { offset: number; major: boolean }[] {
  const marks: { offset: number; major: boolean }[] = [];
  const end = origin + length;
  for (let index = Math.ceil((origin + 1) / 5) * 5; index < end; index += 5) {
    marks.push({ offset: index - origin, major: index % 10 === 0 });
  }
  return marks;
}

function drawGuides(
  ctx: CanvasRenderingContext2D,
  region: SheetRegion,
  cellSize: number,
  originX: number,
  originY: number,
) {
  const spanX = region.width * cellSize;
  const spanY = region.height * cellSize;
  const colMarks = guideMarks(region.x, region.width);
  const rowMarks = guideMarks(region.y, region.height);
  const dash = Math.max(3, Math.round(cellSize * 0.42));
  const gap = Math.max(2, Math.round(cellSize * 0.28));

  ctx.save();
  ctx.lineCap = "butt";
  ctx.strokeStyle = "#8a847c";
  ctx.lineWidth = Math.max(1.25, Math.min(1.75, cellSize * 0.08));
  ctx.setLineDash([dash, gap]);
  ctx.beginPath();
  for (const mark of rowMarks) {
    if (mark.major) continue;
    const y = originY + mark.offset * cellSize;
    ctx.moveTo(originX, y);
    ctx.lineTo(originX + spanX, y);
  }
  for (const mark of colMarks) {
    if (mark.major) continue;
    const x = originX + mark.offset * cellSize;
    ctx.moveTo(x, originY);
    ctx.lineTo(x, originY + spanY);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = "#1c1917";
  ctx.lineWidth = Math.max(2, Math.min(3, cellSize * 0.12));
  ctx.beginPath();
  for (const mark of colMarks) {
    if (!mark.major) continue;
    const x = originX + mark.offset * cellSize;
    ctx.moveTo(x, originY);
    ctx.lineTo(x, originY + spanY);
  }
  for (const mark of rowMarks) {
    if (!mark.major) continue;
    const y = originY + mark.offset * cellSize;
    ctx.moveTo(originX, y);
    ctx.lineTo(originX + spanX, y);
  }
  ctx.stroke();
  ctx.restore();
}

export function cellFromOffset(
  x: number,
  y: number,
  cellSize: number,
  axisSize: number,
  width: number,
  height: number,
): { col: number; row: number } | null {
  const col = Math.floor((x - axisSize) / cellSize);
  const row = Math.floor((y - axisSize) / cellSize);
  if (col < 0 || row < 0 || col >= width || row >= height) return null;
  return { col, row };
}

function layerCanvas(region: SheetRegion, cellSize: number, axisSize: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, axisSize + region.width * cellSize);
  canvas.height = Math.max(1, axisSize + region.height * cellSize);
  return canvas;
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  pattern: Pattern,
  region: SheetRegion,
  cellSize: number,
  axisSize: number,
  selection: CellMask,
) {
  ctx.fillStyle = "rgba(184, 67, 47, 0.28)";
  ctx.strokeStyle = "#b8432f";
  ctx.lineWidth = 2;
  for (let row = 0; row < region.height; row += 1) {
    for (let col = 0; col < region.width; col += 1) {
      const index = (region.y + row) * pattern.width + (region.x + col);
      if (!maskHas(selection, index)) continue;
      const x = axisSize + col * cellSize;
      const y = axisSize + row * cellSize;
      ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
      ctx.strokeRect(x + 1.5, y + 1.5, cellSize - 3, cellSize - 3);
    }
  }
}

/** 绘制层：豆子的填色、色号和选区。 */
export function renderDrawing(options: {
  pattern: Pattern;
  palette: Palette;
  cellSize: number;
  region: SheetRegion;
  axisSize: number;
  selection?: CellMask | null;
}): HTMLCanvasElement {
  const { pattern, palette, cellSize, region, axisSize, selection } = options;
  const canvas = layerCanvas(region, cellSize, axisSize);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const mode = detectLabelMode(ctx, pattern, palette, cellSize);
  drawCells(ctx, pattern, palette, region, cellSize, axisSize, axisSize, mode);
  if (selection) drawSelection(ctx, pattern, region, cellSize, axisSize, selection);
  return canvas;
}

/** 板子层：坐标轴、单元格边框，以及打开时的辅助线。 */
export function renderBoard(options: {
  cellSize: number;
  region: SheetRegion;
  axisSize: number;
  guides?: boolean;
}): HTMLCanvasElement {
  const { cellSize, region, axisSize, guides } = options;
  const canvas = layerCanvas(region, cellSize, axisSize);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  drawAxes(ctx, region, cellSize, axisSize);
  drawCellBorders(ctx, region, cellSize, axisSize, axisSize);
  if (guides) drawGuides(ctx, region, cellSize, axisSize, axisSize);
  return canvas;
}

export function renderGrid(options: {
  pattern: Pattern;
  palette: Palette;
  cellSize: number;
  region: SheetRegion;
  axisSize: number;
  selection?: CellMask | null;
  guides?: boolean;
}): HTMLCanvasElement {
  const { pattern, palette, cellSize, region, axisSize, selection, guides } = options;
  const canvas = layerCanvas(region, cellSize, axisSize);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.fillStyle = "#f6f1e8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const mode = detectLabelMode(ctx, pattern, palette, cellSize);
  drawAxes(ctx, region, cellSize, axisSize);
  drawCells(ctx, pattern, palette, region, cellSize, axisSize, axisSize, mode);
  drawCellBorders(ctx, region, cellSize, axisSize, axisSize);
  if (selection) drawSelection(ctx, pattern, region, cellSize, axisSize, selection);
  if (guides) drawGuides(ctx, region, cellSize, axisSize, axisSize);
  return canvas;
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  pattern: Pattern,
  palette: Palette,
  x: number,
  y: number,
  width: number,
  rowHeight: number,
) {
  const metrics = legendMetrics(pattern.usage.length, width, rowHeight);
  ctx.fillStyle = "#1f1c19";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${Math.max(12, rowHeight * 0.42)}px ${FONT}`;
  ctx.fillText(`合计 ${pattern.totalBeads} 颗`, x, y + rowHeight * 0.28);

  pattern.usage.forEach((item, index) => {
    const color = palette.colors[item.colorIndex];
    const col = index % metrics.cols;
    const row = Math.floor(index / metrics.cols);
    const itemX = x + col * metrics.itemW;
    const itemY = y + rowHeight * 0.85 + row * metrics.rowH + metrics.rowH / 2;
    const swatch = Math.min(16, rowHeight * 0.55);
    ctx.fillStyle = color.hex;
    ctx.fillRect(itemX, itemY - swatch / 2, swatch, swatch);
    ctx.strokeStyle = "rgba(36, 28, 20, 0.25)";
    ctx.strokeRect(itemX + 0.5, itemY - swatch / 2 + 0.5, swatch - 1, swatch - 1);
    ctx.fillStyle = "#1f1c19";
    ctx.font = `600 ${Math.max(11, rowHeight * 0.38)}px ${FONT}`;
    ctx.fillText(
      `${item.symbol}  ${color.code}  ${color.nameZh}  ${item.count}`,
      itemX + swatch + 6,
      itemY,
      metrics.itemW - swatch - 12,
    );
  });
}

export type SheetMeta = {
  title: string;
  paletteName: string;
};

export function renderFullSheet(pattern: Pattern, palette: Palette, meta: SheetMeta): HTMLCanvasElement {
  const cellSize = pickPngCellSize(pattern.width, pattern.height);
  const axisSize = Math.max(32, Math.round(cellSize * 1.15));
  const pad = 28;
  const headerH = 78;
  const region = { x: 0, y: 0, width: pattern.width, height: pattern.height };
  const grid = renderGrid({ pattern, palette, cellSize, region, axisSize });
  const contentWidth = Math.max(grid.width, 760);
  const rowHeight = 30;
  const legend = legendMetrics(pattern.usage.length, contentWidth, rowHeight);
  const canvas = document.createElement("canvas");
  canvas.width = contentWidth + pad * 2;
  canvas.height = pad + headerH + grid.height + legend.height + pad;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1f1c19";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `700 28px ${FONT}`;
  ctx.fillText(meta.title, pad, pad, canvas.width - pad * 2);
  ctx.fillStyle = "#5c564e";
  ctx.font = `500 16px ${FONT}`;
  ctx.fillText(
    `${meta.paletteName}  ·  ${pattern.width}×${pattern.height} 豆  ·  共 ${pattern.totalBeads} 颗  ·  屏幕色仅供对照`,
    pad,
    pad + 38,
    canvas.width - pad * 2,
  );
  ctx.drawImage(grid, pad, pad + headerH);
  drawLegend(ctx, pattern, palette, pad, pad + headerH + grid.height, contentWidth, rowHeight);
  return canvas;
}

export function renderPdfPage(options: {
  pattern: Pattern;
  palette: Palette;
  region: SheetRegion;
  meta: SheetMeta;
  pageIndex: number;
  pageCount: number;
}): HTMLCanvasElement {
  const ppm = PDF.ppm;
  const canvas = document.createElement("canvas");
  canvas.width = PDF.pageWmm * ppm;
  canvas.height = PDF.pageHmm * ppm;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const margin = PDF.marginMm * ppm;
  const header = PDF.headerMm * ppm;
  const axis = PDF.axisMm * ppm;
  const cell = PDF.cellMm * ppm;
  const gap = PDF.gapMm * ppm;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#1f1c19";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `700 ${4.2 * ppm}px ${FONT}`;
  ctx.fillText(options.meta.title, margin, margin, canvas.width - margin * 2);
  ctx.fillStyle = "#5c564e";
  ctx.font = `500 ${2.7 * ppm}px ${FONT}`;
  const range = `第 ${options.region.x + 1}–${options.region.x + options.region.width} 列，第 ${options.region.y + 1}–${options.region.y + options.region.height} 行`;
  ctx.fillText(
    `${options.meta.paletteName}  ·  ${options.pattern.width}×${options.pattern.height} 豆  ·  共 ${options.pattern.totalBeads} 颗  ·  ${range}  ·  ${options.pageIndex + 1}/${options.pageCount} 页`,
    margin,
    margin + 6.2 * ppm,
    canvas.width - margin * 2,
  );

  const grid = renderGrid({
    pattern: options.pattern,
    palette: options.palette,
    cellSize: cell,
    region: options.region,
    axisSize: axis,
  });
  const gridTop = margin + header;
  ctx.drawImage(grid, margin, gridTop);
  drawLegend(
    ctx,
    options.pattern,
    options.palette,
    margin,
    gridTop + grid.height + gap,
    canvas.width - margin * 2,
    5.2 * ppm,
  );
  return canvas;
}
