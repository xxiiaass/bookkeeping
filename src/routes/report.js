import express from 'express';
import { report } from '../domain/report.js';

export function reportRouter(db) {
  const r = express.Router();

  r.get('/', (req, res) => {
    const { month } = req.query;
    res.json(report(db, { month }));
  });

  return r;
}
