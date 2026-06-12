import { useEffect } from 'react';
import { useMotionValue, useTransform, animate, motion } from 'framer-motion';
import styles from './ATSRing.module.css';

const RADIUS = 50;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS; // ≈ 314.16

export default function ATSRing({ score = 0 }) {
  // strokeDashoffset drives the arc fill: full circ = empty, 0 = full
  const offset = useMotionValue(CIRCUMFERENCE);

  // Separate motion value counts up for the displayed number
  const count = useMotionValue(0);
  const displayScore = useTransform(count, Math.round);

  useEffect(() => {
    const targetOffset = CIRCUMFERENCE - (score / 100) * CIRCUMFERENCE;

    const c1 = animate(offset, targetOffset, { duration: 1.5, ease: [0.4, 0, 0.2, 1] });
    const c2 = animate(count,  score,        { duration: 1.5, ease: [0.4, 0, 0.2, 1] });

    return () => { c1.stop(); c2.stop(); };
  }, [score]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={styles.wrapper}>

      <div className={styles.ringContainer}>
        <svg viewBox="0 0 120 120" width="160" height="160" aria-hidden="true">

          {/* Background track — full circle */}
          <circle
            cx="60" cy="60" r={RADIUS}
            fill="none"
            strokeWidth="8"
            className={styles.track}
          />

          {/* Progress arc — rotated so fill starts at 12 o'clock, not 3 */}
          <motion.circle
            cx="60" cy="60" r={RADIUS}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            className={styles.progress}
            transform="rotate(-90 60 60)"
            strokeDasharray={CIRCUMFERENCE}
            style={{ strokeDashoffset: offset }}
          />

        </svg>

        {/* Score number layered over the SVG */}
        <div className={styles.scoreOverlay} aria-label={`ATS score: ${score} out of 100`}>
          <motion.span className={styles.scoreValue}>{displayScore}</motion.span>
          <span className={styles.scoreDenom}>/100</span>
        </div>
      </div>

      <span className={styles.label}>ATS Score</span>
      <span className={styles.sublabel}>Resume keyword match rate</span>

    </div>
  );
}
