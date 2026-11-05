/**
 * Pure, timezone-aware domain logic. Durations are elapsed time; local dates
 * are only labels for reporting. No payroll or legal-entitlement assumptions.
 */
export const DEFAULT_SETTINGS = Object.freeze({
  weeklyMinutes: 44 * 60,
  timezone: 'America/Sao_Paulo',
  weekStart: 1,
  dailyTargetMinutes: 528,
  reminderTime: '18:30',
  reminderEnabled: false,
});

export function id() { return crypto.randomUUID(); }
export function iso(value) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) throw new Error('Data ou horário inválido.');
  return d.toISOString();
}
export function minutes(ms) { return Math.max(0, Math.round(ms / 60_000)); }
export function fmtMinutes(value) {
  const rounded = Math.round(Math.abs(value));
  return `${value < 0 ? '−' : ''}${Math.floor(rounded / 60)}h${String(rounded % 60).padStart(2, '0')}`;
}
export function localDay(value, zone = DEFAULT_SETTINGS.timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value));
  const part = type => parts.find(p => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function localDateTime(value, zone = DEFAULT_SETTINGS.timezone) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: zone, dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(value));
}
export function localTime(value, zone = DEFAULT_SETTINGS.timezone) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}
export function todayLocal(zone = DEFAULT_SETTINGS.timezone) { return localDay(Date.now(), zone); }
export function shiftDay(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function mondayFor(date) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return shiftDay(date, -(weekday + 6) % 7);
}

/** Statutory weekly ceiling from EC 141/2026. Separate from the user's contractual schedule. */
export function statutoryWeeklyMinutes(day) {
  if (day >= '2027-12-16') return 40 * 60;
  if (day >= '2026-12-16') return 42 * 60;
  return 44 * 60;
}
export function statutoryWeekInfo(fromDay, toDay) {
  const min = statutoryWeeklyMinutes(fromDay), max = statutoryWeeklyMinutes(toDay);
  return { transition: min !== max, limitMinutes: max, beginningMinutes: min, endingMinutes: max };
}

export function isWorkday(day) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return weekday >= 1 && weekday <= 5;
}
export function segments(shift, nowMs = Date.now()) {
  if (shift.type !== 'shift') return [];
  const start = +new Date(shift.start);
  const end = shift.end ? +new Date(shift.end) : nowMs;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  let pieces = [[start, end]];
  for (const b of shift.breaks || []) {
    const first = +new Date(b.start), last = b.end ? +new Date(b.end) : nowMs;
    if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) continue;
    pieces = pieces.flatMap(([a, z]) => {
      const lo = Math.max(a, first), hi = Math.min(z, last);
      return hi <= lo ? [[a, z]] : [[a, lo], [hi, z]].filter(([x, y]) => y > x);
    });
  }
  // A manual pause is a duration adjustment; unlike the first prototype it
  // does not pretend the break happened at the start of the shift.
  if (shift.manualBreakMinutes) {
    let left = Math.min(shift.manualBreakMinutes * 60_000, pieces.reduce((s, [a, b]) => s + b - a, 0));
    pieces = pieces.map(([a, b]) => {
      const subtract = Math.min(left, b - a);
      left -= subtract;
      return [a, b - subtract];
    }).filter(([a, b]) => b > a);
  }
  return pieces;
}
export function unionMinutes(intervals) {
  if (!intervals.length) return 0;
  const sorted = intervals.map(([a, b]) => [a, b]).sort((a, b) => a[0] - b[0]);
  let [a, b] = sorted[0], sum = 0;
  for (const [nextA, nextB] of sorted.slice(1)) {
    if (nextA <= b) b = Math.max(b, nextB);
    else { sum += b - a; [a, b] = [nextA, nextB]; }
  }
  return sum + b - a;
}
// The next São Paulo midnight, computed without assuming a fixed UTC offset.
export function nextMidnight(epochMs, zone = DEFAULT_SETTINGS.timezone) {
  const day = localDay(epochMs, zone);
  const next = shiftDay(day, 1);
  let lo = epochMs, hi = epochMs + 2 * 86_400_000;
  for (let i = 0; i < 44; i++) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDay(mid, zone) < next) lo = mid + 1;
    else hi = mid;
  }
  return hi;
}
export function breakdown(records, fromDay, toDay, settings = DEFAULT_SETTINGS, nowMs = Date.now()) {
  const buckets = new Map();
  const zone = settings.timezone || DEFAULT_SETTINGS.timezone;
  for (const shift of records) {
    if (shift.type !== 'shift' || shift.archivedAt) continue;
    for (const [begin, finish] of segments(shift, nowMs)) {
      let cursor = begin;
      while (cursor < finish) {
        const day = localDay(cursor, zone);
        const stop = Math.min(nextMidnight(cursor, zone), finish);
        if (day >= fromDay && day <= toDay) {
          const bucket = buckets.get(day) || { all: [], markedExtra: [] };
          bucket.all.push([cursor, stop]);
          if (shift.kind === 'extra') bucket.markedExtra.push([cursor, stop]);
          buckets.set(day, bucket);
        }
        cursor = stop;
      }
    }
  }
  let workedMs = 0, flaggedExtraMs = 0;
  const byDay = {};
  for (const [day, ints] of buckets) {
    const worked = unionMinutes(ints.all) / 60_000, markedExtra = unionMinutes(ints.markedExtra) / 60_000;
    const excess = isWorkday(day)
      ? Math.min(worked, Math.max(0, worked - settings.dailyTargetMinutes, markedExtra))
      : worked;
    workedMs += worked;
    flaggedExtraMs += excess;
    byDay[day] = { workedMinutes: Math.round(worked), flaggedExtraMinutes: Math.round(excess), markedExtraMinutes: Math.round(markedExtra) };
  }
  return { byDay, workedMinutes: Math.round(workedMs), flaggedExtraMinutes: Math.round(flaggedExtraMs), weeklyBalanceMinutes: Math.round(workedMs) - settings.weeklyMinutes };
}
export function validateShift(data) {
  if (!['regular', 'extra'].includes(data.kind)) throw new Error('Tipo de jornada inválido.');
  const start = new Date(data.start), end = data.end ? new Date(data.end) : null;
  if (!Number.isFinite(start.getTime()) || (end && !Number.isFinite(end.getTime()))) throw new Error('Horário inválido.');
  if (end && (+end <= +start || +end - +start > 72 * 3_600_000)) throw new Error('O fim deve ser depois do início; use lançamentos de até 72 horas.');
  if (!Number.isInteger(data.manualBreakMinutes ?? 0) || data.manualBreakMinutes < 0 || (end && data.manualBreakMinutes * 60_000 >= +end - +start)) throw new Error('Duração da pausa inválida.');
  if ((data.note || '').length > 8000 || (data.title || '').length > 180) throw new Error('Registro muito longo.');
  return data;
}
export function validateIncident(data) {
  if (!data.title?.trim() || !data.description?.trim()) throw new Error('Título e descrição dos fatos são obrigatórios.');
  if (data.title.length > 180 || data.description.length > 20_000) throw new Error('Registro muito longo.');
  iso(data.at);
  return data;
}
export const CATEGORY_OPTIONS = [
  'Pedido fora do expediente', 'Cobrança excessiva', 'Sobrecarga de trabalho',
  'Desrespeito ou constrangimento', 'Mudança de orientação',
  'Desvio de função', 'Outra ocorrência',
];
