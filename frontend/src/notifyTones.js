const TONE_KEY = "pexora_alert_tone";

export const TONES = [
  { id: "sham", name: "شام ذهبية", hint: "النغمة الحالية للتطبيق", notes: [[880, 0], [1174, 0.22], [880, 0.44]] },
  { id: "bell", name: "جرس", hint: "رنين واضح", notes: [[784, 0], [988, 0.18], [1175, 0.36]] },
  { id: "ping", name: "نبضة", hint: "تنبيه قصير", notes: [[1320, 0], [990, 0.16]] },
  { id: "cash", name: "صفقة", hint: "مناسبة للصفقات", notes: [[523, 0], [659, 0.14], [784, 0.28], [1047, 0.44]] },
  { id: "alert", name: "إنذار", hint: "أقوى وأوضح", notes: [[740, 0], [740, 0.2], [988, 0.4]] },
  { id: "silent", name: "صامت", hint: "اهتزاز فقط بدون صوت", notes: [] }
];

export function readToneId() {
  try {
    const id = localStorage.getItem(TONE_KEY) || "sham";
    return TONES.some((t) => t.id === id) ? id : "sham";
  } catch {
    return "sham";
  }
}

export function readTone() {
  const id = readToneId();
  return TONES.find((t) => t.id === id) || TONES[0];
}

export function saveToneId(id) {
  const tone = TONES.find((t) => t.id === id) || TONES[0];
  try {
    localStorage.setItem(TONE_KEY, tone.id);
  } catch {
    /* ignore */
  }
  return tone;
}

let audioCtx;

function context() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx || audioCtx.state === "closed") audioCtx = new Ctx();
  return audioCtx;
}

export function vibrateAlert() {
  try {
    if (navigator.vibrate) navigator.vibrate([450, 180, 450, 180, 700]);
  } catch {
    /* ignore */
  }
}

export function playTone(id) {
  const tone = TONES.find((t) => t.id === id) || readTone();
  vibrateAlert();
  if (!tone.notes.length) return;
  try {
    const ctx = context();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    tone.notes.forEach(([freq, offset]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.22, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.22);
    });
  } catch {
    /* ignore */
  }
}
