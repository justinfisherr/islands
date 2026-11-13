import test from 'node:test';
import assert from 'node:assert/strict';

// recognize.js reads window.SpeechRecognition once, at module load, so the stub
// has to be in place before the import. node --test gives each file its own
// process, so this cannot leak into grade.test.mjs.
class FakeSR {
  static last = null;
  static reset() {
    FakeSR.last = null;
  }
  constructor() {
    FakeSR.last = this;
    this.started = false;
    this.stopped = false;
    this.aborted = false;
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
  }
  start() {
    this.started = true;
  }
  // Deliberately silent: this is the browser that never fires onend after stop().
  stop() {
    this.stopped = true;
  }
  abort() {
    this.aborted = true;
  }
}

globalThis.window = globalThis;
globalThis.SpeechRecognition = FakeSR;

const { createRecognizer, RECOGNITION_SUPPORTED } = await import('./recognize.js');

// [transcript, isFinal] pairs -> the shape Chrome hands onresult.
function results(...chunks) {
  return {
    resultIndex: 0,
    results: chunks.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal })),
  };
}

function spy() {
  const calls = { final: [], interim: [], nothing: 0, error: [], denied: 0 };
  const rec = createRecognizer({
    onInterim: (t) => calls.interim.push(t),
    onFinal: (t) => calls.final.push(t),
    onHeardNothing: () => {
      calls.nothing += 1;
    },
    onDenied: () => {
      calls.denied += 1;
    },
    onError: (c) => calls.error.push(c),
  });
  return { calls, rec };
}

test('mic: an interim-only transcript is graded, not heard-nothing', () => {
  assert.equal(RECOGNITION_SUPPORTED, true);
  FakeSR.reset();
  const { calls, rec } = spy();
  rec.start();
  const sr = FakeSR.last;
  sr.onresult(results(['연희는 슬픈 마음으로', false]));
  assert.deepEqual(calls.interim, ['연희는 슬픈 마음으로']);
  sr.onend();

  assert.deepEqual(calls.final, ['연희는 슬픈 마음으로']);
  assert.equal(calls.nothing, 0);
  rec.abort();
});

test('mic: final and interim chunks are rebuilt from every result', () => {
  FakeSR.reset();
  const { calls, rec } = spy();
  rec.start();
  const sr = FakeSR.last;
  sr.onresult(results(['연희는 ', true], ['슬픈 ', false]));
  sr.onresult(results(['연희는 슬픈 ', true], ['마음으로', false]));
  assert.deepEqual(calls.interim.at(-1), '마음으로');
  sr.onend();

  assert.deepEqual(calls.final, ['연희는 슬픈 마음으로']);
  rec.abort();
});

test('mic: stop() settles on the timer when onend never fires', { timeout: 5000 }, async () => {
  FakeSR.reset();
  const { calls, rec } = spy();
  const settled = new Promise((resolve) => {
    const push = calls.final.push.bind(calls.final);
    calls.final.push = (t) => {
      push(t);
      resolve(t);
    };
  });
  rec.start();
  const sr = FakeSR.last;
  sr.onresult(results(['연희는 슬픈 마음으로', false]));
  rec.stop();
  assert.equal(sr.stopped, true);
  assert.equal(calls.final.length, 0); // the fake never ends the session

  assert.equal(await settled, '연희는 슬픈 마음으로');
  assert.equal(calls.nothing, 0);
  rec.abort();
});

test('mic: an empty session is heard-nothing, exactly once', () => {
  FakeSR.reset();
  const { calls, rec } = spy();
  rec.start();
  const sr = FakeSR.last;
  sr.onresult(results(['', false]));
  sr.onend();
  sr.onend();

  assert.equal(calls.nothing, 1);
  assert.deepEqual(calls.final, []);
  rec.abort();
});

test('mic: abort() settles nothing', () => {
  FakeSR.reset();
  const { calls, rec } = spy();
  rec.start();
  FakeSR.last.onresult(results(['연희는', false]));
  rec.abort();
  FakeSR.last.onend();

  assert.equal(calls.nothing, 0);
  assert.deepEqual(calls.final, []);
});
