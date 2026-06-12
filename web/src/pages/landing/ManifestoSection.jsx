import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Label, Display, Body } from '../../components/Typography';
import styles from './ManifestoSection.module.css';

gsap.registerPlugin(ScrollTrigger);

export default function ManifestoSection() {
  const containerRef = useRef(null);

  useEffect(() => {
    // gsap.context scopes all tweens + ScrollTriggers to containerRef.
    // ctx.revert() kills them on unmount — safe for React StrictMode.
    const ctx = gsap.context(() => {
      // Set initial hidden state before ScrollTrigger fires.
      // Doing this inside the context means ctx.revert() undoes it cleanly.
      gsap.set('[data-reveal]', { y: 40, opacity: 0 });

      gsap.to('[data-reveal]', {
        y: 0,
        opacity: 1,
        duration: 0.85,
        ease: 'power3.out',
        stagger: 0.12,
        scrollTrigger: {
          trigger: containerRef.current,
          start: 'top 72%',
          once: true,
        },
      });
    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <section className={styles.section} ref={containerRef}>
      <div className={styles.inner}>

        <Label color="accent" className={styles.overline} data-reveal>
          THE PROBLEM
        </Label>

        <div className={styles.lines}>
          <Display data-reveal>You sent 47 applications.</Display>
          <Display data-reveal>You waited. You followed up.</Display>
          <Display data-reveal>You heard nothing back.</Display>
        </div>

        <Body color="secondary" className={styles.sub} data-reveal>
          That silence isn&apos;t failure — it&apos;s data you haven&apos;t decoded yet.
          GBMjobhunter turns every ghost, every rejection, and every timing
          pattern into actionable intelligence.
        </Body>

      </div>
    </section>
  );
}
