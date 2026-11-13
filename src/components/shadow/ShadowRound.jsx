import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { grade } from '../../lib/shadow/grade.js';
import { createRecognizer, RECOGNITION_SUPPORTED } from '../../lib/shadow/recognize.js';
import { cancelSpeak, koVoice, onVoices, speak } from '../../lib/shadow/speak.js';
import { enqueue, newClientId } from '../../lib/shadow/save.js';
import ScoreRead from './ScoreRead.jsx';

const MAX_ATTEMPTS = 3;

function tickClass(res, k, i) {
  if (res && res[k]) return res[k].passed ? 'pass' : 'flag';
  if (k === i) return 'cur';
  return '';
}

// The whole round: listen, record, gate, summary. One primary action at a time.
export default function ShadowRound({ words, source, island, mode, onModeChange, onLeave, onNewRound }) {
  const [clientId] = useState(() => newClientId());
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState('listen'); // listen | recording | result | summary
  const [interim, setInterim] = useState('');
  const [heard, setHeard] = useState('');
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(1);
  const [heardNothing, setHeardNothing] = useState(false);
  const [modeState, setModeState] = useState(RECOGNITION_SUPPORTED ? mode : 'self');
  const [denied, setDenied] = useState(false);
  const [results, setResults] = useState([]);
  const [summary, setSummary] = useState(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [pending, setPending] = useState(0);
  const [voices, setVoices] = useState(0);

  const recRef = useRef(null);
  const primaryRef = useRef(null);
  const leaveRef = useRef(null);
  const playRef = useRef(null);
  const modeRef = useRef(modeState);
  modeRef.current = modeState;

  const word = words[i] || null;

  useEffect(() => onVoices(() => setVoices((n) => n + 1)), []);
  const voice = useMemo(() => koVoice(), [voices]);

  // Open the round row immediately so a reload mid-round keeps its attempts.
  useEffect(() => {
    enqueue({
      kind: 'open',
      client_id: clientId,
      size: words.length,
      source,
      island: island || null,
      mode: modeRef.current,
    })
      .then((n) => setPending(n || 0))
      .catch(() => {});
  }, [clientId, words.length, source, island]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
      cancelSpeak();
      if (recRef.current) recRef.current.abort();
    };
  }, []);

  const play = useCallback(
    (rate) => {
      if (!word || modeRef.current === 'recording' || phase === 'recording') return;
      speak(word.example, rate);
    },
    [word, phase],
  );
  playRef.current = play;
  leaveRef.current = () => {
    if (phase === 'summary' || results.length === 0) onLeave();
    else setConfirmLeave(true);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (confirmLeave) setConfirmLeave(false);
        else leaveRef.current();
      }
      if ((e.key === 'p' || e.key === 'P') && !e.metaKey && !e.ctrlKey) playRef.current(0.85);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmLeave]);

  // Focus the one action, and re-focus it as the word changes.
  useEffect(() => {
    if (primaryRef.current) primaryRef.current.focus();
  }, [i, phase]);

  const switchMode = useCallback(
    (next) => {
      if (recRef.current) recRef.current.abort();
      setModeState(next);
      onModeChange(next);
      setPhase('listen');
      setInterim('');
    },
    [onModeChange],
  );

  const saveAttempt = useCallback(
    (payload) => {
      enqueue({ kind: 'attempt', client_id: clientId, ...payload })
        .then((n) => setPending(n || 0))
        .catch(() => {});
    },
    [clientId],
  );

  const finish = useCallback(
    (all) => {
      const mic = all.filter((r) => !r.selfMarked && typeof r.score === 'number').map((r) => r.score);
      const avg = mic.length ? Math.round(mic.reduce((a, b) => a + b, 0) / mic.length) : null;
      const passed = all.filter((r) => r.passed).length;
      setSummary({ all, avg, passed, flagged: all.filter((r) => !r.passed) });
      setPhase('summary');
      setResult(null);
      enqueue({ kind: 'finish', client_id: clientId, avg_score: avg, passed })
        .then((n) => setPending(n || 0))
        .catch(() => {});
    },
    [clientId],
  );

  const advance = useCallback(
    (entry) => {
      const all = [...results, entry];
      setResults(all);
      if (i + 1 >= words.length) {
        finish(all);
        return;
      }
      setI(i + 1);
      setAttempt(1);
      setResult(null);
      setHeard('');
      setInterim('');
      setHeardNothing(false);
      setPhase('listen');
    },
    [results, i, words.length, finish],
  );

  const finishAttempt = useCallback(
    (text) => {
      if (!word) return;
      const g = grade(text, word.example, word.term);
      setHeard(text);
      setInterim('');
      if (!g) {
        setPhase('listen');
        setHeardNothing(true);
        return;
      }
      setResult(g);
      setPhase('result');
      saveAttempt({
        term: word.term,
        reference: word.example,
        transcript: text,
        accuracy: g.accuracy,
        completeness: g.completeness,
        score: g.score,
        attempt_no: attempt,
        mode: 'mic',
        passed: g.passed,
      });
    },
    [word, attempt, saveAttempt],
  );

  const startRec = useCallback(() => {
    if (!word || modeRef.current === 'self') return;
    cancelSpeak();
    setHeardNothing(false);
    setInterim('');
    setDenied(false);
    const rec = createRecognizer({
      onInterim: setInterim,
      onFinal: finishAttempt,
      onHeardNothing: () => {
        setPhase('listen');
        setHeardNothing(true);
      },
      onDenied: () => {
        setDenied(true);
        setPhase('listen');
        setModeState('self');
        onModeChange('self', 'denied');
      },
      onError: () => setPhase('listen'),
    });
    recRef.current = rec;
    setPhase('recording');
    rec.start();
  }, [word, finishAttempt, onModeChange]);

  const stopRec = useCallback(() => {
    if (recRef.current) recRef.current.stop();
  }, []);

  const selfMark = useCallback(
    (ok) => {
      if (!word) return;
      saveAttempt({
        term: word.term,
        reference: word.example,
        transcript: '',
        accuracy: null,
        completeness: null,
        score: null,
        attempt_no: attempt,
        mode: 'self',
        passed: ok,
      });
      setResult({ self: true, passed: ok });
      setPhase('result');
    },
    [word, attempt, saveAttempt],
  );

  const leave = useCallback(() => {
    if (recRef.current) recRef.current.abort();
    cancelSpeak();
    onLeave();
  }, [onLeave]);

  // ---- render ----
  const passedCount = results.filter((r) => r.passed).length;
  const flaggedCount = results.filter((r) => !r.passed).length;
  const progress = Math.min(i + 1, words.length);

  const header = (
    <div className="stop">
      <span className="sprog">
        {phase === 'summary' ? `${words.length} of ${words.length}` : `${progress} of ${words.length}`}
      </span>
      <span
        className="sticks"
        role="img"
        aria-label={`${progress} of ${words.length} words, ${passedCount} passed, ${flaggedCount} flagged`}
      >
        {words.map((w, k) => (
          <span key={k} className={`stick ${tickClass(results, k, i)}`} />
        ))}
      </span>
      {modeState === 'mic' && RECOGNITION_SUPPORTED && phase !== 'summary' ? (
        <button type="button" className="spill" onClick={() => switchMode('self')}>
          Self-mark
        </button>
      ) : null}
      <button type="button" className="spill" onClick={leaveRef.current}>
        Leave
      </button>
    </div>
  );

  if (phase === 'summary' && summary) {
    return (
      <div className="sround" role="dialog" aria-modal="true" aria-label="Shadow round summary">
        <div className="scol">
          {header}
          <div className="ssummary">
            <h3>Round finished</h3>
            <div className={`sscore ${summary.passed === words.length ? 'pass' : 'close'}`}>
              {summary.avg === null ? '—' : summary.avg}
            </div>
            <div className="ssumline">
              {summary.passed} of {words.length} passed
              {summary.avg === null ? '' : ` · average ${summary.avg}`}
              {summary.flagged.length ? ` · ${summary.flagged.length} flagged` : ''}
            </div>
            {summary.flagged.length ? (
              <div className="sflaglist">
                {summary.flagged.map((f) => (
                  <div className="sflagrow" key={f.term}>
                    <span className="sterm">{f.term}</span>
                    <span className="sscorebadge fail">{f.selfMarked ? 'not scored' : f.score}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="sprimary">
            {pending > 0 ? <div className="ssave sand">Not saved yet. Retrying.</div> : null}
            <button type="button" className="sbtn mint lg" onClick={leave} ref={primaryRef}>
              Back to the board
            </button>
            <button
              type="button"
              className="sbtn ghost"
              onClick={() => onNewRound(summary.all.filter((r) => r.passed).map((r) => r.term))}
            >
              New round
            </button>
          </div>
        </div>
      </div>
    );
  }

  const selfPhase = modeState === 'self';
  const noVoice = !voice;

  let primary = null;
  if (phase === 'listen') {
    primary = selfPhase ? (
      <>
        <div className="shint">Say it out loud, then mark yourself.</div>
        <button type="button" className="sbtn mint md" onClick={() => selfMark(true)} ref={primaryRef}>
          Close enough
        </button>
        <button type="button" className="sbtn failoutline md" onClick={() => selfMark(false)}>
          Not close
        </button>
      </>
    ) : (
      <button type="button" className="sbtn ink xl" onClick={startRec} ref={primaryRef}>
        {heardNothing ? 'Record again' : 'Record'}
      </button>
    );
  } else if (phase === 'recording') {
    primary = (
      <button type="button" className="sbtn stop xl" onClick={stopRec} ref={primaryRef}>
        <span className="sdot" aria-hidden="true" />
        Stop
      </button>
    );
  } else if (phase === 'result') {
    const self = !!result?.self;
    const done = self || result?.passed || attempt >= MAX_ATTEMPTS;
    primary = (
      <button
        type="button"
        className={`sbtn ${done ? 'mint' : 'ink'} md`}
        ref={primaryRef}
        onClick={() => {
          if (done) {
            advance({
              term: word.term,
              passed: !!result?.passed,
              score: self ? null : result?.score ?? null,
              selfMarked: self,
              keyed: !!result?.keyed,
              keyOk: self ? true : !!result?.keyOk,
            });
          } else {
            setAttempt(attempt + 1);
            setPhase('listen');
            setHeardNothing(false);
          }
        }}
      >
        {done ? 'Next word' : 'Try again'}
      </button>
    );
  }

  return (
    <div className="sround" role="dialog" aria-modal="true" aria-label="Shadow round">
      <div className="scol">
        {header}

        <div className={`ssentence ${phase === 'result' ? 'small' : ''}`}>
          <button
            type="button"
            className="ssent"
            onClick={() => play(0.85)}
            aria-label="Play the sentence"
            disabled={phase === 'recording'}
          >
            {word?.example}
          </button>
          <div className="smeaning">
            {word?.term}
            {word?.meaning ? ` · ${word.meaning}` : ''}
          </div>
        </div>

        {phase !== 'result' ? (
          <div className="splay">
            {noVoice ? (
              <span className="sbtn dead">no Korean voice</span>
            ) : (
              <>
                <button
                  type="button"
                  className="sbtn play"
                  onClick={() => play(0.85)}
                  disabled={phase === 'recording'}
                >
                  Play
                </button>
                <button
                  type="button"
                  className="sbtn play"
                  onClick={() => play(0.55)}
                  disabled={phase === 'recording'}
                >
                  Slow
                </button>
              </>
            )}
          </div>
        ) : null}

        <div className="slive" aria-live="off">
          {phase === 'recording'
            ? interim || 'Listening. Say the sentence.'
            : phase === 'listen'
              ? heardNothing
                ? heard
                  ? `Heard “${heard}” — no Korean in it. No attempt used.`
                  : 'Heard nothing. The mic opened but no speech came through. No attempt used.'
                : denied
                  ? 'The browser blocked the microphone. Self-mark still works.'
                  : 'Listening is one tap away.'
              : ''}
        </div>

        <div className="slive2" aria-live="polite">
          {phase === 'result' && result
            ? result.self
              ? `self-marked · not scored · ${result.passed ? 'close enough' : 'not close'}`
              : `${result.passed ? 'passed' : 'missed'}, ${result.score}`
            : heardNothing
              ? 'Heard nothing'
              : ''}
        </div>

        {phase === 'result' && result ? (
          result.self ? (
            <div className="sselfmark">self-marked · not scored</div>
          ) : (
            <ScoreRead
              score={result.score}
              accuracy={result.accuracy}
              completeness={result.completeness}
              attemptNo={attempt}
              maxAttempts={MAX_ATTEMPTS}
              heard={heard}
              reference={word.example}
              diff={result.diff}
              passed={result.passed}
              keyed={result.keyed}
              keyOk={result.keyOk}
              flagged={!result.passed && attempt >= MAX_ATTEMPTS}
            />
          )
        ) : null}

        <div className="sprimary">
          {pending > 0 ? <div className="ssave sand">Not saved yet. Retrying.</div> : null}
          {primary}
        </div>

        {confirmLeave ? (
          <div className="sconfirm" role="alertdialog" aria-label="Leave the round">
            <p>
              Leave the round? {results.length} {results.length === 1 ? 'word is' : 'words are'} scored and
              saved.
            </p>
            <button type="button" className="sbtn mint md" onClick={() => setConfirmLeave(false)}>
              Keep going
            </button>
            <button type="button" className="sbtn ghost" onClick={leave}>
              Leave
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
