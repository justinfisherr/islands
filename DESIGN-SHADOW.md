# DESIGN — Shadowing (phase one)

## 1. Concept

Shadowing is a **mode**, not a section: the page keeps scoring you, but when a round starts
the scoreboard steps aside and the screen becomes one sentence, one record button, one number.

Why it fits: the app is already a scoreboard — honest numbers, no chrome. The only thing it
can't do is hear you. So the new surface borrows the scoreboard's language for everything
*around* the loop (board, history, stats) and drops all of it *inside* the loop, because a
person holding a phone at arm's length with one thumb cannot read a dashboard.

## 2. Scope

**In**
- One new anchor section `#shadow`: round setup, rounds history (filterable, expandable detail),
  shadow stats.
- A full-screen round takeover with listen → record → gate feedback → summary.
- Two grading modes: microphone (`webkitSpeechRecognition`) and self-mark, with manual override.
- `api/shadow.js` + two tables; attempts and rounds persisted; localStorage retry queue.
- Delete a round. No edit (see cut list).

**Out**
- Router. No `#/route` framework — hash parsing only, once, for deep links.
- Audio storage, MP3s, Azure, phoneme/prosody/waveform, shadowing SRS, multi-user switcher, streaks.
- Wake Lock (flagged, one line if wanted).
- Any change to Overview, Grid, Habits, Leeches, Words, Level, Pace.

**Assumptions (verify before build)**
1. All 248 deck words have `example` (checked: 248/248). Islands: 17 across 9 domains; smallest
   island has 4 words, largest 20. So island rounds range 4–10 and "round of 4" is a real state.
2. `health` and `lapses` are the weakest-first signal; `suspended` words still shadow (speaking
   practice ≠ review).
3. Round takeover is a state in `App`, not a route — the app has no router and adding one is
   more than this feature is worth.
4. Self-mark scores are not mixed into accuracy averages. Recorded, counted, labeled.
5. `hub` schema, `DATABASE_URL` via `api/level.js` pattern, push to `main` deploys.

## 3. Flow map

```
sticky nav "Shadow" ──▶ #shadow ──┬─▶ [Start a round]  ──▶ ROUND TAKEOVER
                                  │                          listen → record → gate
                                  │                          → next … ×10 → summary
                                  │                              │
                                  │        [Back to the board] ──┘  (round now top of history)
                                  ├─▶ island select ──▶ [Start this island] ──▶ ROUND TAKEOVER
                                  ├─▶ Rounds row ──▶ expand in place (detail, all 10 + every attempt)
                                  │                     └─▶ [Back to rounds] collapses, hash → #shadow
                                  │                     └─▶ [Delete this round] confirm
                                  └─▶ Worst words row ──▶ jumps to #words, that term expanded

deep links
  #shadow                    → scroll to board
  #shadow/round/<id>         → scroll to board, expand that round
  reload mid-round           → round exists with no finish time; shows as "unfinished", attempts kept
back path
  takeover: [Leave] top-right, confirm only if an attempt exists, focus returns to [Start a round]
  detail:   [Back to rounds] clears hash; browser back also collapses (hashchange listener)
```

## 4. Screen specs

### 4.1 `#shadow` board — sits second, right after Overview

Position argument: it is the only *doing* surface in the app and he opens it on a phone to
practice. Numbers first (Overview), action second, reference material after.

**Mobile (375)**
- `h2 Shadow` + one section note.
- **Fact chips row** (read-only, not form fields): `voice: Yuna (ko-KR)` or `voice: none installed`
  · `mic: ready` / `blocked` / `not in this browser` · `grading: microphone` / `self-mark`. Each
  is a pill, non-interactive except `grading`, which is a two-state toggle (Mic / Self) — 44px,
  `aria-pressed`.
- **Source row**: chip `Weakest first` (pressed by default) | chip `Pick an island`. Choosing
  island reveals a native `<select>` with `<optgroup>` per domain, label "Island", each option
  `Feelings & States · 20`. No typeahead: 17 options is a list, not a search.
- **Primary CTA** `Start a round` — mint fill, 52px tall, full width. Sub-line under it:
  `10 weakest words with sentences. About three minutes.` (or `4 words in this island have
  sentences.` / `Round of 6.`)
- **Rounds** block: two filter chip rows — `All / Mic / Self-mark` and `Newest / Worst first`.
  Rows newest first, one line each: `Mar 4 · weakest first · 7 of 10 passed · 74`. Score carries
  its band color. Row is a full-width button, 56px.
- **Shadow stats** block: two numbers (`42 attempts · average 71`), then `Attempts · last 14 days`
  (14 thin bars, mint; self-marked bars hairline), `Accuracy by island` (worst first, thin 6px
  tracks, island name + score), `Worst words` (10 rows: term, best score, tries — each row jumps
  to the Words detail for that term).

**Desktop**: same column, blocks capped at 720px (start panel) and 760px (history), stats in two
columns ≥760px.

**One primary action**: `Start a round`.

### 4.2 Round takeover

`position: fixed; inset: 0; z-index: 60;` on navy-deep. Page root gets `inert` + body
`overflow: hidden`. `role="dialog" aria-modal="true"`. Column max-width 520px, centered on
desktop, full-bleed on mobile.

Vertical order, top to bottom, every state:

1. **Progress row**: `3 of 10` left; ten 12px squares, 2px radius, 4px gap (the grid's squares,
   same radius) — mint = passed, sand = flagged, ink outline = current, hairline = upcoming.
   `role="img"` with one label: `3 of 10 words, 2 passed, 1 flagged`. Right: `Leave` (44×44,
   hairline pill). In mic mode only, a second small pill `Self-mark` (44px) that switches
   mid-round.
2. **Sentence** (upper middle, arm's length): reference Korean, 24px/1.55 weight 700, max three
   lines. The whole sentence block is a tap target that replays (≥44px, `aria-label="Play the
   sentence"`). Below it, one muted line: `슬프다 · to be sad`.
3. **Play row**: `Play` and `Slow` pills, 48px tall, 8px apart. Disabled with the label
   `no Korean voice` when no ko voice exists.
4. **Live line** (small, muted, min-height reserved so nothing jumps): idle `Listening is one tap
   away.` — recording: interim transcript as it arrives, else `Listening. Say the sentence.` —
   result: empty.
5. **Primary slot** (bottom, thumb zone, `padding-bottom: max(16px, env(safe-area-inset-bottom))`):

| state | primary button | size |
|---|---|---|
| listen | `Record` — ink fill, navy text, 76px | full width |
| recording | `Stop` — pink fill, navy text, 76px, pulsing 8px dot (reuse existing `pulse`) | full width |
| result, attempts left | `Try again` — ink fill | 60px |
| result, passed or third attempt | `Next word` — mint fill | 60px |
| summary | `Back to the board` — mint fill | 60px |
| self-mark | `Close enough` (mint, 56px) then `Not close` (pink outline, 56px) stacked | full width |

One primary per moment. Nothing else on screen competes: no nav, no sync, no scroll.

**Recording behaviour**: starting a recording cancels `speechSynthesis` first; `Play`/`Slow`
disable while recording; a recording auto-stops after 8s; `onend` with no transcript =
heard-nothing (no attempt consumed).

### 4.3 The gate feedback moment (the product)

Same screen, sentence shrinks to 18px and moves to the top third. The result block replaces the
live line and the primary slot:

```
              82
            passed
   accuracy 82 · completeness 100 · gate 75 / 90

   Heard  연희는 슬픈 마음으로 나가요

   reference   연희는 슬픈 마음으로 나가요
               ‾‾‾‾
   attempt 2 of 3
```

- The number is the largest thing on screen: `clamp(56px, 16vw, 72px)`, weight 800, `-0.04em`,
  tabular numerals, colored by band (mint / sand / pink). No ring, no gauge, no bar, no count-up.
- The verdict is one word under it, 13px, letterspaced caps: `passed` / `close` / `missed`.
- Second line is the two gate numbers, so a fail is never mysterious: accuracy and completeness,
  each labeled, plus the threshold.
- `Heard` shows the raw transcript in ink, always.
- Reference line marks the difference at syllable level: wrong syllables pink-underlined,
  dropped syllables shown as hairline ghost boxes. Reuse `sylParts` for Hangul decomposition;
  **do not** reuse `normKo` — it strips verb endings and would forgive exactly what he must say.
- `attempt 3 of 3` — and on a third-attempt fail, one extra line: `Third attempt. Flagged.` with
  the word's square going sand.

No praise, no sound, no confetti. The number is the feedback.

### 4.4 Round summary

Same takeover. Ticks all resolved. Heading `Round finished`. Big number = average score, same
type and band color. Under it: `7 of 10 passed · average 74 · 3 flagged`. Then the flagged rows
(term + best score, not clickable here). Primary `Back to the board`, secondary `New round`
(same source, excluding words already passed today).

The summary **is** the round detail — do not build a second version of it.

### 4.5 Round detail (expand-in-place, incumbent pattern)

In the Rounds list, expanding a row grows a `wdetail`-styled block — the Words section already
does exactly this, so it costs no new pattern.

- Header: `Mar 4, 2:14 pm · weakest first · 7 of 10 · average 74` + `Back to rounds` (44px,
  clears hash) + `Delete this round`.
- Ten rows, deck order. Each row: term, band-colored score, `passed` / `flagged` / `self-marked`.
  Tap expands to that word's **every attempt** stacked: `1 · 41`, `2 · 63`, `3 · 71`, each with
  its transcript and a `Play reference` button (TTS re-speaks the reference — label it that way,
  his own voice was never stored).
- Self-marked rows show `not scored` instead of a number and never show a band color.
- Unfinished round (reload mid-round): header says `unfinished · 4 of 10`, no average, delete
  still works.

### 4.6 Stats

Inside `#shadow`, no separate screen. Attempts bars, island accuracy, worst words as described in
4.1. No charts beyond those: 14 bars and 6px tracks, both already in the app's vocabulary.

## 5. Component list

**New**
- `ShadowBoard` — chips, source toggle, CTA, renders `RoundList` + `ShadowStats`.
- `ShadowRound` — the takeover. State: `{ i, phase: 'listen'|'recording'|'result'|'summary',
  attempts, transcripts, score }`.
- `ScoreRead` — `{score, band, accuracy, completeness, attemptNo, maxAttempts, heard, reference}`.
  Pure display. Used by the takeover and the summary.
- `SyllableDiff` — `{reference, heard}`. Renders the marked reference. Pure.
- `RoundRow` / `RoundDetail` — `{round, expanded, onToggle, onDelete}`. Reuses `wrow`/`wdetail`.
- `lib/shadow/select.js` — `pickRound(words, history, source, island)`: weakest first, skip
  anything passed in the last 7 days, fill from the weakest if short, no duplicate terms, cap 10.
- `lib/shadow/grade.js` — pure `grade(transcript, reference) → {accuracy, completeness, score,
  diff}`. **This is the seam** for a server-side grader later.
- `lib/shadow/recognize.js` — feature detect, start/stop, `onInterim`, `onFinal`,
  `onHeardNothing`, `onDenied`. Isolates all Safari weirdness.
- `lib/shadow/save.js` — POST attempts, POST round open/finish, localStorage queue + flush on load.

**Reused, unchanged**
`mint()`, `sylParts()`, `pulse` keyframes, `.chip[aria-pressed]`, `.mini`, `.cta`, `.stat`,
`.wrow`/`.wdetail`, `.heat` bar idiom, `.empty`, `.sectionnote`, `.statusline.bad`, `expanded`
state + `#words` scroll for worst-word jumps.

**Data**
- `hub.shadow_rounds`: `id`, `started_at`, `finished_at` (null = unfinished), `size`, `source`
  (`weakest`|`island`), `island` (null), `mode` (`mic`|`self`), `avg_score`, `passed`.
- `hub.shadow_attempts`: `id`, `round_id`, `term`, `reference`, `transcript`, `accuracy`,
  `completeness`, `score`, `attempt_no`, `mode`, `passed`, `created_at`. Heard-nothing stores no row.
- `api/shadow.js`: `GET` → rounds + aggregates for stats; `POST` → `open` / `attempt` / `finish` /
  `delete`. Same `DATABASE_URL` pattern as `api/level.js`.

## 6. States

| state | what he sees | primary |
|---|---|---|
| no Korean voice installed | board chip `voice: none installed`; a sand line under the CTA: `No Korean voice is installed in this browser. Play is off — read the sentence and say it.` In the round, `Play`/`Slow` read `no Korean voice` and are disabled | `Start a round` still live |
| mic permission denied | result-area line: `The browser blocked the microphone. Self-mark still works.` + `Switch to self-mark` (auto-switches, mode persisted) | `Switch to self-mark` |
| recognition unsupported (iOS Safari) | board chip `mic: not in this browser`; note: `This browser cannot listen to speech. Rounds run in self-mark mode.` Round opens already in self-mark | `Start a round` |
| recognition present but silent/broken | a `Self-mark` pill sits in the round header; one tap switches mid-round and keeps the attempt count | unchanged |
| recording in progress | pink `Stop`, pulsing dot (static under reduced motion), interim transcript, `Play`/`Slow` disabled, `Leave` still tappable | `Stop` |
| heard nothing | `Heard nothing. The mic opened but no speech came through.` + `No attempt used.` | `Record again` |
| pass | mint number, `passed`, ticks go mint, `attempt 2 of 3` if it took two | `Next word` |
| fail, attempts left | sand or pink number, the two gate numbers, `Heard …`, diff marked | `Try again` |
| third attempt fail | as fail + `Third attempt. Flagged.`; tick goes sand; row appears in summary | `Next word` |
| self-mark pass/fail | one line `self-marked · not scored` + `Next word`; no score panel | `Next word` |
| API error saving | sand line `Not saved yet. Retrying.` — loop never blocks; queued in localStorage | unchanged |
| API error on load | Rounds block: `Could not load past rounds. The round still works.` + `Retry` | `Start a round` |
| empty history, first ever | `No rounds yet. Ten words is about three minutes.` + `Start a round`. No tour, no intro screen | `Start a round` |
| empty stats | `Nothing to compare yet. Finish a round.` | — |
| island with < 10 words | CTA sub-line: `4 words in this island have sentences.` and `size = 4` | `Start a round` |
| unfinished round in history | row tagged `unfinished`; detail shows `4 of 10`, no average | row expands |
| long sentence | 24px, max three lines, wraps; no ellipsis, no horizontal scroll | unchanged |
| leave mid-round | `Leave the round? 4 words are scored and saved.` / `Keep going` / `Leave` | `Keep going` |
| slow network | attempt POST is fire-and-forget; the round never waits on it | unchanged |
| success confirmation | the ticks and the round appearing at the top of history. No toast | — |

## 7. Copy deck

Voice: honest scoreboard. No exclamation marks, no "nice", no "great job", no emoji.

**Board**
- `Shadow`
- `Say the sentence back. The browser scores what it heard. Ten words, three tries each, pass at
  75 accuracy and 90 completeness.`
- `Start a round` / `10 weakest words with sentences. About three minutes.`
- `Weakest first` · `Pick an island` · `Island`
- `Rounds` · `All` · `Mic` · `Self-mark` · `Newest` · `Worst first`
- `No rounds yet. Ten words is about three minutes.`
- `Shadow stats` · `Attempts · last 14 days` · `Accuracy by island` · `Worst words`
- `Nothing to compare yet. Finish a round.`

**Round**
- `3 of 10` · `Leave` · `Self-mark`
- `Play` · `Slow` · `no Korean voice`
- `Record` · `Stop` · `Listening. Say the sentence.` · `Listening is one tap away.`
- `Heard nothing. The mic opened but no speech came through.` / `No attempt used.` / `Record again`
- `Heard` · `reference` · `accuracy 82 · completeness 100 · gate 75 / 90`
- `passed` · `close` · `missed`
- `attempt 2 of 3` · `Third attempt. Flagged.`
- `Try again` · `Next word`
- `Say it out loud, then mark yourself.` · `Close enough` · `Not close` · `self-marked · not scored`
- `The browser blocked the microphone. Self-mark still works.` · `Switch to self-mark`
- `No Korean voice is installed in this browser. Play is off — read the sentence and say it.`
- `This browser cannot listen to speech. Rounds run in self-mark mode.`
- `Not saved yet. Retrying.` · `This round is not saved. It will retry next time you open the page.`

**Summary / detail**
- `Round finished` · `7 of 10 passed · average 74 · 3 flagged` · `Back to the board` · `New round`
- `unfinished · 4 of 10` · `not scored` · `flagged`
- `Play reference` · `Back to rounds` · `Delete this round`
- `Delete this round and its ten attempts? This cannot be undone.` / `Delete` / `Keep`

## 8. Tokens

Nothing new is needed. Three hex values already in the app get **names** so the loop can't drift:

| token | value | use | contrast on `#0c1620` |
|---|---|---|---|
| `--pass` | `#4fc3a1` (mint) | passed, tick filled, island bar | 8.4:1 |
| `--close` | `#ffd54f` (sand) | close band, flagged tick, warning lines | 12.9:1 |
| `--fail` | `#ff6b9d` (pink) | missed band, recording/stop fill | 6.8:1 (6.1:1 on `#12202d`) |
| `--record` | `#eaf2f7` (ink) | record button fill | 15:1 |

Type additions (takeover only): score `clamp(56px, 16vw, 72px)/1` w800 `-0.04em` tabular;
sentence `24px/1.55` w700 (mobile) → `28px` ≥760px; verdict `13px` w800 `0.08em` uppercase; gate
line `12px` muted. Everything else stays 15/13/12.

Spacing: 16px takeover gutter, 12px between blocks, 8px in the play row. Radius: 10px primary
buttons, 999 pills, 2px ticks. Shadow: none. Motion: 120ms `ease-out` on state swaps only; no
bounce; no score animation; recording dot reuses the existing `pulse` at 1.4s and stops under
`prefers-reduced-motion`.

## 9. Responsive & accessibility

- **375px**: takeover is `100dvh`, `display:flex; flex-direction:column`, sentence `flex:1`
  centered, primary pinned bottom above `env(safe-area-inset-bottom)`. No horizontal scroll at any
  state; the sentence wraps.
- **≤ 640 landscape**: sentence 20px, primary 64px, ticks stay top.
- **≥ 760**: takeover column 520px centered, sentence 28px. Board blocks cap at 720/760px.
- **Targets**: Record/Stop 76px tall full width; next-action 60px; Play/Slow 48px; Leave and
  Self-mark 44×44; every history row 56px; every chip 44px minimum height.
- **Focus**: on round open, focus `Record`; focus trapped inside the takeover (`inert` on the page
  root, Esc = Leave with the same confirm); on exit, focus returns to `Start a round`. On detail
  expand, focus `Back to rounds`; on collapse, focus the round row.
- **Announcements**: one `aria-live="polite"` region for the result verdict (`passed, 82`) and for
  `Heard nothing` / save errors. Never announce the interim transcript.
- **Labels**: ticks as one `role="img"` with a full sentence label; score number carries
  `aria-label="accuracy 82, passed"`.
- **Contrast**: all text ≥4.5:1 on navy; band colors used for numbers and 2–3px marks, never for
  body text on a fill.
- **Reduced motion**: no dot pulse, no state transitions, no tick fill animation.
- **Keyboard**: `Space`/`Enter` on Record toggles start/stop; `P` plays; `Esc` leaves (with
  confirm). Documented in visually-hidden help text.
- **Voice/mic detection is a fact chip, not a permission prompt** — never call `getUserMedia` on
  page load; the mic opens only on the first `Record`.

## 10. Cut list

- **Router.** Hash parsing for `#shadow/round/<id>` only.
- **Separate History and Stats sections/pills.** One `#shadow` section with three blocks.
- **A pre-round "ready" screen.** The board CTA is the gesture; the first sentence appears
  immediately.
- **Self-mark scores in averages.** Counted, labeled, excluded.
- **Editing an attempt or a score.** Violates the standing edit/delete rule on purpose: a score is
  a record of what happened, not a field. Delete the round instead. Say this in the PR.
- **Waveform, prosody, phoneme names, stored audio.**
- **Shadow streak.** Anki already owns the streak.
- **Overview stat cell for shadow average.** Scope creep.
- **Search over rounds.** Filters cover every dimension a round has.
- **"Start a round on these worst words" button.** That is what weakest-first already does.
- **Wake Lock.** Nice, one line, not required.

## 11. Handoff checklist

1. **The scoring seam is `grade(transcript, reference)` in its own module.** Nothing else may
   compute or know accuracy/completeness. Use `sylParts` for Hangul decomposition; do **not** use
   `normKo` — it strips `-아요/습니다/다` endings and would forgive the endings he must say.
2. **Cancel `speechSynthesis` before `recognition.start()`**, and wait for `voiceschanged` before
   trusting `getVoices()`. `Play` must always work as a real gesture, because iOS Safari may
   demand one per utterance. Never let TTS run while the mic is live.
3. **The loop never blocks on the network.** Attempts are fire-and-forget with a localStorage
   queue; a failed save shows `Not saved yet. Retrying.`. Open the round row at start
   (`finished_at NULL`) so a reload mid-round keeps its attempts and shows as `unfinished`.
4. **Weakest-first must skip words passed in the last 7 days**, or "New round" hands back the
   same ten words forever. Fill from the weakest if fewer than 10 remain; dedupe by term; cap 10;
   island rounds go as low as 4.
5. **Takeover is `role="dialog" aria-modal="true"` with `inert` on the page root**, body scroll
   locked, focus on `Record`, Esc = Leave, focus restored on exit. One primary action visible at a
   time.

**Flagged for the engineer (risky / expensive)**
- `webkitSpeechRecognition` on iOS Safari exists but frequently returns nothing, and stops when
  the screen locks. Hence the in-round `Self-mark` escape hatch.
- Chrome's recognizer ends on ~1s of silence and fires `onend`; a short Korean sentence can end
  the session early. Use `continuous=false` + `interimResults=true`, auto-stop at 8s, and treat an
  empty final transcript as heard-nothing rather than a zero.
- Server-side grading later means `grade.js` must be pure and its inputs/outputs stored verbatim
  (`reference`, `transcript`, `accuracy`, `completeness`).
- Optional one-liner: Wake Lock during a round.
