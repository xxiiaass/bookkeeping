import express from 'express';
import {
  listAccounts, getAccount, createAccount, updateAccount,
  deleteAccount, flatten, getCashAccount,
} from '../domain/accounts.js';
import { listEntries } from '../domain/entries.js';

export function accountsRouter(db) {
  const r = express.Router();

  r.get('/', (req, res) => {
    res.json({ accounts: listAccounts(db) });
  });

  r.get('/cash', (req, res) => {
    res.json({ cash: getCashAccount(db) });
  });

  r.post('/', (req, res) => {
    const a = createAccount(db, req.body || {});
    res.json({ account: a });
  });

  r.get('/:id', (req, res) => {
    const a = getAccount(db, Number(req.params.id));
    if (!a) return res.status(404).json({ error: 'not_found' });
    res.json({ account: a });
  });

  r.patch('/:id', (req, res) => {
    const a = updateAccount(db, Number(req.params.id), req.body || {});
    if (!a) return res.status(404).json({ error: 'not_found' });
    res.json({ account: a });
  });

  r.delete('/:id', (req, res) => {
    const ok = deleteAccount(db, Number(req.params.id));
    if (!ok) return res.status(400).json({ error: 'cannot_delete' });
    res.json({ ok: true });
  });

  // 批量平账：POST { date, balances: { accountId: actualBalance, ... } }
  r.post('/flatten', (req, res) => {
    const { date, balances } = req.body || {};
    const results = flatten(db, balances || {}, date || new Date().toISOString().slice(0, 10));
    res.json({ ok: true, results, cash: getCashAccount(db) });
  });

  // 账户流水
  r.get('/:id/entries', (req, res) => {
    const id = Number(req.params.id);
    const entries = listEntries(db).filter(e => e.account_id === id || e.target_account_id === id);
    res.json({ entries });
  });

  return r;
}
