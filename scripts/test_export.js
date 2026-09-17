'use strict';
/**
 * test_export.js — Focused tests for src/js/core/export.js
 *
 * Covers only the dashboard export feature:
 *   1  CSV cell quoting — commas, quotes, line breaks
 *   2  CSV formula-injection guard — text cells only, numerics untouched
 *   3  toCSV — column count, column order, row count, no banner rows
 *   4  Filenames — always carry CONFIDENTIAL_INTERNAL_USE_ONLY
 *   5  CRC-32 and Adler-32 against published test vectors
 *   6  ZIP — structure, entry names, byte-exact round trip
 *   7  zlib stored-block fallback inflates back to the original bytes
 *   8  PDF — page count, per-page classification header and footer, valid xref
 *
 * Run: node scripts/test_export.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');

/* ── Load export.js the way the browser would ─────────────────────────────── */
const fakeWindow = {};
const src = fs.readFileSync(path.join(ROOT, 'src/js/core/export.js'), 'utf8');
// eslint-disable-next-line no-new-func
new Function('window', 'globalThis', src)(fakeWindow, fakeWindow);
const X = fakeWindow.BTD.exportUtils;

/* ── Assertion counters ───────────────────────────────────────────────────── */

let passed = 0;
let failed = 0;

function ok(label, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
  }
}

function eq(label, actual, expected) {
  ok(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function section(name) {
  console.log(`\n${name}`);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1. CSV cell quoting
 * ══════════════════════════════════════════════════════════════════════════ */

section('Suite 1 — CSV cell quoting (RFC 4180)');

eq('plain text is unquoted', X.csvCell('Hamilton', true), 'Hamilton');
eq('comma forces quoting', X.csvCell('Wicked, The Musical', true), '"Wicked, The Musical"');
eq('double quote is doubled and wrapped', X.csvCell('The "Best" Show', true), '"The ""Best"" Show"');
eq('newline forces quoting', X.csvCell('Line one\nLine two', true), '"Line one\nLine two"');
eq('carriage return forces quoting', X.csvCell('a\r\nb', true), '"a\r\nb"');
eq('null becomes empty', X.csvCell(null, true), '');
eq('undefined becomes empty', X.csvCell(undefined, false), '');
eq('empty string stays empty', X.csvCell('', true), '');
eq('zero survives as a value', X.csvCell(0, false), '0');

/* ══════════════════════════════════════════════════════════════════════════
 * 2. Formula-injection guard
 * ══════════════════════════════════════════════════════════════════════════ */

section('Suite 2 — CSV formula-injection guard');

eq('equals prefix is neutralised', X.csvCell('=1+1', true), "'=1+1");
eq('plus prefix is neutralised', X.csvCell('+SUM(A1)', true), "'+SUM(A1)");
eq('at prefix is neutralised', X.csvCell('@import', true), "'@import");
eq('minus prefix is neutralised', X.csvCell('-2+3', true), "'-2+3");
eq('tab prefix is neutralised', X.csvCell('\tcmd', true), "'\tcmd");
eq(
  'injection guard and quoting combine',
  X.csvCell('=HYPERLINK("http://x","a,b")', true),
  '"\'=HYPERLINK(""http://x"",""a,b"")"',
);
eq('numeric column keeps negative numbers intact', X.csvCell(-4200, false), '-4200');
eq('numeric column does not prefix a leading minus', X.csvCell('-4200', false), '-4200');
ok(
  'a show title that begins with a dash is still readable after the guard',
  X.csvCell('-Rock of Ages', true).slice(1) === '-Rock of Ages',
);

/* ══════════════════════════════════════════════════════════════════════════
 * 3. toCSV structure
 * ══════════════════════════════════════════════════════════════════════════ */

section('Suite 3 — toCSV structure');

/* The dashboard Data Table's 14 displayed columns, in display order. */
const COLUMNS = [
  { label: 'Week', key: 'week_of', text: true },
  { label: 'Tier', key: 'tier', text: true },
  { label: 'Show', key: 'show', text: true },
  { label: 'City', key: 'city', text: true },
  { label: '# Perf', key: 'num_perf' },
  { label: 'Gross', key: 'gross_gross' },
  { label: 'Potential', key: 'gross_potential' },
  { label: 'GG%GP', key: 'gg_pct_gp' },
  { label: '% Cap Paid', key: 'cap_paid' },
  { label: 'Total Cap', key: 'capacity' },
  { label: 'Paid Tix', key: 'paid_tix' },
  { label: 'Avg Adm', key: 'avg_adm' },
  { label: 'Top Price', key: 'top_price' },
  { label: 'Sub', key: (r) => (r.on_sub ? 'Yes' : 'No'), text: true },
];

const ROWS = [
  {
    week_of: '2025-11-02',
    tier: 'PRIMARY',
    show: 'Wicked, The Musical',
    city: 'Hartford',
    num_perf: 8,
    gross_gross: 1234567.89,
    gross_potential: 1400000,
    gg_pct_gp: 88.2,
    cap_paid: 96.4,
    capacity: 21632,
    paid_tix: 20851,
    avg_adm: 59.21,
    top_price: 189,
    on_sub: 1,
  },
  {
    week_of: '2025-11-09',
    tier: 'SECONDARY',
    show: 'The "Book" of Mormon',
    city: 'New Haven',
    num_perf: 7,
    gross_gross: -4200,
    gross_potential: null,
    gg_pct_gp: null,
    cap_paid: 41.5,
    capacity: 12000,
    paid_tix: 4980,
    avg_adm: null,
    top_price: null,
    on_sub: 0,
  },
  {
    week_of: '2025-11-16',
    tier: 'PRIMARY',
    show: '=cmd|calc',
    city: 'Line\nBreak City',
    num_perf: 8,
    gross_gross: 900000,
    gross_potential: 1000000,
    gg_pct_gp: 90,
    cap_paid: 80,
    capacity: 20000,
    paid_tix: 16000,
    avg_adm: 56.25,
    top_price: 150,
    on_sub: 1,
  },
];

const csv = X.toCSV(COLUMNS, ROWS);

eq('exactly 14 columns are emitted', csv.split('\r\n')[0].split(',').length, 14);
eq(
  'header row matches the table headers in display order',
  csv.split('\r\n')[0],
  'Week,Tier,Show,City,# Perf,Gross,Potential,GG%GP,% Cap Paid,Total Cap,Paid Tix,Avg Adm,Top Price,Sub',
);

/* Row count: split on record boundaries rather than raw newlines, because one
   row legitimately contains an embedded newline inside a quoted field. */
function countCsvRecords(text) {
  let records = 0;
  let inQuotes = false;
  let sawContent = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
      sawContent = true;
    } else if (!inQuotes && c === '\n') {
      if (sawContent) records++;
      sawContent = false;
    } else if (c !== '\r') {
      sawContent = true;
    }
  }
  if (sawContent) records++;
  return records;
}

eq('record count is header + one row per filtered record', countCsvRecords(csv), ROWS.length + 1);
ok('no confidentiality banner row precedes the header', csv.startsWith('Week,Tier,Show'));
ok('embedded newline is preserved inside quotes', csv.includes('"Line\nBreak City"'));
ok('embedded quotes are doubled', csv.includes('"The ""Book"" of Mormon"'));
ok('formula-like show title is neutralised', csv.includes("'=cmd|calc"));
ok('negative gross is written as a number, not a quoted string', csv.includes(',-4200,'));
ok('nulls become empty cells', csv.includes(',-4200,,,41.5,'));
eq('row order is preserved exactly as passed in', csv.split('\r\n')[1].split(',')[0], '2025-11-02');
eq('last row is the last one passed in', csv.split('\r\n').filter(Boolean).pop().split(',')[0], '2025-11-16');

/* ══════════════════════════════════════════════════════════════════════════
 * 4. Filenames
 * ══════════════════════════════════════════════════════════════════════════ */

section('Suite 4 — Export filenames');

const fname = X.buildFilename(['Bushnell Dashboard', 'Data Table', 'Season 2025-26', '2026-09-17'], 'csv');
ok('filename carries the classification slug', fname.includes('CONFIDENTIAL_INTERNAL_USE_ONLY'));
ok('classification sits immediately before the extension', fname.endsWith('CONFIDENTIAL_INTERNAL_USE_ONLY.csv'));
ok('reporting context is identified in the filename', fname.includes('Season_2025_26'));
ok('filename contains no path separators', !/[\\/:*?"<>|]/.test(fname));
eq(
  'full filename',
  fname,
  'Bushnell_Dashboard_Data_Table_Season_2025_26_2026_09_17_CONFIDENTIAL_INTERNAL_USE_ONLY.csv',
);
ok(
  'a hostile chart title cannot escape the filename',
  X.buildFilename(['../../etc/passwd'], 'png') === 'etc_passwd_CONFIDENTIAL_INTERNAL_USE_ONLY.png',
);

/* ══════════════════════════════════════════════════════════════════════════
 * 5. Checksums
 * ══════════════════════════════════════════════════════════════════════════ */

section('Suite 5 — Checksums');

const check = Buffer.from('123456789');
eq('CRC-32 of "123456789" matches the published vector', X.crc32(check), 0xcbf43926);
eq('Adler-32 of "123456789" matches the published vector', X.adler32(check), 0x091e01de);
eq('CRC-32 of empty input is zero', X.crc32(new Uint8Array(0)), 0);

/* ══════════════════════════════════════════════════════════════════════════
 * 6. ZIP
 * ══════════════════════════════════════════════════════════════════════════ */

section('Suite 6 — ZIP archive');

const entries = [
  { name: 'Top_12_Shows_CONFIDENTIAL_INTERNAL_USE_ONLY.png', data: Buffer.from('first chart bytes') },
  { name: 'Weekly_Gross_Trend_CONFIDENTIAL_INTERNAL_USE_ONLY.png', data: Buffer.from('second chart bytes  ÿ') },
  { name: 'Peer_Gap_CONFIDENTIAL_INTERNAL_USE_ONLY.png', data: Buffer.from('third') },
];
const zip = Buffer.from(X.buildZip(entries, new Date('2026-09-17T10:30:00')));

eq('starts with the local file header signature', zip.readUInt32LE(0), 0x04034b50);

/* Locate the end-of-central-directory record (no archive comment, so it is the
   last 22 bytes) and read the entry count from it. */
const eocd = zip.length - 22;
eq('ends with the EOCD signature', zip.readUInt32LE(eocd), 0x06054b50);
eq('EOCD reports one entry per selected chart', zip.readUInt16LE(eocd + 10), entries.length);
eq('EOCD central-directory size matches', zip.readUInt32LE(eocd + 12), zip.length - 22 - zip.readUInt32LE(eocd + 16));

/* Walk the local headers and rebuild the archive contents. */
function readZipEntries(buf) {
  const out = [];
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8);
    const crc = buf.readUInt32LE(p + 14);
    const size = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const extraLen = buf.readUInt16LE(p + 28);
    const name = buf.slice(p + 30, p + 30 + nameLen).toString('utf8');
    const dataStart = p + 30 + nameLen + extraLen;
    out.push({ name, method, crc, data: buf.slice(dataStart, dataStart + size) });
    p = dataStart + size;
  }
  return out;
}

const read = readZipEntries(zip);
eq('every entry is recoverable from the archive', read.length, entries.length);
read.forEach((e, i) => {
  eq(`entry ${i} filename round-trips`, e.name, entries[i].name);
  eq(`entry ${i} uses the stored method`, e.method, 0);
  ok(`entry ${i} payload is byte-identical`, e.data.equals(Buffer.from(entries[i].data)));
  eq(`entry ${i} CRC matches its payload`, e.crc, X.crc32(e.data));
  ok(`entry ${i} filename carries the classification`, e.name.includes('CONFIDENTIAL_INTERNAL_USE_ONLY'));
});

eq('an empty selection still produces a valid archive', Buffer.from(X.buildZip([])).readUInt32LE(0), 0x06054b50);

/* ══════════════════════════════════════════════════════════════════════════
 * 7. zlib stored-block fallback
 * ══════════════════════════════════════════════════════════════════════════ */

section('Suite 7 — zlib stored-block fallback (browsers without CompressionStream)');

[0, 1, 1000, 65535, 65536, 200000].forEach((n) => {
  const raw = Buffer.alloc(n);
  for (let i = 0; i < n; i++) raw[i] = (i * 7) & 0xff;
  const wrapped = Buffer.from(X.storedZlib(raw));
  let round;
  try {
    round = zlib.inflateSync(wrapped);
  } catch (e) {
    round = Buffer.from('INFLATE FAILED: ' + e.message);
  }
  ok(`${n} bytes inflate back to the original`, round.equals(raw), `got ${round.length} bytes`);
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8. PDF
 * ══════════════════════════════════════════════════════════════════════════ */

section('Suite 8 — PDF document');

const CLASS = X.CLASSIFICATION;

function fakeImage(w, h) {
  /* A real Flate stream so the PDF is structurally honest, built the same way
     the browser path builds it. */
  const rgb = Buffer.alloc(w * h * 3, 0x80);
  return { width: w, height: h, filter: 'FlateDecode', data: new Uint8Array(zlib.deflateSync(rgb)) };
}

function buildTestPdf(pageCount) {
  const pages = [];
  for (let i = 0; i < pageCount; i++) {
    pages.push({ image: fakeImage(120, 80), footerLeft: 'Chart ' + (i + 1) + ' · Exported September 17, 2026' });
  }
  return {
    bytes: Buffer.from(X.buildPdf({ pages, headerText: CLASS, footerText: CLASS })),
    pages,
  };
}

[1, 3, 13].forEach((n) => {
  const { bytes } = buildTestPdf(n);
  const latin = bytes.toString('latin1');

  ok(`${n}-chart PDF starts with the PDF header`, latin.startsWith('%PDF-1.4'));
  ok(`${n}-chart PDF ends with %%EOF`, latin.trimEnd().endsWith('%%EOF'));

  /* Page count must equal the number of selected charts. */
  const countMatch = latin.match(/\/Type \/Pages \/Kids \[([^\]]*)\] \/Count (\d+)/);
  ok(`${n}-chart PDF declares a page tree`, !!countMatch);
  eq(`${n}-chart PDF /Count matches selected charts`, Number(countMatch[2]), n);
  eq(
    `${n}-chart PDF has one /Kids entry per chart`,
    countMatch[1]
      .trim()
      .split(/\s+0 R/)
      .filter(Boolean).length,
    n,
  );
  eq(`${n}-chart PDF has one /Type /Page object per chart`, (latin.match(/\/Type \/Page[^s]/g) || []).length, n);

  /* Classification: one header draw and one footer draw on every page.
     The em dash is written as its WinAnsi byte 0x97, so match around it. */
  const classOccurrences = (latin.match(/\(CONFIDENTIAL \x97 INTERNAL USE ONLY\)/g) || []).length;
  eq(`${n}-chart PDF draws the classification twice per page`, classOccurrences, n * 2);

  /* Each page has exactly one image XObject and one content stream. */
  eq(`${n}-chart PDF embeds one image per page`, (latin.match(/\/Subtype \/Image/g) || []).length, n);
  eq(`${n}-chart PDF references the image on every page`, (latin.match(/\/Im0 Do/g) || []).length, n);

  /* Page counters. */
  eq(`${n}-chart PDF numbers every page`, (latin.match(/\(Page \d+ of \d+\)/g) || []).length, n);
  ok(`${n}-chart PDF's last page counter reads "of ${n}"`, latin.includes(`(Page ${n} of ${n})`));

  /* xref offsets must land exactly on their object headers. */
  /* Find the xref TABLE, not the "xref" inside the trailing "startxref". */
  const xrefStart = latin.lastIndexOf('\nxref\n') + 1;
  const xrefBody = latin.slice(xrefStart);
  const offsets = [...xrefBody.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  ok(`${n}-chart PDF xref lists every object`, offsets.length === (latin.match(/^\d+ 0 obj$/gm) || []).length);
  const badOffset = offsets.findIndex((off, i) => !latin.startsWith(`${i + 1} 0 obj`, off));
  eq(`${n}-chart PDF xref offsets all resolve`, badOffset, -1);

  /* startxref must point at the xref table. */
  const startxref = Number(latin.match(/startxref\n(\d+)/)[1]);
  ok(`${n}-chart PDF startxref points at the xref table`, latin.startsWith('xref', startxref));
});

/* Header and footer are structurally unavoidable — a page cannot omit them. */
const single = Buffer.from(
  X.buildPdf({ pages: [{ image: fakeImage(100, 100) }], headerText: CLASS, footerText: CLASS }),
).toString('latin1');
const contentStream = single.slice(single.indexOf('/Im0 Do'));
const headerY = contentStream.match(/\/F1 10 Tf [\d.]+ ([\d.]+) Td/);
const footerY = contentStream.match(/\/F1 9 Tf [\d.]+ ([\d.]+) Td/);
ok('classification header is drawn in the top band', headerY && Number(headerY[1]) > 570);
ok('classification footer is drawn in the bottom band', footerY && Number(footerY[1]) < 40);

/* PDF string escaping. */
section('Suite 8b — PDF string escaping');
eq('parentheses are escaped', X.pdfString('Show (Tour)'), '(Show \\(Tour\\))');
eq('backslash is escaped', X.pdfString('a\\b'), '(a\\\\b)');
eq('em dash maps to WinAnsi 0x97', X.pdfString('a—b'), '(a\x97b)');
eq('middot maps to WinAnsi 0xB7', X.pdfString('a·b'), '(a\xb7b)');
eq('unmappable characters become "?"', X.pdfString('a中b'), '(a?b)');

/* ══════════════════════════════════════════════════════════════════════════
 * 9. Show-name label wrapping (src/js/core/charts.js)
 *    Exported charts capture the same canvases the screen shows, so the wrap
 *    behaviour verified here is what lands in the PNGs and the PDF.
 * ══════════════════════════════════════════════════════════════════════════ */

section('Suite 9 — Show-name label wrapping');

/* charts.js reaches for the global `document`, as the other core modules do. */
const chartsWindow = {};
global.document = { getElementById: () => null };
// eslint-disable-next-line no-new-func
new Function('window', fs.readFileSync(path.join(ROOT, 'src/js/core/charts.js'), 'utf8'))(chartsWindow);
const C = chartsWindow.BTD.charts;

const WRAP = 30;

/* The longest show names actually present in src/data/data.json. */
const dataJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/data.json'), 'utf8'));
const dataRows = Array.isArray(dataJson) ? dataJson : dataJson.records || dataJson.data || [];
const realNames = [...new Set(dataRows.map((r) => r && r.show).filter(Boolean))].sort((a, b) => b.length - a.length);

ok('data.json yielded show names to test against', realNames.length > 0, `found ${realNames.length}`);

const longest = realNames.slice(0, 15);
console.log(`  · longest real show name is ${longest[0].length} chars: "${longest[0]}"`);

let wrapFailures = [];
realNames.forEach((name) => {
  const wrapped = C.wrapLabel(name, WRAP);
  const lines = Array.isArray(wrapped) ? wrapped : [wrapped];

  // 1. Nothing is lost: the lines rejoin to the original name.
  if (lines.join(' ') !== name.trim().replace(/\s+/g, ' ')) wrapFailures.push(['not lossless', name, lines]);
  // 2. Nothing is silently truncated. (A handful of League titles genuinely
  //    contain an ellipsis — only a NEW one counts as truncation.)
  const addedEllipses = lines.join('').split('…').length - name.split('…').length;
  if (addedEllipses > 0) wrapFailures.push(['ellipsis introduced', name, lines]);
  // 3. No line overruns the budget the axis was sized for.
  if (lines.some((l) => l.length > WRAP)) wrapFailures.push(['line too long', name, lines]);
  // 4. No empty lines, which would show as a gap in the axis.
  if (lines.some((l) => l === '')) wrapFailures.push(['empty line', name, lines]);
});
ok(
  `all ${realNames.length} real show names wrap losslessly within ${WRAP} chars`,
  wrapFailures.length === 0,
  JSON.stringify(wrapFailures.slice(0, 3)),
);

const worst = C.wrapLabel(longest[0], WRAP);
ok('the longest real show name wraps onto multiple lines', Array.isArray(worst) && worst.length > 1);
ok(
  'the longest real show name needs no more than 3 lines',
  C.labelLineCount(worst) <= 3,
  `got ${C.labelLineCount(worst)}`,
);

/* Every real name, for the record, must fit the height budget the charts size for. */
const maxRealLines = realNames.reduce((m, n) => Math.max(m, C.labelLineCount(C.wrapLabel(n, WRAP))), 0);
ok(`no real show name exceeds 3 wrapped lines (max ${maxRealLines})`, maxRealLines <= 3);

eq('a short name stays a plain string', C.wrapLabel('Hadestown', WRAP), 'Hadestown');
eq('a name exactly at the limit is not wrapped', C.wrapLabel('x'.repeat(WRAP), WRAP), 'x'.repeat(WRAP));
ok('a name one over the limit wraps', Array.isArray(C.wrapLabel('x '.repeat(16).trim(), WRAP)));

/* Word-boundary preference. */
const wrapped = C.wrapLabel('A Beautiful Noise, The Neil Diamond Musical', WRAP);
ok(
  'wraps between words, never mid-word',
  wrapped.every((l) => !/^\S/.test(l) === false && l.trim() === l),
);
ok(
  'no line starts or ends with a space',
  wrapped.every((l) => l === l.trim()),
);
eq('rejoins to the original', wrapped.join(' '), 'A Beautiful Noise, The Neil Diamond Musical');

/* Unusually long single words must be hard-broken rather than overflow. */
const longWord = 'Supercalifragilisticexpialidocious'.repeat(2); // 68 chars, no spaces
const brokenLines = C.wrapLabel(longWord, WRAP);
ok('an over-long single word is hard-broken', Array.isArray(brokenLines) && brokenLines.length === 3);
ok(
  'no hard-broken line overruns the budget',
  brokenLines.every((l) => l.length <= WRAP),
);
eq('a hard-broken word loses no characters', brokenLines.join(''), longWord);

const mixed = C.wrapLabel('Short ' + longWord + ' tail', WRAP);
ok(
  'a long word mixed with short ones still fits every line',
  mixed.every((l) => l.length <= WRAP),
);
ok('the mixed case keeps every character', mixed.join('').replace(/ /g, '') === 'Short' + longWord + 'tail');

eq('empty input is safe', C.wrapLabel('', WRAP), '');
eq('null input is safe', C.wrapLabel(null, WRAP), '');

/* Line counting. */
eq('labelLineCount of a plain string is 1', C.labelLineCount('Hadestown'), 1);
eq('labelLineCount of an array is its length', C.labelLineCount(['a', 'b', 'c']), 3);
eq('maxLabelLines takes the tallest label', C.maxLabelLines(['a', ['b', 'c'], ['d', 'e', 'f']]), 3);
eq('maxLabelLines of an empty set is 1', C.maxLabelLines([]), 1);

/* Height sizing — the mechanism that keeps wrapped labels from colliding. */
section('Suite 9b — Category axis height sizing');

/* fitCategoryHeight publishes heights through a <style> element it owns, so the
   stub only has to look like just enough of the DOM for that. */
const styleEl = { id: '', textContent: '' };
const fakeCanvas = { id: 'cStub', style: {} };
global.document = {
  getElementById: (id) => (id === 'btd-chart-heights' ? styleEl : fakeCanvas),
  createElement: () => styleEl,
  head: { appendChild: () => {} },
};

const twentyTwoLine = Array.from({ length: 20 }, () => ['line one', 'line two']);
const h20 = C.fitCategoryHeight('cLongevity', twentyTwoLine, { linePx: 12, gapPx: 8, axisPx: 56, minPx: 320 });
eq('20 two-line labels get 20 × (2×12 + 8) + 56 px', h20, 20 * 32 + 56);
ok(
  'the height is published as an !important stylesheet rule Chart.js cannot clobber',
  styleEl.textContent.includes('#cLongevity { height: ' + h20 + 'px !important; }'),
  styleEl.textContent,
);
ok('every label has room for both of its lines', h20 / 20 >= 2 * 12);

const h12 = C.fitCategoryHeight(
  'cShowGross',
  Array.from({ length: 12 }, () => ['a', 'b']),
  {
    linePx: 12,
    gapPx: 8,
    axisPx: 56,
    minPx: 380,
  },
);
eq('12 two-line labels get 12 × 32 + 56 px', h12, 12 * 32 + 56);

const hMin = C.fitCategoryHeight(
  'cShowGross',
  Array.from({ length: 4 }, () => 'short'),
  {
    linePx: 12,
    gapPx: 8,
    axisPx: 56,
    minPx: 380,
  },
);
eq('the stylesheet height is a floor, never a ceiling', hMin, 380);
ok('sizing only ever grows a chart', hMin >= 380 && h20 >= 320 && h12 >= 380);

/* ══════════════════════════════════════════════════════════════════════════
 * Summary
 * ══════════════════════════════════════════════════════════════════════════ */

console.log(`\n${'─'.repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failed}`);
console.log('─'.repeat(60));
process.exit(failed === 0 ? 0 : 1);
