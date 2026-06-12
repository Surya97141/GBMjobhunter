import VanillaTilt from 'react-vanilla-tilt';
import styles from './KanbanCard.module.css';

const TILT_OPTIONS = {
  max:         6,
  speed:       400,
  glare:       false,
  scale:       1.02,
  perspective: 1000,
};

function CardContent({ card }) {
  return (
    <>
      <div className={styles.companyRow}>
        <div className={styles.avatar} aria-hidden="true">
          {card.company[0]}
        </div>
        <span className={styles.company}>{card.company}</span>
      </div>
      <p className={styles.role}>{card.role}</p>
      <div className={styles.footer}>
        <span className={styles.atsScore}>ATS {card.atsScore}</span>
        <span className={styles.date}>{card.date}</span>
      </div>
    </>
  );
}

export default function KanbanCard({ card, draggableProvided, isDragging }) {
  return (
    // Outer wrapper is owned by dnd — receives the drag CSS transform.
    // No visual styles here; the inner card handles appearance.
    <div
      ref={draggableProvided.innerRef}
      {...draggableProvided.draggableProps}
      {...draggableProvided.dragHandleProps}
      className={styles.wrapper}
    >
      {isDragging ? (
        // VanillaTilt removed while dragging — the two transforms conflict
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
