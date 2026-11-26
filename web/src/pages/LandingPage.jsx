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
  // True once a demo start has taken long enough that the backend is probably
  // waking from sleep (free-tier hosts take up to about a minute).
  const [slowStart, setSlowStart] = useState(false);
  const slowTimer = useRef(null);

  useEffect(() => () => clearTimeout(slowTimer.current), []);

  async function handleTryDemo() {
    setDemoState('loading');
    setDemoError('');
    setSlowStart(false);
    clearTimeout(slowTimer.current);
    slowTimer.current = setTimeout(() => setSlowStart(true), 4000);
    try {
      await startDemo();
      navigate('/dashboard');
    } catch (err) {
      const status = err.response?.status;
      setDemoState('error');
      setDemoError(
        status === 429 ? 'Too many demo sessions from your network. Try again in an hour.'
        : status === 404 ? 'The live demo is not enabled on this deployment.'
        : err.code === 'ECONNABORTED' ? 'The demo server did not wake up in time. Please try again.'
        : !err.response ? 'Could not reach the demo server. Check your connection and try again.'
        : 'Could not start the demo. Please try again in a moment.'
      );
    } finally {
      clearTimeout(slowTimer.current);
      setSlowStart(false);
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
            {demoState === 'error' ? (
              <p className={styles.demoNote} role="alert">{demoError}</p>
            ) : (
              <p className={styles.demoNote} role="status" aria-live="polite">
                {demoState === 'loading' && slowStart
                  ? 'Waking the demo server. This can take up to a minute on the free tier, please keep this tab open.'
                  : 'No sign-up needed. The demo uses synthetic sample data.'}
              </p>
            )}
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
