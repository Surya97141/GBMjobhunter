import { motion } from 'framer-motion';
import { Heading } from '../Typography';
import styles from './InsightCards.module.css';

// Hardcoded mock insights — replaced by real cohort data from the intelligence
// service in Phase 10. confidence maps to the coloured dot on each card.
const INSIGHTS = [
  {
    id: 1,
    category: 'Response Pattern',
    headline: 'Senior fintech roles reply 3× faster than the market average',
    detail: 'Based on 312 applications in your skill cohort over the last 90 days.',
    confidence: 'high',
  },
  {
    id: 2,
    category: 'Ghost Signal',
    headline: 'Companies >500 employees ghost 68% of applications in your stack',
    detail: 'Your ghost rate at large companies is 2.1× the cross-cohort average.',
    confidence: 'high',
  },
  {
    id: 3,
    category: 'Skill Demand',
    headline: 'React + TypeScript applications have a +23% callback rate this quarter',
    detail: 'Skill cluster demand is rising — 147 matching openings tracked this week.',
    confidence: 'mid',
  },
];

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
};

const cardVariants = {
  hidden:  { y: 20, opacity: 0 },
  visible: { y: 0,  opacity: 1, transition: { duration: 0.5, ease: [0.4, 0, 0.2, 1] } },
};

export default function InsightCards() {
  return (
    <section className={styles.section}>

      <div className={styles.sectionHeader}>
        <Heading as="h2">Your Insights</Heading>
      </div>

      <motion.ul
        className={styles.grid}
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-60px' }}
        aria-label="Job search insights"
      >
        {INSIGHTS.map((insight) => (
          <motion.li
            key={insight.id}
            className={styles.card}
            variants={cardVariants}
          >
            <div className={styles.cardTop}>
              <span className={styles.category}>{insight.category}</span>
              <span
                className={styles.dot}
                data-confidence={insight.confidence}
                aria-label={`${insight.confidence} confidence`}
              />
            </div>
            <p className={styles.headline}>{insight.headline}</p>
            <p className={styles.detail}>{insight.detail}</p>
          </motion.li>
        ))}
      </motion.ul>

    </section>
  );
}
