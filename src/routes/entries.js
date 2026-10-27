import express from 'express';
import { listEntries, getEntry, addEntry, updateEntry, deleteEntry, balance } from '../domain/entries.js';

export function entriesRouter(db) {
  const r = express.Router();

  r.get('/', (req, res) => {
    const { month, limit } = req.query;
    res.json({ entries: listEntries(db, { month, limit: limit ? Number(limit) : 500 }) });
  });

  r.post('/', (req, res) => {
    const e = addEntry(db, req.body || {});
    res.json({ entry: e });
  });

  // 平账：清零现金
  r.post('/balance', (req, res) => {
    const { date, note } = req.body || {};
    const result = balance(db, date || new Date().toISOString().slice(0, 10), { note });
    res.json(result);
  });

  r.get('/:id', (req, res) => {
    const e = getEntry(db, Number(req.params.id));
    if (!e) return res.status(404).json({ error: 'not_found' });
    res.json({ entry: e });
  });

  r.patch('/:id', (req, res) => {
    const e = updateEntry(db, Number(req.params.id), req.body || {});
    if (!e) return res.status(404).json({ error: 'not_found' });
    res.json({ entry: e });
  });

  r.delete('/:id', (req, res) => {
    const ok = deleteEntry(db, Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  });

  return r;
}
