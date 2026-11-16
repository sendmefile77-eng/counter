const CATEGORIES = Object.freeze({ work: 'Робочий', personal: 'Особистий', unknown: 'Не визначено' });
const KNOWN_FLAGS = { nsfw: ['pornhub.com', 'xvideos.com', 'xhamster.com', 'youporn.com'],
  marketplace: ['rozetka.com.ua', 'prom.ua', 'olx.ua', 'aliexpress.com', 'amazon.com', 'ebay.com', 'temu.com'] };
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
    if (rule.flags != null && (typeof rule.flags !== 'object' || Array.isArray(rule.flags) || Object.entries(rule.flags).some(([key, value]) => !['nsfw', 'marketplace'].includes(key) || typeof value !== 'boolean'))) throw Error('Некоректні прапорці сайту.');
    keys.add(key); return { domain, employeeId: rule.employeeId, category: rule.category, ...(rule.flags ? { flags: { ...rule.flags } } : {}) };
  });
}
function categoryFor(rules, employeeId, domain) {
  const host = String(domain || '').toLowerCase().replace(/\.$/, '');
  const matches = rules.filter(rule => (!rule.employeeId || rule.employeeId === employeeId)
    && (host === rule.domain || host.endsWith('.' + rule.domain)));
  matches.sort((a, b) => Number(Boolean(b.employeeId)) - Number(Boolean(a.employeeId)) || b.domain.length - a.domain.length);
  const rule = matches[0];
  const flags = {}, flagOrigins = {};
  for (const [flag, domains] of Object.entries(KNOWN_FLAGS)) {
    const override = matches.find(item => typeof item.flags?.[flag] === 'boolean');
    flags[flag] = override ? override.flags[flag] : domains.some(domain => host === domain || host.endsWith('.' + domain));
    flagOrigins[flag] = override ? 'manual' : flags[flag] ? 'local_list' : 'none';
  }
  return { category: rule?.category || 'unknown', origin: rule ? rule.employeeId ? 'employee' : 'global' : 'none', ruleDomain: rule?.domain || '', flags, flagOrigins };
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
