---
name: My Korean
description: One-page vocabulary scoreboard.
colors:
  sea: "#12202d"
  navy-deep: "#0c1620"
  ink: "#eaf2f7"
  muted: "#8fa6b8"
  mint: "#4fc3a1"
  sand: "#ffd54f"
  hairline: "#2a4356"
  empty-cell: "#2c4054"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "clamp(30px, 7vw, 52px)"
    fontWeight: 800
    letterSpacing: "-0.03em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "15px"
    fontWeight: 400
rounded:
  cell: "2px"
  panel: "10px"
  pill: "999px"
---

# Design System: My Korean

## Overview

**Creative North Star: "The Scoreboard"**

A deep-navy vocabulary scoreboard. Coverage is a GitHub-style grid of small squares — green means the card is in the deck, pale means the common word has not been met. The page is honest first: numbers are real, leeches are named, and the AI level check sits below with its own clearly-labeled section.

## Colors

Deep navy background (`navy-deep`), mint for "known" (scaled by card health), pale blue-gray for unknown cells, sand for warning states (shaky words, level stage). Hairline borders separate blocks; nothing is boxed heavily.

## Typography

System UI. A large bold title, 13–15px body and notes, tabular feel in the stat numbers. No display face beyond the title.

## Layout

Single 980px column. Sticky top bar with anchor nav and the sync control. Sections in order: Overview (stat cells), Vocabulary grid (grouped by part of speech), Habits, Leeches, Word browser, Level check, Pace. Footer carries data sources.

## Shapes

Small 2px-radius squares for the grid; 10px-radius panels; pills for nav, tags, and the sync button. No nested cards.

## Do's and Don'ts

**Do** keep the grid legible, group by word type, and let the empty squares speak — they are the point.
**Do** say the stage plainly ("Babbling Toddler") and let the teacher write the roast.
**Do** let a leech card carry its lapse count and require a genuinely new mnemonic before it can be cleared.
**Don't** add fake progress, charts for chart's sake, bright game chrome, or emojis over the world.
**Don't** make the level check feel like a landing page; it is one card on a longer scroll.