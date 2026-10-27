import express from 'express';
import { listPeriodic, getPeriodic, createPeriodic, updatePeriodic, deletePeriodic, runDue } from '../domain/periodic.js';

export function periodicRouter(db) {
  const r = express.Router();

  r.get('/', (req, res) => {
    res.json({ periodic: listPeriodic(db) });
  });

  r.post('/', (req, res) => {
    const p = createPeriodic(db, req.body || {});
    res.json({ periodic: p });
  });

  r.post('/run-due', (req, res) => {
    const generated = runDue(db);
    res.json({ ok: true, generated });
  });

  r.get('/:id', (req, res) => {
    const p = getPeriodic(db, Number(req.params.id));
    if (!p) return res.status(404).json({ error: 'not_found' });
    res.json({ periodic: p });
  });

  r.patch('/:id', (req, res) => {
    const p = updatePeriodic(db, Number(req.params.id), req.body || {});
    if (!p) return res.status(404).json({ error: 'not_found' });
    res.json({ periodic: p });
  });

  r.delete('/:id', (req, res) => {
    const ok = deletePeriodic(db, Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  });

  return r;
}
