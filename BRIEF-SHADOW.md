# BRIEF — Shadowing (phase one)

## Problem
Justin learns Korean from a 248-word Anki deck (`Korean-lingq`). The islands page tells him
what he recognizes. It says nothing about whether he can *say* it. Shadowing is the missing
link: hear the sentence, say it back, get scored, only move on when it's close. Today there is
no speaking surface anywhere in his apps.

## Who it's for
Justin, solo. **No person switcher** — deliberate exception to the multi-user rule, same as
`learn`. He studies on his phone in short bursts.

## Surface / app
`~/Projects/islands` — Vite + React one-page app, Vercel (`islands-green.vercel.app`).
Postgres already wired through `api/level.js` (`process.env.DATABASE_URL`, schema `hub`);
the new endpoint follows that pattern. Push to `main` deploys.

## Data already on hand
`public/data.json`: `domains[].islands[].words[]`, each word has `term`, `meaning`,
`example` (Korean sentence), `example_en`, `status`, `interval_days`, `lapses`, `leech`,
`health` (0–1). Every card already carries its sentence. Nothing new to source.

## Must-haves (phase one)
1. **Shadow section** in the app, reachable from the sticky nav. Existing sections: overview,
   grid, habits, leeches, words.
2. **Rounds of ten.** A round is 10 words with sentences, no repeats inside a round. Default
   selection: weakest first (low `health`, high `lapses`). Also let him start a round from a
   specific island. "New round" reshuffles.
3. **Playback.** Browser `speechSynthesis` with a `ko-KR` voice, slightly slowed. Play, replay,
   slow. If no Korean voice is installed, say so plainly and still let the round run on the
   reference text — never a dead button.
4. **Record + grade.** Tap to start, tap to stop. Grade with `webkitSpeechRecognition`
   (`lang='ko-KR'`), comparing the transcript to the reference at Korean syllable level.
   Score 0–100. Always show what it heard.
5. **The gate.** Pass at accuracy ≥ 75 **and** completeness ≥ 90. Three attempts max, then it
   shows the score, flags the word, and moves on. Never a dead end.
6. **Persist.** Every attempt stored. Every round stored with start, finish, size, average
   score, and island.
7. **Round detail view.** All ten words, each with score, what it heard, its own audio replay,
   and a back path. Reachable from history.
8. **History.** Past rounds, newest first, filterable by island and by score, each clickable
   into its detail.
9. **Stats.** Attempts over time, average accuracy per island, worst-words list with each word
   clickable.
10. **Degradation.** If the browser has no speech recognition (likely on iOS Safari), the app
    runs the round in listen-and-repeat self-mark mode instead of breaking. Say which mode
    you're in.
11. Mobile first. Existing navy/mint theme. No emojis.

## Non-goals (phase one)
- No Azure or any paid API, no keys. Grading is browser-only; leave a clean seam for a
  server-side grader later.
- No pre-generated MP3s / Vercel Blob audio yet.
- No phoneme names, waveform, or prosody.
- No audio storage — transcript and score only.
- No shadowing SRS. Anki already schedules.
- No multi-user.

## Success criteria
- On a phone: open the app, start a round, hear ten sentences, record each, get a score, pass
  or flag, and the round is still in history with its scores after a reload.
- A round where every word fails still finishes in under three minutes.
- A browser with no speech recognition still completes a round.

## Product rules in force
Everything clickable into a detail view with edit/delete/back · everything filterable ·
typeahead where search exists · data has shape (a round contains attempts) · data talks back
(charts, worst words) · auto-fill the boring parts · cute with personality, readable text ·
mobile first · simplify ruthlessly.
