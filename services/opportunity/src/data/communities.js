// platform: 'discord' | 'slack' | 'forum'
// tags: used to match against user skills and interests
// joinUrl: verify these are active invite links before shipping

const COMMUNITIES = [
  {
    name: 'Reactiflux',
    platform: 'discord',
    description: 'The largest React community on Discord. Covers React, React Native, Next.js, and the broader ecosystem.',
    tags: ['react', 'react-native', 'next.js', 'javascript', 'frontend'],
    joinUrl: 'https://www.reactiflux.com',
  },
  {
    name: 'Nodeiflux',
    platform: 'discord',
    description: 'Node.js community covering Express, NestJS, backend architecture, and npm ecosystem.',
    tags: ['node.js', 'express', 'nest.js', 'javascript', 'backend'],
    joinUrl: 'https://discord.gg/vUsrbjd',
  },
  {
    name: 'Python Discord',
    platform: 'discord',
    description: 'Large Python community spanning beginner help, web dev (Django, FastAPI), data science, and ML.',
    tags: ['python', 'django', 'fastapi', 'data-science', 'machine-learning'],
    joinUrl: 'https://pythondiscord.com',
  },
  {
    name: 'DevOps, Cloud, SRE Community',
    platform: 'discord',
    description: 'Covers Docker, Kubernetes, CI/CD, cloud providers, and infrastructure as code.',
    tags: ['docker', 'kubernetes', 'github-actions', 'devops', 'linux-basics'],
    joinUrl: 'https://discord.gg/devops',
  },
  {
    name: 'The Programmer\'s Hangout',
    platform: 'discord',
    description: 'General programming community with channels for most languages and career advice.',
    tags: ['javascript', 'python', 'sql', 'git', 'data-structures-algorithms', 'system-design'],
    joinUrl: 'https://discord.gg/programming',
  },
  {
    name: 'Machine Learning',
    platform: 'discord',
    description: 'ML and AI practitioners discussing papers, tools, frameworks, and career paths.',
    tags: ['machine-learning', 'deep-learning', 'data-science', 'python'],
    joinUrl: 'https://discord.gg/machine-learning',
  },
  {
    name: 'TypeScript Community',
    platform: 'discord',
    description: 'TypeScript-focused community covering advanced types, tooling, and TS ecosystem libraries.',
    tags: ['typescript', 'javascript', 'node.js', 'react'],
    joinUrl: 'https://discord.gg/typescript',
  },
  {
    name: 'Postgres Slack',
    platform: 'slack',
    description: 'Official PostgreSQL community Slack. Good for query optimisation, extension development, and production issues.',
    tags: ['postgresql', 'sql', 'query-optimisation', 'database-indexing'],
    joinUrl: 'https://postgres-slack.herokuapp.com',
  },
  {
    name: 'Kubernetes Slack',
    platform: 'slack',
    description: 'Official Kubernetes community with channels for beginners, SIG groups, and specific distributions.',
    tags: ['kubernetes', 'docker', 'devops', 'microservices'],
    joinUrl: 'https://slack.k8s.io',
  },
  {
    name: 'Redis Discord',
    platform: 'discord',
    description: 'Redis community covering caching strategies, BullMQ, pub/sub, and data modelling.',
    tags: ['redis', 'bullmq', 'caching-strategies', 'node.js'],
    joinUrl: 'https://discord.gg/redis',
  },
];

module.exports = { COMMUNITIES };
