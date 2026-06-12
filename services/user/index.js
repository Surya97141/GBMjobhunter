require('dotenv').config();

if (!process.env.JWT_SECRET)  throw new Error('JWT_SECRET env var is required');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL env var is required');

const express = require('express');
const authRoutes = require('./src/routes/auth.routes');
const userRoutes = require('./src/routes/user.routes');

const app = express();
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/users', userRoutes);

app.use((req, res) => {
  res.status(404).json({ status: 'error', message: 'Route not found' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`User Service running on port ${PORT}`);
});
