const crypto = require('crypto');

const SENIORITY_PATTERNS = {
  junior:    /\b(junior|jr\.?|entry[\s-]level|graduate|intern|0[\s-]?[–-][\s-]?[12][\s-]?year)\b/i,
  mid:       /\b(mid[\s-]level|mid[\s-]senior|[23][\s-]?[–-][\s-]?[45][\s-]?year)\b/i,
  senior:    /\b(senior|sr\.?|lead|principal|staff|[5-9]\+?[\s-]?year|10\+[\s-]?year)\b/i,
  manager:   /\b(manager|director|head of|vp|vice president)\b/i,
};

const ATS_PLATFORMS = {
  greenhouse:  /greenhouse\.io|boards\.greenhouse/i,
  workday:     /workday\.com|myworkdayjobs/i,
  lever:       /lever\.co|jobs\.lever/i,
  icims:       /icims\.com/i,
  taleo:       /taleo\.net/i,
  smartrecruiters: /smartrecruiters\.com/i,
};

function detectSeniority(text) {
  for (const [level, pattern] of Object.entries(SENIORITY_PATTERNS)) {
    if (pattern.test(text)) return level;
  }
  return 'unspecified';
}

function detectAtsPlatform(pageUrl = '') {
  for (const [platform, pattern] of Object.entries(ATS_PLATFORMS)) {
    if (pattern.test(pageUrl)) return platform;
  }
  return 'unknown';
}

function hashJD(jdText) {
  return crypto
    .createHash('sha256')
    .update(jdText.trim().toLowerCase())
    .digest('hex')
    .slice(0, 16);
}

function fingerprintJD(jdText, pageUrl = '') {
  return {
    hash:       hashJD(jdText),
    seniority:  detectSeniority(jdText),
    atsPlatform: detectAtsPlatform(pageUrl),
  };
}

module.exports = { fingerprintJD };
