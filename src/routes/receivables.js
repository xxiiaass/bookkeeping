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
    syncReceivablePayableBalances(db);
    res.json({ item: db.prepare('SELECT * FROM receivable_payable_items WHERE id=?').get(cur.id) });
  });

  r.delete('/:id', (req, res) => {
    const cur = db.prepare('SELECT * FROM receivable_payable_items WHERE id=?').get(Number(req.params.id));
    if (!cur) return res.status(404).json({ error: 'not_found' });
    db.prepare('DELETE FROM receivable_payable_items WHERE id=?').run(cur.id);
    syncReceivablePayableBalances(db);
    res.json({ ok: true });
  });

  return r;
}
