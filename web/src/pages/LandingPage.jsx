import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import NET from 'vanta/dist/vanta.net.min';
import { Label, Hero, Body } from '../components/Typography';
import ManifestoSection from './landing/ManifestoSection';
import MetricsSection from './landing/MetricsSection';
import FeaturesSection from './landing/FeaturesSection';
import styles from './LandingPage.module.css';

const ChromeSphere = lazy(() => import('../components/three/ChromeSphere'));

export default function LandingPage() {
  const navigate    = useNavigate();
  const sectionRef  = useRef(null);
  const vantaEffect = useRef(null);
  const { startDemo } = useAuth();
  const [demoState, setDemoState] = useState('idle'); // idle | loading | error
  const [demoError, setDemoError] = useState('');

  async function handleTryDemo() {
    setDemoState('loading');
    setDemoError('');
    try {
      await startDemo();
      navigate('/dashboard');
    } catch (err) {
      const status = err.response?.status;
      setDemoState('error');
      setDemoError(
        status === 429 ? 'Too many demo sessions from your network. Try again in an hour.'
        : status === 404 ? 'The live demo is not enabled on this deployment.'
        : 'Could not start the demo. Please try again in a moment.'
      );
    }
  }

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
              <button type="button" aria-label="Get started — create your account" className={styles.ctaFilled} onClick={() => navigate('/register')}>Get Started</button>
              <button type="button" aria-label="Sign in to your account"           className={styles.ctaGhost}  onClick={() => navigate('/login')}>Sign In</button>
              <button
                type="button"
                aria-label="Try the demo with sample data, no sign-up needed"
                className={styles.ctaDemo}
                onClick={handleTryDemo}
                disabled={demoState === 'loading'}
              >
                {demoState === 'loading' ? 'Starting demo…' : 'Try the demo'}
              </button>
            </div>
            <p className={styles.demoNote} role={demoState === 'error' ? 'alert' : undefined}>
              {demoState === 'error'
                ? demoError
                : 'No sign-up needed. The demo uses synthetic sample data.'}
            </p>
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
