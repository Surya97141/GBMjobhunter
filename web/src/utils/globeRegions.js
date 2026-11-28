// The regions the Insights globe knows about: where each one sits on the map
// and how to ask an established job board to search in it.
//
// The `region` name is the key used by the skill_demand table (seeded by
// scripts/seed-skill-demand.js). The search fields are fixed here, so a search
// link can only ever point at a board and place listed in this file.
//
// indeedHost: Indeed's site for that country. Each one must also be listed in
// ALLOWED_SEARCH_HOSTS (utils/jobSearchLinks.js).

export const GLOBE_REGIONS = Object.freeze([
  { region: 'San Francisco', country: 'United States',        lat:  37.7749, lng: -122.4194, searchLocation: 'San Francisco, California, United States', indeedHost: 'www.indeed.com', indeedLocation: 'San Francisco, CA' },
  { region: 'New York',      country: 'United States',        lat:  40.7128, lng:  -74.0060, searchLocation: 'New York, New York, United States',        indeedHost: 'www.indeed.com', indeedLocation: 'New York, NY' },
  { region: 'Toronto',       country: 'Canada',               lat:  43.6532, lng:  -79.3832, searchLocation: 'Toronto, Ontario, Canada',                 indeedHost: 'ca.indeed.com',  indeedLocation: 'Toronto, ON' },
  { region: 'London',        country: 'United Kingdom',       lat:  51.5074, lng:   -0.1278, searchLocation: 'London, England, United Kingdom',          indeedHost: 'uk.indeed.com',  indeedLocation: 'London' },
  { region: 'Amsterdam',     country: 'Netherlands',          lat:  52.3676, lng:    4.9041, searchLocation: 'Amsterdam, North Holland, Netherlands',    indeedHost: 'nl.indeed.com',  indeedLocation: 'Amsterdam' },
  { region: 'Paris',         country: 'France',               lat:  48.8566, lng:    2.3522, searchLocation: 'Paris, Île-de-France, France',             indeedHost: 'fr.indeed.com',  indeedLocation: 'Paris (75)' },
  { region: 'Berlin',        country: 'Germany',              lat:  52.5200, lng:   13.4050, searchLocation: 'Berlin, Germany',                          indeedHost: 'de.indeed.com',  indeedLocation: 'Berlin' },
  { region: 'Dubai',         country: 'United Arab Emirates', lat:  25.2048, lng:   55.2708, searchLocation: 'Dubai, United Arab Emirates',              indeedHost: 'ae.indeed.com',  indeedLocation: 'Dubai' },
  { region: 'Bangalore',     country: 'India',                lat:  12.9716, lng:   77.5946, searchLocation: 'Bengaluru, Karnataka, India',              indeedHost: 'in.indeed.com',  indeedLocation: 'Bengaluru, Karnataka' },
  { region: 'Singapore',     country: 'Singapore',            lat:   1.3521, lng:  103.8198, searchLocation: 'Singapore',                                indeedHost: 'sg.indeed.com',  indeedLocation: 'Singapore' },
  { region: 'Tokyo',         country: 'Japan',                lat:  35.6762, lng:  139.6503, searchLocation: 'Tokyo, Japan',                             indeedHost: 'jp.indeed.com',  indeedLocation: '東京都' },
  { region: 'Sydney',        country: 'Australia',            lat: -33.8688, lng:  151.2093, searchLocation: 'Sydney, New South Wales, Australia',       indeedHost: 'au.indeed.com',  indeedLocation: 'Sydney NSW' },
].map(Object.freeze));

// region name → { lat, lng }, for plotting the skill-demand rows.
export const REGION_COORDINATES = Object.freeze(Object.fromEntries(
  GLOBE_REGIONS.map(r => [r.region, { lat: r.lat, lng: r.lng }]),
));

export function findRegion(name) {
  return GLOBE_REGIONS.find(r => r.region === name) ?? null;
}
