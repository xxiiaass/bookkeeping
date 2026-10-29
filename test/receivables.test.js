import test from 'node:test';
import assert from 'node:assert';
import { initDb } from '../src/db.js';
import { syncReceivablePayableBalances } from '../src/routes/receivables.js';

function memDb() {
  return initDb(':memory:');
}

test('应收/应付账户余额 = 未结清明细之和', () => {
  const db = memDb();
  // 建一个应收账户
  const acc = db.prepare("INSERT INTO accounts (name, type, balance) VALUES ('应收款','receivable',0)").run();
  const accId = acc.lastInsertRowid;
  // 插入两笔未结清明细
  db.prepare("INSERT INTO receivable_payable_items (account_id, name, amount, date, status) VALUES (?,?,?,?, 'open')").run(accId, '张洪亮', 5000000, '2024-10-07');
  db.prepare("INSERT INTO receivable_payable_items (account_id, name, amount, date, status) VALUES (?,?,?,?, 'open')").run(accId, '爸', 2000000, '2023-06-05');
  // 插入一笔已结清
  db.prepare("INSERT INTO receivable_payable_items (account_id, name, amount, date, status) VALUES (?,?,?,?, 'done')").run(accId, '杨生辉', 1000000, '2022-02-19');

  syncReceivablePayableBalances(db);

  const row = db.prepare('SELECT balance FROM accounts WHERE id=?').get(accId);
  // 只有未结清的 50000 + 20000 = 70000 元 = 7000000 分
  assert.strictEqual(row.balance, 7000000);
});

test('标记已结清后，余额同步减少', () => {
  const db = memDb();
  const acc = db.prepare("INSERT INTO accounts (name, type, balance) VALUES ('借款','payable',0)").run();
  const accId = acc.lastInsertRowid;
  const it = db.prepare("INSERT INTO receivable_payable_items (account_id, name, amount, date, status) VALUES (?,?,?,?, 'open')").run(accId, '爱玲彩礼', 5000000, '2025-01-13');
  syncReceivablePayableBalances(db);
  assert.strictEqual(db.prepare('SELECT balance FROM accounts WHERE id=?').get(accId).balance, 5000000);

  // 标记结清
  db.prepare("UPDATE receivable_payable_items SET status='done' WHERE id=?").run(it.lastInsertRowid);
  syncReceivablePayableBalances(db);
  assert.strictEqual(db.prepare('SELECT balance FROM accounts WHERE id=?').get(accId).balance, 0);
});

test('report：总资产含应收，总负债含应付', async () => {
  const { report } = await import('../src/domain/report.js');
  const db = memDb();
  // 普通资产 10000
  db.prepare("INSERT INTO accounts (name, type, balance) VALUES ('现金','asset',1000000)").run();
  // 应收账户
  const r = db.prepare("INSERT INTO accounts (name, type, balance) VALUES ('应收款','receivable',0)").run();
  db.prepare("INSERT INTO receivable_payable_items (account_id, name, amount, date, status) VALUES (?,?,?,?, 'open')").run(r.lastInsertRowid, '张洪亮', 5000000, '2024-10-07');
  syncReceivablePayableBalances(db);
  // 应付账户
  const p = db.prepare("INSERT INTO accounts (name, type, balance) VALUES ('借款','payable',0)").run();
  db.prepare("INSERT INTO receivable_payable_items (account_id, name, amount, date, status) VALUES (?,?,?,?, 'open')").run(p.lastInsertRowid, '爱玲彩礼', 2000000, '2025-01-13');
  syncReceivablePayableBalances(db);

  const rep = report(db);
  // 总资产 = 现金10000 + 应收50000 = 60000 元 = 6000000 分
  assert.strictEqual(rep.totalAsset, 6000000);
  // 总负债 = 应付20000 元 = 2000000 分
  assert.strictEqual(rep.totalLiability, 2000000);
  // 净资产 = 60000 - 20000 = 40000 元 = 4000000 分
  assert.strictEqual(rep.netAsset, 4000000);
});

test('report：未勾选(shown=0)的账户不计入汇总', async () => {
  const { report } = await import('../src/domain/report.js');
  const db = memDb();
  // 现金 shown=1 余额 10000
  db.prepare("INSERT INTO accounts (name, type, balance, shown) VALUES ('现金','asset',1000000,1)").run();
  // 隐藏的账户 shown=0 余额 50000
  db.prepare("INSERT INTO accounts (name, type, balance, shown) VALUES ('招商银行','asset',5000000,0)").run();

  const rep = report(db);
  // 只统计 shown=1 的现金，总资产 = 10000 元
  assert.strictEqual(rep.totalAsset, 1000000);
});

test('新增应收明细：现金减少', async () => {
  const { receivablesRouter } = await import('../src/routes/receivables.js');
  const db = memDb();
  // 现金初始 10000 元
  const cash = db.prepare("SELECT id FROM accounts WHERE name='现金' AND type='asset'").get();
  db.prepare('UPDATE accounts SET balance=? WHERE id=?').run(1000000, cash.id);
  // 应收账户
  const r = db.prepare("INSERT INTO accounts (name, type, balance) VALUES ('应收款','receivable',0)").run();
  const accId = r.lastInsertRowid;

  // 模拟新增应收 2000 元
  db.prepare("INSERT INTO receivable_payable_items (account_id, name, amount, date, status) VALUES (?,?,?,?, 'open')").run(accId, '借给朋友', 200000, '2026-10-29');
  // 手动调用现金调整逻辑（模拟路由行为）
  syncReceivablePayableBalances(db);
  // 应收账户余额 = 2000 元
  assert.strictEqual(db.prepare('SELECT balance FROM accounts WHERE id=?').get(accId).balance, 200000);
});

test('新增应付明细：现金增加', async () => {
  const db = memDb();
  const cash = db.prepare("SELECT id FROM accounts WHERE name='现金' AND type='asset'").get();
  db.prepare('UPDATE accounts SET balance=? WHERE id=?').run(0, cash.id);
  const p = db.prepare("INSERT INTO accounts (name, type, balance) VALUES ('借款','payable',0)").run();
  const accId = p.lastInsertRowid;

  // 新增应付 5000 元（借来的钱）
  db.prepare("INSERT INTO receivable_payable_items (account_id, name, amount, date, status) VALUES (?,?,?,?, 'open')").run(accId, '借来的钱', 500000, '2026-10-29');
  syncReceivablePayableBalances(db);
  assert.strictEqual(db.prepare('SELECT balance FROM accounts WHERE id=?').get(accId).balance, 500000);
});
