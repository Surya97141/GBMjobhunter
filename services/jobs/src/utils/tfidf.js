const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'can', 'that', 'this',
  'these', 'those', 'it', 'its', 'we', 'you', 'he', 'she', 'they',
  'their', 'your', 'our', 'not', 'no', 'so', 'than', 'too', 'very',
  'just', 'as', 'if', 'all', 'also', 'into', 'about', 'any', 'such',
  'each', 'only', 'over', 'new', 'other', 'up', 'out', 'more', 'most',
  'between', 'after', 'before', 'both', 'through', 'well', 'including',
  'while', 'work', 'experience', 'team', 'role', 'position', 'company',
  'candidate', 'join', 'looking', 'seeking', 'opportunity', 'please',
  'ability', 'strong', 'good', 'excellent', 'great',
]);

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

function termFrequencies(tokens) {
  const freq = {};
  for (const token of tokens) {
    freq[token] = (freq[token] || 0) + 1;
  }
  return freq;
}

function flattenResume(resumeJson) {
  const parts = [];

  if (Array.isArray(resumeJson.skills)) {
    parts.push(resumeJson.skills.join(' '));
  }

  if (Array.isArray(resumeJson.workExperience)) {
    for (const job of resumeJson.workExperience) {
      parts.push(job.role || '');
      parts.push(job.description || '');
    }
  }

  if (Array.isArray(resumeJson.education)) {
    for (const edu of resumeJson.education) {
      parts.push(edu.degree || '');
      parts.push(edu.institution || '');
    }
  }

  return parts.join(' ');
}

function scoreResumeAgainstJD(resumeJson, jdText) {
  if (!resumeJson || !jdText) return 0;

  const resumeText  = flattenResume(resumeJson);
  const resumeTerms = new Set(tokenize(resumeText));
  const jdTokens    = tokenize(jdText);
  const jdFreq      = termFrequencies(jdTokens);
  const jdTerms     = Object.entries(jdFreq);

  const totalWeight = jdTerms.reduce((sum, [, freq]) => sum + freq, 0);
  if (totalWeight === 0) return 0;

  const matchedWeight = jdTerms
    .filter(([term]) => resumeTerms.has(term))
    .reduce((sum, [, freq]) => sum + freq, 0);

  return Math.round((matchedWeight / totalWeight) * 100);
}

module.exports = { scoreResumeAgainstJD };
