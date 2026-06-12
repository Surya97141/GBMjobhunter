import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Label, Subheading, Body } from '../../components/Typography';
import styles from './FeaturesSection.module.css';

const FEATURES = [
  {
    index: '01',
    title: 'ATS Intelligence',
    description:
      'Score your resume against any job description before you hit submit. Our TF-IDF keyword engine surfaces exactly which terms you\'re missing and explains why automated screeners reject applications before a human ever reads them.',
    tags: ['TF-IDF Scoring', 'Keyword Gap Analysis', 'JD Fingerprinting', 'ATS Platform Detection'],
  },
  {
    index: '02',
    title: 'Ghost Pattern Detection',
    description:
      'Track which companies ghost, which respond inside a week, and what seniority level actually hears back. Built from anonymised cohort data — so you know where your application is likely to disappear before you send it.',
    tags: ['Ghost Rate by Company', 'Response Windows', 'Seniority Signals', 'Follow-up Timing'],
  },
  {
    index: '03',
    title: 'Cohort Insights',
    description:
      'Anonymous patterns from developers with your exact skill set. See what\'s working for people who look like you on paper — without exposing anyone\'s data. PII-stripped from day one, statistically valid at 50+ members.',
    tags: ['Anonymous Cohorts', 'Skill-Based Matching', 'Outcome Patterns', 'PII-Free by Design'],
  },
];

export default function FeaturesSection() {
  // First row open by default — gives users immediate preview of the content
  const [openIndex, setOpenIndex] = useState('01');

  function toggleRow(index) {
    setOpenIndex(prev => (prev === index ? null : index));
  }

  return (
    <section className={styles.section}>

      <div className={styles.header}>
        <Label color="accent" className={styles.overline}>CAPABILITIES</Label>
        <Subheading>Everything you need to understand the market</Subheading>
      </div>

      <ul className={styles.list}>
        {FEATURES.map((f) => {
          const isOpen = openIndex === f.index;

          return (
            <li key={f.index} className={styles.row}>

              <button
                className={styles.trigger}
                onClick={() => toggleRow(f.index)}
                aria-expanded={isOpen}
                aria-controls={`feature-body-${f.index}`}
              >
                <span className={styles.index}>{f.index}</span>

                <span className={styles.titleText}>{f.title}</span>

                {/* + rotates 45° → × when open */}
                <motion.span
                  className={styles.icon}
                  animate={{ rotate: isOpen ? 45 : 0 }}
                  transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                  aria-hidden="true"
                >
                  +
                </motion.span>
              </button>

              {/* AnimatePresence tracks mount/unmount so exit animation plays */}
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    id={`feature-body-${f.index}`}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div className={styles.body}>

                      <Body color="secondary" className={styles.description}>
                        {f.description}
                      </Body>

                      <ul className={styles.tagList} aria-label="Capabilities">
                        {f.tags.map((tag) => (
                          <li key={tag} className={styles.tag}>{tag}</li>
                        ))}
                      </ul>

                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

            </li>
          );
        })}
      </ul>

    </section>
  );
}
