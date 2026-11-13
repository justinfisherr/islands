import SyllableDiff from './SyllableDiff.jsx';
import { endingOnly } from '../../lib/shadow/grade.js';

// Pure display. The number is the feedback: no ring, no gauge, no praise.
export default function ScoreRead({
  score,
  accuracy,
  completeness,
  attemptNo,
  maxAttempts,
  heard,
  reference,
  diff,
  passed,
  flagged,
  keyed,
  keyOk,
}) {
  const band = passed ? 'pass' : score >= 50 ? 'close' : 'fail';
  const verdict = passed ? 'passed' : score >= 50 ? 'close' : 'missed';
  // Say which gate failed, so "close" is not a mystery to decode from two numbers.
  const short = [];
  if (!passed && completeness < 90) short.push(`completeness ${completeness} — needed 90`);
  if (!passed && accuracy < 75) short.push(`accuracy ${accuracy} — needed 75`);
  const reason = !short.length
    ? ''
    : `${short.join(' · ')}${short.length === 1 && completeness < 90 && endingOnly(diff) ? ' · ending not heard' : ''}`;
  return (
    <div className="sresult">
      <div className={`sscore ${band}`} aria-label={`accuracy ${score}, ${verdict}`}>
        {score}
      </div>
      <div className={`sverdict ${band}`}>{verdict}</div>
      <div className="sgate">
        accuracy {accuracy} · completeness {completeness} · gate 75 / 90
      </div>
      {keyed && !keyOk ? <div className="sgate">main word missed</div> : null}
      {reason ? <div className="sflagged">{reason}</div> : null}
      <div className="sheard">
        <span className="slabel">Heard</span>
        <span className="sheardtext">{heard || '—'}</span>
      </div>
      <div className="sref">
        <span className="slabel">reference</span>
        <SyllableDiff reference={reference} diff={diff} />
      </div>
      <div className="sattempt">
        attempt {attemptNo} of {maxAttempts}
      </div>
      {flagged ? <div className="sflagged">Third attempt. Flagged.</div> : null}
    </div>
  );
}
