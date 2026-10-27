import express from 'express';

export function categoriesRouter(db) {
  const r = express.Router();

  r.get('/', (req, res) => {
    const rows = db.prepare('SELECT type, name, icon, color, sort FROM categories ORDER BY sort, id').all();
    const expense = rows.filter(c => c.type === 'expense');
    const income = rows.filter(c => c.type === 'income');
    res.json({ expense, income });
  });

  return r;
}
