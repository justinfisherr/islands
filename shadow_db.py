#!/usr/bin/env python3
"""Read-only Postgres access for shadowing (hub.shadow_rounds / hub.shadow_attempts).

Same shapes the GET of api/shadow.js returns, so agents can read shadow data
without the HTTP token. There is no write path in here on purpose: rows are
written by the app only.

Connection: DATABASE_URL, else POSTGRES_URL, else ~/.hub_db_url (falling back to
~/.home_db_url, which holds the islands "hub" database on this PC).

Examples:
  python3 shadow_db.py              # this week (the vault rollup numbers)
  python3 shadow_db.py --stats
  python3 shadow_db.py --list 10 --island Food
  python3 shadow_db.py --week --json
  python3 shadow_db.py --selftest
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import psycopg2
from psycopg2.extras import RealDictCursor

WEEK_GOAL_DAYS = 4  # "shadow 4 of 7 days" in ~/Goals/Korean.md


def get_url():
    for env in ("DATABASE_URL", "POSTGRES_URL"):
        if os.environ.get(env):
            return os.environ[env]
    home = os.path.expanduser("~")
    for name in (".hub_db_url", ".home_db_url"):
        path = os.path.join(home, name)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                url = f.read().strip()
            if url:
                return url
    return None


def get_conn():
    url = get_url()
    if not url:
        raise RuntimeError("DATABASE_URL not set (e.g. DATABASE_URL=$(cat ~/.hub_db_url))")
    return psycopg2.connect(url)


def _iso(dt):
    """UTC ISO-8601 with milliseconds, same string JS toISOString() produces."""
    if dt is None:
        return None
    dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def fetch_rounds(limit=30, island=None):
    """Rounds newest first, each with its attempts nested (api/shadow.js listRounds)."""
    limit = max(1, min(60, int(limit)))
    with get_conn() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        params = []
        where = ""
        if island:
            params.append(island)
            where = "WHERE island = %s"
        params.append(limit)
        cur.execute(
            f"""
            SELECT id, client_id, started_at, finished_at, size, source, island, mode, avg_score, passed
              FROM hub.shadow_rounds
              {where}
             ORDER BY started_at DESC
             LIMIT %s
            """,
            tuple(params),
        )
        rounds = [
            {
                "id": r["id"],
                "client_id": r["client_id"],
                "started_at": _iso(r["started_at"]),
                "finished_at": _iso(r["finished_at"]),
                "size": r["size"],
                "source": r["source"],
                "island": r["island"],
                "mode": r["mode"],
                "avg_score": r["avg_score"],
                "passed": r["passed"],
                "attempts": [],
            }
            for r in cur.fetchall()
        ]
        if not rounds:
            return rounds
        by_id = {r["id"]: r for r in rounds}
        cur.execute(
            """
            SELECT id, round_id, term, reference, transcript, accuracy, completeness, score,
                   attempt_no, mode, passed, created_at
              FROM hub.shadow_attempts
             WHERE round_id = ANY(%s)
             ORDER BY term, attempt_no
            """,
            (list(by_id),),
        )
        for a in cur.fetchall():
            rnd = by_id.get(a["round_id"])
            if not rnd:
                continue
            rnd["attempts"].append(
                {
                    "id": a["id"],
                    "term": a["term"],
                    "reference": a["reference"],
                    "transcript": a["transcript"],
                    "accuracy": a["accuracy"],
                    "completeness": a["completeness"],
                    "score": a["score"],
                    "attempt_no": a["attempt_no"],
                    "mode": a["mode"],
                    "passed": a["passed"],
                    "created_at": _iso(a["created_at"]),
                }
            )
        return rounds


def stats():
    """Same aggregates as api/shadow.js stats()."""
    with get_conn() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """SELECT count(*)::int AS n, round(avg(score))::int AS avg_score
                 FROM hub.shadow_attempts"""
        )
        totals = cur.fetchone()

        cur.execute(
            """SELECT to_char(created_at, 'YYYY-MM-DD') AS day,
                      count(*)::int AS n,
                      count(*) FILTER (WHERE mode = 'self')::int AS self
                 FROM hub.shadow_attempts
                WHERE created_at >= now() - interval '14 days'
                GROUP BY 1"""
        )
        seen = {r["day"]: r for r in cur.fetchall()}

        cur.execute(
            """SELECT r.island, round(avg(a.score))::int AS avg_score, count(*)::int AS n
                 FROM hub.shadow_attempts a
                 JOIN hub.shadow_rounds r ON r.id = a.round_id
                WHERE a.score IS NOT NULL
                GROUP BY r.island
                ORDER BY avg_score ASC"""
        )
        islands = [dict(r) for r in cur.fetchall()]

        cur.execute(
            """SELECT term, max(score)::int AS best_score, count(*)::int AS tries
                 FROM hub.shadow_attempts
                WHERE score IS NOT NULL
                GROUP BY term
                ORDER BY best_score ASC, tries DESC, term ASC
                LIMIT 10"""
        )
        worst = [dict(r) for r in cur.fetchall()]

    # 14 zero-filled days, oldest first, in UTC like the rows themselves.
    today = datetime.now(timezone.utc)
    by_day = []
    for i in range(13, -1, -1):
        key = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        row = seen.get(key)
        by_day.append({"day": key, "n": row["n"] if row else 0, "self": row["self"] if row else 0})

    return {
        "attempts_total": totals["n"] or 0,
        "avg_score": totals["avg_score"],
        "by_day": by_day,
        "by_island": islands,
        "worst_words": worst,
    }


def week():
    """This week (Monday start) from finished rounds only — the vault rollup numbers."""
    with get_conn() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """SELECT count(*)::int AS rounds,
                      round(avg(avg_score))::int AS avg_score,
                      coalesce(sum(passed), 0)::int AS words_passed,
                      count(DISTINCT date(started_at))::int AS days_shadowed,
                      to_char(date_trunc('week', now()), 'YYYY-MM-DD') AS week_start
                 FROM hub.shadow_rounds
                WHERE finished_at IS NOT NULL
                  AND started_at >= date_trunc('week', now())"""
        )
        row = cur.fetchone()
    return {
        "week_start": row["week_start"],
        "days_shadowed": row["days_shadowed"] or 0,
        "goal_days": WEEK_GOAL_DAYS,
        "rounds": row["rounds"] or 0,
        "avg_score": row["avg_score"],
        "words_passed": row["words_passed"] or 0,
    }


def _avg(v):
    return "-" if v is None else str(v)


def show_week(w):
    print(
        f"Week of {w['week_start']} · {w['days_shadowed']} of {w['goal_days']} days · "
        f"{w['rounds']} rounds · avg {_avg(w['avg_score'])} · {w['words_passed']} words passed"
    )


def show_stats(s):
    print(f"{s['attempts_total']} attempts · avg {_avg(s['avg_score'])}")
    print("\nattempts, last 14 days (oldest first):")
    for d in s["by_day"]:
        bar = "#" * min(d["n"], 40)
        extra = f" ({d['self']} self)" if d["self"] else ""
        print(f"  {d['day']}  {d['n']:>3} {bar}{extra}")
    print("\nby island:")
    if not s["by_island"]:
        print("  (none)")
    for r in s["by_island"]:
        print(f"  {r['island'] or '(no island)':<16} avg {_avg(r['avg_score']):>3}  {r['n']} attempts")
    print("\nworst words:")
    if not s["worst_words"]:
        print("  (none)")
    for r in s["worst_words"]:
        print(f"  {r['term']:<20} best {r['best_score']:>3}  {r['tries']} tries")


def show_list(rounds):
    if not rounds:
        print("(no rounds yet)")
        return
    for r in rounds:
        day = (r["started_at"] or "")[:16].replace("T", " ")
        where = f"{r['source']}:{r['island']}" if r["island"] else r["source"]
        print(
            f"{day}  {where:<18}  {r['passed']}/{r['size']}  avg {_avg(r['avg_score'])}"
            + ("" if r["finished_at"] else "  (unfinished)")
        )


def selftest():
    s = stats()
    assert set(s) == {"attempts_total", "avg_score", "by_day", "by_island", "worst_words"}, sorted(s)
    assert isinstance(s["attempts_total"], int) and s["attempts_total"] >= 0
    assert len(s["by_day"]) == 14, len(s["by_day"])
    assert all(set(d) == {"day", "n", "self"} for d in s["by_day"])
    assert all(d["n"] >= 0 and d["self"] >= 0 and d["self"] <= d["n"] for d in s["by_day"])
    assert s["by_day"] == sorted(s["by_day"], key=lambda d: d["day"])
    assert all(set(r) == {"island", "avg_score", "n"} and r["n"] >= 0 for r in s["by_island"])
    assert all(set(r) == {"term", "best_score", "tries"} and r["tries"] >= 0 for r in s["worst_words"])
    print("stats ok: 14 days, totals", s["attempts_total"], "avg", s["avg_score"])

    w = week()
    assert set(w) == {"week_start", "days_shadowed", "goal_days", "rounds", "avg_score", "words_passed"}, sorted(w)
    assert w["goal_days"] == WEEK_GOAL_DAYS
    assert 0 <= w["days_shadowed"] <= 7, w["days_shadowed"]
    assert w["rounds"] >= 0 and w["words_passed"] >= 0
    assert len(w["week_start"]) == 10
    print("week ok:", w)

    rounds = fetch_rounds(limit=1)
    assert isinstance(rounds, list)
    if rounds:
        assert set(rounds[0]) == {
            "id", "client_id", "started_at", "finished_at", "size", "source",
            "island", "mode", "avg_score", "passed", "attempts",
        }, sorted(rounds[0])
        assert isinstance(rounds[0]["attempts"], list)
    print("fetch_rounds ok:", len(rounds), "round(s)")
    print("selftest passed")


def main():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except AttributeError:
            pass

    p = argparse.ArgumentParser(description="Read shadowing rounds/attempts (read-only)")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--list", nargs="?", type=int, const=30, metavar="N", help="recent rounds (default 30)")
    mode.add_argument("--stats", action="store_true", help="aggregates")
    mode.add_argument("--week", action="store_true", help="this week (default)")
    mode.add_argument("--selftest", action="store_true", help="assert the shapes against the live DB")
    p.add_argument("--island", default=None, help="filter --list by island")
    p.add_argument("--json", action="store_true", help="machine output")
    args = p.parse_args()

    if args.selftest:
        selftest()
        return
    if args.stats:
        s = stats()
        print(json.dumps(s, ensure_ascii=False)) if args.json else show_stats(s)
    elif args.list is not None:
        rounds = fetch_rounds(limit=args.list, island=args.island)
        print(json.dumps(rounds, ensure_ascii=False)) if args.json else show_list(rounds)
    else:
        w = week()
        print(json.dumps(w, ensure_ascii=False)) if args.json else show_week(w)


if __name__ == "__main__":
    main()
