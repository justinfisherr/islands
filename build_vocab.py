#!/usr/bin/env python3
"""Build public/vocab.json (the common-vocabulary reference grid) from the
combined National Institute + TOPIK list (data/korean-common.tsv, MIT).

Keeps the top N most-frequent headwords and buckets them by part of speech so
the grid can cluster verbs/adjectives/etc.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "data" / "korean-common.tsv"
OUT = ROOT / "public" / "vocab.json"
TOP_N = 2000

POS = {
    "명사": ("noun", "Nouns", "명사"),
    "대명사": ("pronoun", "Pronouns", "대명사"),
    "동사": ("verb", "Verbs", "동사"),
    "형용사": ("adjective", "Adjectives", "형용사"),
    "부사": ("adverb", "Adverbs", "부사"),
    "관형사": ("determiner", "Determiners", "관형사"),
    "감탄사": ("interjection", "Interjections", "감탄사"),
    "조사": ("particle", "Particles", "조사"),
    "수사": ("numeral", "Numerals", "수사"),
    "접사": ("affix", "Affixes", "접사"),
}

ORDER = ["verb", "adjective", "noun", "adverb", "pronoun", "determiner", "numeral", "particle", "interjection", "affix", "other"]


def main() -> None:
    entries = []
    with SRC.open(encoding="utf-8") as f:
        reader = csv.reader(f, delimiter="\t")
        next(reader, None)
        for row in reader:
            if len(row) < 5:
                continue
            try:
                rank = int(row[0])
            except ValueError:
                continue
            word = row[1].strip()
            if not word:
                continue
            pos = row[2].strip()
            key, en, ko = POS.get(pos, ("other", "Other", "기타"))
            entries.append(
                {
                    "t": word,
                    "p": key,
                    "e": row[4].strip()[:40],
                    "r": rank,
                    "ko": ko,
                    "en": en,
                }
            )

    entries.sort(key=lambda x: x["r"])
    entries = entries[:TOP_N]
    entries.sort(key=lambda x: (ORDER.index(x["p"]), x["r"]))

    OUT.write_text(json.dumps(entries, ensure_ascii=False), encoding="utf-8")
    from collections import Counter

    print(f"wrote {OUT} — {len(entries)} entries")
    for key, n in Counter(e["p"] for e in entries).items():
        print(f"  {key}: {n}")


if __name__ == "__main__":
    main()