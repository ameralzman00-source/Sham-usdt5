const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { visualLines } = require("./arabicText");

const FONT_PATH = path.join(__dirname, "fonts", "Amiri-Regular.ttf");

function u16(buf, o) {
  return buf.readUInt16BE(o);
}

function i16(buf, o) {
  return buf.readInt16BE(o);
}

function u32(buf, o) {
  return buf.readUInt32BE(o);
}

function readTables(buf) {
  const num = u16(buf, 4);
  const tables = {};
  for (let i = 0; i < num; i += 1) {
    const off = 12 + i * 16;
    const tag = buf.slice(off, off + 4).toString("ascii");
    tables[tag] = { offset: u32(buf, off + 8), length: u32(buf, off + 12) };
  }
  return tables;
}

function parseCmap(buf, tables) {
  const t = tables.cmap;
  if (!t) return new Map();
  const base = t.offset;
  const num = u16(buf, base + 2);
  let rec = 0;
  for (let i = 0; i < num; i += 1) {
    const plat = u16(buf, base + 4 + i * 8);
    const enc = u16(buf, base + 6 + i * 8);
    const offset = u32(buf, base + 8 + i * 8);
    if ((plat === 3 && (enc === 1 || enc === 10)) || plat === 0) {
      rec = base + offset;
      if (plat === 3 && enc === 1) break;
    }
  }
  const map = new Map();
  if (!rec) return map;
  const format = u16(buf, rec);
  if (format === 4) {
    const segCount = u16(buf, rec + 6) / 2;
    const endCodes = [];
    const startCodes = [];
    const idDeltas = [];
    const idRangeOffsets = [];
    let p = rec + 14;
    for (let i = 0; i < segCount; i += 1, p += 2) endCodes.push(u16(buf, p));
    p += 2;
    for (let i = 0; i < segCount; i += 1, p += 2) startCodes.push(u16(buf, p));
    for (let i = 0; i < segCount; i += 1, p += 2) idDeltas.push(i16(buf, p));
    const rangeOffStart = p;
    for (let i = 0; i < segCount; i += 1, p += 2) idRangeOffsets.push(u16(buf, p));
    for (let i = 0; i < segCount; i += 1) {
      for (let c = startCodes[i]; c <= endCodes[i]; c += 1) {
        let gid = 0;
        if (idRangeOffsets[i] === 0) gid = (c + idDeltas[i]) & 0xffff;
        else {
          const addr = rangeOffStart + 2 * i + idRangeOffsets[i] + 2 * (c - startCodes[i]);
          const g = u16(buf, addr);
          gid = g ? (g + idDeltas[i]) & 0xffff : 0;
        }
        if (gid) map.set(c, gid);
      }
    }
  } else if (format === 12) {
    const nGroups = u32(buf, rec + 12);
    let p = rec + 16;
    for (let i = 0; i < nGroups; i += 1, p += 12) {
      const start = u32(buf, p);
      const end = u32(buf, p + 4);
      let gid = u32(buf, p + 8);
      for (let c = start; c <= end; c += 1, gid += 1) map.set(c, gid);
    }
  }
  return map;
}

function parseMetrics(buf, tables) {
  const head = tables.head.offset;
  const hhea = tables.hhea.offset;
  const maxp = tables.maxp.offset;
  const units = u16(buf, head + 18) || 2048;
  const xMin = i16(buf, head + 36);
  const yMin = i16(buf, head + 38);
  const xMax = i16(buf, head + 40);
  const yMax = i16(buf, head + 42);
  const asc = i16(buf, hhea + 4);
  const desc = i16(buf, hhea + 6);
  const numGlyphs = u16(buf, maxp + 4);
  const nH = u16(buf, hhea + 34);
  const hmtx = tables.hmtx.offset;
  const advances = [];
  let last = 0;
  for (let i = 0; i < numGlyphs; i += 1) {
    if (i < nH) last = u16(buf, hmtx + i * 4);
    advances.push(last);
  }
  const scale = 1000 / units;
  return {
    bbox: [Math.round(xMin * scale), Math.round(yMin * scale), Math.round(xMax * scale), Math.round(yMax * scale)],
    ascent: Math.round(asc * scale),
    descent: Math.round(desc * scale),
    advances: advances.map((w) => Math.round(w * scale)),
    units
  };
}

let fontCache = null;

function loadFont() {
  if (fontCache) return fontCache;
  const data = fs.readFileSync(FONT_PATH);
  const tables = readTables(data);
  const cmap = parseCmap(data, tables);
  const metrics = parseMetrics(data, tables);
  fontCache = { data, cmap, metrics };
  return fontCache;
}

function wrapText(text, maxChars) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function gidsFor(visual, cmap) {
  const gids = [];
  for (const ch of visual) {
    const cp = ch.codePointAt(0);
    const gid = cmap.get(cp) || cmap.get(0x20) || 0;
    gids.push(gid);
  }
  return gids;
}

function hexGids(gids) {
  return gids.map((g) => g.toString(16).padStart(4, "0")).join("");
}

function widthOf(gids, advances, size) {
  let w = 0;
  for (const g of gids) w += advances[g] || 500;
  return (w * size) / 1000;
}

function buildPdf(title, sections) {
  const font = loadFont();
  const { cmap, metrics, data: ttf } = font;
  const pageW = 595.28;
  const pageH = 841.89;
  const margin = 46;
  const contentW = pageW - margin * 2;
  const titleSize = 18;
  const headingSize = 13;
  const bodySize = 11;
  const lineH = 17;
  const maxChars = 62;

  const pages = [];
  let y = pageH - margin - 10;
  let blocks = [];

  function newPage() {
    if (blocks.length) pages.push(blocks);
    blocks = [];
    y = pageH - margin - 10;
  }

  function addLine(text, size, color, gap) {
    const h = gap || lineH;
    if (y - h < margin + 20) newPage();
    blocks.push({ text, size, color, y });
    y -= h;
  }

  addLine(title, titleSize, [0.08, 0.1, 0.14], 26);
  addLine("USDT Sham  ·  P2P Syria", 10, [0.72, 0.54, 0.12], 20);

  for (const section of sections) {
    if (y < margin + 80) newPage();
    addLine(section.title, headingSize, [0.08, 0.1, 0.14], 22);
    const paras = String(section.body || "").split(/\n/).filter((p) => p.trim());
    for (const para of paras) {
      for (const line of wrapText(para.trim(), maxChars)) {
        addLine(line, bodySize, [0.2, 0.23, 0.28], lineH);
      }
      y -= 3;
    }
    y -= 6;
  }
  if (blocks.length) pages.push(blocks);
  if (!pages.length) pages.push([]);

  const compressed = zlib.deflateSync(ttf);
  const objects = [];

  function add(str) {
    objects.push(Buffer.isBuffer(str) ? str : Buffer.from(String(str), "utf8"));
    return objects.length;
  }

  const fontFileId = add(
    Buffer.concat([
      Buffer.from(`<< /Length ${compressed.length} /Length1 ${ttf.length} /Filter /FlateDecode >>\nstream\n`),
      compressed,
      Buffer.from("\nendstream")
    ])
  );
  const descId = add(
    `<< /Type /FontDescriptor /FontName /Amiri /Flags 32 /ItalicAngle 0 /Ascent ${metrics.ascent} /Descent ${metrics.descent} /CapHeight ${Math.abs(metrics.ascent)} /StemV 80 /FontBBox [${metrics.bbox.join(" ")}] /FontFile2 ${fontFileId} 0 R >>`
  );
  const cidId = add(
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Amiri /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descId} 0 R /DW 500 /CIDToGIDMap /Identity >>`
  );
  const fontId = add(
    `<< /Type /Font /Subtype /Type0 /BaseFont /Amiri /Encoding /Identity-H /DescendantFonts [${cidId} 0 R] >>`
  );

  const contentIds = [];
  pages.forEach((pageBlocks, idx) => {
    const ops = [];
    ops.push("q");
    ops.push("0.035 0.043 0.055 rg");
    ops.push(`0 0 ${pageW} ${pageH} re f`);
    ops.push("0.91 0.77 0.28 rg");
    ops.push(`${margin} ${pageH - 26} ${contentW} 3.5 re f`);
    ops.push("Q");
    pageBlocks.forEach((b) => {
      const visual = visualLines(b.text)[0] || "";
      const gids = gidsFor(visual, cmap);
      if (!gids.length) return;
      const tw = widthOf(gids, metrics.advances, b.size);
      const x = Math.max(margin, pageW - margin - tw);
      const [r, g, bl] = b.color;
      ops.push("BT");
      ops.push(`/F1 ${b.size} Tf`);
      ops.push(`${r} ${g} ${bl} rg`);
      ops.push(`1 0 0 1 ${x.toFixed(2)} ${b.y.toFixed(2)} Tm`);
      ops.push(`<${hexGids(gids)}> Tj`);
      ops.push("ET");
    });
    ops.push("0.91 0.77 0.28 rg");
    ops.push(`${margin} 30 ${contentW} 2 re f`);
    ops.push("BT");
    ops.push(`/F1 8 Tf`);
    ops.push("0.55 0.58 0.62 rg");
    const footer = visualLines(`USDT شام  ·  ${idx + 1}`)[0];
    const fg = gidsFor(footer, cmap);
    ops.push(`1 0 0 1 ${margin} 16 Tm`);
    ops.push(`<${hexGids(fg)}> Tj`);
    ops.push("ET");
    const stream = Buffer.from(ops.join("\n"), "utf8");
    contentIds.push(
      add(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from("\nendstream")]))
    );
  });

  const pageIds = [];
  const pagesIdPlaceholder = objects.length + contentIds.length + 1;
  contentIds.forEach((cid) => {
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesIdPlaceholder} 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${cid} 0 R >>`
      )
    );
  });
  const pagesId = add(`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`);
  if (pagesId !== pagesIdPlaceholder) {
    for (let i = 0; i < pageIds.length; i += 1) {
      objects[pageIds[i] - 1] = Buffer.from(
        objects[pageIds[i] - 1].toString("utf8").replace(new RegExp(String(pagesIdPlaceholder), "g"), String(pagesId)),
        "utf8"
      );
    }
  }
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  const header = Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const parts = [header];
  const offsets = [0];
  let pos = header.length;
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(pos);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), objects[i], Buffer.from("\nendobj\n")]);
    parts.push(chunk);
    pos += chunk.length;
  }
  const xrefPos = pos;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  parts.push(Buffer.from(xref, "utf8"));
  parts.push(Buffer.from(trailer, "utf8"));
  return Buffer.concat(parts);
}

module.exports = { buildPdf, wrapText };
