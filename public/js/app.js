// AI 记账前端 —— 照抄口袋记账的页面设计
const state = {
  token: localStorage.getItem('zb_token') || '',
  tab: 'assets',          // assets | liabilities | entries | report | settings
  accounts: [],
  categories: { expense: [], income: [] },
  month: new Date().toISOString().slice(0, 7),  // 账单/报表当前月份 YYYY-MM
  // 录入
  entryType: 'expense',
  entryCategory: '',
  entryAmount: '',
  entryDate: new Date().toISOString().slice(0, 10),
  entryNote: '',
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.token, ...(opts.headers || {}) },
  });
  if (res.status === 401) {
    state.token = ''; localStorage.removeItem('zb_token'); showLogin();
    throw new Error('unauthorized');
  }
  return res.json();
}

const fmt = (v) => ((v || 0) / 100).toFixed(2);
const today = () => new Date().toISOString().slice(0, 10);
const toFen = (val) => { const n = parseFloat(val); return isNaN(n) ? null : Math.round(n * 100); };

// ---------- Toast / 弹窗 ----------
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2200);
}

function confirmDialog(text) {
  return new Promise((resolve) => {
    $('#confirm-text').textContent = text;
    $('#confirm-modal').classList.remove('hidden');
    const onOk = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    const cleanup = () => {
      $('#confirm-modal').classList.add('hidden');
      $('#confirm-ok').removeEventListener('click', onOk);
      $('#confirm-cancel').removeEventListener('click', onCancel);
    };
    $('#confirm-ok').addEventListener('click', onOk);
    $('#confirm-cancel').addEventListener('click', onCancel);
  });
}

// fields: [{key,label,type,value,options,placeholder}]
function formDialog(title, fields, onSubmit) {
  $('#form-modal-title').textContent = title;
  const body = $('#form-modal-body');
  body.innerHTML = fields.map(f => {
    const id = `fd-${f.key}`;
    if (f.type === 'select') {
      const opts = (f.options || []).map(o => {
        const [val, label] = Array.isArray(o) ? o : [o, o];
        return `<option value="${val}" ${String(val) === String(f.value) ? 'selected' : ''}>${label}</option>`;
      }).join('');
      return `<div><div class="field-label">${f.label}</div><select class="field-select" id="${id}">${opts}</select></div>`;
    }
    return `<div><div class="field-label">${f.label}</div><input class="field-input" type="${f.type || 'text'}" id="${id}" value="${f.value ?? ''}" placeholder="${f.placeholder || ''}"></div>`;
  }).join('');
  body.innerHTML += `<div class="form-actions"><button class="btn-ghost" id="form-cancel">取消</button><button class="btn-primary" id="form-ok">确定</button></div>`;

  $('#form-modal').classList.remove('hidden');
  const close = () => $('#form-modal').classList.add('hidden');
  $('#form-cancel').addEventListener('click', close);
  $('#form-modal-close').addEventListener('click', close);
  $('#form-ok').addEventListener('click', () => {
    const result = {};
    for (const f of fields) result[f.key] = $(`#fd-${f.key}`).value;
    close(); onSubmit(result);
  });
}

// ---------- 登录 ----------
function showLogin() { $('#login-view').classList.remove('hidden'); $('#main-view').classList.add('hidden'); $('#bottom-nav').classList.add('hidden'); }
function showMain() { $('#login-view').classList.add('hidden'); $('#main-view').classList.remove('hidden'); $('#bottom-nav').classList.remove('hidden'); }

async function doLogin() {
  const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('#login-password').value }) });
  const data = await res.json();
  if (data.ok && data.token) {
    state.token = data.token; localStorage.setItem('zb_token', state.token);
    showMain(); refresh();
  } else {
    $('#login-err').textContent = '密码错误';
  }
}

// ---------- 分类 ----------
function loadCategories() {
  state.categories.expense = [
    ['餐饮','🍜','#f5a623'],['衣服鞋包','👕','#a06cd5'],['生活用品','🧴','#8e9eef'],['话费','📱','#5b8def'],
    ['医疗','💊','#a1887f'],['交通','🚌','#43a047'],['房贷','🏠','#1565c0'],['养车','🚗','#1e88e5'],
    ['房水电煤','🏠','#1e88e5'],['贷款利息','💳','#f9a825'],['娱乐','🎮','#9575cd'],['旅游','🏝','#26a69a'],
    ['宠物','🐱','#26a69a'],['冤枉钱','😅','#bcaaa4'],['人际','🤝','#ff7043'],['装修','🔨','#3949ab'],
    ['生活费','💰','#8e24aa'],['保险','🛡','#5c6bc0'],['平账','⚖️','#ef5350'],
  ].map(([name,icon,color]) => ({name,icon,color}));
  state.categories.income = [
    ['工资','💰','#42a5f5'],['生活费','💵','#f9a825'],['红包','🧧','#ec407a'],['零花钱','🐷','#66bb6a'],
    ['外快兼职','🧩','#26c6da'],['投资收入','📈','#a1887f'],['奖金','🏅','#ff7043'],['报销','🧾','#4dd0e1'],
    ['退款','💸','#81c784'],['其他','⭐','#5c6bc0'],['平账','⚖️','#ef5350'],
  ].map(([name,icon,color]) => ({name,icon,color}));
}

function catInfo(type, name) {
  const list = type === 'income' ? state.categories.income : state.categories.expense;
  return list.find(c => c.name === name) || { icon: '🏷', color: '#999' };
}

// ---------- 数据 ----------
async function refresh() {
  try {
    loadCategories();
    const [accRes, reportRes] = await Promise.all([api('/api/accounts'), api('/api/report')]);
    state.accounts = accRes.accounts;
    renderSummary(reportRes);
    renderTab();
  } catch (e) { if (e.message !== 'unauthorized') console.error(e); }
}

const PALETTE = ['#29abe2', '#ef5350', '#26c6da', '#ab47bc', '#5c6bc0', '#ec407a', '#ff7043', '#66bb6a', '#e57373', '#f9a825'];

function renderSummary(report) {
  const card = $('#summary-card');
  if (state.tab === 'assets') {
    card.classList.remove('hidden');
    card.innerHTML = `
      <div><div class="label" id="assets-filter-trigger">资产 <span class="arrow">▼</span></div><div class="amount">¥${fmt(report.totalAsset)}</div><div class="sub">净资产 ¥${fmt(report.netAsset)}</div></div>
      <div class="summary-right"><span class="eye" id="eye-toggle">👁</span></div>
    `;
    $('#assets-filter-trigger')?.addEventListener('click', () => showAccountFilter('asset'));
  } else if (state.tab === 'liabilities') {
    card.classList.remove('hidden');
    card.innerHTML = `
      <div><div class="label" id="liab-filter-trigger">负债 <span class="arrow">▼</span></div><div class="amount">¥${fmt(report.totalLiability)}</div></div>
      <div class="summary-right"><span class="eye" id="eye-toggle">👁</span></div>
    `;
    $('#liab-filter-trigger')?.addEventListener('click', () => showAccountFilter('liability'));
  } else {
    card.classList.add('hidden');
  }
}

// 照抄口袋记账：点击「资产/负债」倒三角，弹出「选择要展示的账户」多选列表
function showAccountFilter(type) {
  const accounts = state.accounts.filter(a => a.type === type);
  const body = $('#form-modal-body');
  $('#form-modal-title').textContent = type === 'asset' ? '选择要展示的账户' : '选择要展示的负债账户';
  body.innerHTML = accounts.map(a => `
    <label class="filter-row" style="display:flex;align-items:center;gap:10px;padding:12px;border-bottom:1px solid #f5f5f5;cursor:pointer">
      <input type="checkbox" data-filter-id="${a.id}" ${a.shown ? 'checked' : ''} style="width:20px;height:20px">
      <span style="font-size:15px">${a.name}</span>
    </label>
  `).join('');
  body.innerHTML += `<div class="form-actions"><button class="btn-primary" id="filter-ok">确定</button></div>`;

  $('#form-modal').classList.remove('hidden');
  const close = () => $('#form-modal').classList.add('hidden');
  $('#form-modal-close').addEventListener('click', close);
  $('#filter-ok').addEventListener('click', async () => {
    const checks = $$('input[data-filter-id]');
    for (const chk of checks) {
      const id = Number(chk.dataset.filterId);
      const shown = chk.checked ? 1 : 0;
      const a = state.accounts.find(x => x.id === id);
      if (a && a.shown !== shown) {
        await api(`/api/accounts/${id}`, { method: 'PATCH', body: JSON.stringify({ shown }) });
      }
    }
    close(); refresh();
  });
}

async function renderTab() {
  const c = $('#content');
  if (state.tab === 'assets') return renderAssets(c);
  if (state.tab === 'liabilities') return renderLiabilities(c);
  if (state.tab === 'entries') return renderEntries(c);
  if (state.tab === 'report') return renderReport(c);
  if (state.tab === 'settings') return renderSettings(c);
}

// ---------- 资产页（含应收，照抄口袋记账） ----------
function renderAssets(c) {
  const assets = state.accounts.filter(a => a.type === 'asset' && a.shown);
  const receivables = state.accounts.filter(a => a.type === 'receivable' && a.shown);

  let html = assets.map((a, i) => `
    <div class="account-card" style="background:${a.color || PALETTE[i % PALETTE.length]}" data-id="${a.id}">
      <div class="acc-left">
        <div class="acc-icon">${a.name === '现金' ? '¥' : '🏦'}</div>
        <div><div class="acc-name">${a.name}</div><div class="acc-sub">${a.sub_label || ''}</div></div>
      </div>
      <div class="acc-right"><div class="acc-balance">${fmt(a.balance)}</div></div>
    </div>
  `).join('');

  if (receivables.length > 0) {
    html += `<div class="section-title">应收账款</div>`;
    html += receivables.map((a, i) => `
      <div class="account-card" style="background:${a.color || '#ff7043'}" data-recv="${a.id}">
        <div class="acc-left">
          <div class="acc-icon">收</div>
          <div><div class="acc-name">${a.name}</div><div class="acc-sub">应收总额 · 点开看明细</div></div>
        </div>
        <div class="acc-right"><div class="acc-balance">${fmt(a.balance)}</div></div>
      </div>
    `).join('');
  }

  html += `<button class="add-account-btn" id="add-account-btn">＋ 添加账户</button>`;
  c.innerHTML = html;

  // 点击资产账户 → 编辑
  $$('.account-card[data-id]').forEach(el => {
    el.addEventListener('click', () => editAccount(Number(el.dataset.id)));
  });
  // 点击应收 → 进入应收明细页
  $$('.account-card[data-recv]').forEach(el => {
    el.addEventListener('click', () => renderReceivableDetail(c, Number(el.dataset.recv)));
  });
  $('#add-account-btn')?.addEventListener('click', () => addAccountDialog());
}

// ---------- 负债页（含应付/借款，照抄口袋记账） ----------
function renderLiabilities(c) {
  const liabs = state.accounts.filter(a => a.type === 'liability' && a.shown);
  const payables = state.accounts.filter(a => a.type === 'payable' && a.shown);

  let html = liabs.map((a, i) => `
    <div class="account-card" style="background:${a.color || PALETTE[(i + 1) % PALETTE.length]}" data-id="${a.id}">
      <div class="acc-left">
        <div class="acc-icon">💳</div>
        <div>
          <div class="acc-name">${a.name}</div>
          <div class="acc-sub">${a.sub_label || ''}</div>
        </div>
      </div>
      <div class="acc-right">
        <div class="acc-balance">${fmt(a.balance)}</div>
        <div class="acc-extra">${a.credit_limit ? '剩余额度 ' + fmt(a.credit_limit) : ''}</div>
      </div>
    </div>
  `).join('');

  if (payables.length > 0) {
    html += `<div class="section-title">借款（我欠别人的钱）</div>`;
    html += payables.map((a, i) => `
      <div class="account-card" style="background:${a.color || '#ef6fa7'}" data-pay="${a.id}">
        <div class="acc-left">
          <div class="acc-icon">🏠</div>
          <div><div class="acc-name">${a.name}</div><div class="acc-sub">我欠别人的钱 · 点开看明细</div></div>
        </div>
        <div class="acc-right"><div class="acc-balance">${fmt(a.balance)}</div></div>
      </div>
    `).join('');
  }

  html += `<button class="add-account-btn" id="add-liab-btn">＋ 添加负债账户</button>`;
  c.innerHTML = html;

  $$('.account-card[data-id]').forEach(el => {
    el.addEventListener('click', () => editAccount(Number(el.dataset.id)));
  });
  $$('.account-card[data-pay]').forEach(el => {
    el.addEventListener('click', () => renderPayableDetail(c, Number(el.dataset.pay)));
  });
  $('#add-liab-btn')?.addEventListener('click', () => addAccountDialog('liability'));
}

// ---------- 应收明细页（橙色头，照抄） ----------
async function renderReceivableDetail(c, accountId) {
  const res = await api('/api/receivables?type=receivable');
  const items = res.items.filter(it => it.account_id === accountId);
  const acc = state.accounts.find(a => a.id === accountId);
  const total = items.reduce((s, it) => s + it.amount, 0);

  const groups = {};
  for (const it of items) (groups[it.date || '未标注日期'] ||= []).push(it);

  let html = `
    <div class="detail-header" style="background:#ff8a3d;color:#fff;border-radius:0 0 16px 16px;padding:16px;margin:-8px -12px 12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-size:14px">‹ 返回</span>
        <span style="font-size:14px">未完成 ▼</span>
        <span style="font-size:14px" id="rcv-back">设置</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:14px">应收总额</span>
        <span style="font-size:28px;font-weight:700">¥${fmt(total)}</span>
      </div>
    </div>
  `;

  for (const date of Object.keys(groups).sort().reverse()) {
    html += `<div class="group-date">${date}</div>`;
    for (const it of groups[date]) {
      html += `
        <div class="list-item" data-item="${it.id}">
          <div class="li-left">
            <div class="li-icon" style="background:#ff8a3d">收</div>
            <div><div class="li-name">${it.name}</div><div class="li-sub">${it.status === 'done' ? '已结清' : ''}</div></div>
          </div>
          <div class="li-amount">${fmt(it.amount)}</div>
        </div>
      `;
    }
  }
  html += `<button class="add-record-btn" id="add-item-btn">＋ 添加记录</button>`;
  c.innerHTML = html;

  $('#rcv-back').addEventListener('click', () => renderTab());
  $$('.list-item[data-item]').forEach(el => {
    el.addEventListener('click', async () => {
      const it = items.find(x => x.id == el.dataset.item);
      const ok = await confirmDialog(`是否标记「${it.name}」为已结清？`);
      if (ok) { await api(`/api/receivables/${it.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) }); renderReceivableDetail(c, accountId); }
    });
  });
  $('#add-item-btn').addEventListener('click', () => addItemDialog('receivable', accountId));
}

// ---------- 应付明细页（粉色头，照抄） ----------
async function renderPayableDetail(c, accountId) {
  const res = await api('/api/receivables?type=payable');
  const items = res.items.filter(it => it.account_id === accountId);
  const total = items.reduce((s, it) => s + it.amount, 0);

  const groups = {};
  for (const it of items) (groups[it.date || '未标注日期'] ||= []).push(it);

  let html = `
    <div class="detail-header" style="background:#ef6fa7;color:#fff;border-radius:0 0 16px 16px;padding:16px;margin:-8px -12px 12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-size:14px">‹ 返回</span>
        <span style="font-size:14px">未完成 ▼</span>
        <span style="font-size:14px" id="pay-back">设置</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:14px">应付总额</span>
        <span style="font-size:28px;font-weight:700">¥${fmt(total)}</span>
      </div>
    </div>
  `;

  for (const date of Object.keys(groups).sort().reverse()) {
    html += `<div class="group-date">${date}</div>`;
    for (const it of groups[date]) {
      html += `
        <div class="list-item" data-item="${it.id}">
          <div class="li-left">
            <div class="li-icon" style="background:#ef6fa7">付</div>
            <div><div class="li-name">${it.name}</div><div class="li-sub">${it.status === 'done' ? '已结清' : ''}</div></div>
          </div>
          <div class="li-amount">${fmt(it.amount)}</div>
        </div>
      `;
    }
  }
  html += `<button class="add-record-btn" id="add-item-btn">＋ 添加记录</button>`;
  c.innerHTML = html;

  $('#pay-back').addEventListener('click', () => renderTab());
  $$('.list-item[data-item]').forEach(el => {
    el.addEventListener('click', async () => {
      const it = items.find(x => x.id == el.dataset.item);
      const ok = await confirmDialog(`是否标记「${it.name}」为已结清？`);
      if (ok) { await api(`/api/receivables/${it.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) }); renderPayableDetail(c, accountId); }
    });
  });
  $('#add-item-btn').addEventListener('click', () => addItemDialog('payable', accountId));
}

// ---------- 账单流水页（照抄） ----------
async function renderEntries(c) {
  const res = await api(`/api/entries?month=${state.month}&limit=500`);
  const entries = res.entries;

  // 月度汇总
  let income = 0, expense = 0;
  for (const e of entries) {
    if (e.type === 'income') income += e.amount;
    else if (e.type === 'expense' || e.type === 'balance') expense += e.amount;
  }

  const [y, m] = state.month.split('-');
  let html = `
    <div class="month-summary">
      <div class="ms-item"><div class="ms-label">${m}月收入</div><div class="ms-amount" style="color:#333">¥${fmt(income)}</div></div>
      <div class="ms-item"><div class="ms-label">${m}月支出</div><div class="ms-amount" style="color:#ef5350">¥${fmt(expense)}</div></div>
    </div>
  `;

  // 按日期分组
  const groups = {};
  for (const e of entries) (groups[e.date] ||= []).push(e);

  const sortedDates = Object.keys(groups).sort().reverse();
  if (sortedDates.length === 0) {
    html += `<div style="text-align:center;color:#999;padding:40px 0">本月暂无流水</div>`;
  }
  for (const date of sortedDates) {
    const day = date.slice(8, 10);
    const dayExpense = groups[date].filter(e => e.type === 'expense' || e.type === 'balance').reduce((s, e) => s + e.amount, 0);
    html += `<div class="group-date"><span class="gdot">${day}日</span><span>支出 ${fmt(dayExpense)}</span></div>`;
    for (const e of groups[date]) {
      const isIncome = e.type === 'income';
      const ci = catInfo(isIncome ? 'income' : 'expense', e.category);
      const sign = isIncome ? '+' : e.type === 'transfer' ? '⇄' : '-';
      html += `
        <div class="list-item" data-id="${e.id}">
          <div class="li-left">
            <div class="li-icon" style="background:${ci.color}">${ci.icon}</div>
            <div><div class="li-name">${e.category || e.type}${e.is_balance ? ' ⚖️' : ''}</div><div class="li-sub">${e.note || (e.type === 'transfer' ? '转账' : '')}</div></div>
          </div>
          <div class="li-amount ${isIncome ? 'amount-income' : 'amount-expense'}">${sign}${fmt(e.amount)}</div>
        </div>
      `;
    }
  }
  html += `<button class="add-record-btn" id="balance-btn">⚖️ 记平账（清零现金）</button>`;
  c.innerHTML = html;

  $$('.list-item[data-id]').forEach(el => {
    el.addEventListener('click', () => editEntry(Number(el.dataset.id), entries.find(x => x.id == el.dataset.id)));
  });
  $('#balance-btn')?.addEventListener('click', async () => {
    formDialog('记平账', [
      { key: 'date', label: '日期', type: 'date', value: today() },
      { key: 'note', label: '备注', type: 'text', value: '一般性支出（平账）' },
    ], async (r) => {
      await api('/api/entries/balance', { method: 'POST', body: JSON.stringify({ date: r.date, note: r.note }) });
      toast('已平账清零'); refresh();
    });
  });
}

// ---------- 报表页（环形图 + 分类统计，照抄） ----------
async function renderReport(c) {
  const res = await api(`/api/entries?month=${state.month}&limit=500`);
  const entries = res.entries.filter(e => e.type === 'expense' || e.type === 'balance');

  // 按分类聚合支出
  const byCat = {};
  for (const e of entries) byCat[e.category || '其他'] = (byCat[e.category || '其他'] || 0) + e.amount;
  const total = Object.values(byCat).reduce((s, v) => s + v, 0);

  const list = Object.entries(byCat).map(([name, amount]) => ({ name, amount, pct: total ? amount / total : 0 }));
  list.sort((a, b) => b.amount - a.amount);

  // 环形图用 SVG
  const chartColors = ['#3b82f6', '#f5a623', '#ab47bc', '#ff8a3d', '#f9a825', '#a1887f', '#26c6da', '#8e9eef', '#66bb6a'];
  let segs = '';
  let acc = 0;
  const R = 70, CX = 90, CY = 90;
  list.forEach((it, i) => {
    const start = acc, end = acc + it.pct;
    acc = end;
    const a0 = start * 2 * Math.PI - Math.PI / 2;
    const a1 = end * 2 * Math.PI - Math.PI / 2;
    const x0 = CX + R * Math.cos(a0), y0 = CY + R * Math.sin(a0);
    const x1 = CX + R * Math.cos(a1), y1 = CY + R * Math.sin(a1);
    const large = (end - start) > 0.5 ? 1 : 0;
    segs += `<path d="M ${CX} ${CY} L ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} Z" fill="${chartColors[i % chartColors.length]}"></path>`;
  });

  const [y, m] = state.month.split('-');
  let html = `
    <div class="report-month-nav">
      <button id="rm-prev">‹</button>
      <span class="rm-label">${m}月01日~${lastDay(y, m)}日</span>
      <button id="rm-next">›</button>
    </div>
    <div class="report-chart-wrap">
      <div class="report-donut">
        <svg width="180" height="180" viewBox="0 0 180 180">
          ${total === 0 ? `<circle cx="90" cy="90" r="70" fill="#eee"></circle>` : segs}
          <circle cx="90" cy="90" r="40" fill="#f7f3ec"></circle>
        </svg>
        <div class="report-center">
          <div class="rc-label">总支出</div>
          <div class="rc-amount">¥${fmt(total)}</div>
        </div>
      </div>
    </div>
  `;

  for (const it of list) {
    const ci = catInfo('expense', it.name);
    html += `
      <div class="cat-stat">
        <div class="li-icon" style="background:${ci.color}">${ci.icon}</div>
        <div style="flex:1;margin:0 8px">
          <div style="display:flex;justify-content:space-between;font-size:14px">
            <span>${it.name}</span><span>${(it.pct * 100).toFixed(1)}%</span>
          </div>
          <div class="bar-track" style="margin-top:6px"><div class="bar-fill" style="width:${(it.pct * 100).toFixed(1)}%;background:${ci.color}"></div></div>
        </div>
        <div style="font-weight:600;font-size:14px">${fmt(it.amount)}</div>
      </div>
    `;
  }
  if (list.length === 0) html += `<div style="text-align:center;color:#999;padding:40px 0">本月暂无支出</div>`;
  c.innerHTML = html;

  $('#rm-prev').addEventListener('click', () => { shiftMonth(-1); renderTab(); });
  $('#rm-next').addEventListener('click', () => { shiftMonth(1); renderTab(); });
}

function shiftMonth(delta) {
  const [y, m] = state.month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  state.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function lastDay(y, m) {
  return new Date(Number(y), Number(m), 0).getDate();
}

// ---------- 设置页 ----------
async function renderSettings(c) {
  const res = await api('/api/auth/settings');
  const smtp = res.smtp || {};
  c.innerHTML = `
    <div class="setting-item">
      <label>网页密码</label>
      <input type="text" id="set-pwd" value="${res.web_password}">
    </div>
    <div class="setting-item">
      <label>API Token（点击复制）</label>
      <div class="token-box" id="token-box">${state.token}</div>
    </div>
    <div class="setting-item">
      <label>邮件备份（SMTP）</label>
      <div class="field-label">SMTP 服务器</div>
      <input class="field-input" id="set-smtp-host" value="${smtp.host || ''}" placeholder="smtp.qq.com">
      <div class="field-label" style="margin-top:8px">端口</div>
      <input class="field-input" id="set-smtp-port" type="number" value="${smtp.port || 465}" placeholder="465">
      <div class="field-label" style="margin-top:8px">发件邮箱</div>
      <input class="field-input" id="set-smtp-user" value="${smtp.user || ''}" placeholder="xx@qq.com">
      <div class="field-label" style="margin-top:8px">授权码 / 密码</div>
      <input class="field-input" id="set-smtp-pass" type="password" value="${smtp.pass || ''}" placeholder="SMTP 授权码">
      <div class="field-label" style="margin-top:8px">收件邮箱</div>
      <input class="field-input" id="set-smtp-to" value="${smtp.to || ''}" placeholder="收件邮箱">
    </div>
    <button class="btn-primary" id="save-settings-btn" style="width:100%">保存设置</button>
    <button class="btn-ghost" id="periodic-manage-btn" style="width:100%;margin-top:10px">管理周期账</button>
  `;
  $('#save-settings-btn').addEventListener('click', async () => {
    const smtp = {
      host: $('#set-smtp-host').value.trim(),
      port: parseInt($('#set-smtp-port').value) || 465,
      user: $('#set-smtp-user').value.trim(),
      pass: $('#set-smtp-pass').value,
      to: $('#set-smtp-to').value.trim(),
    };
    await api('/api/auth/settings', { method: 'POST', body: JSON.stringify({ web_password: $('#set-pwd').value, smtp }) });
    toast('设置已保存');
  });
  $('#token-box').addEventListener('click', () => { navigator.clipboard.writeText(state.token); toast('Token 已复制'); });
  $('#periodic-manage-btn').addEventListener('click', () => renderPeriodic(c));
}

// ---------- 周期账管理（独立视图） ----------
async function renderPeriodic(c) {
  const res = await api('/api/periodic');
  const list = res.periodic;
  let html = `<div class="section-title">周期账（自动记账）</div>`;
  html += list.map(p => `
    <div class="list-item" data-p="${p.id}">
      <div class="li-left">
        <div class="li-icon" style="background:#5c6bc0">🔄</div>
        <div><div class="li-name">${p.name} ${p.enabled ? '' : '(停用)'}</div><div class="li-sub">${cronDesc(p.cron)} · 下次 ${(p.next_run || '').slice(0, 10)}</div></div>
      </div>
      <div class="li-amount">¥${fmt(p.amount)}</div>
    </div>
  `).join('');
  html += `
    <button class="add-record-btn" id="add-periodic-btn">＋ 添加周期账</button>
    <button class="btn-ghost" id="back-settings-btn" style="width:100%">返回设置</button>
  `;
  c.innerHTML = html;

  $('#add-periodic-btn').addEventListener('click', () => addPeriodicDialog());
  $('#back-settings-btn').addEventListener('click', () => renderTab());
  $$('.list-item[data-p]').forEach(el => {
    el.addEventListener('click', async () => {
      const p = list.find(x => x.id == el.dataset.p);
      const ok = await confirmDialog(`是否${p.enabled ? '停用' : '启用'}「${p.name}」？`);
      if (ok) { await api(`/api/periodic/${p.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: p.enabled ? 0 : 1 }) }); renderPeriodic(c); }
    });
  });
}

function cronDesc(cron) {
  if (typeof cron === 'string' && cron.startsWith('MONTHLY:')) return `每月${cron.split(':')[1]}号`;
  return cron || '';
}

// ---------- 录入弹层 ----------
function openEntryModal() {
  state.entryType = 'expense'; state.entryCategory = ''; state.entryAmount = ''; state.entryNote = '';
  $('#entry-modal').classList.remove('hidden');
  renderEntryModal();
}
function closeEntryModal() { $('#entry-modal').classList.add('hidden'); }

function renderEntryModal() {
  const body = $('#entry-body');
  const isTransfer = state.entryType === 'transfer';
  const cats = state.entryType === 'income' ? state.categories.income : state.categories.expense;
  body.innerHTML = `
    <div class="amount-display">¥ ${state.entryAmount || '0.00'}</div>
    ${isTransfer ? transferForm() : `
      <div class="cat-grid">
        ${cats.map(cat => `
          <div class="cat-item ${state.entryCategory === cat.name ? 'selected' : ''}" data-cat="${cat.name}">
            <div class="cat-icon" style="background:${cat.color}">${cat.icon}</div>
            <div class="cat-name">${cat.name}</div>
          </div>`).join('')}
      </div>
      <div class="form-row" style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <span style="font-size:13px;color:#999">日期</span>
        <input type="date" id="entry-date" value="${state.entryDate}" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:8px">
      </div>
      <div class="form-row" style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <span style="font-size:13px;color:#999">备注</span>
        <input type="text" id="entry-note" value="${state.entryNote}" placeholder="可选" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:8px">
      </div>
      <div class="keypad">
        ${['7','8','9','⌫','4','5','6','+','1','2','3','−','C','0','.','确定'].map(k => `<button class="key ${k === '确定' ? 'key-ok' : ''}" data-key="${k}">${k}</button>`).join('')}
      </div>
    `}
  `;

  $$('.cat-item').forEach(el => el.addEventListener('click', () => { state.entryCategory = el.dataset.cat; renderEntryModal(); }));
  $$('.key').forEach(el => el.addEventListener('click', () => handleKey(el.dataset.key)));
}

function transferForm() {
  const accs = state.accounts.filter(a => a.type === 'asset' || a.type === 'liability');
  return `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <span style="font-size:13px;color:#999;width:40px">转出</span>
      <select id="tr-from" class="field-select" style="flex:1">${accs.map(a => `<option value="${a.id}">${a.name}</option>`).join('')}</select>
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <span style="font-size:13px;color:#999;width:40px">转入</span>
      <select id="tr-to" class="field-select" style="flex:1">${accs.map(a => `<option value="${a.id}">${a.name}</option>`).join('')}</select>
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <span style="font-size:13px;color:#999;width:40px">日期</span>
      <input type="date" id="entry-date" value="${state.entryDate}" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:8px">
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <span style="font-size:13px;color:#999;width:40px">备注</span>
      <input type="text" id="entry-note" value="${state.entryNote}" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:8px">
    </div>
    <div class="keypad">
      ${['7','8','9','⌫','4','5','6','+','1','2','3','−','C','0','.','确定'].map(k => `<button class="key ${k === '确定' ? 'key-ok' : ''}" data-key="${k}">${k}</button>`).join('')}
    </div>
  `;
}

function handleKey(k) {
  if (k === '确定') return submitEntry();
  if (k === '⌫') state.entryAmount = state.entryAmount.slice(0, -1);
  else if (k === 'C') state.entryAmount = '';
  else if (k === '.') { if (!state.entryAmount.includes('.')) state.entryAmount += state.entryAmount ? '.' : '0.'; }
  else state.entryAmount += k;
  renderEntryModal();
}

async function submitEntry() {
  const amount = toFen(state.entryAmount);
  if (!amount) { toast('请输入金额'); return; }
  const date = $('#entry-date')?.value || state.entryDate;
  const note = $('#entry-note')?.value || '';
  if (state.entryType === 'transfer') {
    await api('/api/entries', { method: 'POST', body: JSON.stringify({ date, type: 'transfer', account_id: Number($('#tr-from').value), target_account_id: Number($('#tr-to').value), amount, note }) });
  } else {
    await api('/api/entries', { method: 'POST', body: JSON.stringify({ date, type: state.entryType, category: state.entryCategory || '其他', amount, note }) });
  }
  closeEntryModal(); refresh();
}

// ---------- 各类表单弹窗 ----------
function addAccountDialog(type = 'asset') {
  const typeOptions = [
    ['asset', '资产（现金/储蓄卡/支付宝等）'],
    ['liability', '负债（信用卡/贷款）'],
    ['receivable', '应收（别人欠我的钱）'],
    ['payable', '应付（我欠别人的钱）'],
  ];
  formDialog('添加账户', [
    { key: 'name', label: '账户名称', type: 'text', placeholder: '如：招商银行' },
    { key: 'type', label: '账户类型', type: 'select', value: type, options: typeOptions },
    { key: 'sub_label', label: '副标题', type: 'text', placeholder: '如：储蓄卡' },
    { key: 'balance', label: '初始余额（元）', type: 'text', value: '0' },
  ], async (r) => {
    const balance = toFen(r.balance);
    await api('/api/accounts', { method: 'POST', body: JSON.stringify({ name: r.name, type: r.type, sub_label: r.sub_label, balance: balance ?? 0 }) });
    toast('已添加'); refresh();
  });
}

function editAccount(id) {
  const a = state.accounts.find(x => x.id === id);
  if (!a) return;
  formDialog('编辑账户', [
    { key: 'name', label: '账户名称', type: 'text', value: a.name },
    { key: 'sub_label', label: '副标题', type: 'text', value: a.sub_label },
    { key: 'balance', label: '余额（元）', type: 'text', value: fmt(a.balance) },
  ], async (r) => {
    await api(`/api/accounts/${id}`, { method: 'PATCH', body: JSON.stringify({ name: r.name, sub_label: r.sub_label, balance: toFen(r.balance) ?? a.balance }) });
    toast('已保存'); refresh();
  });
}

function editEntry(id, e) {
  if (!e) return;
  const isIncome = e.type === 'income';
  const catOptions = (isIncome ? state.categories.income : state.categories.expense).map(c => [c.name, c.name]);
  formDialog('修改账单', [
    { key: 'category', label: '分类', type: 'select', value: e.category, options: catOptions },
    { key: 'amount', label: '金额（元）', type: 'text', value: fmt(e.amount) },
    { key: 'note', label: '备注', type: 'text', value: e.note },
  ], async (r) => {
    await api(`/api/entries/${id}`, { method: 'PATCH', body: JSON.stringify({ category: r.category, amount: toFen(r.amount) ?? e.amount, note: r.note }) });
    toast('已修改'); refresh();
  });
}

function addItemDialog(type, accountId) {
  const label = type === 'receivable' ? '借给谁' : '向谁借';
  formDialog(type === 'receivable' ? '添加应收' : '添加应付', [
    { key: 'name', label: label, type: 'text' },
    { key: 'amount', label: '金额（元）', type: 'text' },
    { key: 'date', label: '日期', type: 'date', value: today() },
  ], async (r) => {
    await api('/api/receivables', { method: 'POST', body: JSON.stringify({ account_id: accountId, name: r.name, amount: toFen(r.amount) ?? 0, date: r.date, status: 'open' }) });
    toast('已添加'); renderTab();
  });
}

function addPeriodicDialog() {
  const expenseCats = state.categories.expense.map(c => [c.name, c.name]);
  const incomeCats = state.categories.income.map(c => [c.name, c.name]);
  formDialog('添加周期账', [
    { key: 'name', label: '名称（如"房贷"）', type: 'text' },
    { key: 'type', label: '类型', type: 'select', value: 'expense', options: [['expense', '支出'], ['income', '收入']] },
    { key: 'category', label: '分类', type: 'select', value: '房贷', options: expenseCats },
    { key: 'amount', label: '金额（元）', type: 'text' },
    { key: 'cron', label: '周期', type: 'select', value: 'MONTHLY:1', options: [
      ['MONTHLY:1', '每月1号'], ['MONTHLY:5', '每月5号'], ['MONTHLY:10', '每月10号'],
      ['MONTHLY:15', '每月15号'], ['MONTHLY:20', '每月20号'], ['MONTHLY:28', '每月28号'],
    ]},
  ], async (r) => {
    await api('/api/periodic', { method: 'POST', body: JSON.stringify({ name: r.name, type: r.type, category: r.category, amount: toFen(r.amount) ?? 0, cron: r.cron }) });
    toast('已添加'); renderPeriodic($('#content'));
  });

  // 类型切换时，动态更新分类下拉
  $('#fd-type')?.addEventListener('change', (e) => {
    const cats = e.target.value === 'income' ? incomeCats : expenseCats;
    $('#fd-category').innerHTML = cats.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  });
}

// ---------- 事件绑定 ----------
function bindEvents() {
  $('#login-btn').addEventListener('click', doLogin);
  $('#login-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

  // 顶栏 tab（资产/负债）
  $$('.tab').forEach(el => {
    el.addEventListener('click', () => {
      state.tab = el.dataset.tab;
      $$('.tab').forEach(t => t.classList.toggle('active', t === el));
      setNavActive(state.tab);
      refresh();
    });
  });

  // 右上趋势图标 → 报表
  $('#go-report').addEventListener('click', () => { state.tab = 'report'; setNavActive('report'); refresh(); });

  // 底部导航
  $$('.nav-btn').forEach(el => {
    el.addEventListener('click', () => {
      const nav = el.dataset.nav;
      if (nav === 'add') return openEntryModal();
      const map = { assets: 'assets', report: 'report', entries: 'entries', settings: 'settings' };
      state.tab = map[nav] || 'assets';
      $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === state.tab));
      setNavActive(nav);
      refresh();
    });
  });

  // 录入弹层
  $('.modal-close').addEventListener('click', closeEntryModal);
  $$('.mtab').forEach(el => {
    el.addEventListener('click', () => {
      state.entryType = el.dataset.mtype;
      $$('.mtab').forEach(t => t.classList.remove('active'));
      el.classList.add('active');
      renderEntryModal();
    });
  });
}

function setNavActive(nav) {
  const map = { assets: 'assets', report: 'report', entries: 'entries', settings: 'settings' };
  const target = map[nav] || nav;
  $$('.nav-btn').forEach(n => {
    const isAdd = n.dataset.nav === 'add';
    n.classList.toggle('active', !isAdd && n.dataset.nav === target);
  });
}

// ---------- 启动 ----------
async function init() {
  bindEvents();
  if (state.token) {
    try { showMain(); await refresh(); return; } catch {}
  }
  // 必须手动登录，不自动登录
  showLogin();
}

init();
