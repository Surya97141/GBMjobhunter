// Camera maths for the Insights globe. Pure functions so they can be unit-tested.
//
// react-globe.gl renders a sphere of radius 100 with a perspective camera whose
// vertical field of view is 50°. The camera sits at distance (1 + altitude) × 100
// from the centre. The whole sphere is visible when its angular radius, asin(R/d),
// fits inside half the field of view in BOTH directions; on a portrait (narrow)
// screen the horizontal direction is the limiting one.

export const GLOBE_RADIUS = 100;
export const CAMERA_FOV_DEG = 50;
// Extra room for the atmosphere glow and a little breathing space.
export const FIT_MARGIN = 1.25;

const toRad = deg => (deg * Math.PI) / 180;

export function fitAltitude(width, height, { fovDeg = CAMERA_FOV_DEG, margin = FIT_MARGIN } = {}) {
  if (!(width > 0) || !(height > 0)) return 2.5; // not measured yet: a safe default
  const halfV = toRad(fovDeg) / 2;
  const halfH = Math.atan((width / height) * Math.tan(halfV));
  const limitingHalfAngle = Math.min(halfV, halfH);
  const distance = (GLOBE_RADIUS * margin) / Math.sin(limitingHalfAngle);
  return distance / GLOBE_RADIUS - 1;
}

// Zoom limits relative to the fitted view: close enough to read a region,
// never so far out that the globe becomes a dot.
export const MIN_ALTITUDE = 0.6;
export function maxAltitude(fit) {
  return fit * 1.5;
}

export function clampAltitude(altitude, fit) {
  return Math.min(maxAltitude(fit), Math.max(MIN_ALTITUDE, altitude));
}

// One zoom step in or out (factor < 1 zooms in).
export function zoomAltitude(current, fit, direction) {
  const factor = direction === 'in' ? 0.75 : 1 / 0.75;
  return clampAltitude(current * factor, fit);
}
