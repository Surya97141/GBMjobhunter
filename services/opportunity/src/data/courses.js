// Each skill maps to an array of courses
// free: true = no payment required at all
// url: verify these are current before shipping to production

const COURSES = {
  'javascript': [
    { title: 'The Modern JavaScript Tutorial', platform: 'javascript.info', free: true, url: 'https://javascript.info' },
    { title: 'JavaScript Algorithms and Data Structures', platform: 'freeCodeCamp', free: true, url: 'https://www.freecodecamp.org/learn/javascript-algorithms-and-data-structures/' },
    { title: 'The Complete JavaScript Course 2024', platform: 'Udemy', free: false, url: 'https://www.udemy.com/course/the-complete-javascript-course/' },
  ],
  'typescript': [
    { title: 'TypeScript Handbook', platform: 'typescriptlang.org', free: true, url: 'https://www.typescriptlang.org/docs/handbook/intro.html' },
    { title: 'Total TypeScript', platform: 'Total TypeScript', free: false, url: 'https://www.totaltypescript.com' },
    { title: 'TypeScript Course for Beginners', platform: 'YouTube / Academind', free: true, url: 'https://www.youtube.com/watch?v=BwuLxPH8IDs' },
  ],
  'node.js': [
    { title: 'The Complete Node.js Developer Course', platform: 'Udemy', free: false, url: 'https://www.udemy.com/course/the-complete-nodejs-developer-course-2/' },
    { title: 'Node.js Official Docs', platform: 'nodejs.org', free: true, url: 'https://nodejs.org/en/learn/getting-started/introduction-to-nodejs' },
    { title: 'Node.js Full Course', platform: 'YouTube / freeCodeCamp', free: true, url: 'https://www.youtube.com/watch?v=Oe421EPjeBE' },
  ],
  'react': [
    { title: 'React Official Docs (react.dev)', platform: 'react.dev', free: true, url: 'https://react.dev/learn' },
    { title: 'The Ultimate React Course', platform: 'Udemy / Jonas Schmedtmann', free: false, url: 'https://www.udemy.com/course/the-ultimate-react-course/' },
    { title: 'React Course', platform: 'freeCodeCamp', free: true, url: 'https://www.freecodecamp.org/learn/front-end-development-libraries/' },
  ],
  'python': [
    { title: 'Python.org Official Tutorial', platform: 'python.org', free: true, url: 'https://docs.python.org/3/tutorial/' },
    { title: 'Automate the Boring Stuff with Python', platform: 'automatetheboringstuff.com', free: true, url: 'https://automatetheboringstuff.com' },
    { title: 'Complete Python Bootcamp', platform: 'Udemy', free: false, url: 'https://www.udemy.com/course/complete-python-bootcamp/' },
  ],
  'postgresql': [
    { title: 'PostgreSQL Official Tutorial', platform: 'postgresql.org', free: true, url: 'https://www.postgresql.org/docs/current/tutorial.html' },
    { title: 'Learn PostgreSQL', platform: 'YouTube / freeCodeCamp', free: true, url: 'https://www.youtube.com/watch?v=qw--VYLpxG4' },
    { title: 'SQL and PostgreSQL: The Complete Developer\'s Guide', platform: 'Udemy', free: false, url: 'https://www.udemy.com/course/sql-and-postgresql/' },
  ],
  'docker': [
    { title: 'Docker Official Get Started', platform: 'docs.docker.com', free: true, url: 'https://docs.docker.com/get-started/' },
    { title: 'Docker and Kubernetes: The Complete Guide', platform: 'Udemy', free: false, url: 'https://www.udemy.com/course/docker-and-kubernetes-the-complete-guide/' },
    { title: 'Docker Tutorial for Beginners', platform: 'YouTube / TechWorld with Nana', free: true, url: 'https://www.youtube.com/watch?v=3c-iBn73dDE' },
  ],
  'kubernetes': [
    { title: 'Kubernetes Official Docs', platform: 'kubernetes.io', free: true, url: 'https://kubernetes.io/docs/tutorials/' },
    { title: 'Kubernetes for Beginners', platform: 'YouTube / TechWorld with Nana', free: true, url: 'https://www.youtube.com/watch?v=X48VuDVv0do' },
    { title: 'Certified Kubernetes Administrator (CKA)', platform: 'Udemy / Mumshad', free: false, url: 'https://www.udemy.com/course/certified-kubernetes-administrator-with-practice-tests/' },
  ],
  'redis': [
    { title: 'Redis University (RU101)', platform: 'Redis University', free: true, url: 'https://university.redis.com/courses/ru101/' },
    { title: 'Redis Official Docs', platform: 'redis.io', free: true, url: 'https://redis.io/docs/latest/get-started/' },
  ],
  'system-design': [
    { title: 'System Design Primer', platform: 'GitHub', free: true, url: 'https://github.com/donnemartin/system-design-primer' },
    { title: 'Grokking the System Design Interview', platform: 'Educative', free: false, url: 'https://www.educative.io/courses/grokking-modern-system-design-interview-for-engineers-managers' },
    { title: 'System Design Interview – An Insider\'s Guide', platform: 'Book', free: false, url: 'https://www.amazon.com/System-Design-Interview-insiders-Second/dp/B08CMF2CQF' },
  ],
  'data-structures-algorithms': [
    { title: 'NeetCode 150', platform: 'neetcode.io', free: true, url: 'https://neetcode.io/practice' },
    { title: 'The Algorithms - Open Source Resource', platform: 'GitHub', free: true, url: 'https://the-algorithms.com' },
    { title: 'JavaScript Algorithms and Data Structures Masterclass', platform: 'Udemy / Colt Steele', free: false, url: 'https://www.udemy.com/course/js-algorithms-and-data-structures-masterclass/' },
  ],
  'react-native': [
    { title: 'React Native Official Docs', platform: 'reactnative.dev', free: true, url: 'https://reactnative.dev/docs/getting-started' },
    { title: 'The Complete React Native + Hooks Course', platform: 'Udemy', free: false, url: 'https://www.udemy.com/course/the-complete-react-native-and-redux-course/' },
  ],
  'machine-learning': [
    { title: 'Machine Learning Specialization', platform: 'Coursera / Andrew Ng', free: false, url: 'https://www.coursera.org/specializations/machine-learning-introduction' },
    { title: 'fast.ai Practical Deep Learning', platform: 'fast.ai', free: true, url: 'https://course.fast.ai' },
  ],
  'git': [
    { title: 'Pro Git Book', platform: 'git-scm.com', free: true, url: 'https://git-scm.com/book/en/v2' },
    { title: 'Learn Git Branching', platform: 'learngitbranching.js.org', free: true, url: 'https://learngitbranching.js.org' },
  ],
  'github-actions': [
    { title: 'GitHub Actions Official Docs', platform: 'docs.github.com', free: true, url: 'https://docs.github.com/en/actions' },
    { title: 'GitHub Actions - The Complete Guide', platform: 'Udemy', free: false, url: 'https://www.udemy.com/course/github-actions-the-complete-guide/' },
  ],
  'kafka': [
    { title: 'Apache Kafka Documentation', platform: 'kafka.apache.org', free: true, url: 'https://kafka.apache.org/documentation/' },
    { title: 'Apache Kafka Series - Learn Apache Kafka for Beginners', platform: 'Udemy / Stephane Maarek', free: false, url: 'https://www.udemy.com/course/apache-kafka/' },
  ],
  'sql': [
    { title: 'SQLZoo', platform: 'sqlzoo.net', free: true, url: 'https://sqlzoo.net' },
    { title: 'Mode SQL Tutorial', platform: 'mode.com', free: true, url: 'https://mode.com/sql-tutorial/' },
  ],
};

module.exports = { COURSES };
