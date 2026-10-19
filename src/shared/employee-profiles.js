const crypto = require('node:crypto');

const TEXT_FIELDS = { fullName: 160, department: 120, position: 120, note: 1000 };
const clean = (value, limit) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, limit);
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 1900
    && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
    && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}
function birthday(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^--\d{2}-\d{2}$/.test(text) && validDate('2000' + text.slice(1))) return text;
  if (validDate(text)) return text;
  const match = text.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?$/);
  if (match) return birthday(`${match[3] || '-'}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`);
  throw Error('Дата народження: ДД.ММ.РРРР або ДД.ММ без року.');
}
function normalize(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Некоректна картка працівника.');
  const profile = Object.fromEntries(Object.entries(TEXT_FIELDS).map(([field, limit]) => [field, clean(input[field], limit)]));
  profile.birthDate = birthday(input.birthDate);
  profile.startDate = String(input.startDate || '');
  if (profile.startDate && !validDate(profile.startDate)) throw Error('Некоректна дата початку роботи.');
  profile.aliases = [...new Set((Array.isArray(input.aliases) ? input.aliases : String(input.aliases || '').split(/[;\n]/))
    .map(value => clean(value, 160)).filter(Boolean))].slice(0, 40);
  profile.updatedAt = clean(input.updatedAt, 40);
  profile.history = (Array.isArray(input.history) ? input.history : []).slice(-100).map(item => ({
    at: clean(item.at, 40), source: clean(item.source, 160), changes: clean(item.changes, 1500),
  }));
  return profile;
}
function update(state, employeeId, input, now = new Date(), source = 'Вручну') {
  const person = state.employees.find(item => item.id === employeeId);
  if (!person) throw Error('Працівника не знайдено.');
  const previous = normalize(person.profile), next = normalize({ ...previous, ...input, history: previous.history });
  if (next.birthDate && !next.birthDate.startsWith('--') && next.birthDate > now.toISOString().slice(0, 10)) throw Error('Дата народження не може бути в майбутньому.');
  const changes = [...Object.keys(TEXT_FIELDS), 'birthDate', 'startDate', 'aliases'].filter(field => JSON.stringify(previous[field]) !== JSON.stringify(next[field]));
  if (!changes.length) return person;
  next.updatedAt = now.toISOString();
  next.history = [...previous.history, { at: next.updatedAt, source: clean(source, 160), changes: changes.join(', ') }].slice(-100);
  person.profile = next;
  state.audit.push({ id: crypto.randomUUID(), at: next.updatedAt, action: 'employee_profile_updated',
    details: { employeeId, source, fields: changes, actor: state.settings.operatorName || 'Керівник' } });
  state.audit = state.audit.slice(-5000);
  return person;
}
module.exports = { normalize, update, birthday, validDate };
