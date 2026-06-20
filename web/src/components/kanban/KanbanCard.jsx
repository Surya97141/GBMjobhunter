import { useState, useEffect } from 'react';
import VanillaTilt from 'react-vanilla-tilt';
import styles from './KanbanCard.module.css';
import client from '../../api/client';

const TILT_OPTIONS = {
  max:         6,
  speed:       400,
  glare:       true,
  'max-glare': 0.08,
  scale:       1.02,
  perspective: 1000,
};

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Returns 'high' | 'mid' | 'low' based on ATS score thresholds from the brief.
function scoreLevel(score) {
  if (score === null || score === undefined) return 'low';
  if (score >= 70) return 'high';
  if (score >= 40) return 'mid';
  return 'low';
}

// Ghost risk is inverted from the color-token direction:
// low ghost risk = good = --color-high (green)
// high ghost risk = bad  = --color-low  (red)
function ghostLevel(label) {
  if (label === 'low_risk')      return 'high';
  if (label === 'moderate_risk') return 'mid';
  if (label === 'high_risk')     return 'low';
  return null;
}

function ghostShortLabel(label) {
  if (label === 'low_risk')      return 'Low risk';
  if (label === 'moderate_risk') return 'Mod. risk';
  if (label === 'high_risk')     return 'High risk';
  return null;
}

function CardContent({ card, ghostScore }) {
  const level  = scoreLevel(card.ats_score_at_apply);
  const gLevel = ghostScore ? ghostLevel(ghostScore.label) : null;
  const gText  = ghostScore ? ghostShortLabel(ghostScore.label) : null;

  return (
    <>
      <div className={styles.companyRow}>
        <div
          className={styles.avatar}
          aria-hidden="true"
          data-initial={card.company_name?.[0] ?? '?'}
        />
        <span className={styles.company}>{card.company_name}</span>
      </div>

      <p className={styles.role}>{card.role_title}</p>

      <div className={styles.footer}>
        <span className={styles.atsBadge} data-level={level}>
          {card.ats_score_at_apply !== null && card.ats_score_at_apply !== undefined
            ? `ATS ${card.ats_score_at_apply}`
            : 'ATS —'}
        </span>

        {gLevel && gText && (
          <span className={styles.ghostBadge} data-level={gLevel}>
            <span className={styles.ghostDot} />
            {gText}
          </span>
        )}

        <span className={styles.date}>{formatDate(card.applied_at)}</span>
      </div>
    </>
  );
}

export default function KanbanCard({ card, draggableProvided, isDragging }) {
  const [ghostScore, setGhostScore] = useState(null);

  useEffect(() => {
    if (!card.jd_fingerprint_hash) return;

    const params = new URLSearchParams({ jdFingerprintHash: card.jd_fingerprint_hash });
    if (card.company_id) params.set('companyId', card.company_id);

    client.get(`/jobs/ghost-score?${params}`)
      .then(res => {
        const data = res.data?.data;
        // insufficient_data → omit badge entirely (don't clutter the card)
        if (data && data.label !== 'insufficient_data') {
          setGhostScore(data);
        }
      })
      .catch(() => {}); // silent fail — badge simply doesn't appear
  }, [card.jd_fingerprint_hash, card.company_id]);

  return (
    <div
      ref={draggableProvided.innerRef}
      {...draggableProvided.draggableProps}
      {...draggableProvided.dragHandleProps}
      className={styles.wrapper}
    >
      {isDragging ? (
        <div className={`${styles.card} ${styles.dragging}`}>
          <CardContent card={card} ghostScore={ghostScore} />
        </div>
      ) : (
        <VanillaTilt className={styles.card} options={TILT_OPTIONS}>
          <CardContent card={card} ghostScore={ghostScore} />
        </VanillaTilt>
      )}
    </div>
  );
}
