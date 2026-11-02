import express from 'express';
import { listSnapshots, snapshotToday } from '../domain/snapshots.js';
import { localDate } from '../domain/date.js';

export function snapshotsRouter(db) {
  const r = express.Router();

  r.get('/', (req, res) => {
    const { from, to, limit } = req.query;
    res.json({ snapshots: listSnapshots(db, {
      from, to, limit: limit ? Number(limit) : 365,
    }) });
  });

  // 手动触发一次今日快照（便于测试）
  r.post('/snapshot', (req, res) => {
    const date = (req.body && req.body.date) || localDate();
    res.json({ snapshot: snapshotToday(db, date) });
  });

  return r;
}
