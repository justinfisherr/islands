// All the Safari weirdness lives here.
// continuous:false + interimResults:true + an 8s watchdog, because Chrome's
// recognizer ends on ~1s of silence and a short Korean sentence can end the
// session early. An empty final transcript is heard-nothing, not a zero.
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
  let watchdog = null;
  let settled = false;
  let cancelled = false;
  let denied = false;

  const clear = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = null;
  };

  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i += 1) {
      const chunk = e.results[i][0]?.transcript || '';
      if (e.results[i].isFinal) finalText += chunk;
      else interim += chunk;
    }
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
    if (onError) onError(code);
  };

  r.onend = () => {
    clear();
    if (cancelled || settled) return;
    settled = true;
    const text = finalText.trim();
    if (text) {
      if (onFinal) onFinal(text);
      return;
    }
    if (denied) return;
    if (onHeardNothing) onHeardNothing();
  };

  const stop = () => {
    clear();
    try {
      r.stop();
    } catch {
      /* already stopped */
    }
  };

  return {
    supported: true,
    start() {
      cancelled = false;
      settled = false;
      finalText = '';
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
