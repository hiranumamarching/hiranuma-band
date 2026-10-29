'use strict';
// 公開予定・配置図・演奏進行の描画。演奏中の確認位置は端末内だけで保持する。
window.BandShared = (() => {
  function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
  function render(container, data, monthId) {
    container.replaceChildren();
    const sessions = (data.sessions || []).filter(s => s['確定状態'] === '公開' && (!monthId || s['月ID'] === monthId)).sort((a, b) => a['日付'].localeCompare(b['日付']));
    if (!sessions.length) { container.append(el('p', '公開済みの予定はありません。', 'muted')); return; }
    for (const s of sessions) {
      const card = el('article', undefined, 'card');
      if (s['種別'] === '本番') {
        const event = (data.events || []).find(row => row['予定ID'] === s['予定ID']);
        card.append(el('h3', event?.['本番名'] || '本番名未設定', 'event-title'), el('p', `${s['日付']} · 本番`, 'eyebrow'));
      } else card.append(el('h3', `${s['日付']} · ${s['種別']}`));
      if (s['種別'] !== '本番' && s['実施有無_am'] === 'なし' && s['実施有無_pm'] === 'なし') {
        card.append(el('p', '全日休み', 'badge'));
        if (s['備考']) card.append(el('p', s['備考'], 'note'));
        container.append(card);
        continue;
      }
      const place = (data.places || []).find(p => p['場所ID'] === s['場所ID']);
      if (s['種別'] === '本番') renderDaySchedule(card, s, data.daySchedule || [], data.places || []);
      else if (s['種別'] === '通常練習') {
        const collectionPlace = (data.places || []).find(p => p['場所ID'] === s['集合場所ID']);
        card.append(el('p', `${s['集合']}集合 → ${s['解散']}解散`), el('p', `集合場所：${collectionPlace?.['名称'] || '未設定'}`), el('p', `練習場所：${place?.['名称'] || '未設定'}`));
      }
      else card.append(el('p', `${s['集合']}集合 → ${s['解散']}解散 / ${place ? place['名称'] : '場所未設定'}`));
      if (s['種別'] === '本番' && s['実施有無_am'] === 'なし') card.append(el('p', '中止', 'warning'));
      const slots = s['種別'] === '本番' ? [['am', '終日']] : [['am', '午前'], ['pm', '午後']];
      for (const [slot, label] of slots) {
        if (s[`実施有無_${slot}`] === 'なし') continue;
        const teacherIds = String(s[`担当先生ID_${slot}`] || '').split(',').map(id => id.trim()).filter(Boolean);
        const teacherNames = teacherIds.map(id => (data.teachers || []).find(t => t['先生ID'] === id)?.['氏名']).filter(Boolean);
        const staffing = s['種別'] === '本番' && s[`staffing_${slot}`] !== '先生あり' ? '先生参加：未定／不在' : s[`staffing_${slot}`] || '未定';
        card.append(el('div', `${label}：${staffing === '先生あり' ? teacherNames.join('・') || '先生あり' : staffing}`));
      }
      const duties = (data.dutyAssignments || []).filter(d => d['予定ID'] === s['予定ID']);
      const dutyText = duties.map(d => {
        const division = String(d['区分'] || '');
        const slot = division.startsWith('午後-') ? '午後' : division.startsWith('午前-') ? '午前' : '';
        return `${d['表示名']}さん（${slot ? `${slot}・` : ''}${d['役割']}）`;
      }).join('、');
      card.append(el('p', `本日の当番：${dutyText || '未定'}`));
      const counts = data.attendanceCounts?.[s['予定ID']] || { morning: 0, afternoon: 0 };
      card.append(el('div', s['種別'] === '本番' ? `出席予定：終日${counts.morning}名` : `出席予定：午前${counts.morning}名 ／ 午後${counts.afternoon}名`, 'muted'));
      if (s['備考']) card.append(el('p', s['備考'], 'note'));
      (data.layouts || []).filter(layout => layout.sessionId === s['予定ID']).forEach(layout => renderLayout(card, layout));
      container.append(card);
    }
  }
  // 当日の流れは時刻順。時刻未定は末尾に置き、同時刻・未定どうしは並び順で決める。
  const timeOrder = value => /^\d{1,2}:\d{2}$/.test(String(value || '').trim()) ? String(value).trim().padStart(5, '0') : '99:99';
  function compareTimeline(a, b) { return timeOrder(a['時刻']).localeCompare(timeOrder(b['時刻'])) || Number(a['並び順'] || 0) - Number(b['並び順'] || 0) || String(a['項目ID']).localeCompare(String(b['項目ID'])); }
  function renderDaySchedule(container, session, items = [], places = []) {
    if (!session || session['種別'] !== '本番' || !session['予定ID']) return;
    const shown = value => value === undefined || value === null || String(value).trim() === '' ? '未定' : String(value);
    const placeName = id => id ? shown(places.find(place => place['場所ID'] === id)?.['名称']) : '未定';
    const section = el('section', undefined, 'day-schedule');
    section.append(el('h3', '当日の流れ'));
    const summary = el('div', undefined, 'day-schedule-summary');
    summary.append(el('strong', `集合：${shown(session['集合'])}`), el('strong', `解散：${shown(session['解散'])}`), el('p', `集合場所：${placeName(session['場所ID'])}`));
    section.append(summary);
    // 管理者の生データと公開済みの最小データの両方を受け取れる。
    const latest = new Map();
    items.forEach(item => { if (item && item['項目ID']) latest.set(item['項目ID'], item); });
    const rows = [...latest.values()].filter(item => item['予定ID'] === session['予定ID'] && item.scope !== 'ステージ進行' && (!Object.prototype.hasOwnProperty.call(item, '有効') || ['true', '1', '○'].includes(String(item['有効']).toLowerCase()))).sort(compareTimeline);
    for (const day of ['前日', '当日']) {
      const dayItems = rows.filter(item => item['日区分'] === day);
      if (!dayItems.length) continue;
      const group = el('section', undefined, 'day-schedule-group'); group.append(el('h4', day));
      const list = el('ol', undefined, 'day-schedule-list');
      dayItems.forEach(item => {
        const row = el('li', undefined, 'day-schedule-item');
        row.append(el('strong', `時刻：${shown(item['時刻'])}`), el('p', shown(item['内容'])), el('p', `場所：${shown(timelinePlace(item, places))}`));
        list.append(row);
      });
      group.append(list); section.append(group);
    }
    if (!rows.some(item => ['前日', '当日'].includes(item['日区分']))) section.append(el('p', '当日の流れは未定です。', 'muted'));
    container.append(section); return section;
  }
  // 人と楽器は既存スキーマの別項目で保持。PAIR-<人の配置ID>で関連付ける。
  // 表示切替では保存データを変更しないため、旧API・既存検証サーバーでも保持できる。
  const layoutViewModes = new Map();
  const pairId = id => `PAIR-${id}`;
  function pairedInstrument(layout, personId) { return (layout.items || []).find(item => item.kind === 'instrument' && item.id === pairId(personId)); }
  function pairedPerson(layout, item) { return item.kind === 'instrument' ? (layout.items || []).find(person => person.kind === 'person' && item.id === pairId(person.id)) : undefined; }
  function setInstrument(layout, personId, label) {
    const person = layout.items.find(item => item.id === personId && item.kind === 'person');
    if (!person) throw new Error('配置したメンバーを選んでください。');
    label = String(label || '').trim(); if (label.length > 40) throw new Error('楽器名は40文字以内です。');
    const current = pairedInstrument(layout, personId);
    if (!label) { layout.items = layout.items.filter(item => item !== current); return; }
    if (current) { current.label = label; return; }
    if (layout.items.length >= 100) throw new Error('配置は100項目までです。');
    if (layout.items.some(item => item.id === pairId(personId))) throw new Error('配置IDが重複しています。');
    layout.items.push({ id: pairId(personId), kind: 'instrument', label, x: person.x, y: Math.min(90, person.y + 15), memberId: '' });
  }
  function moveLayoutItem(layout, id, dx, dy) {
    const item = layout.items.find(item => item.id === id); if (!item) return;
    const pair = item.kind === 'person' ? pairedInstrument(layout, id) : undefined;
    const group = pair ? [item, pair] : [item];
    dx = Math.min(Math.max(dx, Math.max(...group.map(row => 5 - row.x))), Math.min(...group.map(row => 95 - row.x)));
    dy = Math.min(Math.max(dy, Math.max(...group.map(row => 5 - row.y))), Math.min(...group.map(row => 90 - row.y)));
    group.forEach(row => { row.x += dx; row.y += dy; });
  }
  function removeLayoutItem(layout, id) {
    const item = layout.items.find(item => item.id === id); if (!item) return;
    layout.items = layout.items.filter(row => row.id !== id && !(item.kind === 'person' && row.id === pairId(id)));
  }
  function layoutMode(layout) { return layoutViewModes.get(layout.id) || (layout.items.some(item => pairedPerson(layout, item)) ? 'combined' : 'separate'); }
  function setLayoutMode(layout, mode) { if (mode !== 'combined' && mode !== 'separate') throw new Error('表示方式が不正です。'); layoutViewModes.set(layout.id, mode); }
  function renderLayout(container, layout, onSelect) {
    const section = el('section', undefined, 'layout-view'); section.append(el('h3', layout.name || '配置図'));
    const reference = ((layout.name || '').startsWith('参考配置') || (layout.name || '').includes('本人確認済み')); const mode = reference ? 'separate' : layoutMode(layout); const switches = el('div', undefined, 'layout-controls'); switches.setAttribute('role', 'group'); switches.setAttribute('aria-label', '配置図の表示方式');
    [['separate', '人と楽器を別表示'], ['combined', '名前＋担当楽器を一体表示']].forEach(([value,label]) => { const button = el('button', label); button.type = 'button'; button.setAttribute('aria-pressed', String(mode === value)); button.addEventListener('click', () => { setLayoutMode(layout,value); const holder = el('div'); section.replaceWith(renderLayout(holder,layout,onSelect)); }); switches.append(button); }); section.append(switches);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 400 280'); svg.setAttribute('class', 'layout-board'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `${layout.name || '配置図'}：上から見た相対配置、下が客席側`);
    const text = (x, y, value) => { const node = document.createElementNS(svg.namespaceURI, 'text'); node.setAttribute('x', x); node.setAttribute('y', y); node.setAttribute('text-anchor', 'middle'); node.textContent = value; return node; };
    const shorten = value => String(value).length > 8 ? String(value).slice(0, 7) + '…' : String(value);
    (layout.items || []).forEach((item,index) => {
      if (mode === 'combined' && pairedPerson(layout,item)) return;
      const combined = mode === 'combined' && item.kind === 'person'; const instrument = combined ? pairedInstrument(layout,item.id) : undefined;
      const group = document.createElementNS(svg.namespaceURI, 'g'); const half = reference ? 5 : combined ? 54 : 38; const drawX = Math.max(half + 4, Math.min(400 - half - 4, item.x * 4)); const drawY = Math.max(combined ? 27 : 20, Math.min(combined ? 244 : 251, item.y * 2.8)); group.setAttribute('transform', `translate(${drawX} ${drawY})`); group.setAttribute('class', item.kind === 'person' ? 'layout-person' : 'layout-instrument');
      const rect = document.createElementNS(svg.namespaceURI, 'rect'); rect.setAttribute('x', combined ? '-54' : '-38'); rect.setAttribute('y', combined ? '-23' : '-16'); rect.setAttribute('width', combined ? '108' : '76'); rect.setAttribute('height', combined ? '46' : '32'); rect.setAttribute('rx', '7');
      const title = document.createElementNS(svg.namespaceURI, 'title'); title.textContent = combined ? `${item.label} / ${instrument?.label || '担当楽器未設定'}` : item.label;
      if(reference){rect.setAttribute('x','-5');rect.setAttribute('y','-5');rect.setAttribute('width','10');rect.setAttribute('height','10');rect.setAttribute('rx','2');} const caption=text(0, reference ? '3' : combined ? '-3' : '5', reference ? String(index+1) : shorten(item.label));if(reference)caption.setAttribute('style','font-size:7px');group.append(rect,caption);
      if (combined) { const second = text(0, 15, shorten(instrument?.label || '担当楽器未設定')); second.setAttribute('class','layout-instrument-line'); group.append(second); }
      group.append(title); group.setAttribute('aria-label',title.textContent); if (onSelect) group.addEventListener('click', () => onSelect(item.id)); svg.append(group);
    });
    svg.append(text(200, 274, '客席側 ↓')); const legend = el('ul', undefined, 'layout-legend'); (layout.items || []).filter(item => mode !== 'combined' || !pairedPerson(layout,item)).forEach((item,index) => legend.append(el('li', `${reference ? (index+1)+'. 未リンク：' : ''}${item.label}${mode === 'combined' && item.kind === 'person' ? `／${pairedInstrument(layout,item.id)?.label || '担当楽器未設定'}` : ''}`))); section.append(svg, legend, el('p', '相対位置の図です。実寸や必要な間隔は会場で確認してください。', 'muted')); if (layout.notes) section.append(el('p', layout.notes, 'note')); container.append(section); return section;
  }
  const progressPositions = new Map();
  function timelinePlace(item, places = []) {
    if (Object.prototype.hasOwnProperty.call(item, '場所自由入力')) return item['場所自由入力'] || '';
    const stage = readStage(item);
    if (Object.prototype.hasOwnProperty.call(stage, 'placeText')) return stage.placeText || '';
    return places.find(place => place['場所ID'] === item['場所ID'])?.['名称'] || '';
  }
  function readStage(item) { try { return Object.assign({speakers:[], microphones:[], prepare:[], layoutId:'', changes:''}, JSON.parse(item.stageJSON || '{}')); } catch (_) { return {speakers:[],microphones:[],prepare:[],layoutId:'',changes:''}; } }
  function stageOrder(a,b) { return (a.day === '前日' ? 0 : 1) - (b.day === '前日' ? 0 : 1) || Number(a.order || 0) - Number(b.order || 0) || String(a.id).localeCompare(String(b.id)); }
  function stageSummary(item) {
    const stage=item.stage || {}; const lines=[];
    if (item.kind === 'MC') lines.push(`話す担当：${(stage.speakerNames || []).join('・') || '未指定'}`);
    if ((stage.microphones || []).length) stage.microphones.forEach(mic=>lines.push(`${mic.label || 'マイクの呼び名未指定'}：${mic.fromName || '渡す人未指定'} → ${mic.toName || '受け取る人未指定'}`));
    else if (item.kind === 'MC') lines.push('マイク受け渡し：未指定');
    lines.push(`次の準備：${(stage.prepareNames || []).join('・') || '未指定'}`);
    if(item.kind === '曲') { lines.push(`配置：${stage.layoutName || (stage.layoutId ? '参照先を確認' : '未指定')}`); lines.push(`持替・変更：${stage.changes || '未指定（変更なしの場合も入力可）'}`); }
    else if(stage.changes) lines.push(`持替・変更：${stage.changes}`);
    return lines;
  }
  function renderProgress(container, items, layouts=[], personId='', key='') {
    const ordered=items.slice().sort(stageOrder); if(!ordered.length)return;
    const wrap=el('section',undefined,'card stage-progress'); let selected=progressPositions.get(key); if(!ordered.some(i=>i.id===selected))selected=ordered[0].id;
    const draw=()=>{ wrap.replaceChildren(el('h2','演奏の流れ'),el('p','並び順で表示します。「今・次」はこの画面での確認位置です。ほかの端末に現在位置を送信しません。','muted'));
      const index=ordered.findIndex(i=>i.id===selected); const cues=el('div',undefined,'stage-cues');
      [ordered[index],ordered[index+1]].forEach((item,n)=>{const cue=el('article',undefined,'slot');cue.append(el('strong',n===0?'今の確認項目':'次の項目'));if(!item){cue.append(el('p','最後の項目です'));cues.append(cue);return;}
        cue.append(el('h3',`${item.day} ${item.kind} · ${item.title}`));if(personId)cue.append(el('p',`あなたの役割：${(item.roles?.[personId] || []).join('・') || '指定なし'}`));
        const enriched={...item,stage:{...item.stage,layoutName:layouts.find(l=>l.id===item.stage?.layoutId)?.name}};stageSummary(enriched).forEach(line=>cue.append(el('p',line)));
        const layout=layouts.find(l=>l.id===item.stage?.layoutId);if(layout){const detail=el('details');detail.append(el('summary','この曲の配置図'));renderLayout(detail,layout);cue.append(detail);}cues.append(cue);
      });wrap.append(cues);
      const controls=el('div',undefined,'layout-controls');[['前の項目',index-1],['次の項目',index+1]].forEach(([label,next])=>{const b=el('button',label);b.type='button';b.disabled=next<0||next>=ordered.length;b.onclick=()=>{selected=ordered[next].id;progressPositions.set(key,selected);draw();};controls.append(b);});wrap.append(controls);
      const list=el('div',undefined,'stage-list');ordered.forEach((item,i)=>{const b=el('button',`${i+1}. ${item.day} ${item.kind} · ${item.title}${personId && item.roles?.[personId]?.length ? ' ／あなた：'+item.roles[personId].join('・') : ''}`,'stage-row');b.type='button';b.setAttribute('aria-pressed',String(item.id===selected));b.onclick=()=>{selected=item.id;progressPositions.set(key,selected);draw();};list.append(b);});wrap.append(list);
    };draw();container.append(wrap);return wrap;
  }
  // 項目IDに紐づく内容を動かさず、同じ本番・日・進行種別の順序だけを変更。
  function reorderTimeline(items, movingId, targetId, after=false) {
    const moving=items.find(i=>i['項目ID']===movingId&&i['有効']!==false),target=items.find(i=>i['項目ID']===targetId&&i['有効']!==false);
    if(!moving||!target||moving===target||moving['予定ID']!==target['予定ID']||moving['日区分']!==target['日区分']||moving.scope!==target.scope)return [];
    const all=items.filter(i=>i['有効']!==false&&i['予定ID']===moving['予定ID']&&i['日区分']===moving['日区分']).sort((a,b)=>Number(a['並び順']||0)-Number(b['並び順']||0)||String(a['項目ID']).localeCompare(String(b['項目ID'])));
    const group=all.filter(i=>i.scope===moving.scope),next=group.filter(i=>i!==moving);next.splice(next.indexOf(target)+(after?1:0),0,moving);
    if(group.every((i,n)=>i===next[n]))return [];
    let at=0;const ordered=all.map(i=>i.scope===moving.scope?next[at++]:i);const changed=[];ordered.forEach((i,n)=>{if(Number(i['並び順'])!==n+1){i['並び順']=n+1;changed.push(i);}});return changed;
  }
  const layoutModel = { pairedInstrument, pairedPerson, setInstrument, move: moveLayoutItem, remove: removeLayoutItem, mode: layoutMode, setMode: setLayoutMode };
  return { timelinePlace, render, renderDaySchedule, compareTimeline, renderLayout, layoutModel, readStage, stageOrder, stageSummary, renderProgress, reorderTimeline };
})();
