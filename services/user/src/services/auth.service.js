const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const usersDb = require('../db/users.db');

const SALT_ROUNDS = 12;
const TOKEN_TTL = '24h';

async function register(email, password) {
  const existing = await usersDb.findUserByEmail(email);
  if (existing) {
    const err = new Error('Email already registered');
    err.statusCode = 409;
    throw err;
  }

  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
  const id = uuidv4();
  const user = await usersDb.createUser({ id, email, hashedPassword });
  const token = issueToken(user.id, user.email);

  return { user, token };
}

async function login(email, password) {
  const user = await usersDb.findUserByEmail(email);

  if (!user || !(await bcrypt.compare(password, user.hashed_password))) {
    const err = new Error('Invalid email or password');
    err.statusCode = 401;
    throw err;
  }

  const token = issueToken(user.id, user.email);
  const { hashed_password: _, ...safeUser } = user;
  return { user: safeUser, token };
}

function issueToken(userId, email) {
  return jwt.sign(
    { sub: userId, email },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

module.exports = { register, login };
