// Password hashing and signed session tokens (no external dependencies).
import crypto from 'crypto';

const SCRYPT_PREFIX = 'scrypt$';

export function hashPassword(plain) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(plain), salt, 32).toString('hex');
    return `${SCRYPT_PREFIX}${salt}$${hash}`;
}

export function isHashed(stored) {
    return typeof stored === 'string' && stored.startsWith(SCRYPT_PREFIX);
}

function safeEqual(a, b) {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Accepts hashed passwords and (legacy) plain-text ones stored before hashing was introduced.
export function verifyPassword(plain, stored) {
    if (!stored || typeof plain !== 'string' || plain === '') return false;
    if (isHashed(stored)) {
        const [, salt, hash] = stored.split('$');
        const candidate = crypto.scryptSync(plain, salt, 32).toString('hex');
        return safeEqual(candidate, hash);
    }
    return safeEqual(plain, stored);
}

export function randomPassword(len = 12) {
    return crypto.randomBytes(len).toString('base64url').slice(0, len);
}

export function randomSecret() {
    return crypto.randomBytes(32).toString('hex');
}

function sign(data, secret) {
    return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

export function createToken(payload, secret, ttlSeconds = 12 * 3600) {
    const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
    return `${body}.${sign(body, secret)}`;
}

export function verifyToken(token, secret) {
    if (typeof token !== 'string' || !token.includes('.')) return null;
    const [body, sig] = token.split('.');
    if (!safeEqual(sig, sign(body, secret))) return null;
    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
        return payload;
    } catch (e) {
        return null;
    }
}

// Very small in-memory brute-force limiter for login endpoints.
export function createRateLimiter({ max = 10, windowMs = 5 * 60 * 1000 } = {}) {
    const hits = new Map();
    return {
        check(key) {
            const now = Date.now();
            if (hits.size > 5000) {
                for (const [k, r] of hits) if (now - r.start > windowMs) hits.delete(k);
            }
            const rec = hits.get(key);
            if (!rec || now - rec.start > windowMs) {
                hits.set(key, { start: now, count: 1 });
                return true;
            }
            rec.count++;
            return rec.count <= max;
        },
        reset(key) { hits.delete(key); }
    };
}
