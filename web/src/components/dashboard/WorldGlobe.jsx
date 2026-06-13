import { useRef } from 'react';
import Globe from 'react-globe.gl';
import { useTheme } from '../../context/ThemeContext';
import styles from './WorldGlobe.module.css';

// Mock application locations — replaced by real data from the jobs service in Phase 10
const APPLICATION_POINTS = [
  { lat: 37.7749, lng: -122.4194, company: 'Stripe'  },
  { lat: 37.7749, lng: -122.4800, company: 'Linear'  },
  { lat: 37.3318, lng: -122.0312, company: 'Figma'   },
  { lat: 37.8044, lng: -122.2712, company: 'Notion'  },
  { lat: 37.7749, lng: -122.3987, company: 'Loom'    },
  { lat: 37.4419, lng: -122.1430, company: 'Fly.io'  },
  { lat: 40.7128, lng:  -74.0060, company: 'Brex'    },
  { lat: 51.5074, lng:   -0.1278, company: 'Monzo'   },
  { lat: 52.5200, lng:   13.4050, company: 'N26'     },
  { lat: 48.8566, lng:    2.3522, company: 'Malt'    },
];

// react-globe.gl uses Three.js directly — CSS variables don't reach it.
// Map theme name to raw colour values instead.
const THEME_COLORS = {
  obsidian: { atmosphere: '#a78bfa', point: '#a78bfa' },
  cream:    { atmosphere: '#c17f3a', point: '#c17f3a' },
  extension:{ atmosphere: '#4f46e5', point: '#4f46e5' },
};

export default function WorldGlobe() {
  const globeRef = useRef(null);
  const { theme } = useTheme();

  const colors = THEME_COLORS[theme] ?? THEME_COLORS.obsidian;

  function handleGlobeReady() {
    const g = globeRef.current;
    if (!g) return;

    // Enable auto-rotation and disable zoom so the globe is view-only
    g.controls().autoRotate      = true;
    g.controls().autoRotateSpeed = 0.4;
    g.controls().enableZoom      = false;

    // Start camera above the Atlantic — shows both Americas and Europe
    g.pointOfView({ lat: 30, lng: -30, altitude: 2.2 }, 0);
  }

  function handlePointClick(point) {
    // Fly the camera to the clicked company's location
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
        // Night-side earth texture from three-globe CDN
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
        // Transparent canvas background — .container provides the bg colour
        backgroundColor="rgba(0,0,0,0)"
        atmosphereColor={colors.atmosphere}
        atmosphereAltitude={0.18}
        pointsData={APPLICATION_POINTS}
        pointLat="lat"
        pointLng="lng"
        pointColor={() => colors.point}
        pointAltitude={0.05}
        pointRadius={0.45}
        pointLabel={(p) => `<span style="font-family:sans-serif;font-size:12px;padding:4px 8px;background:rgba(0,0,0,0.7);border-radius:4px;color:#fff">${p.company}</span>`}
        onPointClick={handlePointClick}
      />
    </div>
  );
}
