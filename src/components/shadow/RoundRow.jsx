import { useState } from 'react';
import { speak } from '../../lib/shadow/speak.js';

const band = (score) => (score === null || score === undefined ? 'none' : score >= 75 ? 'pass' : score >= 50 ? 'close' : 'fail');

const when = (iso) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric' });

const whenLong = (iso) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

function sourceLabel(round) {
  return round.source === 'island' ? round.island || 'island' : 'weakest first';
}

export function RoundRow({ round, expanded, onToggle }) {
  const done = !!round.finished_at;
  return (
    <button
      type="button"
      className="rrow"
      aria-expanded={expanded}
      onClick={() => onToggle(round.id)}
    >
      <span className="rwhen">{when(round.started_at)}</span>
      <span className="rsrc">{sourceLabel(round)}</span>
      <span className="rpass">
        {done ? `${round.passed} of ${round.size} passed` : `unfinished · ${round.attempts.length} of ${round.size}`}
      </span>
      {done && round.avg_score !== null ? (
        <span className={`rscore ${band(round.avg_score)}`}>{round.avg_score}</span>
      ) : (
        <span className="rscore none">—</span>
      )}
    </button>
  );
}

export function RoundDetail({ round, onClose, onDelete, busy }) {
  const [openTerm, setOpenTerm] = useState(null);
  const [confirm, setConfirm] = useState(false);

  // Deck order is not stored; the order the terms were first attempted is the
  // round's own order, and every row renders from the attempts.
  const byTerm = new Map();
  for (const a of round.attempts) {
    if (!byTerm.has(a.term)) byTerm.set(a.term, []);
    byTerm.get(a.term).push(a);
  }

  const done = !!round.finished_at;

  return (
    <div className="wdetail rdetail">
      <div className="rhead">
        <span>
          {whenLong(round.started_at)} · {sourceLabel(round)} ·{' '}
          {done ? `${round.passed} of ${round.size}` : `unfinished · ${round.attempts.length} of ${round.size}`}
          {done && round.avg_score !== null ? ` · average ${round.avg_score}` : ''}
        </span>
      </div>

      {byTerm.size === 0 ? (
        <div className="eof">No attempts were saved for this round.</div>
      ) : (
        <div className="rterms">
          {[...byTerm.entries()].map(([term, attempts]) => {
            const scored = attempts.filter((a) => a.score !== null);
            const best = scored.length ? Math.max(...scored.map((a) => a.score)) : null;
            const passed = attempts.some((a) => a.passed);
            const open = openTerm === term;
            return (
              <div key={term}>
                <button
                  type="button"
                  className="wrow"
                  aria-expanded={open}
                  onClick={() => setOpenTerm(open ? null : term)}
                >
                  <span className="wt">{term}</span>
                  <span className="wm">{attempts[0].reference}</span>
                  <span className={`rscore ${band(best)}`}>{best === null ? 'not scored' : best}</span>
                  <span className={`wbadge ${passed ? 'k' : 'l'}`}>{passed ? 'passed' : 'flagged'}</span>
                </button>
                {open ? (
                  <div className="rattempts">
                    {attempts.map((a) => (
                      <div className="rattempt" key={a.id}>
                        <div className="rattempttop">
                          <b>
                            {a.attempt_no} · {a.score === null ? 'not scored' : a.score}
                          </b>
                          <button
                            type="button"
                            className="spill"
                            onClick={() => speak(a.reference, 0.85)}
                          >
                            Play reference
                          </button>
                        </div>
                        <div className="rtranscript">
                          {a.transcript ? `“${a.transcript}”` : 'self-marked · no transcript'}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <div className="ractions">
        <button type="button" className="spill" onClick={onClose}>
          Back to rounds
        </button>
        <button type="button" className="spill danger" onClick={() => setConfirm(true)}>
          Delete this round
        </button>
      </div>

      {confirm ? (
        <div className="sconfirm inline" role="alertdialog" aria-label="Delete this round">
          <p>Delete this round and its ten attempts? This cannot be undone.</p>
          <button type="button" className="sbtn stop sm" disabled={busy} onClick={() => onDelete(round.id)}>
            {busy ? 'Deleting…' : 'Delete'}
          </button>
          <button type="button" className="sbtn ghost" onClick={() => setConfirm(false)}>
            Keep
          </button>
        </div>
      ) : null}
    </div>
  );
}
