#!/usr/bin/env python3
"""Regenerate `public/data.json` (the Korean Islands snapshot) from Anki.

Run on the VM (where AnkiConnect lives). Reads `domains.json` for the word →
domain → island mapping, pulls live card state from AnkiConnect, and writes the
snapshot the 3D app loads. Only rewrites when word data actually changed.

    python3 generate.py
"""

from __future__ import annotations

import json
import math
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ANKI_URL = "http://127.0.0.1:8765"
DECK = "Korean-lingq"


def anki(action: str, **params):
    req = urllib.request.Request(
        ANKI_URL,
        data=json.dumps({"action": action, "version": 6, "params": params}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.load(resp)
    if payload.get("error") is not None:
        raise RuntimeError(f"AnkiConnect {action}: {payload['error']}")
    return payload["result"]


def word_health(card: dict) -> tuple[str, float]:
    ctype = card.get("type", 0)
    if ctype == 0:
        return "new", 0.15
    if ctype == 1:
        return "learning", 0.35
    interval = max(card.get("interval", 0), 0)
    h = min(1.0, 0.4 + 0.6 * (math.log(interval + 1) / math.log(181)))
    return "review", round(h, 3)


def build_data() -> dict:
    domains_cfg = json.loads((ROOT / "domains.json").read_text(encoding="utf-8"))
    cards = anki("findCards", query=f"deck:{DECK}")
    cards_info = anki("cardsInfo", cards=cards)

    by_term: dict[str, dict] = {}
    for c in cards_info:
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
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "deck": DECK,
        "total_words": len(by_term),
        "overall_health": overall,
        "domains": out_domains,
    }


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
