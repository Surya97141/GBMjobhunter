// Synthetic sample data for demo accounts. Nothing here is real: company names
// are fictional and every number is invented. The UI labels this as sample data.
//
// This file is the place to tailor the story a reviewer sees. The mix of
// outcomes below fills every tracker column, so the board looks alive.

const DEMO_PROFILE = {
  name:                'Demo User',
  target_role:         'Frontend Engineer',
  target_location:     'Remote',
  years_of_experience: 3,
};

const DEMO_RESUME = {
  skills: ['React', 'TypeScript', 'Node.js', 'SQL', 'CSS'],
  summary: 'Sample resume for the demo account. Not a real person.',
};

// daysAgo is converted to a timestamp at seed time so the data always looks
// recent, however long after deployment someone opens the demo.
const DEMO_APPLICATIONS = [
  { company: 'Northwind Labs',     role: 'Frontend Engineer',        outcome: 'pending',   daysAgo: 1,  ats: 78, responseDays: null },
  { company: 'Bluefin Systems',    role: 'React Developer',          outcome: 'pending',   daysAgo: 2,  ats: 71, responseDays: null },
  { company: 'Cedar & Co',         role: 'UI Engineer',              outcome: 'pending',   daysAgo: 3,  ats: 66, responseDays: null },
  { company: 'Lumen Analytics',    role: 'Full Stack Engineer',      outcome: 'interview', daysAgo: 9,  ats: 82, responseDays: 4 },
  { company: 'Kestrel Payments',   role: 'Frontend Engineer',        outcome: 'interview', daysAgo: 12, ats: 74, responseDays: 6 },
  { company: 'Orchard Health',     role: 'Software Engineer',        outcome: 'offer',     daysAgo: 25, ats: 85, responseDays: 7 },
  { company: 'Quartz Mobility',    role: 'Frontend Developer',       outcome: 'rejected',  daysAgo: 18, ats: 52, responseDays: 5 },
  { company: 'Harbor Retail',      role: 'Web Engineer',             outcome: 'rejected',  daysAgo: 22, ats: 48, responseDays: 9 },
  { company: 'Meridian Cloud',     role: 'React Engineer',           outcome: 'ghosted',   daysAgo: 30, ats: 69, responseDays: null },
  { company: 'Atlas Freight',      role: 'Frontend Engineer',        outcome: 'ghosted',   daysAgo: 35, ats: 61, responseDays: null },
];

// Synthetic cohort patterns. role_bucket is prefixed "demo_" so these can
// never collide with (or overwrite) patterns the real pipeline computes.
const DEMO_PATTERNS = [
  {
    roleBucket: 'demo_frontend', skillCluster: 'css.node.js.react.sql', patternType: 'outcome_distribution',
    cohortSize: 240,
    finding: {
      ghost_rate: 0.42, rejection_rate: 0.31, avg_ats_score: 64.5,
      ghosted_count: 101, rejected_count: 74, interview_count: 46, offer_count: 19, cohort_size: 240,
    },
    headline: '42% of similar applicants were ghosted',
    action:   'Sample insight: in this synthetic cohort, applications with keyword match above 75% were ghosted far less often. Tailor your resume keywords to each posting before you apply.',
  },
  {
    roleBucket: 'demo_frontend', skillCluster: 'css.node.js.react.sql', patternType: 'ats_score_effect',
    cohortSize: 180,
    finding: {
      ghost_rate: 0.28, rejection_rate: 0.22, avg_ats_score: 79.1,
      ghosted_count: 50, rejected_count: 40, interview_count: 62, offer_count: 28, cohort_size: 180,
    },
    headline: 'Sample: higher keyword match, more interviews',
    action:   'Sample insight from synthetic data: applicants with 75%+ keyword match reached interview at roughly twice the rate of those below 60%. Your Orchard Health application had an 85% keyword match.',
  },
];

module.exports = { DEMO_PROFILE, DEMO_RESUME, DEMO_APPLICATIONS, DEMO_PATTERNS };
