import { lazy, Suspense } from 'react';
import { Display, Body, Label } from '../components/Typography';
import styles from './InsightsPage.module.css';

// Lazy-load so Three.js + react-globe.gl don't block the initial dashboard paint
const WorldGlobe = lazy(() => import('../components/dashboard/WorldGlobe'));

// The data shown here is the skill_demand table: per city and skill, open roles,
// applicant pool and a demand score. It is NOT the user's own applications. In
// this codebase the table is filled by scripts/seed-skill-demand.js with
// representative sample values, so the page says so.
export default function InsightsPage() {
  return (
    <main className={styles.content}>

      <header className={styles.pageHeader}>
        <Display as="h1">Insights</Display>
        <Body color="secondary">
          Regional skill demand: which skills are in demand in which cities.
          This map does not show your own applications.
        </Body>
      </header>

      <section className={styles.globeSection} aria-labelledby="demand-map-label">
        <div className={styles.globeSectionHeader}>
          <Label id="demand-map-label">Skill demand by region</Label>
        </div>

        <dl className={styles.legend}>
          <div>
            <dt>Each point</dt>
            <dd>One skill in one city. Taller points have a higher demand score.</dd>
          </div>
          <div>
            <dt>Demand score</dt>
            <dd>Open roles divided by the applicant pool, × 100, for the latest week in the dataset.</dd>
          </div>
          <div>
            <dt>Data source</dt>
            <dd>A seeded sample dataset of representative values, not live job listings.</dd>
          </div>
        </dl>

        <Suspense
          fallback={
            <div className={styles.globePlaceholder} role="status">Loading map…</div>
          }
        >
          <WorldGlobe />
        </Suspense>
      </section>

    </main>
  );
}
