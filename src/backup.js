import nodemailer from 'nodemailer';
import fs from 'node:fs';
import os from 'node:os';
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

// 生成一份完整的、可独立打开的数据库快照
// 关键：WAL 模式下数据在 -wal 文件里，必须先 checkpoint 合并回主文件，再复制主文件
function makeSnapshot(db, dbPath) {
  // 把 WAL 数据 checkpoint 回主文件
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (e) {
    console.error('[backup] checkpoint 失败:', e.message);
  }
  // checkpoint 后主文件即完整，直接复制
  const snapshot = path.join(os.tmpdir(), `zhangben-snapshot-${Date.now()}.db`);
  fs.copyFileSync(dbPath, snapshot);
  return snapshot;
}

export async function sendBackup(db, dbPath) {
  const cfg = getSmtpConfig(db);
  if (!cfg) return { skipped: true, reason: 'no_smtp_config' };
  if (!fs.existsSync(dbPath)) return { skipped: true, reason: 'db_not_found' };

  // 生成完整快照（先 checkpoint WAL）
  const snapshotPath = makeSnapshot(db, dbPath);

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port || 465,
    secure: cfg.port ? cfg.port === 465 : true,
    auth: { user: cfg.user, pass: cfg.pass },
  });

  const dateStr = new Date().toISOString().slice(0, 10);
  try {
    await transporter.sendMail({
      from: cfg.from || cfg.user,
      to: cfg.to,
      subject: `[记账备份] ${dateStr}`,
      text: `记账数据备份，生成时间 ${new Date().toLocaleString('zh-CN')}`,
      attachments: [{ filename: `zhangben-${dateStr}.db`, path: snapshotPath }],
    });
  } finally {
    // 清理临时快照
    if (snapshotPath !== dbPath && fs.existsSync(snapshotPath)) {
      fs.unlinkSync(snapshotPath);
    }
  }
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
