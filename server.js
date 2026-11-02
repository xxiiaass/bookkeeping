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
import { snapshotToday, ensureSnapshot } from './src/domain/snapshots.js';
import { localDate } from './src/domain/date.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 数据库路径：支持通过环境变量 DB_PATH 覆盖，默认 data/zhangben.db。
// 这样一份代码可在同一服务器不同端口部署多个实例，各自使用独立的 db 文件。
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, 'data', 'zhangben.db');

export function createApp(db, dbPath = DB_PATH) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());

  // 登录接口不需要鉴权
  app.use('/api/auth', authRouter(db, dbPath));

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
  const db = initDb(DB_PATH);
  const app = createApp(db, DB_PATH);
  const server = app.listen(PORT, () => {
    console.log(`✅ AI 记账工具已启动：http://localhost:${PORT}`);
    console.log(`   数据库文件：${DB_PATH}`);
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
  // 注意：日期一律用「本地日期」，不能用 toISOString()（那是 UTC，东八区会错位到 8 点）
  let lastSnapshotDate = '';
  let lastBackupDate = '';
  const dailyTimer = setInterval(() => {
    const now = new Date();
    const today = localDate(now);
    const dateNum = now.getDate();
    // 每到新的一天（0 点后第一次检查）记录一次快照
    if (lastSnapshotDate !== today) {
      try {
        const r = snapshotToday(db, today);
        lastSnapshotDate = today;
        console.log(`[snapshot] ${r.date} shown=${(r.shownTotal / 100).toFixed(2)} all=${(r.allTotal / 100).toFixed(2)}`);
      } catch (e) { console.error('[snapshot] 失败:', e.message); }
    }
    // 每月 1、15 号自动发备份邮件
    if ((dateNum === 1 || dateNum === 15) && lastBackupDate !== today) {
      lastBackupDate = today;
      import('./src/backup.js').then(({ sendBackup }) =>
        sendBackup(db, DB_PATH)
          .then(r => console.log('[backup]', r))
          .catch(err => console.error('[backup] 失败:', err.message))
      );
    }
  }, 60 * 1000);

  // 启动时补齐当天快照（已存在则不覆盖，避免重启把 0 点的值改掉）
  try {
    const r = ensureSnapshot(db, localDate());
    lastSnapshotDate = r.date;
    console.log(`[snapshot] 启动检查 ${r.date} ${r.existed ? '已存在，跳过' : '已补齐'}`);
  } catch (e) { console.error('[snapshot] 启动快照失败:', e.message); }

  process.on('SIGINT', () => {
    clearInterval(periodicTimer);
    clearInterval(dailyTimer);
    server.close();
    db.close();
    process.exit(0);
  });
}
