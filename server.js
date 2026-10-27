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
import { scheduleBackup } from './src/backup.js';
import { runDue } from './src/domain/periodic.js';

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

  // 邮件备份（每天，若配置了 SMTP）
  const backupTimer = scheduleBackup(db, path.join(__dirname, 'data', 'zhangben.db'));

  process.on('SIGINT', () => {
    clearInterval(periodicTimer);
    clearInterval(backupTimer);
    server.close();
    db.close();
    process.exit(0);
  });
}
