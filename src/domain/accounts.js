import { CASH_ACCOUNT } from '../db.js';

// 账户 + 平账逻辑
// 平账规则：给定各账户的「实际余额」映射，对每个非现金账户：
//   差额 = 实际余额 - 账面余额
//   若差额 > 0：生成一笔「从该账户转入现金」的转账（该账户余额 -差额 对齐到实际，现金 +差额）
//   若差额 < 0：生成一笔「从现金转出到该账户」的转账（现金 -|差额|，该账户 +|差额| 对齐到实际）
// 现金账户自身不参与平账（它是汇聚点）。

export function listAccounts(db) {
  return db.prepare('SELECT * FROM accounts ORDER BY sort, id').all();
}

export function getAccount(db, id) {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
}

export function getCashAccount(db) {
  return db.prepare('SELECT * FROM accounts WHERE name = ? AND type = ?').get(CASH_ACCOUNT, 'asset');
}

export function createAccount(db, { name, type, sub_label = '', balance = 0, sort = 0, shown = 1, color = '#42a5f5', credit_limit = 0 }) {
  const info = db.prepare(
    `INSERT INTO accounts (name, type, sub_label, balance, sort, shown, color, credit_limit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(name, type, sub_label, balance, sort, shown ? 1 : 0, color, credit_limit);
  return getAccount(db, info.lastInsertRowid);
}

export function updateAccount(db, id, patch) {
  const cur = getAccount(db, id);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  db.prepare(
    `UPDATE accounts SET name=?, type=?, sub_label=?, balance=?, sort=?, shown=?, color=?, credit_limit=?
     WHERE id=?`
  ).run(next.name, next.type, next.sub_label, next.balance, next.sort, next.shown ? 1 : 0, next.color, next.credit_limit, id);
  return getAccount(db, id);
}

export function deleteAccount(db, id) {
  const cur = getAccount(db, id);
  if (!cur) return false;
  if (cur.name === CASH_ACCOUNT && cur.type === 'asset') return false; // 现金账户不可删
  db.prepare('DELETE FROM accounts WHERE id=?').run(id);
  return true;
}

// 直接设置账户余额（对齐），可选生成差额转账流水
export function setBalance(db, id, actualBalance, date, { recordTransfer = true } = {}) {
  const cur = getAccount(db, id);
  if (!cur) return null;
  const diff = actualBalance - cur.balance;
  const cash = getCashAccount(db);
  const transfers = [];
  if (diff !== 0 && recordTransfer && cash) {
    // 差额为正：该账户多出来，转入现金；差额为负：现金补足该账户
    const entry = {
      date,
      type: 'transfer',
      category: '平账',
      account_id: diff > 0 ? id : cash.id,       // 转出方
      target_account_id: diff > 0 ? cash.id : id, // 转入方
      amount: Math.abs(diff),
      note: '账户对齐',
      is_balance: 1,
    };
    const info = db.prepare(
      `INSERT INTO entries (date, type, category, account_id, target_account_id, amount, note, is_balance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(entry.date, entry.type, entry.category, entry.account_id, entry.target_account_id, entry.amount, entry.note, entry.is_balance);
    transfers.push({ ...entry, id: info.lastInsertRowid });
  }
  db.prepare('UPDATE accounts SET balance=? WHERE id=?').run(actualBalance, id);
  if (cash && diff !== 0) {
    const newCash = cash.balance + diff; // 差额净流入现金
    db.prepare('UPDATE accounts SET balance=? WHERE id=?').run(newCash, cash.id);
  }
  return { account: getAccount(db, id), transfers };
}

// 批量平账：given = { accountId: actualBalance, ... }，把所有非现金账户对齐，差额净计入现金
export function flatten(db, given, date) {
  const results = [];
  const cash = getCashAccount(db);
  for (const [idStr, actual] of Object.entries(given)) {
    const id = Number(idStr);
    if (cash && id === cash.id) continue; // 现金不参与
    const r = setBalance(db, id, actual, date);
    if (r) results.push(r);
  }
  return results;
}
