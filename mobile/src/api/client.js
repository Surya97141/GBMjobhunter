import axios from 'axios';
import { getToken } from '../utils/storage';

// EXPO_PUBLIC_API_URL is set at build time for production releases.
// For local dev on a simulator, localhost works. On a physical device,
// set EXPO_PUBLIC_API_URL to your machine's LAN IP or the deployed gateway URL.
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

const client = axios.create({ baseURL: API_BASE, timeout: 10_000 });

// Attach the auth token to every request automatically
client.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default client;
