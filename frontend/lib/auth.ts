import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { getDatabase } from './db';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-secret-key-change-this-in-production'
);

const SESSION_COOKIE_NAME = 'kpi_dashboard_session';
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface SessionData {
  companyId: number;
  companyName: string;
  accessKeyId: number;
  issuedAt: number;
  expiresAt: number;
}

/**
 * Validate an access key and return company information
 */
export async function validateAccessKey(accessKey: string): Promise<{
  companyId: number;
  companyName: string;
  accessKeyId: number;
} | null> {
  const db = getDatabase();

  const result = db.prepare(`
    SELECT
      ak.access_key_id,
      ak.company_id,
      ak.is_active,
      ak.expires_at,
      c.name as company_name
    FROM company_access_keys ak
    JOIN companies c ON ak.company_id = c.company_id
    WHERE ak.access_key = ?
  `).get(accessKey) as any;

  if (!result) {
    return null;
  }

  if (!result.is_active) {
    return null;
  }

  // Check expiration
  if (result.expires_at) {
    const expiresAt = new Date(result.expires_at);
    if (new Date() > expiresAt) {
      return null;
    }
  }

  // Update last_used_at
  db.prepare(`
    UPDATE company_access_keys
    SET last_used_at = datetime('now')
    WHERE access_key_id = ?
  `).run(result.access_key_id);

  return {
    companyId: result.company_id,
    companyName: result.company_name,
    accessKeyId: result.access_key_id,
  };
}

/**
 * Create a session JWT token
 */
export async function createSession(sessionData: Omit<SessionData, 'issuedAt' | 'expiresAt'>): Promise<string> {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + SESSION_DURATION;

  const token = await new SignJWT({
    ...sessionData,
    issuedAt,
    expiresAt,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(issuedAt / 1000)
    .setExpirationTime(expiresAt / 1000)
    .sign(JWT_SECRET);

  return token;
}

/**
 * Verify and decode a session JWT token
 */
export async function verifySession(token: string): Promise<SessionData | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as SessionData;
  } catch (error) {
    return null;
  }
}

/**
 * Get the current session from cookies
 */
export async function getSession(): Promise<SessionData | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  return verifySession(token);
}

/**
 * Set the session cookie
 */
export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_DURATION / 1000,
    path: '/',
  });
}

/**
 * Clear the session cookie
 */
export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

/**
 * Require authentication - throw if not authenticated
 */
export async function requireAuth(): Promise<SessionData> {
  const session = await getSession();

  if (!session) {
    throw new Error('Unauthorized');
  }

  return session;
}
