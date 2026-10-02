import { config } from './config.js';

/** Ikki nuqta orasidagi masofa (metr), Haversine formulasi */
export function distanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** { ok, reason, distance } — talaba TTPU hududidami? */
export function checkCampus(loc, c = config) {
  if (!loc || typeof loc !== 'object') return { ok: false, reason: 'no_location' };
  const lat = Number(loc.lat);
  const lon = Number(loc.lon);
  const acc = Number(loc.accuracy);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return { ok: false, reason: 'no_location' };
  }
  const distance = Math.round(distanceM(lat, lon, c.campusLat, c.campusLon));
  if (Number.isFinite(acc) && acc > c.maxGpsAccuracyM) {
    return { ok: false, reason: 'gps_inaccurate', distance, accuracy: Math.round(acc) };
  }
  if (distance > c.campusRadiusM) return { ok: false, reason: 'outside_campus', distance };
  return { ok: true, distance };
}
