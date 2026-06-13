require('dotenv').config();

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL env var is required');
if (!process.env.REDIS_URL)    throw new Error('REDIS_URL env var is required');

const express = require('express');
const applicationRoutes = require('./src/routes/applications.routes');
const jobRoutes         = require('./src/routes/jobs.routes');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/applications', applicationRoutes);
app.use('/jobs',         jobRoutes);

app.use((req, res) => {
  res.status(404).json({ status: 'error', message: 'Route not found' });
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3002;
  app.listen(PORT, () => {
    console.log(`Jobs Service running on port ${PORT}`);
  });
}
