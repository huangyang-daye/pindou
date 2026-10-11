import type { Pattern } from "./match.ts";
import { renderFullSheet } from "./renderPattern.ts";
import type { SheetMeta } from "./renderPattern.ts";
import type { Palette } from "../palettes/index.ts";

export function downloadPng(
  pattern: Pattern,
  palette: Palette,
  meta: SheetMeta,
  filename: string,
): Promise<void> {
  const canvas = renderFullSheet(pattern, palette, meta);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve();
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      resolve();
    });
  });
}
