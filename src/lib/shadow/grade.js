// Korean syllable-level grader. Pure: no imports, no DOM, no clock.
// This is the seam for a server-side grader later — nothing else in the app
// may compute accuracy, completeness or the gate.
//
// Only precomposed Hangul syllables (U+AC00–U+D7A3) are compared, so spacing,
// punctuation, Latin and digits are free. A precomposed syllable is its jamo
// triple, so comparing code points already compares all three jamo exactly.
// normKo is deliberately NOT imported: it strips -아요/습니다/다, which is
// exactly what has to be said out loud.
const HANGUL = /[\uAC00-\uD7A3]/g;

export function syllables(s) {
  return (String(s ?? '').normalize('NFC').match(HANGUL) || []).slice(0, 200);
}

// Levenshtein over syllable arrays. Fixed backtrace order (match, sub, del,
// ins — first match wins) so the same pair always yields the same diff.
export function align(ref, heard) {
  const n = ref.length;
  const m = heard.length;
  const dp = [];
  for (let i = 0; i <= n; i += 1) {
    dp.push(new Array(m + 1).fill(0));
    dp[i][0] = i;
  }
  for (let j = 0; j <= m; j += 1) dp[0][j] = j;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const diag = dp[i - 1][j - 1] + (ref[i - 1] === heard[j - 1] ? 0 : 1);
      dp[i][j] = Math.min(diag, dp[i - 1][j] + 1, dp[i][j - 1] + 1);
    }
  }
  const ops = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] && ref[i - 1] === heard[j - 1]) {
      ops.push('match');
      i -= 1;
      j -= 1;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      ops.push('sub');
      i -= 1;
      j -= 1;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.push('del');
      i -= 1;
    } else {
      ops.push('ins');
      j -= 1;
    }
  }
  return ops.reverse();
}

// ---- target word gate ----
// The deck word has to be said right, not just enough of the sentence. Finals
// are ignored so the dictionary form matches its conjugation (슬프 vs 슬픈).

// [initial, medial] of one precomposed syllable; the final consonant is dropped.
export function part(ch) {
  const off = ch.codePointAt(0) - 0xac00;
  return [Math.floor(off / 588), Math.floor((off % 588) / 28)];
}

// Medials a Korean speaker may legitimately swap: 하→해, 보→봐, 되→돼, 주→줘.
// Deliberately NOT ㅡ~ㅓ, so 슬프 does not match 슬퍼.
const CONTRACT = [
  [0, 1],
  [8, 9],
  [10, 11],
  [13, 14],
];

export function looseEq(a, b) {
  if (a === b) return true;
  const [ai, am] = part(a);
  const [bi, bm] = part(b);
  if (ai !== bi) return false;
  if (am === bm) return true;
  const lo = Math.min(am, bm);
  const hi = Math.max(am, bm);
  return CONTRACT.some(([x, y]) => x === lo && y === hi);
}

// Where the term lives in the reference, as { len, starts } over reference
// syllable indices. Longest match wins; ties go to the smallest start offset so
// the stem head wins (모으다's 으 loose-matches 을, and the stem is 모으).
export function keySpan(term, reference) {
  const t = syllables(term);
  const rf = syllables(reference);
  let len = 0;
  let starts = [];
  for (let s = 0; s < t.length; s += 1) {
    for (let L = len + 1; s + L <= t.length && L <= rf.length; L += 1) {
      const hits = [];
      for (let i = 0; i + L <= rf.length; i += 1) {
        let ok = true;
        for (let k = 0; k < L; k += 1) {
          if (!looseEq(t[s + k], rf[i + k])) {
            ok = false;
            break;
          }
        }
        if (ok) hits.push(i);
      }
      if (!hits.length) break; // longer lengths starting here cannot match either
      len = L;
      starts = hits;
    }
  }
  return { len, starts };
}

// completeness = how much of the reference was attempted.
// accuracy     = how much of what was attempted was right (insertions count against it).
// Both gate numbers are needed: 100 accuracy on three words is not a pass.
// term is optional; without it the gate is the two numbers only.
export function grade(transcript, reference, term) {
  const ref = syllables(reference);
  const heard = syllables(transcript);
  if (!ref.length || !heard.length) return null;

  let match = 0;
  let sub = 0;
  let dropped = 0;
  let inserted = 0;
  const diff = [];
  let r = 0;
  for (const op of align(ref, heard)) {
    if (op === 'ins') {
      inserted += 1;
      continue;
    }
    const ch = ref[r];
    r += 1;
    if (op === 'match') {
      match += 1;
      diff.push({ ch, kind: 'match' });
    } else if (op === 'sub') {
      sub += 1;
      diff.push({ ch, kind: 'wrong' });
    } else {
      dropped += 1;
      diff.push({ ch, kind: 'dropped' });
    }
  }

  const completeness = Math.round((100 * (match + sub)) / ref.length);
  const accuracy = match + sub + inserted ? Math.round((100 * match) / (match + sub + inserted)) : 0;

  // Every syllable of the term must land as a match in the diff. If the term is
  // not in the sentence at all (authoring slip), the gate falls back to the two
  // numbers rather than failing every attempt.
  const ks = term ? keySpan(term, reference) : { len: 0, starts: [] };
  const keyed = ks.len > 0;
  const keyOk =
    !keyed ||
    ks.starts.some((st) => {
      for (let k = 0; k < ks.len; k += 1) {
        const d = diff[st + k];
        if (!d || d.kind !== 'match') return false;
      }
      return true;
    });

  return {
    accuracy,
    completeness,
    score: accuracy,
    passed: accuracy >= 75 && completeness >= 90 && keyOk,
    diff,
    keyed,
    keyOk,
  };
}
