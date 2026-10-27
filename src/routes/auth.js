import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getApiToken, getWebPassword, login, apiAuth, setSettingValue, checkSession } from '../auth.js';
import { sendBackup } from '../backup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = path.join(__dirname, '..', '..', 'data', 'zhangben.db');

// 网页 session 鉴权（cookie）
function webAuth(req, res, next) {
  const token = req.cookies?.session;
  if (token && checkSession(token)) return next();
  return res.status(401).json({ error: 'unauthorized', message: '请先登录' });
}

export function authRouter(db, dbPath = DEFAULT_DB_PATH) {
  const r = express.Router();

  // 登录（网页）：POST { password } → 返回 session cookie + api token
  r.post('/login', (req, res) => {
    const { password } = req.body || {};
    const token = login(db, password);
    if (!token) return res.status(401).json({ error: 'invalid_password' });
    res.cookie('session', token, { httpOnly: true, maxAge: 7 * 24 * 3600 * 1000 });
    // 登录成功直接返回 api token，避免前端二次请求死锁
    res.json({ ok: true, token: getApiToken(db) });
  });

  // 获取 API token（需网页 session 登录）
  r.get('/api-token', webAuth, (req, res) => {
    res.json({ token: getApiToken(db), webPassword: getWebPassword(db) });
  });

  r.post('/settings', apiAuth(db), (req, res) => {
    const { web_password, smtp } = req.body || {};
    if (web_password) setSettingValue(db, 'web_password', web_password);
    if (smtp) setSettingValue(db, 'smtp', JSON.stringify(smtp));
    res.json({ ok: true });
  });
  r.get('/settings', apiAuth(db), (req, res) => {
    const smtp = db.prepare("SELECT value FROM settings WHERE key='smtp'").get();
    res.json({
      web_password: getWebPassword(db),
      smtp: smtp ? JSON.parse(smtp.value) : null,
    });
  });

  // 主动发送备份邮件
  r.post('/backup', apiAuth(db), async (req, res) => {
    try {
      const result = await sendBackup(db, dbPath);
      if (result.skipped) {
        return res.json({ ok: false, reason: result.reason, message: '未配置 SMTP 或数据库文件不存在' });
      }
      res.json({ ok: true, sentTo: result.sentTo });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return r;
}
