import axios from 'axios';

const client = axios.create({
  baseURL: 'http://localhost:3000',
  timeout: 10_000,
});

// Attach JWT from localStorage on every request.
// Reading from localStorage here (not from context) avoids circular imports.
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('gbm_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default client;
