import { test } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { initDb } from '../src/db.js';
import { computeTotals, snapshotToday, listSnapshots, ensureSnapshot } from '../src/domain/snapshots.js';
import { createAccount } from '../src/domain/accounts.js';
import { localDate, localMonth } from '../src/domain/date.js';

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
  assert.strictEqual(list[list.length - 1].allTotal, 9900);
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

test('localDate: 使用本地时区而非 UTC', () => {
  // 东八区 2026-10-30 00:30 对应 UTC 2026-10-29 16:30
  const d = new Date('2026-10-29T16:30:00Z');
  const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  assert.strictEqual(localDate(d), expected);
  assert.strictEqual(localMonth(d), expected.slice(0, 7));
  // 格式正确
  assert.match(localDate(d), /^\d{4}-\d{2}-\d{2}$/);
});

test('ensureSnapshot: 缺失时补齐，已存在不覆盖', () => {
  const db = setup();
  createAccount(db, { name: 'A', type: 'asset', balance: 1000, shown: 1 });
  const r1 = ensureSnapshot(db, '2026-10-30');
  assert.strictEqual(r1.existed, false);
  assert.strictEqual(r1.allTotal, 1000);

  // 改余额后再 ensure，不应覆盖已有值
  createAccount(db, { name: 'B', type: 'asset', balance: 5000, shown: 1 });
  const r2 = ensureSnapshot(db, '2026-10-30');
  assert.strictEqual(r2.existed, true);
  assert.strictEqual(r2.allTotal, 1000);

  // 新的一天会补进新值
  const r3 = ensureSnapshot(db, '2026-10-31');
  assert.strictEqual(r3.existed, false);
  assert.strictEqual(r3.allTotal, 6000);
});
