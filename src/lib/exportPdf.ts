import { jsPDF } from "jspdf";
import type { Pattern } from "./match.ts";
import { planTiles, renderPdfPage } from "./renderPattern.ts";
import type { SheetMeta } from "./renderPattern.ts";
import type { Palette } from "../palettes/index.ts";

export function exportPatternPdf(
  pattern: Pattern,
  palette: Palette,
  meta: SheetMeta,
  boardSize: number,
  filename: string,
) {
  const tiles = planTiles(pattern.width, pattern.height, boardSize, pattern.usage.length);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  tiles.forEach((region, index) => {
    if (index > 0) doc.addPage();
    const canvas = renderPdfPage({
      pattern,
      palette,
      region,
      meta,
      pageIndex: index,
      pageCount: tiles.length,
    });
    doc.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 297, 210);
  });
  doc.save(filename);
}
