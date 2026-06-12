const { v4: uuidv4 } = require('uuid');
const { scoreResumeAgainstJD } = require('../utils/tfidf');
const { fingerprintJD }        = require('../utils/fingerprint');
const applicationsDb           = require('../db/applications.db');
const companiesDb              = require('../db/companies.db');
const usersDb                  = require('../db/users.db');
const { publishApplicationLogged, publishOutcomeUpdated } = require('../queues/producer');

async function logApplication(userId, { companyName, roleTitle, jdText, pageUrl }) {
  const resumeJson = await usersDb.getResumeByUserId(userId);
  const atsScore   = resumeJson ? scoreResumeAgainstJD(resumeJson, jdText) : null;

  const { hash, seniority, atsPlatform } = fingerprintJD(jdText, pageUrl);

  const company = await companiesDb.findOrCreateCompany(companyName, atsPlatform);

  const id          = uuidv4();
  const application = await applicationsDb.createApplication({
    id,
    userId,
    companyId:         company.id,
    roleTitle,
    jdFingerprintHash: hash,
    atsScoreAtApply:   atsScore,
  });

  await publishApplicationLogged({
    applicationId:    application.id,
    userId,
    companyId:        company.id,
    jdFingerprintHash: hash,
    atsScoreAtApply:   atsScore,
    appliedAt:        application.applied_at,
  });

  return { application, atsScore, seniority };
}

async function getUserApplications(userId) {
  return applicationsDb.getApplicationsByUserId(userId);
}

async function updateOutcome(applicationId, userId, outcome, responseDays) {
  const application = await applicationsDb.updateOutcome(
    applicationId,
    userId,
    outcome,
    responseDays ?? null
  );

  if (!application) {
    const err = new Error('Application not found');
    err.statusCode = 404;
    throw err;
  }

  await publishOutcomeUpdated({
    applicationId:      application.id,
    anonymisedCohortId: application.jd_fingerprint_hash,
    outcome:            application.outcome,
    responseDays:       application.response_days,
  });

  return application;
}

module.exports = { logApplication, getUserApplications, updateOutcome };
