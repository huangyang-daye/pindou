import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { downloadPng } from "./lib/exportPng.ts";
import { rgbToHex } from "./lib/color.ts";
import type { Rgb } from "./lib/color.ts";
import { cornerColor, defaultBeadWidth, flipHorizontal, isLargeImage, sampleArea, sampleGrid } from "./lib/grid.ts";
import type { Raster } from "./lib/grid.ts";
import { closestColors, maskColor, matchColors, paintMask } from "./lib/match.ts";
import type { ColorMatch, Pattern } from "./lib/match.ts";
import { cellFromOffset, detectLabelMode, pdfCapacity, planTiles, renderBoard, renderDrawing } from "./lib/renderPattern.ts";
import { createMask, maskCount, maskSoleIndex, maskXor, togglePath } from "./lib/selection.ts";
import type { CellMask } from "./lib/selection.ts";
import { brands, defaultPalette, findBrand, findPalette } from "./palettes/index.ts";
import type { Palette } from "./palettes/index.ts";

const MAX_BEADS = 240;

type Source = {
  name: string;
  width: number;
  height: number;
  image: Raster;
  background: Rgb;
  large: boolean;
};

type SortKey = "count" | "code";

type CellPoint = { col: number; row: number };

type PickerState = {
  left: number;
  top: number;
};

type DragState = {
  pointerId: number;
  width: number;
  base: CellMask;
  live: CellMask;
  last: CellPoint;
};

type DropSample = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  rgb: Rgb | null;
};

type SourceDrag = {
  pointerId: number;
  x: number;
  y: number;
};

type SourceBox = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

function axisSizeFor(cellSize: number): number {
  return Math.max(28, Math.round(cellSize * 1.2));
}

function placePicker(clientX: number, clientY: number): { left: number; top: number } {
  const width = 292;
  const height = 380;
  return {
    left: Math.max(8, Math.min(clientX + 14, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(clientY + 14, window.innerHeight - height - 8)),
  };
}

function readImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("load"));
    };
    image.src = url;
  });
}

function imageToRaster(image: HTMLImageElement): Raster {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: data.width, height: data.height, data: data.data };
}

function fileStem(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 48);
  return stem || "拼豆图纸";
}

function clampNumber(value: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export default function App() {
  const [source, setSource] = useState<Source | null>(null);
  const [brandId, setBrandId] = useState("mard");
  const [paletteId, setPaletteId] = useState("mard-221");
  const [beadWidth, setBeadWidth] = useState(32);
  const [removeBackground, setRemoveBackground] = useState(false);
  const [bgThreshold, setBgThreshold] = useState(12);
  const [boardSize, setBoardSize] = useState(29);
  const [cellSize, setCellSize] = useState(22);
  const [guides, setGuides] = useState(false);
  const [eyedropper, setEyedropper] = useState(false);
  const [drop, setDrop] = useState<DropSample | null>(null);
  const [drawVisible, setDrawVisible] = useState(true);
  const [drawOpacity, setDrawOpacity] = useState(100);
  const [boardVisible, setBoardVisible] = useState(true);
  const [boardOpacity, setBoardOpacity] = useState(100);
  const [sortKey, setSortKey] = useState<SortKey>("count");
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"png" | "pdf" | null>(null);
  const [edited, setEdited] = useState<Pattern | null>(null);
  const [selection, setSelection] = useState<CellMask | null>(null);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement>(null);
  const sourceDragRef = useRef<SourceDrag | null>(null);
  const bitmapRef = useRef<HTMLCanvasElement | null>(null);
  const bitmapKey = useRef<Raster | null>(null);

  const brand = findBrand(brandId);
  const palette = findPalette(paletteId);
  const matches = useMemo(() => {
    if (!drop?.rgb) return [];
    return closestColors(drop.rgb, palette, 3);
  }, [drop, palette]);

  const matched = useMemo(() => {
    if (!source) return null;
    const grid = sampleGrid(source.image, beadWidth);
    return matchColors(grid, palette, {
      background: removeBackground ? source.background : null,
      threshold: bgThreshold,
    });
  }, [source, beadWidth, palette, removeBackground, bgThreshold]);
  const [trackedMatch, setTrackedMatch] = useState(matched);
  if (trackedMatch !== matched) {
    setTrackedMatch(matched);
    setEdited(null);
    setSelection(null);
    setPicker(null);
  }
  const pattern = trackedMatch === matched ? (edited ?? matched) : matched;

  const tiles = useMemo(() => {
    if (!pattern) return [];
    return planTiles(pattern.width, pattern.height, boardSize, pattern.usage.length);
  }, [pattern, boardSize]);

  const capacity = useMemo(
    () => pdfCapacity(pattern?.usage.length ?? palette.colors.length),
    [pattern, palette.colors.length],
  );
  const tileWidth = boardSize > 0 ? Math.min(boardSize, capacity.cols) : capacity.cols;
  const tileHeight = boardSize > 0 ? Math.min(boardSize, capacity.rows) : capacity.rows;

  const labelMode = useMemo(() => {
    if (!pattern) return "code" as const;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return "code" as const;
    return detectLabelMode(ctx, pattern, palette, cellSize);
  }, [pattern, palette, cellSize]);

  const legend = useMemo(() => {
    if (!pattern) return [];
    const items = [...pattern.usage];
    if (sortKey === "count") {
      items.sort((a, b) => b.count - a.count || a.colorIndex - b.colorIndex);
    } else {
      items.sort((a, b) =>
        palette.colors[a.colorIndex].code.localeCompare(palette.colors[b.colorIndex].code, "en"),
      );
    }
    return items;
  }, [pattern, sortKey, palette]);

  const clearSelection = useCallback(() => {
    setPicker(null);
    setSelection(null);
  }, []);

  useEffect(() => {
    if (!picker) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      clearSelection();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picker, clearSelection]);

  useEffect(() => {
    const host = canvasRef.current;
    if (!host || !pattern) return;
    const axisSize = axisSizeFor(cellSize);
    const region = { x: 0, y: 0, width: pattern.width, height: pattern.height };
    const drawn = renderDrawing({ pattern, palette, cellSize, region, axisSize, selection });
    const board = renderBoard({ cellSize, region, axisSize, guides });
    host.width = drawn.width;
    host.height = drawn.height;
    const ctx = host.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, host.width, host.height);
    ctx.globalAlpha = drawVisible ? drawOpacity / 100 : 0;
    ctx.drawImage(drawn, 0, 0);
    ctx.globalAlpha = boardVisible ? boardOpacity / 100 : 0;
    ctx.drawImage(board, 0, 0);
    ctx.globalAlpha = 1;
  }, [pattern, palette, cellSize, selection, guides, drawVisible, drawOpacity, boardVisible, boardOpacity]);

  const paintSource = useCallback((band?: SourceBox) => {
    const canvas = sourceCanvasRef.current;
    if (!canvas || !source || !eyedropper) return;
    if (bitmapKey.current !== source.image || !bitmapRef.current) {
      const bitmap = document.createElement("canvas");
      bitmap.width = source.width;
      bitmap.height = source.height;
      const sourceCtx = bitmap.getContext("2d");
      if (!sourceCtx) return;
      sourceCtx.putImageData(
        new ImageData(new Uint8ClampedArray(source.image.data), source.width, source.height),
        0,
        0,
      );
      bitmapRef.current = bitmap;
      bitmapKey.current = source.image;
    }
    const longSide = Math.max(source.width, source.height);
    const target = longSide < 240 ? 240 : Math.min(longSide, 720);
    const scale = target / longSide;
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    const bitmap = bitmapRef.current;
    if (!ctx || !bitmap) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const box = band ?? (drop ? { x0: drop.x0, y0: drop.y0, x1: drop.x1, y1: drop.y1 } : null);
    if (!box) return;
    const sx = width / source.width;
    const sy = height / source.height;
    const left = Math.min(box.x0, box.x1) * sx;
    const top = Math.min(box.y0, box.y1) * sy;
    const boxWidth = (Math.abs(box.x1 - box.x0) + 1) * sx;
    const boxHeight = (Math.abs(box.y1 - box.y0) + 1) * sy;
    ctx.strokeStyle = "#b8432f";
    ctx.lineWidth = 2;
    ctx.strokeRect(left + 1, top + 1, Math.max(1, boxWidth - 2), Math.max(1, boxHeight - 2));
  }, [source, eyedropper, drop]);

  useEffect(() => {
    paintSource();
  }, [paintSource]);

  function cellFromEvent(event: ReactPointerEvent<HTMLCanvasElement>): CellPoint | null {
    if (!pattern) return null;
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) * canvas.width) / rect.width;
    const y = ((event.clientY - rect.top) * canvas.height) / rect.height;
    return cellFromOffset(x, y, cellSize, axisSizeFor(cellSize), pattern.width, pattern.height);
  }

  function revealSelection(next: CellMask, clientX: number, clientY: number) {
    if (maskCount(next) === 0) {
      setSelection(null);
      setPicker(null);
      return;
    }
    setSelection(next);
    setPicker(placePicker(clientX, clientY));
  }

  function toggleStroke(drag: DragState, cell: CellPoint) {
    drag.last = togglePath(drag.live, drag.width, drag.last, cell);
    return new Uint32Array(drag.live);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!pattern || event.button !== 0) return;
    const cell = cellFromEvent(event);
    if (!cell) return;
    const count = pattern.width * pattern.height;
    const base = selection ? new Uint32Array(selection) : createMask(count);
    const live = new Uint32Array(base);
    maskXor(live, cell.row * pattern.width + cell.col);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, width: pattern.width, base, live, last: cell };
    setSelection(new Uint32Array(live));
    setPicker(null);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const cell = cellFromEvent(event);
    if (!cell || (cell.col === drag.last.col && cell.row === drag.last.row)) return;
    setSelection(toggleStroke(drag, cell));
  }

  function onPointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    const cell = cellFromEvent(event);
    const next = cell && (cell.col !== drag.last.col || cell.row !== drag.last.row)
      ? toggleStroke(drag, cell)
      : new Uint32Array(drag.live);
    revealSelection(next, event.clientX, event.clientY);
  }

  function onPointerCancel() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (maskCount(drag.base) === 0) {
      setSelection(null);
      return;
    }
    setSelection(drag.base);
  }

  function applyColor(colorIndex: number) {
    if (!pattern || !selection || maskCount(selection) === 0) return;
    setEdited(paintMask(pattern, selection, colorIndex, palette.colors.length));
  }

  function mirrorImage() {
    if (!source) return;
    const image = flipHorizontal(source.image);
    setDrop(null);
    setSource({ ...source, image, background: cornerColor(image) });
  }

  function sourcePoint(event: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } | null {
    if (!source) return null;
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1 || canvas.width < 1 || canvas.height < 1) return null;
    const px = ((event.clientX - rect.left) * canvas.width) / rect.width;
    const py = ((event.clientY - rect.top) * canvas.height) / rect.height;
    return {
      x: Math.min(source.width - 1, Math.max(0, Math.floor((px * source.width) / canvas.width))),
      y: Math.min(source.height - 1, Math.max(0, Math.floor((py * source.height) / canvas.height))),
    };
  }

  function commitSample(x0: number, y0: number, x1: number, y1: number) {
    if (!source) return;
    const pixel = sampleArea(source.image, x0, y0, x1, y1);
    setDrop({
      x0,
      y0,
      x1,
      y1,
      rgb: pixel.a < 128 ? null : { r: pixel.r, g: pixel.g, b: pixel.b },
    });
  }

  function onSourceDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) return;
    const point = sourcePoint(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    sourceDragRef.current = { pointerId: event.pointerId, x: point.x, y: point.y };
    paintSource({ x0: point.x, y0: point.y, x1: point.x, y1: point.y });
  }

  function onSourceMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = sourceDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = sourcePoint(event);
    if (!point) return;
    paintSource({ x0: drag.x, y0: drag.y, x1: point.x, y1: point.y });
  }

  function onSourceUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = sourceDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    sourceDragRef.current = null;
    const point = sourcePoint(event) ?? { x: drag.x, y: drag.y };
    commitSample(drag.x, drag.y, point.x, point.y);
  }

  function onSourceCancel() {
    sourceDragRef.current = null;
    paintSource();
  }

  async function loadFile(file: File) {
    setError("");
    if (!file.type.startsWith("image/")) {
      setError("请上传 PNG、JPG 或 WebP 图片。");
      return;
    }
    try {
      const image = await readImage(file);
      if (image.naturalWidth < 1 || image.naturalHeight < 1) {
        setError("这张图片没有可用的像素。");
        return;
      }
      const raster = imageToRaster(image);
      setSource({
        name: file.name,
        width: image.naturalWidth,
        height: image.naturalHeight,
        image: raster,
        background: cornerColor(raster),
        large: isLargeImage(image.naturalWidth),
      });
      setBeadWidth(Math.min(MAX_BEADS, defaultBeadWidth(image.naturalWidth)));
      setDrop(null);
    } catch {
      setError("这张图片无法读取，请换一张 PNG、JPG 或 WebP。");
    }
  }

  async function onExportPng() {
    if (!pattern || !source || pattern.totalBeads === 0) return;
    setBusy("png");
    setError("");
    try {
      await downloadPng(
        pattern,
        palette,
        { title: fileStem(source.name), paletteName: palette.name },
        `${fileStem(source.name)}-${palette.brand}.png`,
      );
    } catch {
      setError("PNG 导出失败，请缩小豆阵后再试。");
    } finally {
      setBusy(null);
    }
  }

  function onExportPdf() {
    if (!pattern || !source || pattern.totalBeads === 0) return;
    setBusy("pdf");
    setError("");
    window.setTimeout(() => {
      void (async () => {
        try {
          const { exportPatternPdf } = await import("./lib/exportPdf.ts");
          exportPatternPdf(
            pattern,
            palette,
            { title: fileStem(source.name), paletteName: palette.name },
            boardSize,
            `${fileStem(source.name)}-${palette.brand}.pdf`,
          );
        } catch {
          setError("PDF 导出失败，请缩小豆阵后再试。");
        } finally {
          setBusy(null);
        }
      })();
    }, 30);
  }

  const canExport = Boolean(pattern && pattern.totalBeads > 0 && !busy);

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="brand">拼豆图纸</p>
          <h1>上传像素图，匹配真实豆色，下载可打印图纸</h1>
        </div>
        <p className="privacy">图片只在这台浏览器里处理，不会上传。</p>
      </header>

      <main className="workspace">
        <section className="panel controls">
          <label
            className={dragOver ? "dropzone drag" : "dropzone"}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              const file = event.dataTransfer.files[0];
              if (file) void loadFile(file);
            }}
          >
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void loadFile(file);
              }}
            />
            <strong>{source ? source.name : "点击或拖入像素图"}</strong>
            <span>
              {source ? `${source.width} × ${source.height} 像素` : "PNG、JPG、WebP"}
            </span>
          </label>

          {source ? (
            <p className="hint">
              {source.large
                ? "图片较大，已先按 64 豆宽取主色。放大过的像素图请改成实际豆数。"
                : "已按原图像素宽度取主色。放大过的像素图请把宽度改成实际豆数。"}
            </p>
          ) : null}

          <label className="field">
            <span>品牌</span>
            <select
              value={brand.id}
              onChange={(event) => {
                const next = findBrand(event.target.value);
                setBrandId(next.id);
                setPaletteId(defaultPalette(next).id);
              }}
            >
              {brands.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>色号范围</span>
            <select value={palette.id} onChange={(event) => setPaletteId(event.target.value)}>
              {brand.ranges.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name.replace(`${brand.name} `, "")}（{item.colors.length} 色）
                </option>
              ))}
            </select>
          </label>
          <p className="hint">{palette.note}</p>
          <div className="swatch-row" aria-label="当前色盘">
            {palette.colors.map((color) => (
              <i key={color.code} style={{ background: color.hex }} title={`${color.code} ${color.nameZh}`} />
            ))}
          </div>

          <label className="field">
            <span>豆阵宽度</span>
            <input
              type="number"
              min={1}
              max={MAX_BEADS}
              value={beadWidth}
              onChange={(event) => setBeadWidth(clampNumber(event.target.value, 1, MAX_BEADS))}
            />
          </label>
          <p className="hint">高度按原图比例自动计算{pattern ? `：${pattern.height} 豆` : "。"}</p>

          <label className="check">
            <input
              type="checkbox"
              checked={removeBackground}
              onChange={(event) => setRemoveBackground(event.target.checked)}
            />
            <span>把背景当空位</span>
            {source ? (
              <i className="mini-swatch" style={{ background: rgbToHex(source.background) }} title="四角背景色" />
            ) : null}
          </label>
          <label className="field">
            <span>背景色差阈值 {bgThreshold}</span>
            <input
              type="range"
              min={0}
              max={40}
              value={bgThreshold}
              disabled={!removeBackground}
              onChange={(event) => setBgThreshold(Number(event.target.value))}
            />
          </label>
          <p className="hint">背景色取图片四个角里出现最多的颜色。阈值越大，越多接近背景的格子会被挖空。</p>

          <label className="field">
            <span>拼板分页（豆）</span>
            <input
              type="number"
              min={0}
              max={80}
              value={boardSize}
              onChange={(event) => setBoardSize(clampNumber(event.target.value, 0, 80))}
            />
          </label>
          <p className="hint">
            PDF 为 A4 横向，每格约 8mm。每页最多 {tileWidth} × {tileHeight} 豆
            {boardSize > 0 ? `（拼板上限 ${boardSize}）` : "（只按纸张排版）"}
            {pattern ? `，约 ${tiles.length} 页。` : "。"}
          </p>

          {error ? <p className="error">{error}</p> : null}

          <div className="actions">
            <button type="button" className="primary" disabled={!canExport} onClick={() => void onExportPng()}>
              {busy === "png" ? "正在生成 PNG…" : "下载 PNG"}
            </button>
            <button type="button" className="secondary" disabled={!canExport} onClick={onExportPdf}>
              {busy === "pdf" ? "正在生成 PDF…" : "下载 PDF"}
            </button>
          </div>
        </section>

        <section className="panel preview">
          <div className="preview-bar">
            <strong>{pattern ? `${pattern.width} × ${pattern.height} 豆` : "图纸预览"}</strong>
            <label>
              缩放
              <input
                type="range"
                min={12}
                max={48}
                value={cellSize}
                onChange={(event) => setCellSize(Number(event.target.value))}
              />
              <span>{cellSize}px</span>
            </label>
            <span className="muted">
              {pattern ? (labelMode === "code" ? "格内标注：色号" : "格内标注：符号") : "等待图片"}
            </span>
            {pattern ? (
              <button
                type="button"
                className={guides ? "guide on" : "guide"}
                aria-pressed={guides}
                onClick={() => setGuides((on) => !on)}
              >
                辅助网格
              </button>
            ) : null}
            {pattern ? (
              <button type="button" className="mirror" onClick={mirrorImage}>
                左右镜像
              </button>
            ) : null}
            {pattern ? (
              <button
                type="button"
                className={eyedropper ? "eyedrop on" : "eyedrop"}
                aria-pressed={eyedropper}
                onClick={() => setEyedropper((on) => !on)}
              >
                吸色
              </button>
            ) : null}
            {pattern ? <span className="muted">沿轨迹选择，松开后保持。同一笔里每划过一次都会切换这一格</span> : null}
          </div>
          {pattern ? (
            <div className="layers">
              <LayerControl
                name="绘制层"
                visible={drawVisible}
                opacity={drawOpacity}
                onVisible={setDrawVisible}
                onOpacity={setDrawOpacity}
              />
              <LayerControl
                name="板子层"
                visible={boardVisible}
                opacity={boardOpacity}
                onVisible={setBoardVisible}
                onOpacity={setBoardOpacity}
              />
              <p className="hint">板子层是坐标轴、单元格和辅助线。</p>
            </div>
          ) : null}
          {pattern && eyedropper && source ? (
            <div className="eyedropper">
              <canvas
                ref={sourceCanvasRef}
                aria-label="原图吸色，点击或拖动选取像素"
                onPointerDown={onSourceDown}
                onPointerMove={onSourceMove}
                onPointerUp={onSourceUp}
                onPointerCancel={onSourceCancel}
              />
              <DropMatches
                drop={drop}
                matches={matches}
                palette={palette}
                canPaint={Boolean(selection && maskCount(selection) > 0)}
                onPick={applyColor}
              />
            </div>
          ) : null}
          <div className="canvas-wrap">
            {pattern ? (
              <canvas
                ref={canvasRef}
                aria-label="拼豆图纸预览。沿轨迹拖动选择，再次点中或划过可取消"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
              />
            ) : (
              <div className="empty">
                <p>先上传一张像素图。</p>
                <p>小图会按 1 像素 1 豆处理。放大过的像素图，把左侧宽度改成实际豆数。</p>
              </div>
            )}
          </div>
        </section>

        <section className="panel legend">
          <div className="legend-head">
            <h2>用豆统计</h2>
            <div className="sorts">
              <button type="button" className={sortKey === "count" ? "on" : ""} onClick={() => setSortKey("count")}>
                按颗数
              </button>
              <button type="button" className={sortKey === "code" ? "on" : ""} onClick={() => setSortKey("code")}>
                按色号
              </button>
            </div>
          </div>
          <p className="hint">
            {pattern
              ? `共 ${pattern.totalBeads} 颗，${pattern.usage.length} 色。`
              : "匹配完成后，这里会列出色号和颗数。"}
          </p>
          <ul>
            {legend.map((item) => {
              const color = palette.colors[item.colorIndex];
              return (
                <li key={color.code}>
                  <span className="swatch" style={{ background: color.hex }} />
                  <span className="sym">{item.symbol}</span>
                  <span className="code" title={color.name}>
                    {color.code}
                  </span>
                  <span className="name">{color.nameZh}</span>
                  <span className="count">{item.count}</span>
                </li>
              );
            })}
          </ul>
          <p className="disclaimer">屏幕色仅供对照，实物以豆子为准。MARD 按零售盒装色号，其余品牌按公开色卡。</p>
        </section>
      </main>
      {picker && selection && pattern && trackedMatch === matched ? (
        <div className="picker" style={{ left: picker.left, top: picker.top }}>
          <ColorPicker
            palette={palette}
            label={selectionLabel(pattern.width, selection)}
            count={maskCount(selection)}
            current={maskColor(pattern, selection)}
            onPick={applyColor}
            onClear={clearSelection}
          />
        </div>
      ) : null}
    </div>
  );
}

function DropMatches(props: {
  drop: DropSample | null;
  matches: ColorMatch[];
  palette: Palette;
  canPaint: boolean;
  onPick: (colorIndex: number) => void;
}) {
  const sample = props.drop?.rgb;
  const width = props.drop ? Math.abs(props.drop.x1 - props.drop.x0) + 1 : 0;
  const height = props.drop ? Math.abs(props.drop.y1 - props.drop.y0) + 1 : 0;
  let place = "";
  if (props.drop && width === 1 && height === 1) place = `像素（${props.drop.x0 + 1}, ${props.drop.y0 + 1}）`;
  if (props.drop && (width !== 1 || height !== 1)) place = `区域 ${width} × ${height}`;
  return (
    <div className="drop-result">
      <p className="hint">在原图上点一个像素，或拖出一块区域。下面是当前色盘里最接近的三个色号。</p>
      {props.drop && sample ? (
        <>
          <p className="drop-sample">
            <span className="swatch" style={{ background: rgbToHex(sample) }} />
            <span>{place}</span>
            <span>{rgbToHex(sample)}</span>
          </p>
          <div className="drop-matches">
            {props.matches.map((match, rank) => {
              const color = props.palette.colors[match.colorIndex];
              return (
                <button
                  key={match.colorIndex}
                  type="button"
                  disabled={!props.canPaint}
                  onClick={() => props.onPick(match.colorIndex)}
                >
                  <span className="swatch" style={{ background: color.hex }} />
                  <span>
                    {rank + 1}. {color.code}
                  </span>
                  <span className="name">{color.nameZh}</span>
                  <span className="delta">ΔE {match.distance.toFixed(1)}</span>
                </button>
              );
            })}
          </div>
          <p className="hint">
            {props.canPaint ? "点一个色号，涂到当前选中的格子。" : "在图纸上选中格子后，再点色号涂上。"}
          </p>
        </>
      ) : null}
      {props.drop && !sample ? <p className="hint">这块区域以透明为主，没有可匹配的颜色。</p> : null}
    </div>
  );
}

function LayerControl(props: {
  name: string;
  visible: boolean;
  opacity: number;
  onVisible: (visible: boolean) => void;
  onOpacity: (opacity: number) => void;
}) {
  return (
    <div className="layer">
      <label>
        <input
          type="checkbox"
          checked={props.visible}
          onChange={(event) => props.onVisible(event.target.checked)}
        />
        <strong>{props.name}</strong>
        <span>可见</span>
      </label>
      <label>
        不透明度
        <input
          type="range"
          min={0}
          max={100}
          value={props.opacity}
          aria-label={`${props.name}不透明度`}
          onChange={(event) => props.onOpacity(Number(event.target.value))}
        />
        <input
          type="number"
          min={0}
          max={100}
          value={props.opacity}
          aria-label={`${props.name}不透明度数值`}
          onChange={(event) => props.onOpacity(clampNumber(event.target.value, 0, 100))}
        />
        <span>%</span>
      </label>
    </div>
  );
}

function selectionLabel(width: number, selection: CellMask): string {
  const sole = maskSoleIndex(selection);
  if (sole === null) return `已选 ${maskCount(selection)} 格`;
  return `第 ${Math.floor(sole / width) + 1} 行，第 ${(sole % width) + 1} 列`;
}

function ColorPicker(props: {
  palette: Palette;
  label: string;
  count: number;
  current: number | "mixed";
  onPick: (colorIndex: number) => void;
  onClear: () => void;
}) {
  return (
    <div role="dialog" aria-label={props.count === 1 ? "修改这一格的色号" : "修改选中格子的色号"}>
      <p>{props.label}</p>
      <div className="picker-grid">
        {props.palette.colors.map((color, index) => (
          <button
            key={color.code}
            type="button"
            className={props.current === index ? "on" : ""}
            onClick={() => props.onPick(index)}
          >
            <i style={{ background: color.hex }} />
            <span>{color.code}</span>
            <span className="picker-name">{color.nameZh}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className={props.current === -1 ? "empty on" : "empty"}
        onClick={() => props.onPick(-1)}
      >
        改为空位
      </button>
      <button type="button" className="cancel" onClick={props.onClear}>
        取消选择
      </button>
    </div>
  );
}
