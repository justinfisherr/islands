// All the Safari weirdness lives here.
// continuous:false + interimResults:true + an 8s watchdog, because Chrome's
// recognizer ends on ~1s of silence and a short Korean sentence can end the
// session early. An empty final transcript is heard-nothing, not a zero.
//
// The text the user watches is interim. Chrome often ends the session without
// finalising it, and some builds never fire onend after stop(), so the last
// non-empty text (final + interim) is the transcript, and stop() always
// settles on a timer rather than trusting onend.
const SR =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition || null
    : null;

export const RECOGNITION_SUPPORTED = !!SR;

export function createRecognizer({ onInterim, onFinal, onHeardNothing, onDenied, onError } = {}) {
  if (!SR) {
    return {
      supported: false,
      start() {},
      stop() {},
      abort() {},
    };
  }

  const r = new SR();
  r.lang = 'ko-KR';
  r.continuous = false;
  r.interimResults = true;
  r.maxAlternatives = 1;

  let finalText = '';
  let interimText = '';
  let watchdog = null;
  let settleTimer = null;
  let settled = false;
  let cancelled = false;
  let denied = false;

  const clear = () => {
    if (watchdog) clearTimeout(watchdog);
    if (settleTimer) clearTimeout(settleTimer);
    watchdog = null;
    settleTimer = null;
  };

  // One verdict per session, whichever of onend / the settle timer gets here first.
  const settle = () => {
    if (settled || cancelled) return;
    settled = true;
    clear();
    // Concatenated, not either/or: a finalised head plus an interim tail is one
    // sentence, and grading only the head marks the screen's text wrong.
    const text = (finalText + interimText).trim();
    if (text) {
      if (onFinal) onFinal(text);
      return;
    }
    if (denied) return;
    if (onHeardNothing) onHeardNothing();
  };

  // Rebuilt from every result each event: resultIndex + append loses chunks
  // when the browser revises an earlier result in place.
  r.onresult = (e) => {
    let fin = '';
    let interim = '';
    for (let i = 0; i < e.results.length; i += 1) {
      const chunk = e.results[i][0]?.transcript || '';
      if (e.results[i].isFinal) fin += chunk;
      else interim += chunk;
    }
    finalText = fin;
    interimText = interim;
    if (interim && onInterim) onInterim(interim.trim());
  };

  r.onerror = (e) => {
    const code = e?.error || '';
    if (code === 'aborted') return;
    if (code === 'no-speech') return; // onend turns this into heard-nothing
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      denied = true;
      if (onDenied) onDenied();
      return;
    }
    if (finalText || interimText) return; // a live transcript outranks an error code
    if (onError) onError(code);
  };

  r.onend = settle;

  const stop = () => {
    clear();
    try {
      r.stop();
    } catch {
      /* already stopped */
    }
    // Some builds never fire onend after stop(); do not leave the UI recording.
    if (!settled && !cancelled) settleTimer = setTimeout(settle, 1200);
  };

  return {
    supported: true,
    start() {
      cancelled = false;
      settled = false;
      denied = false;
      finalText = '';
      interimText = '';
      clear();
      try {
        r.start();
      } catch {
        if (onError) onError('start-failed');
        return;
      }
      watchdog = setTimeout(stop, 8000);
    },
    stop,
    abort() {
      cancelled = true;
      clear();
      try {
        r.abort();
      } catch {
        /* already gone */
      }
    },
  };
}
