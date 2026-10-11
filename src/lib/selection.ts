export type CellMask = Uint32Array;

export type CellPoint = { col: number; row: number };

export function createMask(cellCount: number): CellMask {
  return new Uint32Array(Math.ceil(Math.max(cellCount, 1) / 32));
}

export function maskHas(mask: CellMask, index: number): boolean {
  return (mask[index >>> 5] & (1 << (index & 31))) !== 0;
}

export function maskXor(mask: CellMask, index: number) {
  mask[index >>> 5] ^= 1 << (index & 31);
}

export function maskXorAll(base: CellMask, stroke: CellMask): CellMask {
  const next = new Uint32Array(Math.max(base.length, stroke.length));
  for (let i = 0; i < next.length; i += 1) next[i] = (base[i] ?? 0) ^ (stroke[i] ?? 0);
  return next;
}

export function maskCount(mask: CellMask): number {
  let count = 0;
  for (const word of mask) {
    let bits = word;
    while (bits) {
      bits &= bits - 1;
      count += 1;
    }
  }
  return count;
}

export function maskForEach(mask: CellMask, visit: (index: number) => void) {
  for (let wordIndex = 0; wordIndex < mask.length; wordIndex += 1) {
    let bits = mask[wordIndex];
    while (bits) {
      const lowest = bits & -bits;
      const bit = 31 - Math.clz32(lowest);
      visit(wordIndex * 32 + bit);
      bits &= bits - 1;
    }
  }
}

export function maskSoleIndex(mask: CellMask): number | null {
  let found = -1;
  let count = 0;
  maskForEach(mask, (index) => {
    count += 1;
    found = index;
  });
  return count === 1 ? found : null;
}

/** 从 from 走到 to，起点格子保持不动，之后每进入一格就异或一次。同一笔里来回划过会再次翻转。 */
export function togglePath(mask: CellMask, width: number, from: CellPoint, to: CellPoint): CellPoint {
  let skippedStart = false;
  forEachCellOnLine(width, from, to, (index) => {
    if (!skippedStart) {
      skippedStart = true;
      return;
    }
    maskXor(mask, index);
  });
  return to;
}

/** 把线段经过的格子都走到，斜向时补上拐角，避免轨迹断开。 */
export function forEachCellOnLine(
  width: number,
  from: CellPoint,
  to: CellPoint,
  visit: (index: number) => void,
) {
  let x = from.col;
  let y = from.row;
  const dx = Math.abs(to.col - x);
  const dy = Math.abs(to.row - y);
  const sx = x < to.col ? 1 : -1;
  const sy = y < to.row ? 1 : -1;
  let err = dx - dy;
  visit(y * width + x);
  while (x !== to.col || y !== to.row) {
    const doubled = err * 2;
    const stepX = doubled > -dy;
    const stepY = doubled < dx;
    if (stepX) {
      err -= dy;
      x += sx;
    }
    if (stepY) {
      err += dx;
      y += sy;
    }
    if (!stepX && !stepY) break;
    if (stepX && stepY) visit((y - sy) * width + x);
    visit(y * width + x);
  }
}
