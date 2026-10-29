import { listAccounts } from './accounts.js';

// 计算当前总资产（分）
// shownTotal: 只统计 shown=1 的账户
// allTotal: 统计所有账户
// 口径：资产 + 应收 - 负债 - 应付（净资产）
export function computeTotals(db) {
  const accounts = listAccounts(db);
  let shownTotal = 0;
  let allTotal = 0;
  for (const a of accounts) {
    let v = 0;
    if (a.type === 'asset' || a.type === 'receivable') v = a.balance;
    else if (a.type === 'liability' || a.type === 'payable') v = -a.balance;
    allTotal += v;
    if (a.shown) shownTotal += v;
  }
  return { shownTotal, allTotal };
}

// 记录今日快照（若已存在则更新）
export function snapshotToday(db, date) {
  const { shownTotal, allTotal } = computeTotals(db);
  db.prepare(
    `INSERT INTO asset_snapshots (date, shown_total, all_total) VALUES (?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET shown_total=excluded.shown_total, all_total=excluded.all_total`
  ).run(date, shownTotal, allTotal);
  return { date, shownTotal, allTotal };
}

// 查询快照，按日期区间
export function listSnapshots(db, { from, to, limit = 365 } = {}) {
  let sql = 'SELECT * FROM asset_snapshots';
  const params = [];
  const conds = [];
  if (from) { conds.push('date >= ?'); params.push(from); }
  if (to) { conds.push('date <= ?'); params.push(to); }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY date DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params).reverse();
}
