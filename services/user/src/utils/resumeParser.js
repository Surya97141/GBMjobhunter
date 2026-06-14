// Skill entries: [displayName, regex]
// The regex matches the skill name in raw PDF text.
const SKILL_LIST = [
  // Languages
  ['JavaScript',    /\bjavascript\b/i],
  ['TypeScript',    /\btypescript\b/i],
  ['Python',        /\bpython\b/i],
  ['Java',          /\bjava\b(?!script)/i],
  ['C++',           /\bc\+\+\b/i],
  ['C#',            /\bc#\b/i],
  ['Go',            /\bgolang\b|\bgo\b(?=\s+(?:lang|programming|developer))/i],
  ['Rust',          /\brust\b/i],
  ['Ruby',          /\bruby\b/i],
  ['PHP',           /\bphp\b/i],
  ['Swift',         /\bswift\b/i],
  ['Kotlin',        /\bkotlin\b/i],
  ['Scala',         /\bscala\b/i],
  ['R',             /\bR\b(?=\s+(?:programming|language|studio))/],
  ['Bash',          /\bbash\b|\bshell\s+scripting\b/i],
  ['SQL',           /\bsql\b/i],
  // Frontend
  ['React',         /\breact\.?js\b|\breact\b/i],
  ['Vue',           /\bvue\.?js\b|\bvue\b/i],
  ['Angular',       /\bangular\b/i],
  ['Svelte',        /\bsvelte\b/i],
  ['Next.js',       /\bnext\.js\b|\bnextjs\b/i],
  ['HTML',          /\bhtml\b/i],
  ['CSS',           /\bcss\b/i],
  ['Tailwind',      /\btailwind\b/i],
  ['Bootstrap',     /\bbootstrap\b/i],
  ['Webpack',       /\bwebpack\b/i],
  ['Vite',          /\bvite\b/i],
  ['SASS',          /\bsass\b|\bscss\b/i],
  // Backend
  ['Node.js',       /\bnode\.?js\b/i],
  ['Express',       /\bexpress\.?js\b|\bexpress\b/i],
  ['Django',        /\bdjango\b/i],
  ['Flask',         /\bflask\b/i],
  ['FastAPI',       /\bfastapi\b/i],
  ['Spring',        /\bspring\s*(?:boot|framework)?\b/i],
  ['Laravel',       /\blaravel\b/i],
  ['Rails',         /\bruby\s+on\s+rails\b|\brails\b/i],
  ['GraphQL',       /\bgraphql\b/i],
  ['REST API',      /\brest\s*(?:ful)?\s*api\b/i],
  ['gRPC',          /\bgrpc\b/i],
  // Databases
  ['PostgreSQL',    /\bpostgresql\b|\bpostgres\b/i],
  ['MySQL',         /\bmysql\b/i],
  ['MongoDB',       /\bmongodb\b|\bmongo\b/i],
  ['Redis',         /\bredis\b/i],
  ['SQLite',        /\bsqlite\b/i],
  ['DynamoDB',      /\bdynamodb\b/i],
  ['Elasticsearch', /\belasticsearch\b/i],
  ['ClickHouse',    /\bclickhouse\b/i],
  ['Cassandra',     /\bcassandra\b/i],
  // Cloud & DevOps
  ['AWS',           /\baws\b|\bamazon\s+web\s+services\b/i],
  ['GCP',           /\bgcp\b|\bgoogle\s+cloud\b/i],
  ['Azure',         /\bazure\b/i],
  ['Docker',        /\bdocker\b/i],
  ['Kubernetes',    /\bkubernetes\b|\bk8s\b/i],
  ['Terraform',     /\bterraform\b/i],
  ['CI/CD',         /\bci\/cd\b|\bci-cd\b|\bcontinuous\s+integration\b/i],
  ['GitHub Actions',/\bgithub\s+actions\b/i],
  ['Jenkins',       /\bjenkins\b/i],
  ['Linux',         /\blinux\b|\bubuntu\b|\bdebian\b/i],
  ['Nginx',         /\bnginx\b/i],
  // Data & ML
  ['Machine Learning', /\bmachine\s+learning\b/i],
  ['Deep Learning',    /\bdeep\s+learning\b/i],
  ['TensorFlow',       /\btensorflow\b/i],
  ['PyTorch',          /\bpytorch\b/i],
  ['Pandas',           /\bpandas\b/i],
  ['NumPy',            /\bnumpy\b/i],
  ['scikit-learn',     /\bscikit[\s-]learn\b/i],
  ['Spark',            /\bapache\s+spark\b|\bspark\b/i],
  ['Hadoop',           /\bhadoop\b/i],
  ['Tableau',          /\btableau\b/i],
  ['Power BI',         /\bpower\s+bi\b/i],
  // Tools
  ['Git',              /\bgit\b/i],
  ['Jira',             /\bjira\b/i],
  ['Figma',            /\bfigma\b/i],
  ['Postman',          /\bpostman\b/i],
  ['VS Code',          /\bvs\s*code\b|\bvisual\s+studio\s+code\b/i],
  ['Agile',            /\bagile\b/i],
  ['Scrum',            /\bscrum\b/i],
  ['Microservices',    /\bmicroservices\b/i],
  ['BullMQ',           /\bbullmq\b/i],
  ['RabbitMQ',         /\brabbitmq\b/i],
  ['Kafka',            /\bkafka\b/i],
];

// Month names for date range detection
const MONTH_RE = /(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)/i;
const DATE_RANGE_RE = new RegExp(
  `(?:${MONTH_RE.source}\\s+)?\\d{4}\\s*[-–—]\\s*(?:${MONTH_RE.source}\\s+)?(?:\\d{4}|present|current|now)`,
  'i'
);

const SECTION_RE = /^(work\s+experience|experience|employment(\s+history)?|professional\s+experience|work\s+history|education|academic|skills?|certifications?|projects?|awards?|achievements?|summary|objective|profile)\s*:?\s*$/i;

const EDUCATION_SECTION_RE = /^(education|academic|qualifications?)\s*:?\s*$/i;
const EXPERIENCE_SECTION_RE = /^(work\s+experience|experience|employment(\s+history)?|professional\s+experience|work\s+history)\s*:?\s*$/i;
const SKILLS_SECTION_RE = /^(technical\s+skills?|skills?|competencies|technologies)\s*:?\s*$/i;

const DEGREE_RE = /\b(?:b\.?tech|b\.?e\.?|b\.?sc|b\.?com|bca|bba|b\.?a\.?|m\.?tech|m\.?sc|mca|mba|m\.?a\.?|ph\.?d|bachelor(?:'s)?|master(?:'s)?|doctorate|diploma|associate)\b/i;
const INSTITUTION_RE = /\b(?:university|college|institute|school|academy|iit|nit|bits|iiit|vit)\b/i;

function extractSkills(text) {
  const found = [];
  for (const [name, regex] of SKILL_LIST) {
    if (regex.test(text)) {
      found.push(name);
    }
  }
  return found;
}

function splitSections(lines) {
  const sections = {};
  let current = 'header';
  sections[current] = [];

  for (const line of lines) {
    if (SECTION_RE.test(line.trim())) {
      current = line.trim().toLowerCase().replace(/\s+/g, '_').replace(/:$/, '');
      if (!sections[current]) sections[current] = [];
    } else {
      sections[current].push(line);
    }
  }
  return sections;
}

function extractWorkExperience(lines) {
  const experiences = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (DATE_RANGE_RE.test(line)) {
      // This line contains a date range — it's likely a job entry
      const dateStr = (line.match(DATE_RANGE_RE) || [''])[0];
      // Look back up to 3 lines for role/company info
      const contextLines = [];
      for (let j = Math.max(0, i - 3); j < i; j++) {
        if (lines[j].trim().length > 2) contextLines.push(lines[j].trim());
      }
      // Look forward for description (next 5 non-empty lines before next date)
      const descLines = [];
      let j = i + 1;
      while (j < lines.length && j < i + 8) {
        const next = lines[j].trim();
        if (DATE_RANGE_RE.test(next)) break;
        if (next.length > 2) descLines.push(next);
        j++;
      }

      const role    = contextLines[contextLines.length - 1] || '';
      const company = contextLines[contextLines.length - 2] || '';

      experiences.push({
        role:        role.replace(/at\s+.+$/i, '').trim(),
        company:     company,
        startDate:   dateStr.split(/[-–—]/)[0].trim(),
        endDate:     dateStr.split(/[-–—]/)[1]?.trim() || '',
        description: descLines.join(' ').slice(0, 400),
      });
    }

    i++;
  }

  // Deduplicate by role+company
  const seen = new Set();
  return experiences.filter(e => {
    const key = `${e.role}|${e.company}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return e.role.length > 0 || e.company.length > 0;
  });
}

function extractEducation(lines) {
  const education = [];
  const fullText  = lines.join(' ');

  // Find lines that mention a degree
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (DEGREE_RE.test(line)) {
      // Look for institution in same line or ±2 lines
      let institution = '';
      const window = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 3));
      for (const l of window) {
        if (INSTITUTION_RE.test(l)) {
          institution = l.trim();
          break;
        }
      }

      // Extract year from surrounding text
      const yearMatch = line.match(/\b(19|20)\d{2}\b/) ||
        (lines[i + 1] || '').match(/\b(19|20)\d{2}\b/);

      education.push({
        degree:      line.trim(),
        institution: institution,
        year:        yearMatch ? parseInt(yearMatch[0], 10) : undefined,
      });
    }
  }

  // Deduplicate
  const seen = new Set();
  return education.filter(e => {
    const key = e.degree;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resumeQualityScore(parsed) {
  let score = 0;

  // Skills: 2 pts each, max 40
  score += Math.min(40, parsed.skills.length * 2);

  // Work experience: 15 pts each, max 30
  score += Math.min(30, parsed.workExperience.length * 15);

  // Education: 15 pts for any
  if (parsed.education.length > 0) score += 15;

  // Text richness: up to 15 pts
  const len = parsed.raw_text.length;
  if (len > 2000) score += 15;
  else if (len > 1000) score += 10;
  else if (len > 300) score += 5;

  return Math.min(100, score);
}

function parseResumeText(rawText) {
  const lines = rawText
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(l => l.length > 0);

  const skills        = extractSkills(rawText);
  const workExperience = extractWorkExperience(lines);
  const education     = extractEducation(lines);

  return { skills, workExperience, education, raw_text: rawText };
}

module.exports = { parseResumeText, resumeQualityScore };
