import sharp from 'sharp';
import type { Event, Offer, Platform } from '@genia/core';
import { DISCLOSURE, localeForOrigin, type Locale } from './copy.js';

/** Instagram feed is square; Facebook link posts read best at 1.91:1. */
export const DIMENSIONS: Record<Platform, { width: number; height: number }> = {
  instagram: { width: 1080, height: 1080 },
  facebook: { width: 1200, height: 630 },
};

const PALETTE = {
  backgroundFrom: '#0f2942',
  backgroundTo: '#1f4e79',
  accent: '#ff9f1c',
  text: '#ffffff',
  muted: '#c7d6e5',
};

/**
 * Event titles routinely contain `&` ("Rock & Roll"), apostrophes and quotes.
 * Interpolating those into SVG unescaped produces invalid XML and sharp fails
 * to render — so every interpolated value goes through here.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Average glyph width as a fraction of font size, for bold DejaVu Sans. Bold
 * faces run wider than the 0.55 a regular weight suggests; underestimating it
 * pushed long titles past the right margin.
 */
const GLYPH_RATIO = 0.62;

/**
 * SVG has no text wrapping, so lines are broken here. Width is estimated from
 * an average glyph ratio rather than real font metrics, so `layoutTitle` also
 * scales the font down until the longest line provably fits — the estimate
 * decides where lines break, it does not decide whether they overflow.
 */
export function wrapText(text: string, fontSize: number, maxWidth: number, maxLines: number): string[] {
  const averageGlyphWidth = fontSize * GLYPH_RATIO;
  const charsPerLine = Math.max(8, Math.floor(maxWidth / averageGlyphWidth));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= charsPerLine) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);

  if (lines.length === 0) return [''];

  // Signal truncation rather than silently dropping part of the title.
  const consumed = lines.join(' ').split(/\s+/).length;
  if (consumed < words.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1]}…`;
  }

  return lines;
}

export interface TitleLayout {
  lines: string[];
  fontSize: number;
}

/** Type never shrinks below this fraction of the base size — legibility floor. */
export const MIN_TITLE_SCALE = 0.6;

/**
 * Wraps the title, then shrinks the type until the widest line fits inside
 * `maxWidth`. A fixed font size cannot guarantee that, because the width is
 * estimated rather than measured.
 *
 * Shrinking alone is not enough either: a single unbreakable word can still be
 * too wide at the legibility floor (an unbroken 34-character word overflowed a
 * 1080px card even at 60%). When the floor binds, the line is hard-truncated
 * with an ellipsis, so "fits the card" holds unconditionally.
 */
export function layoutTitle(
  title: string,
  baseFontSize: number,
  maxWidth: number,
  maxLines: number
): TitleLayout {
  const lines = wrapText(title, baseFontSize, maxWidth, maxLines);
  const longest = Math.max(...lines.map((line) => line.length));
  const neededFontSize = maxWidth / (longest * GLYPH_RATIO);

  if (neededFontSize >= baseFontSize) return { lines, fontSize: baseFontSize };

  const floor = Math.floor(baseFontSize * MIN_TITLE_SCALE);
  const fontSize = Math.max(floor, Math.floor(neededFontSize));

  const maxChars = Math.floor(maxWidth / (fontSize * GLYPH_RATIO));
  const fitted = lines.map((line) =>
    line.length <= maxChars ? line : `${line.slice(0, Math.max(1, maxChars - 1))}…`
  );

  return { lines: fitted, fontSize };
}

export interface ImageInput {
  event: Pick<Event, 'title' | 'city' | 'startsAt'>;
  offer: Pick<Offer, 'origin'>;
  platform: Platform;
  locale?: Locale;
}

function formatDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * Builds the card as SVG. The "Publicité" badge is part of this template — the
 * same rule as the copy: disclosure is generated, never added by hand.
 */
export function buildSvg(input: ImageInput): string {
  const locale = input.locale ?? localeForOrigin(input.offer.origin);
  const { width, height } = DIMENSIONS[input.platform];
  const square = input.platform === 'instagram';

  const margin = Math.round(width * 0.075);
  const maxTextWidth = width - margin * 2;
  const { lines: titleLines, fontSize: titleSize } = layoutTitle(
    input.event.title,
    square ? 78 : 62,
    maxTextWidth,
    3
  );

  const cityLabel = escapeXml(input.event.city.toUpperCase());
  const dateLabel = escapeXml(formatDate(input.event.startsAt, locale));
  const ctaLabel = locale === 'fr-CA' ? 'Hôtels sur Expedia' : 'Hotels on Expedia';

  // Anchored from the bottom so a one-line and a three-line title produce the
  // same spacing, instead of leaving a dead zone under short titles.
  const lineHeight = titleSize * 1.18;
  const ctaY = height - margin;
  const dateY = ctaY - (square ? 108 : 78);
  const cityY = dateY - 48;
  const titleLastY = cityY - (square ? 76 : 60);
  const titleFirstY = titleLastY - lineHeight * (titleLines.length - 1);

  const titleTspans = titleLines
    .map((line, i) => `<tspan x="${margin}" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`)
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${PALETTE.backgroundFrom}"/>
      <stop offset="100%" stop-color="${PALETTE.backgroundTo}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${width}" height="${Math.round(height * 0.012)}" fill="${PALETTE.accent}"/>

  <g font-family="DejaVu Sans, Helvetica, Arial, sans-serif">
    <rect x="${margin}" y="${margin}" rx="8" width="${DISCLOSURE[locale].length * 15 + 34}" height="46" fill="${PALETTE.accent}"/>
    <text x="${margin + 17}" y="${margin + 31}" font-size="24" font-weight="700" fill="#241a04">${escapeXml(
      DISCLOSURE[locale]
    )}</text>

    <text x="${margin}" y="${titleFirstY}" font-size="${titleSize}" font-weight="700" fill="${PALETTE.text}">${titleTspans}</text>

    <text x="${margin}" y="${cityY}" font-size="34" font-weight="600" fill="${PALETTE.accent}" letter-spacing="3">${cityLabel}</text>
    <text x="${margin}" y="${dateY}" font-size="30" fill="${PALETTE.muted}">${dateLabel}</text>

    <text x="${margin}" y="${ctaY}" font-size="32" font-weight="600" fill="${PALETTE.text}">${escapeXml(ctaLabel)}</text>
  </g>
</svg>`;
}

/** Renders the card to a PNG buffer — the format both Meta endpoints accept. */
export async function renderImage(input: ImageInput): Promise<Buffer> {
  return sharp(Buffer.from(buildSvg(input))).png().toBuffer();
}
