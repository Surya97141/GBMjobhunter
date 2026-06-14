import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Heading } from '../Typography';
import client from '../../api/client';
import styles from './InsightCards.module.css';

// Map pattern_type from DB → display label and dot colour key
const PATTERN_META = {
  ghost_rate:      { label: 'Ghost Rate',      level: 'mid'  },
  rejection_rate:  { label: 'Rejection Rate',  level: 'low'  },
  timing:          { label: 'Timing Signal',   level: 'high' },
};

function formatCohort(n) {
  return `Based on ${n.toLocaleString()} application${n === 1 ? '' : 's'}`;
}

const containerVariants = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.1 } },
};

const cardVariants = {
  hidden:  { y: 20, opacity: 0 },
  visible: { y: 0,  opacity: 1, transition: { duration: 0.5, ease: [0.4, 0, 0.2, 1] } },
};

function EmptyState() {
  return (
    <div className={styles.emptyState}>
      <p className={styles.emptyHeadline}>Your insights are building</p>
      <p className={styles.emptyBody}>
        As more users log applications in your role category, patterns emerge.
        Check back after you have logged 5 or more applications.
      </p>
    </div>
  );
}

export default function InsightCards() {
  const [insights, setInsights] = useState([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    client.get('/users/me/insights')
      .then(res => setInsights(res.data.data.insights.slice(0, 3)))
      .catch(() => {}) // fail silently — show empty state
      .finally(() => setLoading(false));
  }, []);

  async function handleMarkSeen(id) {
    // Optimistic — hide the unseen indicator immediately
    setInsights(prev =>
      prev.map(i => i.id === id ? { ...i, seen: true } : i)
    );
    try {
      await client.put(`/users/me/insights/${id}/seen`);
    } catch {
      // Revert on failure
      setInsights(prev =>
        prev.map(i => i.id === id ? { ...i, seen: false } : i)
      );
    }
  }

  return (
    <section className={styles.section}>

      <div className={styles.sectionHeader}>
        <Heading as="h2">Your Insights</Heading>
        {insights.length > 0 && (
          <Link to="/insights" className={styles.viewAll}>View all →</Link>
        )}
      </div>

      {loading ? null : insights.length === 0 ? (
        <EmptyState />
      ) : (
        <motion.ul
          className={styles.grid}
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-60px' }}
          aria-label="Job search insights"
        >
          {insights.map(insight => {
            const meta = PATTERN_META[insight.pattern_type] ?? { label: insight.pattern_type, level: 'mid' };
            return (
              <motion.li
                key={insight.id}
                className={`${styles.card} ${insight.seen ? styles.cardSeen : ''}`}
                variants={cardVariants}
              >
                <div className={styles.cardTop}>
                  <span className={styles.category}>{meta.label}</span>
                  <span
                    className={styles.dot}
                    data-level={meta.level}
                    aria-hidden="true"
                  />
                </div>

                <p className={styles.headline}>{insight.headline}</p>
                <p className={styles.detail}>{insight.action}</p>

                <div className={styles.cardFooter}>
                  <span className={styles.cohort}>
                    {formatCohort(insight.cohort_size ?? 0)}
                  </span>
                  {!insight.seen && (
                    <button
                      className={styles.seenBtn}
                      onClick={() => handleMarkSeen(insight.id)}
                    >
                      Mark as seen
                    </button>
                  )}
                </div>
              </motion.li>
            );
          })}
        </motion.ul>
      )}

    </section>
  );
}
