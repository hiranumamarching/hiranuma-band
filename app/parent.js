'use strict';
(() => {
  const api = BandAPI.create('k');
  const $ = id => document.getElementById(id);
  const state = { data: undefined, monthId: '', guardianId: '', tab: 'share', guideTab: 'duty', attendance: new Map(), offers: new Map(), busy: false, savedDrafts: false, saveFeedback: { kind: 'idle', text: '' }, cards: undefined, cardLoading: false, cardPerson: '', cardSession: '', openSessions: new Set() };
  const tabs = [['input', '出欠・当番の回答'], ['share', 'みんなの予定'], ['guide', '当番・本番ガイド'], ['card', '個人カード']];
  const attendanceKey = (memberId, sessionId) => `${memberId}|${sessionId}`;
  const offerKey = (guardianId, sessionId) => `${guardianId}|${sessionId}`;
  const monthKey = value => String(value || '').trim().slice(0, 7);
  const monthLabel = value => monthKey(value).replace('-', '年') + '月';
  const bool = value => value === true || value === 'true' || value === 1 || value === '1' || value === '○';
  const inputSessions = () => (state.data?.inputSessions || []).filter(s => monthKey(s['月ID']) === state.monthId).sort((a, b) => a['日付'].localeCompare(b['日付']));
  const answer = value => value === undefined || value === '' || value === null ? undefined : bool(value);
  const members = () => state.data?.members || [];
  const guardians = () => state.data?.guardians || [];
  function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
  function button(label, click, selected, className) { const node = el('button', label, className); node.type = 'button'; node.disabled = state.busy; node.addEventListener('click', click); if (selected !== undefined) node.setAttribute('aria-pressed', String(selected)); return node; }
  function pills(options, value, change, label) { const wrap = el('div', undefined, 'pills'); wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', label); options.forEach(([id, name]) => wrap.append(button(name, () => change(id), value === id))); return wrap; }
  function message(text, error = false) { $('message').textContent = text; $('message').className = error ? 'error' : ''; $('message').setAttribute('role', error ? 'alert' : 'status'); }
  const saveFeedbackNode = el('p', '', 'parent-save-feedback');
  saveFeedbackNode.id = 'parent-save-feedback';
  function setSaveFeedback(kind, text) {
    state.saveFeedback = { kind, text };
    saveFeedbackNode.className = `parent-save-feedback ${kind === 'error' ? 'error' : kind === 'saved' ? 'success' : 'muted'}`;
    saveFeedbackNode.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    saveFeedbackNode.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
    saveFeedbackNode.setAttribute('aria-atomic', 'true');
    if (saveFeedbackNode.textContent !== text) saveFeedbackNode.textContent = text;
  }
  function hasUnsavedAnswers() { return !state.savedDrafts && Boolean(state.attendance.size || state.offers.size); }
  function markUnsaved() { state.savedDrafts = false; setSaveFeedback('dirty', '未保存の変更があります。'); }
  function isAllDayRest(session) { return session['実施有無_am'] === 'なし' && (session['種別'] === '本番' || session['実施有無_pm'] === 'なし'); }
  function slotList(session) { return session['種別'] === '本番' ? [['am', '終日']] : [['am', '午前'], ['pm', '午後']]; }
  function isOpen(session, slot) { return session['種別'] === '本番' ? slot === 'am' && session['実施有無_am'] !== 'なし' : session[`実施有無_${slot}`] !== 'なし'; }
  function existingAttendance(memberId, sessionId) {
    const row = (state.data.attendance || []).find(item => item['子どもID'] === memberId && item['予定ID'] === sessionId);
    return row ? { morning: answer(row['午前']), afternoon: answer(row['午後']), '連絡事項': row['連絡事項'] || '' } : {};
  }
  function attendanceValue(memberId, sessionId) { return state.attendance.get(attendanceKey(memberId, sessionId)) || existingAttendance(memberId, sessionId); }
  function offerValue(guardianId, sessionId) {
    const draft = state.offers.get(offerKey(guardianId, sessionId)); if (draft) return draft;
    const row = (state.data.dutyOffers || []).find(item => item['保護者ID'] === guardianId && item['予定ID'] === sessionId);
    return row ? { available: answer(row['可否']), morning: answer(row['午前可否']), afternoon: answer(row['午後可否']), 'メモ': row['メモ'] || '' } : {};
  }
  function markAttendance(memberId, sessionId, patch) { if (state.busy) return; state.attendance.set(attendanceKey(memberId, sessionId), { ...attendanceValue(memberId, sessionId), ...patch }); markUnsaved(); }
  function markOffer(guardianId, sessionId, patch) { if (state.busy) return; state.offers.set(offerKey(guardianId, sessionId), { ...offerValue(guardianId, sessionId), ...patch }); markUnsaved(); }
  function inputMonths() { return (state.data?.months || []).filter(m => (state.data?.inputSessions || []).some(s => monthKey(s['月ID']) === monthKey(m['月ID']))).sort((a, b) => monthKey(a['月ID']).localeCompare(monthKey(b['月ID']))); }
  function dateLabel(value) { const date = new Date(`${value}T00:00:00+09:00`); return `${date.getMonth() + 1}月${date.getDate()}日（${['日','月','火','水','木','金','土'][date.getDay()]}）`; }
  function placeName(session, key = '場所ID', fallback = '場所未設定') { return (state.data.places || []).find(place => place['場所ID'] === session[key])?.['名称'] || fallback; }
  function completeAttendance(memberId, session) { const row = attendanceValue(memberId, session['予定ID']); return slotList(session).filter(([slot]) => isOpen(session, slot)).every(([slot]) => typeof row[slot === 'am' ? 'morning' : 'afternoon'] === 'boolean'); }
  function allComplete() { const required = inputSessions().filter(session => !isAllDayRest(session)); return required.every(session => members().every(member => completeAttendance(member['子どもID'], session))) && required.every(session => ['morning','afternoon'].every(key=>typeof offerValue(state.guardianId,session['予定ID'])[key]==='boolean')); }
  function render() {
    $('tabs').replaceChildren(...tabs.map(([id, label]) => button(label, () => { state.tab = id; render(); }, state.tab === id)));
    const panel = $('panel'); panel.replaceChildren();
    if (state.tab === 'input') renderInput(panel); else if (state.tab === 'share') { window.BandShared.render(panel, state.data, state.monthId);for(const session of state.data.sessions.filter(s=>s['種別']==='本番'&&monthKey(s['月ID'])===monthKey(state.monthId))){const box=el('section',undefined,'card');const event=state.data.events.find(e=>e['予定ID']===session['予定ID']);box.append(el('h2',event?.['本番名']||'本番の流れ'));for(const item of (state.data.stageItems||[]).filter(i=>i.sessionId===session['予定ID'])){const detail=el('details');detail.append(el('summary',`${item.order}. ${item.kind} · ${item.title}`),el('p',(item.stage?.speakerNames||[]).join('・')||'担当未指定'),el('p',item.stage?.changes||''));box.append(detail);}panel.append(box);} } else if (state.tab === 'guide') renderGuide(panel); else renderCards(panel);
  }
  function renderInput(panel) {
    const context = el('section', undefined, 'card parent-context');
    context.append(el('p', monthLabel(state.monthId), 'eyebrow'), el('h2', `${state.data.household?.['家庭名'] || 'ご家庭'}の入力`));
    context.append(el('p', '登録済みのお子さまを同じ画面で入力できます。当番可否はご家庭で1回入力します。', 'muted')); panel.append(context);
    panel.append(pills(inputMonths().map(m => [monthKey(m['月ID']), monthLabel(m['月ID'])]), state.monthId, id => { state.monthId = id; state.openSessions.clear(); render(); }, '対象月'));
    const overview = el('section', undefined, 'card month-overview');
    for (const session of inputSessions()) {
      if (isAllDayRest(session)) { const row = el('div', undefined, 'overview-row'); row.append(el('strong', dateLabel(session['日付']).replace('月', '/').replace('日（', '（')), el('span', '全日休み'), el('span', '回答不要', 'badge')); overview.append(row); continue; }
      const answered = members().filter(member => completeAttendance(member['子どもID'], session)).length;
      const duty = ['morning','afternoon'].every(key=>typeof offerValue(state.guardianId,session['予定ID'])[key]==='boolean') ? 1 : 0;
      const status = answered === members().length && duty ? '入力済み' : '未入力あり';
      const row = el('div', undefined, 'overview-row'); row.append(el('strong', dateLabel(session['日付']).replace('月', '/').replace('日（', '（')), el('span', `${members().length ? `回答済み ${answered}/${members().length}人` : '子ども未登録'}`), el('span', `当番 ${duty}/1`, 'muted'), el('span', status, 'badge')); overview.append(row);
    }
    panel.append(overview, el('p', '日付を開くと、兄弟それぞれの出席と当番可否を変更できます。', 'muted'));
    if (!inputSessions().length) { panel.append(el('p', 'この月の入力対象予定はありません。', 'muted')); return; }
    inputSessions().forEach(session => panel.append(sessionEditor(session)));
    const bar = el('div', undefined, 'save-bar parent-save-bar');
    const saveButton = button(state.busy ? '保存中…' : '入力した内容を保存', save, undefined, 'primary');
    saveButton.setAttribute('aria-describedby', 'parent-save-feedback');
    bar.append(el('p', allComplete() ? '全員分の入力がそろっています。' : '未入力があっても、入力した内容を保存できます。', allComplete() ? 'success' : 'muted'), saveButton, saveFeedbackNode);
    panel.append(bar); setSaveFeedback(state.saveFeedback.kind, state.saveFeedback.text);
  }
  function sessionEditor(session) {
    const details = document.createElement('details'); details.className = 'card'; details.open = state.openSessions.has(session['予定ID']);
    details.addEventListener('toggle', () => { if (details.open) state.openSessions.add(session['予定ID']); else state.openSessions.delete(session['予定ID']); });
    const summary = document.createElement('summary'); const head = el('span', undefined, 'session-head');
    if (session['種別'] === '本番') {
      const event = (state.data.events || []).find(row => row['予定ID'] === session['予定ID']);
      head.append(el('h2', event?.['本番名'] || '本番名未設定', 'event-title'), el('span', `${dateLabel(session['日付'])} · 本番`, 'badge'));
    } else head.append(el('h2', dateLabel(session['日付'])), el('span', session['種別'], 'badge'));
    if (isAllDayRest(session)) {
      summary.append(head, el('span', session['種別'] === '本番' ? '中止' : '全日休み', 'session-meta practice-place-line')); details.append(summary);
      const body = el('div', undefined, 'session-body'); body.append(el('p', 'この日は実施しません。出欠・当番の回答は不要です。', 'muted'));
      details.append(body); return details;
    }
    const times = `${session['集合'] || '未定'}集合 · ${session['開始'] || '未定'}–${session['終了'] || '未定'} · ${session['解散'] || '未定'}解散`;
    summary.append(head);
    if (session['種別'] === '通常練習') summary.append(el('span', `集合場所：${placeName(session, '集合場所ID', '未設定')}`, 'session-meta practice-place-line'), el('span', `練習場所：${placeName(session, '場所ID', '未設定')}`, 'session-meta practice-place-line'), el('span', times, 'session-meta practice-place-line'));
    else summary.append(el('span', `${placeName(session)} · ${times}`, 'session-meta'));
    details.append(summary);
    const body = el('div', undefined, 'session-body');
    for (const member of members()) body.append(memberEditor(member, session));
    body.append(dutyEditor(session)); details.append(body); return details;
  }
  function memberEditor(member, session) {
    const wrap = el('section', undefined, 'member'); wrap.append(el('h3', member['氏名']));
    for (const [slot, label] of slotList(session)) {
      if (!isOpen(session, slot)) continue;
      const key = slot === 'am' ? 'morning' : 'afternoon'; const value = attendanceValue(member['子どもID'], session['予定ID'])[key];
      const row = el('div', undefined, 'slot-row'); row.append(el('strong', label), pills([['', '未入力'], ['yes', '出席'], ['no', '欠席']], value === true ? 'yes' : value === false ? 'no' : '', id => { markAttendance(member['子どもID'], session['予定ID'], { [key]: id === 'yes' ? true : id === 'no' ? false : undefined }); state.openSessions.add(session['予定ID']); render(); }, `${member['氏名']} ${dateLabel(session['日付'])} ${label}の出席`)); wrap.append(row);
    }
    const note = document.createElement('input'); note.type = 'text'; note.disabled = state.busy; note.placeholder = '連絡事項（任意：遅刻・早退など）'; note.value = attendanceValue(member['子どもID'], session['予定ID'])['連絡事項'] || '';
    note.addEventListener('input', () => markAttendance(member['子どもID'], session['予定ID'], { '連絡事項': note.value })); wrap.append(note); return wrap;
  }
  function dutyEditor(session) {
    const wrap = el('section', undefined, 'duty');
    wrap.append(el('h3', '保護者当番'), el('p', '当日の担当は管理者が調整して確定します。', 'muted'));
    const current = offerValue(state.guardianId, session['予定ID']);
    if(typeof current.available==='boolean' && current.morning===undefined && current.afternoon===undefined)wrap.append(el('p',current.available?'以前の回答：当番可（時間帯未指定）。午前・午後はまだ指定されていません。':'以前の回答：当番不可（時間帯未指定）。', 'muted'));
    for(const [key,label] of [['morning','午前'],['afternoon','午後']]) {
      const value=current[key];
      wrap.append(el('h4',label),pills([['','未回答'],['yes','可能'],['no','不可']],value===true?'yes':value===false?'no':'',id=>{
        const patch={...current,[key]:id==='yes'?true:id==='no'?false:undefined,slotsEdited:true};
        patch.available=patch.morning===true||patch.afternoon===true?true:patch.morning===false&&patch.afternoon===false?false:undefined;
        markOffer(state.guardianId,session['予定ID'],patch);state.openSessions.add(session['予定ID']);render();
      },`${dateLabel(session['日付'])}の当番可否 ${label}`));
    }
    wrap.append(el('p','両方可能な場合は、午前・午後をそれぞれ「可能」にしてください。未回答は不可と区別します。','muted'));
    if(state.offers.has(offerKey(state.guardianId,session['予定ID'])))wrap.append(button('この当番回答の変更を取消',()=>{state.offers.delete(offerKey(state.guardianId,session['予定ID']));render();}));
    const note = document.createElement('input'); note.type = 'text'; note.disabled = state.busy; note.placeholder = '当番に関するメモ（任意）'; note.value = offerValue(state.guardianId, session['予定ID'])['メモ'] || '';
    note.addEventListener('input', () => markOffer(state.guardianId, session['予定ID'], { 'メモ': note.value })); wrap.append(note); return wrap;
  }
  async function fetchCards() {
    if (state.cardLoading) return;
    state.cardLoading = true;
    try { state.cards = await api.request('parent_card'); if (state.tab === 'card') render(); }
    catch (error) { if (state.tab === 'card') { const panel = $('panel'); panel.replaceChildren(el('p', error.message || '個人カードを読み込めませんでした。', 'error'), button('再試行', () => fetchCards())); } }
    finally { state.cardLoading = false; }
  }
  function renderCards(panel) {
    if (!state.cards) { panel.append(el('p', '個人カードを読み込んでいます…', 'muted')); fetchCards(); return; }
    const data = state.cards; const sessions = (data.sessions || []).slice().sort((a,b) => a['日付'].localeCompare(b['日付']));
    const heading = el('section', undefined, 'card'); heading.append(el('h2', 'この家庭の個人カード'), el('p', '公開済みの本番だけを表示します。保護者と子どもを切り替え、各人の担当を確認できます。', 'muted'), button('個人カードを再読み込み', () => { state.cards = undefined; render(); })); panel.append(heading);
    if (!sessions.length) { panel.append(el('section', '公開済みの本番はありません。', 'card')); return; }
    if (!sessions.some(s => s['予定ID'] === state.cardSession)) state.cardSession = sessions[0]['予定ID'];
    const people = [...(data.guardians || []).map(person => [person['保護者ID'], `保護者：${person['表示名']}`]), ...(data.members || []).map(person => [person['子どもID'], `子ども：${person['氏名']}`])];
    if (!people.some(([id]) => id === state.cardPerson)) state.cardPerson = people[0]?.[0] || '';
    panel.append(pills(sessions.map(session => [session['予定ID'], `${session['日付']} ${(data.events || []).find(event => event['予定ID'] === session['予定ID'])?.['本番名'] || '本番名未設定'}`]), state.cardSession, id => { state.cardSession = id; render(); }, '個人カードの本番'), pills(people, state.cardPerson, id => { state.cardPerson = id; render(); }, '個人カードの対象'));
    const event = (data.events || []).find(event => event['予定ID'] === state.cardSession);
    const info = el('section', undefined, 'card'); info.append(el('h2', event?.['本番名'] || '本番名未設定', 'event-title'), el('p', `${sessions.find(session => session['予定ID'] === state.cardSession)['日付']} · 本番`, 'eyebrow')); [['会場', '会場'], ['衣装', '衣装'], ['子どもの持ち物', '子どもの持ち物'], ['全体連絡', '全体連絡']].forEach(([label,key]) => { if (event?.[key]) info.append(el('p', `${label}：${event[key]}`)); }); panel.append(info);
    const dayCard = el('section', undefined, 'card');
    BandShared.renderDaySchedule(dayCard, sessions.find(session => session['予定ID'] === state.cardSession), data.daySchedule || [], data.places || []); panel.append(dayCard);
    const stageItems = (data.stageItems || []).filter(item=>item.sessionId===state.cardSession);
    BandShared.renderProgress(panel,stageItems,(data.layouts || []).filter(layout=>layout.sessionId===state.cardSession),state.cardPerson,'parent-'+state.cardSession);
    const assigned = (data.timelineItems || []).filter(item => item['予定ID'] === state.cardSession && String(item['担当'] || '').split(',').includes(state.cardPerson));
    const card = el('section', undefined, 'card personal-timeline'); card.append(el('h2', `${people.find(([id]) => id === state.cardPerson)?.[1] || '選択した人'}の担当`));
    if (!assigned.length && !stageItems.some(item=>item.roles?.[state.cardPerson]?.length)) card.append(el('p', 'この人に割り当てられた進行項目はありません。担当なしと欠席は別です。出欠は「出欠・当番の回答」で確認してください。', 'muted'));
    for (const day of ['前日', '当日']) { const items = assigned.filter(item => item['日区分'] === day); if (!items.length) continue; card.append(el('h3', day)); items.forEach(item => { const section = el('article', undefined, 'slot'); section.append(el('h3', `${item['時刻'] || '時刻未設定'} · ${item['内容']}`)); if (item['種別']) section.append(el('p', item['種別'], 'badge')); section.append(el('p', `場所：${BandShared.timelinePlace(item, data.places || []) || '未定'}`)); if (item['持ち物']) section.append(el('p', `持ち物：${item['持ち物']}`)); if (item['注意点']) section.append(el('p', `注意点：${item['注意点']}`, 'note')); card.append(section); }); }
    const stageRoles=stageItems.filter(item=>item.roles?.[state.cardPerson]?.length).sort(BandShared.stageOrder);
    if(stageRoles.length){card.append(el('h3','演奏中のあなたの役割'));stageRoles.forEach(item=>{const section=el('article',undefined,'slot');section.append(el('h3',`${item.day} ${item.kind} · ${item.title}`),el('p',item.roles[state.cardPerson].join('・')));BandShared.stageSummary({...item,stage:{...item.stage,layoutName:(data.layouts || []).find(l=>l.id===item.stage.layoutId)?.name}}).forEach(line=>section.append(el('p',line)));card.append(section);});}
    const layouts = (data.layouts || []).filter(layout => layout.sessionId === state.cardSession);
    if (layouts.length) { const link = el('a', '公開配置図を確認'); link.href = '#personal-layout'; card.append(link); }
    panel.append(card);
    if (layouts.length) { const section = el('section', undefined, 'card'); section.id = 'personal-layout'; section.append(el('h2', '公開配置図')); layouts.forEach(layout => BandShared.renderLayout(section, layout)); panel.append(section); }
  }
  function renderGuide(panel) {
    const references = state.data.references || {};
    if (references.status !== 'ready') { panel.append(el('section', '当番ガイド・年間本番一覧は、管理者が元の資料をアプリへ取り込むと表示されます。', 'card warning')); return; }
    panel.append(pills([['duty', '当番ガイド'], ['events', '年間本番一覧']], state.guideTab, id => { state.guideTab = id; render(); }, 'ガイドの種類'));
    if (state.guideTab === 'duty') renderDutyGuide(panel, references.guide || {}); else renderAnnualEvents(panel, references.annualEvents || []);
  }
  function renderDutyGuide(panel, guide) {
    const items = guide.items || [];
    let card, list;
    items.forEach(item => {
      if (item.type === '見出し') { card = el('section', undefined, 'card guide-step'); const body = el('div'); body.append(el('h2', item.content)); card.append(el('strong', String((panel.querySelectorAll('.guide-step').length) + 1)), body); panel.append(card); list = undefined; return; }
      if (!card) { card = el('section', undefined, 'card guide-intro'); card.append(el('h2', '当番ガイド')); panel.append(card); }
      if (item.type === '手順') { if (!list) { list = el('ul', undefined, 'checklist'); card.append(list); } list.append(el('li', item.content)); }
      else card.append(el('p', item.content, item.content.startsWith('※') ? 'notice' : 'muted'));
    });
  }
  function renderAnnualEvents(panel, events) {
    const intro = el('section', '例年の本番候補と準備の目安です。実施が決まった本番は、管理者が正式な本番予定として作成・公開します。', 'card guide-intro'); panel.append(intro);
    const months = [...new Set(events.map(event => event.month).filter(Boolean))]; let selected = 'all'; const list = el('section', undefined, 'event-list');
    const draw = () => { list.replaceChildren(); events.filter(event => selected === 'all' || event.month === selected).forEach(event => list.append(eventCard(event))); };
    panel.append(pills([['all', 'すべて'], ...months.map(month => [month, month])], selected, value => { selected = value; draw(); }, '月で絞り込み'), list); draw();
  }
  function eventCard(event) {
    const details = document.createElement('details'); details.className = 'card event-card'; const summary = document.createElement('summary'); const title = el('span'); title.append(el('strong', event.name), el('small', `${event.schedule || '日程未定'} · ${event.venue || '場所未定'}`)); summary.append(el('span', event.month, 'event-month'), title, el('span', '›', 'event-arrow')); details.append(summary);
    const body = el('div', undefined, 'event-detail'); const facts = el('dl', undefined, 'event-facts'); [['演奏時間', event.duration], ['楽器運び', event.transport], ['演奏できる楽器', event.instruments], ['事前打合せ', event.meeting]].forEach(([label, value]) => { const item = el('div'); item.append(el('dt', label), el('dd', value || '未定')); facts.append(item); }); body.append(facts); if (event.notes) body.append(el('p', event.notes, 'notice')); details.append(body); return details;
  }
  async function save() {
    if (state.busy) return;
    if (!hasUnsavedAnswers()) { if (state.saveFeedback.kind !== 'saved') setSaveFeedback('neutral', '保存する変更はありません。'); return; }
    state.busy = true; render(); setSaveFeedback('saving', '保存中です…');
    let result;
    try {
      const attendance = [...state.attendance.entries()].map(([key, row]) => { const [memberId, sessionId] = key.split('|'); return { memberId, sessionId, morning: row.morning === undefined ? null : row.morning, afternoon: row.afternoon === undefined ? null : row.afternoon, note: row['連絡事項'] || '', guardianId: state.guardianId }; });
      const dutyOffers = [...state.offers.entries()].map(([key, row]) => { const [guardianId, sessionId] = key.split('|'); return { guardianId, sessionId, available: row.available === undefined ? null : row.available, ...(row.slotsEdited?{morning:row.morning===undefined?null:row.morning,afternoon:row.afternoon===undefined?null:row.afternoon}:{}), note: row['メモ'] || '' }; });
      await api.request('save_parent_month', { attendance, dutyOffers });
      state.savedDrafts = true;
      try { await load(); result = ['saved', '保存しました。']; }
      catch (error) { result = ['saved', `保存は完了しましたが、画面の更新に失敗しました：${error.message || '読み込めませんでした。'} 再読み込みして確認してください。`]; }
    } catch (error) { result = ['error', `保存できませんでした：${error.message || 'もう一度お試しください。'} 入力内容はこの画面に残っています。`]; }
    finally { state.busy = false; render(); if (result) setSaveFeedback(...result); }
  }
  async function load() {
    const next = await api.request('parent_bootstrap'); if(next.performanceVersion !== 2) throw new Error('保存APIの更新が必要です。旧APIへの入力を停止しました。'); state.data = next; state.cards = undefined; state.attendance.clear(); state.offers.clear(); state.savedDrafts = false; setSaveFeedback('idle', '');
    const firstMonth = inputMonths()[0]; state.monthId = state.monthId && inputMonths().some(m => monthKey(m['月ID']) === state.monthId) ? state.monthId : monthKey(firstMonth?.['月ID']);
    state.guardianId = guardians()[0]?.['保護者ID'] || '';
    $('connection').hidden = true; $('workspace').hidden = false; render();
  }
  async function connect() { try { api.configure($('api-url').value.trim()); await load(); message('接続しました。'); } catch (error) { message(error.message || '接続できませんでした。', true); } }
  $('connect').addEventListener('click', connect);
  window.addEventListener('beforeunload', event => {
    if (hasUnsavedAnswers()) { event.preventDefault(); event.returnValue = ''; }
  });
  if (!api.hasToken) message('保護者用の招待URL（parent.html?k=…）から開いてください。', true);
  else if (!api.endpoint) { $('connection').hidden = false; message('初回の接続先を設定してください。'); }
  else load().then(() => message('読み込みました。')).catch(error => message(error.message || '読み込めませんでした。', true));
})();
