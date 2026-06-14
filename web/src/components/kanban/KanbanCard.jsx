import VanillaTilt from 'react-vanilla-tilt';
import styles from './KanbanCard.module.css';

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

function CardContent({ card }) {
  const level = scoreLevel(card.ats_score_at_apply);

  return (
    <>
      <div className={styles.companyRow}>
        <div className={styles.avatar} aria-hidden="true">
          {card.company_name?.[0] ?? '?'}
        </div>
        <span className={styles.company}>{card.company_name}</span>
      </div>

      <p className={styles.role}>{card.role_title}</p>

      <div className={styles.footer}>
        <span className={styles.atsBadge} data-level={level}>
          {card.ats_score_at_apply !== null && card.ats_score_at_apply !== undefined
            ? `ATS ${card.ats_score_at_apply}`
            : 'ATS —'}
        </span>
        <span className={styles.date}>{formatDate(card.applied_at)}</span>
      </div>
    </>
  );
}

export default function KanbanCard({ card, draggableProvided, isDragging }) {
  return (
    <div
      ref={draggableProvided.innerRef}
      {...draggableProvided.draggableProps}
      {...draggableProvided.dragHandleProps}
      className={styles.wrapper}
    >
      {isDragging ? (
        <div className={`${styles.card} ${styles.dragging}`}>
          <CardContent card={card} />
        </div>
      ) : (
        <VanillaTilt className={styles.card} options={TILT_OPTIONS}>
          <CardContent card={card} />
        </VanillaTilt>
      )}
    </div>
  );
}
