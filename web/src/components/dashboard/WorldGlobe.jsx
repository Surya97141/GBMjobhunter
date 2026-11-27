import { useRef, useState, useEffect, useCallback } from 'react';
import Globe from 'react-globe.gl';
import { useTheme } from '../../context/ThemeContext';
import client from '../../api/client';
import { fitAltitude, clampAltitude, zoomAltitude } from '../../utils/globeView';
import styles from './WorldGlobe.module.css';

// react-globe.gl uses Three.js directly — CSS variables don't reach it.
// Map theme name to raw colour values instead.
const THEME_COLORS = {
  obsidian:  { atmosphere: '#a78bfa', point: '#a78bfa' },
  cream:     { atmosphere: '#c17f3a', point: '#c17f3a' },
  extension: { atmosphere: '#4f46e5', point: '#4f46e5' },
};

// Canonical lat/lng for each region name used in the skill_demand table.
// New regions can be added here without touching the seeding script.
const REGION_COORDINATES = {
  'San Francisco': { lat:  37.7749, lng: -122.4194 },
  'New York':      { lat:  40.7128, lng:  -74.0060 },
  'London':        { lat:  51.5074, lng:   -0.1278 },
  'Berlin':        { lat:  52.5200, lng:   13.4050 },
  'Amsterdam':     { lat:  52.3676, lng:    4.9041 },
  'Paris':         { lat:  48.8566, lng:    2.3522 },
  'Toronto':       { lat:  43.6532, lng:  -79.3832 },
  'Singapore':     { lat:   1.3521, lng:  103.8198 },
  'Bangalore':     { lat:  12.9716, lng:   77.5946 },
  'Sydney':        { lat: -33.8688, lng:  151.2093 },
  'Dubai':         { lat:  25.2048, lng:   55.2708 },
  'Tokyo':         { lat:  35.6762, lng:  139.6503 },
};

const START_VIEW = { lat: 30, lng: -30 }; // above the Atlantic: Americas and Europe
const ROTATE_STEP = { lat: 10, lng: 20 };  // keyboard rotation step, degrees

function buildPoints(rows) {
  return rows
    .filter(row => REGION_COORDINATES[row.region] != null)
    .map(row => {
      const coords = REGION_COORDINATES[row.region];
      // Altitude proportional to heat_score (0–100 → 0.02–0.12) — subtle variation.
      const alt = 0.02 + (Math.min(row.heat_score ?? 50, 100) / 100) * 0.10;
      return {
        lat:           coords.lat,
        lng:           coords.lng,
        alt,
        skill:         row.skill,
        region:        row.region,
        heat:          Math.round(row.heat_score ?? 0),
        openRoles:     row.open_roles ?? null,
        applicantPool: row.applicant_pool ?? null,
      };
    });
}

// Hover labels are injected as HTML by react-globe.gl, so escape data values.
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

export default function WorldGlobe() {
  const globeRef     = useRef(null);
  const containerRef = useRef(null);
  const zoomedRef    = useRef(false); // true once the user has zoomed manually
  const { theme } = useTheme();

  const [points, setPoints] = useState([]);
  // loading | ready | empty | error — so a failed or empty load is explained
  // instead of looking like a globe with nothing to show.
  const [dataState, setDataState] = useState('loading');
  const [size,      setSize]      = useState({ width: 0, height: 0 });
  const [rotating,  setRotating]  = useState(() => !prefersReducedMotion());
  const [showList,  setShowList]  = useState(false);

  const colors = THEME_COLORS[theme] ?? THEME_COLORS.obsidian;
  const fit    = fitAltitude(size.width, size.height);

  useEffect(() => {
    client.get('/jobs/demand-supply')
      .then(res => {
        const rows = res.data?.data?.demandSupply ?? [];
        const built = buildPoints(rows);
        setPoints(built);
        setDataState(built.length > 0 ? 'ready' : 'empty');
      })
      .catch(() => {
        // Demand-supply data unavailable — globe renders with no points.
        setPoints([]);
        setDataState('error');
      });
  }, []);

  // react-globe.gl defaults to the full window size; measure the container so
  // the canvas (and therefore the whole globe) fits the space it is given.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize(prev => (
        Math.round(prev.width) === Math.round(width) && Math.round(prev.height) === Math.round(height)
          ? prev
          : { width, height }
      ));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [showList]); // the container remounts when switching back from the list view

  // Keep the whole globe in view when the container size changes.
  useEffect(() => {
    const g = globeRef.current;
    if (!g || !size.width) return;
    const current = g.pointOfView();
    const altitude = zoomedRef.current ? clampAltitude(current.altitude, fit) : fit;
    g.pointOfView({ lat: current.lat, lng: current.lng, altitude }, 0);
  }, [size.width, size.height, fit]);

  useEffect(() => {
    const controls = globeRef.current?.controls?.();
    if (controls) controls.autoRotate = rotating;
  }, [rotating]);

  function handleGlobeReady() {
    const g = globeRef.current;
    if (!g) return;
    const controls = g.controls();
    controls.autoRotate      = rotating;
    controls.autoRotateSpeed = 0.4;
    // Wheel/pinch zoom stays off so scrolling the page over the globe still
    // scrolls the page; zoom uses the buttons and keyboard instead.
    controls.enableZoom      = false;
    g.pointOfView({ ...START_VIEW, altitude: fit }, 0);
  }

  const moveTo = useCallback((view, ms = 400) => {
    const g = globeRef.current;
    if (!g) return;
    g.pointOfView({ ...g.pointOfView(), ...view }, ms);
  }, []);

  function zoom(direction) {
    const g = globeRef.current;
    if (!g) return;
    zoomedRef.current = true;
    moveTo({ altitude: zoomAltitude(g.pointOfView().altitude, fit, direction) }, 300);
  }

  function resetView() {
    zoomedRef.current = false;
    moveTo({ ...START_VIEW, altitude: fit }, 600);
  }

  function rotateBy(dLat, dLng) {
    const g = globeRef.current;
    if (!g) return;
    const { lat, lng } = g.pointOfView();
    moveTo({ lat: Math.max(-80, Math.min(80, lat + dLat)), lng: lng + dLng }, 300);
  }

  function handleKeyDown(e) {
    const actions = {
      ArrowLeft:  () => rotateBy(0, -ROTATE_STEP.lng),
      ArrowRight: () => rotateBy(0,  ROTATE_STEP.lng),
      ArrowUp:    () => rotateBy( ROTATE_STEP.lat, 0),
      ArrowDown:  () => rotateBy(-ROTATE_STEP.lat, 0),
      '+': () => zoom('in'),
      '=': () => zoom('in'),
      '-': () => zoom('out'),
      '0': () => resetView(),
    };
    const action = actions[e.key];
    if (!action) return;
    e.preventDefault();
    setRotating(false); // a user steering the globe doesn't want it to drift away
    action();
  }

  function handlePointClick(point) {
    zoomedRef.current = true;
    setRotating(false);
    moveTo({ lat: point.lat, lng: point.lng, altitude: clampAltitude(fit * 0.6, fit) }, 600);
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar} role="toolbar" aria-label="Globe controls">
        <button
          type="button"
          className={styles.control}
          onClick={() => setRotating(r => !r)}
          aria-pressed={!rotating}
          disabled={showList}
        >
          {rotating ? 'Pause rotation' : 'Resume rotation'}
        </button>
        <button type="button" className={styles.control} onClick={() => zoom('in')}  disabled={showList} aria-label="Zoom in">+</button>
        <button type="button" className={styles.control} onClick={() => zoom('out')} disabled={showList} aria-label="Zoom out">−</button>
        <button type="button" className={styles.control} onClick={resetView} disabled={showList}>Reset view</button>
        <button
          type="button"
          className={`${styles.control} ${styles.listToggle}`}
          onClick={() => setShowList(v => !v)}
          aria-pressed={showList}
          disabled={dataState !== 'ready'}
        >
          {showList ? 'Show globe' : 'Show as list'}
        </button>
      </div>

      {showList ? (
        <div className={styles.listWrap}>
          <table className={styles.table}>
            <caption className={styles.caption}>Skill demand by region, highest demand score first</caption>
            <thead>
              <tr>
                <th scope="col">Region</th>
                <th scope="col">Skill</th>
                <th scope="col">Demand score</th>
                <th scope="col">Open roles</th>
                <th scope="col">Applicant pool</th>
              </tr>
            </thead>
            <tbody>
              {[...points].sort((a, b) => b.heat - a.heat).map(p => (
                <tr key={`${p.region}-${p.skill}`}>
                  <td>{p.region}</td>
                  <td>{p.skill}</td>
                  <td>{p.heat}</td>
                  <td>{p.openRoles ?? '—'}</td>
                  <td>{p.applicantPool ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          ref={containerRef}
          className={styles.container}
          tabIndex={0}
          role="group"
          aria-label="Skill demand globe. Drag to rotate. Arrow keys rotate, plus and minus zoom, 0 resets the view."
          onKeyDown={handleKeyDown}
        >
          {size.width > 0 && (
            <Globe
              ref={globeRef}
              width={size.width}
              height={size.height}
              onGlobeReady={handleGlobeReady}
              globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
              backgroundColor="rgba(0,0,0,0)"
              atmosphereColor={colors.atmosphere}
              atmosphereAltitude={0.18}
              pointsData={points}
              pointLat="lat"
              pointLng="lng"
              pointAltitude="alt"
              pointColor={() => colors.point}
              pointRadius={0.45}
              pointLabel={(p) =>
                `<span style="font-family:sans-serif;font-size:12px;padding:4px 8px;background:rgba(0,0,0,0.75);border-radius:4px;color:#fff">` +
                `${escapeHtml(p.skill)} · ${escapeHtml(p.region)} · demand score ${escapeHtml(p.heat)}` +
                `</span>`
              }
              onPointClick={handlePointClick}
            />
          )}
          {dataState !== 'ready' && (
            <p
              className={`${styles.status} ${dataState === 'error' ? styles.statusError : ''}`}
              role={dataState === 'error' ? 'alert' : 'status'}
            >
              {dataState === 'loading' && 'Loading skill demand data…'}
              {dataState === 'empty'   && 'No skill demand data is available yet.'}
              {dataState === 'error'   && 'Skill demand data could not be loaded. Try reloading the page.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
