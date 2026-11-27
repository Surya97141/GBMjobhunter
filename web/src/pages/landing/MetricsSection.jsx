import { motion } from 'framer-motion';
import { Label, Heading, Display, Small } from '../../components/Typography';
import styles from './MetricsSection.module.css';

// How the app's numbers are worked out. Every figure here is a rule in the
// code, not a market statistic: the app has no data set that would support
// claims about the job market as a whole.
//   0–100%: services/jobs/src/utils/tfidf.js (keyword match)
//   50+:    services/intelligence/src/services/patternComputation.service.js (MIN_COHORT_SIZE)
//   3+:     services/jobs/src/services/ghostScore.service.js (MIN_COHORT)
//   0:      resume parsing and skill recommendations are rule-based; AI explanations are optional
const METRICS = [
  {
    value:  '0–100%',
    label:  'Keyword match',
    note:   'share of a posting\'s words found in your resume; not an applicant tracking system score',
  },
  {
    value:  '50+',
    label:  'Similar applicants per cohort',
    note:   'before any cohort insight is shown',
  },
  {
    value:  '3+',
    label:  'Applications to the same posting',
    note:   'before a ghost-risk estimate is shown',
  },
  {
    value:  '0',
    label:  'AI calls to parse your resume or rank skills',
    note:   'both are rule-based; AI explanations are optional',
  },
];

// Parent controls timing: starts staggering once it enters view.
// Child variants just describe enter/exit shape — timing comes from parent.
const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.1 },
  },
};

const cardVariants = {
  hidden:   { y: 24, opacity: 0 },
  visible:  { y: 0,  opacity: 1, transition: { duration: 0.55, ease: [0.4, 0, 0.2, 1] } },
};

export default function MetricsSection() {
  return (
    <section className={styles.section}>

      <div className={styles.header}>
        <Label color="accent" className={styles.overline}>HOW IT IS MEASURED</Label>
        <Heading>The rules behind the numbers you see</Heading>
      </div>

      <motion.ul
        className={styles.grid}
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-80px' }}
        aria-label="How the app's numbers are worked out"
      >
        {METRICS.map((m) => (
          <motion.li
            key={m.value}
            className={styles.card}
            variants={cardVariants}
            whileHover={{ y: -4, transition: { duration: 0.2 } }}
          >
            {/* as="p" avoids an h2 inside a list item — keeps heading hierarchy clean */}
            <Display as="p" className={styles.metric}>{m.value}</Display>
            <Small color="secondary" className={styles.label}>{m.label}</Small>
            <Small color="muted">{m.note}</Small>
          </motion.li>
        ))}
      </motion.ul>

    </section>
  );
}
