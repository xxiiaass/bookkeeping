// AI 记账前端
const state = {
  token: localStorage.getItem('zb_token') || '',
  tab: 'assets',
  accounts: [],
  categories: { expense: [], income: [] },
  // 录入状态
  entryType: 'expense',
  entryCategory: '',
  entryAmount: '',
  entryNote: '',
  entryDate: new Date().toISOString().slice(0, 10),
  entryAccount: null,
  entryTargetAccount: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + state.token,
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    // token 失效，回到登录
    showLogin();
    throw new Error('unauthorized');
  }
  return res.json();
}

function fmt(amount) {
  return (amount / 100).toFixed(2);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ---------- 登录 ----------
function showLogin() {
  $('#login-view').classList.remove('hidden');
  $('#main-view').classList.add('hidden');
}
function showMain() {
  $('#login-view').classList.add('hidden');
  $('#main-view').classList.remove('hidden');
}

async function doLogin() {
  const password = $('#login-password').value;
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = await res.json();
  if (data.ok && data.token) {
    state.token = data.token;
    localStorage.setItem('zb_token', state.token);
    showMain();
    refresh();
  } else {
    $('#login-err').textContent = '密码错误';
  }
}

// ---------- 数据加载 ----------
async function refresh() {
  try {
    await loadCategories();
    const [accRes, reportRes] = await Promise.all([
      api('/api/accounts'),
      api('/api/report'),
    ]);
    state.accounts = accRes.accounts;
    renderSummary(reportRes);
    renderTab();
  } catch (e) {
    if (e.message !== 'unauthorized') console.error(e);
  }
}

async function loadCategories() {
  // 分类从 accounts 接口拿不到，用固定内置 + 从 report 推断。简化：用内置
  state.categories.expense = [
    { name: '餐饮', icon: '🍜', color: '#f5a623' },
    { name: '衣服鞋包', icon: '👕', color: '#a06cd5' },
    { name: '生活用品', icon: '🧴', color: '#8e9eef' },
    { name: '话费', icon: '📱', color: '#5b8def' },
    { name: '医疗', icon: '💊', color: '#a1887f' },
    { name: '交通', icon: '🚌', color: '#43a047' },
    { name: '房贷', icon: '🏠', color: '#1565c0' },
    { name: '养车', icon: '🚗', color: '#1e88e5' },
    { name: '房水电煤', icon: '🏠', color: '#1e88e5' },
    { name: '贷款利息', icon: '💳', color: '#f9a825' },
    { name: '娱乐', icon: '🎮', color: '#9575cd' },
    { name: '旅游', icon: '🏝', color: '#26a69a' },
    { name: '宠物', icon: '🐱', color: '#26a69a' },
    { name: '冤枉钱', icon: '😅', color: '#bcaaa4' },
    { name: '平账', icon: '⚖️', color: '#ef5350' },
  ];
  state.categories.income = [
    { name: '工资', icon: '💰', color: '#42a5f5' },
    { name: '生活费', icon: '💵', color: '#f9a825' },
    { name: '红包', icon: '🧧', color: '#ec407a' },
    { name: '零花钱', icon: '🐷', color: '#66bb6a' },
    { name: '外快兼职', icon: '🧩', color: '#26c6da' },
    { name: '投资收入', icon: '📈', color: '#a1887f' },
    { name: '奖金', icon: '🏅', color: '#ff7043' },
    { name: '报销', icon: '🧾', color: '#4dd0e1' },
    { name: '退款', icon: '💸', color: '#81c784' },
    { name: '其他', icon: '⭐', color: '#5c6bc0' },
    { name: '平账', icon: '⚖️', color: '#ef5350' },
  ];
}

// ---------- 渲染 ----------
function renderSummary(report) {
  const card = $('#summary-card');
  if (state.tab === 'assets') {
    card.innerHTML = `
      <div><div class="label">总资产</div><div class="amount">¥${fmt(report.totalAsset)}</div><div class="sub">净资产 ¥${fmt(report.netAsset)}</div></div>
    `;
  } else if (state.tab === 'liabilities') {
    card.innerHTML = `
      <div><div class="label">负债总额</div><div class="amount">¥${fmt(report.totalLiability)}</div></div>
    `;
  } else if (state.tab === 'receivables') {
    card.innerHTML = `
      <div><div class="label">应收</div><div class="amount">¥${fmt(report.receivable)}</div></div>
      <div><div class="label">应付</div><div class="amount" style="color:#ef5350">¥${fmt(report.payable)}</div></div>
    `;
  } else if (state.tab === 'entries') {
    card.innerHTML = `
      <div><div class="label">本月收入</div><div class="amount" style="color:#10b981">¥${fmt(report.monthly.income || 0)}</div></div>
      <div><div class="label">本月支出</div><div class="amount" style="color:#ef5350">¥${fmt(report.monthly.expense || 0)}</div></div>
    `;
  } else if (state.tab === 'periodic') {
    card.innerHTML = `<div><div class="label">周期账管理</div><div class="amount" style="font-size:20px">自动记账</div></div>`;
  } else {
    card.innerHTML = `<div><div class="label">设置</div></div>`;
  }
}

async function renderTab() {
  const c = $('#content');
  if (state.tab === 'assets') return renderAssets(c);
  if (state.tab === 'liabilities') return renderLiabilities(c);
  if (state.tab === 'receivables') return renderReceivables(c);
  if (state.tab === 'entries') return renderEntries(c);
  if (state.tab === 'periodic') return renderPeriodic(c);
  if (state.tab === 'settings') return renderSettings(c);
}

// 账户颜色轮换
const PALETTE = ['#42a5f5', '#ef5350', '#26c6da', '#ab47bc', '#5c6bc0', '#ec407a', '#ff7043', '#66bb6a'];

function renderAssets(c) {
  const assets = state.accounts.filter(a => a.type === 'asset');
  const shown = assets.filter(a => a.shown);
  const html = assets.map((a, i) => `
    <div class="account-card" style="background:${a.color || PALETTE[i % PALETTE.length]}" data-id="${a.id}">
      <div class="acc-left">
        <div class="acc-icon">${a.name === '现金' ? '¥' : '🏦'}</div>
        <div><div class="acc-name">${a.name}</div><div class="acc-sub">${a.sub_label || ''}</div></div>
      </div>
      <div class="acc-balance">${fmt(a.balance)}</div>
      <div class="acc-check">${a.shown ? '✓' : '○'}</div>
    </div>
  `).join('');
  c.innerHTML = html + `
    <button class="ghost-btn" id="flatten-btn">⚖️ 批量平账</button>
    <button class="add-btn" id="add-account-btn">＋ 添加账户</button>
  `;

  // 点击切换 shown
  $$('.account-card').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.dataset.id;
      const a = state.accounts.find(x => x.id == id);
      await api(`/api/accounts/${id}`, { method: 'PATCH', body: JSON.stringify({ shown: a.shown ? 0 : 1 }) });
      refresh();
    });
  });
  $('#add-account-btn').addEventListener('click', () => promptAddAccount('asset'));
  $('#flatten-btn').addEventListener('click', promptFlatten);
}

function renderLiabilities(c) {
  const liabs = state.accounts.filter(a => a.type === 'liability');
  const html = liabs.map((a, i) => `
    <div class="account-card" style="background:${a.color || PALETTE[(i+2) % PALETTE.length]}" data-id="${a.id}">
      <div class="acc-left">
        <div class="acc-icon">💳</div>
        <div><div class="acc-name">${a.name}</div><div class="acc-sub">${a.sub_label || ''}</div></div>
      </div>
      <div class="acc-balance">${fmt(a.balance)}</div>
    </div>
  `).join('');
  c.innerHTML = html + `<button class="add-btn" id="add-liab-btn">＋ 添加负债账户</button>`;
  $$('.account-card').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.dataset.id;
      const a = state.accounts.find(x => x.id == id);
      const newName = prompt('账户名称', a.name);
      if (newName) {
        await api(`/api/accounts/${id}`, { method: 'PATCH', body: JSON.stringify({ name: newName }) });
        refresh();
      }
    });
  });
  $('#add-liab-btn').addEventListener('click', () => promptAddAccount('liability'));
}

async function renderReceivables(c) {
  const res = await api('/api/receivables');
  const items = res.items;
  const html = items.map(it => `
    <div class="list-item" data-id="${it.id}">
      <div class="li-left">
        <div class="li-icon" style="background:${it.account_type === 'receivable' ? '#ff7043' : '#ef6fa7'}">${it.account_type === 'receivable' ? '收' : '付'}</div>
        <div><div class="li-name">${it.name}</div><div class="li-sub">${it.account_name} · ${it.date} ${it.status === 'done' ? '· 已结清' : ''}</div></div>
      </div>
      <div class="li-amount">${fmt(it.amount)}</div>
    </div>
  `).join('');
  c.innerHTML = html + `
    <button class="ghost-btn" id="add-recv-btn">＋ 添加应收</button>
    <button class="ghost-btn" id="add-pay-btn">＋ 添加应付</button>
  `;
  $('#add-recv-btn').addEventListener('click', () => promptAddItem('receivable'));
  $('#add-pay-btn').addEventListener('click', () => promptAddItem('payable'));
  $$('.list-item').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.dataset.id;
      const it = items.find(x => x.id == id);
      const act = confirm(`是否标记「${it.name}」为已结清？`);
      if (act) {
        await api(`/api/receivables/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) });
        renderTab();
      }
    });
  });
}

async function renderEntries(c) {
  const res = await api('/api/entries?limit=300');
  const entries = res.entries;
  // 按日期分组
  const groups = {};
  for (const e of entries) {
    (groups[e.date] ||= []).push(e);
  }
  let html = '';
  for (const date of Object.keys(groups).sort().reverse()) {
    html += `<div class="group-date">${date}</div>`;
    for (const e of groups[date]) {
      const isIncome = e.type === 'income';
      const sign = isIncome ? '+' : e.type === 'expense' || e.type === 'balance' ? '-' : '⇄';
      const color = e.category ? (state.categories[e.type === 'income' ? 'income' : 'expense'].find(x => x.name === e.category)?.color || '#999') : '#999';
      const icon = e.category ? (state.categories[e.type === 'income' ? 'income' : 'expense'].find(x => x.name === e.category)?.icon || '🏷') : '🏷';
      html += `
        <div class="list-item" data-id="${e.id}">
          <div class="li-left">
            <div class="li-icon" style="background:${color}">${icon}</div>
            <div><div class="li-name">${e.category || e.type}${e.is_balance ? ' ⚖️' : ''}</div><div class="li-sub">${e.note || ''}</div></div>
          </div>
          <div class="li-amount ${isIncome ? 'amount-income' : 'amount-expense'}">${sign}${fmt(e.amount)}</div>
        </div>
      `;
    }
  }
  c.innerHTML = html + `<button class="add-btn" id="balance-btn">⚖️ 记平账（清零现金）</button>`;
  $$('.list-item').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.dataset.id;
      const e = entries.find(x => x.id == id);
      const newAmount = prompt(`修改「${e.category}」金额（当前 ${fmt(e.amount)}，单位元）`, (e.amount / 100).toString());
      if (newAmount && !isNaN(parseFloat(newAmount))) {
        await api(`/api/entries/${id}`, { method: 'PATCH', body: JSON.stringify({ amount: Math.round(parseFloat(newAmount) * 100) }) });
        refresh();
      }
    });
  });
  $('#balance-btn').addEventListener('click', async () => {
    const note = prompt('平账备注', '一般性支出（平账）');
    await api('/api/entries/balance', { method: 'POST', body: JSON.stringify({ date: today(), note }) });
    refresh();
  });
}

async function renderPeriodic(c) {
  const res = await api('/api/periodic');
  const list = res.periodic;
  const html = list.map(p => `
    <div class="list-item" data-id="${p.id}">
      <div class="li-left">
        <div class="li-icon" style="background:#5c6bc0">🔄</div>
        <div><div class="li-name">${p.name} ${p.enabled ? '' : '(停用)'}</div><div class="li-sub">${p.cron} · 下次 ${(p.next_run || '').slice(0,10)}</div></div>
      </div>
      <div class="li-amount">¥${fmt(p.amount)}</div>
    </div>
  `).join('');
  c.innerHTML = html + `<button class="add-btn" id="add-periodic-btn">＋ 添加周期账</button>`;
  $('#add-periodic-btn').addEventListener('click', promptAddPeriodic);
  $$('.list-item').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.dataset.id;
      const p = list.find(x => x.id == id);
      const act = confirm(`是否${p.enabled ? '停用' : '启用'}「${p.name}」？`);
      if (act) {
        await api(`/api/periodic/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled: p.enabled ? 0 : 1 }) });
        renderTab();
      }
    });
  });
}

async function renderSettings(c) {
  const res = await api('/api/auth/settings');
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
      <label>SMTP 邮件备份配置（JSON，留空则不启用）</label>
      <textarea id="set-smtp">${res.smtp ? JSON.stringify(res.smtp, null, 2) : ''}</textarea>
      <div class="li-sub" style="margin-top:4px">格式：{"host":"smtp.qq.com","port":465,"user":"xx@qq.com","pass":"授权码","to":"收件邮箱"}</div>
    </div>
    <button class="btn-primary" id="save-settings-btn">保存设置</button>
  `;
  $('#save-settings-btn').addEventListener('click', async () => {
    const pwd = $('#set-pwd').value;
    let smtp = null;
    const smtpText = $('#set-smtp').value.trim();
    if (smtpText) {
      try { smtp = JSON.parse(smtpText); } catch { alert('SMTP 配置不是合法 JSON'); return; }
    }
    await api('/api/auth/settings', { method: 'POST', body: JSON.stringify({ web_password: pwd, smtp }) });
    alert('设置已保存');
  });
  $('#token-box').addEventListener('click', () => {
    navigator.clipboard.writeText(state.token);
    alert('Token 已复制');
  });
}

// ---------- 录入 ----------
function openEntryModal() {
  state.entryType = 'expense';
  state.entryCategory = '';
  state.entryAmount = '';
  $('#entry-modal').classList.remove('hidden');
  renderEntryModal();
}
function closeEntryModal() {
  $('#entry-modal').classList.add('hidden');
}

function renderEntryModal() {
  const body = $('#entry-body');
  const cats = state.entryType === 'income' ? state.categories.income : state.categories.expense;
  const isTransfer = state.entryType === 'transfer';
  body.innerHTML = `
    <div class="amount-display">¥ <span id="amount-text">${state.entryAmount || '0.00'}</span></div>
    ${isTransfer ? transferForm() : `
    <div class="cat-grid">
      ${cats.map(cat => `
        <div class="cat-item ${state.entryCategory === cat.name ? 'selected' : ''}" data-cat="${cat.name}">
          <div class="cat-icon" style="background:${cat.color}">${cat.icon}</div>
          <div class="cat-name">${cat.name}</div>
        </div>
      `).join('')}
    </div>
    <div class="form-row">
      <div class="form-label">日期</div>
      <input type="date" id="entry-date" value="${state.entryDate}">
    </div>
    <div class="form-row">
      <div class="form-label">备注</div>
      <input type="text" id="entry-note" value="${state.entryNote}" placeholder="可选">
    </div>
    <div class="keypad">
      ${['7','8','9','⌫','4','5','6','+','1','2','3','−','C','0','.','确定'].map(k => `
        <button class="key ${k === '确定' ? 'key-ok' : ''}" data-key="${k}">${k}</button>
      `).join('')}
    </div>
    `}
  `;

  // 分类选择
  $$('.cat-item').forEach(el => {
    el.addEventListener('click', () => {
      state.entryCategory = el.dataset.cat;
      renderEntryModal();
    });
  });

  // 键盘
  $$('.key').forEach(el => {
    el.addEventListener('click', () => {
      const k = el.dataset.key;
      handleKey(k);
    });
  });

  if (isTransfer) {
    bindTransfer();
  }
}

function transferForm() {
  const accs = state.accounts.filter(a => a.type === 'asset' || a.type === 'liability');
  return `
    <div class="form-row"><div class="form-label">转出</div>
      <select id="tr-from">${accs.map(a => `<option value="${a.id}">${a.name}</option>`).join('')}</select>
    </div>
    <div class="form-row"><div class="form-label">转入</div>
      <select id="tr-to">${accs.map(a => `<option value="${a.id}">${a.name}</option>`).join('')}</select>
    </div>
    <div class="form-row"><div class="form-label">日期</div>
      <input type="date" id="entry-date" value="${state.entryDate}">
    </div>
    <div class="form-row"><div class="form-label">备注</div>
      <input type="text" id="entry-note" value="${state.entryNote}">
    </div>
    <div class="keypad">
      ${['7','8','9','⌫','4','5','6','+','1','2','3','−','C','0','.','确定'].map(k => `
        <button class="key ${k === '确定' ? 'key-ok' : ''}" data-key="${k}">${k}</button>
      `).join('')}
    </div>
  `;
}

function handleKey(k) {
  if (k === '确定') return submitEntry();
  if (k === '⌫') { state.entryAmount = state.entryAmount.slice(0, -1); }
  else if (k === 'C') { state.entryAmount = ''; }
  else if (k === '.') {
    if (!state.entryAmount.includes('.')) state.entryAmount += state.entryAmount ? '.' : '0.';
  }
  else { state.entryAmount += k; }
  renderEntryModal();
}

async function submitEntry() {
  const amount = Math.round(parseFloat(state.entryAmount || '0') * 100);
  if (!amount) { alert('请输入金额'); return; }
  const date = $('#entry-date')?.value || state.entryDate;
  const note = $('#entry-note')?.value || state.entryNote;

  if (state.entryType === 'transfer') {
    const from = Number($('#tr-from').value);
    const to = Number($('#tr-to').value);
    await api('/api/entries', { method: 'POST', body: JSON.stringify({ date, type: 'transfer', account_id: from, target_account_id: to, amount, note }) });
  } else {
    await api('/api/entries', { method: 'POST', body: JSON.stringify({ date, type: state.entryType, category: state.entryCategory || '其他', amount, note }) });
  }
  closeEntryModal();
  refresh();
}

function bindTransfer() {
  // 转账无需额外绑定
}

// ---------- 各类 prompt ----------
async function promptAddAccount(type) {
  const name = prompt('账户名称');
  if (!name) return;
  const subLabel = prompt('副标题（如"储蓄卡"）', '');
  const balance = prompt('初始余额（元）', '0');
  await api('/api/accounts', {
    method: 'POST',
    body: JSON.stringify({ name, type, sub_label: subLabel, balance: Math.round(parseFloat(balance || '0') * 100) }),
  });
  refresh();
}

async function promptFlatten() {
  const assets = state.accounts.filter(a => a.type !== 'receivable' && a.type !== 'payable');
  const balances = {};
  const text = assets.map(a => `${a.name}（当前 ${fmt(a.balance)}）`).join('\n');
  const input = prompt(`批量平账：请按格式输入每行「账户名=实际余额」，\n当前账户：\n${text}`, '');
  if (!input) return;
  for (const line of input.split('\n')) {
    const [name, val] = line.split('=').map(s => s.trim());
    if (!name || val === undefined) continue;
    const acc = state.accounts.find(a => a.name === name);
    if (acc) balances[acc.id] = Math.round(parseFloat(val) * 100);
  }
  if (Object.keys(balances).length === 0) { alert('未识别到有效输入'); return; }
  const res = await api('/api/accounts/flatten', { method: 'POST', body: JSON.stringify({ date: today(), balances }) });
  alert(`平账完成，现金余额：${fmt(res.cash.balance)}`);
  refresh();
}

async function promptAddItem(type) {
  const accs = state.accounts.filter(a => a.type === type);
  if (accs.length === 0) {
    // 无对应账户则先建一个
    const name = prompt(`无${type === 'receivable' ? '应收' : '应付'}账户，先创建，输入账户名：`);
    if (!name) return;
    const acc = (await api('/api/accounts', { method: 'POST', body: JSON.stringify({ name, type, sub_label: type === 'receivable' ? '别人欠我的' : '我欠别人的' }) })).account;
    state.accounts.push(acc);
    return promptAddItem(type);
  }
  const acc = accs[0];
  const name = prompt(type === 'receivable' ? '借给谁' : '向谁借');
  if (!name) return;
  const amount = prompt('金额（元）', '0');
  const date = prompt('日期（YYYY-MM-DD）', today());
  await api('/api/receivables', {
    method: 'POST',
    body: JSON.stringify({ account_id: acc.id, name, amount: Math.round(parseFloat(amount || '0') * 100), date, status: 'open' }),
  });
  refresh();
}

async function promptAddPeriodic() {
  const name = prompt('名称（如"房贷"）');
  if (!name) return;
  const type = prompt('类型 expense/income', 'expense');
  const category = prompt('分类', name);
  const amount = prompt('金额（元）', '0');
  const cron = prompt('周期规则（MONTHLY:1 表示每月1号，或标准cron）', 'MONTHLY:1');
  await api('/api/periodic', {
    method: 'POST',
    body: JSON.stringify({ name, type, category, amount: Math.round(parseFloat(amount || '0') * 100), cron }),
  });
  refresh();
}

// ---------- 事件绑定 ----------
function bindEvents() {
  $('#login-btn').addEventListener('click', doLogin);
  $('#login-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

  // 顶栏 tab
  $$('.tab').forEach(el => {
    el.addEventListener('click', () => {
      state.tab = el.dataset.tab;
      $$('.tab').forEach(t => t.classList.remove('active'));
      el.classList.add('active');
      refresh();
    });
  });

  // 底部导航
  $$('.nav-btn').forEach(el => {
    el.addEventListener('click', () => {
      const nav = el.dataset.nav;
      if (nav === 'add') return openEntryModal();
      if (nav === 'assets') state.tab = 'assets';
      else if (nav === 'entries') state.tab = 'entries';
      else if (nav === 'periodic') state.tab = 'periodic';
      else if (nav === 'settings') state.tab = 'settings';
      $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === state.tab));
      $$('.nav-btn').forEach(n => n.classList.toggle('active', n.dataset.nav === nav));
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

// ---------- 启动 ----------
async function init() {
  bindEvents();
  if (state.token) {
    try {
      showMain();
      await refresh();
      return;
    } catch {}
  }
  // 无 token：先尝试用默认密码登录获取
  showLogin();
  // 尝试自动登录（默认密码）
  try {
    const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'admin123' }) });
    const data = await res.json();
    if (data.ok && data.token) { state.token = data.token; localStorage.setItem('zb_token', state.token); showMain(); refresh(); }
  } catch {}
}

init();
