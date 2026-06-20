import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  checkSharePathDistribution,
  resolveSharePath,
  truncateServiceType,
  validateSharePathCoherence,
  SHARE_SERVICE_TYPE_MAX_LENGTH,
} from '../src/lib/sharePaths.ts';
import { estimateShareSlug } from '../src/lib/shareSlug.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Register fonts
const fontsDir = join(__dirname, 'fonts');
GlobalFonts.registerFromPath(join(fontsDir, 'Inter-Regular.ttf'), 'Inter');
GlobalFonts.registerFromPath(join(fontsDir, 'Inter-Bold.ttf'), 'Inter Bold');
GlobalFonts.registerFromPath(join(fontsDir, 'JetBrainsMono-Bold.ttf'), 'JetBrains Mono Bold');

const distDir = join(__dirname, '..', 'dist');
const manifestPath = join(distDir, 'data', 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

const siteUrl = process.env.SITE_URL || 'https://username.github.io/311-dc';
const spaUrl = siteUrl;

const shareDir = join(distDir, 'share');
const ogDir = join(shareDir, 'og');
mkdirSync(ogDir, { recursive: true });

const favicon = await loadImage(join(__dirname, '..', 'public', 'favicon.svg'));
const FOOTER_ICON_SIZE = 20;
const CATEGORICAL_COLORS = ['#3b6ea5', '#e85d04', '#6a994e', '#9d4edd', '#e63946'];
const MAX_SERVICE_TYPE_LENGTH = SHARE_SERVICE_TYPE_MAX_LENGTH;

const CANVAS_WIDTH = 1200;
const MARGIN_X = 80;
const CONTENT_WIDTH = CANVAS_WIDTH - MARGIN_X * 2;
const CONTENT_RIGHT = MARGIN_X + CONTENT_WIDTH;
const COLOR_TEXT_MUTED = '#9ca3af';
const COLOR_TEXT_DIM = '#6b7280';
const COLOR_TEXT_WHITE = '#ffffff';

const estimates = manifest.estimates || [];
const dicts = manifest.dictionaries;

const citywideByType = {};
for (const row of estimates) {
  if (row.w === null) citywideByType[row.st] = row;
}

function rowToEstimate(row) {
  return {
    n: row.n,
    p25: row.p25,
    p50: row.p50,
    p75: row.p75,
    p90: row.p90,
    p95: row.p95,
    sla_days: row.sla_days,
    pct_met_sla: row.pct_met_sla,
  };
}

function truncateServiceTypeForHeader(name) {
  return truncateServiceType(name, MAX_SERVICE_TYPE_LENGTH);
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines = [];
  let line = words[0];

  for (let i = 1; i < words.length; i += 1) {
    const candidate = `${line} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = words[i];
  }
  lines.push(line);
  return lines;
}

function leadTokens(parts) {
  const tokens = [];
  const pushWords = (text, color) => {
    for (const word of text.split(/\s+/).filter(Boolean)) {
      tokens.push({ word, color });
    }
  };

  pushWords(parts.beforeType, COLOR_TEXT_MUTED);
  pushWords(parts.serviceType, COLOR_TEXT_WHITE);
  pushWords(parts.afterType, COLOR_TEXT_MUTED);
  return tokens;
}

function measureColoredLead(ctx, parts, maxWidth, lineHeight, font) {
  const tokens = leadTokens(parts);
  if (tokens.length === 0) {
    return { lastBaseline: 0, height: 0, empty: true };
  }

  ctx.font = font;
  const extents = measureFontExtents(ctx, font);
  let lineX = 0;
  let lineY = extents.ascent;
  let lines = 1;

  for (const { word } of tokens) {
    const prefix = lineX > 0 ? ' ' : '';
    const chunk = `${prefix}${word}`;
    const chunkWidth = ctx.measureText(chunk).width;

    if (lineX > 0 && lineX + chunkWidth > maxWidth) {
      lines += 1;
      lineY += lineHeight;
      lineX = ctx.measureText(word).width;
      continue;
    }

    lineX += chunkWidth;
  }

  const height = extents.ascent + (lines - 1) * lineHeight + extents.descent;
  return { lastBaseline: lineY, height, empty: false };
}

function drawColoredLead(ctx, parts, x, firstBaseline, maxWidth, lineHeight, font) {
  const tokens = leadTokens(parts);
  if (tokens.length === 0) return firstBaseline;

  ctx.font = font;
  let lineX = x;
  let lineY = firstBaseline;

  for (const { word, color } of tokens) {
    const prefix = lineX > x ? ' ' : '';
    const chunk = `${prefix}${word}`;
    const chunkWidth = ctx.measureText(chunk).width;

    if (lineX > x && lineX + chunkWidth > x + maxWidth) {
      lineY += lineHeight;
      lineX = x;
      ctx.fillStyle = color;
      ctx.fillText(word, lineX, lineY);
      lineX += ctx.measureText(word).width;
      continue;
    }

    ctx.fillStyle = color;
    ctx.fillText(chunk, lineX, lineY);
    lineX += chunkWidth;
  }

  return lineY;
}

function drawHeader(ctx, serviceType, ward) {
  ctx.fillStyle = COLOR_TEXT_MUTED;
  ctx.font = '32px "Inter Bold"';
  ctx.textAlign = 'left';
  const typeText = truncateServiceTypeForHeader(serviceType);
  ctx.fillText(`311: ${typeText}`, MARGIN_X, 80);

  ctx.font = '26px Inter';
  ctx.textAlign = 'right';
  ctx.fillText(ward || 'Citywide', CONTENT_RIGHT, 80);
  ctx.textAlign = 'left';

  ctx.fillStyle = CATEGORICAL_COLORS[0];
  ctx.fillRect(MARGIN_X, 110, CONTENT_WIDTH, 3);
}

function fitFontSize(ctx, text, fontTemplate, startSize, minSize, maxWidth) {
  for (let size = startSize; size >= minSize; size -= 4) {
    ctx.font = fontTemplate(size);
    if (ctx.measureText(text).width <= maxWidth) return size;
  }
  return minSize;
}

const LEAD_FONT_SIZE = 30;
const SUPPORT_FONT_SIZE = 26;
const GAP_RATIO = 0.28;
const CANVAS_HEIGHT = 630;
const HERO_CENTER_Y = CANVAS_HEIGHT * 0.48;
const MIN_LEAD_TOP = 118;
const MAX_SUPPORT_BOTTOM = 535;
const PUNCH_START_SIZE = 96;
const PUNCH_MIN_SIZE = 48;

function measureFontExtents(ctx, font, sampleText = 'Hg') {
  ctx.font = font;
  const metrics = ctx.measureText(sampleText);
  return {
    ascent: metrics.actualBoundingBoxAscent || metrics.fontBoundingBoxAscent,
    descent: Math.max(metrics.actualBoundingBoxDescent, 0)
      || metrics.fontBoundingBoxDescent * 0.3,
  };
}

function measureTextExtents(ctx, font, text) {
  ctx.font = font;
  const metrics = ctx.measureText(text);
  return {
    ascent: metrics.actualBoundingBoxAscent || metrics.fontBoundingBoxAscent,
    descent: Math.max(metrics.actualBoundingBoxDescent, 0)
      || metrics.fontBoundingBoxDescent * 0.2,
  };
}

function drawSentenceHero(ctx, content) {
  const leadFont = `${LEAD_FONT_SIZE}px Inter`;
  const supportFont = `${SUPPORT_FONT_SIZE}px Inter`;
  const leadLineHeight = 34;
  const supportLineHeight = 30;

  const leadMeasure = measureColoredLead(
    ctx,
    content.sentenceLeadParts,
    CONTENT_WIDTH,
    leadLineHeight,
    leadFont,
  );

  const punchSize = fitFontSize(
    ctx,
    content.heroPrimary,
    (size) => `${size}px "JetBrains Mono Bold"`,
    PUNCH_START_SIZE,
    PUNCH_MIN_SIZE,
    CONTENT_WIDTH,
  );
  const punchFont = `${punchSize}px "JetBrains Mono Bold"`;
  const punchExtents = measureTextExtents(ctx, punchFont, content.heroPrimary);

  ctx.font = supportFont;
  const supportLines = wrapText(ctx, content.supportLine, CONTENT_WIDTH);
  const supportExtents = measureFontExtents(ctx, supportFont);

  const leadPunchGap = leadMeasure.empty
    ? 0
    : Math.round(Math.max(LEAD_FONT_SIZE, punchSize) * GAP_RATIO);
  const punchSupportGap = Math.round(Math.max(punchSize, SUPPORT_FONT_SIZE) * GAP_RATIO);

  const punchHeight = punchExtents.ascent + punchExtents.descent;
  const supportHeight = supportExtents.ascent
    + supportExtents.descent
    + Math.max(supportLines.length - 1, 0) * supportLineHeight;

  let punchBaseline = HERO_CENTER_Y - punchHeight / 2 + punchExtents.ascent;
  const punchTop = punchBaseline - punchExtents.ascent;
  const leadBottom = punchTop - leadPunchGap;
  let blockTop = leadBottom - leadMeasure.height;
  let supportBaseline = punchBaseline + punchExtents.descent + punchSupportGap + supportExtents.ascent;
  const supportBottom = supportBaseline + supportHeight - supportExtents.ascent;

  if (blockTop < MIN_LEAD_TOP) {
    const shift = MIN_LEAD_TOP - blockTop;
    blockTop += shift;
    punchBaseline += shift;
    supportBaseline += shift;
  } else if (supportBottom > MAX_SUPPORT_BOTTOM) {
    const shift = supportBottom - MAX_SUPPORT_BOTTOM;
    blockTop -= shift;
    punchBaseline -= shift;
    supportBaseline -= shift;
  }

  const leadExtents = measureFontExtents(ctx, leadFont);
  const leadFirstBaseline = blockTop + leadExtents.ascent;
  drawColoredLead(
    ctx,
    content.sentenceLeadParts,
    MARGIN_X,
    leadFirstBaseline,
    CONTENT_WIDTH,
    leadLineHeight,
    leadFont,
  );

  ctx.fillStyle = content.heroColor;
  ctx.font = punchFont;
  ctx.fillText(content.heroPrimary, MARGIN_X, punchBaseline);

  ctx.fillStyle = COLOR_TEXT_MUTED;
  ctx.font = supportFont;
  let supportY = supportBaseline;
  for (const line of supportLines) {
    ctx.fillText(line, MARGIN_X, supportY);
    supportY += supportLineHeight;
  }
}

function drawFooter(ctx) {
  const textY = 560;
  const prefix = `How long will yours take? \u00B7 `;
  const suffix = `311: DC\u2019s To-Do List`;

  ctx.fillStyle = COLOR_TEXT_DIM;
  ctx.font = '22px Inter';
  ctx.textAlign = 'left';
  ctx.fillText(prefix, MARGIN_X, textY);

  const iconX = MARGIN_X + ctx.measureText(prefix).width;
  const iconY = textY - FOOTER_ICON_SIZE + 3;
  ctx.drawImage(favicon, iconX, iconY, FOOTER_ICON_SIZE, FOOTER_ICON_SIZE);

  ctx.fillText(` ${suffix}`, iconX + FOOTER_ICON_SIZE + 4, textY);
}

const pathCounts = {
  ward_gap: 0,
  promise_broken: 0,
  generous_deadline: 0,
  long_wait: 0,
  quick_fix: 0,
  wide_range: 0,
  reliable: 0,
  delays_common: 0,
  perceptibly_slow: 0,
  typical: 0,
};

let generated = 0;
const coherenceFailures = [];

for (const row of estimates) {
  const serviceType = dicts.serviceTypes[row.st];
  if (!serviceType) continue;

  const displayServiceType = `311: ${truncateServiceTypeForHeader(serviceType)}`;

  const ward = row.w === null ? null : dicts.wards[row.w] ?? null;
  const slug = estimateShareSlug(serviceType, ward);
  const estimate = rowToEstimate(row);
  const citywideRow = citywideByType[row.st];
  const citywideEstimate = citywideRow ? rowToEstimate(citywideRow) : null;

  const content = resolveSharePath({
    serviceType,
    ward,
    estimate,
    citywideEstimate,
  });

  pathCounts[content.id] += 1;

  const coherenceViolations = validateSharePathCoherence(content);
  if (coherenceViolations.length > 0) {
    coherenceFailures.push(`${slug}: ${coherenceViolations.join('; ')}`);
  }

  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#171717';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  drawHeader(ctx, serviceType, ward);
  drawSentenceHero(ctx, content);
  drawFooter(ctx);

  writeFileSync(join(ogDir, `${slug}.png`), canvas.toBuffer('image/png'));

  const wardParam = ward ? `&ward=${encodeURIComponent(ward)}` : '';
  const redirectUrl = `${spaUrl}?tab=estimate&type=${encodeURIComponent(serviceType)}${wardParam}`;
  const ogDesc = escapeHtml(content.ogDescription);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta property="og:title" content="${escapeHtml(content.ogTitle)}">
<meta property="og:description" content="${ogDesc}">
<meta property="og:image" content="${siteUrl}/share/og/${slug}.png">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(content.ogTitle)}">
<meta name="twitter:description" content="${ogDesc}">
<meta name="twitter:image" content="${siteUrl}/share/og/${slug}.png">
<meta http-equiv="refresh" content="0;url=${redirectUrl}">
<title>${escapeHtml(displayServiceType)} — 311: DC's To-Do List</title>
</head>
<body>
<p>Redirecting to <a href="${redirectUrl}">the estimate</a>...</p>
</body>
</html>`;

  writeFileSync(join(shareDir, `${slug}.html`), html);
  generated += 1;
}

const distribution = checkSharePathDistribution(pathCounts);
console.log(`Generated ${generated} share assets`);
console.log('Share path distribution:');
for (const [path, count] of Object.entries(distribution.counts).sort((a, b) => b[1] - a[1])) {
  const pct = distribution.total > 0 ? ((count / distribution.total) * 100).toFixed(1) : '0.0';
  console.log(`  ${path}: ${count} (${pct}%)`);
}
for (const violation of distribution.violations) {
  console.error(violation);
}
if (distribution.violations.length > 0) {
  process.exit(1);
}
if (coherenceFailures.length > 0) {
  console.error(`Share copy coherence: ${coherenceFailures.length} mismatch(es)`);
  for (const failure of coherenceFailures.slice(0, 20)) {
    console.error(`  ${failure}`);
  }
  process.exit(1);
}
