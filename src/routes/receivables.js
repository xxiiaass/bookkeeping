import express from 'express';

// 同步应收/应付账户的余额 = 未结清明细之和
export function syncReceivablePayableBalances(db) {
  // 先清零所有应收/应付账户
  db.prepare("UPDATE accounts SET balance = 0 WHERE type IN ('receivable','payable')").run();
  const rows = db.prepare(
    "SELECT account_id, SUM(amount) s FROM receivable_payable_items WHERE status = 'open' GROUP BY account_id"
  ).all();
  for (const r of rows) {
    db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').run(r.s, r.account_id);
  }
}

// 计算一笔明细对现金的影响：
// - 应收(receivable) + open: 现金 -amount（钱借出去了）
// - 应收(receivable) + done: 0（钱已收回，净影响为 0）
// - 应付(payable) + open: 现金 +amount（借来的钱在手里）
// - 应付(payable) + done: 0（钱已还清）
function itemCashImpact(item, accountType) {
  if (item.status !== 'open') return 0;
  if (accountType === 'receivable') return -item.amount;
  if (accountType === 'payable') return item.amount;
  return 0;
}

function getCashAccount(db) {
  return db.prepare("SELECT * FROM accounts WHERE name='现金' AND type='asset'").get();
}

function adjustCash(db, delta) {
  if (delta === 0) return;
  const cash = getCashAccount(db);
  if (!cash) return;
  db.prepare('UPDATE accounts SET balance = balance + ? WHERE id=?').run(delta, cash.id);
}

function getAccountType(db, accountId) {
  const a = db.prepare('SELECT type FROM accounts WHERE id=?').get(accountId);
  return a ? a.type : null;
}

export function receivablesRouter(db) {
  const r = express.Router();

  r.get('/', (req, res) => {
    const { type } = req.query; // receivable / payable
    let items;
    if (type) {
      items = db.prepare(
        'SELECT i.*, a.name as account_name FROM receivable_payable_items i JOIN accounts a ON a.id = i.account_id WHERE a.type = ? ORDER BY i.date DESC, i.id DESC'
      ).all(type);
    } else {
      items = db.prepare(
        'SELECT i.*, a.name as account_name, a.type as account_type FROM receivable_payable_items i JOIN accounts a ON a.id = i.account_id ORDER BY i.date DESC, i.id DESC'
      ).all();
    }
    res.json({ items });
  });

  r.post('/', (req, res) => {
    const { account_id, name, amount, date, status = 'open', note = '' } = req.body || {};
    const info = db.prepare(
      'INSERT INTO receivable_payable_items (account_id, name, amount, date, status, note) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(account_id, name, amount, date, status, note);
    // 现金调整：新增明细 → 按当前状态计算现金影响
    const accountType = getAccountType(db, account_id);
    const newItem = { amount, status };
    adjustCash(db, itemCashImpact(newItem, accountType));
    syncReceivablePayableBalances(db);
    res.json({ item: db.prepare('SELECT * FROM receivable_payable_items WHERE id=?').get(info.lastInsertRowid) });
  });

  r.patch('/:id', (req, res) => {
    const cur = db.prepare('SELECT * FROM receivable_payable_items WHERE id=?').get(Number(req.params.id));
    if (!cur) return res.status(404).json({ error: 'not_found' });
    const next = { ...cur, ...(req.body || {}) };
    db.prepare(
      'UPDATE receivable_payable_items SET name=?, amount=?, date=?, status=?, note=? WHERE id=?'
    ).run(next.name, next.amount, next.date, next.status, next.note, cur.id);
    // 现金调整：新旧状态差额
    const accountType = getAccountType(db, cur.account_id);
    const oldImpact = itemCashImpact(cur, accountType);
    const newImpact = itemCashImpact(next, accountType);
    adjustCash(db, newImpact - oldImpact);
    syncReceivablePayableBalances(db);
    res.json({ item: db.prepare('SELECT * FROM receivable_payable_items WHERE id=?').get(cur.id) });
  });

  r.delete('/:id', (req, res) => {
    const cur = db.prepare('SELECT * FROM receivable_payable_items WHERE id=?').get(Number(req.params.id));
    if (!cur) return res.status(404).json({ error: 'not_found' });
    // 现金调整：撤销当前影响
    const accountType = getAccountType(db, cur.account_id);
    adjustCash(db, -itemCashImpact(cur, accountType));
    db.prepare('DELETE FROM receivable_payable_items WHERE id=?').run(cur.id);
    syncReceivablePayableBalances(db);
    res.json({ ok: true });
  });

  return r;
}
