import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'zhangben.db');

// 金额统一用「分」整数存储
export const CASH_ACCOUNT = '现金';

// 默认分类（从口袋记账截图提炼）
export const DEFAULT_CATEGORIES = {
  expense: [
    ['餐饮', '🍜', '#f5a623'],
    ['衣服鞋包', '👕', '#a06cd5'],
    ['生活用品', '🧴', '#8e9eef'],
    ['话费', '📱', '#5b8def'],
    ['电影演出', '🎬', '#4caf50'],
    ['医疗', '💊', '#a1887f'],
    ['婚庆随礼', '🧧', '#ec407a'],
    ['电子产品', '💻', '#42a5f5'],
    ['书', '📖', '#8d6e63'],
    ['运动', '🏃', '#66bb6a'],
    ['冤枉钱', '😅', '#bcaaa4'],
    ['人际', '🤝', '#ff7043'],
    ['父母', '👨‍👩‍👧', '#ab47bc'],
    ['娱乐', '🎮', '#9575cd'],
    ['房水电煤', '🏠', '#1e88e5'],
    ['房贷', '🏠', '#1565c0'],
    ['装修', '🔨', '#3949ab'],
    ['养车', '🚗', '#1e88e5'],
    ['交通', '🚌', '#43a047'],
    ['生活费', '💰', '#8e24aa'],
    ['小孩', '👶', '#ec407a'],
    ['旅游', '🏝', '#26a69a'],
    ['宠物', '🐱', '#26a69a'],
    ['保险', '🛡', '#5c6bc0'],
    ['菜', '🥬', '#7cb342'],
    ['房', '🏠', '#3949ab'],
    ['贷款利息', '💳', '#f9a825'],
    ['投资亏损', '📉', '#ef5350'],
    ['平账', '⚖️', '#ef5350'],
  ],
  income: [
    ['工资', '💰', '#42a5f5'],
    ['生活费', '💵', '#f9a825'],
    ['红包', '🧧', '#ec407a'],
    ['零花钱', '🐷', '#66bb6a'],
    ['外快兼职', '🧩', '#26c6da'],
    ['投资收入', '📈', '#a1887f'],
    ['奖金', '🏅', '#ff7043'],
    ['报销', '🧾', '#4dd0e1'],
    ['退款', '💸', '#81c784'],
    ['其他', '⭐', '#5c6bc0'],
    ['公积金提取', '🏠', '#1e88e5'],
    ['平账', '⚖️', '#ef5350'],
  ],
};

export function initDb(dbPath = DEFAULT_DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('asset','liability','receivable','payable')),
      sub_label TEXT DEFAULT '',
      balance INTEGER NOT NULL DEFAULT 0,
      sort INTEGER DEFAULT 0,
      shown INTEGER DEFAULT 1,
      color TEXT DEFAULT '#42a5f5',
      credit_limit INTEGER DEFAULT 0,
      meta TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('income','expense','transfer','balance')),
      category TEXT DEFAULT '',
      account_id INTEGER,
      target_account_id INTEGER,
      amount INTEGER NOT NULL DEFAULT 0,
      note TEXT DEFAULT '',
      is_balance INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS receivable_payable_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      date TEXT DEFAULT '',
      status TEXT DEFAULT 'open' CHECK(status IN ('open','done')),
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS periodic_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'expense',
      category TEXT DEFAULT '',
      account_id INTEGER,
      amount INTEGER NOT NULL DEFAULT 0,
      cron TEXT NOT NULL,
      next_run TEXT DEFAULT '',
      enabled INTEGER DEFAULT 1,
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('income','expense')),
      name TEXT NOT NULL,
      icon TEXT DEFAULT '🏷',
      color TEXT DEFAULT '#42a5f5',
      sort INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS asset_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      shown_total INTEGER NOT NULL DEFAULT 0,
      all_total INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_date ON asset_snapshots(date);
  `);

  seedIfEmpty(db);
  return db;
}

function seedIfEmpty(db) {
  const accountCount = db.prepare('SELECT COUNT(*) c FROM accounts').get().c;
  if (accountCount === 0) {
    // 现金账户必须先存在（平账中转枢纽）
    db.prepare(
      `INSERT INTO accounts (name, type, sub_label, sort, shown, color) VALUES (?, 'asset', '现金余额', 0, 1, '#42a5f5')`
    ).run(CASH_ACCOUNT);
  }

  const catCount = db.prepare('SELECT COUNT(*) c FROM categories').get().c;
  if (catCount === 0) {
    const ins = db.prepare(
      'INSERT INTO categories (type, name, icon, color, sort) VALUES (?, ?, ?, ?, ?)'
    );
    for (const [type, list] of Object.entries(DEFAULT_CATEGORIES)) {
      list.forEach(([name, icon, color], i) => {
        ins.run(type, name, icon, color, i);
      });
    }
  }
}

export function openDb(dbPath = DEFAULT_DB_PATH) {
  return new Database(dbPath);
}
