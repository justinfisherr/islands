# ENGINEERING — Shadowing (phase one)

Read with BRIEF-SHADOW.md and DESIGN-SHADOW.md.

## Findings (read, not guessed)

| Question | Answer |
|---|---|
| Does `hub` schema exist live? | Yes. Neon `ep-winter-bird-b7az7llo`, database `hub`, schema `hub` with `clicks`, `level_assessments`, `sync_requests`. Zero `shadow*` tables. |
| What does `api/level.js` create? | Memoized `schemaPromise`: `CREATE SCHEMA IF NOT EXISTS hub` + `CREATE TABLE IF NOT EXISTS hub.level_assessments (id bigserial, level jsonb, sentences jsonb, model text, digest jsonb, created_at timestamptz default now())`. Promise resets to `null` on error. |
| Is `hub` the DB islands uses? | Yes. Same DB also serves the `home` app (`hub.clicks`, `hub.sync_requests`) — don't touch those. |
| Is `api/level.js` deployed? | Yes, but **`api/` is untracked in git** (`git ls-files api` empty). The next CI deploy from a clean checkout ships without functions and 404s `/api/level`. Fix first. |
| Vercel env (production) | `DATABASE_URL`, `LEVEL_TOKEN`, `OPENROUTER_API_KEY`, `VITE_LEVEL_TOKEN`, `VITE_SYNC_TOKEN` all present. |
| Is `LEVEL_TOKEN` a real secret? | No. `VITE_LEVEL_TOKEN` is baked into `/assets/index-*.js`. Speed bump, not auth. Say so in the PR. |
| data.json | 248 words, 248 with `example` and `example_en`, unique terms. 17 islands / 9 domains. Island sizes 4…84 (`Not yet placed` = 84). Island rounds cap at 10. |
| Router | None. Nav is plain `<a href="#id">`. `App` is one component. `index.html` has a beacon on `hashchange`. |

## 1. Schema DDL (idempotent)

```sql
CREATE SCHEMA IF NOT EXISTS hub;

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
);

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
);

CREATE INDEX IF NOT EXISTS shadow_rounds_started_idx  ON hub.shadow_rounds  (started_at DESC);
CREATE INDEX IF NOT EXISTS shadow_attempts_round_idx  ON hub.shadow_attempts(round_id);
CREATE INDEX IF NOT EXISTS shadow_attempts_term_idx   ON hub.shadow_attempts(term);
CREATE INDEX IF NOT EXISTS shadow_attempts_created_idx ON hub.shadow_attempts(created_at DESC);
```

- `UNIQUE (round_id, term, attempt_no)` — **not** `(round_id, attempt_no)`. `attempt_no` is per word.
- `ON DELETE CASCADE` makes `op:'delete'` one statement.
- Scores nullable: self-mark attempts are recorded but not scored. `shadow_attempts_scored` keeps mic rows honest.
- `CREATE TABLE IF NOT EXISTS` does not add constraints to a pre-existing table. Note in the commit message.
- Two cold starts racing `CREATE TABLE IF NOT EXISTS` can raise `42P07` / `23505` on `pg_type`; `ensureSchema` catches those and continues.

## 2. API contract — `api/shadow.js`

Copy `api/level.js` plumbing exactly: module-level `let pool = null`, `let schemaPromise = null`,
`db()` returns `null` when `DATABASE_URL` unset, `new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 2 })`,
memoized `ensureSchema()` that nulls the promise on failure, `readBody(req)`, `res.setHeader('Cache-Control','no-store')`,
405 with `Allow`.

**Deliberate deviation:** DB errors never echo the driver message. Return `{ error: 'database error' }`, log server-side only.

**Auth:** `tokenOk(req)` identical to level.js (`x-level-token === process.env.LEVEL_TOKEN`). Applies to
every method including GET (GET returns transcripts). Client sends `VITE_LEVEL_TOKEN`. This is obscurity, not auth.

### `GET /api/shadow?limit=30&island=<id>`

`limit` int default 30 clamped 1…60. `island` optional string ≤40 chars, exact match.

```ts
{
  rounds: Array<{
    id: number, client_id: string|null,
    started_at: string, finished_at: string|null,
    size: number, source: 'weakest'|'island', island: string|null,
    mode: 'mic'|'self', avg_score: number|null, passed: number,
    attempts: Array<{
      id: number, term: string, reference: string, transcript: string,
      accuracy: number|null, completeness: number|null, score: number|null,
      attempt_no: number, mode: 'mic'|'self', passed: boolean, created_at: string
    }>
  }>,
  stats: {
    attempts_total: number,
    avg_score: number|null,
    by_day: Array<{ day: string, n: number, self: number }>,   // 14 entries, oldest first, zero-filled
    by_island: Array<{ island: string|null, avg_score: number, n: number }>,
    worst_words: Array<{ term: string, best_score: number, tries: number }>
  }
}
```

Attempts embedded so the detail needs no second fetch. 401 · 503 `database not configured` · 500 `database error`.

### `POST /api/shadow`

| op | request | response | errors |
|---|---|---|---|
| `open` | `{ op, client_id uuid, size 1–10, source, island (required when source='island', ≤40), mode }` | 201 `{ ok, id, started_at }`; replay → 200 `{ ok, id, started_at, replayed:true }` | 400, 401, 503, 500 |
| `attempt` | `{ op, round_id, term ≤60, reference ≤300, transcript ≤300, accuracy 0–100\|null, completeness 0–100\|null, score 0–100\|null, attempt_no 1–3, mode, passed? }` | 201 `{ ok, id, created_at }`; replay → 200 `{ ok, id, replayed:true }` | 400, 401, 404 unknown round, 503, 500 |
| `finish` | `{ op, round_id, avg_score 0–100\|null, passed 0–10 }` | 200 `{ ok, finished_at }`; idempotent, overwrites, never un-finishes | 400, 401, 404, 503, 500 |
| `delete` | `{ op, round_id }` | 200 `{ ok, deleted: n }` | 400, 401, 503, 500 |

Server-enforced so the client can't drift:
- `passed` for `mode:'mic'` is recomputed server-side: `accuracy >= 75 && completeness >= 90`. Body's value ignored.
- `passed` for `mode:'self'` from the body.
- `accuracy/completeness/score` for `mode:'self'` forced to `null`.
- No re-grading server-side. `grade.js` is the only grader; server clamps into 0–100 and stores.
- `attempt` idempotency: `INSERT ... ON CONFLICT (round_id, term, attempt_no) DO NOTHING RETURNING id`; if none returned, `SELECT id ...` → 200.
- `open` idempotency: `INSERT ... ON CONFLICT (client_id) DO UPDATE SET client_id = EXCLUDED.client_id RETURNING id, started_at`.
- Attempt on unknown `round_id` → 404; client drops that queue item.
- No IP rate limiter — serverless without shared state; write surface bounded by the caps plus the token. Say so in the PR.

## 3. Grading spec — `src/lib/shadow/grade.js`

Pure, no imports, no DOM.

```ts
grade(transcript: string, reference: string): null | {
  accuracy: number,      // int 0..100
  completeness: number,  // int 0..100
  score: number,         // === accuracy
  passed: boolean,       // accuracy >= 75 && completeness >= 90
  diff: Array<{ ch: string, kind: 'match' | 'wrong' | 'dropped' }>
}
```

**`syllables(s) -> string[]`**
1. `String(s ?? '').normalize('NFC')`.
2. Keep only code points in `U+AC00–U+D7A3` (precomposed Hangul syllables). Drop whitespace, punctuation, digits, Latin, standalone jamo, emoji.
3. Slice to 200.

Spacing and punctuation are free. Digits are dropped (`shortcut: digits are dropped from comparison, upgrade if the deck gains sentences where the number is the test`). A precomposed syllable is its jamo triple, so comparing code points compares all three jamo exactly — `sylParts()` is not needed for grading and stays in `App.jsx`.

**`align(ref, heard) -> ops[]`** — Levenshtein over syllable arrays.
- `cost(a,b) = a === b ? 0 : 1`; insertion and deletion cost 1.
- DP row-major, `dp[i][j]`, `i` over `ref`, `j` over `heard`.
- Backtrace from `(n, m)`, fixed tie-break: (1) equal diagonal → `match`; (2) unequal diagonal → `sub`; (3) up → `del`; (4) left → `ins`. First match wins, always.
- `diff` = one entry per reference syllable in order: `match`/`sub`→`wrong`/`del`→`dropped`. `ins` produces no entry.

**Metrics.** `N = ref.length`, `M = #match`, `S = #sub`, `D = #del`, `I = #ins`:
- `completeness = N ? round(100 * (M + S) / N) : 0`
- `accuracy = (M + S + I) ? round(100 * M / (M + S + I)) : 0`
- `score = accuracy`, `passed = accuracy >= 75 && completeness >= 90`
- Return `null` when `syllables(transcript)` is empty (heard nothing, no attempt consumed) or `syllables(reference)` is empty.

**Endings.** `-아요 / -습니다 / -다` are ordinary syllables. Nothing stripped, nothing normalized away.
`normKo` is **not** imported and must not be — it deletes exactly these.

**Known arithmetic, not a bug:** exact-syllable matching means `completeness 100` implies `accuracy 100`
unless there are insertions, so the DESIGN §4.3 mock (`82 / 100`) will not occur. One error in a
12-syllable sentence is ~8 points, so a single ending slip still passes; two errors in 5 syllables
fails. If endings should be strictly gated later, the rule is "any wrong/dropped in the final two
syllables fails" — flagged, not implemented.

**Worked cases (the self-check):**

| reference | transcript | M/S/D/I | acc | comp | passed |
|---|---|---|---|---|---|
| `연희는 슬픈 마음으로 나가요.` | `연희는 슬픈 마음으로 나가요` | 12/0/0/0 | 100 | 100 | ✓ |
| same | `연희는 슬픈 마음으로` | 7/0/5/0 | 100 | 58 | ✗ |
| same | `연희는 슬픈 마음으로 나가어요` | 11/1/0/1 | 85 | 100 | ✓ |
| same | `연희는 슬퍼 마음으로 나가요` | 11/1/0/0 | 92 | 100 | ✓ |
| same | `` (empty) | — | — | — | `null` |

## 4. File-by-file

**New**

| path | contents |
|---|---|
| `src/lib/shadow/grade.js` | `syllables`, `align`, `grade`. No imports. |
| `src/lib/shadow/grade.test.mjs` | `node:test` + `assert` over the table, plus a determinism check and a spacing/punctuation case. |
| `src/lib/shadow/select.js` | `flattenWords(data) -> ShadowWord[]` (`{ term, meaning, example, example_en, health, lapses, status, leech, islandId, islandName, domainName }`); `islandsOf(words)` for the `<optgroup>`; `pickRound(words, history, { source, island })`: drop words with no `example`, filter to island if set, drop terms passed in the last 7 days, sort health asc / lapses desc / term asc, dedupe, slice 10, fill from the excluded set weakest-first if short. Pure. |
| `src/lib/shadow/recognize.js` | `createRecognizer({ onInterim, onFinal, onHeardNothing, onDenied, onError }) -> { supported, start(), stop(), abort() }`. Owns `window.SpeechRecognition \|\| window.webkitSpeechRecognition`, `lang:'ko-KR'`, `continuous:false`, `interimResults:true`, `maxAlternatives:1`, 8s watchdog, error mapping (`not-allowed`/`service-not-allowed`→`onDenied`, `no-speech`→`onHeardNothing`, `aborted`→silent). `supported` computed once at module load. |
| `src/lib/shadow/speak.js` | `koVoice()`, `speak(text, rate)`, `cancelSpeak()`. Cached, refreshed on `voiceschanged`, never trusted before the first event. Shared by board chip and round. |
| `src/lib/shadow/save.js` | `newClientId()`, `loadShadow()`, `postShadow(body)`, `enqueue(item)` / `flushQueue()` over `localStorage['shadow_queue_v1']`. Queue items keyed by `client_id`, never by server id: `{ kind:'open', client_id, size, source, island, mode }`, `{ kind:'attempt', client_id, term, reference, transcript, accuracy, completeness, score, attempt_no, mode, passed }`, `{ kind:'finish', client_id, avg_score, passed }`. `flushQueue` replays in order, builds `Map<client_id, serverId>` from each `open` response. 404 on an attempt → drop the item; network error → keep and stop. `try/catch` around all `localStorage` with an in-memory fallback. |
| `src/components/shadow/ShadowBoard.jsx` | `#shadow` board: fact chips (voice / mic / grading toggle), source chips + island `<select>`, CTA with size sub-line, `RoundList`, `ShadowStats`. |
| `src/components/shadow/ShadowRound.jsx` | The takeover. Owns `{ i, phase, transcript, result, attempts, results[] }`. Calls `grade`, `recognize`, `speak`, `save`. |
| `src/components/shadow/ScoreRead.jsx` | Pure display of `{ score, band, accuracy, completeness, attemptNo, maxAttempts, heard, reference, mode }`. |
| `src/components/shadow/SyllableDiff.jsx` | Pure. `{ diff }` → reference with `wrong` underlined pink, `dropped` as hairline ghost boxes. |
| `src/components/shadow/RoundRow.jsx` | `RoundRow` + `RoundDetail`, expand-in-place with existing `wrow`/`wdetail`. Renders from `round.attempts`, not the deck. |
| `api/shadow.js` | As specified, with the DDL in `ensureSchema()`. |

**Modified**

| path | change |
|---|---|
| `src/App.jsx` | imports; `useMemo` over `data.domains` → `flattenWords`; state `shadowMode` (persisted `shadow_mode_v1`), `shadowSource`, `round`, `rounds`, `shadowStats`, `shadowLoad`, `openRoundId`; mount effect `loadShadow()` → `flushQueue()` → `loadShadow()`; nav link after Overview; `#shadow` section after the overview section; **wrap `<header>`+`<main>` in `<div className="page" inert={!!round}>` and render `{round && <ShadowRound/>}` as its sibling** — `inert` on a wrapper containing the takeover would kill it; hash effect for `#shadow/round/<id>`; no changes to Overview, Grid, Habits, Leeches, Words, Level, Pace, sync. |
| `src/app.css` | Append only: `:root { --pass:#4fc3a1; --close:#ffd54f; --fail:#ff6b9d; --record:#eaf2f7 }`, `.shadow*`, takeover (`position:fixed; inset:0; z-index:60; 100dvh`), ticks, score type, diff marks, ghost boxes, `prefers-reduced-motion`. No existing rule edited. |
| `package.json` | `"test": "node --test src/lib/shadow"`. No new dependencies. |

## 5. Order of work

| # | Step | Verified by |
|---|---|---|
| 0 | `git add api/` — commit `api/level.js` so the next CI deploy doesn't drop the existing function. | `git ls-files api`; after deploy `GET /api/level` still 200. |
| 1 | `grade.js` + test + `test` script. | `npm test` green. |
| 2 | `api/shadow.js` (four ops, DDL, token gate). No UI. | curl matrix. |
| 3 | Nav link + empty `#shadow` section, disabled CTA. | Page scrolls to it, nothing else changes. |
| 4 | `select.js` + `speak.js` + `ShadowRound` listen-only: CTA starts a round of 10, sentence + Play/Slow, Next, summary, no recording, no persistence. | Complete a round on a phone. |
| 5 | Weakest-first + island select wired to `pickRound`; New round reshuffles. | Two rounds return different terms; island round of 4 works. |
| 6 | `recognize.js` + grading: mic mode, gate, score panel, diff, 3-attempt cap. No save. | Right → passes; wrong → fails with both gate numbers. |
| 7 | `save.js`: open on start, attempt per stop, finish at summary, queue. | Reload mid-round → `unfinished` with attempts. Airplane mode → `Not saved yet. Retrying.` then flush. |
| 8 | `ShadowBoard` history: rows, filters, expand detail, delete with confirm. | Delete cascades. |
| 9 | `ShadowStats`: 14 bars, accuracy by island, worst words → `#words` jump (guarded no-op). | Numbers match the DB. |
| 10 | Self-mark mode + degradation states + a11y (`inert`, focus to Record, focus restore, Esc, `aria-live`, reduced motion). | QA browser matrix. |

## 6. Risk register

| Risk | Mitigation | Detection |
|---|---|---|
| No `webkitSpeechRecognition` (iOS Safari returns nothing; Firefox has none) | Feature-detect at load; `mic: not in this browser` chip; round opens in self-mark; in-round `Self-mark` pill | Board chip; QA with mic denied |
| No `ko-KR` TTS voice | `voiceschanged` wait; `Play`/`Slow` disabled with `no Korean voice`; sentence always readable; CTA never blocked | Board chip; QA with no voices |
| Vercel cold start | One GET on mount, `Loading rounds…`, round start never waits on network | Devtools first hit |
| `data.json` is a static artifact | No regeneration needed (248/248 have `example`). Round holds a snapshot. Unfinished rounds render from `shadow_attempts` (term + reference stored verbatim). Worst-words → `#words` jump guarded no-op | Regenerate, reload old round: still renders |
| Double submit on flaky mobile | `client_id` UNIQUE; `UNIQUE(round_id, term, attempt_no)`; `ON CONFLICT` + read-back; `savingRef` guard | curl same open/attempt twice → same id |
| Attempt replay after its round was deleted | 404 → client drops the queue item | Delete, then flush stale queue |
| Auth leakage | Same `LEVEL_TOKEN`, header-only, per-surface; GET gated; documented as obscurity | `curl` without header → 401; other surfaces unchanged |
| Shared-surface breakage | Only new `hub.shadow_*` tables; `api/level.js` committed, not edited | `GET /api/level` 200; home app loads |
| `inert` placement | Takeover is a sibling of the inert wrapper, never inside it; body overflow toggled in an effect with cleanup | Tap Play inside the round; try to scroll behind it |
| localStorage unavailable | `try/catch` + in-memory queue; round never blocks | Private window |

## 7. Rollback

Per step, since each step is one commit: `git revert <sha> && git push`.

| What he hates | Action | Data |
|---|---|---|
| Takeover feel | Revert step 10 | none |
| History/stats | Revert 8–9 | rows stay, unseen |
| Whole surface | Revert 3–10 | endpoint and tables stay, inert |
| Everything clean | Revert all, then `DROP TABLE IF EXISTS hub.shadow_attempts; DROP TABLE IF EXISTS hub.shadow_rounds;` | **Export first** — permanent loss of shadow history |

## 8. Verification matrix

**Developer — build & unit:** `npm run build` (no missing-module warnings) · `npm test`.

**Developer — curl** (`$T` = `LEVEL_TOKEN`; `.env.local` currently has empty values):
```
$U = 'https://islands-green.vercel.app/api/shadow'
curl $U                                                   # 401
curl -H "x-level-token: $T" $U                            # 200 {rounds:[],stats:{}}
POST op:'nope'                                            # 400
POST op:'open' client_id t-1                              # 201 {id}
  repeat same open                                        # 200 replayed:true, same id
POST op:'attempt' round_id=<id> attempt_no 1              # 201; repeat → 200 same id
POST op:'attempt' round_id=999999                         # 404
POST op:'finish'                                          # 200
POST op:'delete'                                          # 200 deleted:1
PUT  $U                                                   # 405 + Allow
GET  /api/level                                           # 200, unchanged
```

**Developer — DB:**
```
select table_name from information_schema.tables where table_schema='hub' and table_name like 'shadow%';  -- 2
select count(*) from hub.shadow_attempts a left join hub.shadow_rounds r on r.id=a.round_id where r.id is null;  -- 0
select count(*) from hub.shadow_attempts where mode='mic' and score is null;                                      -- 0
```

**QA (playwright):** 375/390/1440 no horizontal scroll; takeover `role="dialog"`, page behind `inert`, body
doesn't scroll, focus on `Record`, Esc = Leave, focus returns; mic denied → auto self-mark with exact copy,
round completes; no ko-KR voice → disabled Play with the label, CTA live; empty history copy; API blocked →
`Could not load past rounds` + Retry and a round still runs. Screenshots to
`~/.local/share/opencode/mcp-output/playwright`.

**Justin on the phone (the only real proof):** does iOS Safari return a Korean transcript at all, and which
chip state; is a real ko-KR voice present and does Play work after Stop; one deliberate bad attempt shows
`Heard` plus both gate numbers; reload mid-round → `unfinished`; airplane mode → `Not saved yet. Retrying.`
then flush; a round where everything fails finishes under three minutes.

## 9. Deploy & env

- **No new env vars.** `DATABASE_URL`, `LEVEL_TOKEN`, `VITE_LEVEL_TOKEN` already in Vercel Production.
- **No Vercel settings.** `api/shadow.js` is picked up like `api/level.js`. No `maxDuration` needed.
- **Migration:** ship code first; `ensureSchema()` creates the tables on first request. Same idempotent DDL, so
  pre-applying in the Neon SQL editor is also safe. There is no migration runner — do not invent a folder.
- **Deploy mechanism:** push to `main`; the workflow runs `vercel build --prod` then `vercel deploy --prebuilt --prod`.
  Therefore `api/` must be committed (step 0).
- **Local dev caveat:** `npm run dev` does not serve `/api/*`. The board will show `Could not load past rounds`
  locally and rounds won't persist. Accept testing saves against production, or use `vercel dev`.
