import { useId } from 'react';
import { GLOBE_REGIONS, findRegion } from '../../utils/globeRegions';
import { buildRegionSearchLinks, isSafeSearchUrl, EXTERNAL_LINK_PROPS } from '../../utils/jobSearchLinks';
import styles from './Insights.module.css';

// The personalized job-board searches for the selected region. Also an
// accessible way to choose a region without the 3D map, so it works when the
// globe cannot render.
//
// Wording rule: these are searches on an external board. Never call them jobs,
// openings or listings, and never show or imply a count.
export default function RegionSearchLinks({ terms, selectedRegion, onSelectRegion }) {
  const id = useId();
  const region = findRegion(selectedRegion);
  const groups = buildRegionSearchLinks(region, terms);

  return (
    <section className={`${styles.section} ${styles.searchSection}`} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={styles.title}>Job-board searches by region</h2>
      <p className={styles.notice}>
        Each link opens a search on an external job board in a new tab. They are searches, not job listings:
        whether a search shows any openings, and how many, is decided by the job board and is not measured by
        this app. Nothing here compares regions. This is separate from the skill demand map, whose numbers come
        from a seeded sample dataset.
      </p>

      <div className={styles.regionPicker} role="group" aria-label="Choose a region">
        {GLOBE_REGIONS.map(r => (
          <button
            key={r.region}
            type="button"
            className={styles.regionBtn}
            aria-pressed={r.region === selectedRegion}
            onClick={() => onSelectRegion(r.region)}
          >
            {r.region}
          </button>
        ))}
      </div>

      <div data-testid="region-search-links" aria-live="polite">
        {!region ? (
          <p className={styles.muted}>Choose a region above or click a green labelled marker on the map.</p>
        ) : (
          <>
            <h3 className={styles.regionTitle}>{region.region}, {region.country}</h3>
            {groups.length === 0 ? (
              <p className={styles.muted}>No searches could be built for this region.</p>
            ) : (
              <ul className={styles.searchList}>
                {groups.map(group => (
                  <li key={group.term} className={styles.searchRow}>
                    <span className={styles.searchTerm}>“{group.term}”</span>
                    <span className={styles.searchLinks}>
                      {group.links.filter(link => isSafeSearchUrl(link.url)).map(link => (
                        <a key={link.board} href={link.url} {...EXTERNAL_LINK_PROPS} className={styles.searchLink}>
                          Search {link.label} in {region.region}
                          <span className={styles.srOnly}> (external site, opens in a new tab)</span>
                          <span aria-hidden="true"> ↗</span>
                        </a>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
