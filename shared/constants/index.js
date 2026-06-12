const QUEUE_NAMES = {
  APPLICATION_LOGGED: 'application.logged',
  OUTCOME_UPDATED: 'outcome.updated',
  PATTERN_COMPUTED: 'pattern.computed',
};

const OUTCOME_STATUSES = ['pending', 'ghosted', 'rejected', 'interview', 'offer'];

const RATE_LIMITS = {
  STANDARD: { windowMs: 60 * 1000, max: 100 },
  RESUME_UPLOAD: { windowMs: 60 * 1000, max: 10 },
};

module.exports = { QUEUE_NAMES, OUTCOME_STATUSES, RATE_LIMITS };
