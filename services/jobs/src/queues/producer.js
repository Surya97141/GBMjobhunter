const { Queue } = require('bullmq');

const connection = { url: process.env.REDIS_URL };

const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
};

const applicationLoggedQueue = new Queue('application.logged', { connection });
const outcomeUpdatedQueue     = new Queue('outcome.updated',    { connection });

async function publishApplicationLogged(payload) {
  await applicationLoggedQueue.add('application.logged', payload, JOB_OPTIONS);
}

async function publishOutcomeUpdated(payload) {
  await outcomeUpdatedQueue.add('outcome.updated', payload, JOB_OPTIONS);
}

module.exports = { publishApplicationLogged, publishOutcomeUpdated };
