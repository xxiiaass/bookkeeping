import { test } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { initDb } from '../src/db.js';
import { computeTotals, snapshotToday, listSnapshots } from '../src/domain/snapshots.js';
import { createAccount } from '../src/domain/accounts.js';

function setup() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  // 复用 initDb 的 schema
  const realDb = initDb(':memory:');
  realDb.close();
  // 直接用 initDb 初始化
  return initDb(':memory:');
}

test('computeTotals: 空账户返回 0', () => {
  const db = setup();
  const { shownTotal, allTotal } = computeTotals(db);
  assert.strictEqual(shownTotal, 0);
  assert.strictEqual(allTotal, 0);
});

test('computeTotals: 资产 - 负债 = 净资产', () => {
  const db = setup();
  createAccount(db, { name: '储蓄卡', type: 'asset', balance: 10000, shown: 1 });
  createAccount(db, { name: '信用卡', type: 'liability', balance: 3000, shown: 1 });
  createAccount(db, { name: '隐藏账户', type: 'asset', balance: 5000, shown: 0 });
  const { shownTotal, allTotal } = computeTotals(db);
  // 现金(id=1)默认0 + 储蓄卡10000 - 信用卡3000 = 7000（shown）
  assert.strictEqual(shownTotal, 7000);
  // 加上隐藏的 5000
  assert.strictEqual(allTotal, 12000);
});

test('snapshotToday: 记录并更新', () => {
  const db = setup();
  const s1 = snapshotToday(db, '2026-10-29');
  assert.strictEqual(s1.date, '2026-10-29');
  // 再次记录同一天，应更新而非新增
  createAccount(db, { name: '新账户', type: 'asset', balance: 9900, shown: 1 });
  snapshotToday(db, '2026-10-29');
  const list = listSnapshots(db, {});
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[list.length - 1].all_total, 9900);
});

test('listSnapshots: 日期过滤', () => {
  const db = setup();
  snapshotToday(db, '2026-10-01');
  snapshotToday(db, '2026-10-15');
  snapshotToday(db, '2026-10-29');
  const list = listSnapshots(db, { from: '2026-10-10', to: '2026-10-20' });
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].date, '2026-10-15');
});
