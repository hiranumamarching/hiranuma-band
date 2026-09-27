'use strict';
(() => {
  const api = BandAPI.create('t');
  const $ = id => document.getElementById(id);
  const state = { data: undefined, monthId: '', draft: new Map(), busy: false };
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
  function slotCell(session, slot, label) {
    const cell = el('td', undefined, 'teacher-slot-cell');
    if (!isPracticeSlot(session, slot)) { cell.append(el('span', '練習なし', 'cell-state')); return cell; }
    if (!needsTeacherInput(session, slot)) {
      cell.append(el('span', session['種別'] === '本番' ? '本番' : '自主練', 'cell-state'));
      return cell;
    }
    const draft = currentValue(session['予定ID'], slot);
    let value = draft === undefined ? existingValue(session['予定ID'], slot) : draft;
    const choices = el('div', undefined, 'answer-buttons');
    choices.setAttribute('role', 'group');
    choices.setAttribute('aria-label', `${session['日付']} ${label}の可否`);
    for (const [id, symbol, accessibleName] of [['○', '○', '参加可'], ['×', '×', '不可']]) {
      const node = button(symbol, () => {
        value = value === id ? '' : id;
        setValue(session['予定ID'], slot, value);
        choices.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.value === value && value !== '')));
      }, value === id, 'answer-choice');
      node.dataset.value = id;
      node.setAttribute('aria-label', `${label} ${accessibleName}`);
      choices.append(node);
    }
    cell.append(choices);
    return cell;
  }
  function renderSession(session) {
    const row = el('tr', undefined, 'teacher-day-row');
    const date = sessionDate(session); const day = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
    const dateCell = el('th', undefined, 'teacher-day-date'); dateCell.scope = 'row';
    dateCell.append(el('span', `${session['日付'].slice(5).replace('-', '/')}（${day}）`));
    const place = session['場所名'] || (state.data.places || []).find(item => item['場所ID'] === session['場所ID'])?.['名称'] || '';
    const info = [place, session['開始'] && session['終了'] ? `${session['開始']}–${session['終了']}` : ''].filter(Boolean).join(' · ');
    if (info) dateCell.append(el('small', info));
    row.append(dateCell);
    if (session['種別'] === '本番' || session['種別'] === '自主練') {
      const stateCell = el('td', session['種別'], 'cell-state merged-state'); stateCell.colSpan = 2; row.append(stateCell);
      return row;
    }
    row.append(slotCell(session, 'am', '午前'), slotCell(session, 'pm', '午後'));
    return row;
  }
  function render() {
    renderMonths(); const wrap = $('sessions'); wrap.replaceChildren();
    const sessions = monthSessions();
    if (!sessions.length) { wrap.append(el('p', 'この月の候補日はありません。', 'muted')); updateSaveState(); return; }
    const card = el('section', undefined, 'card teacher-grid-card');
    const table = el('table', undefined, 'teacher-grid');
    const head = el('thead'); const heading = el('tr');
    for (const label of ['日付', '午前', '午後']) heading.append(el('th', label));
    head.append(heading);
    const body = el('tbody'); sessions.forEach(session => body.append(renderSession(session)));
    table.append(head, body); card.append(table); wrap.append(card);
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
