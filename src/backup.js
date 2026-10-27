import nodemailer from 'nodemailer';
import fs from 'node:fs';
import path from 'node:path';

// 邮件备份：SMTP 配置存在时，定期把 .db 文件作为附件发到指定邮箱
export function getSmtpConfig(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key='smtp'").get();
  if (!row || !row.value) return null;
  try {
    const cfg = JSON.parse(row.value);
    if (!cfg.host || !cfg.user || !cfg.pass || !cfg.to) return null;
    return cfg;
  } catch {
    return null;
  }
}

export async function sendBackup(db, dbPath) {
  const cfg = getSmtpConfig(db);
  if (!cfg) return { skipped: true, reason: 'no_smtp_config' };
  if (!fs.existsSync(dbPath)) return { skipped: true, reason: 'db_not_found' };

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port || 465,
    secure: cfg.port ? cfg.port === 465 : true,
    auth: { user: cfg.user, pass: cfg.pass },
  });

  const dateStr = new Date().toISOString().slice(0, 10);
  await transporter.sendMail({
    from: cfg.from || cfg.user,
    to: cfg.to,
    subject: `[记账备份] ${dateStr}`,
    text: `记账数据备份，生成时间 ${new Date().toLocaleString('zh-CN')}`,
    attachments: [{ filename: `zhangben-${dateStr}.db`, path: dbPath }],
  });
  return { ok: true, sentTo: cfg.to };
}

export function scheduleBackup(db, dbPath, { intervalMs = 24 * 3600 * 1000 } = {}) {
  const timer = setInterval(() => {
    sendBackup(db, dbPath).catch(err => console.error('[backup] 失败:', err.message));
  }, intervalMs);
  // 立即执行一次
  sendBackup(db, dbPath).catch(err => console.error('[backup] 失败:', err.message));
  return timer;
}
