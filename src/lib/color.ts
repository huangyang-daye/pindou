export type Rgb = { r: number; g: number; b: number };

export type Lab = { l: number; a: number; b: number };

export function hexToRgb(hex: string): Rgb {
  const value = hex.replace("#", "");
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

export function rgbToHex(rgb: Rgb): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`.toUpperCase();
}

function srgbToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function labPivot(t: number): number {
  const delta = 6 / 29;
  return t > delta ** 3 ? Math.cbrt(t) : t / (3 * delta * delta) + 4 / 29;
}

export function rgbToLab(rgb: Rgb): Lab {
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) * 100;
  const y = (r * 0.2126729 + g * 0.7151522 + b * 0.072175) * 100;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) * 100;
  const fx = labPivot(x / 95.047);
  const fy = labPivot(y / 100);
  const fz = labPivot(z / 108.883);
  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

function degrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

function hue(a: number, b: number, chroma: number): number {
  if (chroma < 1e-8) return 0;
  return (degrees(Math.atan2(b, a)) + 360) % 360;
}

/** CIEDE2000 色差。相同颜色约为 0，数值越大差得越远。 */
export function deltaE00(first: Lab, second: Lab): number {
  const kL = 1;
  const kC = 1;
  const kH = 1;
  const c1 = Math.hypot(first.a, first.b);
  const c2 = Math.hypot(second.a, second.b);
  const cBar = (c1 + c2) / 2;
  const cBar7 = cBar ** 7;
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + 25 ** 7)));
  const a1 = (1 + g) * first.a;
  const a2 = (1 + g) * second.a;
  const c1p = Math.hypot(a1, first.b);
  const c2p = Math.hypot(a2, second.b);
  const h1 = hue(a1, first.b, c1p);
  const h2 = hue(a2, second.b, c2p);

  let dh = 0;
  if (c1p * c2p !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }

  const dL = second.l - first.l;
  const dC = c2p - c1p;
  const dH = 2 * Math.sqrt(c1p * c2p) * Math.sin(radians(dh / 2));
  const lBar = (first.l + second.l) / 2;
  const cBarP = (c1p + c2p) / 2;

  let hBar = h1 + h2;
  if (c1p * c2p !== 0) {
    if (Math.abs(h1 - h2) > 180) {
      hBar = h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
    } else {
      hBar = (h1 + h2) / 2;
    }
  }

  const t =
    1 -
    0.17 * Math.cos(radians(hBar - 30)) +
    0.24 * Math.cos(radians(2 * hBar)) +
    0.32 * Math.cos(radians(3 * hBar + 6)) -
    0.2 * Math.cos(radians(4 * hBar - 63));
  const deltaTheta = 30 * Math.exp(-(((hBar - 275) / 25) ** 2));
  const cBarP7 = cBarP ** 7;
  const rc = 2 * Math.sqrt(cBarP7 / (cBarP7 + 25 ** 7));
  const sL = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sC = 1 + 0.045 * cBarP;
  const sH = 1 + 0.015 * cBarP * t;
  const rT = -Math.sin(radians(2 * deltaTheta)) * rc;
  const termL = dL / (kL * sL);
  const termC = dC / (kC * sC);
  const termH = dH / (kH * sH);
  return Math.sqrt(termL ** 2 + termC ** 2 + termH ** 2 + rT * termC * termH);
}

export function textInk(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (r * 299 + g * 587 + b * 114) / 1000;
  return luminance > 160 ? "#1c1917" : "#ffffff";
}
