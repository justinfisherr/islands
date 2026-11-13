import pg from 'pg'
import { grade } from '../src/lib/shadow/grade.js'

// Shadowing: rounds + attempts. Same plumbing as api/level.js — one pool, one
// memoized schema promise, no driver text in responses.
//
// Auth is the same LEVEL_TOKEN as /api/level. VITE_LEVEL_TOKEN is baked into the
// client bundle, so this is a speed bump, not auth. It applies to GET too
// because GET returns transcripts.
const MAX_ROUNDS = 60

function tokenOk(req) {
  const secret = process.env.LEVEL_TOKEN
  return !!secret && (req.headers['x-level-token'] || '') === secret
}

let pool = null
let schemaPromise = null

function db() {
  if (!process.env.DATABASE_URL) return null
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 2,
    })
  }
  return pool
}

// CREATE TABLE IF NOT EXISTS does not add constraints to a pre-existing table.
// Two cold starts can race this and raise 42P07 / 23505 on pg_type.
async function ensureSchema() {
  if (!db()) return
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const p = db()
      await p.query('CREATE SCHEMA IF NOT EXISTS hub')
      await p.query(`
        CREATE TABLE IF NOT EXISTS hub.shadow_rounds (
          id           bigserial PRIMARY KEY,
          client_id    text UNIQUE,
          started_at   timestamptz NOT NULL DEFAULT now(),
          finished_at  timestamptz,
          size         smallint NOT NULL,
          source       text NOT NULL,
          island       text,
          mode         text NOT NULL,
          avg_score    smallint,
          passed       smallint NOT NULL DEFAULT 0,
          CONSTRAINT shadow_rounds_source_chk CHECK (source IN ('weakest','island')),
          CONSTRAINT shadow_rounds_mode_chk   CHECK (mode   IN ('mic','self')),
          CONSTRAINT shadow_rounds_size_chk   CHECK (size BETWEEN 1 AND 10),
          CONSTRAINT shadow_rounds_pass_chk   CHECK (passed BETWEEN 0 AND 10)
        )
      `)
      await p.query(`
        CREATE TABLE IF NOT EXISTS hub.shadow_attempts (
          id           bigserial PRIMARY KEY,
          round_id     bigint NOT NULL REFERENCES hub.shadow_rounds(id) ON DELETE CASCADE,
          term         text NOT NULL,
          reference    text NOT NULL,
          transcript   text NOT NULL,
          accuracy     smallint,
          completeness smallint,
          score        smallint,
          attempt_no   smallint NOT NULL,
          mode         text NOT NULL,
          passed       boolean NOT NULL DEFAULT false,
          created_at   timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT shadow_attempts_uq        UNIQUE (round_id, term, attempt_no),
          CONSTRAINT shadow_attempts_mode_chk  CHECK (mode IN ('mic','self')),
          CONSTRAINT shadow_attempts_no_chk    CHECK (attempt_no BETWEEN 1 AND 3),
          CONSTRAINT shadow_attempts_band_chk  CHECK (accuracy     IS NULL OR accuracy     BETWEEN 0 AND 100),
          CONSTRAINT shadow_attempts_band_chk2 CHECK (completeness IS NULL OR completeness BETWEEN 0 AND 100),
          CONSTRAINT shadow_attempts_band_chk3 CHECK (score        IS NULL OR score        BETWEEN 0 AND 100),
          CONSTRAINT shadow_attempts_scored    CHECK (mode <> 'mic' OR score IS NOT NULL)
        )
      `)
      await p.query('CREATE INDEX IF NOT EXISTS shadow_rounds_started_idx   ON hub.shadow_rounds  (started_at DESC)')
      await p.query('CREATE INDEX IF NOT EXISTS shadow_attempts_round_idx   ON hub.shadow_attempts(round_id)')
      await p.query('CREATE INDEX IF NOT EXISTS shadow_attempts_term_idx    ON hub.shadow_attempts(term)')
      await p.query('CREATE INDEX IF NOT EXISTS shadow_attempts_created_idx ON hub.shadow_attempts(created_at DESC)')
    })().catch((error) => {
      if (error && (error.code === '42P07' || error.code === '23505')) return
      schemaPromise = null
      throw error
    })
  }
  return schemaPromise
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

function text(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

// null is meaningful (self-mark), so only a real number survives.
function score(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(100, n))
}

function id(v) {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

async function listRounds(limit, island) {
  const p = db()
  const params = []
  let where = ''
  if (island) {
    params.push(island)
    where = `WHERE island = $${params.length}`
  }
  params.push(limit)
  const { rows } = await p.query(
    `SELECT id, client_id, started_at, finished_at, size, source, island, mode, avg_score, passed
       FROM hub.shadow_rounds
       ${where}
      ORDER BY started_at DESC
      LIMIT $${params.length}`,
    params,
  )
  const rounds = rows.map((r) => ({
    id: Number(r.id),
    client_id: r.client_id,
    started_at: r.started_at.toISOString(),
    finished_at: r.finished_at ? r.finished_at.toISOString() : null,
    size: r.size,
    source: r.source,
    island: r.island,
    mode: r.mode,
    avg_score: r.avg_score,
    passed: r.passed,
    attempts: [],
  }))
  if (!rounds.length) return rounds

  const ids = rounds.map((r) => r.id)
  const byId = new Map(rounds.map((r) => [r.id, r]))
  const a = await p.query(
    `SELECT id, round_id, term, reference, transcript, accuracy, completeness, score,
            attempt_no, mode, passed, created_at
       FROM hub.shadow_attempts
      WHERE round_id = ANY($1::bigint[])
      ORDER BY term, attempt_no`,
    [ids],
  )
  for (const row of a.rows) {
    const round = byId.get(Number(row.round_id))
    if (!round) continue
    round.attempts.push({
      id: Number(row.id),
      term: row.term,
      reference: row.reference,
      transcript: row.transcript,
      accuracy: row.accuracy,
      completeness: row.completeness,
      score: row.score,
      attempt_no: row.attempt_no,
      mode: row.mode,
      passed: row.passed,
      created_at: row.created_at.toISOString(),
    })
  }
  return rounds
}

async function stats() {
  const p = db()
  const totals = await p.query(
    `SELECT count(*)::int AS n,
            round(avg(score))::int AS avg_score
       FROM hub.shadow_attempts`,
  )
  const days = await p.query(
    `SELECT to_char(created_at, 'YYYY-MM-DD') AS day,
            count(*)::int AS n,
            count(*) FILTER (WHERE mode = 'self')::int AS self
       FROM hub.shadow_attempts
      WHERE created_at >= now() - interval '14 days'
      GROUP BY 1`,
  )
  const islands = await p.query(
    `SELECT r.island,
            round(avg(a.score))::int AS avg_score,
            count(*)::int AS n
       FROM hub.shadow_attempts a
       JOIN hub.shadow_rounds r ON r.id = a.round_id
      WHERE a.score IS NOT NULL
      GROUP BY r.island
      ORDER BY avg_score ASC`,
  )
  const worst = await p.query(
    `SELECT term, max(score)::int AS best_score, count(*)::int AS tries
       FROM hub.shadow_attempts
      WHERE score IS NOT NULL
      GROUP BY term
      ORDER BY best_score ASC, tries DESC, term ASC
      LIMIT 10`,
  )

  // 14 zero-filled days, oldest first, in UTC like the rows themselves.
  const byDay = []
  const seen = new Map(days.rows.map((r) => [r.day, r]))
  const today = new Date()
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i))
    const key = d.toISOString().slice(0, 10)
    const row = seen.get(key)
    byDay.push({ day: key, n: row ? row.n : 0, self: row ? row.self : 0 })
  }

  return {
    attempts_total: totals.rows[0].n || 0,
    avg_score: totals.rows[0].avg_score,
    by_day: byDay,
    by_island: islands.rows.map((r) => ({ island: r.island, avg_score: r.avg_score, n: r.n })),
    worst_words: worst.rows.map((r) => ({ term: r.term, best_score: r.best_score, tries: r.tries })),
  }
}

async function opOpen(body) {
  const p = db()
  const clientId = text(body.client_id, 64)
  const size = Number(body.size)
  const source = body.source === 'island' ? 'island' : 'weakest'
  const island = source === 'island' ? text(body.island, 40) : null
  const mode = body.mode === 'self' ? 'self' : 'mic'
  if (!clientId) return [400, { error: 'client_id required' }]
  if (!Number.isInteger(size) || size < 1 || size > 10) return [400, { error: 'size must be 1..10' }]
  if (source === 'island' && !island) return [400, { error: 'island required' }]

  const ins = await p.query(
    `INSERT INTO hub.shadow_rounds (client_id, size, source, island, mode)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (client_id) DO NOTHING
     RETURNING id, started_at`,
    [clientId, size, source, island, mode],
  )
  if (ins.rows.length) {
    return [201, { ok: true, id: Number(ins.rows[0].id), started_at: ins.rows[0].started_at.toISOString() }]
  }
  const sel = await p.query(
    `SELECT id, started_at FROM hub.shadow_rounds WHERE client_id = $1`,
    [clientId],
  )
  if (!sel.rows.length) return [500, { error: 'database error' }]
  return [
    200,
    { ok: true, id: Number(sel.rows[0].id), started_at: sel.rows[0].started_at.toISOString(), replayed: true },
  ]
}

async function opAttempt(body) {
  const p = db()
  const roundId = id(body.round_id)
  const term = text(body.term, 60)
  const reference = text(body.reference, 300)
  const transcript = text(body.transcript, 300)
  const attemptNo = Number(body.attempt_no)
  const mode = body.mode === 'self' ? 'self' : 'mic'
  if (!roundId) return [400, { error: 'round_id required' }]
  if (!term || !reference) return [400, { error: 'term and reference required' }]
  if (!Number.isInteger(attemptNo) || attemptNo < 1 || attemptNo > 3) {
    return [400, { error: 'attempt_no must be 1..3' }]
  }

  let accuracy = null
  let completeness = null
  let scoreValue = null
  let passed = false
  if (mode === 'mic') {
    accuracy = score(body.accuracy)
    completeness = score(body.completeness)
    scoreValue = score(body.score)
    if (accuracy === null || completeness === null || scoreValue === null) {
      return [400, { error: 'accuracy, completeness and score required for mic' }]
    }
    // Recomputed here so the client cannot drift from the gate. The target word
    // has to be right too: a mangled deck word must not land as a pass.
    const g = grade(transcript, reference, term)
    passed = accuracy >= 75 && completeness >= 90 && (!g || g.keyOk)
  } else {
    passed = body.passed === true
  }

  const exists = await p.query('SELECT 1 FROM hub.shadow_rounds WHERE id = $1', [roundId])
  if (!exists.rows.length) return [404, { error: 'unknown round' }]

  const ins = await p.query(
    `INSERT INTO hub.shadow_attempts
       (round_id, term, reference, transcript, accuracy, completeness, score, attempt_no, mode, passed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (round_id, term, attempt_no) DO NOTHING
     RETURNING id, created_at`,
    [roundId, term, reference, transcript, accuracy, completeness, scoreValue, attemptNo, mode, passed],
  )
  if (ins.rows.length) {
    return [201, { ok: true, id: Number(ins.rows[0].id), created_at: ins.rows[0].created_at.toISOString() }]
  }
  const sel = await p.query(
    `SELECT id, created_at FROM hub.shadow_attempts WHERE round_id = $1 AND term = $2 AND attempt_no = $3`,
    [roundId, term, attemptNo],
  )
  if (!sel.rows.length) return [500, { error: 'database error' }]
  return [200, { ok: true, id: Number(sel.rows[0].id), created_at: sel.rows[0].created_at.toISOString(), replayed: true }]
}

async function opFinish(body) {
  const p = db()
  const roundId = id(body.round_id)
  const avg = score(body.avg_score)
  const passed = Math.max(0, Math.min(10, Math.round(Number(body.passed) || 0)))
  if (!roundId) return [400, { error: 'round_id required' }]
  const { rows } = await p.query(
    `UPDATE hub.shadow_rounds
        SET finished_at = COALESCE(finished_at, now()),
            avg_score = $2,
            passed = $3
      WHERE id = $1
      RETURNING finished_at`,
    [roundId, avg, passed],
  )
  if (!rows.length) return [404, { error: 'unknown round' }]
  return [200, { ok: true, finished_at: rows[0].finished_at.toISOString() }]
}

async function opDelete(body) {
  const roundId = id(body.round_id)
  if (!roundId) return [400, { error: 'round_id required' }]
  const { rowCount } = await db().query('DELETE FROM hub.shadow_rounds WHERE id = $1', [roundId])
  return [200, { ok: true, deleted: rowCount }]
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'method not allowed' })
  }
  if (!tokenOk(req)) return res.status(401).json({ error: 'unauthorized' })
  if (!db()) return res.status(503).json({ error: 'database not configured' })

  try {
    await ensureSchema()

    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost')
      const rawLimit = Number(url.searchParams.get('limit'))
      const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(MAX_ROUNDS, Math.round(rawLimit))) : 30
      const island = text(url.searchParams.get('island'), 40) || null
      const [rounds, s] = await Promise.all([listRounds(limit, island), stats()])
      return res.status(200).json({ rounds, stats: s })
    }

    const body = await readBody(req)
    const op = body.op
    let out
    if (op === 'open') out = await opOpen(body)
    else if (op === 'attempt') out = await opAttempt(body)
    else if (op === 'finish') out = await opFinish(body)
    else if (op === 'delete') out = await opDelete(body)
    else return res.status(400).json({ error: 'unknown op' })
    return res.status(out[0]).json(out[1])
  } catch (error) {
    if (error && error.code === '23503') return res.status(404).json({ error: 'unknown round' })
    console.error('shadow', error && error.message ? error.message : error)
    return res.status(500).json({ error: 'database error' })
  }
}

export const config = { maxDuration: 30 }
