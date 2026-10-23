(function (global) {
  'use strict';

  const td = new TextDecoder('utf-8');
  const u16 = (v, o) => v.getUint16(o, true);
  const u32 = (v, o) => v.getUint32(o, true);

  async function inflateRaw(bytes) {
    if (global.pako?.inflateRaw) return new Uint8Array(global.pako.inflateRaw(bytes));
    if (typeof DecompressionStream !== 'undefined') {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    throw new Error('רכיב פתיחת ה־XLSX אינו זמין. ודאו שהקובץ pako_inflate.min.js נמצא לצד index.html.');
  }

  async function unzip(buffer) {
    const view = new DataView(buffer);
    let eocd = -1;
    for (let i = Math.max(0, buffer.byteLength - 65557); i <= buffer.byteLength - 22; i++) {
      if (u32(view, i) === 0x06054b50) eocd = i;
    }
    if (eocd < 0) throw new Error('הקובץ אינו קובץ XLSX תקין.');
    const count = u16(view, eocd + 10);
    let cursor = u32(view, eocd + 16);
    const files = {};
    for (let i = 0; i < count; i++) {
      if (u32(view, cursor) !== 0x02014b50) throw new Error('מבנה ה־XLSX אינו תקין.');
      const method = u16(view, cursor + 10);
      const compressedSize = u32(view, cursor + 20);
      const nameLength = u16(view, cursor + 28);
      const extraLength = u16(view, cursor + 30);
      const commentLength = u16(view, cursor + 32);
      const localOffset = u32(view, cursor + 42);
      const name = td.decode(new Uint8Array(buffer, cursor + 46, nameLength));
      if (u32(view, localOffset) !== 0x04034b50) throw new Error('רשומת ZIP מקומית חסרה.');
      const localNameLength = u16(view, localOffset + 26);
      const localExtraLength = u16(view, localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = new Uint8Array(buffer, start, compressedSize);
      if (method === 0) files[name] = new Uint8Array(compressed);
      else if (method === 8) files[name] = await inflateRaw(compressed);
      else throw new Error('שיטת דחיסה לא נתמכת בתוך XLSX: ' + method);
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return files;
  }

  function decodeXml(value) {
    return String(value || '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
  }

  function attrs(tag) {
    const out = {};
    String(tag).replace(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (_, k, a, b) => {
      out[k] = decodeXml(a ?? b ?? ''); return '';
    });
    return out;
  }

  function normalizePath(path) {
    const parts = [];
    String(path).split('/').forEach(part => {
      if (!part || part === '.') return;
      if (part === '..') parts.pop(); else parts.push(part);
    });
    return parts.join('/');
  }

  function colIndex(ref) {
    const letters = String(ref || 'A1').match(/[A-Z]+/i)?.[0]?.toUpperCase() || 'A';
    let value = 0;
    for (const ch of letters) value = value * 26 + ch.charCodeAt(0) - 64;
    return value - 1;
  }

  function tagText(xml, tag) {
    const p = '(?:[\\w.-]+:)?';
    const m = String(xml).match(new RegExp('<' + p + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + p + tag + '>', 'i'));
    return m ? decodeXml(m[1].replace(/<[^>]+>/g, '')) : '';
  }

  function sharedStrings(files) {
    const bytes = files['xl/sharedStrings.xml'];
    if (!bytes) return [];
    const source = td.decode(bytes), values = [];
    for (const match of source.matchAll(/<(?:[\w.-]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?si>/gi)) {
      values.push([...match[1].matchAll(/<(?:[\w.-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?t>/gi)].map(x => decodeXml(x[1])).join(''));
    }
    return values;
  }

  function parseSheet(bytes, shared) {
    const source = td.decode(bytes), matrix = [];
    for (const rowMatch of source.matchAll(/<(?:[\w.-]+:)?row\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?row>/gi)) {
      const rowAttr = attrs(rowMatch[1]);
      const rowNumber = Math.max(1, Number(rowAttr.r) || matrix.length + 1);
      const row = matrix[rowNumber - 1] || [];
      for (const cellMatch of rowMatch[2].matchAll(/<(?:[\w.-]+:)?c\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/(?:[\w.-]+:)?c>)/gi)) {
        const cellAttr = attrs(cellMatch[1]);
        const index = colIndex(cellAttr.r);
        const type = cellAttr.t || '';
        const body = cellMatch[2] || '';
        const raw = tagText(body, 'v');
        let value = raw;
        if (type === 's') value = shared[Number(raw)] ?? '';
        else if (type === 'inlineStr') value = [...body.matchAll(/<(?:[\w.-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?t>/gi)].map(x => decodeXml(x[1])).join('');
        else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
        else if (raw !== '' && Number.isFinite(Number(raw))) value = Number(raw);
        row[index] = value;
      }
      matrix[rowNumber - 1] = row;
    }
    return Array.from({ length: matrix.length }, (_, index) => matrix[index] || []);
  }

  async function parse(file) {
    const files = await unzip(await file.arrayBuffer());
    const workbookSource = td.decode(files['xl/workbook.xml'] || new Uint8Array());
    const relsSource = td.decode(files['xl/_rels/workbook.xml.rels'] || new Uint8Array());
    if (!workbookSource || !relsSource) throw new Error('חסרים רכיבי workbook בתוך ה־XLSX.');
    const rels = {};
    for (const match of relsSource.matchAll(/<Relationship\b([^>]*?)(?:\/\s*>|>[\s\S]*?<\/Relationship>)/gi)) {
      const a = attrs(match[1]); if (a.Id && a.Target) rels[a.Id] = a.Target;
    }
    const shared = sharedStrings(files), sheets = {};
    for (const match of workbookSource.matchAll(/<(?:[\w.-]+:)?sheet\b([^>]*?)(?:\/\s*>|>[\s\S]*?<\/(?:[\w.-]+:)?sheet>)/gi)) {
      const a = attrs(match[1]), target = rels[a['r:id']];
      if (!a.name || !target) continue;
      const path = target.startsWith('/') ? target.slice(1) : normalizePath('xl/' + target);
      if (files[path]) sheets[a.name] = parseSheet(files[path], shared);
    }
    if (!Object.keys(sheets).length) throw new Error('לא נמצאו גיליונות בתוך קובץ ה־XLSX.');
    return { sheets };
  }

  global.LocalXlsx = { parse };
})(window);
