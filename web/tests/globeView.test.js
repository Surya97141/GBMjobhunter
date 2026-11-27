import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GLOBE_RADIUS, CAMERA_FOV_DEG, FIT_MARGIN, MIN_ALTITUDE,
  fitAltitude, clampAltitude, maxAltitude, zoomAltitude,
} from '../src/utils/globeView.js';

// Angular radius of the (margin-inflated) globe must fit half the FOV in both axes.
function fitsViewport(width, height, altitude) {
  const d = (1 + altitude) * GLOBE_RADIUS;
  const angular = Math.asin((GLOBE_RADIUS * FIT_MARGIN) / d);
  const halfV = (CAMERA_FOV_DEG * Math.PI) / 360;
  const halfH = Math.atan((width / height) * Math.tan(halfV));
  return angular <= halfV + 1e-9 && angular <= halfH + 1e-9;
}

test('the whole globe fits desktop, square and phone viewports', () => {
  for (const [w, h] of [[1100, 560], [600, 600], [358, 358], [358, 480], [320, 520]]) {
    const alt = fitAltitude(w, h);
    assert.ok(fitsViewport(w, h, alt), `${w}x${h} at altitude ${alt.toFixed(2)}`);
  }
});

test('narrow (portrait) viewports need the camera further away than wide ones', () => {
  assert.ok(fitAltitude(320, 520) > fitAltitude(1100, 560));
});

test('wide viewports are limited by height, so width does not matter', () => {
  assert.ok(Math.abs(fitAltitude(1100, 560) - fitAltitude(2000, 560)) < 1e-9);
});

test('unmeasured containers get a safe default instead of NaN', () => {
  assert.equal(fitAltitude(0, 0), 2.5);
  assert.equal(fitAltitude(undefined, 400), 2.5);
});

test('zoom stays within limits', () => {
  const fit = fitAltitude(600, 600);
  assert.equal(clampAltitude(0.01, fit), MIN_ALTITUDE);
  assert.equal(clampAltitude(99, fit), maxAltitude(fit));
  assert.ok(zoomAltitude(fit, fit, 'in') < fit);
  assert.ok(zoomAltitude(fit, fit, 'out') > fit);
  let alt = fit;
  for (let i = 0; i < 20; i += 1) alt = zoomAltitude(alt, fit, 'in');
  assert.equal(alt, MIN_ALTITUDE);
});
