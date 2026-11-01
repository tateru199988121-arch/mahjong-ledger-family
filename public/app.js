const $ = selector => document.querySelector(selector);
const state = { data: null, roomId: localStorage.getItem('mahjong-room') || '', view: 'overview', range: 'all', scope: 'family' };
const moneyFormat = new Intl.NumberFormat('zh-TW');

function h(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function money(value, sign = true) {
  const number = Number(value || 0);
  return `${sign && number > 0 ? '+' : ''}${moneyFormat.format(number)}`;
}
function moneyClass(value) { return value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral'; }
function taipeiToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function dateLabel(value) {
  return new Intl.DateTimeFormat('zh-TW', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Taipei' }).format(new Date(`${value}T12:00:00+08:00`));
}
function shortTime(value) {
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
function initials(name) { return [...String(name || '?')].slice(0, 1).join(''); }
function person(id) { return state.data.people.find(item => item.id === id); }
function room() { return state.data.rooms.find(item => item.id === state.roomId); }
function roomPeople() { return state.data.people.filter(item => item.roomId === state.roomId); }
function roomGames() { return state.data.games.filter(item => item.roomId === state.roomId && !item.archived).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)); }
function currentActor() { return localStorage.getItem(`mahjong-actor-${state.roomId}`) || roomPeople().find(item => item.kind === 'family')?.name || '家人'; }
function gameSum(game) { return game.entries.reduce((total, row) => total + row.amount, 0); }
function eastSum(game) { return game.entries.reduce((total, row) => total + (row.eastMoney || 0), 0); }

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(value.error || '操作失敗，請稍後再試'), { status: response.status });
  return value;
}

let toastTimer;
function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 3300);
}

async function reload() {
  state.data = await api('/api/state');
  if (!state.data.rooms.some(item => item.id === state.roomId)) state.roomId = state.data.rooms[0]?.id || '';
  localStorage.setItem('mahjong-room', state.roomId);
  render();
}

function showUnlock() {
  $('#app').innerHTML = `<div class="unlock-screen"><div class="unlock-card"><div class="brand-mark">中</div><h1>麻將有帳</h1><p>輸入家庭編輯碼，查看並更新麻將場戰績。</p><form id="unlock-form"><label class="field"><span>家庭編輯碼</span><input type="password" name="code" required autofocus autocomplete="current-password"></label><button class="primary-button" type="submit">進入帳本</button></form></div></div>`;
  $('#unlock-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try { await api('/api/unlock', { method: 'POST', body: { code: new FormData(event.currentTarget).get('code') } }); location.reload(); }
    catch (error) { toast(error.message); button.disabled = false; }
  });
}

function renderShell() {
  const rooms = state.data.rooms;
  const roomOptions = rooms.map(item => `<option value="${h(item.id)}" ${item.id === state.roomId ? 'selected' : ''}>${h(item.name)}</option>`).join('') + '<option value="__new">＋ 新增房間</option>' + (room() ? '<option value="__rename">✎ 重新命名房間</option>' : '');
  $('#room-select').innerHTML = roomOptions;
  $('#room-select-mobile').innerHTML = roomOptions;
  $('#top-room-name').textContent = room()?.name || '尚未建立房間';
  const family = roomPeople().filter(item => item.kind === 'family');
  $('#actor-select').innerHTML = family.length ? family.map(item => `<option value="${h(item.name)}" ${item.name === currentActor() ? 'selected' : ''}>${h(item.name)}</option>`).join('') : '<option value="家人">家人</option>';
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === state.view));
}

function demoBanner() {
  return state.data.demo ? `<div class="demo-banner"><span>✦ 目前顯示示範資料，你可以先試試所有功能。</span><button data-action="clear-demo">清空範例，開始自己的帳本</button></div>` : '';
}

function emptyRoom() {
  return `<div class="page-heading"><div><span class="eyebrow">歡迎使用</span><h1>建立你的麻將場</h1><p>每個房間有自己的參與者、每日紀錄與累積戰績。</p></div></div><div class="empty-state"><div class="empty-icon">🀄</div><h3>先幫麻將場取個名字</h3><p>例如「阿嬤家麻將桌」或「週末牌咖」。</p><button class="primary-button" data-action="add-room">＋ 建立房間</button></div>`;
}

function filteredGames() {
  const today = taipeiToday();
  return roomGames().filter(game => state.range === 'all' || (state.range === 'month' ? game.date.slice(0, 7) === today.slice(0, 7) : game.date.slice(0, 4) === today.slice(0, 4)));
}

function stats(scope = state.scope) {
  const map = new Map(roomPeople().map(item => [item.id, { ...item, total: 0, east: 0, played: 0, wins: 0 }]));
  const countedDays = new Set();
  for (const game of filteredGames()) for (const entry of game.entries) {
    const row = map.get(entry.personId);
    if (!row) continue;
    row.total += entry.amount;
    row.east += entry.eastMoney || 0;
    const dayKey = `${entry.personId}:${game.date}`;
    if (!countedDays.has(dayKey)) { row.played += 1; countedDays.add(dayKey); }
    if (entry.amount > 0) row.wins += 1;
  }
  return [...map.values()].filter(item => scope === 'all' || item.kind === 'family').sort((a, b) => b.total - a.total || b.played - a.played);
}

function rangeButtons() {
  return `<div class="segmented" aria-label="期間篩選">${[['month', '本月'], ['year', '今年'], ['all', '全部']].map(([key, label]) => `<button data-range="${key}" class="${state.range === key ? 'active' : ''}">${label}</button>`).join('')}</div>`;
}

function personCell(item) {
  return `<span class="person-cell"><span class="avatar" style="background:${h(item.color)}">${h(initials(item.name))}</span><span><strong>${h(item.name)}</strong><small>${item.kind === 'family' ? '家人' : '朋友'}・${item.played} 天</small></span></span>`;
}

function leaderboard() {
  const rows = stats();
  if (!rows.length) return `<div class="leaderboard"><div class="empty-note">目前還沒有人物，先新增家人或朋友吧。</div></div>`;
  return `<div class="leaderboard"><div class="leader-head"><span>參與者</span><span class="number">輸贏累計</span><span class="number">平均每天</span><span class="number">東錢</span></div>${rows.map(item => `<div class="leader-row">${personCell(item)}<strong class="number ${moneyClass(item.total)}">${money(item.total)}</strong><span class="number ${moneyClass(item.played ? item.total / item.played : 0)}">${money(item.played ? Math.round(item.total / item.played) : 0)}</span><span class="number">${money(item.east)}</span></div>`).join('')}</div>`;
}

function gameCard(game) {
  const members = game.entries.map(entry => person(entry.personId)?.name || '已移除人物').join('、');
  const [year, month, day] = game.date.split('-');
  return `<button class="game-card" data-game="${h(game.id)}"><span class="date-box"><strong>${h(day)}</strong><small>${h(month)} 月</small></span><span class="game-main"><strong>${h(game.title || '當日輸贏')}</strong><small>${h(year)} 年・${h(members)}</small></span><span class="game-amount">已登錄 ${game.entries.length} 人</span><span class="game-arrow">›</span></button>`;
}

function recentGames(list = roomGames().slice(0, 5)) {
  return list.length ? `<div class="recent-list">${list.map(gameCard).join('')}</div>` : `<div class="empty-state"><div class="empty-icon">▤</div><h3>還沒有每日紀錄</h3><p>有人要先離開，就先登錄自己的當日輸贏。</p><button class="primary-button" data-action="add-game">＋ 登錄輸贏</button></div>`;
}

function renderOverview() {
  const games = filteredGames();
  const dayCount = new Set(games.map(game => game.date)).size;
  const family = roomPeople().filter(item => item.kind === 'family');
  const east = games.reduce((sum, game) => sum + eastSum(game), 0);
  const leader = stats().find(item => item.played && item.total > 0);
  return `${demoBanner()}<section class="hero"><div class="hero-copy"><span class="eyebrow">✦ ${h(room().name)}</span><h1>每天的輸贏，隨時補上。</h1><p>先走的人先登錄，收工後大家再確認當日紀錄。</p><button class="hero-action" data-action="add-game">＋ 登錄今日輸贏</button></div><div class="hero-tile" aria-hidden="true">發</div></section>
  <div class="stats-grid"><div class="stat-card"><div class="stat-top"><span>已記錄天數</span><span class="stat-icon">▤</span></div><div class="stat-value">${dayCount}</div><div class="stat-desc">${state.range === 'all' ? '所有時間' : state.range === 'year' ? '今年' : '本月'}的日紀錄</div></div><div class="stat-card"><div class="stat-top"><span>常來的家人</span><span class="stat-icon">♧</span></div><div class="stat-value">${family.length}</div><div class="stat-desc">朋友也可以隨時加入</div></div><div class="stat-card"><div class="stat-top"><span>東錢紀錄</span><span class="stat-icon">＄</span></div><div class="stat-value">${money(east, false)}</div><div class="stat-desc">${leader ? `本期領先：${h(leader.name)} ${money(leader.total)}` : '與輸贏分開統計'}</div></div></div>
  <div class="section-heading"><h2>累積戰績 <small>依每人已登錄的日紀錄統計</small></h2><div class="toolbar">${rangeButtons()}</div></div>
  <div class="filter-bar"><div class="segmented"><button data-scope="family" class="${state.scope === 'family' ? 'active' : ''}">家人</button><button data-scope="all" class="${state.scope === 'all' ? 'active' : ''}">所有人</button></div><button class="text-button" data-action="add-person">＋ 新增人物</button></div>${leaderboard()}
  <div class="section-heading"><h2>最近日紀錄</h2><button class="text-button" data-action="go-games">查看全部 ›</button></div>${recentGames()}`;
}

function renderGames() {
  const games = filteredGames();
  return `${demoBanner()}<div class="page-heading"><div><span class="eyebrow">DAILY LEDGER</span><h1>每日紀錄</h1><p>同一天可由不同人陸續登錄；不用等所有人都打完。</p></div><button class="button-outline" data-action="add-game">＋ 登錄輸贏</button></div><div class="filter-bar">${rangeButtons()}<span style="color:var(--muted);font-size:12px">共 ${new Set(games.map(game => game.date)).size} 天</span></div>${recentGames(games)}`;
}

function renderPeople() {
  const members = roomPeople();
  const byId = new Map(stats('all').map(item => [item.id, item]));
  return `${demoBanner()}<div class="page-heading"><div><span class="eyebrow">PLAYERS</span><h1>人物名單</h1><p>每個房間有自己的名單，朋友下次來可以沿用同一個名字。</p></div><button class="button-outline" data-action="add-person">＋ 新增人物</button></div>${members.length ? `<div class="people-grid">${members.map(item => { const score = byId.get(item.id); return `<div class="people-card"><span class="avatar" style="background:${h(item.color)}">${h(initials(item.name))}</span><h3>${h(item.name)}</h3><span class="pill ${item.kind}">${item.kind === 'family' ? '家人・可編輯' : '朋友・可分享查看'}</span><p>已登錄 ${score?.played || 0} 天　·　輸贏 <strong class="${moneyClass(score?.total || 0)}">${money(score?.total || 0)}</strong><br>東錢 ${money(score?.east || 0)}</p></div>`; }).join('')}</div>` : `<div class="empty-state"><div class="empty-icon">♧</div><h3>名單還是空的</h3><p>先新增人物，再開始記錄當日輸贏。</p><button class="primary-button" data-action="add-person">＋ 新增人物</button></div>`}`;
}

function render() {
  if (!state.data) return;
  renderShell();
  $('#view').innerHTML = !room() ? emptyRoom() : state.view === 'games' ? renderGames() : state.view === 'people' ? renderPeople() : renderOverview();
}

function showModal(title, subtitle, content, wide = false) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${h(title)}"><div class="modal-header"><div><h2>${h(title)}</h2><p>${h(subtitle)}</p></div><button type="button" class="icon-button" data-close aria-label="關閉">×</button></div>${content}</div>`;
  $('#modal-root').append(overlay);
  overlay.addEventListener('click', event => { if (event.target === overlay || event.target.closest('[data-close]')) overlay.remove(); });
  return overlay;
}

function openRoomForm(existing = false) {
  const current = existing ? room() : null;
  const overlay = showModal(current ? '房間名稱' : '新增麻將場', '一個房間有自己的參與者與戰績。', `<form id="room-form"><div class="modal-body"><label class="field"><span>麻將場名稱</span><input name="name" maxlength="20" required placeholder="例如：阿嬤家的麻將桌" value="${h(current?.name || '')}" autofocus></label></div><div class="modal-footer"><button type="button" class="button-outline" data-close>取消</button><button class="primary-button" type="submit">${current ? '儲存名稱' : '建立房間'}</button></div></form>`);
  overlay.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get('name');
    const button = event.currentTarget.querySelector('[type=submit]'); button.disabled = true;
    try {
      const saved = await api(current ? `/api/rooms/${current.id}` : '/api/rooms', { method: current ? 'PUT' : 'POST', body: { name } });
      if (!current) state.roomId = saved.id;
      overlay.remove(); await reload(); toast(current ? '房間名稱已更新' : '房間建立完成');
    } catch (error) { toast(error.message); button.disabled = false; }
  });
}

function openPersonForm(onSaved) {
  if (!room()) return openRoomForm();
  const overlay = showModal('新增人物', '家人可編輯整個房間，朋友會列入戰績名單。', `<form id="person-form"><div class="modal-body"><label class="field"><span>稱呼</span><input name="name" maxlength="20" required placeholder="例如：爸爸、王叔叔" autofocus></label><label class="field"><span>身份</span><select name="kind"><option value="family">家人</option><option value="guest">朋友</option></select></label></div><div class="modal-footer"><button type="button" class="button-outline" data-close>取消</button><button class="primary-button" type="submit">新增人物</button></div></form>`);
  overlay.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const button = form.querySelector('[type=submit]'); button.disabled = true;
    try {
      const saved = await api('/api/people', { method: 'POST', body: { roomId: state.roomId, name: data.get('name'), kind: data.get('kind') } });
      overlay.remove(); await reload(); onSaved?.(saved); toast(`${saved.name} 已加入名單`);
    } catch (error) { toast(error.message); button.disabled = false; }
  });
}

function openDayEntryForm(day = taipeiToday(), selectedPersonId = '') {
  if (!room()) return openRoomForm();
  if (!roomPeople().length) { toast('請先新增人物'); return openPersonForm(saved => openDayEntryForm(day, saved.id)); }
  const actorPerson = roomPeople().find(item => item.name === currentActor());
  const initialPersonId = selectedPersonId || actorPerson?.id || roomPeople()[0].id;
  const personOptions = () => roomPeople().map(item => `<option value="${h(item.id)}">${h(item.name)}${item.kind === 'guest' ? '（朋友）' : ''}</option>`).join('');
  const overlay = showModal('登錄當日輸贏', '先離開的人可先填自己的金額，其他人晚點再補上。', `<form id="day-entry-form"><div class="modal-body"><div class="form-pair"><label class="field"><span>日期</span><input type="date" name="date" required value="${h(day)}"></label><label class="field"><span>登錄人物</span><select name="personId" required>${personOptions()}</select></label></div><button type="button" class="text-button" id="add-person-inline">＋ 名單沒有這個人？新增人物</button><div class="form-pair"><label class="field"><span>當日輸贏</span><input type="number" step="1" name="amount" required placeholder="可填正數、負數或 0"></label><label class="field"><span>東錢</span><input type="number" step="1" name="eastMoney" required value="0"></label></div><p class="form-help" id="day-entry-hint">只記這個人的當日金額，不必填其他人的輸贏，也不用合計為 0。</p></div><div class="modal-footer"><button type="button" class="button-outline" data-close>取消</button><button class="primary-button" type="submit">儲存當日輸贏</button></div></form>`);
  const form = overlay.querySelector('form');
  const dateInput = form.elements.namedItem('date');
  const personSelect = form.elements.namedItem('personId');
  const amountInput = form.elements.namedItem('amount');
  const eastInput = form.elements.namedItem('eastMoney');
  personSelect.value = initialPersonId;
  function prefill() {
    const existing = roomGames().find(item => item.date === dateInput.value)?.entries.find(entry => entry.personId === personSelect.value);
    amountInput.value = existing ? String(existing.amount) : '';
    eastInput.value = existing ? String(existing.eastMoney || 0) : '0';
    overlay.querySelector('#day-entry-hint').textContent = existing
      ? '這個人當天已有紀錄；儲存後會以這次填寫的數字取代原紀錄。'
      : '只記這個人的當日金額，其他人可以稍後再補上。';
  }
  prefill();
  dateInput.addEventListener('change', prefill);
  personSelect.addEventListener('change', prefill);
  overlay.querySelector('#add-person-inline').addEventListener('click', () => openPersonForm(saved => {
    personSelect.innerHTML = personOptions();
    personSelect.value = saved.id;
    prefill();
  }));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    try {
      await api('/api/day-entry', {
        method: 'POST',
        body: {
          roomId: state.roomId, date: dateInput.value, personId: personSelect.value,
          amount: amountInput.value, eastMoney: eastInput.value, actor: currentActor()
        }
      });
      overlay.remove();
      await reload();
      toast('當日輸贏已登錄，其他人可以繼續補上');
    } catch (error) { toast(error.message); button.disabled = false; }
  });
}

function openGameForm(game = null) {
  if (!room()) return openRoomForm();
  if (!roomPeople().length) { toast('請先新增人物'); return openPersonForm(); }
  const firstPerson = roomPeople().find(item => item.name === currentActor()) || roomPeople()[0];
  const draft = {
    date: game?.date || taipeiToday(), title: game?.title || '',
    entries: game ? game.entries.map(item => ({ ...item })) : [{ personId: firstPerson.id, amount: 0, eastMoney: 0 }]
  };
  const overlay = showModal(game ? '修改當日紀錄' : '新增當日紀錄', '同一天可陸續加入人物，各自填寫最後輸贏與東錢。', `<form id="game-form"><div class="modal-body"><div class="form-pair"><label class="field"><span>日期</span><input type="date" name="date" required value="${h(draft.date)}"></label><label class="field"><span>備註（選填）</span><input name="title" maxlength="40" placeholder="例如：週末小聚" value="${h(draft.title)}"></label></div><div class="entry-head"><span>參與者</span><span style="text-align:right">輸贏</span><span style="text-align:right">東錢</span><span></span></div><div id="entry-rows"></div><button type="button" class="add-entry" id="add-entry">＋ 加入參與者</button><button type="button" class="text-button" id="add-person-inline">＋ 名單沒有這個人？新增人物</button><p class="form-help">每人填寫自己的當日金額，可為正數、負數或 0；不需要合計為 0。</p></div><div class="modal-footer">${game ? '<button type="button" class="danger-button" id="delete-game">刪除這一天</button>' : ''}<button type="button" class="button-outline" data-close>取消</button><button class="primary-button" type="submit">${game ? '儲存修改' : '儲存日紀錄'}</button></div></form>`, true);
  const form = overlay.querySelector('form');
  const rows = overlay.querySelector('#entry-rows');
  function renderRows() {
    rows.innerHTML = draft.entries.map((entry, index) => `<div class="entry-row" data-row="${index}"><select aria-label="第 ${index + 1} 位參與者"><option value="">選擇人物</option>${roomPeople().map(item => `<option value="${h(item.id)}" ${item.id === entry.personId ? 'selected' : ''}>${h(item.name)}</option>`).join('')}</select><input type="number" step="1" aria-label="第 ${index + 1} 位輸贏" value="${h(entry.amount)}"><input type="number" step="1" aria-label="第 ${index + 1} 位東錢" value="${h(entry.eastMoney || 0)}"><button type="button" class="remove-row" data-remove="${index}" aria-label="移除參與者">×</button></div>`).join('');
  }
  renderRows();
  rows.addEventListener('input', event => {
    const row = event.target.closest('[data-row]'); if (!row) return;
    const index = Number(row.dataset.row);
    const inputs = row.querySelectorAll('input');
    draft.entries[index].amount = inputs[0].value;
    draft.entries[index].eastMoney = inputs[1].value;
  });
  rows.addEventListener('change', event => {
    if (event.target.tagName !== 'SELECT') return;
    const index = Number(event.target.closest('[data-row]').dataset.row);
    draft.entries[index].personId = event.target.value;
  });
  rows.addEventListener('click', event => {
    const button = event.target.closest('[data-remove]'); if (!button) return;
    draft.entries.splice(Number(button.dataset.remove), 1); renderRows();
  });
  overlay.querySelector('#add-entry').addEventListener('click', () => {
    const next = roomPeople().find(item => !draft.entries.some(entry => entry.personId === item.id));
    if (!next) return toast('名單裡的人都已經加入，請先新增人物');
    draft.entries.push({ personId: next.id, amount: 0, eastMoney: 0 }); renderRows();
  });
  overlay.querySelector('#add-person-inline').addEventListener('click', () => openPersonForm(saved => {
    draft.entries.push({ personId: saved.id, amount: 0, eastMoney: 0 }); renderRows();
  }));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const formData = new FormData(form);
    const entries = draft.entries.map(entry => ({ personId: entry.personId, amount: Number(entry.amount), eastMoney: Number(entry.eastMoney) }));
    if (entries.length < 1) return toast('至少需要一位參與者');
    if (new Set(entries.map(entry => entry.personId)).size !== entries.length) return toast('同一個人不能重複加入');
    const button = form.querySelector('[type=submit]'); button.disabled = true;
    try {
      await api(game ? `/api/games/${game.id}` : '/api/games', {
        method: game ? 'PUT' : 'POST',
        body: { roomId: state.roomId, date: formData.get('date'), title: formData.get('title'), entries, version: game?.version, actor: currentActor() }
      });
      overlay.remove(); await reload(); toast(game ? '日紀錄已更新' : '日紀錄已建立');
    } catch (error) {
      toast(error.message); button.disabled = false;
      if (error.status === 409) await reload();
    }
  });
  if (game) overlay.querySelector('#delete-game').addEventListener('click', async () => {
    if (!confirm('確定要刪除這一天的紀錄？戰績會同步重新計算。')) return;
    try { await api(`/api/games/${game.id}`, { method: 'DELETE', body: { version: game.version, actor: currentActor() } }); overlay.remove(); await reload(); toast('日紀錄已刪除'); }
    catch (error) { toast(error.message); if (error.status === 409) await reload(); }
  });
}

function detailRows(game) {
  return `<div class="detail-list"><div class="detail-list-head"><span>參與者</span><span>輸贏</span><span>東錢</span></div>${game.entries.map(entry => `<div class="detail-list-row"><strong>${h(person(entry.personId)?.name || '已移除人物')}</strong><strong class="${moneyClass(entry.amount)}">${money(entry.amount)}</strong><strong>${money(entry.eastMoney || 0)}</strong></div>`).join('')}</div>`;
}

function openGameDetail(game) {
  const current = state.data.games.find(item => item.id === game.id);
  if (!current) return;
  const overlay = showModal(current.title || '當日輸贏', `${dateLabel(current.date)}・${room()?.name || ''}`, `<div class="modal-body"><div class="detail-summary"><div><small>已登錄人數</small><strong>${current.entries.length} 人</strong></div><div><small>東錢合計</small><strong>${money(eastSum(current))}</strong></div></div>${detailRows(current)}<div class="audit"><h3>修改紀錄</h3>${[...current.history].reverse().map(item => `<div class="audit-item"><strong>${h(item.actor)} ${h(item.action)}了日紀錄</strong><small>${h(shortTime(item.at))}${item.previous ? `・修改前：${item.previous.entries.map(row => `${h(person(row.personId)?.name || '人物')} ${money(row.amount)}`).join('、')}` : ''}</small></div>`).join('')}</div><p class="share-hint">分享連結僅能查看這一天，無法修改或查看房間其他日期。</p></div><div class="modal-footer"><button type="button" class="danger-button" id="delete-game-detail">刪除這一天</button><button type="button" class="button-outline" id="share-game">分享給朋友</button><button type="button" class="button-outline" id="edit-game">編輯整天</button><button type="button" class="primary-button" id="add-day-entry">補登一人</button></div>`, true);
  overlay.querySelector('#edit-game').addEventListener('click', () => { overlay.remove(); openGameForm(current); });
  overlay.querySelector('#add-day-entry').addEventListener('click', () => { overlay.remove(); openDayEntryForm(current.date); });
  overlay.querySelector('#delete-game-detail').addEventListener('click', async () => {
    if (!confirm('確定要刪除這一天的紀錄？戰績會同步重新計算。')) return;
    try { await api(`/api/games/${current.id}`, { method: 'DELETE', body: { version: current.version, actor: currentActor() } }); overlay.remove(); await reload(); toast('當日紀錄已刪除'); }
    catch (error) { toast(error.message); if (error.status === 409) await reload(); }
  });
  overlay.querySelector('#share-game').addEventListener('click', async () => {
    const link = `${location.origin}/s/${current.shareToken}`;
    try { await navigator.clipboard.writeText(link); toast('當日查看連結已複製'); }
    catch { prompt('複製此連結分享給朋友', link); }
  });
}

async function guestPage(token) {
  $('#app').hidden = true;
  const root = $('#guest-root'); root.hidden = false;
  try {
    const { game, people } = await api(`/api/shared/${encodeURIComponent(token)}`);
    const names = new Map(people.map(item => [item.id, item.name]));
    root.innerHTML = `<div class="guest-page"><div class="guest-card"><div class="guest-head"><div class="brand-mark">中</div><h1>當日麻將紀錄</h1><p>由麻將有帳分享・僅供查看</p></div><div class="guest-panel"><span class="eyebrow">${h(dateLabel(game.date))}</span><h2 style="margin:9px 0 4px">${h(game.title || '當日輸贏')}</h2><p style="color:var(--muted);font-size:12px">已登錄 ${game.entries.length} 位人物</p><div class="detail-list"><div class="detail-list-head"><span>參與者</span><span>輸贏</span><span>東錢</span></div>${game.entries.map(entry => `<div class="detail-list-row"><strong>${h(names.get(entry.personId) || '人物')}</strong><strong class="${moneyClass(entry.amount)}">${money(entry.amount)}</strong><strong>${money(entry.eastMoney || 0)}</strong></div>`).join('')}</div><p class="share-hint">每人可在離開時登錄當日金額；輸贏與東錢分開記錄。</p></div><div class="guest-foot">麻將有帳 · 家人的麻將戰績簿</div></div></div>`;
  } catch (error) {
    root.innerHTML = `<div class="guest-page"><div class="guest-card"><div class="guest-head"><div class="brand-mark">中</div><h1>無法開啟分享頁</h1><p>${h(error.message)}</p></div></div></div>`;
  }
}

function changeRoom(id) {
  if (id === '__new') { renderShell(); return openRoomForm(); }
  if (id === '__rename') { renderShell(); return openRoomForm(true); }
  state.roomId = id; localStorage.setItem('mahjong-room', id); state.range = 'all'; state.scope = 'family'; render();
}
function changeView(view) { state.view = view; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

document.addEventListener('click', async event => {
  const nav = event.target.closest('[data-view]'); if (nav) return changeView(nav.dataset.view);
  const gameButton = event.target.closest('[data-game]'); if (gameButton) return openGameDetail(state.data.games.find(item => item.id === gameButton.dataset.game));
  const range = event.target.closest('[data-range]'); if (range) { state.range = range.dataset.range; return render(); }
  const scope = event.target.closest('[data-scope]'); if (scope) { state.scope = scope.dataset.scope; return render(); }
  const action = event.target.closest('[data-action]'); if (!action) return;
  switch (action.dataset.action) {
    case 'add-room': return openRoomForm();
    case 'add-person': return openPersonForm();
    case 'add-game': return openDayEntryForm();
    case 'go-games': return changeView('games');
    case 'clear-demo':
      if (!confirm('確定清空示範資料？清空後就可以建立自己的房間。')) return;
      try { await api('/api/reset-demo', { method: 'POST' }); await reload(); toast('示範資料已清空'); }
      catch (error) { toast(error.message); }
  }
});

$('#room-select').addEventListener('change', event => changeRoom(event.target.value));
$('#room-select-mobile').addEventListener('change', event => changeRoom(event.target.value));
$('#actor-select').addEventListener('change', event => localStorage.setItem(`mahjong-actor-${state.roomId}`, event.target.value));
$('#add-room').addEventListener('click', () => openRoomForm());
$('#top-add-game').addEventListener('click', () => openDayEntryForm());
$('#mobile-add-game').addEventListener('click', () => openDayEntryForm());
$('#export-data').addEventListener('click', () => { location.href = '/api/export'; });

(async () => {
  const shared = /^\/s\/([a-f0-9]+)$/.exec(location.pathname);
  if (shared) return guestPage(shared[1]);
  try { await reload(); }
  catch (error) { if (error.status === 401) showUnlock(); else toast(error.message); }
})();
