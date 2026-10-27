import { listAccounts } from './accounts.js';

// 报告：总资产 / 净资产 / 本月汇总
export function report(db, { month } = {}) {
  const accounts = listAccounts(db);

  let totalAsset = 0;
  let totalLiability = 0;
  let receivable = 0;
  let payable = 0;

  for (const a of accounts) {
    if (a.type === 'asset') totalAsset += a.balance;
    else if (a.type === 'liability') totalLiability += a.balance;
    else if (a.type === 'receivable') receivable += a.balance;
    else if (a.type === 'payable') payable += a.balance;
  }

  const netAsset = totalAsset - totalLiability + receivable - payable;

  let monthly = { income: 0, expense: 0, balance: 0 };
  if (month) {
    const rows = db.prepare(
      "SELECT type, SUM(amount) s FROM entries WHERE date LIKE ? AND type IN ('income','expense') GROUP BY type"
    ).all(month + '%');
    for (const r of rows) {
      if (r.type === 'income') monthly.income = r.s;
      if (r.type === 'expense') monthly.expense = r.s;
    }
    monthly.balance = monthly.income - monthly.expense;
  }

  return {
    totalAsset,
    totalLiability,
    receivable,
    payable,
    netAsset,
    accounts,
    monthly,
  };
}
