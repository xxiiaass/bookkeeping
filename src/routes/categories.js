import express from 'express';

export function categoriesRouter(db) {
  const r = express.Router();

  // 全量分类列表
  r.get('/', (req, res) => {
    const rows = db.prepare('SELECT id, type, name, icon, color, sort FROM categories ORDER BY sort, id').all();
    const expense = rows.filter(c => c.type === 'expense');
    const income = rows.filter(c => c.type === 'income');
    res.json({ expense, income });
  });

  // 新增分类：body {type:'expense'|'income', name, icon?, color?, sort?}
  r.post('/', (req, res) => {
    const { type, name, icon, color, sort } = req.body || {};
    if (!type || !['income', 'expense'].includes(type)) return res.status(400).json({ error: 'type 必须为 income 或 expense' });
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name 不能为空' });
    const dup = db.prepare('SELECT id FROM categories WHERE type=? AND name=?').get(type, name.trim());
    if (dup) return res.status(409).json({ error: `分类「${name}」已存在` });
    const maxSort = db.prepare('SELECT MAX(sort) m FROM categories WHERE type=?').get(type).m ?? -1;
    const info = db.prepare('INSERT INTO categories (type, name, icon, color, sort) VALUES (?,?,?,?,?)')
      .run(type, name.trim(), icon || '🏷', color || '#42a5f5', sort ?? maxSort + 1);
    const row = db.prepare('SELECT id, type, name, icon, color, sort FROM categories WHERE id=?').get(info.lastInsertRowid);
    res.json(row);
  });

  // 修改分类：body 任意 {name?, icon?, color?, sort?}
  r.patch('/:id', (req, res) => {
    const id = Number(req.params.id);
    const cur = db.prepare('SELECT * FROM categories WHERE id=?').get(id);
    if (!cur) return res.status(404).json({ error: '分类不存在' });
    const { name, icon, color, sort } = req.body || {};
    if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'name 不能为空' });
    db.prepare('UPDATE categories SET name=?, icon=?, color=?, sort=? WHERE id=?')
      .run(
        name !== undefined ? String(name).trim() : cur.name,
        icon !== undefined ? icon : cur.icon,
        color !== undefined ? color : cur.color,
        sort !== undefined ? Number(sort) : cur.sort,
        id,
      );
    const row = db.prepare('SELECT id, type, name, icon, color, sort FROM categories WHERE id=?').get(id);
    res.json(row);
  });

  // 删除分类
  r.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    const cur = db.prepare('SELECT * FROM categories WHERE id=?').get(id);
    if (!cur) return res.status(404).json({ error: '分类不存在' });
    // 已被流水引用的分类不可删，避免历史记录失去分类语义
    const used = db.prepare('SELECT COUNT(*) c FROM entries WHERE category=?').get(cur.name).c;
    if (used > 0) return res.status(409).json({ error: `分类「${cur.name}」已被 ${used} 条流水使用，不能删除（可改名或保留）` });
    db.prepare('DELETE FROM categories WHERE id=?').run(id);
    res.json({ ok: true });
  });

  return r;
}
