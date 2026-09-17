/**
 * export.js — Client-side export utilities for the Broadway Touring Dashboard
 *
 * Everything in this file runs in the browser. No dashboard data is ever sent
 * to an external service: CSV text, ZIP archives and PDF documents are all
 * assembled in-page from bytes and handed to the browser as a Blob download.
 *
 * NO NEW THIRD-PARTY DEPENDENCIES.
 * ZIP and PDF are written here directly against their published file formats:
 *   · ZIP  — PKWARE APPNOTE 6.3.3, "stored" (method 0) entries. PNGs are
 *            already DEFLATE-compressed internally, so re-compressing them
 *            buys nothing and store-mode keeps the writer small and correct.
 *   · PDF  — ISO 32000-1 (PDF 1.4). One image XObject per page, DeviceRGB,
 *            /FlateDecode. The Flate stream comes from the platform's own
 *            CompressionStream('deflate') API, with a spec-legal "stored
 *            block" fallback for browsers that do not expose it.
 *
 * Load order: after js/utils.js. Attaches to window.BTD.exportUtils.
 *
 * Sections:
 *   1. Classification constants
 *   2. Filename helpers
 *   3. CSV writing (RFC 4180 + formula-injection guard)
 *   4. Byte helpers
 *   5. DEFLATE / zlib
 *   6. ZIP writing
 *   7. PDF writing
 *   8. Browser glue — canvas composition, chart capture, download
 */

(function (root) {
  'use strict';

  root.BTD = root.BTD || {};

  /* ══════════════════════════════════════════════════════════════════════════
   * 1. CLASSIFICATION CONSTANTS
   * Every artefact this module produces carries the same classification text.
   * ══════════════════════════════════════════════════════════════════════════ */

  /* Human-readable form — drawn into images, PDF pages and print header/footer. */
  var CLASSIFICATION = 'CONFIDENTIAL — INTERNAL USE ONLY';

  /* Filename-safe form — appended to every exported filename. */
  var CLASSIFICATION_SLUG = 'CONFIDENTIAL_INTERNAL_USE_ONLY';

  /* ══════════════════════════════════════════════════════════════════════════
   * 2. FILENAME HELPERS
   * ══════════════════════════════════════════════════════════════════════════ */

  /**
   * Reduce an arbitrary string to a filename-safe token.
   * Collapses every run of non-alphanumerics to a single underscore so that
   * show titles, city names and date ranges cannot inject path separators.
   */
  function slug(s) {
    var out = String(s == null ? '' : s)
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60);
    return out;
  }

  /**
   * Build an export filename from ordered parts.
   * CLASSIFICATION_SLUG is always appended immediately before the extension,
   * so the classification survives being saved, renamed-by-copy or emailed.
   *
   *   buildFilename(['Bushnell_Dashboard', 'Season 2025-26', '2026-09-17'], 'csv')
   *   → "Bushnell_Dashboard_Season_2025_26_2026_09_17_CONFIDENTIAL_INTERNAL_USE_ONLY.csv"
   */
  function buildFilename(parts, ext) {
    var clean = (parts || []).map(slug).filter(function (p) {
      return p !== '';
    });
    clean.push(CLASSIFICATION_SLUG);
    return clean.join('_') + '.' + ext;
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * 3. CSV WRITING
   * ══════════════════════════════════════════════════════════════════════════ */

  /**
   * Characters that make Excel, LibreOffice and Google Sheets treat a cell as
   * a formula rather than as text. A leading tab or carriage return is included
   * because some spreadsheet importers strip it and then re-evaluate the rest.
   */
  var FORMULA_TRIGGER = /^[=+\-@\t\r]/;

  /**
   * Format one CSV cell.
   *
   * @param {*}       value   raw cell value (null/undefined become empty)
   * @param {boolean} isText  true for free-text columns — these get the
   *                          formula-injection guard. Numeric columns must NOT
   *                          be passed as text, or negative numbers would be
   *                          quoted and prefixed.
   *
   * Two independent protections, in this order:
   *   1. Formula-injection guard — a leading ' forces spreadsheet apps to read
   *      the cell as a literal string (OWASP CSV-injection guidance).
   *   2. RFC 4180 quoting — any cell containing a comma, double quote, CR or LF
   *      is wrapped in double quotes and its own quotes are doubled.
   */
  function csvCell(value, isText) {
    if (value == null) return '';
    var s = String(value);
    if (s === '') return '';
    if (isText && FORMULA_TRIGGER.test(s)) s = "'" + s;
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /**
   * Serialise rows to RFC 4180 CSV text (CRLF line endings).
   *
   * @param {Array}  columns  [{ label, key, text }] — `text: true` marks a
   *                          free-text column that needs the injection guard.
   *                          `key` may be a function (row) => value.
   * @param {Array}  rows     already filtered and already sorted. This function
   *                          never re-orders: the caller owns sort order.
   * @returns {string}
   *
   * No confidentiality banner rows are written. A banner row would sit above
   * the header and break every tool that expects row 1 to be the header —
   * the classification lives in the filename instead.
   */
  function toCSV(columns, rows) {
    var lines = [];
    lines.push(
      columns
        .map(function (c) {
          return csvCell(c.label, false);
        })
        .join(','),
    );
    (rows || []).forEach(function (row) {
      lines.push(
        columns
          .map(function (c) {
            var v = typeof c.key === 'function' ? c.key(row) : row[c.key];
            return csvCell(v, !!c.text);
          })
          .join(','),
      );
    });
    return lines.join('\r\n') + '\r\n';
  }

  /**
   * Wrap CSV text in a Blob with a UTF-8 BOM.
   * Excel on Windows assumes the system codepage without the BOM, which mangles
   * the accented characters that appear in show and venue names.
   */
  function csvBlob(text) {
    return new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8;' });
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * 4. BYTE HELPERS
   * ══════════════════════════════════════════════════════════════════════════ */

  /** Latin-1 string → bytes. Used for PDF syntax and ZIP header fields. */
  function latin1Bytes(str) {
    var out = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
    return out;
  }

  /** UTF-8 string → bytes. Used for ZIP entry names. */
  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    return latin1Bytes(unescape(encodeURIComponent(str)));
  }

  /** Concatenate an array of Uint8Arrays into one buffer. */
  function concatBytes(chunks) {
    var total = 0,
      i;
    for (i = 0; i < chunks.length; i++) total += chunks[i].length;
    var out = new Uint8Array(total);
    var off = 0;
    for (i = 0; i < chunks.length; i++) {
      out.set(chunks[i], off);
      off += chunks[i].length;
    }
    return out;
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * 5. DEFLATE / ZLIB
   * ══════════════════════════════════════════════════════════════════════════ */

  /** Adler-32 checksum — the trailer required by the zlib container (RFC 1950). */
  function adler32(bytes) {
    var a = 1,
      b = 0;
    for (var i = 0; i < bytes.length; i++) {
      a = (a + bytes[i]) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  }

  /**
   * zlib stream built entirely from DEFLATE "stored" (uncompressed) blocks.
   *
   * This is a fully valid RFC 1950/1951 stream — it just does not compress.
   * It exists only as a fallback for browsers without CompressionStream, so
   * that PDF export still produces a correct (if larger) document there.
   */
  function storedZlib(bytes) {
    var MAX = 65535;
    var chunks = [new Uint8Array([0x78, 0x01])]; /* CMF/FLG for stored deflate */
    var pos = 0;
    if (bytes.length === 0) {
      chunks.push(new Uint8Array([0x01, 0x00, 0x00, 0xff, 0xff]));
    }
    while (pos < bytes.length) {
      var len = Math.min(MAX, bytes.length - pos);
      var last = pos + len >= bytes.length ? 1 : 0;
      chunks.push(new Uint8Array([last, len & 0xff, (len >> 8) & 0xff, ~len & 0xff, (~len >> 8) & 0xff]));
      chunks.push(bytes.subarray(pos, pos + len));
      pos += len;
    }
    var sum = adler32(bytes);
    chunks.push(new Uint8Array([(sum >>> 24) & 0xff, (sum >>> 16) & 0xff, (sum >>> 8) & 0xff, sum & 0xff]));
    return concatBytes(chunks);
  }

  /**
   * Compress bytes to a zlib stream suitable for a PDF /FlateDecode filter.
   * Uses the platform CompressionStream when available (no dependency, real
   * compression); falls back to storedZlib otherwise.
   */
  async function deflateZlib(bytes) {
    if (typeof root.CompressionStream === 'function') {
      try {
        var cs = new root.CompressionStream('deflate');
        var stream = new Blob([bytes]).stream().pipeThrough(cs);
        var buf = await new Response(stream).arrayBuffer();
        return new Uint8Array(buf);
      } catch (e) {
        /* Fall through to the stored-block writer. */
      }
    }
    return storedZlib(bytes);
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * 6. ZIP WRITING — PKWARE APPNOTE 6.3.3, stored entries
   * ══════════════════════════════════════════════════════════════════════════ */

  /* CRC-32 lookup table (IEEE 802.3 polynomial, reflected 0xEDB88320). */
  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  /** CRC-32 of a byte array, as required by every ZIP entry header. */
  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /** Little-endian 16- and 32-bit writers used by the ZIP headers. */
  function u16(v) {
    return new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
  }
  function u32(v) {
    return new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
  }

  /** JS Date → MS-DOS packed time/date pair used in ZIP headers. */
  function dosDateTime(date) {
    var d = date || new Date();
    var time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f);
    var day = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time: time & 0xffff, date: day & 0xffff };
  }

  /**
   * Build a ZIP archive from in-memory entries.
   *
   * @param {Array} entries [{ name: string, data: Uint8Array }]
   * @param {Date}  [now]   timestamp stamped on every entry
   * @returns {Uint8Array}
   *
   * Entries are stored uncompressed (method 0). PNG payloads are already
   * DEFLATE-compressed, so this costs almost nothing in size and keeps the
   * writer to one well-understood code path.
   */
  function buildZip(entries, now) {
    var stamp = dosDateTime(now);
    var localParts = [];
    var centralParts = [];
    var offset = 0;
    var count = 0;

    (entries || []).forEach(function (entry) {
      var nameBytes = utf8Bytes(entry.name);
      var data = entry.data;
      var crc = crc32(data);

      /* Local file header — signature 0x04034b50 */
      var local = concatBytes([
        u32(0x04034b50),
        u16(20) /* version needed to extract = 2.0 */,
        u16(0x0800) /* general purpose flags: bit 11 = UTF-8 filename */,
        u16(0) /* compression method 0 = stored */,
        u16(stamp.time),
        u16(stamp.date),
        u32(crc),
        u32(data.length) /* compressed size   */,
        u32(data.length) /* uncompressed size */,
        u16(nameBytes.length),
        u16(0) /* extra field length */,
        nameBytes,
      ]);
      localParts.push(local, data);

      /* Central directory file header — signature 0x02014b50 */
      centralParts.push(
        concatBytes([
          u32(0x02014b50),
          u16(20) /* version made by      */,
          u16(20) /* version needed       */,
          u16(0x0800),
          u16(0),
          u16(stamp.time),
          u16(stamp.date),
          u32(crc),
          u32(data.length),
          u32(data.length),
          u16(nameBytes.length),
          u16(0) /* extra field length   */,
          u16(0) /* file comment length  */,
          u16(0) /* disk number start    */,
          u16(0) /* internal attributes  */,
          u32(0) /* external attributes  */,
          u32(offset) /* relative offset of local header */,
          nameBytes,
        ]),
      );

      offset += local.length + data.length;
      count++;
    });

    var central = concatBytes(centralParts);
    var eocd = concatBytes([
      u32(0x06054b50) /* end of central directory signature */,
      u16(0) /* this disk number            */,
      u16(0) /* disk with central directory */,
      u16(count),
      u16(count),
      u32(central.length),
      u32(offset),
      u16(0) /* .zip comment length */,
    ]);

    return concatBytes(localParts.concat([central, eocd]));
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * 7. PDF WRITING — ISO 32000-1 (PDF 1.4)
   * ══════════════════════════════════════════════════════════════════════════ */

  /* Characters outside ASCII that appear in dashboard text, mapped to their
     WinAnsiEncoding byte so base-14 Helvetica renders them correctly. */
  var WINANSI = {
    0x2014: 0x97 /* — em dash    */,
    0x2013: 0x96 /* – en dash    */,
    0x2018: 0x91 /* ' left quote */,
    0x2019: 0x92 /* ' apostrophe */,
    0x201c: 0x93 /* " left dq    */,
    0x201d: 0x94 /* " right dq   */,
    0x2026: 0x85 /* … ellipsis   */,
    0x00b7: 0xb7 /* · middot     */,
  };

  /**
   * Encode a JS string as a PDF literal string in WinAnsiEncoding.
   * Escapes the three characters that terminate or nest a PDF string, and
   * substitutes '?' for anything outside the encoding.
   */
  function pdfString(str) {
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (WINANSI[code] != null) code = WINANSI[code];
      else if (code > 0xff) code = 0x3f; /* '?' */
      var ch = String.fromCharCode(code);
      if (ch === '\\' || ch === '(' || ch === ')') out += '\\' + ch;
      else out += ch;
    }
    return '(' + out + ')';
  }

  /**
   * Approximate the rendered width of a Helvetica string, in points.
   * Used only to centre header/footer text — exact metrics are not worth
   * embedding a full AFM table for.
   */
  function approxTextWidth(str, fontSize, bold) {
    return str.length * fontSize * (bold ? 0.58 : 0.52);
  }

  /**
   * Build a PDF document — one image per page, with real text header and
   * footer drawn on every page.
   *
   * @param {Object} spec
   *   pages       [{ image: {width, height, data, filter}, footerLeft,
   *                  pageWidth, pageHeight }]
   *               `data` is a zlib stream of DeviceRGB samples (see deflateZlib).
   *               A page may override the document page size — a chart whose
   *               wrapped labels make it taller than it is wide reads far better
   *               on a portrait page than shrunk onto a landscape one.
   *   headerText  string drawn centred in the top margin of every page
   *   footerText  string drawn centred in the bottom margin of every page
   *   pageWidth   points (default 792 — US Letter landscape)
   *   pageHeight  points (default 612)
   * @returns {Uint8Array}
   *
   * Every page repeats headerText and footerText. Nothing about that is
   * conditional: a page cannot exist in this document without them.
   */
  function buildPdf(spec) {
    spec = spec || {};
    var pages = spec.pages || [];
    var DEFAULT_PW = spec.pageWidth || 792;
    var DEFAULT_PH = spec.pageHeight || 612;
    var headerText = spec.headerText || '';
    var footerText = spec.footerText || '';

    var MARGIN = 36; /* 0.5in side margins */
    var HEADER_BAND = 30; /* reserved strip at the top of each page */

    /* The footer holds two stacked lines, not one. Putting the caption, the
       classification and the page counter on a single baseline made a long
       chart caption run straight through the centred classification — 32pt of
       overlap on a landscape page, 122pt on a portrait one, where the centre
       sits further left. The classification keeps the lower, centred baseline;
       the caption and counter move to their own baseline above it. */
    var FOOTER_CLASS_Y = 14; /* lower line: classification, centred          */
    var FOOTER_META_Y = 31; /* upper line: caption (left), counter (right)  */
    var FOOTER_BAND = 48; /* reserved strip for both lines plus clearance */

    var objects = []; /* objects[n] holds the body of object number n+1 */

    function addObject(body) {
      objects.push(body);
      return objects.length; /* 1-based object number */
    }

    /* Object 1 — document catalogue. Its /Pages reference is object 2. */
    addObject('<< /Type /Catalog /Pages 2 0 R >>');
    /* Object 2 — page tree. Kid references are patched in once known. */
    addObject('');
    /* Objects 3 and 4 — the two base-14 fonts used by header and footer. */
    var fontBold = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    var fontReg = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

    var kids = [];

    pages.forEach(function (page, index) {
      var img = page.image;
      var PW = page.pageWidth || DEFAULT_PW;
      var PH = page.pageHeight || DEFAULT_PH;

      /* ── Fit the chart image into the space between the two bands ── */
      var availW = PW - MARGIN * 2;
      var availH = PH - HEADER_BAND - FOOTER_BAND - MARGIN;
      var scale = Math.min(availW / img.width, availH / img.height);
      var drawW = img.width * scale;
      var drawH = img.height * scale;
      var drawX = (PW - drawW) / 2;
      var drawY = FOOTER_BAND + (availH - drawH) / 2 + MARGIN / 2;

      /* ── Image XObject ── */
      var imgObj = addObject({
        dict:
          '<< /Type /XObject /Subtype /Image /Width ' +
          img.width +
          ' /Height ' +
          img.height +
          ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /' +
          (img.filter || 'FlateDecode') +
          ' /Length ' +
          img.data.length +
          ' >>',
        stream: img.data,
      });

      /* ── Page content stream ── */
      var hdrSize = 10;
      var ftrSize = 9;
      var content =
        'q\n' +
        drawW.toFixed(2) +
        ' 0 0 ' +
        drawH.toFixed(2) +
        ' ' +
        drawX.toFixed(2) +
        ' ' +
        drawY.toFixed(2) +
        ' cm\n/Im0 Do\nQ\n';

      /* Classification header — centred in the reserved top band. */
      content +=
        'BT /F1 ' +
        hdrSize +
        ' Tf ' +
        ((PW - approxTextWidth(headerText, hdrSize, true)) / 2).toFixed(2) +
        ' ' +
        (PH - HEADER_BAND + 8).toFixed(2) +
        ' Td ' +
        pdfString(headerText) +
        ' Tj ET\n';

      /* Classification footer — centred, alone on the lower footer line. */
      content +=
        'BT /F1 ' +
        ftrSize +
        ' Tf ' +
        ((PW - approxTextWidth(footerText, ftrSize, true)) / 2).toFixed(2) +
        ' ' +
        FOOTER_CLASS_Y.toFixed(2) +
        ' Td ' +
        pdfString(footerText) +
        ' Tj ET\n';

      /* Page counter, right-aligned on the upper footer line. */
      var counter = 'Page ' + (index + 1) + ' of ' + pages.length;
      var counterX = PW - MARGIN - approxTextWidth(counter, ftrSize, false);
      content +=
        'BT /F2 ' +
        ftrSize +
        ' Tf ' +
        counterX.toFixed(2) +
        ' ' +
        FOOTER_META_Y.toFixed(2) +
        ' Td ' +
        pdfString(counter) +
        ' Tj ET\n';

      /* Per-page caption (chart title / export date), left-aligned on the same
         upper line. Clamped to the space before the counter so the two cannot
         run together — with the current chart titles this never fires. */
      if (page.footerLeft) {
        var caption = String(page.footerLeft);
        var captionRoom = counterX - 12 - MARGIN;
        var maxChars = Math.floor(captionRoom / (ftrSize * 0.52));
        if (caption.length > maxChars) caption = caption.slice(0, Math.max(1, maxChars - 1)) + '…';
        content +=
          'BT /F2 ' +
          ftrSize +
          ' Tf ' +
          MARGIN +
          ' ' +
          FOOTER_META_Y.toFixed(2) +
          ' Td ' +
          pdfString(caption) +
          ' Tj ET\n';
      }

      var contentBytes = latin1Bytes(content);
      var contentObj = addObject({
        dict: '<< /Length ' + contentBytes.length + ' >>',
        stream: contentBytes,
      });

      var pageObj = addObject(
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' +
          PW +
          ' ' +
          PH +
          '] /Resources << /XObject << /Im0 ' +
          imgObj +
          ' 0 R >> /Font << /F1 ' +
          fontBold +
          ' 0 R /F2 ' +
          fontReg +
          ' 0 R >> >> /Contents ' +
          contentObj +
          ' 0 R >>',
      );
      kids.push(pageObj + ' 0 R');
    });

    /* Patch the page tree now that every page object number is known. */
    objects[1] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages.length + ' >>';

    /* ── Serialise: header, body, xref table, trailer ── */
    var chunks = [];
    var offsets = [];
    var position = 0;

    function push(bytes) {
      chunks.push(bytes);
      position += bytes.length;
    }

    push(latin1Bytes('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'));

    objects.forEach(function (body, i) {
      offsets[i] = position;
      var num = i + 1;
      if (typeof body === 'string') {
        push(latin1Bytes(num + ' 0 obj\n' + body + '\nendobj\n'));
      } else {
        push(latin1Bytes(num + ' 0 obj\n' + body.dict + '\nstream\n'));
        push(body.stream);
        push(latin1Bytes('\nendstream\nendobj\n'));
      }
    });

    var xrefPos = position;
    var xref = 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
    offsets.forEach(function (off) {
      xref += String(off).padStart(10, '0') + ' 00000 n \n';
    });
    xref += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n';
    push(latin1Bytes(xref));

    return concatBytes(chunks);
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * 8. BROWSER GLUE — canvas composition, chart capture, download
   * These functions touch the DOM and are never called from the Node tests.
   * ══════════════════════════════════════════════════════════════════════════ */

  /** Hand a Blob to the browser as a download with the given filename. */
  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    /* Revoke on the next tick — Safari needs the URL alive during the click. */
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 2000);
  }

  /* Palette — mirrors the CSS custom properties used across the dashboard.
     Canvas cannot read var(--rose), so the values are restated here. */
  var INK = '#1a1a1a';
  var INK3 = '#6b6b6b';
  var NAVY = '#003865';
  var ROSE = '#B0303A';

  /**
   * Compose one export image: classification band (optional), chart title,
   * filter context, the chart bitmap itself, and a footer.
   *
   * @param {HTMLCanvasElement} source   the live Chart.js canvas
   * @param {Object} meta
   *   title            chart title
   *   subtitle         the chart's on-screen sub-caption
   *   contextLines     array of strings — season / date range / active filters
   *   exportDate       formatted export date
   *   includeClassification  draw the CONFIDENTIAL bands into the bitmap.
   *                    True for PNG (nothing else carries the classification);
   *                    false for PDF (the page itself draws real text bands).
   * @returns {HTMLCanvasElement}
   */
  function composeChartCanvas(source, meta) {
    meta = meta || {};
    var lines = meta.contextLines || [];
    var band = meta.includeClassification ? 46 : 0;

    var PAD = 34;
    var CONTENT_W = 1400;

    /* Scale the chart bitmap to the fixed content width, keeping its aspect. */
    var imgW = CONTENT_W;
    var imgH = Math.round((source.height / source.width) * CONTENT_W);

    var titleH = 40;
    var subH = meta.subtitle ? 26 : 0;
    var linesH = lines.length * 22;
    var headerH = band + PAD + titleH + subH + linesH + 16;
    var footerH = band + 34;

    var canvas = document.createElement('canvas');
    canvas.width = CONTENT_W + PAD * 2;
    canvas.height = headerH + imgH + footerH + PAD;
    var ctx = canvas.getContext('2d');

    /* Opaque white background — PNGs land in decks and emails, not on a page. */
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    var y = 0;

    /* ── Classification header band ── */
    if (band) {
      ctx.fillStyle = ROSE;
      ctx.fillRect(0, 0, canvas.width, band);
      ctx.fillStyle = '#ffffff';
      ctx.font = "700 20px 'Libre Franklin', Arial, sans-serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(CLASSIFICATION, canvas.width / 2, band / 2 + 1);
      y = band;
    }

    /* ── Title, sub-caption and filter context ── */
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    y += PAD;

    ctx.fillStyle = NAVY;
    ctx.font = "700 28px 'Libre Franklin', Arial, sans-serif";
    ctx.fillText(meta.title || 'Chart', PAD, y + 26);
    y += titleH;

    if (meta.subtitle) {
      ctx.fillStyle = INK3;
      ctx.font = "400 15px 'Libre Franklin', Arial, sans-serif";
      ctx.fillText(meta.subtitle, PAD, y + 16);
      y += subH;
    }

    ctx.fillStyle = INK;
    ctx.font = "400 14px 'Libre Franklin', Arial, sans-serif";
    lines.forEach(function (line) {
      ctx.fillText(line, PAD, y + 15);
      y += 22;
    });

    /* Hairline rule between the context block and the chart. */
    y += 10;
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, y + 0.5);
    ctx.lineTo(canvas.width - PAD, y + 0.5);
    ctx.stroke();
    y += 6;

    /* ── Chart bitmap ── */
    ctx.drawImage(source, PAD, y, imgW, imgH);
    y += imgH + 18;

    /* ── Footer ── */
    ctx.fillStyle = INK3;
    ctx.font = "400 13px 'Libre Franklin', Arial, sans-serif";
    ctx.textAlign = 'left';
    ctx.fillText('Exported ' + (meta.exportDate || '') + ' · The Bushnell Center for the Performing Arts', PAD, y + 12);

    if (band) {
      ctx.fillStyle = ROSE;
      ctx.fillRect(0, canvas.height - band, canvas.width, band);
      ctx.fillStyle = '#ffffff';
      ctx.font = "700 20px 'Libre Franklin', Arial, sans-serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(CLASSIFICATION, canvas.width / 2, canvas.height - band / 2 + 1);
    }

    return canvas;
  }

  /** Canvas → PNG bytes. */
  function canvasToPngBytes(canvas) {
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) {
        blob.arrayBuffer().then(function (buf) {
          resolve(new Uint8Array(buf));
        });
      }, 'image/png');
    });
  }

  /**
   * Canvas → PDF image descriptor.
   * Drops the alpha channel (the canvas is already composited over white) and
   * Flate-compresses the resulting DeviceRGB sample stream.
   */
  async function canvasToPdfImage(canvas) {
    var ctx = canvas.getContext('2d');
    var src = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    var rgb = new Uint8Array((src.length / 4) * 3);
    for (var i = 0, j = 0; i < src.length; i += 4, j += 3) {
      rgb[j] = src[i];
      rgb[j + 1] = src[i + 1];
      rgb[j + 2] = src[i + 2];
    }
    return {
      width: canvas.width,
      height: canvas.height,
      filter: 'FlateDecode',
      data: await deflateZlib(rgb),
    };
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * EXPORTS
   * ══════════════════════════════════════════════════════════════════════════ */

  root.BTD.exportUtils = {
    CLASSIFICATION: CLASSIFICATION,
    CLASSIFICATION_SLUG: CLASSIFICATION_SLUG,
    slug: slug,
    buildFilename: buildFilename,
    csvCell: csvCell,
    toCSV: toCSV,
    csvBlob: csvBlob,
    crc32: crc32,
    buildZip: buildZip,
    adler32: adler32,
    storedZlib: storedZlib,
    deflateZlib: deflateZlib,
    buildPdf: buildPdf,
    pdfString: pdfString,
    latin1Bytes: latin1Bytes,
    concatBytes: concatBytes,
    downloadBlob: downloadBlob,
    composeChartCanvas: composeChartCanvas,
    canvasToPngBytes: canvasToPngBytes,
    canvasToPdfImage: canvasToPdfImage,
  };
})(typeof window !== 'undefined' ? window : globalThis);
