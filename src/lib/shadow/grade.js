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

// completeness = how much of the reference was attempted.
// accuracy     = how much of what was attempted was right (insertions count against it).
// Both gate numbers are needed: 100 accuracy on three words is not a pass.
export function grade(transcript, reference) {
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
  return {
    accuracy,
    completeness,
    score: accuracy,
    passed: accuracy >= 75 && completeness >= 90,
    diff,
  };
}
