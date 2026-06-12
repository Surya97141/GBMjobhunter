require('dotenv').config();

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL env var is required');

const express = require('express');
const opportunityRoutes = require('./src/routes/opportunities.routes');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/opportunities', opportunityRoutes);

app.use((req, res) => {
  res.status(404).json({ status: 'error', message: 'Route not found' });
});

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
  console.log(`Opportunity Service running on port ${PORT}`);
});
