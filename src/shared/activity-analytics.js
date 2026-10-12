const DAY = 86400000, MINUTE = 60000;
const dateOf = n => new Date(n).toISOString().slice(0, 10);
const median = values => { const a = values.slice().sort((a, b) => a - b); return a.length ? (a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)]) / 2 : null; };
const rate = (n, total) => total ? Math.round(n * 1000 / total) / 10 : null;
const minuteOf = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const clock = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const WEEKDAYS = ['неділях', 'понеділках', 'вівторках', 'середах', 'четвергах', 'п’ятницях', 'суботах'];
function periodStart(date, groupBy) {
  const n = Date.parse(date + 'T00:00:00Z');
  if (groupBy === 'year') return date.slice(0, 4) + '-01-01';
  if (groupBy === 'month') return date.slice(0, 7) + '-01';
  if (groupBy === 'week') return dateOf(n - ((new Date(n).getUTCDay() + 6) % 7) * DAY);
  return date;
}
function previousRange(startDate, endDate) {
  const start = Date.parse(startDate + 'T00:00:00Z'), days = Math.round((Date.parse(endDate + 'T00:00:00Z') - start) / DAY) + 1;
  return { startDate: dateOf(start - days * DAY), endDate: dateOf(start - DAY) };
}
function summarize(rows, rules) {
  const scheduled = rows.filter(row => row.expectedMs > 0 && !row.future), observed = scheduled.filter(row => row.recordCount);
  const complete = scheduled.filter(row => !row.inProgress), sample = complete.filter(row => row.firstWork !== null && row.recordCount);
  const sum = key => observed.reduce((n, row) => n + (row[key] || 0), 0);
  const late = sample.filter(row => row.lateMs > rules.toleranceMinutes * MINUTE);
  const early = sample.filter(row => row.earlyMs > rules.toleranceMinutes * MINUTE);
  return { scheduledDays: scheduled.length, observedDays: observed.length, completedDays: complete.length,
    sampleDays: sample.length, noDataDays: complete.filter(row => !row.recordCount).length,
    outsideOnlyDays: complete.filter(row => row.recordCount && row.firstWork === null).length,
    inProgressDays: scheduled.filter(row => row.inProgress).length, coveragePercent: rate(observed.length, scheduled.length),
    expectedMs: scheduled.reduce((n, row) => n + row.expectedMs, 0), observedNormMs: observed.reduce((n, row) => n + row.expectedMs, 0),
    activeMs: observed.length ? sum('activeMs') : null, workMs: observed.length ? sum('workMs') : null,
    personalMs: observed.length ? sum('personalMs') : null, unknownMs: observed.length ? sum('unknownMs') : null,
    deficitMs: complete.some(row => row.recordCount) ? complete.reduce((n, row) => n + (row.deficitMs || 0), 0) : null,
    lateDays: late.length, earlyDays: early.length, lateRate: rate(late.length, sample.length), earlyRate: rate(early.length, sample.length),
    medianLateMs: median(late.map(row => row.lateMs)), longGapDays: sample.filter(row => row.longGaps.some(gap => gap.kind === 'gap')).length,
    personalDays: sample.filter(row => row.personalMs >= rules.personalDailyMinutes * MINUTE).length,
    averageActiveMs: sample.length ? sample.reduce((n, row) => n + (row.activeMs || 0), 0) / sample.length : null,
    averagePersonalMs: sample.length ? sample.reduce((n, row) => n + (row.personalMs || 0), 0) / sample.length : null,
    recordCount: rows.filter(row => !row.future).reduce((n, row) => n + row.recordCount, 0),
    missingCount: rows.filter(row => !row.future).reduce((n, row) => n + row.missingCount, 0),
  };
}
function repetitions(rows, rules) {
  const sample = rows.filter(row => row.expectedMs > 0 && !row.future && !row.inProgress && row.firstWork !== null && row.recordCount);
  if (sample.length < rules.riskMinDays) return [];
  const risks = [];
  const add = (code, label, dates, denominator, extra = {}) => {
    const unique = [...new Set(dates)].sort();
    if (unique.length < rules.riskMinOccurrences || unique.length * 100 < denominator * rules.riskPercent) return;
    risks.push({ code, label, dates: unique, count: unique.length, denominator, percent: rate(unique.length, denominator), ...extra });
  };
  const late = sample.filter(row => row.lateMs > rules.toleranceMinutes * MINUTE), early = sample.filter(row => row.earlyMs > rules.toleranceMinutes * MINUTE);
  add('late', 'Повторюються пізні перші записи в робочий час', late.map(row => row.date), sample.length, { medianMs: median(late.map(row => row.lateMs)) });
  add('early', 'Повторюється раннє завершення браузерних спостережень', early.map(row => row.date), sample.length, { medianMs: median(early.map(row => row.earlyMs)) });
  add('personal', `Регулярно від ${rules.personalDailyMinutes} хв на особистих сайтах (оцінка)`, sample.filter(row => row.personalMs >= rules.personalDailyMinutes * MINUTE).map(row => row.date), sample.length);
  for (let day = 0; day < 7; day++) {
    const weekday = sample.filter(row => new Date(row.date + 'T00:00:00Z').getUTCDay() === day);
    if (weekday.length < rules.riskMinOccurrences) continue;
    const weekdayLate = weekday.filter(row => row.lateMs > rules.toleranceMinutes * MINUTE);
    if (rate(weekdayLate.length, weekday.length) < rate(late.length, sample.length) + 20) continue;
    add('late_weekday', `Пізні перші записи по ${WEEKDAYS[day]}`, weekday.filter(row => row.lateMs > rules.toleranceMinutes * MINUTE).map(row => row.date), weekday.length, { weekday: day });
  }
  // A clock slot must be wholly inside a long internal gap. Lunch, start/end
  // gaps, missing days and unfinished days cannot create this pattern.
  const slots = new Map();
  for (const row of sample) for (const gap of row.longGaps.filter(gap => gap.kind === 'gap')) {
    const first = Math.ceil(minuteOf(gap.from) / 30) * 30, last = minuteOf(gap.to);
    for (let minute = first; minute + 30 <= last; minute += 30) {
      if (!slots.has(minute)) slots.set(minute, new Set()); slots.get(minute).add(row.date);
    }
  }
  const qualified = [...slots].filter(([, dates]) => dates.size >= rules.riskMinOccurrences && dates.size * 100 >= sample.length * rules.riskPercent).sort(([a], [b]) => a - b);
  const merged = [];
  for (const [minute, dates] of qualified) {
    const list = [...dates].sort(), last = merged.at(-1), key = list.join('|');
    if (last && last.to === minute && last.key === key) last.to += 30;
    else merged.push({ from: minute, to: minute + 30, dates: list, key });
  }
  for (const slot of merged) add('clock_gap', `Повторюються паузи ${clock(slot.from)}–${clock(slot.to)}`, slot.dates, sample.length, { from: clock(slot.from), to: clock(slot.to) });
  return risks;
}
function analyze(rows, previousRows, rules, input = {}) {
  const groupBy = ['day', 'week', 'month', 'year'].includes(input.groupBy) ? input.groupBy : 'month';
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.groupKey)) groups.set(row.groupKey, { groupKey: row.groupKey, employeeId: row.employeeId, name: row.name, rows: [] });
    groups.get(row.groupKey).rows.push(row);
  }
  const people = [...groups.values()].map(group => {
    const periods = new Map();
    for (const row of group.rows) {
      const key = periodStart(row.date, groupBy); if (!periods.has(key)) periods.set(key, []); periods.get(key).push(row);
    }
    const current = summarize(group.rows.filter(row => !row.inProgress), rules);
    const previous = summarize(previousRows.filter(row => row.groupKey === group.groupKey && !row.inProgress), rules);
    const comparable = current.sampleDays >= rules.riskMinDays && previous.sampleDays >= rules.riskMinDays;
    const trend = { comparable, current, previous,
      activeChangeMs: comparable ? current.averageActiveMs - previous.averageActiveMs : null,
      personalChangeMs: comparable ? current.averagePersonalMs - previous.averagePersonalMs : null,
      lateChangePoints: comparable ? current.lateRate - previous.lateRate : null };
    return { groupKey: group.groupKey, employeeId: group.employeeId, name: group.name,
      summary: summarize(group.rows, rules), risks: group.employeeId ? repetitions(group.rows, rules) : [], trend,
      periods: [...periods].sort(([a], [b]) => a.localeCompare(b)).map(([startDate, bucket]) => ({ startDate, ...summarize(bucket, rules) })) };
  });
  return { groupBy, previousRange: input.previousRange, people };
}
module.exports = { summarize, repetitions, analyze, periodStart, previousRange };
