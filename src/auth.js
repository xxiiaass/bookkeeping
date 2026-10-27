import crypto from 'node:crypto';

// 鉴权：网页密码登录 + API token
// 简化方案：单个共享 API token（存 settings），网页登录用密码换取 session cookie（内存 session）。

const SESSIONS = new Map(); // token -> { expires }

function getSetting(db, key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

export function getApiToken(db) {
  const t = getSetting(db, 'api_token');
  if (t) return t;
  const gen = crypto.randomBytes(24).toString('hex');
  setSetting(db, 'api_token', gen);
  return gen;
}

export function getWebPassword(db) {
  const p = getSetting(db, 'web_password');
  if (p) return p;
  setSetting(db, 'web_password', 'admin123');
  return 'admin123';
}

export function checkWebLogin(db, password) {
  return password === getWebPassword(db);
}

export function login(db, password) {
  if (!checkWebLogin(db, password)) return null;
  const token = crypto.randomBytes(24).toString('hex');
  SESSIONS.set(token, { expires: Date.now() + 7 * 24 * 3600 * 1000 });
  return token;
}

export function checkSession(token) {
  const s = SESSIONS.get(token);
  if (!s) return false;
  if (s.expires < Date.now()) {
    SESSIONS.delete(token);
    return false;
  }
  return true;
}

// 中间件：API token 鉴权
export function apiAuth(db) {
  return (req, res, next) => {
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (token === getApiToken(db)) return next();
    return res.status(401).json({ error: 'unauthorized', message: '无效的 API token' });
  };
}

// 中间件：网页 session 鉴权
export function webAuth() {
  return (req, res, next) => {
    const token = req.cookies?.session;
    if (token && checkSession(token)) return next();
    return res.status(401).json({ error: 'unauthorized', message: '请先登录' });
  };
}

export function setSettingValue(db, key, value) {
  setSetting(db, key, value);
}
