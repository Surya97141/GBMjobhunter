require('dotenv').config();

if (!process.env.JWT_SECRET)          throw new Error('JWT_SECRET env var is required');
if (!process.env.USER_SERVICE_URL)    throw new Error('USER_SERVICE_URL env var is required');
if (!process.env.JOBS_SERVICE_URL)    throw new Error('JOBS_SERVICE_URL env var is required');
if (!process.env.OPPORTUNITY_SERVICE_URL) throw new Error('OPPORTUNITY_SERVICE_URL env var is required');
if (!process.env.REDIS_URL)           throw new Error('REDIS_URL env var is required');

const express = require('express');
const proxyRoutes = require('./src/routes/proxy.routes');

const app = express();

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/', proxyRoutes);

app.use((req, res) => {
  res.status(404).json({ status: 'error', message: 'Route not found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Gateway running on port ${PORT}`);
});
