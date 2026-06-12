const { Queue } = require('bullmq');

const connection = { url: process.env.REDIS_URL };

async function setupNightlySchedule() {
  const queue = new Queue('nightly-computation', { connection });

  await queue.upsertJobScheduler(
    'nightly-pattern-computation',
    { pattern: '0 2 * * *' },
    {
      name: 'nightly-pattern-computation',
      data: {},
      opts: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail:     50,
      },
    }
  );

  console.log('[Scheduler] Nightly pattern computation scheduled at 02:00');
  await queue.close();
}

module.exports = { setupNightlySchedule };
