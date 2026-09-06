'use strict';
(() => {
  const api = BandAPI.create('t');
  const $ = id => document.getElementById(id);
  const state = { data: undefined, monthId: '', draft: new Map(), busy: false };
  const slots = session => session['種別'] === '本番' ? [['終日', '終日']] : [['am', '午前'], ['pm', '午後']];
  const apiSlot = slot => ({ am: '午前', pm: '午後', 終日: '終日' }[slot] || slot);
  const sessionDate = session => new Date(`${session['日付']}T00:00:00+09:00`);
  const monthKey = value => String(value || '').trim().slice(0, 7);
  const monthLabel = monthId => monthKey(monthId).replace('-', '年') + '月';
  const months = () => (state.data?.months || []).slice().sort((a, b) => monthKey(a['月ID']).localeCompare(monthKey(b['月ID'])));
  const monthSessions = () => (state.data?.sessions || []).filter(s => monthKey(s['月ID']) === monthKey(state.monthId)).sort((a, b) => a['日付'].localeCompare(b['日付']));
  function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
  function button(label, click, selected, className) { const node = el('button', label, className); node.type = 'button'; node.addEventListener('click', click); if (selected !== undefined) node.setAttribute('aria-pressed', String(selected)); return node; }
  function message(text, error = false) { $('message').textContent = text; $('message').className = error ? 'error' : ''; $('message').setAttribute('role', error ? 'alert' : 'status'); }
  function isPracticeSlot(session, slot) { if (session['種別'] === '本番') return true; const value = session[`実施有無_${slot}`] || session[`実施_${slot}`]; return value !== 'なし' && value !== '実施しない' && value !== false; }
  function needsTeacherInput(session, slot) { return session['種別'] !== '自主練' && session['種別'] !== '本番' && isPracticeSlot(session, slot) && session[`staffing_${slot}`] !== '自主練'; }
  function availabilityKey(sessionId, slot) { return `${sessionId}|${slot}`; }
  function currentValue(sessionId, slot) { const key = availabilityKey(sessionId, slot); return state.draft.has(key) ? state.draft.get(key) : undefined; }
  function existingValue(sessionId, slot) { return (state.data.availability || []).find(row => row['予定ID'] === sessionId && row['枠'] === apiSlot(slot))?.['可否'] || ''; }
  function setValue(sessionId, slot, value) { state.draft.set(availabilityKey(sessionId, slot), value); updateSaveState(); }
  function renderMonths() {
    const wrap = $('months'); wrap.replaceChildren();
    for (const month of months()) wrap.append(button(monthLabel(month['月ID']), () => { state.monthId = monthKey(month['月ID']); render(); }, monthKey(state.monthId) === monthKey(month['月ID'])));
    if (!months().length) wrap.append(el('p', '対象月はまだありません。', 'muted'));
  }
  function slotCard(session, slot, label) {
    const card = el('section', undefined, 'slot');
    const heading = el('h3', label); const draft = currentValue(session['予定ID'], slot); const value = draft === undefined ? existingValue(session['予定ID'], slot) : draft;
    const options = [['○', '○ 参加可'], ['×', '× 不可']];
    const choices = el('div', undefined, 'pills'); choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', `${session['日付']} ${label}の可否`);
    options.forEach(([id, text]) => {
      const node = button(text, () => { setValue(session['予定ID'], slot, id); choices.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === node))); }, value === id);
      node.dataset.value = id; choices.append(node);
    });
    const clear = button('未入力に戻す', () => {
      setValue(session['予定ID'], slot, ''); choices.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', 'false'));
    }, undefined, 'clear-answer');
    card.append(heading, choices, clear); return card;
  }
  function renderSession(session) {
    const card = el('article', undefined, 'card');
    const date = sessionDate(session); const day = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
    card.append(el('h2', `${session['日付'].slice(5).replace('-', '月')}日（${day}） · ${session['種別']}`));
    const place = session['場所名'] || (state.data.places || []).find(row => row['場所ID'] === session['場所ID'])?.['名称'] || session['場所ID'] || '場所未設定';
    card.append(el('p', `${place} · 集合 ${session['集合']} · ${session['開始']}–${session['終了']} · 解散 ${session['解散']}`, 'session-meta'));
    const grid = el('div', undefined, 'slot-grid');
    for (const [slot, label] of slots(session)) {
      if (!isPracticeSlot(session, slot)) { const empty = el('div', undefined, 'not-needed'); empty.append(el('strong', `${label} · 練習なし`), el('span', 'この枠は実施しないため、先生の入力は不要です。')); grid.append(empty); continue; }
      if (!needsTeacherInput(session, slot)) { const self = el('div', undefined, 'not-needed'); const isEvent = session['種別'] === '本番'; self.append(el('strong', `${label} · ${isEvent ? '本番' : '自主練'}`), el('span', isEvent ? '本番は管理者が出席・担当を確定するため、先生の入力は不要です。' : '先生なしで実施する枠のため、先生の入力は不要です。')); grid.append(self); continue; }
      grid.append(slotCard(session, slot, label));
    }
    if (grid.children.length) card.append(grid); return card;
  }
  function render() {
    renderMonths(); const wrap = $('sessions'); wrap.replaceChildren();
    const sessions = monthSessions();
    if (!sessions.length) { wrap.append(el('p', 'この月の候補日はありません。', 'muted')); updateSaveState(); return; }
    sessions.forEach(session => wrap.append(renderSession(session)));
    updateSaveState();
  }
  function updateSaveState() { const count = state.draft.size; $('save-state').textContent = count ? `未送信：${count}枠` : '変更はありません。'; $('save').disabled = state.busy || !count; }
  async function load() {
    state.data = await api.request('teacher_bootstrap');
    state.draft.clear(); const first = months()[0]; state.monthId = monthKey(first?.['月ID']); $('teacher-name').textContent = state.data.teacher?.['氏名'] || '先生'; $('connection').hidden = true; $('workspace').hidden = false; render();
  }
  async function run(task, success) {
    if (state.busy) return; state.busy = true; updateSaveState(); message('処理中です…');
    try { await task(); if (success) message(success); } catch (error) { if (error.code === 'unauthorized' || error.code === 'forbidden') api.forget(); message(error.message || '接続に失敗しました。', true); } finally { state.busy = false; updateSaveState(); }
  }
  $('save').addEventListener('click', () => run(async () => { const records = [...state.draft.entries()].map(([key, availability]) => { const [sessionId, slot] = key.split('|'); return { sessionId, slot: apiSlot(slot), availability }; }); await api.request('save_teacher_availability', { records }); await load(); }, '先生の可否を保存しました。'));
  $('connect').addEventListener('click', () => run(async () => { api.configure($('api-url').value.trim()); await load(); }, '接続しました。'));
  if (!api.hasToken) message('先生用の招待URL（teacher.html?t=…）から開いてください。', true);
  else if (!api.endpoint) { $('connection').hidden = false; message('初回の接続先を設定してください。'); }
  else run(load, '読み込みました。');
})();
