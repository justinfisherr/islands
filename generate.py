#!/usr/bin/env python3
"""Regenerate `public/data.json` (the Korean Islands snapshot) from Anki.

Reads `domains.json` for the word → domain → island mapping, reads live card
state straight out of the Anki collection (no AnkiConnect, no Anki GUI), and
writes the snapshot the 3D app loads. Only rewrites when word data changed.

Run it with the interpreter that has the `anki` library (~/anki-venv on kairi):

    ~/anki-venv/bin/python3 generate.py
"""

from __future__ import annotations

import json
import math
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from anki.collection import Collection

ROOT = Path(__file__).resolve().parent
DECK = os.environ.get("ANKI_DECK", "Korean-lingq")
COLLECTION = Path(
    os.environ.get("ANKI_COLLECTION", "")
    or Path.home() / ".local/share/Anki2/User 1/collection.anki2"
).expanduser()


def _deck(extra: str = "") -> str:
    query = f'deck:"{DECK}"'
    return f"{query} {extra}".strip() if extra else query


def _collection() -> Collection:
    if not COLLECTION.exists():
        raise SystemExit(
            f"no Anki collection at {COLLECTION} — run the one-time AnkiWeb login first"
        )
    return Collection(str(COLLECTION))


def cards_info(col: Collection) -> list[dict]:
    """Card state shaped like AnkiConnect's cardsInfo, read from the collection."""
    leech = set(col.find_cards(_deck("tag:leech")))
    out: list[dict] = []
    for cid in col.find_cards(_deck()):
        card = col.get_card(cid)
        note = card.note()
        out.append(
            {
                "cardId": cid,
                "fields": {name: {"value": note[name]} for name in note.keys()},
                "type": card.type,
                "queue": card.queue,
                "interval": card.ivl,
                "lapses": card.lapses,
                "leech": cid in leech,
            }
        )
    return out


def word_health(card: dict) -> tuple[str, float]:
    ctype = card.get("type", 0)
    if ctype == 0:  # new — essentially no health
        return "new", 0.02
    if ctype in (1, 3):  # learning or relearning (forgot it)
        return "learning", 0.10
    interval = max(card.get("interval", 0), 0)
    # maturity: log curve with no floor — 2d ~ 0.21, 7d ~ 0.40, 30d ~ 0.66, 180d = 1.0
    h = min(1.0, math.log(interval + 1) / math.log(181))
    return "review", round(h, 3)


def build_data() -> dict:
    domains_cfg = json.loads((ROOT / "domains.json").read_text(encoding="utf-8"))
    col = _collection()
    try:
        cards = cards_info(col)
    finally:
        col.close()

    by_term: dict[str, dict] = {}
    for c in cards:
        f = c.get("fields", {})
        term = (f.get("Term") or {}).get("value", "").strip()
        if not term:
            continue
        status, health = word_health(c)
        by_term[term] = {
            "term": term,
            "meaning": (f.get("MeaningEn") or {}).get("value", ""),
            "base_form": (f.get("BaseForm") or {}).get("value", ""),
            "example": (f.get("ExampleKo") or {}).get("value", ""),
            "example_en": (f.get("ExampleEn") or {}).get("value", ""),
            "mnemonic": (f.get("Mnemonic") or {}).get("value", ""),
            "similar": (f.get("SimilarWords") or {}).get("value", ""),
            "status": status,
            "interval_days": c.get("interval", 0) if c.get("type", 0) == 2 else 0,
            "lapses": c.get("lapses", 0),
            "leech": c["leech"],
            "suspended": c.get("queue", 0) == -1,
            "health": health,
        }

    classified: set[str] = set()
    out_domains: list[dict] = []
    for d in domains_cfg["domains"]:
        islands = []
        for isl in d.get("islands", []):
            words = [by_term[t] for t in isl.get("terms", []) if t in by_term]
            classified.update(isl.get("terms", []))
            if not words:
                continue
            size = len(words)
            health = round(sum(w["health"] for w in words) / size, 3)
            islands.append(
                {
                    "id": isl.get("id"),
                    "name": isl.get("name"),
                    "name_native": isl.get("name_native"),
                    "size": size,
                    "health": health,
                    "words": words,
                }
            )
        if islands:
            out_domains.append(
                {
                    "id": d.get("id"),
                    "name": d.get("name"),
                    "name_native": d.get("name_native"),
                    "islands": islands,
                }
            )

    leftovers = [w for t, w in by_term.items() if t not in classified]
    if leftovers:
        health = round(sum(w["health"] for w in leftovers) / len(leftovers), 3)
        out_domains.append(
            {
                "id": "unmapped",
                "name": "Unmapped",
                "name_native": "기타",
                "islands": [
                    {
                        "id": "unmapped",
                        "name": "Not yet placed",
                        "name_native": "미분류",
                        "size": len(leftovers),
                        "health": health,
                        "words": sorted(leftovers, key=lambda w: w["term"]),
                    }
                ],
            }
        )

    overall = round(sum(w["health"] for w in by_term.values()) / len(by_term), 3) if by_term else 0.0
    leeches = [
        {
            "term": w["term"],
            "meaning": w["meaning"],
            "base_form": w["base_form"],
            "example": w["example"],
            "example_en": w["example_en"],
            "mnemonic": w["mnemonic"],
            "similar": w["similar"],
            "lapses": w["lapses"],
            "suspended": w["suspended"],
            "interval_days": w["interval_days"],
            "status": w["status"],
        }
        for w in sorted(by_term.values(), key=lambda w: (-w["lapses"], w["term"]))
        if w["leech"]
    ]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "deck": DECK,
        "total_words": len(by_term),
        "overall_health": overall,
        "leeches": leeches,
        "domains": out_domains,
    }


def build_review() -> dict:
    """Review history + scheduling snapshot for the Habits section.

    Also carries the "new word" counts the vault app's Korean goal reads, so the
    goal is fed by whichever machine owns the collection instead of a copy.
    """
    col = _collection()
    try:
        by_day: dict[str, int] = {}
        for rid, rtype in col.db.all("select id, type from revlog"):
            if rtype == 4:  # manual (set due date / forget), not a review
                continue
            day = datetime.fromtimestamp(rid / 1000).strftime("%Y-%m-%d")
            by_day[day] = by_day.get(day, 0) + 1

        new_by_day: dict[str, int] = {}
        for nid in col.find_notes("tag:lingq-anki"):
            day = datetime.fromtimestamp(nid / 1000).strftime("%Y-%m-%d")
            new_by_day[day] = new_by_day.get(day, 0) + 1

        today = datetime.now().strftime("%Y-%m-%d")
        since_7d = (datetime.now() - timedelta(days=6)).strftime("%Y-%m-%d")
        monday = (datetime.now() - timedelta(days=datetime.now().weekday())).strftime("%Y-%m-%d")
        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "by_day": by_day,
            "new_by_day": new_by_day,
            "today_reviewed": by_day.get(today, 0),
            "reviews_7d": sum(n for d, n in by_day.items() if d >= since_7d),
            "new_today": new_by_day.get(today, 0),
            "new_week": sum(n for d, n in new_by_day.items() if d >= monday),
            "last_review_day": max(by_day) if by_day else None,
            "week_start": monday,
            "due_now": len(col.find_cards(_deck("is:due"))),
            "due_tomorrow": len(col.find_cards(_deck("prop:due=1"))),
            "due_7d": len(col.find_cards(_deck("prop:due<=7"))),
            "total_cards": len(col.find_cards(_deck())),
        }
    finally:
        col.close()


def _without_meta(data: dict) -> dict:
    return {k: v for k, v in data.items() if k != "generated_at"}


if __name__ == "__main__":
    data = build_data()
    out = ROOT / "public" / "data.json"
    existing = json.loads(out.read_text(encoding="utf-8")) if out.exists() else {}
    if _without_meta(existing) == _without_meta(data):
        print("no change — public/data.json up to date")
    else:
        out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"wrote {out} — {data['total_words']} words, overall health {data['overall_health']}")

    review = build_review()
    review_out = ROOT / "public" / "review.json"
    review_existing = json.loads(review_out.read_text(encoding="utf-8")) if review_out.exists() else {}
    if _without_meta(review_existing) == _without_meta(review):
        print("no change — public/review.json up to date")
    else:
        review_out.write_text(json.dumps(review, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"wrote {review_out} — {review['due_now']} due now, {review['due_7d']} due in 7d")
