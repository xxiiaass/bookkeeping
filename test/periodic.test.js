import test from 'node:test';
import assert from 'node:assert';
import { initDb } from '../src/db.js';
import { getCashAccount } from '../src/domain/accounts.js';
import { createPeriodic, runDue, nextRunTime } from '../src/domain/periodic.js';

function memDb() {
  return initDb(':memory:');
}

test('nextRunTime：MONTHLY 简写', () => {
  const from = new Date('2026-10-27T00:00:00');
  const nt = nextRunTime('MONTHLY:1', from);
  assert.strictEqual(nt.getMonth(), 10, '11月'); // 0-based
  assert.strictEqual(nt.getDate(), 1);
  assert.strictEqual(nt.getHours(), 9);
});

test('createPeriodic：创建周期账并计算 next_run', () => {
  const db = memDb();
  const p = createPeriodic(db, { name: '房贷', type: 'expense', category: '房贷', amount: 500000, cron: 'MONTHLY:1' });
  assert.ok(p.next_run, '应有 next_run');
});

test('runDue：到期周期账生成流水并更新 next_run', () => {
  const db = memDb();
  const p = createPeriodic(db, { name: '房贷', type: 'expense', category: '房贷', amount: 500000, cron: 'MONTHLY:1' });
  // 手动把 next_run 设为过去
  db.prepare('UPDATE periodic_entries SET next_run=? WHERE id=?').run('2026-10-01T00:00:00.000Z', p.id);
  const now = new Date('2026-10-27T12:00:00');
  const generated = runDue(db, now);
  assert.strictEqual(generated.length, 1, '应生成一条流水');
  assert.strictEqual(generated[0].category, '房贷');
  assert.strictEqual(generated[0].amount, 500000);
  // 现金应减少
  assert.strictEqual(getCashAccount(db).balance, -500000);
  // next_run 应更新到未来
  const updated = db.prepare('SELECT * FROM periodic_entries WHERE id=?').get(p.id);
  assert.ok(new Date(updated.next_run) > now, 'next_run 应更新到未来');
});

test('runDue：未到期不生成', () => {
  const db = memDb();
  createPeriodic(db, { name: '房贷', type: 'expense', category: '房贷', amount: 500000, cron: 'MONTHLY:1' });
  const now = new Date('2026-10-27T12:00:00');
  const generated = runDue(db, now);
  assert.strictEqual(generated.length, 0, '未到期不应生成');
});

test('runDue：disabled 的周期账不生成', () => {
  const db = memDb();
  const p = createPeriodic(db, { name: '房贷', type: 'expense', category: '房贷', amount: 500000, cron: 'MONTHLY:1' });
  db.prepare('UPDATE periodic_entries SET next_run=?, enabled=0 WHERE id=?').run('2026-10-01T00:00:00.000Z', p.id);
  const generated = runDue(db, new Date('2026-10-27T12:00:00'));
  assert.strictEqual(generated.length, 0);
});
