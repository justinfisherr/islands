import { useCallback, useEffect, useMemo, useState } from "react";
import ShadowBoard from "./ShadowBoard.jsx";
import ShadowRound from "./ShadowRound.jsx";
import { flattenWords, islandsOf, pickRound } from "../../lib/shadow/select.js";
import { deleteRound, fetchShadow, flushQueue } from "../../lib/shadow/save.js";

// /shadow?round=<id> is the deep link; the query param is the only state the URL carries.
const roundFromUrl = () => {
  const id = Number(new URLSearchParams(window.location.search).get("round"));
  return Number.isFinite(id) && id > 0 ? id : null;
};

export default function ShadowPage() {
  const [data, setData] = useState(null);

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
  const [openRoundId, setOpenRoundId] = useState(roundFromUrl);
  const [deletingRound, setDeletingRound] = useState(null);

  // The page owns its own deck read so a direct hit on /shadow works.
  useEffect(() => {
    fetch("data.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then(setData)
      .catch(() => setData(null));
  }, []);

  const shadowWords = useMemo(() => flattenWords(data), [data]);
  const shadowIslands = useMemo(() => islandsOf(shadowWords), [shadowWords]);

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

  // Expanding a round pushes the param so back collapses it; popstate reads it again.
  const toggleShadowRound = useCallback(
    (id) => {
      const next = openRoundId === id ? null : id;
      setOpenRoundId(next);
      try {
        history.pushState(null, "", next ? `/shadow?round=${next}` : "/shadow");
      } catch {
        /* file:// */
      }
      if (!next) window.setTimeout(() => document.getElementById(`rrow-${id}`)?.focus(), 0);
    },
    [openRoundId],
  );

  useEffect(() => {
    const read = () => setOpenRoundId(roundFromUrl());
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  const removeShadowRound = useCallback(
    async (id) => {
      setDeletingRound(id);
      try {
        await deleteRound(id);
        setOpenRoundId(null);
        try {
          history.replaceState(null, "", "/shadow");
        } catch {
          /* file:// */
        }
        await loadShadow();
      } catch {
        /* the row stays; nothing was destroyed */
      } finally {
        setDeletingRound(null);
      }
    },
    [loadShadow],
  );

  return (
    <div>
      <div className="page" inert={round ? true : undefined}>
        <header className="topbar">
          <div className="brand">
            My <em>Korean</em>
          </div>
          <nav className="nav" aria-label="Sections">
            <a href="/">← Scoreboard</a>
          </nav>
        </header>

        <main className="wrap shadowwrap">
          <h1>Shadow</h1>
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
            onJumpToWord={(term) => {
              window.location.href = `/?word=${encodeURIComponent(term)}`;
            }}
            deleting={deletingRound}
          />
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
