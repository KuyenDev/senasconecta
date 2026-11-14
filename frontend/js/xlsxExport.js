/**
 * Generador minimalista de libros Excel (.xlsx) en JavaScript puro sin dependencias.
 * Construye un archivo ZIP (método Store + CRC32) con estructura OOXML compatible
 * con Excel, LibreOffice Calc, Google Sheets y lectores Python/openpyxl.
 */

const INVALID_XML_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const utf8Encoder = typeof TextEncoder === 'function' ? new TextEncoder() : null;

function encodeUtf8(str) {
  const s = String(str ?? '');
  if (utf8Encoder) return utf8Encoder.encode(s);
  const out = [];
  for (let i = 0; i < s.length; i += 1) {
    let code = s.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length) {
      const low = s.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i += 1;
      }
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return new Uint8Array(out);
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(INVALID_XML_RE, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colIndexToLetters(idx) {
  let n = idx + 1;
  let out = '';
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

function sanitizeSheetName(name, fallbackIdx) {
  const cleaned = String(name ?? `Hoja ${fallbackIdx}`)
    .replace(/[:\\/?*\[\]]/g, ' ')
    .trim()
    .slice(0, 31);
  return cleaned || `Hoja ${fallbackIdx}`;
}

function writeU16LE(view, offset, val) {
  view.setUint16(offset, val & 0xffff, true);
}

function writeU32LE(view, offset, val) {
  view.setUint32(offset, val >>> 0, true);
}

function buildZipStore(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  // Marca de tiempo DOS fija válida (2026-01-01 00:00) para evitar advertencias de ZIP
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

  for (const entry of entries) {
    const nameBytes = encodeUtf8(entry.name);
    const dataBytes = typeof entry.content === 'string' ? encodeUtf8(entry.content) : entry.content;
    const sum = crc32(dataBytes);

    const localBuf = new ArrayBuffer(30 + nameBytes.length);
    const lv = new DataView(localBuf);
    writeU32LE(lv, 0, 0x04034b50);
    writeU16LE(lv, 4, 20);
    writeU16LE(lv, 6, 0x0800); // Bandera UTF-8
    writeU16LE(lv, 8, 0);      // Método 0 (Store)
    writeU16LE(lv, 10, dosTime);
    writeU16LE(lv, 12, dosDate);
    writeU32LE(lv, 14, sum);
    writeU32LE(lv, 18, dataBytes.length);
    writeU32LE(lv, 22, dataBytes.length);
    writeU16LE(lv, 26, nameBytes.length);
    writeU16LE(lv, 28, 0);
    new Uint8Array(localBuf, 30).set(nameBytes);

    localParts.push(new Uint8Array(localBuf), dataBytes);

    const cdBuf = new ArrayBuffer(46 + nameBytes.length);
    const cv = new DataView(cdBuf);
    writeU32LE(cv, 0, 0x02014b50);
    writeU16LE(cv, 4, 20);
    writeU16LE(cv, 6, 20);
    writeU16LE(cv, 8, 0x0800);
    writeU16LE(cv, 10, 0);
    writeU16LE(cv, 12, dosTime);
    writeU16LE(cv, 14, dosDate);
    writeU32LE(cv, 16, sum);
    writeU32LE(cv, 20, dataBytes.length);
    writeU32LE(cv, 24, dataBytes.length);
    writeU16LE(cv, 28, nameBytes.length);
    writeU16LE(cv, 30, 0);
    writeU16LE(cv, 32, 0);
    writeU16LE(cv, 34, 0);
    writeU16LE(cv, 36, 0);
    writeU32LE(cv, 38, 0);
    writeU32LE(cv, 42, offset);
    new Uint8Array(cdBuf, 46).set(nameBytes);
    centralParts.push(new Uint8Array(cdBuf));

    offset += localBuf.byteLength + dataBytes.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const part of centralParts) cdSize += part.length;

  const eocdBuf = new ArrayBuffer(22);
  const ev = new DataView(eocdBuf);
  writeU32LE(ev, 0, 0x06054b50);
  writeU16LE(ev, 4, 0);
  writeU16LE(ev, 6, 0);
  writeU16LE(ev, 8, entries.length);
  writeU16LE(ev, 10, entries.length);
  writeU32LE(ev, 12, cdSize);
  writeU32LE(ev, 16, cdOffset);
  writeU16LE(ev, 20, 0);

  const totalBytes = offset + cdSize + eocdBuf.byteLength;
  const archive = new Uint8Array(totalBytes);
  let pos = 0;
  for (const p of localParts) {
    archive.set(p, pos);
    pos += p.length;
  }
  for (const p of centralParts) {
    archive.set(p, pos);
    pos += p.length;
  }
  archive.set(new Uint8Array(eocdBuf), pos);
  return archive;
}

/**
 * Construye los bytes binarios de un libro Excel (.xlsx) válido a partir de hojas [{ name, rows }].
 */
export function buildXlsxBytes(sheets) {
  const sharedStrings = [];
  const sharedMap = new Map();

  function internString(val) {
    const s = String(val ?? '').replace(INVALID_XML_RE, '');
    if (!sharedMap.has(s)) {
      sharedMap.set(s, sharedStrings.length);
      sharedStrings.push(s);
    }
    return sharedMap.get(s);
  }

  const sheetXmls = [];
  const wbSheetsXml = [];
  const wbRelsXml = [
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rIdShared" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>',
  ];
  const ctOverridesXml = [
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>',
  ];

  sheets.forEach((sheet, sheetIdx) => {
    const idx = sheetIdx + 1;
    const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
    const maxCols = rows.reduce((acc, r) => Math.max(acc, Array.isArray(r) ? r.length : 0), 0);
    const colWidths = new Array(maxCols).fill(12);

    const rowXml = [];
    rows.forEach((row, rOffset) => {
      const rNum = rOffset + 1;
      const styleAttr = rNum === 1 ? ' s="1"' : '';
      const cellXml = [];
      for (let cIdx = 0; cIdx < (Array.isArray(row) ? row.length : 0); cIdx += 1) {
        const val = row[cIdx];
        if (val === null || val === undefined || val === '') continue;
        const txtLen = String(val).length;
        colWidths[cIdx] = Math.min(44, Math.max(colWidths[cIdx], txtLen + 3));

        const ref = `${colIndexToLetters(cIdx)}${rNum}`;
        if (rNum > 1 && typeof val === 'number' && Number.isFinite(val)) {
          cellXml.push(`<c r="${ref}"><v>${val}</v></c>`);
        } else {
          // Usar sharedStrings evita cualquier interpretación de cadenas como fórmulas
          const sIdx = internString(val);
          cellXml.push(`<c r="${ref}" t="s"${styleAttr}><v>${sIdx}</v></c>`);
        }
      }
      if (cellXml.length) {
        rowXml.push(`<row r="${rNum}">${cellXml.join('')}</row>`);
      }
    });

    const colsXml = colWidths.length
      ? `<cols>${colWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
      : '';

    sheetXmls.push({
      name: `xl/worksheets/sheet${idx}.xml`,
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        colsXml +
        `<sheetData>${rowXml.join('')}</sheetData>` +
        '</worksheet>',
    });

    const safeName = escapeXml(sanitizeSheetName(sheet.name, idx));
    wbSheetsXml.push(`<sheet name="${safeName}" sheetId="${idx}" r:id="rIdSheet${idx}"/>`);
    wbRelsXml.push(
      `<Relationship Id="rIdSheet${idx}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${idx}.xml"/>`
    );
    ctOverridesXml.push(
      `<Override PartName="/xl/worksheets/sheet${idx}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    );
  });

  const sharedStringsXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">` +
    sharedStrings.map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`).join('') +
    '</sst>';

  const stylesXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2">' +
    '<font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="3">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF163024"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '</cellXfs>' +
    '</styleSheet>';

  const workbookXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets>${wbSheetsXml.join('')}</sheets>` +
    '</workbook>';

  const workbookRelsXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `${wbRelsXml.join('')}</Relationships>`;

  const rootRelsXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const contentTypesXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-officedocument.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    `${ctOverridesXml.join('')}</Types>`;

  return buildZipStore([
    { name: '[Content_Types].xml', content: contentTypesXml },
    { name: '_rels/.rels', content: rootRelsXml },
    { name: 'xl/workbook.xml', content: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRelsXml },
    { name: 'xl/styles.xml', content: stylesXml },
    { name: 'xl/sharedStrings.xml', content: sharedStringsXml },
    ...sheetXmls,
  ]);
}

/**
 * Envuelve los bytes binarios .xlsx en un Blob descargable por el navegador.
 */
export function buildXlsxBlob(sheets) {
  const bytes = buildXlsxBytes(sheets);
  return new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
