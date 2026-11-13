import test from 'node:test';
import assert from 'node:assert/strict';
import { grade, syllables, align, keySpan } from './grade.js';

const REF = '연희는 슬픈 마음으로 나가요.';
const TERM = '슬프다';

// The five worked cases from ENGINEERING-SHADOW.md §3. Two of the table's
// M/S/D/I counts do not survive their own algorithm, so the numbers here are
// what the specified Levenshtein + backtrace actually produce:
//   case 2: '연희는 슬픈 마음으로' is 9 syllables, not 7 → 9 matches, 3 dropped,
//           completeness 75 (the table said 7/5/58). Still fails, which is the
//           point of the case.
//   case 3: 12 matches + 1 insertion costs 1; 11 matches + 1 sub + 1 ins costs
//           2, so the aligner takes the cheaper path → accuracy 92, not 85.
//           (§3's own note, "one error in a 12-syllable sentence is ~8 points",
//           agrees with 92.)
// Case 4 used to pass on the numbers alone; the term gate is what fails it.
const CASES = [
  { transcript: '연희는 슬픈 마음으로 나가요', accuracy: 100, completeness: 100, passed: true, keyed: true, keyOk: true },
  { transcript: '연희는 슬픈 마음으로', accuracy: 100, completeness: 75, passed: false, keyed: true, keyOk: true },
  { transcript: '연희는 슬픈 마음으로 나가어요', accuracy: 92, completeness: 100, passed: true, keyed: true, keyOk: true },
  { transcript: '연희는 슬퍼 마음으로 나가요', accuracy: 92, completeness: 100, passed: false, keyed: true, keyOk: false },
];

for (const c of CASES) {
  test(`grade: ${c.transcript}`, () => {
    const r = grade(c.transcript, REF, TERM);
    assert.equal(r.accuracy, c.accuracy);
    assert.equal(r.completeness, c.completeness);
    assert.equal(r.score, r.accuracy);
    assert.equal(r.passed, c.passed);
    assert.equal(r.keyed, c.keyed);
    assert.equal(r.keyOk, c.keyOk);
    assert.equal(r.diff.length, syllables(REF).length);
  });
}

test('grade: no term keeps the old two-number gate', () => {
  const r = grade(REF, REF);
  assert.equal(r.keyed, false);
  assert.equal(r.keyOk, true);
  assert.equal(r.passed, true);
  assert.equal(r.accuracy, 100);
});

test('keySpan: the dictionary form finds its conjugated slot', () => {
  assert.deepEqual(keySpan(TERM, REF), { len: 2, starts: [3] });
});

test('keySpan: contractions are allowed, ㅡ/ㅓ is not', () => {
  // 되 → 돼
  assert.equal(keySpan('되다', '저녁 6시에 밤이 돼요.').len, 1);
  const ok = grade('저녁 6시에 밤이 돼요.', '저녁 6시에 밤이 돼요.', '되다');
  assert.equal(ok.passed, true);
  const bad = grade('저녁 6시에 밤이 되요.', '저녁 6시에 밤이 돼요.', '되다');
  assert.equal(bad.keyOk, false);
  assert.equal(bad.passed, false);
  // 주 → 줘, 보 → 봤
  assert.ok(keySpan('주다', '물을 줘요.').len > 0);
  assert.ok(keySpan('보다', '무슨 영화를 봤어요?').len > 0);
  // 슬프 vs 슬퍼 is the hole the gate exists to close. Against the deck's own
  // reference (슬픈, medial ㅡ) the span is 2; against a reference that itself
  // says 슬퍼 there is nothing left to match but the stem.
  assert.equal(keySpan('슬프다', '연희는 슬퍼 마음으로 나가요.').len, 1);
});

test('keySpan: ties go to the stem head, not the particle hole', () => {
  // 모으다's 으 loose-matches the particle 을; 모아 is the real span.
  assert.deepEqual(keySpan('모으다', '봉준이는 돈을 모아요.'), { len: 1, starts: [6] });
});

test('keySpan: two occurrences, one said right, still keyed ok', () => {
  const ref = '사과를 먹고 사과를 샀어요';
  const ks = keySpan('사과', ref);
  assert.equal(ks.len, 2);
  assert.deepEqual(ks.starts, [0, 5]);
  // the first one is mangled (과 → 괴 is not a contraction), the second is clean
  const r = grade('사괴를 먹고 사과를 샀어요', ref, '사과');
  assert.equal(r.keyed, true);
  assert.equal(r.keyOk, true);
  assert.equal(r.passed, true);
});

test('keySpan: a term absent from its own sentence is not a gate', () => {
  assert.deepEqual(keySpan('꾸다', '장갑을 껴요.'), { len: 0, starts: [] });
  const r = grade('장갑을 껴요.', '장갑을 껴요.', '꾸다');
  assert.equal(r.keyed, false);
  assert.equal(r.passed, true);
});

test('deck: every authored example passes its own word gate', async () => {
  const { readFileSync } = await import('node:fs');
  const data = JSON.parse(readFileSync(new URL('../../../public/data.json', import.meta.url), 'utf8'));
  const words = [];
  for (const domain of data.domains || []) {
    for (const island of domain.islands || []) {
      for (const w of island.words || []) words.push(w);
    }
  }
  const failed = words
    .filter((w) => w.example)
    .filter((w) => !grade(w.example, w.example, w.term)?.passed)
    .map((w) => w.term);
  assert.deepEqual(failed, []);
  assert.equal(words.filter((w) => w.example).length, 248);
});

test('grade: heard nothing returns null, so no attempt is consumed', () => {
  assert.equal(grade('', REF), null);
  assert.equal(grade('   ', REF), null);
  assert.equal(grade('...', REF), null);
  assert.equal(grade('hello', REF), null);
  assert.equal(grade('연희는', ''), null);
});

test('grade: spacing, punctuation and digits are free', () => {
  const a = grade('연희는, 슬픈 마음으로 나가요!', REF);
  const b = grade('연희는슬픈마음으로나가요', REF);
  assert.equal(a.accuracy, 100);
  assert.equal(a.completeness, 100);
  assert.equal(b.accuracy, 100);
  assert.equal(b.completeness, 100);
  // digits are dropped from comparison (shortcut: upgrade if the deck gains
  // sentences where the number is the test)
  const c = grade('연희는 3 슬픈 마음으로 나가요', REF);
  assert.equal(c.accuracy, 100);
});

test('grade: a dropped verb ending is not forgiven', () => {
  const r = grade('나가', '나가요');
  assert.equal(r.completeness, 67);
  assert.equal(r.passed, false);
  const s = grade('먹어', '먹어요');
  assert.equal(s.passed, false);
  const t = grade('합니다', '합니다');
  assert.equal(t.accuracy, 100);
});

test('grade: diff marks the wrong syllable and the dropped tail', () => {
  const r = grade('연희는 슬퍼 마음으로 나가요', REF);
  const wrong = r.diff.filter((d) => d.kind === 'wrong').map((d) => d.ch);
  assert.deepEqual(wrong, ['픈']);

  const d = grade('연희는 슬픈 마음으로', REF);
  assert.deepEqual(
    d.diff.filter((x) => x.kind === 'dropped').map((x) => x.ch).join(''),
    '나가요',
  );
  assert.equal(d.diff.filter((x) => x.kind === 'match').length, 9);
});

test('grade: an insertion costs accuracy but not completeness', () => {
  const r = grade('연희는 슬픈 마음으로 나가어요', REF);
  assert.equal(r.diff.length, 12);
  assert.equal(r.accuracy, 92);
  assert.equal(r.completeness, 100);
});

test('grade: deterministic', () => {
  const a = grade('연희는 슬퍼 마음으로 나가어요', REF);
  const b = grade('연희는 슬퍼 마음으로 나가어요', REF);
  assert.deepEqual(a, b);
});

test('align: identical arrays are all matches', () => {
  assert.deepEqual(align(['가', '나'], ['가', '나']), ['match', 'match']);
  assert.deepEqual(align([], []), []);
});

test('syllables: keeps only precomposed Hangul, NFC-normalised, capped at 200', () => {
  assert.deepEqual(syllables('a 가 1, 나!'), ['가', '나']);
  assert.equal(syllables('가'.repeat(400)).length, 200);
  assert.deepEqual(syllables(null), []);
});
