import { useRef, useState, useEffect } from 'react';
import Globe from 'react-globe.gl';
import { useTheme } from '../../context/ThemeContext';
import client from '../../api/client';
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

function buildPoints(rows) {
  return rows
    .filter(row => REGION_COORDINATES[row.region] != null)
    .map(row => {
      const coords = REGION_COORDINATES[row.region];
      // Altitude proportional to heat_score (0–100 → 0.02–0.12) — subtle variation.
      const alt = 0.02 + (Math.min(row.heat_score ?? 50, 100) / 100) * 0.10;
      return {
        lat:    coords.lat,
        lng:    coords.lng,
        alt,
        skill:  row.skill,
        region: row.region,
        heat:   Math.round(row.heat_score ?? 0),
      };
    });
}

export default function WorldGlobe() {
  const globeRef = useRef(null);
  const { theme } = useTheme();

  const [points, setPoints] = useState([]);

  const colors = THEME_COLORS[theme] ?? THEME_COLORS.obsidian;

  useEffect(() => {
    client.get('/jobs/demand-supply')
      .then(res => {
        const rows = res.data?.data?.demandSupply ?? [];
        setPoints(buildPoints(rows));
      })
      .catch(() => {
        // Demand-supply data unavailable — globe renders with no points.
        setPoints([]);
      });
  }, []);

  function handleGlobeReady() {
    const g = globeRef.current;
    if (!g) return;

    g.controls().autoRotate      = true;
    g.controls().autoRotateSpeed = 0.4;
    g.controls().enableZoom      = false;

    // Start camera above the Atlantic — shows both Americas and Europe on load
    g.pointOfView({ lat: 30, lng: -30, altitude: 2.2 }, 0);
  }

  function handlePointClick(point) {
    globeRef.current?.pointOfView(
      { lat: point.lat, lng: point.lng, altitude: 1.5 },
      600
    );
  }

  return (
    <div className={styles.container}>
      <Globe
        ref={globeRef}
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
          `${p.skill} · ${p.region} · heat ${p.heat}` +
          `</span>`
        }
        onPointClick={handlePointClick}
      />
    </div>
  );
}
