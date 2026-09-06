'use strict';
// 個人の名簿・連絡事項を受け取らない、公開予定専用の描画関数。
window.BandShared = (() => {
  function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
  function render(container, data, monthId) {
    container.replaceChildren();
    const sessions = (data.sessions || []).filter(s => s['確定状態'] === '公開' && (!monthId || s['月ID'] === monthId)).sort((a, b) => a['日付'].localeCompare(b['日付']));
    if (!sessions.length) { container.append(el('p', '公開済みの予定はありません。', 'muted')); return; }
    for (const s of sessions) {
      const card = el('article', undefined, 'card');
      card.append(el('h3', `${s['日付']} · ${s['種別']}`));
      const place = (data.places || []).find(p => p['場所ID'] === s['場所ID']);
      card.append(el('p', `${s['集合']}集合 → ${s['解散']}解散 / ${place ? place['名称'] : '場所未設定'}`));
      const slots = s['種別'] === '本番' ? [['am', '終日']] : [['am', '午前'], ['pm', '午後']];
      for (const [slot, label] of slots) {
        if (s[`実施有無_${slot}`] === 'なし') continue;
        const teacherIds = String(s[`担当先生ID_${slot}`] || '').split(',').map(id => id.trim()).filter(Boolean);
        const teacherNames = teacherIds.map(id => (data.teachers || []).find(t => t['先生ID'] === id)?.['氏名']).filter(Boolean);
        const staffing = s[`staffing_${slot}`] || '未定';
        card.append(el('div', `${label}：${staffing === '先生あり' ? teacherNames.join('・') || '先生あり' : staffing}`));
      }
      const duties = (data.dutyAssignments || []).filter(d => d['予定ID'] === s['予定ID']);
      card.append(el('p', `本日の当番：${duties.map(d => `${d['表示名']}さん（${d['役割']}）`).join('、') || '未定'}`));
      const counts = data.attendanceCounts?.[s['予定ID']] || { morning: 0, afternoon: 0 };
      card.append(el('div', `出席予定：午前${counts.morning}名 ／ 午後${counts.afternoon}名`, 'muted'));
      if (s['備考']) card.append(el('p', s['備考'], 'note'));
      container.append(card);
    }
  }
  return { render };
})();
