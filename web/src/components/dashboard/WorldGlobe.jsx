import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import Globe from 'react-globe.gl';
import { useTheme } from '../../context/ThemeContext';
import client from '../../api/client';
import { fitAltitude, clampAltitude, zoomAltitude } from '../../utils/globeView';
import { REGION_COORDINATES } from '../../utils/globeRegions';
import {
  GLOBE_TEXTURE_URL, browserSupportsWebGL, globeFailureMessage, demandLoadMessage,
} from '../../utils/globeSupport';
import GlobeErrorBoundary from '../insights/GlobeErrorBoundary';
import styles from './WorldGlobe.module.css';

// react-globe.gl uses Three.js directly — CSS variables don't reach it.
// Map theme name to raw colour values instead.
// `point` colours the seeded skill-demand bars; `search` colours the
// personalized job-board search markers, so the two layers never look alike.
const THEME_COLORS = {
  obsidian:  { atmosphere: '#a78bfa', point: '#a78bfa', search: '#34d399' },
  cream:     { atmosphere: '#c17f3a', point: '#c17f3a', search: '#5a8a62' },
  extension: { atmosphere: '#4f46e5', point: '#4f46e5', search: '#16a34a' },
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

// searchRegions:  regions with personalized job-board searches (empty until
//                 the user personalizes the map). Drawn as labelled markers,
//                 a separate layer from the skill-demand bars.
// selectedRegion: name of the region whose searches are shown below the map.
// onSelectRegion: called with a region name when its marker is clicked.
export default function WorldGlobe({ searchRegions = [], selectedRegion = null, onSelectRegion }) {
  const globeRef     = useRef(null);
  const containerRef = useRef(null);
  const zoomedRef    = useRef(false); // true once the user has zoomed manually
  const { theme } = useTheme();

  const [points, setPoints] = useState([]);
  // loading | ready | empty | error — so a failed or empty load is explained
  // instead of looking like a globe with nothing to show.
  const [dataState, setDataState] = useState('loading');
  const [dataError, setDataError] = useState('');
  const [size,      setSize]      = useState({ width: 0, height: 0 });
  const [rotating,  setRotating]  = useState(() => !prefersReducedMotion());
  const [showList,  setShowList]  = useState(false);
  // Why the 3D map cannot be shown (null while it can). Checked before the
  // Globe mounts: without WebGL, three.js throws during render.
  const [failure,   setFailure]   = useState(() => (browserSupportsWebGL() ? null : 'webgl'));
  const [texture,   setTexture]   = useState('loading'); // loading | ready | error
  const [globeReady, setGlobeReady] = useState(false);

  const colors   = THEME_COLORS[theme] ?? THEME_COLORS.obsidian;
  const fit      = fitAltitude(size.width, size.height);
  const listView = showList || failure !== null;

  useEffect(() => {
    client.get('/jobs/demand-supply')
      .then(res => {
        const rows = res.data?.data?.demandSupply ?? [];
        const built = buildPoints(rows);
        setPoints(built);
        setDataState(built.length > 0 ? 'ready' : 'empty');
      })
      .catch(err => {
        console.warn('[insights] skill demand data failed to load:', err?.response?.status ?? err?.message);
        setPoints([]);
        setDataError(demandLoadMessage(err));
        setDataState('error');
      });
  }, []);

  // Check the texture separately: three.js only logs a failed texture, which
  // would leave a blank sphere with no explanation.
  useEffect(() => {
    if (failure === 'webgl' || typeof Image === 'undefined') return undefined;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => { if (!cancelled) setTexture('ready'); };
    img.onerror = () => {
      if (cancelled) return;
      console.warn('[insights] globe texture failed to load:', GLOBE_TEXTURE_URL);
      setTexture('error');
    };
    img.src = GLOBE_TEXTURE_URL;
    return () => { cancelled = true; };
  }, [failure]);

  const markers = useMemo(() => searchRegions.map(r => ({
    region: r.region, country: r.country, lat: r.lat, lng: r.lng,
  })), [searchRegions]);

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
  }, [listView]); // the container remounts when switching back from the list view

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
    setGlobeReady(true);
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

  function handleMarkerClick(marker) {
    handlePointClick(marker);
    onSelectRegion?.(marker.region);
  }

  // A region chosen from the list below the map: turn the globe to face it.
  useEffect(() => {
    if (!selectedRegion || !globeReady || listView) return;
    const coords = REGION_COORDINATES[selectedRegion];
    if (!coords) return;
    zoomedRef.current = true;
    setRotating(false);
    moveTo({ lat: coords.lat, lng: coords.lng, altitude: clampAltitude(fit * 0.6, fit) }, 600);
  }, [selectedRegion, globeReady, listView, fit, moveTo]);

  function handleGlobeError(reason) {
    setGlobeReady(false);
    setFailure(reason === 'chunk' ? 'render' : reason);
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar} role="toolbar" aria-label="Globe controls">
        <button
          type="button"
          className={styles.control}
          onClick={() => setRotating(r => !r)}
          aria-pressed={!rotating}
          disabled={listView}
        >
          {rotating ? 'Pause rotation' : 'Resume rotation'}
        </button>
        <button type="button" className={styles.control} onClick={() => zoom('in')}  disabled={listView} aria-label="Zoom in">+</button>
        <button type="button" className={styles.control} onClick={() => zoom('out')} disabled={listView} aria-label="Zoom out">−</button>
        <button type="button" className={styles.control} onClick={resetView} disabled={listView}>Reset view</button>
        <button
          type="button"
          className={`${styles.control} ${styles.listToggle}`}
          onClick={() => setShowList(v => !v)}
          aria-pressed={listView}
          disabled={dataState !== 'ready' || failure !== null}
        >
          {listView ? 'Show globe' : 'Show as list'}
        </button>
      </div>

      {failure && (
        <p className={`${styles.notice} ${styles.noticeError}`} role="alert">
          {globeFailureMessage(failure)}
        </p>
      )}
      {!failure && texture === 'error' && (
        <p className={styles.notice} role="status">{globeFailureMessage('texture')}</p>
      )}

      {listView && dataState !== 'ready' ? (
        <p className={`${styles.notice} ${dataState === 'error' ? styles.noticeError : ''}`} role={dataState === 'error' ? 'alert' : 'status'}>
          {dataState === 'loading' && 'Loading skill demand data…'}
          {dataState === 'empty'   && 'No skill demand data is available yet.'}
          {dataState === 'error'   && dataError}
        </p>
      ) : listView ? (
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
          aria-label={
            'Skill demand globe. Drag to rotate. Arrow keys rotate, plus and minus zoom, 0 resets the view.' +
            (markers.length ? ' Labelled markers open job-board searches; the same regions are listed below the map.' : '')
          }
          onKeyDown={handleKeyDown}
        >
          {size.width > 0 && (
            <GlobeErrorBoundary onError={handleGlobeError} fallback={() => null}>
            <Globe
              ref={globeRef}
              width={size.width}
              height={size.height}
              onGlobeReady={handleGlobeReady}
              globeImageUrl={texture === 'ready' ? GLOBE_TEXTURE_URL : null}
              showGraticules={texture === 'error'}
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
              labelsData={markers}
              labelLat="lat"
              labelLng="lng"
              labelText="region"
              labelSize={(m) => (m.region === selectedRegion ? 1.6 : 1.1)}
              labelDotRadius={(m) => (m.region === selectedRegion ? 0.9 : 0.6)}
              labelColor={() => colors.search}
              labelResolution={2}
              labelAltitude={0.01}
              labelLabel={(m) =>
                `<span style="font-family:sans-serif;font-size:12px;padding:4px 8px;background:rgba(0,0,0,0.75);border-radius:4px;color:#fff">` +
                `${escapeHtml(m.region)}: click for job-board searches` +
                `</span>`
              }
              onLabelClick={handleMarkerClick}
            />
            </GlobeErrorBoundary>
          )}
          {dataState !== 'ready' && (
            <p
              className={`${styles.status} ${dataState === 'error' ? styles.statusError : ''}`}
              role={dataState === 'error' ? 'alert' : 'status'}
            >
              {dataState === 'loading' && 'Loading skill demand data…'}
              {dataState === 'empty'   && 'No skill demand data is available yet.'}
              {dataState === 'error'   && dataError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
