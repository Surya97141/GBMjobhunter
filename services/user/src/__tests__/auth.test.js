// Set required env vars BEFORE requiring the app — index.js validates them
// at module load time and throws if missing.
process.env.JWT_SECRET   = 'test-secret-for-jest';
process.env.DATABASE_URL = 'postgres://mock'; // pool is mocked; value is checked but never used

const request = require('supertest');
const app     = require('../../index');

// ── Mock the database layer ──────────────────────────────────────────────────
// We're testing the HTTP + business-logic layer (Zod validation, bcrypt, JWT).
// The database is mocked so tests run without a real PostgreSQL connection.
jest.mock('../../src/db/users.db', () => ({
  findUserByEmail: jest.fn(),
  createUser:      jest.fn(),
  findUserById:    jest.fn(),
  updateUserProfile: jest.fn(),
  saveResume:      jest.fn(),
  getResume:       jest.fn(),
}));

// Mock bcrypt so tests don't spend 500 ms per hash (12 salt rounds).
// The mock preserves the interface; real bcrypt semantics are covered by
// bcrypt's own test suite.
jest.mock('bcrypt', () => ({
  hash:    jest.fn().mockResolvedValue('$2b$12$mockhash'),
  compare: jest.fn(),
}));

const usersDb = require('../../src/db/users.db');
const bcrypt  = require('bcrypt');

// ────────────────────────────────────────────────────────────────────────────
describe('POST /auth/register', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 201 with user and token on valid input', async () => {
    usersDb.findUserByEmail.mockResolvedValue(null); // email not taken
    usersDb.createUser.mockResolvedValue({
      id:         'uuid-1',
      email:      'alice@example.com',
      created_at: new Date().toISOString(),
    });

    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'alice@example.com', password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe('alice@example.com');
    expect(res.body.data.token).toEqual(expect.any(String));
  });

  it('returns 409 when email is already registered', async () => {
    usersDb.findUserByEmail.mockResolvedValue({ id: 'existing', email: 'taken@example.com' });

    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'taken@example.com', password: 'password123' });

    expect(res.status).toBe(409);
    expect(res.body.status).toBe('error');
  });

  it('returns 400 when email format is invalid', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'not-an-email', password: 'password123' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when password is shorter than 8 characters', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'valid@example.com', password: 'short' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when body is empty', async () => {
    const res = await request(app).post('/auth/register').send({});
    expect(res.status).toBe(400);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('POST /auth/login', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 200 with user (no hashed_password) and token on valid credentials', async () => {
    usersDb.findUserByEmail.mockResolvedValue({
      id:              'uuid-1',
      email:           'alice@example.com',
      hashed_password: '$2b$12$mockhash',
      created_at:      new Date().toISOString(),
    });
    bcrypt.compare.mockResolvedValue(true);

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'alice@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('alice@example.com');
    expect(res.body.data.token).toEqual(expect.any(String));

    // hashed_password must NEVER be returned to the client
    expect(res.body.data.user.hashed_password).toBeUndefined();
  });

  it('returns 401 when password is incorrect', async () => {
    usersDb.findUserByEmail.mockResolvedValue({
      id: 'uuid-1', email: 'alice@example.com', hashed_password: 'hash',
    });
    bcrypt.compare.mockResolvedValue(false);

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'alice@example.com', password: 'wrong-password' });

    expect(res.status).toBe(401);
  });

  it('returns 401 when user does not exist', async () => {
    usersDb.findUserByEmail.mockResolvedValue(null);
    bcrypt.compare.mockResolvedValue(false);

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: 'any-password' });

    expect(res.status).toBe(401);
    // Error message must not reveal whether email or password was wrong —
    // a generic message prevents user enumeration attacks.
    expect(res.body.message).toBe('Invalid email or password');
  });

  it('returns 400 when password is missing from body', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'alice@example.com' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when body is empty', async () => {
    const res = await request(app).post('/auth/login').send({});
    expect(res.status).toBe(400);
  });
});
