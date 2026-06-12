import { motion } from 'framer-motion';
import { Label, Heading, Display, Small } from '../../components/Typography';
import styles from './MetricsSection.module.css';

const METRICS = [
  {
    value:  '47',
    label:  'Average applications before first offer',
    note:   'across all tracked users',
  },
  {
    value:  '68%',
    label:  'Of applications ghosted',
    note:   'within 21 days of submission',
  },
  {
    value:  '14d',
    label:  'Median response window',
    note:   'for companies that do reply',
  },
  {
    value:  '3.2×',
    label:  'Better ATS pass rate',
    note:   'with a skill-matched resume',
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
        <Label color="accent" className={styles.overline}>BY THE NUMBERS</Label>
        <Heading>The market signals you&apos;ve been missing</Heading>
      </div>

      <motion.ul
        className={styles.grid}
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-80px' }}
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
