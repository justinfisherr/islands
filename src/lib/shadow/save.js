// Persistence that never blocks the loop. Everything goes through a queue keyed
// by client_id, drained in order, so an attempt can never be posted before its
// round exists. A failed POST stays queued and retries on the next page load.
const QUEUE_KEY = 'shadow_queue_v1';
const IDS_KEY = 'shadow_ids_v1';
const TOKEN = import.meta.env.VITE_LEVEL_TOKEN || '';

let memQueue = [];
let memIds = {};
let memOnly = false;

function readQueue() {
  if (memOnly) return memQueue;
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    memOnly = true;
  }
  return memQueue;
}

function writeQueue(q) {
  memQueue = q;
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    memOnly = true;
  }
}

function readIds() {
  if (memOnly) return memIds;
  try {
    const raw = localStorage.getItem(IDS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    memOnly = true;
  }
  return memIds;
}

function writeIds(ids) {
  memIds = ids;
  try {
    localStorage.setItem(IDS_KEY, JSON.stringify(ids));
  } catch {
    memOnly = true;
  }
}

export function newClientId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

async function postShadow(body) {
  const res = await fetch('/api/shadow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-level-token': TOKEN },
    body: JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `http ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function fetchShadow({ limit = 30, island = null } = {}) {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (island) qs.set('island', island);
  const res = await fetch(`/api/shadow?${qs.toString()}`, {
    headers: { 'x-level-token': TOKEN },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.json();
}

export async function deleteRound(roundId) {
  return postShadow({ op: 'delete', round_id: roundId });
}

export function queueLength() {
  return readQueue().length;
}

async function send(item) {
  if (item.kind === 'open') {
    const d = await postShadow({
      op: 'open',
      client_id: item.client_id,
      size: item.size,
      source: item.source,
      island: item.island || null,
      mode: item.mode,
    });
    if (d && d.id) {
      const ids = readIds();
      ids[item.client_id] = d.id;
      writeIds(ids);
    }
    return;
  }
  const roundId = readIds()[item.client_id];
  // The open never landed and is gone from the queue: nothing to attach to.
  if (!roundId) throw Object.assign(new Error('no round id'), { status: 404 });
  if (item.kind === 'attempt') {
    await postShadow({
      op: 'attempt',
      round_id: roundId,
      term: item.term,
      reference: item.reference,
      transcript: item.transcript,
      accuracy: item.accuracy,
      completeness: item.completeness,
      score: item.score,
      attempt_no: item.attempt_no,
      mode: item.mode,
      passed: item.passed,
    });
    return;
  }
  if (item.kind === 'finish') {
    await postShadow({
      op: 'finish',
      round_id: roundId,
      avg_score: item.avg_score,
      passed: item.passed,
    });
    return;
  }
  throw Object.assign(new Error('unknown item'), { status: 400 });
}

let draining = null;

async function drain() {
  for (;;) {
    const q = readQueue();
    if (!q.length) return 0;
    try {
      await send(q[0]);
    } catch (err) {
      const status = err && err.status;
      if (status !== 404 && status !== 400) return readQueue().length;
      // Unknown round or bad item: drop it, keep the rest moving.
    }
    writeQueue(readQueue().slice(1));
  }
}

// Serialised so ordering holds and the open lands before its attempts.
export function flushQueue() {
  if (!draining) {
    draining = drain().finally(() => {
      draining = null;
    });
  }
  return draining;
}

export function enqueue(item) {
  writeQueue([...readQueue(), item]);
  return flushQueue();
}
