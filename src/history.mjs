import { normalizeSecret, validateOptions } from './core.mjs';

export const HISTORY_KEY = 'twofa.history.v1';
export const HISTORY_LIMIT = 50;
export function historyId(entry) {
  return [entry.secret, entry.digits, entry.period, entry.algorithm].join(':');
}
export function readHistory(storage) {
  const raw = storage.getItem(HISTORY_KEY);
  if (!raw) return [];
  const entries = JSON.parse(raw);
  if (!Array.isArray(entries)) throw new Error('Invalid history');
  const valid = [];
  for (const entry of entries) {
    try {
      const secret = normalizeSecret(entry.secret);
      const options = validateOptions(entry);
      if (!Number.isFinite(entry.usedAt) || entry.usedAt < 0 || entry.usedAt > 8640000000000000) continue;
      const item = {
        secret, ...options, usedAt: entry.usedAt,
        issuer: typeof entry.issuer === 'string' ? entry.issuer.slice(0, 64) : '',
        account: typeof entry.account === 'string' ? entry.account.slice(0, 64) : '',
        note: typeof entry.note === 'string' ? entry.note.slice(0, 200) : '',
      };
      valid.push(item);
    } catch { /* Ignore malformed records without breaking the generator. */ }
  }
  const ids = new Set();
  return valid.sort((a, b) => b.usedAt - a.usedAt).filter(entry => {
    const id = historyId(entry);
    if (ids.has(id)) return false;
    ids.add(id);
    return true;
  }).slice(0, HISTORY_LIMIT);
}
export function rememberHistory(entries, entry, usedAt = Date.now()) {
  const item = {
    secret: normalizeSecret(entry.secret), ...validateOptions(entry),
    issuer: entry.issuer || '', account: entry.account || '', usedAt,
  };
  const old = entries.find(row => historyId(row) === historyId(item));
  item.issuer ||= old?.issuer || '';
  item.account ||= old?.account || '';
  item.note = old?.note || '';
  return [item, ...entries.filter(row => historyId(row) !== historyId(item))].slice(0, HISTORY_LIMIT);
}

export function updateHistoryDetails(entries, id, details) {
  const index = entries.findIndex(entry => historyId(entry) === id);
  if (index < 0) return null;
  const updated = {
    ...entries[index],
    issuer: String(details.issuer || '').trim().slice(0, 64),
    account: String(details.account || '').trim().slice(0, 64),
    note: String(details.note || '').trim().slice(0, 200),
  };
  return entries.map((entry, entryIndex) => entryIndex === index ? updated : entry);
}
