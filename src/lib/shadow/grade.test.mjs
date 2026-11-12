import test from 'node:test';
import assert from 'node:assert/strict';
import { grade, syllables, align } from './grade.js';

const REF = '연희는 슬픈 마음으로 나가요.';

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
const CASES = [
  { transcript: '연희는 슬픈 마음으로 나가요', accuracy: 100, completeness: 100, passed: true },
  { transcript: '연희는 슬픈 마음으로', accuracy: 100, completeness: 75, passed: false },
  { transcript: '연희는 슬픈 마음으로 나가어요', accuracy: 92, completeness: 100, passed: true },
  { transcript: '연희는 슬퍼 마음으로 나가요', accuracy: 92, completeness: 100, passed: true },
];

for (const c of CASES) {
  test(`grade: ${c.transcript}`, () => {
    const r = grade(c.transcript, REF);
    assert.equal(r.accuracy, c.accuracy);
    assert.equal(r.completeness, c.completeness);
    assert.equal(r.score, r.accuracy);
    assert.equal(r.passed, c.passed);
    assert.equal(r.diff.length, syllables(REF).length);
  });
}

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
