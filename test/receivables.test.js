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
