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

  // 应收计入资产，应付计入负债（口袋记账口径）
  const netAsset = totalAsset - totalLiability + receivable - payable;

  let monthly = { income: 0, expense: 0, balance: 0 };
  let byCategory = { income: [], expense: [] };
  if (month) {
    const rows = db.prepare(
      "SELECT type, SUM(amount) s FROM entries WHERE date LIKE ? AND type IN ('income','expense') GROUP BY type"
    ).all(month + '%');
    for (const r of rows) {
      if (r.type === 'income') monthly.income = r.s;
      if (r.type === 'expense') monthly.expense = r.s;
    }
    monthly.balance = monthly.income - monthly.expense;

    // 按分类聚合（收入 + 支出）
    const catRows = db.prepare(
      "SELECT type, category, SUM(amount) s FROM entries WHERE date LIKE ? AND type IN ('income','expense') GROUP BY type, category ORDER BY s DESC"
    ).all(month + '%');
    for (const r of catRows) {
      byCategory[r.type].push({ category: r.category || '其他', amount: r.s });
    }
  }

  return {
    totalAsset,
    totalLiability,
    receivable,
    payable,
    netAsset,
    accounts,
    monthly,
    byCategory,
  };
}
