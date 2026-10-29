import { getAccount, getCashAccount } from './accounts.js';

// 记账 + 现金归零逻辑
// 记账规则：所有明细都从现金账户走。
//   expense：现金减少 amount
//   income：现金增加 amount
//   transfer：从 account_id 转出 amount，转入 target_account_id
// balance()：记一条平账记录，金额 = -当前现金余额，使现金归零。

export function listEntries(db, { month, limit = 500 } = {}) {
  let sql = 'SELECT e.*, a.name as account_name, t.name as target_name FROM entries e LEFT JOIN accounts a ON a.id = e.account_id LEFT JOIN accounts t ON t.id = e.target_account_id';
  const params = [];
  if (month) {
    sql += ' WHERE e.date LIKE ?';
    params.push(month + '%'); // month 形如 '2026-10'
  }
  sql += ' ORDER BY e.date DESC, e.id DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params);
}

export function getEntry(db, id) {
  return db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
}

// 账户净值变化（与 type 无关的通用口径）
// 资产/应收：balance 增加 = 净值增加
// 负债/应付：balance 增加 = 欠款增加 = 净值减少，故符号取反
function applyAccountDelta(db, id, delta) {
  if (!id) return;
  const acc = db.prepare('SELECT type FROM accounts WHERE id=?').get(id);
  if (!acc) return;
  const sign = acc.type === 'liability' || acc.type === 'payable' ? -1 : 1;
  db.prepare('UPDATE accounts SET balance = balance + ? WHERE id=?').run(delta * sign, id);
}

export function addEntry(db, { date, type, category = '', account_id = null, target_account_id = null, amount, note = '', is_balance = 0 }) {
  const cash = getCashAccount(db);
  // 默认从现金账户走
  let fromId = account_id;
  if (fromId === null || fromId === undefined) {
    fromId = cash ? cash.id : null;
  }
  const info = db.prepare(
    `INSERT INTO entries (date, type, category, account_id, target_account_id, amount, note, is_balance)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(date, type, category, fromId, target_account_id ?? null, amount, note, is_balance ? 1 : 0);

  // 更新现金余额
  if (cash) {
    if (type === 'expense') {
      db.prepare('UPDATE accounts SET balance = balance - ? WHERE id=?').run(amount, cash.id);
    } else if (type === 'income') {
      db.prepare('UPDATE accounts SET balance = balance + ? WHERE id=?').run(amount, cash.id);
    } else if (type === 'transfer') {
      // 转出方净值减少，转入方净值增加（负债账户内部自动反向：转出=用额度=欠款增加）
      applyAccountDelta(db, fromId, -amount);
      applyAccountDelta(db, target_account_id, amount);
    }
  }
  return getEntry(db, info.lastInsertRowid);
}

export function updateEntry(db, id, patch) {
  const cur = getEntry(db, id);
  if (!cur) return null;
  const cash = getCashAccount(db);

  // 先回滚原记录对现金的影响
  revertCashEffect(db, cur, cash);
  // 应用新值
  const next = { ...cur, ...patch };
  db.prepare(
    `UPDATE entries SET date=?, type=?, category=?, account_id=?, target_account_id=?, amount=?, note=?, is_balance=?
     WHERE id=?`
  ).run(next.date, next.type, next.category, next.account_id, next.target_account_id, next.amount, next.note, next.is_balance ? 1 : 0, id);
  // 重新应用影响
  applyCashEffect(db, next, cash);
  return getEntry(db, id);
}

export function deleteEntry(db, id) {
  const cur = getEntry(db, id);
  if (!cur) return false;
  const cash = getCashAccount(db);
  revertCashEffect(db, cur, cash);
  db.prepare('DELETE FROM entries WHERE id=?').run(id);
  return true;
}

// 记一条平账记录，清零现金
export function balance(db, date, { note = '一般性支出（平账）' } = {}) {
  const cash = getCashAccount(db);
  if (!cash) return null;
  const cashBalance = cash.balance;
  if (cashBalance === 0) return { entry: null, cleared: true, cashBefore: 0 };
  // 平账金额 = -现金余额，方向相反使现金归零
  const entry = addEntry(db, {
    date,
    type: 'balance',
    category: '平账',
    account_id: cash.id,
    amount: Math.abs(cashBalance),
    note,
    is_balance: 1,
  });
  // balance 类型对现金的影响：若现金为正（多余），应减少现金 → 视作支出；若为负，应增加现金 → 视作收入
  // 但 addEntry 不处理 balance 类型，这里手动校正
  if (cashBalance > 0) {
    db.prepare('UPDATE accounts SET balance = balance - ? WHERE id=?').run(cashBalance, cash.id);
  } else {
    db.prepare('UPDATE accounts SET balance = balance + ? WHERE id=?').run(Math.abs(cashBalance), cash.id);
  }
  return { entry, cleared: getCashAccount(db).balance === 0, cashBefore: cashBalance };
}

function revertCashEffect(db, entry, cash) {
  if (!cash) return;
  if (entry.type === 'expense') {
    db.prepare('UPDATE accounts SET balance = balance + ? WHERE id=?').run(entry.amount, cash.id);
  } else if (entry.type === 'income') {
    db.prepare('UPDATE accounts SET balance = balance - ? WHERE id=?').run(entry.amount, cash.id);
  } else if (entry.type === 'transfer') {
    applyAccountDelta(db, entry.account_id, entry.amount);
    applyAccountDelta(db, entry.target_account_id, -entry.amount);
  } else if (entry.type === 'balance') {
    // 平账记录回滚：反向
    const cashBal = getCashAccount(db).balance;
    // 平账记录使现金归零，回滚无法精确还原，这里用近似：余额方向取决于记录当时
    // 简化：balance 记录 amount 存储的是 |现金差额|，回滚方向由当前现金符号决定
    if (cashBal <= 0) {
      db.prepare('UPDATE accounts SET balance = balance + ? WHERE id=?').run(entry.amount, cash.id);
    } else {
      db.prepare('UPDATE accounts SET balance = balance - ? WHERE id=?').run(entry.amount, cash.id);
    }
  }
}

function applyCashEffect(db, entry, cash) {
  if (!cash) return;
  if (entry.type === 'expense') {
    db.prepare('UPDATE accounts SET balance = balance - ? WHERE id=?').run(entry.amount, cash.id);
  } else if (entry.type === 'income') {
    db.prepare('UPDATE accounts SET balance = balance + ? WHERE id=?').run(entry.amount, cash.id);
  } else if (entry.type === 'transfer') {
    applyAccountDelta(db, entry.account_id, -entry.amount);
    applyAccountDelta(db, entry.target_account_id, entry.amount);
  }
}
