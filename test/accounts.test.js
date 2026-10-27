import test from 'node:test';
import assert from 'node:assert';
import { initDb, CASH_ACCOUNT } from '../src/db.js';
import {
  listAccounts, getAccount, getCashAccount, createAccount,
  setBalance, flatten,
} from '../src/domain/accounts.js';

function memDb() {
  return initDb(':memory:');
}

test('初始化：现金账户和默认分类存在', () => {
  const db = memDb();
  const cash = getCashAccount(db);
  assert.ok(cash, '现金账户应存在');
  assert.strictEqual(cash.name, CASH_ACCOUNT);
  const cats = db.prepare('SELECT COUNT(*) c FROM categories').get().c;
  assert.ok(cats > 0, '默认分类应存在');
});

test('createAccount：新建账户', () => {
  const db = memDb();
  const a = createAccount(db, { name: '招商银行', type: 'asset', sub_label: '储蓄卡', balance: 10000 });
  assert.strictEqual(a.name, '招商银行');
  assert.strictEqual(a.balance, 10000);
  assert.strictEqual(a.type, 'asset');
});

test('setBalance：差额为正 → 转入现金', () => {
  const db = memDb();
  const cash = getCashAccount(db);
  const acc = createAccount(db, { name: '招行', type: 'asset', balance: 0 });
  const r = setBalance(db, acc.id, 5000, '2026-10-27');
  assert.strictEqual(r.account.balance, 5000, '账户对齐到实际值');
  assert.strictEqual(getCashAccount(db).balance, 5000, '差额净流入现金');
  assert.strictEqual(r.transfers.length, 1, '生成一条转账流水');
  assert.strictEqual(r.transfers[0].amount, 5000);
});

test('setBalance：差额为负 → 现金补足账户', () => {
  const db = memDb();
  const acc = createAccount(db, { name: '招行', type: 'asset', balance: 10000 });
  const r = setBalance(db, acc.id, 3000, '2026-10-27');
  assert.strictEqual(r.account.balance, 3000, '账户对齐到实际值');
  assert.strictEqual(getCashAccount(db).balance, -7000, '现金被扣减差额');
  assert.strictEqual(r.transfers.length, 1);
});

test('flatten：批量平账，现金汇聚差额', () => {
  const db = memDb();
  const a1 = createAccount(db, { name: '招行', type: 'asset', balance: 0 });
  const a2 = createAccount(db, { name: '建行', type: 'asset', balance: 10000 });
  // 招行实际 5000（+5000），建行实际 3000（-7000），净现金 = 5000 - 7000 = -2000
  flatten(db, { [a1.id]: 5000, [a2.id]: 3000 }, '2026-10-27');
  assert.strictEqual(getAccount(db, a1.id).balance, 5000);
  assert.strictEqual(getAccount(db, a2.id).balance, 3000);
  assert.strictEqual(getCashAccount(db).balance, -2000);
});

test('flatten：现金账户自身不被平账', () => {
  const db = memDb();
  const cash = getCashAccount(db);
  flatten(db, { [cash.id]: 9999 }, '2026-10-27');
  assert.strictEqual(getCashAccount(db).balance, 0, '现金账户不参与平账');
});
