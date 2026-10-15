// House records: the best result per event on this device, kept in localStorage.
const KEY = 'tabletop-trials.records.v1';

export function loadRecords() {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) || 'null');
    return r && typeof r === 'object' ? r : {};
  } catch (e) { return {}; }
}

export function recordFor(eventId) { return loadRecords()[eventId] || null; }

// rec = { value, text, code, name }; better = 'lower' | 'higher'. -> true if it is a new record
export function offerRecord(eventId, rec, better) {
  const all = loadRecords();
  const cur = all[eventId];
  const isBetter = !cur || (better === 'lower' ? rec.value < cur.value : rec.value > cur.value);
  if (!isBetter) return false;
  all[eventId] = { ...rec, t: Date.now() };
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) { /* storage unavailable */ }
  return true;
}
