'use strict';
(() => {
  const api = BandAPI.create('a');
  const $ = id => document.getElementById(id);
  const bool = v => v === true || v === 'true' || v === 1 || v === '1' || v === '○';
  const roles = ['当番'];
  const tabs = [['month', '月設定'], ['schedule', '先生・予定'], ['duty', '集計・当番'], ['event', '本番'], ['publish', '公開確認'], ['roster', '名簿'], ['references', 'ガイド・本番候補']];
  const dirty = { sessions: new Set(), selfPractice: new Set(), dutyAssignments: new Set(), teacherAvailability: new Set(), teachers: new Set(), events: new Set(), timelineItems: new Set(), guideItems: new Set(), annualEvents: new Set() };
  const today = new Date();
  let monthId = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  let tab = 'month', rosterTab = 'families', data, busy = false, monthDirty = false, rosterDirty = false, deadlineDraft, rosterDraft = [];
  const dutyKey = r => [r['予定ID'], r['役割'], r['区分']].join('|');
  const availabilityKey = r => [r['先生ID'], r['予定ID'], r['枠']].join('|');
  const guideKey = r => r.id;
  const annualEventKey = r => r.id;
  const eventKey = r => r['予定ID'];
  const timelineKey = r => r['項目ID'];
  const rosterKeys = { teachers: r => r['先生ID'] };
  const monthKey = value => String(value || '').trim().slice(0, 7);
  const teacherIds = value => [...new Set(String(value || '').split(',').map(id => id.trim()).filter(Boolean))];
  const practiceTimes = session => {
    if (session['種別'] === '本番') return {};
    const am = (session['実施有無_am'] || '実施') !== 'なし', pm = (session['実施有無_pm'] || '実施') !== 'なし';
    if (am && pm) return { '集合': '09:45', '開始': '10:00', '終了': '15:00', '解散': '15:15' };
    if (am) return { '集合': '09:45', '開始': '10:00', '終了': '12:00', '解散': '12:15' };
    if (pm) return { '集合': '12:45', '開始': '13:00', '終了': '15:00', '解散': '15:15' };
    return {};
  };
  const currentMonth = () => data.months.find(m => monthKey(m['月ID']) === monthKey(monthId));
  const sessions = () => data.sessions.filter(s => monthKey(s['月ID']) === monthKey(monthId)).sort((a, b) => a['日付'].localeCompare(b['日付']));
  const active = name => data.masters[name].filter(r => bool(r['在籍']));
  const hasChanges = () => monthDirty || rosterDirty || Object.values(dirty).some(set => set.size);
  function el(tag, text, className) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; }
  function button(label, click, selected, className) {
    const n = el('button', label, className); n.type = 'button'; n.addEventListener('click', click);
    if (selected !== undefined) n.setAttribute('aria-pressed', String(selected)); return n;
  }
  function field(label, value, change, type = 'text') {
    const wrap = el('label', label); const input = el(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') input.type = type;
    input.value = value || ''; input.addEventListener('input', () => change(input.value)); wrap.append(input); return wrap;
  }
  function check(label, value, change) {
    const wrap = el('label'); const input = el('input'); input.type = 'checkbox'; input.checked = bool(value);
    input.addEventListener('change', () => change(input.checked)); wrap.append(input, document.createTextNode(label)); return wrap;
  }
  function pills(options, value, change, label) {
    const wrap = el('div', undefined, 'pills'); wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', label);
    for (const [id, name] of options) wrap.append(button(name, () => change(id), value === id)); return wrap;
  }
  function picker(label, options, value, change) {
    const wrap = el('div'); wrap.append(el('h3', label));
    const list = pills([['', '未設定'], ...options], value || '', change, label);
    if (options.length > 8) wrap.append(field(`${label}を絞り込み`, '', q => { for (const b of list.children) b.hidden = Boolean(q) && !b.textContent.includes(q) && b.textContent !== '未設定'; }, 'search'));
    wrap.append(list); return wrap;
  }
  function message(text, error = false) { $('message').textContent = text; $('message').className = error ? 'error' : ''; $('message').setAttribute('role', error ? 'alert' : 'status'); }
  function confirmRemoval(name, callback) {
    const backdrop = el('div', undefined, 'confirm-backdrop'); const dialog = el('section', undefined, 'confirm-dialog'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', '削除の確認');
    dialog.append(el('h2', '削除しますか？'), el('p', `「${name || 'この項目'}」を現在の名簿から外します。保存前なら再読み込みで戻せます。`));
    const cancel = button('キャンセル', () => backdrop.remove()); const remove = button('削除', () => { backdrop.remove(); callback(); }, undefined, 'danger'); dialog.append(el('div', undefined, 'row')); dialog.lastChild.append(cancel, remove); backdrop.append(dialog); backdrop.addEventListener('click', event => { if (event.target === backdrop) backdrop.remove(); }); document.body.append(backdrop); cancel.focus();
  }
  function mark(collection, key) { dirty[collection].add(key); updateSaveState(); }
  function markRoster() { rosterDirty = true; updateSaveState(); }
  function updateSaveState() {
    $('save-state').textContent = hasChanges() ? '未保存の変更あり' : '保存済み';
    $('save').disabled = busy || !hasChanges();
    const publish = $('publish-month'); if (publish) publish.disabled = busy || hasChanges() || !data.shared || !sessions().length || missing().length > 0;
  }
  async function run(task, success) {
    if (busy) return;
    busy = true; $('workspace').disabled = true; $('connect').disabled = true;
    message('処理中です…');
    try { await task(); if (success) message(success); }
    catch (error) {
      if (error.code === 'unauthorized' || error.code === 'forbidden') { data = undefined; $('panel').replaceChildren(); $('workspace').hidden = true; api.forget(); }
      if (data) data.shared = null; // 書き込み応答が不明な場合、古い公開スナップショットを表示しない。
      if (!data && api.hasToken) { $('connection').hidden = false; $('api-url').value = api.endpoint; }
      if (data && tab === 'publish') render();
      message(error.message || '接続に失敗しました。再読み込みして確認してください。', true);
    } finally { busy = false; $('workspace').disabled = false; $('connect').disabled = false; if (data) updateSaveState(); }
  }
  async function load() {
    const next = await api.request('admin_bootstrap'); data = next; rosterDraft = buildRosterDraft();
    Object.values(dirty).forEach(set => set.clear()); monthDirty = false; rosterDirty = false; deadlineDraft = undefined;
    $('connection').hidden = true; $('workspace').hidden = false; render();
  }
  function render() {
    $('month-title').textContent = `${monthId.replace('-', '年')}月 · ${currentMonth()?.['状態'] || '未作成'}`;
    $('tabs').replaceChildren(...tabs.map(([id, label]) => {
      const b = button(label, () => { tab = id; render(); }, tab === id); b.setAttribute('aria-controls', 'panel'); return b;
    }));
    $('panel').replaceChildren();
    ({ month: renderMonth, schedule: renderSchedule, duty: renderDuty, event: renderEvent, publish: renderPublish, roster: renderRoster, references: renderReferences })[tab]();
    updateSaveState();
  }
  function switchMonth(next) {
    if (next === monthId) return;
    if (hasChanges()) { message('月を切り替える前に「変更を保存」を押してください。破棄する場合は再読み込みしてください。', true); return; }
    monthId = next; deadlineDraft = undefined; render();
  }
  function renderMonth() {
    const panel = $('panel'); const card = el('section', undefined, 'card'); card.append(el('h2', '対象月'));
    const year = Number(monthId.slice(0, 4));
    const yearRow = el('div', undefined, 'row');
    yearRow.append(button('前年', () => switchMonth(`${Math.max(2000, year - 1)}-${monthId.slice(5)}`)));
    yearRow.append(pills([year - 1, year, year + 1].filter(y => y >= 2000 && y <= 2099).map(y => [String(y), `${y}年`]), String(year), y => switchMonth(`${y}-${monthId.slice(5)}`), '年'));
    yearRow.append(button('翌年', () => switchMonth(`${Math.min(2099, year + 1)}-${monthId.slice(5)}`))); card.append(yearRow);
    const months = pills(Array.from({ length: 12 }, (_, i) => [String(i + 1).padStart(2, '0'), `${i + 1}月`]), monthId.slice(5), m => switchMonth(`${year}-${m}`), '月'); months.className = 'months'; card.append(months);
    const month = currentMonth();
    if (!deadlineDraft) deadlineDraft = { parentDeadline: month?.['保護者入力締切'] || '' };
    const deadlines = el('div', undefined, 'grid');
    deadlines.append(field('保護者入力締切（任意）', deadlineDraft.parentDeadline, v => { deadlineDraft.parentDeadline = v; monthDirty = Boolean(month); updateSaveState(); }, 'date'));
    card.append(deadlines, el('p', '先生の入力締切はありません。保護者の締切だけ必要に応じて設定できます。', 'muted'));
    if (!month) {
      let copy = true; card.append(check('前月の集合・開始・終了・解散時間を引き継ぐ', true, v => { copy = v; }));
      card.append(button('土曜日の候補を作成', () => run(async () => {
        const prior = new Date(year, Number(monthId.slice(5)) - 2, 1);
        const copyFromMonthId = copy ? `${prior.getFullYear()}-${String(prior.getMonth() + 1).padStart(2, '0')}` : '';
        await api.request('admin_create_month', { monthId, copyFromMonthId, teacherDeadline: '', ...deadlineDraft }); tab = 'schedule'; await load();
      }, '土曜日の候補を作成しました。'), undefined, 'primary'));
    } else card.append(el('p', `${sessions().length}件の候補があります。締切の変更は上部の「変更を保存」で保存します。`));
    panel.append(card);
  }
  function requireMonth() {
    if (currentMonth()) return true;
    $('panel').append(el('p', '「月設定」で対象月を作成してください。')); return false;
  }
  function slots(s) { return s['種別'] === '本番' ? [['am', '終日']] : [['am', '午前'], ['pm', '午後']]; }
  function renderSchedule() {
    if (!requireMonth()) return;
    const panel = $('panel'); panel.append(el('p', '午前・午後を別々に設定します。可否のボタンを押すと管理者による代理入力ができ、○の先生から各枠1名または2名を選べます。', 'muted'), placeMaster());
    for (const s of sessions()) panel.append(sessionCard(s));
    panel.append(button('日付を指定して予定追加', () => {
      const s = { '予定ID': `S${crypto.randomUUID()}`, '月ID': monthId, '日付': `${monthId}-01`, '種別': '通常練習', '実施有無_am': '実施', staffing_am: '未定', '担当先生ID_am': '', '実施有無_pm': '実施', staffing_pm: '未定', '担当先生ID_pm': '', ...practiceTimes({}), '場所ID': data.masters.places[0]?.['場所ID'] || '', '確定状態': '下書き', '備考': '' };
      data.sessions.push(s); mark('sessions', s['予定ID']); render(); document.getElementById(s['予定ID']).scrollIntoView({ block: 'start' });
    }));
  }
  function placeMaster() {
    const card = el('section', undefined, 'card'); card.append(el('h2', '場所マスター'), el('p', '平沼小学校以外の場所が必要なときだけ追加します。', 'muted'));
    card.append(pills(data.masters.places.map(place => [place['場所ID'], place['名称']]), '', () => {}, '登録済みの場所'));
    const row = el('div', undefined, 'row'); const input = document.createElement('input'); input.type = 'text'; input.placeholder = '例：西公会堂'; input.maxLength = 80;
    row.append(input, button('場所を追加', () => run(async () => {
      const result = await api.request('admin_save_place', { name: input.value }); data.masters.places.push(result.place); render();
    }, '場所を追加しました。'))); card.append(row); return card;
  }
  function sessionCard(s) {
    const card = el('article', undefined, 'card'); card.id = s['予定ID'];
    const set = (key, value, redraw = false) => { s[key] = value; mark('sessions', s['予定ID']); if (redraw) card.replaceWith(sessionCard(s)); };
    const head = el('div', undefined, 'row'); head.append(el('h2', s['日付']), el('span', dirty.sessions.has(s['予定ID']) ? '編集中' : s['確定状態'], 'badge'));
    head.append(button('候補から削除', () => {
      if (!confirm(`${s['日付']}を候補から削除しますか？公開中の場合は共有画面からも消えます。履歴は残ります。`)) return;
      if (hasChanges()) { message('削除前に変更を保存してください。新規予定を取り消す場合は再読み込みで破棄できます。', true); return; }
      run(async () => { await api.request('admin_delete_session', { sessionId: s['予定ID'] }); await load(); }, '予定を削除しました。');
    }, undefined, 'danger')); card.append(head);
    card.append(field('日付', s['日付'], v => set('日付', v), 'date'));
    card.append(pills(['通常練習', '自主練', '本番', 'その他'].map(v => [v, v]), s['種別'], v => {
      s['種別'] = v;
      if (v === '本番') { s.staffing_pm = ''; s['担当先生ID_pm'] = ''; }
      else if (!s.staffing_pm) s.staffing_pm = '未定';
      set('種別', v, true);
    }, '予定の種別'));
    const times = el('div', undefined, 'grid'); for (const key of ['集合', '開始', '終了', '解散']) times.append(field(key, s[key], v => set(key, v), 'time')); card.append(times);
    card.append(picker('場所', data.masters.places.map(p => [p['場所ID'], p['名称']]), s['場所ID'], v => set('場所ID', v, true)));
    card.append(availabilityTable(s, () => card.replaceWith(sessionCard(s))));
    for (const [slot, label] of slots(s)) {
      const block = el('section', undefined, 'slot'); block.append(el('h3', `${label}の指導体制`));
      block.append(pills([['実施', '実施する'], ['なし', '実施しない']], s[`実施有無_${slot}`] || '実施', v => {
        s[`実施有無_${slot}`] = v;
        if (v === 'なし') { s[`staffing_${slot}`] = ''; s[`担当先生ID_${slot}`] = ''; }
        else if (!s[`staffing_${slot}`]) s[`staffing_${slot}`] = '先生あり';
        Object.assign(s, practiceTimes(s));
        mark('sessions', s['予定ID']); card.replaceWith(sessionCard(s));
      }, `${label}の実施有無`));
      if ((s[`実施有無_${slot}`] || '実施') === 'なし') { block.append(el('p', 'この枠は練習を実施しません。先生・保護者の入力対象外です。', 'muted')); card.append(block); continue; }
      block.append(pills(['先生あり', '自主練', '未定'].map(v => [v, v]), s[`staffing_${slot}`] || '先生あり', v => {
        s[`staffing_${slot}`] = v; if (v !== '先生あり') s[`担当先生ID_${slot}`] = ''; mark('sessions', s['予定ID']); card.replaceWith(sessionCard(s));
      }, `${label}の指導体制`));
      if (s[`staffing_${slot}`] === '先生あり') block.append(teacherPicker(s, slot, label, () => card.replaceWith(sessionCard(s))));
      card.append(block);
    }
    card.append(field('共有する備考', s['備考'], v => set('備考', v), 'textarea'));
    if (isSelfPractice(s)) card.append(selfPracticeForm(s));
    return card;
  }
  function teacherPicker(s, slot, label, redraw) {
    const fieldName = `担当先生ID_${slot}`;
    const selected = teacherIds(s[fieldName]);
    const eligibleIds = new Set(data.teacherAvailability
      .filter(r => r['予定ID'] === s['予定ID'] && r['枠'] === label && r['可否'] === '○')
      .map(r => r['先生ID']));
    const teachers = active('teachers').filter(t => eligibleIds.has(t['先生ID']) || selected.includes(t['先生ID']));
    const wrap = el('div'); wrap.append(el('h3', `担当先生（${label}・○の先生から1名または2名）`));
    if (!teachers.length) { wrap.append(el('p', '○の先生がまだいません。上の可否を入力すると選べます。', 'muted')); return wrap; }
    const choices = el('div', undefined, 'pills'); choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', `${label}の担当先生`);
    for (const teacher of teachers) {
      const id = teacher['先生ID']; const isSelected = selected.includes(id); const eligible = eligibleIds.has(id);
      const labelText = eligible ? teacher['氏名'] : `${teacher['氏名']}（要確認）`;
      choices.append(button(labelText, () => {
        const next = teacherIds(s[fieldName]); const index = next.indexOf(id);
        if (index >= 0) next.splice(index, 1);
        else {
          if (!eligible) { message('担当には○の先生だけを選べます。', true); return; }
          if (next.length >= 2) { message('担当先生は各枠2名まで選べます。', true); return; }
          next.push(id);
        }
        s[fieldName] = next.join(','); mark('sessions', s['予定ID']); redraw();
      }, isSelected));
    }
    wrap.append(choices, el('p', selected.length ? `${selected.length}名を選択中です。` : '担当先生を1名または2名選んでください。', selected.length ? 'muted' : 'warning'));
    return wrap;
  }
  function availabilityTable(s, redraw) {
    const wrap = el('div', undefined, 'table-wrap'); const table = el('table', undefined, 'availability');
    const caption = el('caption', '先生の可否（押して代理入力）'); table.append(caption);
    const availableSlots = slots(s).filter(([slot]) => (s[`実施有無_${slot}`] || '実施') !== 'なし');
    if (!availableSlots.length) return el('p', '実施する枠がないため、先生の可否はありません。', 'muted');
    const head = el('tr'); head.append(el('th', '先生')); availableSlots.forEach(([, label]) => head.append(el('th', label))); const thead = el('thead'); thead.append(head); table.append(thead);
    const body = el('tbody');
    for (const teacher of active('teachers')) {
      const tr = el('tr'); tr.append(el('th', teacher['氏名']));
      for (const [, label] of availableSlots) {
        let row = data.teacherAvailability.find(r => r['予定ID'] === s['予定ID'] && r['先生ID'] === teacher['先生ID'] && r['枠'] === label);
        const td = el('td'); const b = button(row?.['可否'] || '未入力', () => {
          const options = ['', '○', '×']; const value = options[(options.indexOf(row?.['可否'] || '') + 1) % options.length];
          if (!row) { row = { '予定ID': s['予定ID'], '先生ID': teacher['先生ID'], '枠': label }; data.teacherAvailability.push(row); }
          row['可否'] = value; mark('teacherAvailability', availabilityKey(row)); redraw();
        }); b.setAttribute('aria-label', `${teacher['氏名']}・${label}：${row?.['可否'] || '未入力'}（押して変更）`); td.append(b); tr.append(td);
      }
      body.append(tr);
    }
    table.append(body); wrap.append(table); return wrap;
  }
  function isSelfPractice(s) { return s.staffing_am === '自主練' || (s['種別'] !== '本番' && s.staffing_pm === '自主練'); }
  function missingFor(s) {
    if (!isSelfPractice(s)) return [];
    const checklist = data.selfPractice.find(r => r['予定ID'] === s['予定ID']) || {};
    const valid = new Set(active('guardians').map(g => g['保護者ID'])); const missing = [];
    const duties = new Set(data.dutyAssignments.filter(d => d['予定ID'] === s['予定ID'] && valid.has(d['保護者ID'])).map(d => d['保護者ID']));
    if (duties.size < 2) missing.push('当番2名以上');
    for (const key of ['鍵の担当', '中止判断者']) if (!valid.has(checklist[key])) missing.push(key);
    if (!String(checklist['緊急連絡先'] || '').trim()) missing.push('緊急連絡先'); return missing;
  }
  function missing() { return sessions().flatMap(s => missingFor(s).map(key => `${s['日付']}：${key}`)); }
  function selfPracticeForm(s) {
    let row = data.selfPractice.find(r => r['予定ID'] === s['予定ID']);
    if (!row) { row = { '予定ID': s['予定ID'] }; data.selfPractice.push(row); }
    const wrap = el('section', undefined, 'slot'); wrap.append(el('h3', '自主練チェックリスト（日単位）'));
    const status = el('p', undefined, 'status-line');
    const refresh = () => { const items = missingFor(s); status.textContent = items.length ? `未設定：${items.join('、')}` : '公開に必要な4条件を満たしています。'; status.className = items.length ? 'warning' : 'success'; updateSaveState(); };
    const set = (key, value) => { row[key] = value; mark('selfPractice', s['予定ID']); refresh(); };
    const guardians = active('guardians').map(g => [g['保護者ID'], g['表示名']]);
    for (const key of ['鍵の担当', '中止判断者']) {
      let pick; const draw = () => picker(key, guardians, row[key], v => { set(key, v); const next = draw(); pick.replaceWith(next); pick = next; }); pick = draw(); wrap.append(pick);
    }
    wrap.append(field('緊急連絡先（管理者のみ表示）', row['緊急連絡先'], v => set('緊急連絡先', v)), check('施設使用申請済（確認用・公開の必須条件には含めない）', row['施設使用申請済'], v => set('施設使用申請済', v)), field('実施報告（管理者のみ表示）', row['実施報告'], v => set('実施報告', v), 'textarea'), status);
    wrap.append(button('集計・当番で2名を割り当てる', () => { tab = 'duty'; render(); })); refresh(); return wrap;
  }
  function renderDuty() {
    if (!requireMonth()) return;
    const panel = $('panel'); const summary = el('section', undefined, 'card'); summary.append(el('h2', '家庭の入力状況'));
    const table = el('table'); const head = el('tr'); for (const title of ['家庭', '回答状況', '当番可']) head.append(el('th', title)); const thead = el('thead'); thead.append(head); table.append(thead); const body = el('tbody');
    const monthSessions = sessions();
    for (const household of active('households')) {
      const members = active('members').filter(m => m['家庭ID'] === household['家庭ID']); const guardians = active('guardians').filter(g => g['家庭ID'] === household['家庭ID']); const representative = guardians[0];
      let answered = 0, offered = 0; const expected = (members.length + (representative ? 1 : 0)) * monthSessions.length;
      for (const s of monthSessions) {
        answered += members.filter(m => data.attendance.some(a => a['予定ID'] === s['予定ID'] && a['子どもID'] === m['子どもID'])).length;
        if (representative && data.dutyOffers.some(d => d['予定ID'] === s['予定ID'] && d['保護者ID'] === representative['保護者ID'])) answered++;
        if (representative && data.dutyOffers.some(d => d['予定ID'] === s['予定ID'] && d['保護者ID'] === representative['保護者ID'] && bool(d['可否']))) offered++;
      }
      const tr = el('tr'); tr.append(el('td', household['家庭名']), el('td', expected === 0 ? '対象なし' : `${answered === 0 ? '未入力' : answered === expected ? '入力済' : '一部入力'} ${answered}/${expected}`), el('td', `${offered}/${monthSessions.length}日`)); body.append(tr);
    }
    table.append(body); summary.append(table, el('p', '子ども全員の出席回答と、家庭ごとの当番可否がそろうと入力済です。', 'muted')); panel.append(summary);
    for (const s of monthSessions) panel.append(dutyCard(s));
  }
  function dutyCard(s) {
    const card = el('article', undefined, 'card'); card.append(el('h2', s['日付']));
    const attendance = data.attendance.filter(a => a['予定ID'] === s['予定ID']);
    card.append(el('p', `出席予定：午前${attendance.filter(a => bool(a['午前'])).length}名 ／ 午後${attendance.filter(a => bool(a['午後'])).length}名`));
    const available = active('guardians').filter(g => data.dutyOffers.some(d => d['予定ID'] === s['予定ID'] && d['保護者ID'] === g['保護者ID'] && bool(d['可否'])));
    card.append(el('p', `当番可：${available.map(g => g['表示名']).join('、') || 'まだいません'}`));
    const notes = el('details'); notes.append(el('summary', '家庭からの連絡事項（管理者のみ）'));
    for (const a of attendance.filter(a => a['連絡事項'])) { const member = data.masters.members.find(m => m['子どもID'] === a['子どもID']); notes.append(el('p', `${member?.['氏名'] || '退籍メンバー'}：${a['連絡事項']}`, 'note')); }
    for (const d of data.dutyOffers.filter(d => d['予定ID'] === s['予定ID'] && d['メモ'])) { const guardian = data.masters.guardians.find(g => g['保護者ID'] === d['保護者ID']); notes.append(el('p', `${guardian?.['表示名'] || '退籍保護者'}：${d['メモ']}`, 'note')); }
    card.append(notes);
    const allRoles = [...new Set([...roles, ...data.dutyAssignments.filter(d => d['予定ID'] === s['予定ID']).map(d => d['役割'])])];
    const rolePicker = el('div'); let role = '当番';
    const renderRole = () => {
      const addRole = el('div', undefined, 'row'); const roleInput = document.createElement('input'); roleInput.type = 'text'; roleInput.maxLength = 40; roleInput.placeholder = '役割を追加（例：レッスン見守り）';
      addRole.append(roleInput, button('役割を追加', () => {
        const name = roleInput.value.trim(); if (!name) return;
        if (!allRoles.includes(name)) allRoles.push(name);
        role = name; renderRole();
      }));
      rolePicker.replaceChildren(addRole);
      rolePicker.append(pills(allRoles.map(r => [r, r]), role, r => { role = r; renderRole(); }, '当番の役割'));
      const options = active('guardians').map(g => [g['保護者ID'], `${g['表示名']}${available.includes(g) ? '（可）' : '（要確認）'}`]);
      const roleAssignments = data.dutyAssignments.filter(d => d['予定ID'] === s['予定ID'] && d['役割'] === role && d['保護者ID']);
      rolePicker.append(picker('担当を追加', options, '', value => {
        if (!value || roleAssignments.some(d => d['保護者ID'] === value)) return;
        const assignment = { '予定ID': s['予定ID'], '役割': role, '区分': `A-${crypto.randomUUID()}`, '保護者ID': value };
        data.dutyAssignments.push(assignment); mark('dutyAssignments', dutyKey(assignment)); renderRole();
      }));
      for (const assignment of roleAssignments) {
        const guardian = data.masters.guardians.find(g => g['保護者ID'] === assignment['保護者ID']);
        const row = el('div', undefined, 'row'); row.append(el('span', guardian?.['表示名'] || '退籍保護者'), button('外す', () => { assignment['保護者ID'] = ''; mark('dutyAssignments', dutyKey(assignment)); renderRole(); }, undefined, 'danger')); rolePicker.append(row);
      }
      const assigned = data.dutyAssignments.filter(d => d['予定ID'] === s['予定ID'] && d['保護者ID']);
      const assignedByRole = Object.entries(assigned.reduce((result, assignment) => { (result[assignment['役割']] ||= []).push(data.masters.guardians.find(g => g['保護者ID'] === assignment['保護者ID'])?.['表示名'] || '退籍保護者'); return result; }, {}));
      rolePicker.append(el('p', `割当一覧：${assignedByRole.map(([name, names]) => `${name}：${names.join('、')}`).join(' ／ ') || '未設定'}`));
      if (isSelfPractice(s)) rolePicker.append(el('p', missingFor(s).length ? `自主練の不足：${missingFor(s).join('、')}` : '自主練の公開条件を満たしています。', missingFor(s).length ? 'warning' : 'success'));
    };
    renderRole(); card.append(rolePicker); return card;
  }
  function renderRoster() {
    const panel = $('panel'); const intro = el('section', undefined, 'card'); intro.append(el('h2', '名簿の管理'), el('p', '現在の名簿を表で直接編集します。保存前は自由に修正・行削除でき、保存後もこの画面には現在の内容だけを表示します。', 'muted'));
    panel.append(intro, pills([['families', '家庭・保護者・子ども'], ['teachers', '先生'], ['invites', '招待URL']], rosterTab, value => { rosterTab = value; render(); }, '名簿の種類'));
    if (rosterTab === 'families') renderFamilies(panel); else if (rosterTab === 'teachers') renderTeachers(panel); else renderInviteUrls(panel);
  }
  function inviteUrl(page, parameter, token) {
    const url = new URL(location.href); url.pathname = url.pathname.replace(/\/app\/admin\.html$/, `/app/${page}.html`); url.search = ''; url.hash = ''; url.searchParams.set(parameter, token); return url.href;
  }
  function copyText(value) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
    const input = document.createElement('textarea'); input.value = value; document.body.append(input); input.select(); document.execCommand('copy'); input.remove(); return Promise.resolve();
  }
  function renderInviteUrls(panel) {
    const card = el('section', undefined, 'card'); card.append(el('h2', '招待URL一覧'), el('p', 'このURLを知っている人は該当画面を開けます。運営メンバー・先生・各家庭だけに送ってください。', 'warning'));
    const appendList = (title, rows, page, parameter) => {
      card.append(el('h3', title));
      if (!rows.length) { card.append(el('p', '在籍中の登録がありません。', 'muted')); return; }
      rows.sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(row => {
        const url = inviteUrl(page, parameter, row.token); const details = document.createElement('details'); details.className = 'slot'; const summary = el('summary', row.name || '名称未入力'); const body = el('div'); const input = document.createElement('input'); input.type = 'text'; input.value = url; input.readOnly = true; input.setAttribute('aria-label', `${row.name}の招待URL`); body.append(input, button('コピー', () => copyText(url).then(() => message(`${row.name}の招待URLをコピーしました。`)).catch(() => message('コピーできませんでした。URLを長押ししてコピーしてください。', true)), undefined, 'primary')); details.append(summary, body); card.append(details);
      });
    };
    const invites = data.invites || {}; appendList('先生用', invites.teachers || [], 'teacher', 't'); appendList('保護者用', invites.households || [], 'parent', 'k'); panel.append(card);
  }
  function buildRosterDraft() {
    const households = active('households').sort((a, b) => String(a['家庭名']).localeCompare(String(b['家庭名'])));
    const guardians = active('guardians'), members = active('members'); const rows = [];
    households.forEach(household => {
      const familyGuardians = guardians.filter(row => row['家庭ID'] === household['家庭ID']); const familyMembers = members.filter(row => row['家庭ID'] === household['家庭ID']);
      const count = Math.max(1, familyGuardians.length, Math.ceil(familyMembers.length / 2));
      for (let index = 0; index < count; index += 1) {
        const guardian = familyGuardians[index] || {}; const child1 = familyMembers[index * 2] || {}; const child2 = familyMembers[index * 2 + 1] || {};
        rows.push({ id: crypto.randomUUID(), householdId: household['家庭ID'], householdName: household['家庭名'] || '', guardianId: guardian['保護者ID'] || '', guardianName: guardian['表示名'] || '', guardianRoles: guardian['対応可能な役割'] || '', child1Id: child1['子どもID'] || '', child1Name: child1['氏名'] || '', child1Grade: child1['学年'] || '', child2Id: child2['子どもID'] || '', child2Name: child2['氏名'] || '', child2Grade: child2['学年'] || '' });
      }
    });
    return rows;
  }
  function newRosterRow() { return { id: crypto.randomUUID(), householdId: `H-${crypto.randomUUID()}`, householdName: '', guardianId: `G-${crypto.randomUUID()}`, guardianName: '', guardianRoles: '', child1Id: `M-${crypto.randomUUID()}`, child1Name: '', child1Grade: '', child2Id: `M-${crypto.randomUUID()}`, child2Name: '', child2Grade: '' }; }
  function rosterInput(row, key, placeholder) {
    const input = el('input'); input.value = row[key] || ''; input.placeholder = placeholder; input.setAttribute('aria-label', placeholder);
    input.addEventListener('input', () => { row[key] = input.value; if (key === 'householdName' && row.householdId) rosterDraft.filter(item => item.householdId === row.householdId).forEach(item => { item.householdName = input.value; }); markRoster(); });
    return input;
  }
  function renderFamilies(panel) {
    const note = el('p', '兄弟姉妹は2人まで同じ行に入力できます。3人目以降や保護者を追加する場合は、同じ家庭名を入力して行を追加してください。', 'muted');
    const add = button('行を追加', () => { rosterDraft.push(newRosterRow()); markRoster(); render(); }, undefined, 'primary'); const wrap = el('div', undefined, 'table-wrap roster-table-wrap'); const table = el('table', undefined, 'roster-table');
    const head = el('thead'); const headerRow = el('tr'); ['家庭名', '保護者名', '役職・対応できること（任意）', '子どもの氏名', '学年', '子どもの氏名（2人目・任意）', '学年', ''].forEach(label => headerRow.append(el('th', label))); head.append(headerRow); const body = el('tbody');
    rosterDraft.forEach(row => { const tr = el('tr'); [['householdName', '家庭名'], ['guardianName', '保護者名'], ['guardianRoles', '例：会計・当番'], ['child1Name', '子どもの氏名'], ['child1Grade', '例：3年'], ['child2Name', '2人目（任意）'], ['child2Grade', '例：1年']].forEach(([key, placeholder]) => { const td = el('td'); td.append(rosterInput(row, key, placeholder)); tr.append(td); }); const action = el('td'); action.append(button('×', () => confirmRemoval(row.guardianName || row.householdName || 'この行', () => { rosterDraft = rosterDraft.filter(item => item.id !== row.id); markRoster(); render(); }), undefined, 'danger')); tr.append(action); body.append(tr); });
    table.append(head, body); wrap.append(table); panel.append(note, add, wrap);
  }
  function renderTeachers(panel) {
    panel.append(el('p', '候補日入力に表示する先生です。スマホを使わない先生も、ここには登録し、可否は管理者が「先生・予定」タブで代理入力できます。', 'muted'));
    panel.append(button('先生を追加', () => { const teacher = { '先生ID': `T-${crypto.randomUUID()}`, '氏名': '', '在籍': true }; data.masters.teachers.push(teacher); mark('teachers', rosterKeys.teachers(teacher)); render(); }, undefined, 'primary'));
    data.masters.teachers.sort((a, b) => Number(bool(b['在籍'])) - Number(bool(a['在籍'])) || String(a['氏名']).localeCompare(String(b['氏名']))).forEach(teacher => {
      const card = el('article', undefined, 'card roster-card'); card.append(el('h2', teacher['氏名'] || '新しい先生'), el('span', bool(teacher['在籍']) ? '在籍中' : '在籍終了', 'badge'));
      card.append(field('氏名', teacher['氏名'], value => { teacher['氏名'] = value; mark('teachers', rosterKeys.teachers(teacher)); }));
      card.append(button(bool(teacher['在籍']) ? '削除' : '復帰', () => { const change = () => { teacher['在籍'] = !bool(teacher['在籍']); mark('teachers', rosterKeys.teachers(teacher)); render(); }; if (bool(teacher['在籍'])) confirmRemoval(teacher['氏名'] || 'この先生', change); else change(); }, undefined, bool(teacher['在籍']) ? 'danger' : undefined)); panel.append(card);
    });
  }
  function eventSessions() { return sessions().filter(s => s['種別'] === '本番'); }
  function eventFor(session) {
    let event = data.events.find(row => row['予定ID'] === session['予定ID']);
    if (!event) { event = { '予定ID': session['予定ID'], '本番名': '', '会場': '', '衣装': '', '子どもの持ち物': '', '全体連絡': '' }; data.events.push(event); }
    return event;
  }
  function renderEvent() {
    if (!requireMonth()) return;
    const panel = $('panel'); const candidates = eventSessions();
    panel.append(el('p', '本番の基本情報と、保護者へ共有する当日の流れを作成します。ステージ配置・器材は次の画面で追加します。', 'muted'));
    if (!candidates.length) { panel.append(el('section', '「先生・予定」タブで予定の種別を「本番」にすると、ここで編集できます。', 'card warning')); return; }
    let selectedId = candidates[0]['予定ID'];
    const selector = el('section', undefined, 'card'); selector.append(el('h2', '編集する本番'));
    const body = el('div'); const draw = () => { body.replaceChildren(eventEditor(candidates.find(s => s['予定ID'] === selectedId))); };
    selector.append(pills(candidates.map(s => [s['予定ID'], `${s['日付']} ${eventFor(s)['本番名'] || '本番名未入力'}`]), selectedId, id => { selectedId = id; draw(); }, '編集する本番'), body); panel.append(selector); draw();
  }
  function eventEditor(session) {
    const wrap = el('div'); const event = eventFor(session); const setEvent = (key, value) => { event[key] = value; mark('events', eventKey(event)); };
    const basic = el('section', undefined, 'slot'); basic.append(el('h2', `${session['日付']}の本番情報`));
    const grid = el('div', undefined, 'grid'); [['本番名', '本番名'], ['会場', '会場'], ['衣装', '衣装']].forEach(([label, key]) => grid.append(field(label, event[key], value => setEvent(key, value)))); basic.append(grid, field('子どもの持ち物', event['子どもの持ち物'], value => setEvent('子どもの持ち物', value), 'textarea'), field('全体連絡', event['全体連絡'], value => setEvent('全体連絡', value), 'textarea')); wrap.append(basic);
    const timeline = data.timelineItems.filter(item => item['予定ID'] === session['予定ID']).sort((a, b) => Number(a['並び順']) - Number(b['並び順']));
    const flow = el('section', undefined, 'slot'); flow.append(el('h2', '当日の流れ・ステージ進行'), el('p', '曲順、MC、集合・転換などを同じ一覧に並べます。担当はメンバー名から選ぶか、自由入力できます。', 'muted'));
    const list = el('div'); const draw = () => {
      list.replaceChildren();
      timeline.filter(item => item['有効'] !== false).forEach(item => list.append(timelineEditor(item, () => draw())));
    };
    flow.append(list, button('進行項目を追加', () => { const item = { '項目ID': `TL-${crypto.randomUUID()}`, '予定ID': session['予定ID'], '日区分': '当日', '時刻': '', '並び順': Math.max(0, ...timeline.map(row => Number(row['並び順']) || 0)) + 1, scope: '当日進行', '種別': '予定', '内容': '', '場所ID': '', '担当': '', '担当自由入力': '', '持ち物': '', '注意点': '', '有効': true }; timeline.push(item); data.timelineItems.push(item); mark('timelineItems', timelineKey(item)); draw(); }, undefined, 'primary'));
    draw(); wrap.append(flow); return wrap;
  }
  function timelineEditor(item, redraw) {
    const row = el('article', undefined, 'card timeline-item'); const set = (key, value, refresh = false) => { item[key] = value; mark('timelineItems', timelineKey(item)); if (refresh) redraw(); };
    const head = el('div', undefined, 'row'); head.append(el('h3', item['内容'] || '新しい進行項目'), button('削除', () => confirmRemoval(item['内容'] || 'この進行項目', () => { item['有効'] = false; mark('timelineItems', timelineKey(item)); redraw(); }), undefined, 'danger')); row.append(head);
    const grid = el('div', undefined, 'grid'); grid.append(field('時刻（任意）', item['時刻'], value => set('時刻', value), 'time'), field('並び順', item['並び順'], value => set('並び順', value), 'number'));
    row.append(grid, pills([['前日', '前日'], ['当日', '当日']], item['日区分'], value => set('日区分', value), '日区分'), pills([['当日進行', '当日進行'], ['ステージ進行', 'ステージ進行']], item.scope, value => set('scope', value), '進行の種類'), pills([['予定', '予定'], ['曲', '曲'], ['MC', 'MC'], ['転換', '転換'], ['その他', 'その他']], item['種別'], value => set('種別', value), '項目の種別'), field('内容', item['内容'], value => set('内容', value), 'textarea'));
    row.append(picker('場所', data.masters.places.map(place => [place['場所ID'], place['名称']]), item['場所ID'], value => set('場所ID', value)));
    if (item['種別'] === 'MC') {
      const selected = teacherIds(item['担当']); const members = active('members'); const people = el('div'); people.append(el('h3', 'MC担当（任意）')); const buttons = el('div', undefined, 'pills');
      members.forEach(member => buttons.append(button(member['氏名'], () => { const next = teacherIds(item['担当']); const index = next.indexOf(member['子どもID']); if (index >= 0) next.splice(index, 1); else next.push(member['子どもID']); set('担当', next.join(','), true); }, selected.includes(member['子どもID'])))); people.append(buttons); row.append(people);
    }
    row.append(field('担当の自由入力（保護者名など）', item['担当自由入力'], value => set('担当自由入力', value)), field('持ち物', item['持ち物'], value => set('持ち物', value)), field('注意点', item['注意点'], value => set('注意点', value), 'textarea'));
    return row;
  }
  function renderReferences() {
    const panel = $('panel'); const references = data.references || {};
    const intro = el('section', undefined, 'card'); intro.append(el('h2', '当番ガイド・年間本番候補'), el('p', 'ここで保存した内容を保護者画面に表示します。元のスプレッドシートは初回取り込み時以外、変更しません。', 'muted')); panel.append(intro);
    if (references.status !== 'ready') {
      const card = el('section', undefined, 'card'); card.append(el('h2', '元の資料を取り込む'));
      card.append(el('p', '初回だけ、当番ガイドと年間本番一覧の内容をアプリ用DBへコピーします。取り込み後はこの画面で編集でき、元のシートはそのまま保管されます。'));
      card.append(button('元のスプレッドシートから取り込む', () => run(async () => { await api.request('admin_import_references'); await load(); }, '元の資料を取り込みました。内容を確認・編集できます。'), undefined, 'primary'));
      panel.append(card); return;
    }
    const guide = references.guide?.items || []; const events = references.annualEvents || [];
    panel.append(referenceGuideEditor(guide), referenceEventEditor(events), referenceBackup());
  }
  function referenceGuideEditor(items) {
    const card = el('section', undefined, 'card'); card.append(el('h2', '当番ガイド'));
    card.append(el('p', '元の資料の行をすべて取り込んでいます。本文・見出し・手順を選んで編集してください。文章を空欄にして保存すると、その行は表示されなくなります。', 'muted'));
    const list = el('div');
    const draw = () => {
      list.replaceChildren();
      items.filter(item => item.active !== false).sort((a, b) => Number(a.order) - Number(b.order)).forEach(item => {
        const row = el('article', undefined, 'slot');
        const set = (key, value) => { item[key] = value; mark('guideItems', guideKey(item)); };
        row.append(pills([['本文', '本文'], ['見出し', '見出し'], ['手順', '手順']], item.type || '本文', value => { set('type', value); draw(); }, '項目の種類'));
        row.append(field('内容', item.content, value => set('content', value), 'textarea'));
        list.append(row);
      });
    };
    draw();
    card.append(list, button('項目を追加', () => { const item = { id: `GI-${crypto.randomUUID()}`, type: '手順', section: '追加', order: Math.max(0, ...items.map(row => Number(row.order) || 0)) + 1, content: '', active: true }; items.push(item); mark('guideItems', guideKey(item)); draw(); }));
    return card;
  }
  function referenceEventEditor(events) {
    const card = el('section', undefined, 'card'); card.append(el('h2', '年間本番候補'), el('p', '連絡先は管理者だけに保存・表示されます。実施が決まった本番を当月の正式予定にする機能は、次の本番管理画面で追加します。', 'muted'));
    const list = el('div');
    const draw = () => {
      list.replaceChildren();
      events.filter(event => event.active !== false).sort((a, b) => Number(a.order) - Number(b.order)).forEach(event => {
        const details = document.createElement('details'); details.className = 'slot'; const summary = document.createElement('summary'); summary.textContent = `${event.month || '月未定'} · ${event.name || '本番名未入力'}　${event.schedule || ''}`; details.append(summary);
        const body = el('div'); const set = (key, value) => { event[key] = value; mark('annualEvents', annualEventKey(event)); };
        const fields = [['本番名', 'name'], ['月', 'month'], ['日程の目安', 'schedule'], ['場所', 'venue'], ['演奏時間', 'duration'], ['楽器運び', 'transport'], ['演奏できる楽器', 'instruments'], ['連絡先（管理者のみ）', 'contact'], ['事前打合せ', 'meeting']];
        const grid = el('div', undefined, 'grid'); fields.forEach(([label, key]) => grid.append(field(label, event[key], value => set(key, value)))); body.append(grid, field('その他・注意事項', event.notes, value => set('notes', value), 'textarea'));
        body.append(button('候補から外す', () => { event.active = false; mark('annualEvents', annualEventKey(event)); draw(); }, undefined, 'danger')); details.append(body); list.append(details);
      });
    };
    draw();
    card.append(list, button('本番候補を追加', () => { const event = { id: `AEC-${crypto.randomUUID()}`, order: Math.max(0, ...events.map(row => Number(row.order) || 0)) + 1, month: '', name: '', schedule: '', venue: '', duration: '', transport: '', instruments: '', contact: '', meeting: '', notes: '', active: true }; events.push(event); mark('annualEvents', annualEventKey(event)); draw(); }));
    return card;
  }
  function referenceBackup() {
    const card = el('section', undefined, 'card'); card.append(el('h2', '保存・バックアップ'));
    card.append(el('p', '「変更を保存」でアプリ用スプレッドシートへ履歴を残します。さらに現在の内容を1件のバックアップとして保存できます。', 'muted'));
    card.append(button('いまバックアップを作成', () => run(async () => { await api.request('admin_backup_references'); }, '現在のガイド・本番候補をバックアップしました。'))); return card;
  }
  function renderPublish() {
    if (!requireMonth()) return;
    const panel = $('panel'); const card = el('section', undefined, 'card'); card.append(el('h2', '公開前チェック'));
    const items = missing();
    if (items.length) { const list = el('ul', undefined, 'checklist error'); items.forEach(item => list.append(el('li', item))); card.append(list); }
    else card.append(el('p', sessions().length ? '自主練の公開条件を満たしています。' : '公開する予定がありません。', sessions().length ? 'success' : 'warning'));
    if (hasChanges()) card.append(el('p', '未保存の変更があります。先に「変更を保存」を押してください。', 'warning'));
    card.append(el('p', '予定・当番・自主練情報を変更して保存すると、その予定は下書きに戻ります。公開ボタンで再び共有できます。', 'muted'));
    const publish = button(`${monthId}の予定を${currentMonth()['状態'] === '公開' ? '再公開' : '公開'}`, () => run(async () => { await api.request('admin_publish_month', { monthId }); await load(); }, '公開しました。下の共有画面に反映されています。'), undefined, 'primary'); publish.id = 'publish-month'; card.append(publish); panel.append(card);
    panel.append(el('h2', '現在の共有画面（公開済みのみ）')); const shared = el('div'); if (data.shared) BandShared.render(shared, data.shared, monthId); else shared.append(el('p', '最新の公開状態を確認できていません。変更を保存し直すか、再読み込みしてください。', 'warning')); panel.append(shared);
  }
  async function saveChanges() {
    if (monthDirty) { await api.request('admin_save_month', { monthId, ...deadlineDraft }); monthDirty = false; }
    if (rosterDirty) { await api.request('admin_save_roster', { records: rosterDraft }); rosterDirty = false; }
    const actions = [
      ['sessions', 'admin_save_sessions', s => s['予定ID'], rows => rows],
      ['selfPractice', 'admin_save_selfpractice', s => s['予定ID'], rows => rows],
      ['dutyAssignments', 'admin_save_duty_assignments', dutyKey, rows => rows],
      ['teachers', 'admin_save_teachers', rosterKeys.teachers, rows => rows],
      ['events', 'admin_save_event', eventKey, rows => rows],
      ['timelineItems', 'admin_save_timeline_items', timelineKey, rows => rows],
      ['guideItems', 'admin_save_guide_items', guideKey, rows => rows.map(item => ({ '項目ID': item.id, '種別': item.type, '区分': item.section, '並び順': item.order, '内容': item.content, '有効': item.active !== false && String(item.content || '').trim() !== '' }))],
      ['annualEvents', 'admin_save_annual_event_candidates', annualEventKey, rows => rows.map(event => ({ '候補ID': event.id, '並び順': event.order, '月': event.month, '本番名': event.name, '日程': event.schedule, '場所': event.venue, '演奏時間': event.duration, '楽器運び': event.transport, '演奏できる楽器': event.instruments, '連絡先': event.contact, '事前打ち合わせ': event.meeting, 'その他': event.notes, '有効': event.active !== false }))],
      ['teacherAvailability', 'admin_save_teacher_availability', availabilityKey, rows => rows.filter(r => {
        const s = data.sessions.find(s => s['予定ID'] === r['予定ID']); return slots(s).some(([, label]) => label === r['枠']);
      }).map(r => ({ teacherId: r['先生ID'], sessionId: r['予定ID'], slot: r['枠'], availability: r['可否'] }))]
    ];
    for (const [collection, action, key, transform] of actions) {
      if (!dirty[collection].size) continue;
      const records = transform(data[collection].filter(r => dirty[collection].has(key(r))));
      if (records.length) await api.request(action, { records }); dirty[collection].clear();
    }
    await load();
  }
  $('save').addEventListener('click', () => run(saveChanges, '変更を保存しました。公開確認タブで公開できます。'));
  $('reload').addEventListener('click', () => { if (!hasChanges() || confirm('未保存の変更を破棄して再読み込みしますか？')) run(load, '最新の状態を読み込みました。'); });
  $('forget').addEventListener('click', () => { if (!hasChanges() || confirm('未保存の変更を破棄して認証を解除しますか？')) { api.forget(); data = undefined; $('panel').replaceChildren(); $('workspace').hidden = true; message('認証を解除しました。再度利用するには管理者の招待URLから開いてください。'); } });
  $('connect').addEventListener('click', () => run(async () => { api.configure($('api-url').value.trim()); await load(); }, '接続しました。'));
  window.addEventListener('beforeunload', e => { if (hasChanges()) { e.preventDefault(); e.returnValue = ''; } });
  if (!api.hasToken) message('管理者の招待URL（admin.html?a=…）から開いてください。', true);
  else if (!api.endpoint) { $('connection').hidden = false; message('初回の接続先を設定してください。'); }
  else run(load, '読み込みました。');
})();
