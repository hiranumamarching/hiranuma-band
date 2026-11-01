'use strict';
// UI-only helpers. The stored sessions schema and time values remain compatible.
window.BandPracticePlan = (() => {
  const timeKeys = ['集合', '開始', '終了', '解散'];
  function mode(session) {
    const am = session['実施有無_am'] !== 'なし', pm = session['実施有無_pm'] !== 'なし';
    return am && pm ? 'all' : am ? 'am' : pm ? 'pm' : 'off';
  }
  function defaults(value) {
    const times = { all: ['09:45', '10:00', '15:00', '15:15'], am: ['09:45', '10:00', '12:00', '12:15'], pm: ['12:45', '13:00', '15:00', '15:15'] }[value];
    return times ? Object.fromEntries(timeKeys.map((key, i) => [key, times[i]])) : {};
  }
  function apply(session, value, protectedTimes = new Set()) {
    if (!['am', 'pm', 'all', 'off'].includes(value) || session['種別'] === '本番') return;
    session['実施有無_am'] = value === 'am' || value === 'all' ? '実施' : 'なし';
    session['実施有無_pm'] = value === 'pm' || value === 'all' ? '実施' : 'なし';
    Object.entries(defaults(value)).forEach(([key, time]) => { if (!protectedTimes.has(key)) session[key] = time; });
  }
  return { timeKeys, mode, defaults, apply };
})();
