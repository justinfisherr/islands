# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Justin checking his Korean progress. Desktop or phone, short sessions, usually after a sync or a review session.

## Product Purpose
A one-page, honest read on his Korean vocabulary: what he knows against the most common Korean words, what is falling apart, which cards have crossed Anki's leech threshold, and what a teacher would actually say about his level right now.

## Positioning
A quiet scoreboard, not a game: coverage as a GitHub-style grid, shaky words surfaced instead of hidden, and an AI level check that is funny but grounded in real data.

## Operating Context
Data is generated from the Anki deck via `generate.py` into `public/data.json`; a sync button pushes new LingQ-tagged words into Anki and regenerates the data through the hub's sync worker. Leech cards can be retired from the page with a new mnemonic, which removes Anki's leech tag and makes the card due now. The reference grid comes from `public/vocab.json` (top 2000 combined TOPIK + National Institute list, bucketed by part of speech).

## Capabilities and Constraints
Vite + React on Vercel with a small serverless level API (`/api/level`). No VR, no account system. Single page — navigation anchors scroll, it does not change routes. Runs on phones.

## Brand Commitments
Navy sea background with mint for "known" and pale squares for "not learned yet". Quiet, honest, no fake progress bars, no emojis.

## Evidence on Hand
Real deck data (163 words) and the real common-vocabulary list. Every square is a real word; every number is a real count. The AI level is the only AI-generated content and is clearly labeled.

## Product Principles
1. Green means you actually have the card; white means you have not met it.
2. Surface the leeches — they are the work.
3. The level check should feel like a friend who happens to be a teacher, not a marketing page.
4. One page, scroll, done.

## Accessibility & Inclusion
Muted text at 4.5:1 or better against the navy background, keyboard focus on every control, reduced-motion respected, tap targets large enough for phones.