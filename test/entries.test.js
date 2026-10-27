import test from 'node:test';
import assert from 'node:assert';
import { initDb } from '../src/db.js';
import { getCashAccount } from '../src/domain/accounts.js';
import { addEntry, updateEntry, deleteEntry, balance, listEntries } from '../src/domain/entries.js';

function memDb() {
  return initDb(':memory:');
}

test('addEntry 支出：现金减少', () => {
  const db = memDb();
  addEntry(db, { date: '2026-10-27', type: 'expense', category: '餐饮', amount: 5000 });
  assert.strictEqual(getCashAccount(db).balance, -5000);
});

test('addEntry 收入：现金增加', () => {
  const db = memDb();
  addEntry(db, { date: '2026-10-27', type: 'income', category: '工资', amount: 100000 });
  assert.strictEqual(getCashAccount(db).balance, 100000);
});

test('addEntry 转账：转出减、转入加', () => {
  const db = memDb();
  const cash = getCashAccount(db);
  const acc = db.prepare("INSERT INTO accounts (name, type, balance) VALUES ('招行','asset',0)").run();
  const accId = acc.lastInsertRowid;
  addEntry(db, { date: '2026-10-27', type: 'transfer', account_id: cash.id, target_account_id: accId, amount: 3000 });
  assert.strictEqual(getCashAccount(db).balance, -3000, '现金转出');
  const accRow = db.prepare('SELECT * FROM accounts WHERE id=?').get(accId);
  assert.strictEqual(accRow.balance, 3000, '招行转入');
});

test('balance：现金为正时，平账记录清零现金', () => {
  const db = memDb();
  addEntry(db, { date: '2026-10-27', type: 'income', category: '工资', amount: 100000 });
  addEntry(db, { date: '2026-10-27', type: 'expense', category: '餐饮', amount: 30000 });
  // 现金 = 70000
  const r = balance(db, '2026-10-31');
  assert.ok(r.cleared, '现金应归零');
  assert.strictEqual(getCashAccount(db).balance, 0);
  assert.ok(r.entry, '应生成平账记录');
  assert.strictEqual(r.entry.amount, 70000, '平账金额 = 现金差额');
  assert.strictEqual(r.cashBefore, 70000);
});

test('balance：现金为负时，平账记录使现金归零', () => {
  const db = memDb();
  addEntry(db, { date: '2026-10-27', type: 'expense', category: '餐饮', amount: 50000 });
  // 现金 = -50000
  const r = balance(db, '2026-10-31');
  assert.ok(r.cleared, '现金应归零');
  assert.strictEqual(getCashAccount(db).balance, 0);
  assert.strictEqual(r.entry.amount, 50000);
});

test('balance：现金已为零，无需平账', () => {
  const db = memDb();
  const r = balance(db, '2026-10-31');
  assert.strictEqual(r.cleared, true);
  assert.strictEqual(r.entry, null);
});

test('updateEntry：修改金额后现金正确重算', () => {
  const db = memDb();
  const e = addEntry(db, { date: '2026-10-27', type: 'expense', category: '餐饮', amount: 5000 });
  assert.strictEqual(getCashAccount(db).balance, -5000);
  updateEntry(db, e.id, { amount: 8000 });
  assert.strictEqual(getCashAccount(db).balance, -8000);
});

test('deleteEntry：删除后现金恢复', () => {
  const db = memDb();
  const e = addEntry(db, { date: '2026-10-27', type: 'expense', category: '餐饮', amount: 5000 });
  assert.strictEqual(getCashAccount(db).balance, -5000);
  deleteEntry(db, e.id);
  assert.strictEqual(getCashAccount(db).balance, 0);
});

test('listEntries 按月过滤', () => {
  const db = memDb();
  addEntry(db, { date: '2026-10-01', type: 'expense', category: '餐饮', amount: 100 });
  addEntry(db, { date: '2026-11-01', type: 'expense', category: '交通', amount: 200 });
  const oct = listEntries(db, { month: '2026-10' });
  assert.strictEqual(oct.length, 1);
  assert.strictEqual(oct[0].category, '餐饮');
});
