const { Worker } = require('bullmq');
const usersDb               = require('../db/users.db');
const { stripPii }          = require('../services/piiStripping');
const { insertApplicationEvent, updateOutcomeInClickhouse } = require('../services/clickhouseWriter.service');
const { publishInsightsForPatterns } = require('../services/insightPublisher.service');
const { runNightlyComputation }      = require('../services/patternComputation.service');
const { computeSkillImpactPatterns } = require('../services/skillImpact.service');

const connection = { url: process.env.REDIS_URL };

const applicationLoggedWorker = new Worker(
  'application.logged',
  async (job) => {
    const event = job.data;
    const resumeJson = await usersDb.getResumeByUserId(event.userId);
    const stripped   = stripPii(event, resumeJson);
    await insertApplicationEvent(stripped);
    console.log(`[Consumer] application.logged processed: ${event.applicationId}`);
  },
  {
    connection,
    concurrency: 5,
  }
);

const outcomeUpdatedWorker = new Worker(
  'outcome.updated',
  async (job) => {
    const { applicationId, outcome, responseDays } = job.data;
    await updateOutcomeInClickhouse(applicationId, outcome, responseDays);
    console.log(`[Consumer] outcome.updated processed: ${applicationId}`);
  },
  {
    connection,
    concurrency: 5,
  }
);

const patternComputedWorker = new Worker(
  'pattern.computed',
  async (job) => {
    const { patternIds } = job.data;
    await publishInsightsForPatterns(patternIds);
  },
  { connection }
);

const nightlyJobWorker = new Worker(
  'nightly-computation',
  async (job) => {
    const patternIds = await runNightlyComputation();
    await computeSkillImpactPatterns();  // writes skill_impact rows to cohort_patterns

    const { Queue } = require('bullmq');
    const patternComputedQueue = new Queue('pattern.computed', { connection });
    await patternComputedQueue.add('pattern.computed', {
      patternIds,
      computedAt: new Date().toISOString(),
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
    await patternComputedQueue.close();
  },
  { connection }
);

applicationLoggedWorker.on('failed', (job, err) => {
  console.error(`[Consumer] application.logged job ${job?.id} failed:`, err.message);
});

outcomeUpdatedWorker.on('failed', (job, err) => {
  console.error(`[Consumer] outcome.updated job ${job?.id} failed:`, err.message);
});

patternComputedWorker.on('failed', (job, err) => {
  console.error(`[Consumer] pattern.computed job ${job?.id} failed:`, err.message);
});

nightlyJobWorker.on('failed', (job, err) => {
  console.error(`[Consumer] nightly-computation job ${job?.id} failed:`, err.message);
});

module.exports = {
  applicationLoggedWorker,
  outcomeUpdatedWorker,
  patternComputedWorker,
  nightlyJobWorker,
};
