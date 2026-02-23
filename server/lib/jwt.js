import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function signAuthToken(payload) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '7d' });
}

export function verifyAuthToken(token) {
  return jwt.verify(token, config.jwtSecret);
}
