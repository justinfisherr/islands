// Korean TTS. Shared by the board chip and the round.
// getVoices() is empty until the first `voiceschanged` in Chrome, so never
// trust a cached empty list — re-ask on every call and refresh on the event.
let cache = null;
const subs = new Set();
let listening = false;

function synth() {
  if (typeof window === 'undefined') return null;
  return window.speechSynthesis || null;
}

function load() {
  const s = synth();
  cache = s ? s.getVoices() || [] : [];
  return cache;
}

function listen() {
  const s = synth();
  if (listening || !s) return;
  listening = true;
  load();
  s.addEventListener('voiceschanged', () => {
    load();
    subs.forEach((f) => f());
  });
}

export function onVoices(cb) {
  listen();
  subs.add(cb);
  return () => subs.delete(cb);
}

export function koVoice() {
  const list = cache && cache.length ? cache : load();
  return (
    list.find((v) => /^ko[-_]KR/i.test(v.lang)) ||
    list.find((v) => /^ko\b|^ko[-_]/i.test(v.lang)) ||
    null
  );
}

export function cancelSpeak() {
  const s = synth();
  if (!s) return;
  try {
    s.cancel();
  } catch {
    /* nothing to cancel */
  }
}

// Always call from a real gesture: iOS Safari wants one per utterance.
export function speak(text, rate = 0.85) {
  const s = synth();
  if (!s || !text) return false;
  cancelSpeak();
  const u = new SpeechSynthesisUtterance(String(text));
  const v = koVoice();
  if (v) u.voice = v;
  u.lang = 'ko-KR';
  u.rate = rate;
  u.pitch = 1;
  try {
    s.speak(u);
    return true;
  } catch {
    return false;
  }
}
