import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  checkSharePathDistribution,
  resolveSharePath,
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
const MAX_SERVICE_TYPE_LENGTH = 38;

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

function drawHeader(ctx, serviceType, ward) {
  ctx.fillStyle = '#9ca3af';
  ctx.font = '32px "Inter Bold"';
  ctx.textAlign = 'left';
  ctx.fillText('311:', 100, 80);

  ctx.fillStyle = '#ffffff';
  const typeText = serviceType.length > MAX_SERVICE_TYPE_LENGTH
    ? `${serviceType.slice(0, MAX_SERVICE_TYPE_LENGTH - 3)}...`
    : serviceType;
  ctx.fillText(typeText, 100 + ctx.measureText('311: ').width, 80);

  ctx.fillStyle = '#9ca3af';
  ctx.font = '26px Inter';
  ctx.textAlign = 'right';
  ctx.fillText(ward || 'Citywide', 1100, 80);
  ctx.textAlign = 'left';

  ctx.fillStyle = CATEGORICAL_COLORS[0];
  ctx.fillRect(100, 110, 1000, 3);
}

function drawComparisonHero(ctx, content) {
  if (content.heroLabel) {
    ctx.fillStyle = '#6b7280';
    ctx.font = '36px Inter';
    ctx.fillText(content.heroLabel, 100, 200);
  }

  ctx.fillStyle = content.heroColor;
  ctx.font = '100px "JetBrains Mono Bold"';
  ctx.fillText(content.heroPrimary, 100, 290);

  ctx.fillStyle = '#9ca3af';
  ctx.font = '36px Inter';
  ctx.fillText(content.supportLine, 100, 380);
}

function drawComplianceHero(ctx, content) {
  ctx.fillStyle = content.heroColor;
  ctx.font = '100px "JetBrains Mono Bold"';
  ctx.fillText(content.heroPrimary, 100, 260);

  ctx.fillStyle = '#9ca3af';
  ctx.font = '36px Inter';
  ctx.fillText(content.supportLine, 100, 340);
}

function drawRangeHero(ctx, content) {
  if (content.heroLabel) {
    ctx.fillStyle = '#6b7280';
    ctx.font = '36px Inter';
    ctx.fillText(content.heroLabel, 100, 200);
  }

  ctx.fillStyle = content.heroColor;
  ctx.font = '100px "JetBrains Mono Bold"';
  ctx.fillText(content.heroPrimary, 100, 290);

  ctx.fillStyle = '#9ca3af';
  ctx.font = '36px Inter';
  ctx.fillText(content.supportLine, 100, 380);
}

function drawFooter(ctx) {
  const textY = 560;
  const prefix = `How long will yours take? \u00B7 `;
  const suffix = `311: DC\u2019s To-Do List`;

  ctx.fillStyle = '#6b7280';
  ctx.font = '22px Inter';
  ctx.textAlign = 'left';
  ctx.fillText(prefix, 100, textY);

  const iconX = 100 + ctx.measureText(prefix).width;
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

for (const row of estimates) {
  const serviceType = dicts.serviceTypes[row.st];
  if (!serviceType) continue;

  const displayServiceType = serviceType.length > MAX_SERVICE_TYPE_LENGTH
    ? `311: ${serviceType.slice(0, MAX_SERVICE_TYPE_LENGTH - 3)}...`
    : `311: ${serviceType}`;

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

  const canvas = createCanvas(1200, 630);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#171717';
  ctx.fillRect(0, 0, 1200, 630);

  drawHeader(ctx, serviceType, ward);

  if (content.layout === 'comparison') {
    drawComparisonHero(ctx, content);
  } else if (content.layout === 'compliance') {
    drawComplianceHero(ctx, content);
  } else {
    drawRangeHero(ctx, content);
  }

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
