// face-api.js 128 o'lchamli yuz descriptorlari bilan ishlash (sof funksiyalar)

export function isDescriptor(d) {
  return Array.isArray(d) && d.length === 128 && d.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 2);
}

export function euclid(a, b) {
  let s = 0;
  for (let i = 0; i < 128; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

export function mean(list) {
  const out = new Array(128).fill(0);
  for (const d of list) for (let i = 0; i < 128; i++) out[i] += d[i] / list.length;
  return out;
}

/**
 * Ro'yxatga olish: 3–5 ta kadr kerak, hammasi bitta odamniki bo'lishi shart.
 * { ok, descriptor, reason }
 */
export function buildEnrollment(samples, consistency = 0.45) {
  if (!Array.isArray(samples) || samples.length < 3 || samples.length > 8) return { ok: false, reason: 'need_samples' };
  if (!samples.every(isDescriptor)) return { ok: false, reason: 'bad_descriptor' };
  for (let i = 0; i < samples.length; i++)
    for (let j = i + 1; j < samples.length; j++)
      if (euclid(samples[i], samples[j]) > consistency) return { ok: false, reason: 'inconsistent_faces' };
  return { ok: true, descriptor: mean(samples).map((x) => Math.round(x * 1e6) / 1e6) };
}

/** Tekshirish: har bir kadr saqlangan yuzga yaqin bo'lishi kerak. { ok, distance } */
export function verifyAgainst(stored, samples, threshold = 0.5) {
  if (!isDescriptor(stored)) return { ok: false, reason: 'not_enrolled' };
  if (!Array.isArray(samples) || samples.length < 2 || samples.length > 8) return { ok: false, reason: 'need_samples' };
  if (!samples.every(isDescriptor)) return { ok: false, reason: 'bad_descriptor' };
  const dists = samples.map((s) => euclid(stored, s));
  const worst = Math.max(...dists);
  const avg = dists.reduce((a, b) => a + b, 0) / dists.length;
  return { ok: worst <= threshold + 0.05 && avg <= threshold, distance: Math.round(avg * 1000) / 1000 };
}
