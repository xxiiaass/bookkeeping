// AI 记账前端 —— 照抄口袋记账的页面设计
const state = {
  token: localStorage.getItem('zb_token') || '',
  tab: 'assets',          // assets | liabilities | entries | report | settings
  accounts: [],
  categories: { expense: [], income: [] },
  month: new Date().toISOString().slice(0, 7),  // 账单/报表当前月份 YYYY-MM
  reportType: 'expense',  // 报表页 收入/支出 切换
  detailStatus: 'open',    // 应收/应付详情页 未完成/已完成 切换
  hideAmount: false,       // 汇总金额是否隐藏（眼睛图标）
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
const KEYPAD = ['7','8','9','⌫','4','5','6','C','1','2','3','.','0','确定'];
const keypadHtml = () => KEYPAD.map(k => {
  const cls = ['key'];
  if (k === '确定') cls.push('key-ok', 'key-wide');
  else if (k === '0') cls.push('key-wide');
  return `<button class="${cls.join(' ')}" data-key="${k}">${k}</button>`;
}).join('');
let submitting = false;   // 录入提交防重复

// ---------- Toast / 弹窗 ----------
function toast(msg, type) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden', 'success', 'error');
  if (type) t.classList.add(type);
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2200);
}

function lockBody() { document.body.style.overflow = 'hidden'; }
function unlockBody() { document.body.style.overflow = ''; }

function confirmDialog(text) {
  return new Promise((resolve) => {
    $('#confirm-text').textContent = text;
    $('#confirm-modal').classList.remove('hidden');
    lockBody();
    const onOk = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    const cleanup = () => {
      $('#confirm-modal').classList.add('hidden');
      unlockBody();
      $('#confirm-ok').removeEventListener('click', onOk);
      $('#confirm-cancel').removeEventListener('click', onCancel);
    };
    $('#confirm-ok').addEventListener('click', onOk);
    $('#confirm-cancel').addEventListener('click', onCancel);
  });
}

// fields: [{key,label,type,value,options,placeholder}]
// type === 'select' 时：点击后弹出全屏大号选项面板（网格），options 为 [[value,label]] 或 [label]
function formDialog(title, fields, onSubmit) {
  $('#form-modal-title').textContent = title;
  const body = $('#form-modal-body');
  body.innerHTML = fields.map(f => {
    const id = `fd-${f.key}`;
    if (f.type === 'select') {
      const opts = (f.options || []).map(o => Array.isArray(o) ? { value: o[0], label: o[1] } : { value: o, label: o });
      const cur = opts.find(o => String(o.value) === String(f.value)) || opts[0];
      const curLabel = cur ? cur.label : '';
      return `
        <div>
          <div class="field-label">${f.label}</div>
          <div class="custom-select-trigger" id="${id}">
            <span class="custom-select-value">${curLabel}</span>
            <span class="custom-select-arrow">▾</span>
          </div>
          <input type="hidden" id="${id}-hidden" value="${cur ? cur.value : ''}">
        </div>
      `;
    }
    return `<div><div class="field-label">${f.label}</div><input class="field-input" type="${f.type || 'text'}" id="${id}" value="${f.value ?? ''}" placeholder="${f.placeholder || ''}"></div>`;
  }).join('');
  body.innerHTML += `<div class="form-actions"><button class="btn-ghost" id="form-cancel">取消</button><button class="btn-primary" id="form-ok">确定</button></div>`;

  $('#form-modal').classList.remove('hidden');
  lockBody();
  const close = () => { $('#form-modal').classList.add('hidden'); unlockBody(); };
  $('#form-cancel').addEventListener('click', close);
  $('#form-modal-close').addEventListener('click', close);

  // 自定义下拉：点击弹出全屏选项面板
  $$('.custom-select-trigger').forEach(trigger => {
    trigger.addEventListener('click', () => {
      const f = fields.find(x => `fd-${x.key}` === trigger.id);
      openOptionPanel(f, trigger);
    });
  });

  $('#form-ok').addEventListener('click', async () => {
    const result = {};
    let missing = null;
    for (const f of fields) {
      const el = $(`#fd-${f.key}`);
      const val = f.type === 'select' ? $(`#fd-${f.key}-hidden`).value : el.value;
      if (f.required && !String(val ?? '').trim()) {
        missing = missing || f;
        el?.classList.add('error');
      } else {
        el?.classList.remove('error');
      }
      result[f.key] = val;
    }
    if (missing) { toast(`请填写${missing.label}`, 'error'); return; }

    const btn = $('#form-ok');
    const original = btn.textContent;
    btn.disabled = true; btn.textContent = '保存中…';
    try {
      await onSubmit(result);
      close();
    } catch (e) {
      if (e.message !== 'unauthorized') toast('操作失败，请重试', 'error');
    } finally {
      btn.disabled = false; btn.textContent = original;
    }
  });
}

// 全屏选项面板（网格大按钮）
function openOptionPanel(field, trigger) {
  // 支持动态 options（如周期账分类随类型联动），通过 trigger.dataset.options 传入
  let opts;
  if (trigger.dataset.options) {
    opts = JSON.parse(trigger.dataset.options).map(([v, l]) => ({ value: v, label: l }));
  } else {
    opts = (field.options || []).map(o => Array.isArray(o) ? { value: o[0], label: o[1] } : { value: o, label: o });
  }
  const curVal = $(`#${trigger.id}-hidden`).value;
  const panel = $('#option-panel');
  panel.querySelector('.op-panel-title').textContent = '选择' + field.label;
  panel.querySelector('.op-panel-grid').innerHTML = opts.map(o => `
    <button class="op-option ${String(o.value) === String(curVal) ? 'selected' : ''}" data-value="${o.value}">${o.label}</button>
  `).join('');
  panel.classList.remove('hidden');

  panel.querySelectorAll('.op-option').forEach(btn => {
    btn.addEventListener('click', () => {
      // 更新 trigger 显示和 hidden 值
      trigger.querySelector('.custom-select-value').textContent = btn.textContent;
      $(`#${trigger.id}-hidden`).value = btn.dataset.value;
      panel.classList.add('hidden');
      // 触发联动（如周期账类型切换分类）
      $(`#${trigger.id}-hidden`).dispatchEvent(new Event('change', { bubbles: true }));
    });
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
async function loadCategories() {
  // 从服务器数据库读取分类
  try {
    const res = await api('/api/categories');
    state.categories.expense = res.expense || [];
    state.categories.income = res.income || [];
  } catch (e) {
    // 降级：用内置兜底分类
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
}

function catInfo(type, name) {
  const list = type === 'income' ? state.categories.income : state.categories.expense;
  return list.find(c => c.name === name) || { icon: '🏷', color: '#999' };
}

// ---------- 数据 ----------
async function refresh() {
  try {
    await loadCategories();
    const [accRes, reportRes] = await Promise.all([api('/api/accounts'), api('/api/report')]);
    state.accounts = accRes.accounts;
    renderSummary(reportRes);
    renderTab();
  } catch (e) {
    if (e.message !== 'unauthorized') { toast('加载失败，请重试', 'error'); console.error(e); }
  }
}

const PALETTE = ['#2563eb','#0891b2','#059669','#ea580c','#db2777','#7c3aed','#4f46e5','#d97706','#00897b','#6d4c41'];

function renderSummary(report) {
  const card = $('#summary-card');
  const hide = state.hideAmount;
  const fmtAmt = (v) => hide ? '****' : '¥' + fmt(v);
  if (state.tab === 'assets') {
    card.classList.remove('hidden');
    card.innerHTML = `
      <div><div class="label" id="assets-filter-trigger">资产 <span class="arrow">▼</span></div><div class="amount">${fmtAmt(report.totalAsset)}</div><div class="sub">净资产 ${fmtAmt(report.netAsset)}</div></div>
      <div class="summary-right"><span class="eye" id="eye-toggle">${hide ? '🙈' : '👁'}</span></div>
    `;
    $('#assets-filter-trigger')?.addEventListener('click', () => showAccountFilter('asset'));
  } else if (state.tab === 'liabilities') {
    card.classList.remove('hidden');
    card.innerHTML = `
      <div><div class="label" id="liab-filter-trigger">负债 <span class="arrow">▼</span></div><div class="amount">${fmtAmt(report.totalLiability)}</div></div>
      <div class="summary-right"><span class="eye" id="eye-toggle">${hide ? '🙈' : '👁'}</span></div>
    `;
    $('#liab-filter-trigger')?.addEventListener('click', () => showAccountFilter('liability'));
  } else {
    card.classList.add('hidden');
  }
  $('#eye-toggle')?.addEventListener('click', () => {
    state.hideAmount = !state.hideAmount;
    renderSummary(report);
  });
}

// 照抄口袋记账：点击「资产/负债」倒三角，弹出「选择要展示的账户」多选列表
// asset 页可选 asset + receivable；liability 页可选 liability + payable
function showAccountFilter(type) {
  const typeSet = type === 'asset' ? ['asset', 'receivable'] : ['liability', 'payable'];
  const accounts = state.accounts.filter(a => typeSet.includes(a.type));
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
  lockBody();
  const close = () => { $('#form-modal').classList.add('hidden'); unlockBody(); };
  $('#form-modal-close').addEventListener('click', close);
  $('#filter-ok').addEventListener('click', async () => {
    const btn = $('#filter-ok');
    const original = btn.textContent;
    btn.disabled = true; btn.textContent = '保存中…';
    try {
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
    } catch (e) {
      if (e.message !== 'unauthorized') toast('保存失败，请重试', 'error');
    } finally {
      btn.disabled = false; btn.textContent = original;
    }
  });
}

function updateTopbar() {
  const show = state.tab === 'assets' || state.tab === 'liabilities';
  $('.topbar-left')?.classList.toggle('hidden', !show);
  $('#go-report')?.classList.toggle('hidden', !show);
}

async function renderTab() {
  updateTopbar();
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

  let html = assets.map((a, i) => {
    const color = a.color || PALETTE[i % PALETTE.length];
    return `
    <div class="account-card" style="background-color:${color};--card-c:${color}" data-id="${a.id}">
      <div class="acc-left">
        <div class="acc-icon">${a.name === '现金' ? '¥' : '🏦'}</div>
        <div><div class="acc-name">${a.name}</div><div class="acc-sub">${a.sub_label || '点击查看流水'}</div></div>
      </div>
      <div class="acc-right"><div class="acc-balance">${fmt(a.balance)}</div></div>
    </div>
  `;
  }).join('');

  if (receivables.length > 0) {
    html += `<div class="section-title">应收账款</div>`;
    html += receivables.map((a, i) => {
      const color = a.color || '#ff7043';
      return `
      <div class="account-card" style="background-color:${color};--card-c:${color}" data-recv="${a.id}">
        <div class="acc-left">
          <div class="acc-icon">收</div>
          <div><div class="acc-name">${a.name}</div><div class="acc-sub">应收总额 · 点开看明细</div></div>
        </div>
        <div class="acc-right"><div class="acc-balance">${fmt(a.balance)}</div></div>
      </div>
    `;
    }).join('');
  }

  html += `<button class="add-account-btn" id="add-account-btn">＋ 添加账户</button>`;
  c.innerHTML = html;

  // 点击资产账户 → 进入账户详情（流水）
  $$('.account-card[data-id]').forEach(el => {
    el.addEventListener('click', () => renderAccountDetail(c, Number(el.dataset.id)));
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

  let html = liabs.map((a, i) => {
    const color = a.color || PALETTE[(i + 1) % PALETTE.length];
    return `
    <div class="account-card" style="background-color:${color};--card-c:${color}" data-id="${a.id}">
      <div class="acc-left">
        <div class="acc-icon">💳</div>
        <div>
          <div class="acc-name">${a.name}</div>
          <div class="acc-sub">${a.sub_label || '点击查看流水'}</div>
        </div>
      </div>
      <div class="acc-right">
        <div class="acc-nums">
          <div class="acc-balance">${fmt(a.balance)}</div>
          <div class="acc-extra">${a.credit_limit ? '可用额度 ' + fmt(a.credit_limit - a.balance) : ''}</div>
        </div>
      </div>
    </div>
  `;
  }).join('');

  if (payables.length > 0) {
    html += `<div class="section-title">借款（我欠别人的钱）</div>`;
    html += payables.map((a, i) => {
      const color = a.color || '#ef6fa7';
      return `
      <div class="account-card" style="background-color:${color};--card-c:${color}" data-pay="${a.id}">
        <div class="acc-left">
          <div class="acc-icon">🏠</div>
          <div><div class="acc-name">${a.name}</div><div class="acc-sub">我欠别人的钱 · 点开看明细</div></div>
        </div>
        <div class="acc-right"><div class="acc-balance">${fmt(a.balance)}</div></div>
      </div>
    `;
    }).join('');
  }

  html += `<button class="add-account-btn" id="add-liab-btn">＋ 添加负债账户</button>`;
  c.innerHTML = html;

  $$('.account-card[data-id]').forEach(el => {
    el.addEventListener('click', () => renderAccountDetail(c, Number(el.dataset.id)));
  });
  $$('.account-card[data-pay]').forEach(el => {
    el.addEventListener('click', () => renderPayableDetail(c, Number(el.dataset.pay)));
  });
  $('#add-liab-btn')?.addEventListener('click', () => addAccountDialog('liability'));
}

// ---------- 应收明细页（橙色头，照抄） ----------
async function renderReceivableDetail(c, accountId) {
  const res = await api('/api/receivables?type=receivable');
  const allItems = res.items.filter(it => it.account_id === accountId);
  const status = state.detailStatus || 'open'; // open 未完成 / done 已完成
  const items = allItems.filter(it => (status === 'done' ? it.status === 'done' : it.status !== 'done'));
  const total = items.reduce((s, it) => s + it.amount, 0);

  const groups = {};
  for (const it of items) (groups[it.date || '未标注日期'] ||= []).push(it);

  let html = `
    <div class="detail-header" style="background:#ff8a3d;color:#fff;border-radius:0 0 16px 16px;padding:16px;margin:-8px -12px 12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-size:16px;cursor:pointer" id="rcv-back">‹ 返回</span>
        <span style="font-size:14px;cursor:pointer" id="rcv-status">${status === 'done' ? '已完成' : '未完成'} ▼</span>
        <span style="font-size:14px;width:40px"></span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:14px">应收总额（${status === 'done' ? '已完成' : '未完成'}）</span>
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
            <div class="li-icon" style="--ic:#ff8a3d">收</div>
            <div><div class="li-name">${it.name}</div><div class="li-sub">${it.status === 'done' ? '已结清' : ''}</div></div>
          </div>
          <div class="li-amount">${fmt(it.amount)}</div>
        </div>
      `;
    }
  }
  if (items.length === 0) html += `<div class="empty-state"><div class="empty-emoji">🗒️</div><div class="empty-title">暂无${status === 'done' ? '已完成' : '未完成'}记录</div></div>`;
  html += `<button class="add-record-btn" id="add-item-btn">＋ 添加记录</button>`;
  c.innerHTML = html;

  $('#rcv-back').addEventListener('click', () => { state.tab = 'assets'; refresh(); });
  $('#rcv-status').addEventListener('click', () => {
    state.detailStatus = status === 'done' ? 'open' : 'done';
    renderReceivableDetail(c, accountId);
  });
  $$('.list-item[data-item]').forEach(el => {
    el.addEventListener('click', async () => {
      const it = items.find(x => x.id == el.dataset.item);
      try {
        if (it.status === 'done') {
          const ok = await confirmDialog(`是否将「${it.name}」恢复为未完成？`);
          if (ok) { await api(`/api/receivables/${it.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'open' }) }); renderReceivableDetail(c, accountId); }
        } else {
          const ok = await confirmDialog(`是否标记「${it.name}」为已结清？`);
          if (ok) { await api(`/api/receivables/${it.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) }); renderReceivableDetail(c, accountId); }
        }
      } catch (e) {
        if (e.message !== 'unauthorized') toast('操作失败，请重试', 'error');
      }
    });
  });
  $('#add-item-btn').addEventListener('click', () => addItemDialog('receivable', accountId));
}

// ---------- 应付明细页（粉色头，照抄） ----------
async function renderPayableDetail(c, accountId) {
  const res = await api('/api/receivables?type=payable');
  const allItems = res.items.filter(it => it.account_id === accountId);
  const status = state.detailStatus || 'open';
  const items = allItems.filter(it => (status === 'done' ? it.status === 'done' : it.status !== 'done'));
  const total = items.reduce((s, it) => s + it.amount, 0);

  const groups = {};
  for (const it of items) (groups[it.date || '未标注日期'] ||= []).push(it);

  let html = `
    <div class="detail-header" style="background:#ef6fa7;color:#fff;border-radius:0 0 16px 16px;padding:16px;margin:-8px -12px 12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-size:16px;cursor:pointer" id="pay-back">‹ 返回</span>
        <span style="font-size:14px;cursor:pointer" id="pay-status">${status === 'done' ? '已完成' : '未完成'} ▼</span>
        <span style="font-size:14px;width:40px"></span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:14px">应付总额（${status === 'done' ? '已完成' : '未完成'}）</span>
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
            <div class="li-icon" style="--ic:#ef6fa7">付</div>
            <div><div class="li-name">${it.name}</div><div class="li-sub">${it.status === 'done' ? '已结清' : ''}</div></div>
          </div>
          <div class="li-amount">${fmt(it.amount)}</div>
        </div>
      `;
    }
  }
  if (items.length === 0) html += `<div class="empty-state"><div class="empty-emoji">🗒️</div><div class="empty-title">暂无${status === 'done' ? '已完成' : '未完成'}记录</div></div>`;
  html += `<button class="add-record-btn" id="add-item-btn">＋ 添加记录</button>`;
  c.innerHTML = html;

  $('#pay-back').addEventListener('click', () => { state.tab = 'liabilities'; refresh(); });
  $('#pay-status').addEventListener('click', () => {
    state.detailStatus = status === 'done' ? 'open' : 'done';
    renderPayableDetail(c, accountId);
  });
  $$('.list-item[data-item]').forEach(el => {
    el.addEventListener('click', async () => {
      const it = items.find(x => x.id == el.dataset.item);
      try {
        if (it.status === 'done') {
          const ok = await confirmDialog(`是否将「${it.name}」恢复为未完成？`);
          if (ok) { await api(`/api/receivables/${it.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'open' }) }); renderPayableDetail(c, accountId); }
        } else {
          const ok = await confirmDialog(`是否标记「${it.name}」为已结清？`);
          if (ok) { await api(`/api/receivables/${it.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) }); renderPayableDetail(c, accountId); }
        }
      } catch (e) {
        if (e.message !== 'unauthorized') toast('操作失败，请重试', 'error');
      }
    });
  });
  $('#add-item-btn').addEventListener('click', () => addItemDialog('payable', accountId));
}

// ---------- 账单流水页（不含转账，转账在账户详情页看） ----------
async function renderEntries(c) {
  const res = await api(`/api/entries?month=${state.month}&limit=500`);
  // 过滤掉转账记录
  const entries = res.entries.filter(e => e.type !== 'transfer');

  // 月度汇总
  let income = 0, expense = 0;
  for (const e of entries) {
    if (e.type === 'income') income += e.amount;
    else if (e.type === 'expense' || e.type === 'balance') expense += e.amount;
  }

  const [y, m] = state.month.split('-');
  let html = `
    <div class="month-nav">
      <button id="mn-prev">‹</button>
      <span class="month-label">${m}月</span>
      <button id="mn-next">›</button>
    </div>
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
    html += `<div class="empty-state"><div class="empty-emoji">📋</div><div class="empty-title">本月暂无流水</div><div class="empty-desc">点击下方 ＋ 记一笔</div></div>`;
  }
  for (const date of sortedDates) {
    const day = date.slice(8, 10);
    const dayExpense = groups[date].filter(e => e.type === 'expense' || e.type === 'balance').reduce((s, e) => s + e.amount, 0);
    html += `<div class="group-date"><span class="gdot">${day}日</span><span>支出 ${fmt(dayExpense)}</span></div>`;
    for (const e of groups[date]) {
      const isIncome = e.type === 'income';
      const ci = catInfo(isIncome ? 'income' : 'expense', e.category);
      const sign = isIncome ? '+' : '-';
      html += `
        <div class="list-item" data-id="${e.id}">
          <div class="li-left">
            <div class="li-icon" style="--ic:${ci.color}">${ci.icon}</div>
            <div><div class="li-name">${e.category || e.type}${e.is_balance ? ' ⚖️' : ''}</div><div class="li-sub">${e.note || '点击修改'}</div></div>
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
  $('#mn-prev')?.addEventListener('click', () => { shiftMonth(-1); renderTab(); });
  $('#mn-next')?.addEventListener('click', () => { shiftMonth(1); renderTab(); });
  $('#balance-btn')?.addEventListener('click', async () => {
    const ok = await confirmDialog('将把现金余额清零并记一笔平账，确认？');
    if (!ok) return;
    formDialog('记平账', [
      { key: 'date', label: '日期', type: 'date', value: today() },
      { key: 'note', label: '备注', type: 'text', value: '一般性支出（平账）' },
    ], async (r) => {
      await api('/api/entries/balance', { method: 'POST', body: JSON.stringify({ date: r.date, note: r.note }) });
      toast('已平账清零', 'success'); refresh();
    });
  });
}

// ---------- 账户详情页（点击账户进入，显示该账户所有流水含转账） ----------
async function renderAccountDetail(c, accountId) {
  const a = state.accounts.find(x => x.id === accountId);
  if (!a) return;
  const res = await api(`/api/accounts/${accountId}/entries`);
  const entries = res.entries || [];

  const isLiability = a.type === 'liability';
  const headerColor = isLiability ? '#ef5350' : (a.color || '#2563eb');
  const balanceLabel = isLiability ? '已用额度' : '余额';

  let html = `
    <div class="detail-header" style="background:${headerColor};color:#fff;border-radius:0 0 16px 16px;padding:16px;margin:-8px -12px 12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-size:16px;cursor:pointer" id="acc-back">‹ 返回</span>
        <span style="font-size:14px;cursor:pointer" id="acc-edit">编辑</span>
        <span style="font-size:14px;width:40px"></span>
      </div>
      <div style="text-align:center;margin-bottom:8px;">
        <div style="font-size:14px;opacity:.9">${a.name}</div>
        <div style="font-size:28px;font-weight:700">¥${fmt(a.balance)}</div>
        <div style="font-size:12px;opacity:.8">${balanceLabel}${a.credit_limit ? ' · 总额度 ¥' + fmt(a.credit_limit) + ' · 可用 ¥' + fmt(a.credit_limit - a.balance) : ''}</div>
      </div>
    </div>
  `;

  // 按日期分组
  const groups = {};
  for (const e of entries) (groups[e.date] ||= []).push(e);
  const sortedDates = Object.keys(groups).sort().reverse();

  if (sortedDates.length === 0) {
    html += `<div class="empty-state"><div class="empty-emoji">📋</div><div class="empty-title">暂无流水</div></div>`;
  }
  for (const date of sortedDates) {
    const day = date.slice(8, 10);
    html += `<div class="group-date"><span class="gdot">${day}日</span></div>`;
    for (const e of groups[date]) {
      const isTransfer = e.type === 'transfer';
      const isIncome = e.type === 'income';
      const ci = isTransfer ? { icon: '⇄', color: '#5c6bc0' } : catInfo(isIncome ? 'income' : 'expense', e.category);
      let sign, amountCls, subText;
      if (isTransfer) {
        // 判断该账户是转出方还是转入方
        const isOut = e.account_id === accountId;
        sign = isOut ? '↓' : '↑';
        const otherId = isOut ? e.target_account_id : e.account_id;
        const other = state.accounts.find(x => x.id === otherId);
        subText = (isOut ? '转出到 ' : '转入自 ') + (other ? other.name : '?') + (e.note ? ' · ' + e.note : '');
        amountCls = 'amount-transfer';
      } else {
        sign = isIncome ? '+' : '-';
        subText = e.note || '点击修改';
        amountCls = isIncome ? 'amount-income' : 'amount-expense';
      }
      html += `
        <div class="list-item" data-id="${e.id}">
          <div class="li-left">
            <div class="li-icon" style="--ic:${ci.color}">${ci.icon}</div>
            <div><div class="li-name">${isTransfer ? '转账' : (e.category || e.type)}${e.is_balance ? ' ⚖️' : ''}</div><div class="li-sub">${subText}</div></div>
          </div>
          <div class="li-amount ${amountCls}">${sign}${fmt(e.amount)}</div>
        </div>
      `;
    }
  }
  c.innerHTML = html;

  $('#acc-back').addEventListener('click', () => {
    state.tab = isLiability ? 'liabilities' : 'assets';
    refresh();
  });
  $('#acc-edit').addEventListener('click', () => editAccount(accountId));
  $$('.list-item[data-id]').forEach(el => {
    el.addEventListener('click', () => {
      const e = entries.find(x => x.id == el.dataset.id);
      editEntry(Number(el.dataset.id), e);
    });
  });
}

// ---------- 报表页（环形图 + 分类统计，含收入/支出切换） ----------
async function renderReport(c) {
  const res = await api(`/api/report?month=${state.month}`);
  const byCat = res.byCategory || { income: [], expense: [] };
  const rt = state.reportType || 'expense';
  const list = (byCat[rt] || []).map(it => ({ name: it.category, amount: it.amount }));
  const total = list.reduce((s, it) => s + it.amount, 0);
  list.sort((a, b) => b.amount - a.amount);
  list.forEach(it => it.pct = total ? it.amount / total : 0);

  // 环形图用 SVG（分段颜色取真实分类色）
  let segs = '';
  let acc = 0;
  const R = 70, CX = 90, CY = 90;
  list.forEach((it, i) => {
    const color = catInfo(rt, it.name).color;
    const start = acc, end = acc + it.pct;
    acc = end;
    const a0 = start * 2 * Math.PI - Math.PI / 2;
    const a1 = end * 2 * Math.PI - Math.PI / 2;
    const x0 = CX + R * Math.cos(a0), y0 = CY + R * Math.sin(a0);
    const x1 = CX + R * Math.cos(a1), y1 = CY + R * Math.sin(a1);
    const large = (end - start) > 0.5 ? 1 : 0;
    segs += `<path d="M ${CX} ${CY} L ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} Z" fill="${color}" stroke="#fff" stroke-width="2"></path>`;
  });

  const [y, m] = state.month.split('-');
  const rtLabel = rt === 'income' ? '总收入' : '总支出';
  let html = `
    <div class="report-month-nav">
      <button id="rm-prev">‹</button>
      <span class="rm-label">${m}月01日~${lastDay(y, m)}日</span>
      <button id="rm-next">›</button>
    </div>
    <div class="report-tabs">
      <button class="rtab ${rt === 'expense' ? 'active' : ''}" data-rt="expense">支出</button>
      <button class="rtab ${rt === 'income' ? 'active' : ''}" data-rt="income">收入</button>
    </div>
    <div class="report-chart-wrap">
      <div class="report-donut">
        <svg width="180" height="180" viewBox="0 0 180 180">
          ${total === 0 ? `<circle cx="90" cy="90" r="70" fill="#eee"></circle>` : segs}
          <circle cx="90" cy="90" r="40" fill="#fff"></circle>
        </svg>
        <div class="report-center">
          <div class="rc-label">${rtLabel}</div>
          <div class="rc-amount">¥${fmt(total)}</div>
        </div>
      </div>
    </div>
  `;

  for (const it of list) {
    const ci = catInfo(rt, it.name);
    html += `
      <div class="cat-stat">
        <div class="li-icon" style="--ic:${ci.color}">${ci.icon}</div>
        <div style="flex:1;margin:0 8px">
          <div style="display:flex;justify-content:space-between;font-size:14px">
            <span>${it.name}</span><span>${(it.pct * 100).toFixed(1)}%</span>
          </div>
          <div class="bar-track" style="margin-top:6px"><div class="bar-fill" style="width:${(it.pct * 100).toFixed(1)}%;background:${ci.color}"></div></div>
        </div>
        <div class="cat-stat-amount">${fmt(it.amount)}</div>
      </div>
    `;
  }
  if (list.length === 0) html += `<div class="empty-state"><div class="empty-emoji">📊</div><div class="empty-title">本月暂无${rt === 'income' ? '收入' : '支出'}</div></div>`;
  c.innerHTML = html;

  $('#rm-prev').addEventListener('click', () => { shiftMonth(-1); renderTab(); });
  $('#rm-next').addEventListener('click', () => { shiftMonth(1); renderTab(); });
  $$('.rtab').forEach(el => el.addEventListener('click', () => {
    state.reportType = el.dataset.rt;
    renderTab();
  }));
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
      <button class="btn-ghost" id="send-backup-btn" style="width:100%;margin-top:12px">📧 立即发送备份邮件</button>
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
    const btn = $('#save-settings-btn');
    const original = btn.textContent;
    btn.disabled = true; btn.textContent = '保存中…';
    try {
      await api('/api/auth/settings', { method: 'POST', body: JSON.stringify({ web_password: $('#set-pwd').value, smtp }) });
      toast('设置已保存', 'success');
    } catch (e) {
      if (e.message !== 'unauthorized') toast('保存失败，请重试', 'error');
    } finally {
      btn.disabled = false; btn.textContent = original;
    }
  });
  $('#send-backup-btn').addEventListener('click', async () => {
    const btn = $('#send-backup-btn');
    const original = btn.textContent;
    btn.disabled = true; btn.textContent = '发送中…';
    try {
      // 先保存当前 SMTP 配置，再发送
      const smtp = {
        host: $('#set-smtp-host').value.trim(),
        port: parseInt($('#set-smtp-port').value) || 465,
        user: $('#set-smtp-user').value.trim(),
        pass: $('#set-smtp-pass').value,
        to: $('#set-smtp-to').value.trim(),
      };
      await api('/api/auth/settings', { method: 'POST', body: JSON.stringify({ web_password: $('#set-pwd').value, smtp }) });
      const r = await api('/api/auth/backup', { method: 'POST', body: JSON.stringify({}) });
      if (r.ok) toast(`备份已发送至 ${r.sentTo}`, 'success');
      else toast(r.message || '发送失败：请先填写完整的 SMTP 配置', 'error');
    } catch (e) {
      if (e.message !== 'unauthorized') toast('发送失败：' + (e.message || '未知错误'), 'error');
    } finally {
      btn.disabled = false; btn.textContent = original;
    }
  });
  $('#token-box').addEventListener('click', () => { navigator.clipboard.writeText(state.token); toast('Token 已复制', 'success'); });
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
        <div class="li-icon" style="--ic:#5c6bc0">🔄</div>
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
  lockBody();
  renderEntryModal();
}
function closeEntryModal() { $('#entry-modal').classList.add('hidden'); unlockBody(); }

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
        ${keypadHtml()}
      </div>
    `}
  `;

  $$('.cat-item').forEach(el => el.addEventListener('click', () => { state.entryCategory = el.dataset.cat; renderEntryModal(); }));
  $$('.key').forEach(el => el.addEventListener('click', () => handleKey(el.dataset.key)));
}

function transferForm() {
  const accs = state.accounts.filter(a => a.type === 'asset' || a.type === 'liability');
  // 转出默认选现金，转入默认选第一个非现金账户，避免默认「现金→现金」
  const cash = state.accounts.find(a => a.name === '现金' && a.type === 'asset');
  const fromDefault = cash ? cash.id : (accs[0] ? accs[0].id : '');
  const toCandidates = accs.filter(a => a.id !== fromDefault);
  const toDefault = toCandidates.length > 0 ? toCandidates[0].id : '';
  return `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <span style="font-size:13px;color:#999;width:40px">转出</span>
      <select id="tr-from" class="field-select" style="flex:1">${accs.map(a => `<option value="${a.id}" ${a.id === fromDefault ? 'selected' : ''}>${a.name}</option>`).join('')}</select>
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <span style="font-size:13px;color:#999;width:40px">转入</span>
      <select id="tr-to" class="field-select" style="flex:1">${accs.map(a => `<option value="${a.id}" ${a.id === toDefault ? 'selected' : ''}>${a.name}</option>`).join('')}</select>
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
      ${keypadHtml()}
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
  if (submitting) return;
  const amount = toFen(state.entryAmount);
  if (!amount) { toast('请输入金额', 'error'); return; }
  const date = $('#entry-date')?.value || state.entryDate;
  const note = $('#entry-note')?.value || '';
  submitting = true;
  try {
    if (state.entryType === 'transfer') {
      const fromId = Number($('#tr-from').value);
      const toId = Number($('#tr-to').value);
      if (fromId === toId) { toast('转出和转入账户不能相同', 'error'); return; }
      await api('/api/entries', { method: 'POST', body: JSON.stringify({ date, type: 'transfer', account_id: fromId, target_account_id: toId, amount, note }) });
    } else {
      await api('/api/entries', { method: 'POST', body: JSON.stringify({ date, type: state.entryType, category: state.entryCategory || '其他', amount, note }) });
    }
    closeEntryModal(); refresh();
  } catch (e) {
    if (e.message !== 'unauthorized') toast('保存失败，请重试', 'error');
  } finally {
    submitting = false;
  }
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
    { key: 'name', label: '账户名称', type: 'text', placeholder: '如：招商银行', required: true },
    { key: 'type', label: '账户类型', type: 'select', value: type, options: typeOptions },
    { key: 'sub_label', label: '副标题', type: 'text', placeholder: '如：储蓄卡' },
    { key: 'balance', label: '初始余额（元）', type: 'text', value: '0' },
  ], async (r) => {
    const balance = toFen(r.balance);
    await api('/api/accounts', { method: 'POST', body: JSON.stringify({ name: r.name, type: r.type, sub_label: r.sub_label, balance: balance ?? 0 }) });
    toast('已添加', 'success'); refresh();
  });
}

function editAccount(id) {
  const a = state.accounts.find(x => x.id === id);
  if (!a) return;
  const fields = [
    { key: 'name', label: '账户名称', type: 'text', value: a.name },
    { key: 'sub_label', label: '副标题', type: 'text', value: a.sub_label },
    { key: 'balance', label: '余额（元）', type: 'text', value: fmt(a.balance) },
  ];
  // 信用卡/贷款类账户支持编辑额度
  if (a.type === 'liability') {
    fields.push({ key: 'credit_limit', label: '总额度（元）', type: 'text', value: fmt(a.credit_limit) });
  }
  formDialog('编辑账户', fields, async (r) => {
    const payload = {
      name: r.name,
      sub_label: r.sub_label,
      balance: toFen(r.balance) ?? a.balance,
    };
    if (a.type === 'liability') payload.credit_limit = toFen(r.credit_limit) ?? a.credit_limit;
    await api(`/api/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    toast('已保存', 'success'); refresh();
  });
}

function editEntry(id, e) {
  if (!e) return;
  // 转账记录：显示转账编辑表单
  if (e.type === 'transfer') {
    const accs = state.accounts.filter(a => a.type === 'asset' || a.type === 'liability');
    formDialog('修改转账', [
      { key: 'from', label: '转出账户', type: 'select', value: e.account_id, options: accs.map(a => [a.id, a.name]) },
      { key: 'to', label: '转入账户', type: 'select', value: e.target_account_id, options: accs.map(a => [a.id, a.name]) },
      { key: 'amount', label: '金额（元）', type: 'text', value: fmt(e.amount), required: true },
      { key: 'note', label: '备注', type: 'text', value: e.note },
    ], async (r) => {
      const fromId = Number(r.from);
      const toId = Number(r.to);
      if (fromId === toId) { toast('转出和转入账户不能相同', 'error'); return; }
      await api(`/api/entries/${id}`, { method: 'PATCH', body: JSON.stringify({
        account_id: fromId, target_account_id: toId,
        amount: toFen(r.amount) ?? e.amount, note: r.note,
      }) });
      toast('已修改', 'success'); refresh();
    });
    return;
  }
  // 普通收支记录
  const isIncome = e.type === 'income';
  const catOptions = (isIncome ? state.categories.income : state.categories.expense).map(c => [c.name, c.name]);
  formDialog('修改账单', [
    { key: 'category', label: '分类', type: 'select', value: e.category, options: catOptions },
    { key: 'amount', label: '金额（元）', type: 'text', value: fmt(e.amount), required: true },
    { key: 'note', label: '备注', type: 'text', value: e.note },
  ], async (r) => {
    await api(`/api/entries/${id}`, { method: 'PATCH', body: JSON.stringify({ category: r.category, amount: toFen(r.amount) ?? e.amount, note: r.note }) });
    toast('已修改', 'success'); refresh();
  });
}

function addItemDialog(type, accountId) {
  const label = type === 'receivable' ? '借给谁' : '向谁借';
  formDialog(type === 'receivable' ? '添加应收' : '添加应付', [
    { key: 'name', label: label, type: 'text' },
    { key: 'amount', label: '金额（元）', type: 'text', required: true },
    { key: 'date', label: '日期', type: 'date', value: today() },
  ], async (r) => {
    await api('/api/receivables', { method: 'POST', body: JSON.stringify({ account_id: accountId, name: r.name, amount: toFen(r.amount) ?? 0, date: r.date, status: 'open' }) });
    toast('已添加', 'success'); renderTab();
  });
}

function addPeriodicDialog() {
  const expenseCats = state.categories.expense.map(c => [c.name, c.name]);
  const incomeCats = state.categories.income.map(c => [c.name, c.name]);
  formDialog('添加周期账', [
    { key: 'name', label: '名称（如"房贷"）', type: 'text', required: true },
    { key: 'type', label: '类型', type: 'select', value: 'expense', options: [['expense', '支出'], ['income', '收入']] },
    { key: 'category', label: '分类', type: 'select', value: '房贷', options: expenseCats },
    { key: 'amount', label: '金额（元）', type: 'text', required: true },
    { key: 'cron', label: '周期', type: 'select', value: 'MONTHLY:1', options: [
      ['MONTHLY:1', '每月1号'], ['MONTHLY:5', '每月5号'], ['MONTHLY:10', '每月10号'],
      ['MONTHLY:15', '每月15号'], ['MONTHLY:20', '每月20号'], ['MONTHLY:28', '每月28号'],
    ]},
  ], async (r) => {
    await api('/api/periodic', { method: 'POST', body: JSON.stringify({ name: r.name, type: r.type, category: r.category, amount: toFen(r.amount) ?? 0, cron: r.cron }) });
    toast('已添加', 'success'); renderPeriodic($('#content'));
  });

  // 类型切换时，动态更新分类下拉的选项
  $('#fd-type-hidden')?.addEventListener('change', (e) => {
    const isIncome = e.target.value === 'income';
    const cats = isIncome ? incomeCats : expenseCats;
    // 更新分类字段：重置为对应类型第一个分类，并记录动态选项
    $('#fd-category .custom-select-value').textContent = cats[0][1];
    $('#fd-category-hidden').value = cats[0][0];
    $('#fd-category').dataset.options = JSON.stringify(cats);
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

  // 选项面板关闭
  $('#op-panel-close').addEventListener('click', () => $('#option-panel').classList.add('hidden'));
}

function setNavActive(nav) {
  const map = { assets: 'assets', report: 'report', entries: 'entries', settings: 'settings', liabilities: 'assets' };
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
