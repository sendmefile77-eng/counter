const CATEGORIES = Object.freeze({ work: 'Робочий', personal: 'Особистий', unknown: 'Не визначено' });
function domainName(input) {
  const text = String(input || '').trim().toLowerCase();
  if (!text || text.length > 253 || /[\s@*]/.test(text)) throw Error('Вкажіть домен сайту без пробілів, масок і логіна.');
  let url;
  try { url = new URL(text.includes('://') ? text : 'https://' + text); } catch (_) { throw Error('Некоректний домен сайту.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw Error('Вкажіть HTTP/HTTPS домен сайту.');
  return url.hostname.replace(/\.$/, '');
}
function normalizeRules(input, employees) {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 2000) throw Error('Некоректний список категорій сайтів.');
  const ids = new Set(employees.map(p => p.id)), keys = new Set();
  return input.map(rule => {
    if (!rule || typeof rule.domain !== 'string' || typeof rule.category !== 'string' || !Object.hasOwn(CATEGORIES, rule.category)
      || (rule.employeeId !== null && !ids.has(rule.employeeId))) throw Error('Некоректне правило категорії сайту.');
    const domain = domainName(rule.domain), key = `${rule.employeeId || '*'}|${domain}`;
    if (keys.has(key)) throw Error('Дубльоване правило категорії сайту.');
    keys.add(key); return { domain, employeeId: rule.employeeId, category: rule.category };
  });
}
function categoryFor(rules, employeeId, domain) {
  const host = String(domain || '').toLowerCase().replace(/\.$/, '');
  const matches = rules.filter(rule => (!rule.employeeId || rule.employeeId === employeeId)
    && (host === rule.domain || host.endsWith('.' + rule.domain)));
  matches.sort((a, b) => Number(Boolean(b.employeeId)) - Number(Boolean(a.employeeId)) || b.domain.length - a.domain.length);
  const rule = matches[0];
  return { category: rule?.category || 'unknown', origin: rule ? rule.employeeId ? 'employee' : 'global' : 'none', ruleDomain: rule?.domain || '' };
}
function classifier(rules) {
  const cache = new Map();
  return (employeeId, domain) => {
    const key = `${employeeId || '*'}|${domain}`;
    if (!cache.has(key)) cache.set(key, categoryFor(rules, employeeId, domain));
    return cache.get(key);
  };
}
module.exports = { CATEGORIES, domainName, normalizeRules, categoryFor, classifier };
