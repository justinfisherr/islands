// Pure. Marks the reference at syllable level: wrong syllables are underlined,
// dropped syllables become hairline ghost boxes. Non-Hangul characters pass
// through so the spacing still reads like the sentence.
export default function SyllableDiff({ reference, diff }) {
  const marks = diff || [];
  let i = 0;
  return (
    <span className="sdiff" aria-hidden="true">
      {[...String(reference ?? '')].map((ch, k) => {
        if (ch < '\uAC00' || ch > '\uD7A3') return <span key={k}>{ch}</span>;
        const m = marks[i] || { kind: 'match' };
        i += 1;
        return (
          <span key={k} className={m.kind === 'match' ? undefined : `syl ${m.kind}`}>
            {ch}
          </span>
        );
      })}
    </span>
  );
}
