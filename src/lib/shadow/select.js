// Which ten words? Pure: no network, no clock of its own.
const ROUND = 10;
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

export function flattenWords(data) {
  const out = [];
  const seen = new Set();
  for (const dom of data?.domains || []) {
    for (const isl of dom.islands || []) {
      for (const w of isl.words || []) {
        if (!w.term || seen.has(w.term)) continue;
        seen.add(w.term);
        out.push({
          term: w.term,
          meaning: w.meaning || '',
          example: w.example || '',
          example_en: w.example_en || '',
          health: typeof w.health === 'number' ? w.health : 0,
          lapses: w.lapses || 0,
          status: w.status || '',
          leech: !!w.leech,
          islandId: isl.id,
          islandName: isl.name,
          domainName: dom.name,
        });
      }
    }
  }
  return out;
}

// For the <optgroup> select. Only islands that can actually fill a round.
export function islandsOf(words) {
  const byId = new Map();
  for (const w of words) {
    if (!w.example) continue;
    if (!byId.has(w.islandId)) {
      byId.set(w.islandId, { id: w.islandId, name: w.islandName, domainName: w.domainName, n: 0 });
    }
    byId.get(w.islandId).n += 1;
  }
  const groups = new Map();
  for (const isl of byId.values()) {
    if (!groups.has(isl.domainName)) groups.set(isl.domainName, []);
    groups.get(isl.domainName).push(isl);
  }
  return [...groups.entries()].map(([domainName, islands]) => ({
    domainName,
    islands: islands.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)),
  }));
}

// Terms with a passing attempt in the last week, so "New round" cannot hand
// back the same ten words forever.
export function recentlyPassed(history, now = Date.now()) {
  const s = new Set();
  for (const r of history || []) {
    for (const a of r.attempts || []) {
      if (!a.passed) continue;
      const t = Date.parse(a.created_at);
      if (Number.isFinite(t) && now - t < SEVEN_DAYS) s.add(a.term);
    }
  }
  return s;
}

const weakest = (a, b) =>
  a.health - b.health || b.lapses - a.lapses || a.term.localeCompare(b.term);

export function pickRound(words, history, { source = 'weakest', island = null, exclude = [], now = Date.now() } = {}) {
  const skip = recentlyPassed(history, now);
  for (const t of exclude) skip.add(t);

  const pool = [];
  const seen = new Set();
  for (const w of words || []) {
    if (!w.example || seen.has(w.term)) continue;
    if (source === 'island' && island && w.islandId !== island) continue;
    seen.add(w.term);
    pool.push(w);
  }

  const fresh = pool.filter((w) => !skip.has(w.term)).sort(weakest);
  const out = fresh.slice(0, ROUND);
  if (out.length < ROUND) {
    // Short round: fill from the words skipped for being recently passed.
    for (const w of pool.filter((x) => skip.has(x.term)).sort(weakest)) {
      if (out.length >= ROUND) break;
      out.push(w);
    }
  }
  return out;
}
