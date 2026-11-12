import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ShadowBoard from "./components/shadow/ShadowBoard.jsx";
import ShadowRound from "./components/shadow/ShadowRound.jsx";
import { flattenWords, islandsOf, pickRound } from "./lib/shadow/select.js";
import { deleteRound, fetchShadow, flushQueue } from "./lib/shadow/save.js";

const SYNC_API = "https://home-lilac-five.vercel.app/api/sync";
const SYNC_TOKEN = import.meta.env.VITE_SYNC_TOKEN || "";
const LEVEL_TOKEN = import.meta.env.VITE_LEVEL_TOKEN || "";

const POS_META = {
  verb: ["동사", "Verbs"],
  adjective: ["형용사", "Adjectives"],
  noun: ["명사", "Nouns"],
  adverb: ["부사", "Adverbs"],
  pronoun: ["대명사", "Pronouns"],
  determiner: ["관형사", "Determiners"],
  numeral: ["수사", "Numerals"],
  particle: ["조사", "Particles"],
  interjection: ["감탄사", "Interjections"],
  affix: ["접사", "Affixes"],
  other: ["기타", "Other"],
};
const POS_ORDER = Object.keys(POS_META);

function mint(health) {
  const a = 0.4 + 0.6 * Math.min(1, Math.max(0, health));
  return `rgba(79,195,161,${a.toFixed(2)})`;
}

// --- Korean fuzzy matching -------------------------------------------------
// Compare a reference headword to the words actually in the deck, accepting
// real conjugation contractions (흐리다↔흐려요, 끼다↔껴요, 배우다↔배워요) while
// refusing lookalikes (개 vs 가, 오르다 vs 오전).
const VOWEL_PAIRS = new Set([
  '19,6', '6,19', // ㅣ ↔ ㅕ
  '13,14', '14,13', // ㅜ ↔ ㅝ
  '8,9', '9,8', // ㅗ ↔ ㅘ
  '17,0', '0,17', // ㅡ ↔ ㅏ
]);

function normKo(raw) {
  let s = String(raw || '').replace(/\d+$/, '');
  s = s.replace(/[\s.,!?…'"“”·]/g, '');
  s = s.replace(/(습니다|니다)$/, '');
  s = s.replace(/(어요|아요|해요|예요|이에요)$/, '');
  s = s.replace(/요$/, '');
  s = s.replace(/하다$/, '');
  s = s.replace(/다$/, '');
  return s;
}

function sylParts(ch) {
  const c = ch.charCodeAt(0) - 0xac00;
  if (c < 0 || c > 11171) return null;
  return [Math.floor(c / 588), Math.floor((c % 588) / 28), c % 28];
}

function stemCompatible(a, b) {
  if (!a || !b || a.length !== b.length || a.slice(0, -1) !== b.slice(0, -1)) return false;
  const sa = sylParts(a[a.length - 1]);
  const sb = sylParts(b[b.length - 1]);
  if (!sa || !sb) return a === b;
  if (sa[0] !== sb[0] || sa[2] !== sb[2]) return false;
  return sa[1] === sb[1] || VOWEL_PAIRS.has(`${sa[1]},${sb[1]}`);
}

function isPredicate(w) {
  return /[다요]$/.test(w.term || '') || /[다요]$/.test(w.base_form || '');
}

function buildMatcher(words) {
  const buckets = new Map();
  const exact = new Map();
  for (const w of words.values()) {
    for (const src of [w.term, w.base_form]) {
      const k = normKo(src);
      if (!k) continue;
      if (!exact.has(k)) exact.set(k, w);
      const bk = `${k.length}:${k[0]}`;
      if (!buckets.has(bk)) buckets.set(bk, []);
      buckets.get(bk).push({ k, w });
    }
  }
  const posOk = (w, pos) => (pos === 'verb' || pos === 'adjective' ? isPredicate(w) : true);
  return function find(refTerm, pos) {
    const rk = normKo(refTerm);
    if (!rk) return null;
    const ex = exact.get(rk);
    if (ex && posOk(ex, pos)) return ex;
    const bucket = buckets.get(`${rk.length}:${rk[0]}`) || [];
    for (const { k, w } of bucket) {
      if (stemCompatible(rk, k) && posOk(w, pos)) return w;
    }
    return null;
  };
}

const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function buildWeeks(byDay, days = 133) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));
  const cells = [];
  for (let i = 0; i < start.getDay(); i += 1) cells.push(null);
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = ymd(d);
    cells.push({ key, count: byDay[key] || 0 });
  }
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function heatClass(n) {
  return n === 0 ? "" : n < 5 ? "l1" : n < 10 ? "l2" : n < 20 ? "l3" : "l4";
}

function computeStreak(byDay) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  let i = byDay[ymd(d)] ? 0 : 1;
  let streak = 0;
  for (; i < 800; i += 1) {
    const t = new Date(d);
    t.setDate(d.getDate() - i);
    if ((byDay[ymd(t)] || 0) > 0) streak += 1;
    else break;
  }
  return streak;
}

const fmtDate = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function LeechMark({ className = "" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 5c3.6 0 5.2 2.2 5.2 5.6 0 3.5 2.3 5.9 5.8 5.9 2.7 0 4-1.6 4-3.4 0-1.6-1.2-2.6-2.6-2.6S14 11.4 14 12.8" />
      <path d="M4 5v3.2" />
    </svg>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [vocab, setVocab] = useState(null);
  const [loadErr, setLoadErr] = useState(false);
  const [reloading, setReloading] = useState(false);

  const [syncOpen, setSyncOpen] = useState(false);
  const [syncState, setSyncState] = useState("idle"); // idle | busy
  const [syncStatus, setSyncStatus] = useState("");
  const [syncError, setSyncError] = useState("");

  const [levelState, setLevelState] = useState("idle"); // idle | loading | done | error
  const [levelResult, setLevelResult] = useState(null);
  const [levelError, setLevelError] = useState("");
  const [openSentences, setOpenSentences] = useState(() => new Set());
  const pendingRef = useRef(false);

  const toggleSentence = useCallback((i) => {
    setOpenSentences((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);

  const [review, setReview] = useState(null);
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [posFilter, setPosFilter] = useState("all");
  const [expanded, setExpanded] = useState(null);
  const [rate, setRate] = useState(10);
  const [leechEdits, setLeechEdits] = useState({});
  const [leechBusy, setLeechBusy] = useState("");
  const [leechStatus, setLeechStatus] = useState("");
  const [leechError, setLeechError] = useState("");

  const load = useCallback(() => {
    setLoadErr(false);
    setReloading(true);
    Promise.all([fetch("data.json"), fetch("vocab.json"), fetch("review.json")])
      .then(async ([a, b, c]) => {
        if (!a.ok || !b.ok || !c.ok) throw new Error("load failed");
        return [await a.json(), await b.json(), await c.json()];
      })
      .then(([d, v, r]) => {
        setData(d);
        setVocab(v);
        setReview(r);
      })
      .catch(() => setLoadErr(true))
      .finally(() => setReloading(false));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim().toLowerCase()), 180);
    return () => clearTimeout(t);
  }, [query]);

  const words = useMemo(() => {
    if (!data) return new Map();
    const m = new Map();
    for (const dom of data.domains || []) {
      for (const isl of dom.islands || []) {
        for (const w of isl.words || []) {
          if (w.term && !m.has(w.term)) m.set(w.term, w);
        }
      }
    }
    return m;
  }, [data]);

  const deck = useMemo(() => {
    const terms = Array.from(words.keys());
    let fresh = 0,
      longest = 0;
    for (const w of words.values()) {
      if (w.status === "new") fresh += 1;
      if (w.status === "review" && (w.interval_days || 0) > longest) {
        longest = w.interval_days || 0;
      }
    }
    const struggling = Array.from(words.values())
      .filter(
        (w) =>
          !w.leech &&
          (w.status === "learning" ||
            (w.status === "review" && (w.interval_days || 0) <= 1)),
      )
      .sort((a, b) => (a.interval_days || 0) - (b.interval_days || 0));
    return { terms, fresh, longest, struggling };
  }, [words]);

  const leeches = useMemo(() => {
    if (Array.isArray(data?.leeches)) return data.leeches;
    return Array.from(words.values())
      .filter((w) => w.leech)
      .sort((a, b) => (b.lapses || 0) - (a.lapses || 0));
  }, [data, words]);

  const refMatches = useMemo(() => {
    if (!vocab || !words.size) return new Map();
    const find = buildMatcher(words);
    const m = new Map();
    for (const e of vocab) {
      const w = find(e.t, e.p);
      if (w) m.set(e.t, w);
    }
    return m;
  }, [vocab, words]);

  const coverage = useMemo(() => {
    if (!vocab || !words.size) return { known: 0, total: 0, extra: 0 };
    const matchedDeck = new Set();
    for (const w of refMatches.values()) matchedDeck.add(w.term);
    const extra = deck.terms.filter((t) => !matchedDeck.has(t)).length;
    return { known: refMatches.size, total: vocab.length, extra };
  }, [vocab, words, deck, refMatches]);

  const groups = useMemo(() => {
    if (!vocab) return [];
    const buckets = new Map();
    for (const e of vocab) {
      if (!buckets.has(e.p)) buckets.set(e.p, []);
      buckets.get(e.p).push(e);
    }
    return POS_ORDER.filter((p) => buckets.has(p)).map((p) => {
      const items = buckets.get(p);
      const known = items.filter((e) => refMatches.has(e.t)).length;
      return { p, ko: POS_META[p][0], en: POS_META[p][1], items, known };
    });
  }, [vocab, refMatches]);

  // ---- habits ----
  const weeks = useMemo(() => (review ? buildWeeks(review.by_day) : []), [review]);
  const streak = useMemo(() => (review ? computeStreak(review.by_day) : 0), [review]);
  const buckets = useMemo(() => {
    const defs = [
      ["new", 0, 0],
      ["1–3d", 1, 3],
      ["4–7d", 4, 7],
      ["8–14d", 8, 14],
      ["15–30d", 15, 30],
      ["30d+", 31, 1e9],
    ];
    const counts = defs.map(([l]) => ({ l, n: 0 }));
    for (const w of words.values()) {
      const iv = w.interval_days || 0;
      if (w.status !== "review" || iv <= 0) counts[0].n += 1;
      else {
        const idx = defs.findIndex(([, lo, hi], i) => i > 0 && iv >= lo && iv <= hi);
        counts[idx < 0 ? 5 : idx].n += 1;
      }
    }
    return counts;
  }, [words]);
  const bucketMax = Math.max(1, ...buckets.map((b) => b.n));

  // ---- word browser ----
  const allWords = useMemo(() => {
    if (!vocab) return [];
    const list = vocab.map((e) => ({
      t: e.t,
      pos: e.p,
      expl: e.e,
      rank: e.r,
      known: refMatches.has(e.t),
      word: refMatches.get(e.t) || null,
      leech: !!refMatches.get(e.t)?.leech,
    }));
    const covered = new Set([...refMatches.values()].map((w) => w.term));
    for (const w of words.values()) {
      if (!covered.has(w.term)) {
        list.push({ t: w.term, pos: "", expl: w.meaning || "", rank: null, known: true, word: w, leech: !!w.leech });
      }
    }
    return list;
  }, [vocab, refMatches, words]);

  const results = useMemo(() => {
    const rs = allWords.filter((e) => {
      if (filter === "known" && !e.known) return false;
      if (filter === "unknown" && e.known) return false;
      if (filter === "leech" && !e.leech) return false;
      if (posFilter !== "all" && e.pos !== posFilter) return false;
      if (q) {
        const hay = `${e.t} ${e.known ? e.word?.meaning || "" : ""} ${e.expl || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return rs.slice(0, 80);
  }, [allWords, filter, posFilter, q]);

  // ---- pace ----
  const paceTargets = useMemo(
    () =>
      [250, 500, 1000, 2000].map((target) => {
        const weeks = Math.max(0, Math.ceil((target - coverage.known) / rate));
        const d = new Date();
        d.setDate(d.getDate() + weeks * 7);
        return { target, weeks, date: fmtDate(d) };
      }),
    [coverage.known, rate],
  );

  // ---- shadow ----
  const shadowWords = useMemo(() => flattenWords(data), [data]);
  const shadowIslands = useMemo(() => islandsOf(shadowWords), [shadowWords]);
  const [shadowMode, setShadowMode] = useState(() => {
    try {
      return localStorage.getItem("shadow_mode_v1") === "self" ? "self" : "mic";
    } catch {
      return "mic";
    }
  });
  const [shadowMicBlocked, setShadowMicBlocked] = useState(false);
  const [shadowSource, setShadowSource] = useState("weakest");
  const [shadowIsland, setShadowIsland] = useState("");
  const [round, setRound] = useState(null);
  const [shadowRounds, setShadowRounds] = useState([]);
  const [shadowStats, setShadowStats] = useState(null);
  const [shadowLoad, setShadowLoad] = useState("loading"); // loading | done | error
  const [openRoundId, setOpenRoundId] = useState(null);
  const [deletingRound, setDeletingRound] = useState(null);

  const loadShadow = useCallback(async () => {
    setShadowLoad("loading");
    try {
      const d = await fetchShadow({ limit: 30 });
      setShadowRounds(Array.isArray(d.rounds) ? d.rounds : []);
      setShadowStats(d.stats || null);
      setShadowLoad("done");
    } catch {
      setShadowLoad("error");
    }
  }, []);

  // Flush whatever the last session could not save, then read the history.
  useEffect(() => {
    flushQueue()
      .catch(() => {})
      .then(loadShadow);
  }, [loadShadow]);

  const setShadowModePersist = useCallback((next, reason) => {
    setShadowMode(next);
    if (reason === "denied") setShadowMicBlocked(true);
    try {
      localStorage.setItem("shadow_mode_v1", next);
    } catch {
      /* private window */
    }
  }, []);

  const startShadowRound = useCallback(
    (exclude = []) => {
      const picked = pickRound(shadowWords, shadowRounds, {
        source: shadowSource,
        island: shadowIsland,
        exclude,
      });
      if (!picked.length) return;
      let islandName = null;
      if (shadowSource === "island") {
        for (const g of shadowIslands) {
          for (const isl of g.islands) if (isl.id === shadowIsland) islandName = isl.name;
        }
      }
      setRound({
        id: Date.now(),
        words: picked,
        source: shadowSource,
        island: islandName,
        mode: shadowMode,
      });
    },
    [shadowWords, shadowRounds, shadowSource, shadowIsland, shadowMode, shadowIslands],
  );

  const leaveShadowRound = useCallback(() => {
    setRound(null);
    setOpenRoundId(null);
    // Let the finish/attempt queue land before reading history back.
    flushQueue()
      .catch(() => {})
      .then(loadShadow);
    window.setTimeout(() => document.getElementById("shadow-start")?.focus(), 0);
  }, [loadShadow]);

  const toggleShadowRound = useCallback((id) => {
    setOpenRoundId((cur) => {
      const next = cur === id ? null : id;
      try {
        history.replaceState(null, "", next ? `#shadow/round/${next}` : "#shadow");
      } catch {
        /* file:// */
      }
      return next;
    });
    if (openRoundId === id) window.setTimeout(() => document.getElementById(`rrow-${id}`)?.focus(), 0);
  }, [openRoundId]);

  const removeShadowRound = useCallback(
    async (id) => {
      setDeletingRound(id);
      try {
        await deleteRound(id);
        setOpenRoundId(null);
        await loadShadow();
      } catch {
        /* the row stays; nothing was destroyed */
      } finally {
        setDeletingRound(null);
      }
    },
    [loadShadow],
  );

  const jumpToShadowWord = useCallback(
    (term) => {
      if (!term) return;
      setQuery("");
      setQ("");
      setFilter("all");
      setPosFilter("all");
      setExpanded(term);
      window.setTimeout(() => document.getElementById("words")?.scrollIntoView(), 0);
    },
    [],
  );

  // Deep links: #shadow/round/<id> expands that round.
  useEffect(() => {
    const read = () => {
      const m = /^#shadow\/round\/(\d+)$/.exec(window.location.hash || "");
      if (!m) return;
      setOpenRoundId(Number(m[1]));
      window.setTimeout(() => document.getElementById("shadow")?.scrollIntoView(), 0);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  // ---- sync ----
  const pollSync = useCallback((id) => {
    const tick = () =>
      fetch(`${SYNC_API}?poll=1`, { cache: "no-store", headers: { "x-sync-token": SYNC_TOKEN } })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("http " + r.status))))
        .then((d) => {
          if (!d.request) return { finished: true };
          if (d.request.status === "queued" || d.request.status === "running") {
            return { finished: false };
          }
          return { finished: true, status: d.request.status, summary: d.request.summary || "" };
        });
    return tick().then((r) => {
      if (r.finished) return r;
      return new Promise((resolve, reject) => {
        let tries = 0;
        const iv = setInterval(async () => {
          tries += 1;
          try {
            const t = await tick();
            if (t.finished) {
              clearInterval(iv);
              resolve(t);
            } else if (tries >= 100) {
              clearInterval(iv);
              reject(new Error("sync timed out"));
            }
          } catch (err) {
            clearInterval(iv);
            reject(err);
          }
        }, 3000);
      });
    });
  }, []);

  const runSync = useCallback(() => {
    setSyncState("busy");
    setSyncStatus("Requesting…");
    setSyncError("");
    fetch(SYNC_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-sync-token": SYNC_TOKEN },
      body: "{}",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("http " + r.status))))
      .then(async (d) => {
        if (d.ok && !d.queued) {
          setSyncState("idle");
          setSyncStatus("a sync is already running — waiting for it");
          const r = await pollSync(d.request_id);
          setSyncStatus(finishText(r));
          if (r.status === "done") load();
          return;
        }
        setSyncStatus("Syncing from LingQ…");
        const r = await pollSync(d.request_id);
        if (r.status !== undefined) {
          setSyncStatus(finishText(r));
          if (r.status === "done") load();
        } else {
          setSyncStatus("requested");
        }
      })
      .catch((err) => {
        setSyncError(String(err && err.message ? err.message : err));
      })
      .finally(() => {
        setSyncState("idle");
      });
  }, [pollSync, load]);

  function finishText(r) {
    if (r.status === "done") return r.summary;
    if (r.status === "error") return r.summary || "sync failed";
    return "sync finished";
  }

  const clearLeech = useCallback(
    (term) => {
      const w = leeches.find((x) => x.term === term);
      const mnemonic = (leechEdits[term] ?? "").trim();
      if (!w || !mnemonic || mnemonic === (w.mnemonic || "")) return;
      setLeechBusy(term);
      setLeechStatus("");
      setLeechError("");
      fetch(SYNC_API, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-sync-token": SYNC_TOKEN },
        body: JSON.stringify({ kind: "leech", updates: [{ term, mnemonic }] }),
      })
        .then((r) => (r.ok ? r.json() : r.json().then((b) => Promise.reject(new Error(b.error || "http " + r.status)))))
        .then(async (d) => {
          if (d.ok && !d.queued) setLeechStatus("another job is running — waiting for it");
          const res = await pollSync(d.request_id);
          if (res.status === "done") {
            setLeechStatus(res.summary || "leech cleared");
            setLeechEdits((m) => {
              const next = { ...m };
              delete next[term];
              return next;
            });
            load();
          } else if (res.status === "error") {
            setLeechError(res.summary || "clear failed");
          } else {
            setLeechStatus("finished");
          }
        })
        .catch((err) => setLeechError(String(err && err.message ? err.message : err)))
        .finally(() => setLeechBusy(""));
    },
    [leeches, leechEdits, pollSync, load],
  );

  // ---- level ----
  // Load the saved assessment on mount so it does not need to be re-run.
  useEffect(() => {
    fetch("/api/level")
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (p && p.level) {
          setLevelResult(p);
          setOpenSentences(new Set());
          setLevelState("done");
        }
      })
      .catch(() => {});
  }, []);

  const assess = useCallback(
    (force) => {
      if (!data || pendingRef.current) return;
      setLevelState("loading");
      setLevelError("");
      pendingRef.current = true;
      const digest = {
        total_words: deck.terms.length,
        known_common: coverage.known,
        common_total: coverage.total,
        new_words: deck.fresh,
        struggling: deck.struggling.length,
        longest_interval_days: deck.longest,
        known_terms: deck.terms.slice(0, 400).join(", "),
      };
      fetch("/api/level", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-level-token": LEVEL_TOKEN },
        body: JSON.stringify({ force: !!force, ...digest }),
      })
        .then((r) => (r.ok ? r.json() : r.json().then((b) => Promise.reject(new Error(b.error || "http " + r.status)))))
        .then((res) => {
          if (!res.level) throw new Error("no assessment returned");
          setLevelResult(res);
          setOpenSentences(new Set());
          setLevelState("done");
        })
        .catch((err) => {
          setLevelError(String(err && err.message ? err.message : err));
          setLevelState("error");
        })
        .finally(() => {
          pendingRef.current = false;
        });
    },
    [data, deck, coverage],
  );

  if (loadErr && !data) {
    return (
      <div className="wrap">
        <h1>My Korean</h1>
        <div className="levelcard" style={{ marginTop: 20 }}>
          <div style={{ color: "#ff6b9d", fontWeight: 700, marginBottom: 8 }}>
            Could not load the deck data.
          </div>
          <button className="mini" onClick={load}>
            Reload
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page" inert={round ? true : undefined}>
      <header className="topbar">
        <div className="brand">
          My <em>Korean</em>
        </div>
        <nav className="nav" aria-label="Sections">
          <a href="#overview">Overview</a>
          <a href="#shadow">Shadow</a>
          <a href="#grid">Grid</a>
          <a href="#habits">Habits</a>
          <a href="#leeches">Leeches</a>
          <a href="#words">Words</a>
          <a href="#level">Level</a>
          <a href="#pace">Pace</a>
        </nav>
        <div className="syncwrap">
          <button
            type="button"
            className={`syncbtn ${syncError ? "err" : ""} ${syncState === "busy" ? "busy" : ""}`}
            onClick={() => setSyncOpen((v) => !v)}
            aria-haspopup="true"
            aria-expanded={syncOpen}
          >
            <span className="syncdot" aria-hidden="true" />
            {syncState === "busy" ? "Syncing…" : "Sync"}
          </button>
        </div>
        {syncOpen && (
          <div className="syncpanel">
            <p>Pull new words from your LingQ tagged list into Anki, then refresh this dashboard's data.</p>
            <button className="mini" type="button" onClick={runSync} disabled={syncState === "busy"}>
              {syncState === "busy" ? "Syncing…" : "Run sync now"}
            </button>
            {syncStatus && <div className="status">{syncStatus}</div>}
            {syncError && <div className="status" style={{ color: "#ff6b9d" }}>{syncError}</div>}
          </div>
        )}
      </header>

      <main className="wrap">
        <section id="overview">
          <h1>
            My <span style={{ color: "#4fc3a1" }}>Korean</span>
          </h1>
          {data ? (
            <p className="subtitle">
              A street-level read on your vocabulary ·{" "}
              {coverage.known} of the {coverage.total.toLocaleString()} most common words known ·
              deck refreshed at {new Date(data.generated_at).toLocaleString()}
            </p>
          ) : (
            <p className="subtitle">Loading your deck…</p>
          )}

          {data ? (
            <div className="stats">
              <div className="stat">
                <div className="num">{deck.terms.length}</div>
                <div className="lbl">words in your deck</div>
              </div>
              <div className="stat">
                <div className="num">{coverage.known}</div>
                <div className="lbl">of {coverage.total.toLocaleString()} common words known</div>
              </div>
              <div className="stat">
                <div className="num">
                  {coverage.total ? Math.round((coverage.known / coverage.total) * 100) : 0}%
                </div>
                <div className="lbl">of the most common vocabulary</div>
              </div>
              <div className="stat">
                <div className="num warn">{deck.fresh}</div>
                <div className="lbl">brand new, not yet studied</div>
              </div>
              <div className="stat">
                <div className="num warn">{leeches.length}</div>
                <div className="lbl">leeches to retire</div>
              </div>
              <div className="stat">
                <div className="num good">{deck.longest ? `${deck.longest}d` : "—"}</div>
                <div className="lbl">longest retention interval</div>
              </div>
            </div>
          ) : (
            <div className="empty" style={{ marginTop: 20 }}>
              {reloading ? "Refreshing your deck…" : "No deck data yet."}
            </div>
          )}
        </section>

        <section id="shadow">
          <h2>Shadow</h2>
          <ShadowBoard
            islands={shadowIslands}
            rounds={shadowRounds}
            stats={shadowStats}
            load={shadowLoad}
            mode={shadowMode}
            onMode={setShadowModePersist}
            micBlocked={shadowMicBlocked}
            source={shadowSource}
            onSource={setShadowSource}
            island={shadowIsland}
            onIsland={setShadowIsland}
            onStart={() => startShadowRound()}
            onReload={loadShadow}
            openRoundId={openRoundId}
            onToggleRound={toggleShadowRound}
            onDeleteRound={removeShadowRound}
            onJumpToWord={jumpToShadowWord}
            deleting={deletingRound}
          />
        </section>

        <section id="grid">
          <h2>Vocabulary grid</h2>
          <p className="sectionnote">
            The 2,000 most frequent Korean words from the TOPIK + National Institute list, bucketed
            by word type. Green means a card in your deck — conjugated forms count too (흐려요 counts
            as 흐리다). Empty squares are common words you have not met yet. Where you know one word
            near its neighbours, clusters show up naturally.
          </p>
          <div className="legend">
            <span className="item">
              <span className="sq known" />
              in your deck
            </span>
            <span className="item">
              <span className="sq unknown" />
              common word, not learned yet
            </span>
            {coverage.extra > 0 && (
              <span className="item">+ {coverage.extra} of your words reach beyond this list</span>
            )}
          </div>

          {(data ? groups : []).map((g) => (
            <div className="posblock" key={g.p}>
              <div className="poshead">
                <span className="t">
                  <span className="ko">{g.ko}</span>
                  {g.en}
                </span>
                <span className="m">
                  {g.known} of {g.items.length.toLocaleString()} known
                </span>
              </div>
              <div className="grid" role="img" aria-label={`${g.en}: ${g.known} of ${g.items.length} known`}>
                {g.items.map((e) => {
                  const w = refMatches.get(e.t);
                  return w ? (
                    <span
                      key={e.t}
                      className="cell known"
                      style={{ background: mint(w.health) }}
                      title={`${e.t} — ${e.p}${e.e ? " · " + e.e : ""} · in your deck`}
                    />
                  ) : (
                    <span
                      key={e.t}
                      className="cell"
                      title={`${e.t} — ${e.p}${e.e ? " · " + e.e : ""} · not learned yet`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        <section id="habits">
          <h2>Habits</h2>
          <p className="sectionnote">
            Real review history from Anki: when you actually studied, the current streak, and what
            is queued up. This refreshes every time you sync.
          </p>
          <div className="habitgrid">
            <div className="panel">
              <div className="heathead">
                <b>Reviews · last ~19 weeks</b>
                <span className={streak > 0 ? "streak on" : "streak"}>
                  {streak > 0 ? `${streak}-day streak` : "no streak"}
                </span>
              </div>
              <div className="heat" role="img" aria-label="Review activity heatmap">
                {weeks.map((wk, wi) =>
                  wk.map((c, di) =>
                    c ? (
                      <span key={`${wi}-${di}`} className={heatClass(c.count)} title={`${c.count} reviews · ${c.key}`} />
                    ) : (
                      <span key={`${wi}-${di}`} className="blank" />
                    ),
                  ),
                )}
              </div>
              <div className="heatlegend">
                <span>less</span>
                <span className="sw" style={{ background: "#1b2c3b" }} />
                <span className="sw" style={{ background: "rgba(79,195,161,.28)" }} />
                <span className="sw" style={{ background: "rgba(79,195,161,.5)" }} />
                <span className="sw" style={{ background: "rgba(79,195,161,.72)" }} />
                <span className="sw" style={{ background: "#4fc3a1" }} />
                <span>more</span>
              </div>
            </div>
            <div>
              <div className="minis">
                <div className="mini"><div className="n hot">{review?.due_now ?? "–"}</div><div className="l">due now</div></div>
                <div className="mini"><div className="n">{review?.due_tomorrow ?? "–"}</div><div className="l">due tomorrow</div></div>
                <div className="mini"><div className="n">{review?.due_7d ?? "–"}</div><div className="l">due in 7 days</div></div>
              </div>
              <div className="panel" style={{ marginTop: 10 }}>
                <b className="retention-title">Retention · current intervals</b>
                <div className="retention">
                  {buckets.map((b) => (
                    <div className="b" key={b.l}>
                      <b>{b.n}</b>
                      <i style={{ height: `${(b.n / bucketMax) * 84}px` }} />
                      <span>{b.l}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="leeches">
          <h2>
            <LeechMark className="h2mark" />
            Leeches
            {leeches.length ? <span className="leechcount">{leeches.length}</span> : null}
          </h2>
          <p className="sectionnote">
            A leech is a card that keeps slipping — Anki tags it after enough lapses. Write a hook
            that actually catches, then clear it: the tag comes off, the card goes back in rotation,
            and it is due now so you can test the new mnemonic.
          </p>
          {!data ? (
            <div className="empty">Reading the deck for leeches…</div>
          ) : leeches.length === 0 ? (
            <div className="empty leechempty">
              <LeechMark className="emptymark" />
              <span>No leeches right now. Nothing is stuck hard enough to need a new hook.</span>
            </div>
          ) : (
            <div className="leechlist">
              {leeches.map((w) => {
                const draft = leechEdits[w.term] ?? "";
                const trimmed = draft.trim();
                const sameHook = !!trimmed && trimmed === (w.mnemonic || "");
                const canClear = !!trimmed && !sameHook && leechBusy !== w.term;
                return (
                  <article className="leech" key={w.term}>
                    <div className="leechtop">
                      <div>
                        <div className="leechterm">{w.term}</div>
                        {w.base_form && w.base_form !== w.term ? (
                          <div className="leechbase">base · {w.base_form}</div>
                        ) : null}
                      </div>
                      <div className="leechbadges">
                        <span className="lapses">{w.lapses} lapses</span>
                        {w.suspended ? <span className="susp">suspended</span> : null}
                      </div>
                    </div>
                    <div className="meaning">{w.meaning}</div>
                    {w.example ? (
                      <div className="example">
                        “{w.example}”
                        {w.example_en ? <span className="exen"> · {w.example_en}</span> : null}
                      </div>
                    ) : null}
                    {w.similar ? <div className="similar">Similar · {w.similar}</div> : null}
                    {w.mnemonic ? (
                      <div className="currenthook">
                        <span>Current hook</span>
                        {w.mnemonic}
                      </div>
                    ) : null}
                    <label className="hooklabel" htmlFor={`hook-${w.term}`}>
                      New mnemonic
                    </label>
                    <input
                      id={`hook-${w.term}`}
                      className="mninput"
                      value={draft}
                      onChange={(e) => setLeechEdits((m) => ({ ...m, [w.term]: e.target.value }))}
                      placeholder="A hook you will actually remember…"
                      aria-label={`New mnemonic for ${w.term}`}
                    />
                    {sameHook ? (
                      <div className="hookhint">That is the old hook. Write a new one to clear the leech.</div>
                    ) : null}
                    <div className="leechactions">
                      <button
                        className="savebtn"
                        type="button"
                        disabled={!canClear}
                        onClick={() => clearLeech(w.term)}
                      >
                        {leechBusy === w.term ? "Clearing…" : "Clear leech & make it due"}
                      </button>
                      <span className="clearhint">tag off · unsuspended · due now</span>
                    </div>
                  </article>
                );
              })}
              {leechStatus ? <div className="mnstatus">{leechStatus}</div> : null}
              {leechError ? <div className="mnstatus bad">{leechError}</div> : null}
            </div>
          )}
        </section>

        <section id="words">
          <h2>Word browser</h2>
          <p className="sectionnote">
            Search all {coverage.total.toLocaleString()} reference words or your deck. Filter by
            known/unknown and type; tap a word for its detail.
          </p>
          <div className="controls">
            <input
              className="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search words or meanings…"
              aria-label="Search words"
            />
            <div className="chips">
              {["all", "known", "unknown", "leech"].map((f) => (
                <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {f === "all" ? "All" : f === "known" ? "Known" : f === "unknown" ? "Unknown" : `Leeches (${leeches.length})`}
                </button>
              ))}
            </div>
            <div className="chips">
              {[["all", "All types"], ["verb", "Verbs"], ["adjective", "Adjectives"], ["noun", "Nouns"], ["adverb", "Adverbs"]].map(([k, l]) => (
                <button key={k} type="button" className="chip" aria-pressed={posFilter === k} onClick={() => setPosFilter(k)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="wordlist">
            {results.map((e) => (
              <div key={e.t}>
                <button className="wrow" type="button" onClick={() => setExpanded(expanded === e.t ? null : e.t)}>
                  <span className="wt">{e.t}</span>
                  <span className="wm">
                    {e.known ? e.word?.meaning || e.expl : e.expl ? `not learned · ${e.expl}` : "not learned"}
                  </span>
                  {e.leech ? <span className="wbadge l">leech</span> : null}
                  <span className={`wbadge ${e.known ? "k" : "u"}`}>{e.known ? "known" : "unknown"}</span>
                </button>
                {expanded === e.t && (
                  <div className="wdetail">
                    <div className="big">{e.t}</div>
                    <div className="mean">{e.known ? e.word?.meaning || "—" : `Not in your deck yet${e.expl ? ` · ${e.expl}` : ""}`}</div>
                    {e.known && e.word?.example ? <div className="ex">“{e.word.example}”</div> : null}
                    {e.known && e.word?.example_en ? <div className="exen">{e.word.example_en}</div> : null}
                    {e.known && e.word?.mnemonic ? <div className="wmn">{e.word.mnemonic}</div> : null}
                    <div className="meta2">
                      <span>type <b>{POS_META[e.pos]?.[1] || "—"}</b></span>
                      {e.rank ? <span>frequency <b>#{e.rank}</b></span> : <span>beyond the common list</span>}
                      {e.known ? <span>status <b>{e.word?.status || "—"}</b></span> : null}
                      {e.known && e.word?.lapses ? <span>lapses <b>{e.word.lapses}</b></span> : null}
                      {e.known && e.word?.leech ? <span>leech <b>tagged</b></span> : null}
                      {e.known && e.word?.interval_days ? <span>interval <b>{e.word.interval_days}d</b></span> : null}
                    </div>
                  </div>
                )}
              </div>
            ))}
            {!results.length && <div className="eof">Nothing matches that.</div>}
            {results.length >= 80 && <div className="eof">Showing the first 80. Narrow the search to see more.</div>}
          </div>
        </section>

        <section id="level">
          <h2>Level check</h2>
          <p className="sectionnote">
            An AI teacher grades where you actually stand — funny but honest — and writes sentences
            you can genuinely read today.
          </p>
          <div className="levelcard">
            {levelState === "idle" && (
              <>
                <button className="cta" type="button" onClick={() => assess(false)}>
                  Grade me
                </button>
                <div className="statusline">Takes a few seconds. Based only on your real deck.</div>
              </>
            )}
            {levelState === "loading" && (
              <div className="statusline">Your teacher is grading…</div>
            )}
            {levelState === "done" && levelResult && (
              <>
                <div className="stage">{levelResult.level.label}</div>
                <div className="stagemeta">
                  {levelResult.level.stage ? (
                    <span>
                      stage {levelResult.level.stage} of {levelResult.level.stages_total}
                    </span>
                  ) : null}
                  <span>· generated {new Date(levelResult.requested_at).toLocaleString()}</span>
                </div>
                <p className="blurb">{levelResult.level.blurb}</p>
                <ol className="sentences">
                  {levelResult.sentences.map((s, i) => {
                    const open = openSentences.has(i);
                    return (
                      <li key={i}>
                        <button
                          type="button"
                          className="sentbtn"
                          aria-expanded={open}
                          onClick={() => toggleSentence(i)}
                        >
                          <span className="ko">{s.ko}</span>
                          {open ? (
                            <span className="en">{s.en}</span>
                          ) : (
                            <span className="reveal">tap to translate</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ol>
                <button className="mini" type="button" onClick={() => assess(true)}>
                  Regrade me
                </button>
              </>
            )}
            {levelState === "error" && (
              <>
                <div className="statusline bad">The grades came back marked up: {levelError}</div>
                <button className="mini" type="button" onClick={() => assess(true)} style={{ marginTop: 10 }}>
                  Try again
                </button>
              </>
            )}
          </div>
        </section>

        <section id="pace">
          <h2>Pace</h2>
          <p className="sectionnote">
            Set a weekly pace and see when each coverage milestone lands, starting from your current{" "}
            {coverage.known} common words.
          </p>
          <div className="panel pacegrid">
            <div>
              <div className="rate">
                {rate} <span>new words / week</span>
              </div>
              <div className="ratelabel">Drag to change the pace.</div>
              <input
                type="range"
                min="2"
                max="30"
                step="1"
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
                aria-label="New words per week"
              />
            </div>
            <div>
              <table className="pace">
                <thead>
                  <tr>
                    <th>Milestone</th>
                    <th>Weeks</th>
                    <th>Around</th>
                  </tr>
                </thead>
                <tbody>
                  {paceTargets.map((r) => (
                    <tr key={r.target}>
                      <td className="n">{r.target.toLocaleString()} words</td>
                      <td>{r.weeks === 0 ? "done" : r.weeks}</td>
                      <td>{r.weeks === 0 ? "—" : r.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <footer>
          <span>deck: Anki · Korean-lingq</span>
          <span>list: TOPIK + National Institute of Korean Language (MIT)</span>
          <span>assessment: AI</span>
          <a href="https://home-lilac-five.vercel.app">← back to the index</a>
        </footer>
      </main>
      </div>
      {round ? (
        <ShadowRound
          key={round.id}
          words={round.words}
          source={round.source}
          island={round.island}
          mode={round.mode}
          onModeChange={setShadowModePersist}
          onLeave={leaveShadowRound}
          onNewRound={(exclude) => {
            setRound(null);
            startShadowRound(exclude);
          }}
        />
      ) : null}
    </div>
  );
}