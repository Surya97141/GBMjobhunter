import { lazy, Suspense, useState } from 'react';
import { Display, Body, Label } from '../components/Typography';
import GlobeErrorBoundary from '../components/insights/GlobeErrorBoundary';
import PersonalizedSearches from '../components/insights/PersonalizedSearches';
import RegionSearchLinks from '../components/insights/RegionSearchLinks';
import { searchableRegions } from '../utils/jobSearchLinks';
import { globeFailureMessage } from '../utils/globeSupport';
import styles from './InsightsPage.module.css';

// Lazy-load so Three.js + react-globe.gl don't block the initial dashboard paint
const WorldGlobe = lazy(() => import('../components/dashboard/WorldGlobe'));

// The data shown here is the skill_demand table: per city and skill, open roles,
// applicant pool and a demand score. It is NOT the user's own applications. In
// this codebase the table is filled by scripts/seed-skill-demand.js with
// representative sample values, so the page says so.
//
// Personalized job-board searches are a separate, opt-in layer: after the user
// reviews their profile and asks the AI provider, green labelled markers open
// searches on LinkedIn Jobs and Indeed. They are searches, not listings, and
// are kept apart from the seeded demand data in both the map and the text.
export default function InsightsPage() {
  const [searchTerms,    setSearchTerms]    = useState([]);
  const [selectedRegion, setSelectedRegion] = useState(null);
  const regions = searchableRegions(searchTerms);

  function handleTerms(terms) {
    setSearchTerms(terms);
    if (!terms.length) setSelectedRegion(null);
  }

  return (
    <main className={styles.content}>

      <header className={styles.pageHeader}>
        <Display as="h1">Insights</Display>
        <Body color="secondary">
          Regional skill demand: which skills are in demand in which cities.
          This map does not show your own applications.
        </Body>
      </header>

      <PersonalizedSearches onTerms={handleTerms} />

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
          {regions.length > 0 && (
            <div>
              <dt>Green labelled markers</dt>
              <dd>
                Your personalized job-board searches. They are not part of the demand data and say nothing about
                how many openings a region has.
              </dd>
            </div>
          )}
        </dl>

        <GlobeErrorBoundary
          fallback={(reason) => (
            <p className={styles.globeError} role="alert">{globeFailureMessage(reason)}</p>
          )}
        >
          <Suspense
            fallback={
              <div className={styles.globePlaceholder} role="status">Loading map…</div>
            }
          >
            <WorldGlobe
              searchRegions={regions}
              selectedRegion={selectedRegion}
              onSelectRegion={setSelectedRegion}
            />
          </Suspense>
        </GlobeErrorBoundary>
      </section>

      {searchTerms.length > 0 && (
        <RegionSearchLinks
          terms={searchTerms}
          selectedRegion={selectedRegion}
          onSelectRegion={setSelectedRegion}
        />
      )}

    </main>
  );
}
