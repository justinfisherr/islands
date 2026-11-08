import pg from 'pg'

const OR_KEY = process.env.OPENROUTER_API_KEY
const OR_MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat'
const STAGES = [
  'Blushing Baby',
  'Babbling Toddler',
  'Kindergartener',
  'Hyperactive Elementary Kid',
  'Moody Middle Schooler',
  'Confident High Schooler',
  'Campus Legend',
  'Native-Adjacent',
]

const SYSTEM = `You are a Korean teacher who has been friends with the student for a year. Grade them: funny but serious, warm, honest. Pick exactly one stage from: ${STAGES.join(' / ')}.

Reply in EXACTLY this plain-text format, nothing else, no markdown, no code fences:

STAGE: <stage name exactly as listed>
BLURB: <1-2 sentences, name the real gap and the real strength>
SENTENCES:
1. <korean sentence> | <natural english translation>
2. <korean sentence> | <natural english translation>
... (exactly 8 numbered sentences; each uses only the student's known vocabulary plus the most elementary grammar, short and natural like a text from a friend)`

function cleanText(s) {
  return String(s == null ? '' : s).trim().slice(0, 260)
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n))
}

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

async function ensureTable() {
  if (!db()) return
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const p = db()
      await p.query('CREATE SCHEMA IF NOT EXISTS hub')
      await p.query(`
        CREATE TABLE IF NOT EXISTS hub.level_assessments (
          id bigserial PRIMARY KEY,
          level jsonb NOT NULL,
          sentences jsonb NOT NULL,
          model text,
          digest jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `)
    })().catch((error) => {
      schemaPromise = null
      throw error
    })
  }
  return schemaPromise
}

async function latestSaved() {
  if (!db()) return null
  await ensureTable()
  const { rows } = await db().query(
    `SELECT level, sentences, model, created_at
       FROM hub.level_assessments
      ORDER BY id DESC
      LIMIT 1`,
  )
  if (!rows.length) return null
  const r = rows[0]
  return {
    saved: true,
    level: r.level,
    sentences: r.sentences,
    model: r.model,
    requested_at: r.created_at.toISOString(),
  }
}

async function saveAssessment(level, sentences, model, digest) {
  if (!db()) return
  await ensureTable()
  await db().query(
    `INSERT INTO hub.level_assessments (level, sentences, model, digest)
     VALUES ($1::jsonb, $2::jsonb, $3, $4::jsonb)`,
    [JSON.stringify(level), JSON.stringify(sentences), model, JSON.stringify(digest)],
  )
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

function parse(raw) {
  const stage = cleanText((raw.match(/^STAGE:\s*(.+)$/m) || [])[1])
  const blurb = cleanText((raw.match(/^BLURB:\s*(.+)$/m) || [])[1])
  const sentences = []
  for (const m of raw.matchAll(/^\s*\d+\.\s+([^|\n]+?)\s*\|\s*(.+)$/gm)) {
    const ko = cleanText(m[1])
    const en = cleanText(m[2])
    if (ko && en) sentences.push({ ko, en })
    if (sentences.length >= 10) break
  }
  return { stage, blurb, sentences }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store')
    try {
      const saved = await latestSaved()
      return res.status(200).json(saved || { saved: false })
    } catch {
      return res.status(200).json({ saved: false })
    }
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'method not allowed' })
  }
  if (!tokenOk(req)) return res.status(401).json({ error: 'unauthorized' })
  if (!OR_KEY) {
    return res.status(503).json({ error: 'openrouter not configured' })
  }

  const body = await readBody(req)
  const force = body.force === true

  if (!force) {
    try {
      const saved = await latestSaved()
      if (saved) return res.status(200).json(saved)
    } catch {
      /* fall through and generate */
    }
  }
  const digest = {
    total_words: clamp(Number(body.total_words) || 0, 0, 20000),
    known_common: clamp(Number(body.known_common) || 0, 0, 100000),
    common_total: clamp(Number(body.common_total) || 0, 0, 100000),
    new_words: clamp(Number(body.new_words) || 0, 0, 20000),
    struggling: clamp(Number(body.struggling) || 0, 0, 20000),
    longest_interval_days: clamp(Number(body.longest_interval_days) || 0, 0, 10000),
    known_terms:
      Array.isArray(body.known_terms) && body.known_terms.length
        ? String(body.known_terms)
            .split(',')
            .slice(0, 400)
            .map((s) => s.trim())
            .filter(Boolean)
            .join(', ')
        : '',
  }

  const user = digest.known_terms
    ? `Deck: ${digest.total_words} words total; ${digest.new_words} brand new; ${digest.struggling} shaky. Know ${digest.known_common}/${digest.common_total} common-list words; longest interval ${digest.longest_interval_days}d. Known vocab: ${digest.known_terms}`
    : `Deck: ${digest.total_words} words total; ${digest.new_words} brand new; ${digest.struggling} shaky. Know ${digest.known_common}/${digest.common_total} common-list words; longest interval ${digest.longest_interval_days}d.`

  let lastError = 'assistant did not respond in the expected format'

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let resp
    try {
      resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OR_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: OR_MODEL,
          temperature: 0.6,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: user },
          ],
          max_tokens: 1400,
        }),
        signal: AbortSignal.timeout(60000),
      })
    } catch (error) {
      lastError = String(error && error.message ? error.message : error)
      continue
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      lastError = `openrouter ${resp.status}: ${text.slice(0, 180)}`
      continue
    }

    const data = await resp.json()
    const { stage, blurb, sentences } = parse(data?.choices?.[0]?.message?.content || '')
    if (stage && sentences.length >= 3) {
      const stageIndex = STAGES.findIndex((s) => s.toLowerCase() === stage.toLowerCase())
      const payload = {
        level: {
          label: stage,
          stage: stageIndex >= 0 ? stageIndex + 1 : null,
          stages_total: STAGES.length,
          blurb,
        },
        sentences: sentences.slice(0, 8),
        model: OR_MODEL,
        requested_at: new Date().toISOString(),
      }
      try {
        await saveAssessment(payload.level, payload.sentences, OR_MODEL, digest)
      } catch {
        /* persistence is best-effort */
      }
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json({ ...payload, saved: true })
    }
    lastError = 'assistant response did not include a stage and sentences'
  }

  return res.status(502).json({ error: lastError })
}

export const config = { maxDuration: 60 }