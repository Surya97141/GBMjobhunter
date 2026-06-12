// Each entry: { prerequisites: string[], next: string[], level, domain }
// prerequisites = skills needed before this one makes sense to learn
// next          = skills this one unlocks
// level         = foundational | intermediate | advanced
// domain        = backend | frontend | data | devops | mobile | general

const SKILL_GRAPH = {
  // ── General foundations ────────────────────────────────────────────────────
  'git': {
    prerequisites: [],
    next: ['github-actions', 'monorepo'],
    level: 'foundational', domain: 'general',
  },
  'linux-basics': {
    prerequisites: [],
    next: ['bash-scripting', 'docker', 'networking'],
    level: 'foundational', domain: 'devops',
  },
  'data-structures-algorithms': {
    prerequisites: [],
    next: ['system-design'],
    level: 'foundational', domain: 'general',
  },
  'system-design': {
    prerequisites: ['data-structures-algorithms'],
    next: ['microservices', 'kafka'],
    level: 'advanced', domain: 'general',
  },

  // ── Backend ────────────────────────────────────────────────────────────────
  'javascript': {
    prerequisites: [],
    next: ['node.js', 'typescript', 'react'],
    level: 'foundational', domain: 'backend',
  },
  'typescript': {
    prerequisites: ['javascript'],
    next: ['nest.js', 'react'],
    level: 'intermediate', domain: 'backend',
  },
  'node.js': {
    prerequisites: ['javascript'],
    next: ['express', 'nest.js', 'bullmq', 'jwt-auth'],
    level: 'intermediate', domain: 'backend',
  },
  'express': {
    prerequisites: ['node.js'],
    next: ['rest-api-design', 'jwt-auth', 'nest.js'],
    level: 'intermediate', domain: 'backend',
  },
  'nest.js': {
    prerequisites: ['express', 'typescript'],
    next: ['microservices', 'graphql'],
    level: 'advanced', domain: 'backend',
  },
  'rest-api-design': {
    prerequisites: ['express'],
    next: ['graphql', 'openapi'],
    level: 'intermediate', domain: 'backend',
  },
  'jwt-auth': {
    prerequisites: ['node.js'],
    next: ['oauth2', 'session-management'],
    level: 'intermediate', domain: 'backend',
  },
  'python': {
    prerequisites: [],
    next: ['fastapi', 'django', 'data-science', 'machine-learning'],
    level: 'foundational', domain: 'backend',
  },
  'fastapi': {
    prerequisites: ['python'],
    next: ['microservices', 'celery'],
    level: 'intermediate', domain: 'backend',
  },
  'django': {
    prerequisites: ['python'],
    next: ['django-rest-framework', 'celery'],
    level: 'intermediate', domain: 'backend',
  },
  'microservices': {
    prerequisites: ['rest-api-design', 'docker'],
    next: ['kafka', 'kubernetes', 'service-mesh'],
    level: 'advanced', domain: 'backend',
  },
  'bullmq': {
    prerequisites: ['node.js', 'redis'],
    next: ['kafka'],
    level: 'intermediate', domain: 'backend',
  },
  'kafka': {
    prerequisites: ['microservices'],
    next: ['kafka-streams', 'flink'],
    level: 'advanced', domain: 'backend',
  },

  // ── Databases ──────────────────────────────────────────────────────────────
  'sql': {
    prerequisites: [],
    next: ['postgresql', 'mysql', 'query-optimisation'],
    level: 'foundational', domain: 'backend',
  },
  'postgresql': {
    prerequisites: ['sql'],
    next: ['query-optimisation', 'database-indexing', 'clickhouse'],
    level: 'intermediate', domain: 'backend',
  },
  'redis': {
    prerequisites: ['sql'],
    next: ['bullmq', 'caching-strategies'],
    level: 'intermediate', domain: 'backend',
  },
  'clickhouse': {
    prerequisites: ['postgresql', 'sql'],
    next: ['data-engineering'],
    level: 'advanced', domain: 'data',
  },
  'query-optimisation': {
    prerequisites: ['postgresql'],
    next: ['database-indexing', 'explain-analyse'],
    level: 'advanced', domain: 'backend',
  },

  // ── Frontend ───────────────────────────────────────────────────────────────
  'html-css': {
    prerequisites: [],
    next: ['javascript', 'tailwind'],
    level: 'foundational', domain: 'frontend',
  },
  'react': {
    prerequisites: ['javascript'],
    next: ['next.js', 'react-query', 'zustand', 'testing-react'],
    level: 'intermediate', domain: 'frontend',
  },
  'next.js': {
    prerequisites: ['react'],
    next: ['edge-functions', 'server-components'],
    level: 'advanced', domain: 'frontend',
  },
  'tailwind': {
    prerequisites: ['html-css'],
    next: ['design-systems'],
    level: 'intermediate', domain: 'frontend',
  },

  // ── DevOps / Infrastructure ────────────────────────────────────────────────
  'docker': {
    prerequisites: ['linux-basics'],
    next: ['docker-compose', 'kubernetes', 'microservices'],
    level: 'intermediate', domain: 'devops',
  },
  'docker-compose': {
    prerequisites: ['docker'],
    next: ['kubernetes'],
    level: 'intermediate', domain: 'devops',
  },
  'kubernetes': {
    prerequisites: ['docker'],
    next: ['helm', 'service-mesh', 'gitops'],
    level: 'advanced', domain: 'devops',
  },
  'github-actions': {
    prerequisites: ['git'],
    next: ['gitops', 'ci-cd-patterns'],
    level: 'intermediate', domain: 'devops',
  },

  // ── Data / ML ──────────────────────────────────────────────────────────────
  'data-science': {
    prerequisites: ['python', 'sql'],
    next: ['machine-learning', 'data-engineering'],
    level: 'intermediate', domain: 'data',
  },
  'machine-learning': {
    prerequisites: ['data-science', 'python'],
    next: ['deep-learning', 'mlops'],
    level: 'advanced', domain: 'data',
  },

  // ── Mobile ─────────────────────────────────────────────────────────────────
  'react-native': {
    prerequisites: ['react'],
    next: ['expo', 'mobile-testing'],
    level: 'intermediate', domain: 'mobile',
  },
  'expo': {
    prerequisites: ['react-native'],
    next: ['eas-build'],
    level: 'intermediate', domain: 'mobile',
  },
};

module.exports = { SKILL_GRAPH };
