import { useEffect, useMemo, useState } from 'react';
import { koVoice, onVoices } from '../../lib/shadow/speak.js';
import { RECOGNITION_SUPPORTED } from '../../lib/shadow/recognize.js';
import { RoundRow, RoundDetail } from './RoundRow.jsx';

const band = (score) => (score === null || score === undefined ? 'none' : score >= 75 ? 'pass' : score >= 50 ? 'close' : 'fail');

function ShadowStats({ stats, onJumpToWord }) {
  if (!stats) return null;
  const empty = !stats.attempts_total;
  const max = Math.max(1, ...stats.by_day.map((d) => d.n));
  return (
    <div className="sstats">
      <h2>Shadow stats</h2>
      {empty ? (
        <div className="empty">Nothing to compare yet. Finish a round.</div>
      ) : (
        <>
          <div className="ssumline">
            {stats.attempts_total} attempts
            {stats.avg_score === null ? '' : ` · average ${stats.avg_score}`}
          </div>

          <div className="sblock">
            <div className="sblockhead">Attempts · last 14 days</div>
            <div className="sbars" role="img" aria-label="Attempts over the last 14 days">
              {stats.by_day.map((d) => (
                <span
                  key={d.day}
                  className={`sbar ${d.n && d.n === d.self ? 'self' : ''}`}
                  style={{ height: `${Math.max(d.n ? 8 : 2, Math.round((d.n / max) * 52))}px` }}
                  title={`${d.day} · ${d.n} attempts${d.self ? `, ${d.self} self-marked` : ''}`}
                />
              ))}
            </div>
          </div>

          {stats.by_island.length ? (
            <div className="sblock">
              <div className="sblockhead">Accuracy by island</div>
              {stats.by_island.map((r) => (
                <div className="sisland" key={r.island || 'weakest'}>
                  <span className="sname">{r.island || 'weakest first'}</span>
                  <span className="strack">
                    <i className={band(r.avg_score)} style={{ width: `${Math.max(2, r.avg_score)}%` }} />
                  </span>
                  <span className="sval">{r.avg_score}</span>
                </div>
              ))}
            </div>
          ) : null}

          {stats.worst_words.length ? (
            <div className="sblock">
              <div className="sblockhead">Worst words</div>
              <div className="sworst">
                {stats.worst_words.map((w) => (
                  <button type="button" className="sworstrow" key={w.term} onClick={() => onJumpToWord(w.term)}>
                    <span className="sterm">{w.term}</span>
                    <span className={`rscore ${band(w.best_score)}`}>{w.best_score}</span>
                    <span className="stries">{w.tries} {w.tries === 1 ? 'try' : 'tries'}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export default function ShadowBoard({
  islands,
  rounds,
  stats,
  load,
  mode,
  onMode,
  micBlocked,
  source,
  onSource,
  island,
  onIsland,
  onStart,
  onReload,
  openRoundId,
  onToggleRound,
  onDeleteRound,
  onJumpToWord,
  deleting,
}) {
  const [modeFilter, setModeFilter] = useState('all');
  const [sort, setSort] = useState('newest');
  const [voices, setVoices] = useState(0);

  useEffect(() => onVoices(() => setVoices((n) => n + 1)), []);
  const voice = useMemo(() => koVoice(), [voices]);

  const islandCount = useMemo(() => {
    for (const g of islands) for (const i of g.islands) if (i.id === island) return i.n;
    return 0;
  }, [islands, island]);

  const size = source === 'island' ? Math.min(10, islandCount) : 10;

  const visible = useMemo(() => {
    const list = rounds.filter((r) => modeFilter === 'all' || r.mode === modeFilter);
    if (sort === 'worst') {
      return [...list].sort((a, b) => {
        const av = a.avg_score === null ? 101 : a.avg_score;
        const bv = b.avg_score === null ? 101 : b.avg_score;
        return av - bv;
      });
    }
    return list;
  }, [rounds, modeFilter, sort]);

  const micLabel = !RECOGNITION_SUPPORTED ? 'not in this browser' : micBlocked ? 'blocked' : 'ready';

  return (
    <>
      <p className="sectionnote">
        Say the sentence back. The browser scores what it heard. Ten words, three tries each, pass at
        75 accuracy and 90 completeness.
      </p>

      <div className="sfacts">
        <span className="schip fact">voice: {voice ? voice.name : 'none installed'}</span>
        <span className="schip fact">mic: {micLabel}</span>
        <button
          type="button"
          className="schip toggle"
          aria-pressed={mode === 'mic'}
          onClick={() => onMode(mode === 'mic' ? 'self' : 'mic')}
          disabled={!RECOGNITION_SUPPORTED}
        >
          grading: {mode === 'mic' ? 'mic' : 'self-mark'}
        </button>
      </div>

      {!voice ? (
        <div className="snotice sand">
          No Korean voice is installed in this browser. Play is off — read the sentence and say it.
        </div>
      ) : null}
      {!RECOGNITION_SUPPORTED ? (
        <div className="snotice sand">
          This browser cannot listen to speech. Rounds run in self-mark mode.
        </div>
      ) : null}

      <div className="ssource">
        <button
          type="button"
          className="chip"
          aria-pressed={source === 'weakest'}
          onClick={() => onSource('weakest')}
        >
          Weakest first
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={source === 'island'}
          onClick={() => onSource('island')}
        >
          Pick an island
        </button>
      </div>

      {source === 'island' ? (
        <label className="sislandpick">
          <span className="slabel">Island</span>
          <select value={island || ''} onChange={(e) => onIsland(e.target.value)}>
            <option value="">Choose one…</option>
            {islands.map((g) => (
              <optgroup label={g.domainName} key={g.domainName}>
                {g.islands.map((i) => (
                  <option value={i.id} key={i.id}>
                    {i.name} · {i.n}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      ) : null}

      <button
        type="button"
        id="shadow-start"
        className="cta sstart"
        onClick={onStart}
        disabled={source === 'island' && !island}
      >
        Start a round
      </button>
      <div className="ssublabel">
        {source === 'island' && island
          ? size < 10
            ? `${size} words in this island have sentences.`
            : 'Round of 10.'
          : '10 weakest words with sentences. About three minutes.'}
      </div>

      <div className="shadowcols">
        <div className="srounds">
          <h2>Rounds</h2>
          <div className="chips">
            {[
              ['all', 'All'],
              ['mic', 'Mic'],
              ['self', 'Self-mark'],
            ].map(([k, l]) => (
              <button key={k} type="button" className="chip" aria-pressed={modeFilter === k} onClick={() => setModeFilter(k)}>
                {l}
              </button>
            ))}
          </div>
          <div className="chips">
            {[
              ['newest', 'Newest'],
              ['worst', 'Worst first'],
            ].map(([k, l]) => (
              <button key={k} type="button" className="chip" aria-pressed={sort === k} onClick={() => setSort(k)}>
                {l}
              </button>
            ))}
          </div>

          {load === 'error' ? (
            <div className="snotice sand">
              Could not load past rounds. The round still works.{' '}
              <button type="button" className="spill" onClick={onReload}>
                Retry
              </button>
            </div>
          ) : load === 'loading' && !rounds.length ? (
            <div className="empty">Loading rounds…</div>
          ) : !visible.length ? (
            <div className="empty">
              {rounds.length ? 'No rounds match that filter.' : 'No rounds yet. Ten words is about three minutes.'}
            </div>
          ) : (
            <div className="rlist">
              {visible.map((r) => (
                <div key={r.id}>
                  <RoundRow round={r} expanded={openRoundId === r.id} onToggle={onToggleRound} />
                  {openRoundId === r.id ? (
                    <RoundDetail
                      round={r}
                      onClose={() => onToggleRound(r.id)}
                      onDelete={onDeleteRound}
                      busy={deleting === r.id}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <ShadowStats stats={stats} onJumpToWord={onJumpToWord} />
      </div>
    </>
  );
}
