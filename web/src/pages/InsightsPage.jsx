import { lazy, Suspense } from 'react';
import { Display, Body, Label } from '../components/Typography';
import styles from './InsightsPage.module.css';

// Lazy-load so Three.js + react-globe.gl don't block the initial dashboard paint
const WorldGlobe = lazy(() => import('../components/dashboard/WorldGlobe'));

export default function InsightsPage() {
  return (
    <main className={styles.content}>

      <header className={styles.pageHeader}>
        <Display as="h1">Insights</Display>
        <Body color="secondary">Where your applications are landing across the globe.</Body>
      </header>

      <section className={styles.globeSection}>
        <div className={styles.globeSectionHeader}>
          <Label>Application Map</Label>
        </div>

        <Suspense
          fallback={
            <div className={styles.globePlaceholder}>Loading globe…</div>
          }
        >
          <WorldGlobe />
        </Suspense>
      </section>

    </main>
  );
}
