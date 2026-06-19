import axios from 'axios';
import { getToken } from '../utils/storage';

// On a physical device, localhost won't reach your dev machine.
// Replace with your machine's LAN IP (e.g. http://192.168.1.42:8080) when
// testing on a real device, or keep localhost for Expo Go on a simulator.
const API_BASE = 'http://localhost:3000';

const client = axios.create({ baseURL: API_BASE, timeout: 10_000 });

// Attach the auth token to every request automatically
client.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default client;
