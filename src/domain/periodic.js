import { getCashAccount } from './accounts.js';
import { addEntry } from './entries.js';

// 周期账：按 cron 规则到点自动记账
// cron 支持两种简单形式：
//   "0 9 1 * *"   （标准 5 段 cron，此处实现按月日时分）
//   "MONTHLY:1"   （每月1号，简写）
// 这里实现一个精简的 cron 解析，覆盖「每月X日」「每天」等常用场景。

// 解析 cron 得到下一次运行时间（本地时区）
export function nextRunTime(cron, from = new Date()) {
  // 简写形式
  if (typeof cron === 'string' && cron.startsWith('MONTHLY:')) {
    const day = parseInt(cron.split(':')[1], 10) || 1;
    const d = new Date(from);
    d.setHours(9, 0, 0, 0);
    if (d.getDate() >= day) {
      d.setMonth(d.getMonth() + 1);
    }
    d.setDate(day);
    return d;
  }
  // 标准 5 段 cron: minute hour day month weekday
  const parts = (cron || '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, day, ,] = parts;
  const d = new Date(from);
  const targetHour = hour === '*' ? d.getHours() : parseInt(hour, 10);
  const targetMin = min === '*' ? 0 : parseInt(min, 10);
  const targetDay = day === '*' ? d.getDate() : parseInt(day, 10);
  d.setHours(targetHour, targetMin, 0, 0);
  d.setDate(targetDay);
  if (d <= from) {
    d.setMonth(d.getMonth() + 1);
    d.setDate(targetDay);
    d.setHours(targetHour, targetMin, 0, 0);
  }
  return d;
}

export function listPeriodic(db) {
  return db.prepare('SELECT * FROM periodic_entries ORDER BY enabled DESC, id').all();
}

export function getPeriodic(db, id) {
  return db.prepare('SELECT * FROM periodic_entries WHERE id = ?').get(id);
}

export function createPeriodic(db, { name, type = 'expense', category = '', account_id = null, amount, cron, note = '' }) {
  const next = nextRunTime(cron);
  const cash = getCashAccount(db);
  const accId = account_id ?? (cash ? cash.id : null);
  const info = db.prepare(
    `INSERT INTO periodic_entries (name, type, category, account_id, amount, cron, next_run, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(name, type, category, accId, amount, cron, next ? next.toISOString() : '', note);
  return getPeriodic(db, info.lastInsertRowid);
}

export function updatePeriodic(db, id, patch) {
  const cur = getPeriodic(db, id);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  const nt = nextRunTime(next.cron);
  db.prepare(
    `UPDATE periodic_entries SET name=?, type=?, category=?, account_id=?, amount=?, cron=?, next_run=?, note=?, enabled=?
     WHERE id=?`
  ).run(next.name, next.type, next.category, next.account_id, next.amount, next.cron, nt ? nt.toISOString() : '', next.note, next.enabled ? 1 : 0, id);
  return getPeriodic(db, id);
}

export function deletePeriodic(db, id) {
  const cur = getPeriodic(db, id);
  if (!cur) return false;
  db.prepare('DELETE FROM periodic_entries WHERE id=?').run(id);
  return true;
}

// 检查到期周期账并生成流水，返回生成的流水列表
export function runDue(db, now = new Date()) {
  const due = db.prepare(
    "SELECT * FROM periodic_entries WHERE enabled = 1 AND next_run <> '' AND next_run <= ?"
  ).all(now.toISOString());
  const generated = [];
  for (const p of due) {
    const entry = addEntry(db, {
      date: now.toISOString().slice(0, 10),
      type: p.type,
      category: p.category,
      account_id: p.account_id,
      amount: p.amount,
      note: `[周期] ${p.name}`,
      is_balance: 0,
    });
    generated.push(entry);
    // 更新下次运行时间
    const nt = nextRunTime(p.cron, now);
    db.prepare('UPDATE periodic_entries SET next_run=? WHERE id=?').run(nt ? nt.toISOString() : '', p.id);
  }
  return generated;
}
