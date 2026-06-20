// Manual trigger for Phase D verification — bypasses BullMQ, calls directly.
require('dotenv').config();
const { computeSkillImpactPatterns } = require('./src/services/skillImpact.service');

async function main() {
  console.log('[Trigger] Running computeSkillImpactPatterns...');
  const ids = await computeSkillImpactPatterns();
  console.log(`[Trigger] Done — ${ids.length} skill_impact patterns upserted`);
  process.exit(0);
}

main().catch(e => { console.error('[Trigger] FAILED:', e.message, e.stack); process.exit(1); });
