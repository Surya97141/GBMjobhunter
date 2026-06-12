import { useEffect, useRef, lazy, Suspense } from 'react';
import * as THREE from 'three';
import NET from 'vanta/dist/vanta.net.min';
import { Label, Hero, Body } from '../components/Typography';
import ManifestoSection from './landing/ManifestoSection';
import MetricsSection from './landing/MetricsSection';
import FeaturesSection from './landing/FeaturesSection';
import styles from './LandingPage.module.css';

const ChromeSphere = lazy(() => import('../components/three/ChromeSphere'));

export default function LandingPage() {
  const sectionRef = useRef(null);
  const vantaEffect = useRef(null);

  useEffect(() => {
    if (!vantaEffect.current && sectionRef.current) {
      vantaEffect.current = NET({
        el: sectionRef.current,
        THREE,
        color:           0xa78bfa,
        backgroundColor: 0x000000,
        points:          12,
        maxDistance:     18,
        spacing:         18,
        backgroundAlpha: 1,
      });
    }
    return () => {
      if (vantaEffect.current) {
        vantaEffect.current.destroy();
        vantaEffect.current = null;
      }
    };
  }, []);

  return (
    <div data-theme="obsidian">

      {/* ── HERO ── */}
      <section className={styles.hero} ref={sectionRef}>
        <div className={styles.heroContent}>

          <div className={styles.heroLeft}>
            <Label color="accent" className={styles.overline}>
              JOB INTELLIGENCE PLATFORM
            </Label>

            <Hero>
              Turn Rejections<br />Into Intelligence
            </Hero>

            <Body color="secondary">
              Every application logged. Every pattern surfaced.
              Stop guessing why you&apos;re ghosted — start understanding the market.
            </Body>

            <div className={styles.ctaGroup}>
              <button className={styles.ctaFilled}>Get Started</button>
              <button className={styles.ctaGhost}>See How It Works</button>
            </div>
          </div>

          <div className={styles.heroRight}>
            <Suspense fallback={null}>
              <ChromeSphere />
            </Suspense>
          </div>

        </div>
      </section>

      {/* ── SCROLL REVEAL ── */}
      <ManifestoSection />

      {/* ── METRICS ── */}
      <MetricsSection />

      {/* ── FEATURES ACCORDION ── */}
      <FeaturesSection />

    </div>
  );
}
