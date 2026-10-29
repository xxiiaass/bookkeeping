import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb } from './src/db.js';
import { apiAuth } from './src/auth.js';
import { authRouter } from './src/routes/auth.js';
import { accountsRouter } from './src/routes/accounts.js';
import { entriesRouter } from './src/routes/entries.js';
import { periodicRouter } from './src/routes/periodic.js';
import { receivablesRouter } from './src/routes/receivables.js';
import { reportRouter } from './src/routes/report.js';
import { categoriesRouter } from './src/routes/categories.js';
import { snapshotsRouter } from './src/routes/snapshots.js';
import { scheduleBackup } from './src/backup.js';
import { runDue } from './src/domain/periodic.js';
import { snapshotToday } from './src/domain/snapshots.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(db) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());

  // 登录接口不需要鉴权
  app.use('/api/auth', authRouter(db, path.join(__dirname, 'data', 'zhangben.db')));

  // 其余 API 统一鉴权
  app.use('/api/accounts', apiAuth(db), accountsRouter(db));
  app.use('/api/entries', apiAuth(db), entriesRouter(db));
  app.use('/api/periodic', apiAuth(db), periodicRouter(db));
  app.use('/api/receivables', apiAuth(db), receivablesRouter(db));
  app.use('/api/report', apiAuth(db), reportRouter(db));
  app.use('/api/categories', apiAuth(db), categoriesRouter(db));
  app.use('/api/snapshots', apiAuth(db), snapshotsRouter(db));

  // 静态页面
  app.use(express.static(path.join(__dirname, 'public')));

  // SPA 回退
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  return app;
}

const PORT = process.env.PORT || 3000;

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(__dirname, 'server.js')) {
  const db = initDb();
  const app = createApp(db);
  const server = app.listen(PORT, () => {
    console.log(`✅ AI 记账工具已启动：http://localhost:${PORT}`);
    console.log(`   默认网页密码：admin123（请登录后修改）`);
    console.log(`   API token 见 /api/auth/api-token（需 Bearer token）`);
  });

  // 周期账定时检查（每分钟）
  const periodicTimer = setInterval(() => {
    try {
      runDue(db);
    } catch (e) {
      console.error('[periodic] 检查失败:', e.message);
    }
  }, 60 * 1000);

  // 每分钟检查一次：到期时执行资产快照 / 邮件备份
  let lastSnapshotDate = '';
  let lastBackupDate = '';
  const dailyTimer = setInterval(() => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const hour = now.getHours();
    const dateNum = now.getDate();
    // 每天 0 点后第一次触发快照
    if (hour >= 0 && lastSnapshotDate !== today) {
      try {
        const r = snapshotToday(db, today);
        lastSnapshotDate = today;
        console.log(`[snapshot] ${r.date} shown=${(r.shownTotal/100).toFixed(2)} all=${(r.allTotal/100).toFixed(2)}`);
      } catch (e) { console.error('[snapshot] 失败:', e.message); }
    }
    // 每月 1、15 号 0 点后第一次触发备份
    if (hour >= 0 && (dateNum === 1 || dateNum === 15) && lastBackupDate !== today) {
      lastBackupDate = today;
      import('./src/backup.js').then(({ sendBackup }) =>
        sendBackup(db, path.join(__dirname, 'data', 'zhangben.db'))
          .then(r => console.log('[backup]', r))
          .catch(err => console.error('[backup] 失败:', err.message))
      );
    }
  }, 60 * 1000);

  // 启动时立即记录一次今日快照（补齐当天数据）
  try {
    snapshotToday(db, new Date().toISOString().slice(0, 10));
  } catch (e) { console.error('[snapshot] 启动快照失败:', e.message); }

  process.on('SIGINT', () => {
    clearInterval(periodicTimer);
    clearInterval(dailyTimer);
    server.close();
    db.close();
    process.exit(0);
  });
}
