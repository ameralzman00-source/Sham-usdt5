const ISOLATED = 0;
const FINAL = 1;
const INITIAL = 2;
const MEDIAL = 3;

const FORMS = {
  0x0621: [0xFE80],
  0x0622: [0xFE81, 0xFE82],
  0x0623: [0xFE83, 0xFE84],
  0x0624: [0xFE85, 0xFE86],
  0x0625: [0xFE87, 0xFE88],
  0x0626: [0xFE89, 0xFE8A, 0xFE8B, 0xFE8C],
  0x0627: [0xFE8D, 0xFE8E],
  0x0628: [0xFE8F, 0xFE90, 0xFE91, 0xFE92],
  0x0629: [0xFE93, 0xFE94],
  0x062A: [0xFE95, 0xFE96, 0xFE97, 0xFE98],
  0x062B: [0xFE99, 0xFE9A, 0xFE9B, 0xFE9C],
  0x062C: [0xFE9D, 0xFE9E, 0xFE9F, 0xFEA0],
  0x062D: [0xFEA1, 0xFEA2, 0xFEA3, 0xFEA4],
  0x062E: [0xFEA5, 0xFEA6, 0xFEA7, 0xFEA8],
  0x062F: [0xFEA9, 0xFEAA],
  0x0630: [0xFEAB, 0xFEAC],
  0x0631: [0xFEAD, 0xFEAE],
  0x0632: [0xFEAF, 0xFEB0],
  0x0633: [0xFEB1, 0xFEB2, 0xFEB3, 0xFEB4],
  0x0634: [0xFEB5, 0xFEB6, 0xFEB7, 0xFEB8],
  0x0635: [0xFEB9, 0xFEBA, 0xFEBB, 0xFEBC],
  0x0636: [0xFEBD, 0xFEBE, 0xFEBF, 0xFEC0],
  0x0637: [0xFEC1, 0xFEC2, 0xFEC3, 0xFEC4],
  0x0638: [0xFEC5, 0xFEC6, 0xFEC7, 0xFEC8],
  0x0639: [0xFEC9, 0xFECA, 0xFECB, 0xFECC],
  0x063A: [0xFECD, 0xFECE, 0xFECF, 0xFED0],
  0x0641: [0xFED1, 0xFED2, 0xFED3, 0xFED4],
  0x0642: [0xFED5, 0xFED6, 0xFED7, 0xFED8],
  0x0643: [0xFED9, 0xFEDA, 0xFEDB, 0xFEDC],
  0x0644: [0xFEDD, 0xFEDE, 0xFEDF, 0xFEE0],
  0x0645: [0xFEE1, 0xFEE2, 0xFEE3, 0xFEE4],
  0x0646: [0xFEE5, 0xFEE6, 0xFEE7, 0xFEE8],
  0x0647: [0xFEE9, 0xFEEA, 0xFEEB, 0xFEEC],
  0x0648: [0xFEED, 0xFEEE],
  0x0649: [0xFEEF, 0xFEF0],
  0x064A: [0xFEF1, 0xFEF2, 0xFEF3, 0xFEF4],
  0x067E: [0xFB56, 0xFB57, 0xFB58, 0xFB59],
  0x0686: [0xFB7A, 0xFB7B, 0xFB7C, 0xFB7D],
  0x0698: [0xFB8A, 0xFB8B],
  0x06A9: [0xFB8E, 0xFB8F, 0xFB90, 0xFB91],
  0x06AF: [0xFB92, 0xFB93, 0xFB94, 0xFB95],
  0x06CC: [0xFBFC, 0xFBFD, 0xFBFE, 0xFBFF]
};

const LAM = 0x0644;
const ALEFS = {
  0x0622: [0xFEF5, 0xFEF6],
  0x0623: [0xFEF7, 0xFEF8],
  0x0625: [0xFEF9, 0xFEFA],
  0x0627: [0xFEFB, 0xFEFC]
};

function isTransparent(cp) {
  return (cp >= 0x064B && cp <= 0x065F) || cp === 0x0670 || (cp >= 0x06D6 && cp <= 0x06ED);
}

function letterForm(cp) {
  return FORMS[cp] || null;
}

function connectsAfter(cp) {
  const f = letterForm(cp);
  return !!(f && f.length >= 3);
}

function connectsBefore(cp) {
  return !!letterForm(cp);
}

function nextLetter(chars, i) {
  for (let j = i + 1; j < chars.length; j += 1) {
    if (isTransparent(chars[j])) continue;
    return { cp: chars[j], index: j };
  }
  return null;
}

function prevLetter(chars, i) {
  for (let j = i - 1; j >= 0; j -= 1) {
    if (isTransparent(chars[j])) continue;
    return { cp: chars[j], index: j };
  }
  return null;
}

function reshapeArabic(text) {
  const chars = [];
  for (const ch of String(text || "")) chars.push(ch.codePointAt(0));
  const out = [];
  for (let i = 0; i < chars.length; i += 1) {
    const cp = chars[i];
    if (isTransparent(cp) || !letterForm(cp)) {
      out.push(cp);
      continue;
    }
    if (cp === LAM) {
      const nxt = nextLetter(chars, i);
      if (nxt && ALEFS[nxt.cp]) {
        const prev = prevLetter(chars, i);
        const joinPrev = prev && connectsAfter(prev.cp);
        const lig = ALEFS[nxt.cp][joinPrev ? 1 : 0];
        out.push(lig);
        for (let j = i + 1; j < nxt.index; j += 1) out.push(chars[j]);
        i = nxt.index;
        continue;
      }
    }
    const prev = prevLetter(chars, i);
    const nxt = nextLetter(chars, i);
    const joinPrev = prev && connectsAfter(prev.cp) && connectsBefore(cp);
    const joinNext = nxt && connectsAfter(cp) && connectsBefore(nxt.cp);
    let form = ISOLATED;
    if (joinPrev && joinNext) form = MEDIAL;
    else if (joinPrev) form = FINAL;
    else if (joinNext) form = INITIAL;
    const forms = letterForm(cp);
    const mapped = forms[Math.min(form, forms.length - 1)] || cp;
    out.push(mapped);
  }
  return out.map((cp) => String.fromCodePoint(cp)).join("");
}

function isRtlChar(ch) {
  return /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(ch);
}

function isLtrChar(ch) {
  return /[A-Za-z0-9@._:\/\\#+\-]/.test(ch);
}

function tokenize(text) {
  const s = String(text || "");
  const tokens = [];
  let buf = "";
  let type = "";
  function flush() {
    if (buf) tokens.push({ type, text: buf });
    buf = "";
    type = "";
  }
  for (const ch of s) {
    const t = isRtlChar(ch) ? "rtl" : isLtrChar(ch) ? "ltr" : "neutral";
    if (!type) {
      type = t;
      buf = ch;
    } else if (t === type || (t === "neutral" && type !== "ltr")) {
      buf += ch;
    } else {
      flush();
      type = t;
      buf = ch;
    }
  }
  flush();
  return tokens;
}

function toVisualRtl(text) {
  const tokens = tokenize(text);
  const visual = [];
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const tok = tokens[i];
    if (tok.type === "rtl") {
      const shaped = reshapeArabic(tok.text);
      visual.push([...shaped].reverse().join(""));
    } else {
      visual.push(tok.text);
    }
  }
  return visual.join("");
}

function visualLines(text) {
  return String(text || "")
    .split(/\n/)
    .map((line) => toVisualRtl(line));
}

module.exports = { reshapeArabic, toVisualRtl, visualLines };
