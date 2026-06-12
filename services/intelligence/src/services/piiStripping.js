const crypto = require('crypto');

function buildSkillCluster(resumeJson) {
  if (!resumeJson || !Array.isArray(resumeJson.skills)) return 'unknown';
  const top = resumeJson.skills
    .slice(0, 5)
    .map(s => String(s).toLowerCase().trim().replace(/\s+/g, '_'))
    .sort();
  return top.join('.');
}

function anonymiseCohortId(skillCluster, jdFingerprintHash) {
  return crypto
    .createHash('sha256')
    .update(`${skillCluster}:${jdFingerprintHash}`)
    .digest('hex')
    .slice(0, 16);
}

function stripPii(event, resumeJson) {
  const skillCluster       = buildSkillCluster(resumeJson);
  const anonymisedCohortId = anonymiseCohortId(skillCluster, event.jdFingerprintHash);

  return {
    applicationId:      event.applicationId,
    anonymisedCohortId,
    skillCluster,
    atsScore:           event.atsScoreAtApply,
    atsPlatform:        'unknown',
    outcome:            'pending',
    responseDays:       null,
    appliedAt:          event.appliedAt,
  };
}

module.exports = { buildSkillCluster, anonymiseCohortId, stripPii };
