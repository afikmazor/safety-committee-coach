'use strict';
/* =========================================================
   בב״ח – הכנה לוועדת הסמכה לממוני בטיחות | כל נושאי הקורס
   ========================================================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const DAY = 86400000;
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const QMAP = Object.fromEntries(Q.map(q => [q.id, q]));
const FMAP = Object.fromEntries(FACTS.map(f => [f.id, f]));
const DEPTH_NAME = { 1: 'בסיסי', 2: 'יישומי', 3: 'ועדה' };
/* נושא פעיל: 'all' או אות נושא (A–K) */
const curTopic = () => (typeof S !== 'undefined' && S.settings && S.settings.topic) || 'all';
const inCur = c => curTopic() === 'all' || compTopic(c) === curTopic();
const topicName = t => t === 'all' ? 'כל נושאי הקורס' : (TOPICS[t]?.name || t);
const topicIdx = c => TOPIC_ORDER.indexOf(compTopic(c));
const activeComps = () => Object.keys(COMPS).filter(inCur).sort((a, b) => topicIdx(a) - topicIdx(b));
const activeQ = () => Q.filter(q => inCur(q.comp));
const audioTopic = a => a.topic || compTopic(a.comps[0]);
const activeAudio = () => { const l = AUDIO.filter(a => curTopic() === 'all' || audioTopic(a) === curTopic()); return l.length ? l : AUDIO; };
const MODE_NAME = { phone: 'כמה דקות בטלפון', audio: 'אודיו בדרכים', desk: 'מחשב' };

/* ---------------- STATE ---------------- */
const DEF = () => ({ v: 1, updatedAt: 0, events: [], srs: {}, audio: {}, debriefs: [], drafts: {}, profile: null, diag: null,
  settings: { examDate: '', depth: 'auto', rate: 1, consent: false, pressure: 'normal', topic: 'all' } });
let S = DEF();
let LKEY = 'wah_state_v1';   // נקבע לפי מזהה המשתמש אחרי ההתחברות – כדי שמשתמשים במכשיר משותף לא יתערבבו
function loadLocal() { try { const j = JSON.parse(localStorage.getItem(LKEY)); if (j && j.v) return Object.assign(DEF(), j, { settings: Object.assign(DEF().settings, j.settings || {}) }); } catch (e) { } return DEF(); }
function saveLocal() { try { localStorage.setItem(LKEY, JSON.stringify(S)); } catch (e) { } }
function save() { S.updatedAt = Date.now(); saveLocal(); Sync.push(); }

/* ---------------- EVENTS & MASTERY ----------------
   kind: exposure (שמיעה/קריאה – חשיפה בלבד), recognize, explain, apply, committee */
function logEvent(kind, comp, data = {}) {
  S.events.push(Object.assign({ id: uid(), t: Date.now(), kind, comp }, data));
  if (S.events.length > 1800) S.events = S.events.slice(-1800);
}
const LEVELS = [
  { k: 'exposed', n: 'נחשפתי לחומר' },
  { k: 'recognized', n: 'זיהוי נכון' },
  { k: 'explained', n: 'הסברתי בלי עזרה' },
  { k: 'applied', n: 'יישמתי בתרחיש' },
  { k: 'committee', n: 'עמדתי בשאלות ועדה' }
];
/* ראיה "מאומתת" = נבדקה אוטומטית (רב-ברירה/תרחיש/מפגעים) או ע"י בוחן AI.
   הערכה עצמית נספרת רק אם חזרה בהצלחה בשני ימים שונים (מניעת "הטיית בדיעבד"). */
const dayKey = t => new Date(t).toDateString();
const twoDays = arr => new Set(arr.map(e => dayKey(e.t))).size >= 2;
function mastery(comp) {
  const ev = S.events.filter(e => e.comp === comp);
  const rec = ev.filter(e => e.kind === 'recognize');
  const app = ev.filter(e => e.kind === 'apply');
  const good = (k) => ev.filter(e => e.kind === k && e.score >= 0.7 && !e.help);
  const verified = (k) => good(k).filter(e => e.by !== 'self');
  const selfOk = (k) => good(k).filter(e => e.by === 'self');
  const appFull = app.filter(e => e.ok && e.quality !== 'choice');
  const m = {
    exposed: ev.length > 0,
    recognized: rec.filter(e => e.ok).length >= 2 && !!rec[rec.length - 1]?.ok,
    explained: verified('explain').length >= 1 || twoDays(selfOk('explain')),
    applied: app.length > 0 && !!app[app.length - 1].ok && appFull.length >= 1,
    committee: verified('committee').length >= 1 || twoDays(selfOk('committee'))
  };
  const succ = ev.filter(e => e.kind !== 'exposure' && (e.ok || e.score >= 0.7));
  const last = succ.length ? Math.max(...succ.map(e => e.t)) : 0;
  const days = last ? (Date.now() - last) / DAY : 0;
  const ret = !last ? 1 : days <= 14 ? 1 : Math.max(0.6, 1 - (days - 14) / 60);
  const raw = (m.recognized ? 20 : 0) + (m.explained ? 25 : 0) + (m.applied ? 25 : 0) + (m.committee ? 30 : 0);
  const evidence = ev.filter(e => e.kind !== 'exposure').length;
  const exposures = ev.filter(e => e.kind === 'exposure').length;
  const selfOnly = (selfOk('explain').length + selfOk('committee').length) > 0 && !verified('explain').length && !verified('committee').length;
  const comm = ev.filter(e => e.kind === 'committee');
  const cBest = comm.length ? Math.max(...comm.map(e => (e.score || 0) * (e.by === 'self' ? 0.85 : 1))) * 100 : 0;
  return Object.assign(m, { score: Math.round(raw * ret), raw, evidence, exposures, last, days: Math.round(days), ret, selfOnly, cBest });
}
function readiness() {
  const ms = Object.keys(COMPS).map(mastery);
  const avg = ms.reduce((a, m) => a + m.score, 0) / ms.length;
  const cAvg = ms.reduce((a, m) => a + m.cBest, 0) / ms.length;
  // תנאי סף: אי אפשר להציג מוכנות גבוהה בלי ביצועים בשאלות ועדה
  const score = Math.round(Math.min(avg, cAvg + 15));
  const ev = ms.reduce((a, m) => a + m.evidence, 0);
  const kinds = new Set(S.events.filter(e => e.kind !== 'exposure').map(e => e.kind)).size;
  const coverage = ev >= 40 && kinds >= 4 ? 'גבוה' : ev >= 15 && kinds >= 3 ? 'בינוני' : 'נמוך';
  return { score, avg: Math.round(avg), capped: Math.round(avg) > score, evidence: ev, coverage, ms };
}

/* ---------------- SRS (Leitner מותאם לתאריך הוועדה ולביטחון) ---------------- */
const BOX_DAYS = [0, 1, 3, 7, 14, 30];
function daysToExam() { return S.settings.examDate ? Math.ceil((new Date(S.settings.examDate) - Date.now()) / DAY) : null; }
function srsAnswer(qid, ok, conf) {
  const r = S.srs[qid] || { box: 0, due: 0, n: 0, wrong: 0 };
  r.n++; r.last = Date.now(); r.lastOk = ok; r.hyper = false;
  if (ok && conf === 'guess') r.box = 1;                 // ניחוש מוצלח אינו ידע – חזרה מחר
  else if (ok) r.box = Math.min(5, r.box + 1);
  else { r.box = 1; r.wrong++; if (conf === 'sure') r.hyper = true; } // בטוח וטעה – עדיפות עליונה
  let days = BOX_DAYS[r.box] * (ok ? 1 : 0.15);
  const dte = daysToExam();
  if (dte != null && dte > 0) days = Math.min(days, Math.max(1, Math.floor(dte / 3)));
  r.due = Date.now() + days * DAY;
  S.srs[qid] = r;
}
const isDue = qid => S.srs[qid] && S.srs[qid].due <= Date.now();

/* ---------------- ADAPTIVE RECOMMENDER ---------------- */
function weakComps() {
  return activeComps().map(c => ({ c, m: mastery(c) })).sort((a, b) => a.m.score - b.m.score || a.m.evidence - b.m.evidence || topicIdx(a.c) - topicIdx(b.c));
}
function autoDepth(comp) {
  const m = mastery(comp);
  const exp = S.profile && /יותר מ-3/.test(S.profile.bg || '');
  const dte = daysToExam();
  if (!m.recognized) return exp && !m.evidence ? 2 : 1;
  if (dte != null && dte <= 14 && m.applied) return 3;
  if (!m.applied || !m.explained) return 2;
  return 3;
}
function audioNotPracticed() {
  // שיעורי אודיו שנשמעו, שהיעדים שלהם עדיין בלי תרגול אחרי ההאזנה
  const out = [];
  for (const a of activeAudio()) {
    const st = S.audio[a.id]; if (!st || !st.doneAt) continue;
    const practiced = a.comps.every(c => S.events.some(e => e.comp === c && e.kind !== 'exposure' && e.t > st.doneAt));
    if (!practiced) out.push(a);
  }
  return out;
}
function recentFailures() {
  const out = [];
  for (const c of activeComps()) {
    const ev = S.events.filter(e => e.comp === c && e.kind !== 'exposure');
    const lastFail = [...ev].reverse().find(e => e.ok === false || (e.score != null && e.score < 0.6));
    if (!lastFail || Date.now() - lastFail.t > 5 * DAY) continue;
    const laterOk = ev.some(e => e.t > lastFail.t && (e.ok || e.score >= 0.7));
    const fails = ev.filter(e => e.ok === false || (e.score != null && e.score < 0.6)).length;
    if (!laterOk) out.push({ c, fails, t: lastFail.t });
  }
  return out.sort((a, b) => b.fails - a.fails);
}
function recommend(mode = 'phone', minutes = 5) {
  const dueQs = activeQ().filter(q => isDue(q.id));
  if (mode === 'audio') {
    const AL = activeAudio();
    const inProg = AL.find(a => S.audio[a.id] && !S.audio[a.id].doneAt && S.audio[a.id].seg > 0);
    if (inProg) return { mode, lesson: inProg.id, depth: inProg.depth, reason: `בחרתי להמשיך את "${inProg.title}" מהמקום שבו עצרת.` };
    const w = weakComps()[0].c;
    const next = AL.find(a => !S.audio[a.id]?.doneAt && a.comps.includes(w)) || AL.find(a => !S.audio[a.id]?.doneAt && audioTopic(a) === compTopic(w)) || AL.find(a => !S.audio[a.id]?.doneAt) || AL[AL.length - 1];
    return { mode, lesson: next.id, depth: next.depth, reason: `בחרתי את השיעור הזה כי הוא מכסה את "${COMPS[w]}", שבו מדד השליטה שלך הכי נמוך כרגע.` };
  }
  const heard = audioNotPracticed();
  if (heard.length) {
    const a = heard[0];
    return { mode, depth: Math.max(1, a.depth), comps: a.comps, reason: `שמעת בדרך את "${a.title}". עכשיו נתרגל את החומר, כי האזנה נחשבת חשיפה בלבד ולא שליטה.` };
  }
  const fails = recentFailures();
  if (fails.length) {
    const f = fails[0];
    return { mode, depth: autoDepth(f.c) === 3 ? 2 : autoDepth(f.c), comps: [f.c], reason: `בחרתי בזה כי טעית ${f.fails > 1 ? f.fails + ' פעמים' : 'לאחרונה'} בנושא "${COMPS[f.c]}" ועדיין לא הצלחת בו מאז.` };
  }
  if (dueQs.length >= 2) {
    return { mode, depth: 1, comps: [...new Set(dueQs.map(q => q.comp))], due: true, reason: `הגיע מועד החזרה המרווחת ל-${dueQs.length} שאלות. חזרה בזמן הזה מחזקת את הזיכרון לטווח ארוך.` };
  }
  const w = weakComps()[0];
  const d = autoDepth(w.c);
  return { mode, depth: d, comps: [w.c], reason: w.m.evidence === 0 ? `עוד לא תרגלת את "${COMPS[w.c]}", אז נתחיל ברמה ${DEPTH_NAME[d]}.` : `"${COMPS[w.c]}" הוא היעד החלש ביותר שלך כרגע (${w.m.score}/100), ולכן בחרתי רמה ${DEPTH_NAME[d]}.` };
}

/* ---------------- CAPABILITIES (AI, voice, sync) ---------------- */
const Cap = { sample: null, tts: null, dict: null, aiTried: false, aiOk: true };
/* ----- גישה: נדרש חשבון Claude מחובר עם הרשאת כתיבה לאזור האישי ----- */
const Account = { state: 'checking', reason: '' };
async function initCaps() {
  if (!window.claude || !window.claude.use) return blockAccess('no-claude');
  claude.use('sample').then(s => { Cap.sample = s; rerenderSoft(); }).catch(() => { });
  claude.use('tts').then(t => { Cap.tts = t; }).catch(() => { });
  claude.use('dictation').then(d => { Cap.dict = d; rerenderSoft(); }).catch(() => { });
  let res = 'signed-out';
  try { res = await Sync.init(); } catch (e) { res = 'signed-out'; }
  if (res === 'signed-out' || res === 'view-only') return blockAccess(res);
  Account.state = 'ok'; route();
}
function blockAccess(reason) { Account.state = 'blocked'; Account.reason = reason; Sync.set('לא מחובר'); route(); }
const aiAvailable = () => !!Cap.sample && Cap.aiOk && navigator.onLine !== false;

/* ----- Sync between devices (db per-user doc) ----- */
const Sync = {
  db: null, ref: null, timer: null, writing: false, dirty: false, label: 'מתחבר לחשבון…', uid: null,
  set(l) { this.label = l; const el = $('#sync'); if (el) el.textContent = l; },
  async init() {
    const [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
    if (!db || !user) return 'signed-out';
    const id = await user.id();
    if (!id) return 'signed-out';
    this.uid = id;
    LKEY = 'wah_state_v1_' + id;
    S = loadLocal();
    // העברת נתונים מגרסה קודמת (לפני חשבונות) – רק לבעל האפליקציה
    try { const old = localStorage.getItem('wah_state_v1'); if (old && !S.events.length && user.isOwner && user.isOwner()) { S = Object.assign(DEF(), JSON.parse(old)); saveLocal(); } } catch (e) { }
    this.ref = db.collection('data/users/' + id).doc('state');
    const first = await new Promise(resolve => {
      let done = false;
      const to = setTimeout(() => { if (!done) { done = true; resolve('timeout'); } }, 10000);
      this.ref.onSnapshot(snap => {
        if (snap.exists) { const remote = snap.data(); if (mergeRemote(remote)) { saveLocal(); if (Account.state === 'ok') rerenderSoft(); } if (done && S.updatedAt > (remote.updatedAt || 0)) this.push(); }
        if (!done && !snap.metadata.fromCache) { done = true; clearTimeout(to); resolve('ok'); }
        if (Account.state === 'ok') this.set('מסונכרן בין המכשירים');
      }, () => { if (!done) { done = true; clearTimeout(to); resolve('error'); } this.set('שמירה במכשיר בלבד'); this.ref = null; });
    });
    if (first === 'timeout') { this.set('לא מקוון – נשמר במכשיר, יסונכרן בהמשך'); return 'ok'; }
    if (first === 'error') return 'signed-out';
    // בדיקת הרשאת כתיבה לאזור האישי (צופה בלבד אינו יכול לשמור התקדמות)
    try { S.updatedAt = Date.now(); await this.ref.set(JSON.parse(JSON.stringify(S))); saveLocal(); this.set('מסונכרן בין המכשירים'); }
    catch (e) { if (e && (e.code === 'invalid_argument' || e.code === 'not_granted')) return 'view-only'; this.set('שמירה במכשיר בלבד'); }
    return 'ok';
  },
  push() {
    if (!this.ref) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.write(), 1500);
  },
  async write() {
    if (!this.ref) return;
    if (this.writing) { this.dirty = true; return; }
    this.writing = true; this.set('שומר…');
    try { await this.ref.set(JSON.parse(JSON.stringify(S))); this.set('מסונכרן בין המכשירים'); }
    catch (e) { this.set(e && e.code === 'quota_exceeded' ? 'נפח הסנכרון מלא' : 'שמירה במכשיר בלבד'); }
    this.writing = false;
    if (this.dirty) { this.dirty = false; this.write(); }
  }
};
function mergeRemote(r) {
  if (!r || !r.v) return false;
  let changed = false;
  const ids = new Set(S.events.map(e => e.id));
  for (const e of r.events || []) if (!ids.has(e.id)) { S.events.push(e); changed = true; }
  if (changed) S.events.sort((a, b) => a.t - b.t);
  for (const [k, v] of Object.entries(r.srs || {})) if (!S.srs[k] || (v.last || 0) > (S.srs[k].last || 0)) { S.srs[k] = v; changed = true; }
  for (const [k, v] of Object.entries(r.audio || {})) {
    const l = S.audio[k];
    if (!l || (v.at || 0) > (l.at || 0)) { S.audio[k] = v; changed = true; }
  }
  const dIds = new Set(S.debriefs.map(d => d.id));
  for (const d of r.debriefs || []) if (!dIds.has(d.id)) { S.debriefs.push(d); changed = true; }
  if ((r.updatedAt || 0) > S.updatedAt && r.settings) { S.settings = Object.assign(S.settings, r.settings); changed = true; }
  if (r.profile && (!S.profile || (r.profile.at || 0) > (S.profile.at || 0))) { S.profile = r.profile; changed = true; }
  if (r.diag && (!S.diag || (r.diag.t || 0) > (S.diag.t || 0))) { S.diag = r.diag; changed = true; }
  return changed;
}

/* ----- Speech out ----- */
const Voice = {
  heVoice: null, lastErr: '', lastEngine: '',
  pickVoice() {
    try {
      const vs = speechSynthesis.getVoices().filter(v => /^(he|iw)/i.test(v.lang));
      const score = v => (/natural|online|neural/i.test(v.name) ? 3 : 0) + (/google|microsoft|siri|carmit/i.test(v.name) ? 1 : 0) + (v.localService ? 0 : 1);
      this.heVoice = vs.sort((a, b) => score(b) - score(a))[0] || null;
    } catch (e) { }
  },
  mode() { if (Cap.tts) return 'claude'; if ('speechSynthesis' in window && this.heVoice) return 'browser'; if ('speechSynthesis' in window) return 'browser-nohe'; return 'none'; },
  speaking: false,
  browserSpeak(text, rate) {
    if (!('speechSynthesis' in window)) { this.lastErr = 'no-speechSynthesis'; return Promise.resolve(false); }
    return new Promise(res => {
      let done = false; const fin = ok => { if (!done) { done = true; clearTimeout(wd); res(ok); } };
      // שומר: אם הדפדפן "בולע" את ההקראה בלי אירועים – לא נתקעים
      const wd = setTimeout(() => { this.lastErr = 'browser-timeout'; fin(false); }, Math.max(8000, text.length * 150 / (rate || 1)));
      try {
        try { speechSynthesis.resume(); } catch (e) { }
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'he-IL'; if (this.heVoice) u.voice = this.heVoice; u.rate = rate;
        let started = false;
        u.onstart = () => { started = true; };
        u.onend = () => { this.lastEngine = 'browser:' + (this.heVoice ? this.heVoice.name : 'default'); fin(started || true); };
        u.onerror = (ev) => { this.lastErr = 'browser:' + (ev && ev.error || 'error'); fin(false); };
        this.speaking = true; speechSynthesis.speak(u);
      } catch (e) { this.lastErr = 'browser-exception'; fin(false); }
    }).finally(() => { this.speaking = false; });
  },
  async speak(text, opts = {}) {
    const rate = opts.rate || S.settings.rate || 1;
    this.lastErr = '';
    if (Cap.tts) {
      const o = { voice: opts.voice || 'buttery', rate: Math.min(1.5, Math.max(0.7, rate)) };
      for (const withLang of [true, false]) {
        try { this.speaking = true; await Cap.tts.speak(text, withLang ? Object.assign({ language: 'he' }, o) : o); this.lastEngine = 'claude'; return true; }
        catch (e) {
          const code = e && e.code || 'error'; this.lastErr = 'claude:' + code;
          if (code === 'not_granted') { Cap.tts = null; break; }
          if (code === 'busy' || code === 'rate_limited') { await new Promise(r => setTimeout(r, 1200)); continue; }
          if (code === 'viewer_stopped' || code === 'stopped') return false;
          if (withLang) continue;   // ננסה שוב בלי פרמטר שפה
        }
        finally { this.speaking = false; }
      }
      // קול Claude נכשל – עוברים לקול הדפדפן במקום שתיקה
    }
    return this.browserSpeak(text, rate);
  },
  aud: null,
  silentSrc() {
    // WAV שקט קצר – לפתיחת השמע במגע הראשון (נדרש באייפון)
    const n = 800, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf); const w = (o, str) => [...str].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    let b = ''; new Uint8Array(buf).forEach(x => b += String.fromCharCode(x)); return 'data:audio/wav;base64,' + btoa(b);
  },
  unlock() {
    try { if (!this.aud) { this.aud = new Audio(); this.aud.preload = 'auto'; } if (!this._unlocked) { this.aud.src = this.silentSrc(); const p = this.aud.play(); if (p && p.then) p.then(() => { this._unlocked = true; }).catch(() => { }); } } catch (e) { }
  },
  playClip(b64, rate) {
    return new Promise(res => {
      try {
        if (!this.aud) this.aud = new Audio();
        const a = this.aud; let done = false; const fin = ok => { if (!done) { done = true; a.onended = a.onerror = null; this.speaking = false; res(ok); } };
        a.onended = () => { this.lastEngine = 'natural'; fin(true); }; a.onerror = () => { this.lastErr = 'clip-error'; fin(false); };
        a.src = 'data:audio/mpeg;base64,' + b64; a.playbackRate = rate || 1; try { a.preservesPitch = true; } catch (e) { }
        this.speaking = true; const p = a.play(); if (p && p.catch) p.catch(e => { this.lastErr = 'clip-blocked:' + (e && e.name); fin(false); });
      } catch (e) { res(false); }
    });
  },
  stop() { try { Cap.tts && Cap.tts.stop(); } catch (e) { } try { speechSynthesis.cancel(); } catch (e) { } try { this.aud && this.aud.pause(); } catch (e) { } this.speaking = false; },
  pause() { try { Cap.tts ? Cap.tts.pause() : speechSynthesis.pause(); } catch (e) { } },
  resume() { try { Cap.tts ? Cap.tts.resume() : speechSynthesis.resume(); } catch (e) { } },
  advice() {
    const ua = navigator.userAgent || '';
    const m = this.mode();
    if (m === 'claude') return '';
    if (m === 'none') return 'בחלון הזה אין מנוע הקראה. באפליקציית Claude לטלפון ההקראה לא זמינה לדפים כאלה. פתח את האתר safety-committee-coach.web.app בדפדפן (Chrome באנדרואיד, Safari באייפון) או במחשב.';
    if (m === 'browser-nohe') return /Android/i.test(ua) ? 'לא נמצא קול עברי במכשיר. התקן: הגדרות ← מערכת ← שפות וקלט ← פלט טקסט לדיבור ← מנוע Google ← התקן נתוני קול ← עברית.' : /iPhone|iPad|Mac/i.test(ua) ? 'לא נמצא קול עברי. בהגדרות ← נגישות ← תוכן מוקרא ← קולות ← עברית, הורד קול (למשל Carmit).' : 'לא נמצא קול עברי בדפדפן. בדפדפן Edge יש קולות עבריים טבעיים (Hila / Avri). ב-Windows אפשר גם להוסיף "עברית" בהגדרות ← שפה ← דיבור.';
    return '';
  }
};
try { speechSynthesis.onvoiceschanged = () => Voice.pickVoice(); Voice.pickVoice(); } catch (e) { }
document.addEventListener('click', () => Voice.unlock(), { capture: true });
document.addEventListener('touchend', () => Voice.unlock(), { capture: true });
const hashText = t => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const LINE_VOICE = { n: 'Kore', q: 'Kore', e: 'Charon', c: 'Puck' };
const clipCache = {};
async function lessonClips(id) {
  if (clipCache[id]) return clipCache[id];
  if (!window.__audioStore) return {};
  try { const r = await Promise.race([window.__audioStore.lesson(id), new Promise((_, rej) => setTimeout(() => rej('timeout'), 6000))]); clipCache[id] = r; return r; } catch (e) { return {}; }
}

/* ----- Speech in (dictation) ----- */
function micButton(targetSel) {
  if (!Cap.dict) return `<span class="small muted">הכתבה קולית זמינה בדפדפן Chrome ובאפליקציית Claude למחשב. כאן אפשר להקליד.</span>`;
  return `<button class="btn sm mic" data-mic="${targetSel}" aria-pressed="false">🎙️ ענה בקול</button>`;
}
function wireMic(root) {
  $$('[data-mic]', root).forEach(b => {
    b.onclick = () => {
      const ta = $(b.dataset.mic);
      if (!Cap.dict || !ta) return;
      if (b.classList.contains('on')) { Cap.dict.stop().catch(() => { }); return; }
      const base = ta.value ? ta.value.trimEnd() + ' ' : '';
      let acc = base;
      Cap.dict.onPartial(({ text }) => { ta.value = acc + text; });
      Cap.dict.onFinal(({ text }) => { acc += text + ' '; ta.value = acc; ta.dispatchEvent(new Event('input')); });
      Cap.dict.onState(({ state }) => { const on = state === 'listening'; b.classList.toggle('on', on); b.textContent = on ? '⏹ עצור הקלטה' : '🎙️ ענה בקול'; });
      Cap.dict.start().catch(e => { if (e && e.code === 'not_granted') { Cap.dict = null; b.replaceWith(document.createTextNode('ההכתבה לא אושרה. אפשר להקליד.')); } });
    };
  });
}

/* ----- AI evaluation ----- */
const RUBRIC = ['דיוק עובדתי/משפטי', 'שלמות', 'הבנת העיקרון', 'יישום', 'הנמקה', 'סדר התשובה', 'בהירות ביטוי'];
async function aiEvaluate(q, answer, history = []) {
  if (!aiAvailable()) return null;
  const facts = FACTS.filter(f => q.src.some(s => f.src.includes(s)) || f.comp === q.comp).map(f => `- [${KIND_LABEL[f.kind]}] ${f.text}`).join('\n');
  const prompt = `אתה בוחן מקצועי ומדויק בוועדת הסמכה לממוני בטיחות בישראל. הערך תשובה בעל פה של מועמד. כתוב בעברית.
כללים: אל תיתן ניקוד רק על הופעת מילות מפתח; בדוק הבנה, נימוק ויישום. אם המועמד אומר דבר שגוי משפטית או מקצועית – רשום זאת ב-errors והורד דיוק. אל תמציא סעיפי חוק; הסתמך רק על המידע המקצועי שלהלן ועל ידע מקצועי מקובל, וסמן אי-ודאות. זו הערכה לימודית, לא ציון רשמי.

השאלה: ${q.q}
${history.length ? 'הקשר קודם בשיחה:\n' + history.map(h => `${h.role === 'e' ? 'בוחן' : 'מועמד'}: ${h.text}`).join('\n') + '\n' : ''}
${(q.traps || []).length ? 'מלכודות ועדה – אם המועמד נפל באחת מהן, רשום אותה ב-errors:\n' + q.traps.map(t => '- ' + t).join('\n') + '\n' : ''}נקודות שתשובה חזקה צריכה לכסות (אינדקס: נקודה):
${q.points.map((p, i) => `${i}: ${p.t}`).join('\n')}

מידע מקצועי עם מקורות:
${facts}

תשובת המועמד:
"""${answer}"""

החזר JSON בלבד במבנה:
{"covered":[אינדקסים של נקודות שכוסו באמת, לא רק הוזכרו],"partial":[אינדקסים שכוסו חלקית],"criteria":{"דיוק עובדתי/משפטי":0-4,"שלמות":0-4,"הבנת העיקרון":0-4,"יישום":0-4,"הנמקה":0-4,"סדר התשובה":0-4,"בהירות ביטוי":0-4},"errors":["טעויות מהותיות"],"strengths":["חוזקות"],"feedback":"משוב של 2-4 משפטים, ענייני ומכבד","followup":"שאלת המשך אחת שבוחן היה שואל בעקבות הפערים בתשובה"}`;
  try {
    const r = await Cap.sample.json(prompt, { modelTier: 'default' });
    if (!r || typeof r !== 'object') return null;
    return normalizeEval(q, r, 'ai');
  } catch (e) {
    if (e && e.code === 'not_granted') { Cap.sample = null; }
    else if (e && e.code === 'rate_limited') { Cap.aiOk = false; setTimeout(() => Cap.aiOk = true, 60000); toast('הגעת למגבלת השימוש של מפתח ה-AI. ההערכה תיעשה מול מחוון.'); }
    else if (e && e.code === 'bad_key') toast('מפתח ה-AI לא תקין. בדוק אותו בהגדרות.');
    return null;
  }
}
function normalizeEval(q, r, by) {
  const tot = q.points.reduce((a, p) => a + p.w, 0);
  const cov = new Set((r.covered || []).map(Number));
  const par = new Set((r.partial || []).map(Number).filter(i => !cov.has(i)));
  const pts = q.points.reduce((a, p, i) => a + (cov.has(i) ? p.w : par.has(i) ? p.w / 2 : 0), 0) / tot;
  const cr = r.criteria || {};
  const crVals = RUBRIC.map(k => Number(cr[k])).filter(n => !isNaN(n));
  const crAvg = crVals.length ? crVals.reduce((a, b) => a + b, 0) / crVals.length / 4 : pts;
  let score = by === 'ai' ? 0.6 * pts + 0.4 * crAvg : pts;
  const errors = (r.errors || []).filter(Boolean);
  if (errors.length) score = Math.min(score, 0.65);
  return { by, score: Math.round(score * 100) / 100, covered: [...cov], partial: [...par], criteria: cr, errors, strengths: r.strengths || [], feedback: r.feedback || '', followup: r.followup || '' };
}

/* ---------------- ROUTER & SHELL ---------------- */
const ICON = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  quick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/></svg>',
  audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/></svg>',
  desk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  sim: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="6" cy="8" r="2.5"/><circle cx="12" cy="7" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M2 18c1-3 3-4 4-4s2 .5 3 1M22 18c-1-3-3-4-4-4s-2 .5-3 1M8 19c.7-2.5 2.3-4 4-4s3.3 1.5 4 4"/></svg>',
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  bank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/></svg>',
  report: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h7M9 8h4"/></svg>'
};
const NAV = [
  ['home', 'בית', 'home'], ['quick', 'כמה דקות', 'quick'], ['audio', 'אודיו', 'audio'], ['desk', 'מחשב', 'desk'], ['sim', 'סימולטור ועדה', 'sim'],
  ['report', 'דוח התקדמות', 'report'], ['project', 'פרויקט הגמר', 'book'], ['map', 'מפת שליטה', 'map'], ['plan', 'תוכנית לימודים', 'plan'], ['bank', 'בנק שאלות', 'bank'], ['debriefs', 'תחקירים', 'report'], ['sources', 'ספריית מקורות', 'book'], ['settings', 'הגדרות', 'gear']
];
const BOTTOM = [['home', 'בית', 'home'], ['quick', 'דקות', 'quick'], ['audio', 'אודיו', 'audio'], ['sim', 'ועדה', 'sim'], ['more', 'עוד', 'more']];
let current = { route: 'home', cleanup: null };
function shell() {
  document.body.innerHTML = `
  <header class="top"><div class="wrap"><div class="brand"><svg class="logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="112" fill="#0f6e6a"/><path d="M256 64 L410 120 V252 C410 350 340 418 256 450 C172 418 102 350 102 252 V120 Z" fill="none" stroke="#fff" stroke-width="20" stroke-linejoin="round"/><path d="M184 200 C184 156 216 128 256 128 C296 128 328 156 328 200 Z" fill="#f5b72e"/><rect x="168" y="196" width="176" height="18" rx="9" fill="#f5b72e"/><path d="M159.18 336L140.58 336L140.64 270.16L170.06 270.16Q182.91 270.16 189.58 276.47Q196.25 282.79 196.31 295.04L196.31 336L177.77 336L177.71 293.45Q177.71 289.08 175.75 286.84Q173.78 284.59 170.06 284.59L159.18 284.59L159.18 336M217.31 289.35L206.10 285.03Q208.67 281.42 210.28 276.69Q211.89 271.96 211.89 267.91L211.89 256.43L228.41 256.43L228.36 266.16Q228.36 270.27 226.93 274.61Q225.51 278.96 223.02 282.79Q220.54 286.62 217.31 289.35M241.97 289.35L230.76 285.03Q233.39 281.42 234.97 276.69Q236.56 271.96 236.56 267.91L236.56 256.43L253.18 256.43L253.07 266.16Q253.07 270.27 251.63 274.61Q250.18 278.96 247.69 282.79Q245.20 286.62 241.97 289.35M317.33 336L260.24 336L260.24 321.56L291.14 321.56L291.14 293.29Q291.14 288.97 288.81 286.78Q286.49 284.59 281.84 284.59L263.79 284.59L263.79 270.16L283.21 270.16Q295.73 270.16 302.73 276.47Q309.73 282.79 309.73 294.16L309.73 320.96L317.33 322.16L317.33 336M378.69 336L321.60 336L321.60 321.56L352.50 321.56L352.50 293.29Q352.50 288.97 350.17 286.78Q347.85 284.59 343.20 284.59L325.15 284.59L325.15 270.16L344.57 270.16Q357.09 270.16 364.09 276.47Q371.09 282.79 371.09 294.16L371.09 320.96L378.69 322.16" fill="#fff"/></svg><span>בב״ח</span></div><span class="small muted">בוב בטיחות חניכים · הכנה לוועדת הסמכה</span><span class="sync" id="sync">${esc(Sync.label)}</span></div></header>
  <div class="wrap layout"><nav class="side" aria-label="ניווט">${NAV.map(([r, l, i]) => `<a href="#${r}" data-r="${r}">${ICON[i]}<span>${l}</span></a>`).join('')}</nav><main id="main" tabindex="-1"></main></div>
  <nav class="bottom" aria-label="ניווט תחתון">${BOTTOM.map(([r, l, i]) => `<a href="#${r}" data-r="${r}">${ICON[i]}<span>${l}</span></a>`).join('')}</nav>`;
}
function go(r) { if (location.hash !== '#' + r) location.hash = r; else route(); }
function route() {
  const r = (location.hash || '#home').slice(1) || 'home';
  if (current.cleanup) { try { current.cleanup(); } catch (e) { } current.cleanup = null; }
  current.route = r;
  $$('nav a').forEach(a => a.classList.toggle('on', a.dataset.r === r || (r === 'lesson' || r === 'scenario') && a.dataset.r === 'desk'));
  const main = $('#main');
  let fn = VIEWS[r] || VIEWS.home;
  if (Account.state !== 'ok') fn = VIEWS.gate;
  else if (!S.profile && r !== 'welcome') { fn = VIEWS.welcome; current.route = 'welcome'; }
  main.innerHTML = '';
  fn(main);
  window.scrollTo(0, 0);
  const h = main.querySelector('h1'); if (h) { h.setAttribute('tabindex', '-1'); try { h.focus({ preventScroll: true }); } catch (e) { } }
}
function rerenderSoft() { const r = current.route; if (['home', 'map', 'debriefs', 'plan', 'report'].includes(r)) route(); }
function toast(msg) { let live = $('#live'); if (!live) { live = document.createElement('div'); live.id = 'live'; live.className = 'toast hide'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite'); document.body.appendChild(live); } live.textContent = msg; live.classList.remove('hide'); clearTimeout(live._t); live._t = setTimeout(() => live.classList.add('hide'), 4000); }
function srcTags(ids) { return (ids || []).map(id => `<a class="tag" href="#sources" title="${esc(SOURCES[id]?.title)}">${id}</a>`).join(''); }
function factStatus(f) {
  if (f.ver) return f.ver;
  const sts = f.src.map(s => SOURCES[s]?.status);
  return sts.includes('course') ? 'course' : sts.includes('partial') ? 'partial' : sts.every(x => x === 'verified') ? 'verified' : 'practice';
}
function factHtml(f) {
  const st = factStatus(f);
  const badge = st === 'verified' ? `<span class="small" style="color:var(--ok,#1b7f4b)">✓ ${STATUS_LABEL.verified} (${CHECKED.split('-').reverse().join('.')})</span>`
    : st === 'partial' ? `<span class="small muted">◐ ${STATUS_LABEL.partial} – חלק מהפרטים מבוססים על פרסום משני או על חומר הקורס</span>`
    : st === 'course' ? `<span class="small muted">⚠︎ ${STATUS_LABEL.course}</span>` : '';
  return `<div class="card" style="padding:12px;margin:8px 0"><span class="tag ${f.kind === 'law' ? 'law' : f.kind === 'course' ? 'course' : ''}">${KIND_LABEL[f.kind]}</span>${srcTags(f.src)}<p style="margin-top:6px">${esc(f.text)}</p>${badge}</div>`;
}

/* ---------------- QUESTION RENDERERS ---------------- */
/* ctx: {src:'phone'|'desk'|'audio', onDone(result)} */
function allWhyHtml(opts) {
  return `<details style="margin-top:8px"><summary class="small">למה כל תשובה נכונה או שגויה?</summary><ul class="small">${opts.map(o => `<li>${o.ok ? '✅' : '✖'} <b>${esc(o.t)}</b> – ${esc(o.why)}</li>`).join('')}</ul></details>`;
}
async function aiCheckReasoning(q, choice, reasoning) {
  if (!aiAvailable()) return null;
  try {
    const r = await Cap.sample.json(`אתה בוחן ממוני בטיחות. מועמד בחר בהחלטה הנכונה בתרחיש ונימק אותה. בדוק אם הנימוק נכון מקצועית ומבוסס על העיקרון הנכון (לא רק חוזר על התשובה). כתוב בעברית.
תרחיש: ${q.q}
ההחלטה: ${choice.t}
העיקרון הנכון: ${choice.why}
נימוק המועמד: """${reasoning}"""
החזר JSON בלבד: {"verdict":"full"|"partial"|"wrong","note":"משפט אחד של משוב"}`, { modelTier: 'quick' });
    return r && r.verdict ? r : null;
  } catch (e) { return null; }
}
function renderMCQ(el, q, ctx) {
  const opts = shuffle(q.options);
  const isScen = q.type === 'scenario';
  el.innerHTML = `<div class="small muted">${isScen ? 'תרחיש החלטה' : 'שאלת ידע'} · ${esc(COMPS[q.comp])} · <span class="tag ai" title="${ORIGIN}">מקורית</span></div>
  <h3 style="margin-top:6px" tabindex="-1">${esc(q.q)}</h3>
  <div class="opts" role="group" aria-label="אפשרויות תשובה">${opts.map((o, i) => `<button class="opt" data-i="${i}">${esc(o.t)}</button>`).join('')}</div>
  ${isScen ? `<div class="reasonbox hide"><label class="small" for="rs_${q.id}">נמק במשפט אחד: על איזה עיקרון או דרישה ההחלטה שלך נשענת?</label><textarea id="rs_${q.id}" style="min-height:70px" placeholder="הנימוק שלך…"></textarea><div class="row" style="margin-top:6px"><button class="btn primary sm" data-check>בדוק</button></div></div>` : ''}
  <div class="out" aria-live="polite"></div>`;
  let chosen = null;
  const finish = (ok, extra = {}) => {
    const kind = isScen ? 'apply' : 'recognize';
    logEvent(kind, q.comp, Object.assign({ ok, qid: q.id, src: ctx.src }, extra));
    srsAnswer(q.id, ok, ctx.conf); save();
    const out = $('.out', el);
    out.insertAdjacentHTML('beforeend', `<button class="btn primary" data-next>המשך</button>`);
    $('[data-next]', out).onclick = () => ctx.onDone({ ok, choice: opts[chosen].t });
    $('[data-next]', out).focus();
  };
  const reveal = async () => {
    const ok = !!opts[chosen].ok;
    const reasoning = ($('.reasonbox textarea', el)?.value || '').trim();
    $$('.opt', el).forEach((b, i) => { b.disabled = true; if (opts[i].ok) b.classList.add('ok'); else if (i === chosen) b.classList.add('no'); if (i === chosen || opts[i].ok) b.insertAdjacentHTML('beforeend', `<span class="why">${esc(opts[i].why)}</span>`); });
    const ck = $('[data-check]', el); if (ck) ck.disabled = true;
    const out = $('.out', el);
    out.innerHTML = `<div class="fb ${ok ? 'ok' : 'no'}">${ok ? 'ההחלטה נכונה.' : 'לא מדויק. עבור על ההסבר שליד התשובה הנכונה.'}${q.pitfall ? `<br><span class="small">טעות שכיחה: ${esc(q.pitfall)}</span>` : ''}<div class="small" style="margin-top:4px">מקור: ${srcTags(q.src)}</div></div>${allWhyHtml(opts)}`;
    if (!isScen || !ok) return finish(ok, { reasoning: reasoning.slice(0, 300) || undefined, quality: isScen ? 'choice' : undefined });
    // תרחיש עם החלטה נכונה – בודקים גם את הנימוק
    const right = opts[chosen];
    out.insertAdjacentHTML('beforeend', `<div class="fb info" id="rchk">${aiAvailable() ? 'הבוחן בודק את הנימוק שלך…' : ''}</div>`);
    const ai = await aiCheckReasoning(q, right, reasoning);
    const box = $('#rchk', el);
    if (ai) {
      box.className = 'fb ' + (ai.verdict === 'full' ? 'ok' : ai.verdict === 'partial' ? 'warn' : 'no');
      box.innerHTML = `<b>הנימוק: ${ai.verdict === 'full' ? 'מלא ונכון' : ai.verdict === 'partial' ? 'חלקי' : 'שגוי'}</b> – ${esc(ai.note || '')}`;
      return finish(ai.verdict === 'full', { reasoning: reasoning.slice(0, 300), quality: ai.verdict === 'full' ? 'full' : 'choice', by: 'ai' });
    }
    box.innerHTML = `<b>בדיקה עצמית של הנימוק.</b> העיקרון הנכון: ${esc(right.why)}<br>הנימוק שכתבת: "${esc(reasoning || '—')}"<br>האם הנימוק שלך כלל את העיקרון הזה?
      <div class="row" style="margin-top:6px"><button class="btn sm" data-rq="full">כן</button><button class="btn sm" data-rq="partial">חלקית</button><button class="btn sm" data-rq="no">לא</button></div>`;
    $$('[data-rq]', box).forEach(b => b.onclick = () => {
      $$('[data-rq]', box).forEach(x => x.disabled = true);
      const v = b.dataset.rq;
      finish(v === 'full', { reasoning: reasoning.slice(0, 300), quality: v === 'full' ? 'full' : 'choice', by: 'self' });
    });
  };
  $$('.opt', el).forEach(b => b.onclick = () => {
    chosen = +b.dataset.i;
    if (isScen) { $$('.opt', el).forEach(x => { x.style.outline = ''; x.setAttribute('aria-pressed', 'false'); }); b.style.outline = '2px solid var(--accent)'; b.setAttribute('aria-pressed', 'true'); $('.reasonbox', el).classList.remove('hide'); $('.reasonbox textarea', el).focus(); }
    else reveal();
  });
  const ck = $('[data-check]', el);
  if (ck) ck.onclick = () => {
    if (chosen == null) return;
    const r = ($('.reasonbox textarea', el).value || '').trim();
    if (r.length < 8) { $('.out', el).innerHTML = '<div class="fb warn">כתוב נימוק קצר לפני הבדיקה. בוועדה, הנימוק חשוב לא פחות מההחלטה.</div>'; $('.reasonbox textarea', el).focus(); return; }
    reveal();
  };
}
function renderTF(el, q, ctx) {
  el.innerHTML = `<div class="small muted">נכון / לא נכון · ${esc(COMPS[q.comp])}</div><h3 style="margin-top:6px">${esc(q.q)}</h3>
  <div class="row"><button class="btn" data-v="1">נכון</button><button class="btn" data-v="0">לא נכון</button></div><div class="out"></div>`;
  $$('[data-v]', el).forEach(b => b.onclick = () => {
    const ok = (b.dataset.v === '1') === q.answer;
    $$('[data-v]', el).forEach(x => x.disabled = true);
    $('.out', el).innerHTML = `<div class="fb ${ok ? 'ok' : 'no'}">${esc(q.explain)}<div class="small">מקור: ${srcTags(q.src)}</div></div><button class="btn primary" data-next>המשך</button>`;
    logEvent('recognize', q.comp, { ok, qid: q.id, src: ctx.src }); srsAnswer(q.id, ok); save();
    $('[data-next]', el).onclick = () => ctx.onDone({ ok });
  });
}
function detectPoint(p, ans) { return !p.kw || p.kw.some(k => ans.includes(k)); }
function renderOpen(el, q, ctx) {
  const id = 'ta_' + q.id + '_' + uid();
  let helped = false, t0 = Date.now(), tFirst = null, method = 'typed';
  el.innerHTML = `<div class="small muted">שאלה פתוחה בנוסח ועדה · ${esc(COMPS[q.comp])} · <span class="tag ai" title="${ORIGIN}">מקורית – לא מוועדה אמיתית</span></div>
  <h3 style="margin-top:6px" tabindex="-1">${esc(q.q)}</h3>
  <p class="small muted">ענה כמו בוועדה: <b>בקול</b>, עם סדר מחשבה, החלטה ונימוק. נסה להתחיל לדבר תוך 10 שניות. ${Cap.dict ? '' : 'אם אין כאן הכתבה, אמור את התשובה בקול לעצמך ואז הקלד את עיקריה.'}</p>
  <div class="row" style="margin-bottom:8px">${Cap.dict ? micButton('#' + id).replace('btn sm mic', 'btn primary mic') : ''}<span class="timer small muted" data-think aria-live="off"></span></div>
  <textarea id="${id}" aria-label="התשובה שלך" placeholder="${Cap.dict ? 'התמלול יופיע כאן. אפשר גם להקליד.' : 'התשובה שלך…'}">${esc(S.drafts[q.id] || '')}</textarea>
  <div class="row" style="margin-top:8px"><button class="btn primary" data-submit>הגש לקבלת משוב</button><button class="btn ghost sm" data-help>הצג תשובה לדוגמה (ייחשב כעזרה)</button></div>
  <div class="helpbox"></div><div class="out" aria-live="polite"></div>`;
  wireMic(el);
  const ta = $('#' + id, el);
  const think = $('[data-think]', el);
  const tick = setInterval(() => { if (!el.isConnected || tFirst) { clearInterval(tick); return; } const s = Math.floor((Date.now() - t0) / 1000); think.textContent = `זמן עד תחילת תשובה: ${s} שנ'`; if (s >= 10) think.style.color = 'var(--warn)'; }, 1000);
  const markFirst = () => { if (!tFirst) { tFirst = Date.now(); think.textContent = `התחלת לענות אחרי ${Math.round((tFirst - t0) / 1000)} שנ'`; } };
  ta.oninput = () => { markFirst(); S.drafts[q.id] = ta.value; saveLocal(); };
  const mic = $('[data-mic]', el); if (mic) mic.addEventListener('click', () => { method = 'voice'; markFirst(); });
  $('[data-help]', el).onclick = () => { helped = true; $('.helpbox', el).innerHTML = modelAnswersHtml(q); };
  $('[data-submit]', el).onclick = async () => {
    const ans = ta.value.trim();
    if (ans.length < 15) { toast('כתוב או אמור תשובה מלאה יותר לפני ההגשה'); return; }
    const out = $('.out', el);
    $('[data-submit]', el).disabled = true;
    out.innerHTML = `<div class="fb info">${aiAvailable() ? 'הבוחן הווירטואלי מנתח את התשובה…' : (window.__standalone && !(window.__byok.get() || {}).key ? 'אין בוחן AI מחובר, אז נעבור להערכה עצמית מול מחוון, בסיוע בדיקה אוטומטית. אפשר לחבר בוחן AI חינמי <a href="#settings">בהגדרות</a>.' : 'שירות ה-AI לא זמין כרגע, אז נעבור להערכה עצמית מול מחוון, בסיוע בדיקה אוטומטית.')}</div>`;
    const ev = await aiEvaluate(q, ans);
    const meta = { method, responseSec: tFirst ? Math.round((tFirst - t0) / 1000) : null };
    const finish = (res) => {
      const kind = ctx.kind || 'explain';
      logEvent(kind, q.comp, Object.assign({ score: res.score, ok: res.score >= 0.7, help: helped, qid: q.id, src: ctx.src, by: res.by }, meta));
      srsAnswer(q.id, res.score >= 0.7); delete S.drafts[q.id]; save();
      out.insertAdjacentHTML('beforeend', `<button class="btn primary" data-next>המשך</button>`);
      $('[data-next]', out).onclick = () => ctx.onDone(Object.assign({ ok: res.score >= 0.7, score: res.score, answer: ans, eval: res }, meta));
    };
    if (ev) { out.innerHTML = evalHtml(q, ev, helped); finish(ev); }
    else selfAssess(out, q, ans, helped, finish);
  };
}
function modelAnswersHtml(q) {
  if (!q.models || !q.models.strong) return '';
  return `<details open class="card" style="margin-top:10px"><summary>שלוש רמות תשובה – והשוואה</summary>
  <p><b>תשובה חזקה:</b> ${esc(q.models.strong)}</p><p><b>תשובה חלקית:</b> ${esc(q.models.partial)}</p><p><b>תשובה שגויה:</b> ${esc(q.models.weak)}</p>
  <p class="small muted">ההבדל: בתשובה החזקה יש סדר מחשבה (הגדרה, ביטול, בחירת אמצעי, תנאים, סביבה, חילוץ), חקיקה מדויקת ונימוק לכל החלטה. התשובה החלקית קופצת ישר לציוד. התשובה השגויה מעבירה את האחריות או מסתמכת על ניסיון.</p></details>`;
}
function evalHtml(q, ev, helped) {
  const pct = Math.round(ev.score * 100);
  return `<div class="fb ${ev.score >= 0.7 ? 'ok' : ev.score >= 0.45 ? 'warn' : 'no'}"><b>הערכה לימודית: ${pct}/100</b> ${helped ? '<span class="small">(ראית תשובה לדוגמה, ולכן זה לא נספר כ"הסבר בלי עזרה")</span>' : ''}<br>${esc(ev.feedback)}</div>
  ${ev.errors.length ? `<div class="fb no"><b>טעויות מהותיות:</b><ul>${ev.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
  <div class="card"><h3>מה כיסית</h3><ul>${q.points.map((p, i) => `<li>${ev.covered.includes(i) ? '✅' : ev.partial.includes(i) ? '◐' : '⬜'} ${esc(p.t)}</li>`).join('')}</ul>
  ${Object.keys(ev.criteria || {}).length ? `<h3>פירוק לפי ממדים</h3><table>${RUBRIC.map(k => `<tr><td>${k}</td><td style="width:50%"><div class="bar"><i style="width:${(Number(ev.criteria[k]) || 0) * 25}%"></i></div></td></tr>`).join('')}</table>` : ''}
  ${ev.strengths?.length ? `<p class="small"><b>חוזקות:</b> ${ev.strengths.map(esc).join(' · ')}</p>` : ''}
  <p class="small muted">${ev.by === 'ai' ? 'הוערך בידי בוחן AI. זו הערכה לימודית ולא ציון רשמי.' : 'הערכה עצמית מול מחוון.'} מקורות: ${srcTags(q.src)}</p></div>
  ${modelAnswersHtml(q)}`;
}
/* הערכה עצמית "עיוורת": קודם מחוון כן/לא מול התשובה שלך, ורק אחר כך תשובות לדוגמה.
   בדיקה אוטומטית משלימה מסמנת נקודות שסימנת אבל לא זוהו בטקסט – וזוכות לחצי ניקוד. */
function selfAssess(out, q, ans, helped, finish) {
  out.innerHTML = `<div class="card"><h3>הערכה עצמית מול מחוון</h3>
  <p class="small">התשובה שלך:</p><div class="bubble me small" style="white-space:pre-wrap">${esc(ans)}</div>
  <p class="small muted" style="margin-top:8px">ענה בכנות: האם אמרת <b>במפורש</b> כל אחת מהנקודות? התשובות לדוגמה יוצגו רק אחרי החישוב.</p>
  ${q.points.map((p, i) => `<label style="display:flex;gap:8px;margin:6px 0"><input type="checkbox" data-p="${i}"> <span>${esc(p.t)}</span></label>`).join('')}
  ${(q.traps || []).length ? `<p class="small" style="margin-top:10px"><b>מלכודות ועדה – סמן אם זה קרה בתשובה שלך:</b></p>${q.traps.map((t, i) => `<label style="display:flex;gap:8px;margin:6px 0"><input type="checkbox" data-trap="${i}"> <span>${esc(t)}</span></label>`).join('')}` : ''}
  <button class="btn primary" data-sa>חשב ציון</button></div>`;
  $('[data-sa]', out).onclick = () => {
    const ticked = $$('[data-p]', out).filter(c => c.checked).map(c => +c.dataset.p);
    const covered = ticked.filter(i => detectPoint(q.points[i], ans));
    const partial = ticked.filter(i => !detectPoint(q.points[i], ans));
    const traps = $$('[data-trap]', out).filter(c => c.checked).map(c => q.traps[+c.dataset.trap]);
    const ev = normalizeEval(q, { covered, partial, errors: traps }, 'self');
    ev.feedback = traps.length ? 'נפלת במלכודת ועדה. זו טעות שבוחנים מזהים מיד, ולכן הציון הוגבל.' : ev.score >= 0.7 ? 'כיסית את רוב הנקודות המהותיות.' : 'חסרות נקודות מהותיות. עבור על התשובה החזקה וחזור על השאלה בעוד יום.';
    $$('[data-p],[data-trap]', out).forEach(c => c.disabled = true);
    $('[data-sa]', out).remove();
    out.insertAdjacentHTML('afterbegin', `<div class="fb ${ev.score >= 0.7 ? 'ok' : 'warn'}"><b>הערכה עצמית: ${Math.round(ev.score * 100)}/100</b><br>${ev.feedback}
      ${partial.length ? `<br><span class="small">⚠ סימנת ${partial.length} נקודות שהבדיקה האוטומטית לא זיהתה בתשובה (${partial.map(i => esc(q.points[i].t.split(':')[0].split(',')[0])).join(' · ')}), ולכן קיבלת עליהן חצי ניקוד. בוועדה צריך לומר אותן במפורש.</span>` : ''}
      <br><span class="small muted">הערכה עצמית נספרת כהוכחת שליטה רק אחרי הצלחה בשני ימים שונים.</span></div>`);
    out.insertAdjacentHTML('beforeend', modelAnswersHtml(q));
    finish(ev);
  };
}
function renderQuestion(el, q, ctx) { (q.type === 'open' ? renderOpen : q.type === 'tf' ? renderTF : renderMCQ)(el, q, ctx); }

/* ---------------- TOPIC PICKER ---------------- */
function topicChips() {
  return [['all', 'הכול'], ...TOPIC_ORDER.map(t => [t, TOPICS[t].short])].map(([k, n]) => `<button class="chip sm ${curTopic() === k ? 'on' : ''}" data-topic="${k}" title="${esc(topicName(k))}" aria-pressed="${curTopic() === k}">${esc(n)}</button>`).join('');
}
function wireTopicChips(m) {
  $$('[data-topic]', m).forEach(b => b.onclick = () => { S.settings.topic = b.dataset.topic; save(); route(); });
}

/* ---------------- VIEW: HOME ---------------- */
const VIEWS = {};
let homeSel = { minutes: 5, depth: S.settings.depth || 'auto', deskDepth: 'auto' };
VIEWS.home = (m) => {
  const rec = recommend('phone', homeSel.minutes);
  const rd = readiness();
  const heard = audioNotPracticed();
  const resumeA = activeAudio().find(a => S.audio[a.id] && !S.audio[a.id].doneAt && S.audio[a.id].seg > 0);
  const daysTo = S.settings.examDate ? Math.ceil((new Date(S.settings.examDate) - Date.now()) / DAY) : null;
  const ses = S.session;
  const sesLabel = ses ? { quick: `סבב ${ses.plan?.minutes || ''} דקות (${(ses.plan?.i || 0) + 1}/${ses.plan?.ids?.length || ''})`, scenario: 'התרחיש במחסן', lesson: `השיעור המודרך (יחידה ${(ses.idx || 0) + 1})`, sim: 'סימולציית הוועדה' }[ses.kind] : null;
  m.innerHTML = `
  <h1>שלום ${esc(S.profile?.nick || '')}, מה מתאים לך עכשיו?</h1>
  <div class="row topicbar" role="group" aria-label="נושא פעיל" style="margin:6px 0 4px">${topicChips()}</div>
  <p class="muted small">נושא פעיל: <b>${esc(topicName(curTopic()))}</b> · ${daysTo != null ? (daysTo >= 0 ? `${daysTo} ימים לוועדה · ` : '') : '<a href="#settings">הגדר תאריך ועדה</a> · '}מדד ראיות <a href="#report"><b>${rd.score}/100</b></a> (כיסוי ${rd.coverage})</p>
  ${sesLabel ? `<div class="card" style="margin-bottom:12px"><div class="row" style="justify-content:space-between"><span>⏸ עצרת באמצע: <b>${sesLabel}</b></span><span class="row"><button class="btn primary sm" id="resume">המשך מאיפה שעצרת</button><button class="btn ghost sm" id="dropses">התחל מחדש</button></span></div></div>` : ''}
  ${!S.diag ? `<div class="fb info small">אבחון קצר (5 דקות, שאלה מכל פרק) יקבע את נקודת הפתיחה שלך. <a href="#diag">התחל אבחון</a></div>` : ''}
  <div class="card" style="border-color:var(--accent)">
    <div class="small muted">ההמלצה של בב״ח</div>
    <h3 style="margin-top:4px">${rec.comps ? esc(rec.comps.map(c => COMPS[c]).join(' · ')) : ''} · רמה ${DEPTH_NAME[rec.depth]}</h3>
    <div class="reason">${esc(rec.reason)}</div>
    <div class="row"><button class="btn primary" id="goRec">התחל ${homeSel.minutes} דקות</button><span class="small muted">אפשר לבחור משהו אחר בשערים למטה.</span></div>
  </div>
  <h2>או בחר בעצמך</h2>
  <div class="grid g3">
    <div class="card gate"><div class="ico">${ICON.quick}</div><h3>יש לי כמה דקות</h3>
      <div class="row">${[2, 5, 10, 15].map(n => `<button class="chip ${homeSel.minutes === n ? 'on' : ''}" data-min="${n}">${n} ד'</button>`).join('')}</div>
      <div class="row">${['auto', 1, 2, 3].map(d => `<button class="chip ${String(homeSel.depth) === String(d) ? 'on' : ''}" data-dep="${d}">${d === 'auto' ? 'אוטומטי' : DEPTH_NAME[d]}</button>`).join('')}</div>
      <button class="btn primary" id="goQuick">התחל בלחיצה אחת</button></div>
    <div class="card gate"><div class="ico">${ICON.audio}</div><h3>אני בדרך</h3>
      <p class="small muted">${resumeA ? `המשך: "${esc(resumeA.title)}"` : `מומלץ: "${esc(AUDIO.find(a => a.id === recommend('audio').lesson).title)}"`}</p>
      <button class="btn primary" id="goAudio">${resumeA ? 'המשך מהנקודה האחרונה' : 'נגן שיעור מומלץ'}</button>
      <button class="btn" id="goDrive">🚗 מצב נהיגה בטוח</button></div>
    <div class="card gate"><div class="ico">${ICON.desk}</div><h3>אני מתיישב ללמוד</h3>
      <div class="row">${['auto', 1, 2, 3].map(d => `<button class="chip ${String(homeSel.deskDepth) === String(d) ? 'on' : ''}" data-ddep="${d}">${d === 'auto' ? 'אוטומטי' : DEPTH_NAME[d]}</button>`).join('')}</div>
      <button class="btn primary" id="goDesk">פתח סביבת לימוד</button></div>
  </div>
  ${heard.length ? `<div class="card" style="margin-top:12px"><b>מהדרך:</b> שמעת את ${heard.map(a => `"${esc(a.title)}"`).join(', ')} ועוד לא תרגלת את החומר. <button class="btn sm" id="goHeard">תרגל עכשיו</button></div>` : ''}
  <details id="allpaths" style="margin-top:16px"><summary><b>כל 9 המסלולים – ${esc(topicName(curTopic()))}</b></summary>${matrixHtml()}</details>
  <p class="small muted" style="margin-top:12px">מדד הראיות מחושב רק מביצועים, ושמיעה או קריאה לא מעלות אותו. בלי תרגול שאלות ועדה הוא נעצר. הוא מכסה את כל 11 פרקי הקורס, מבוסס על שאלות מקוריות, ואינו מנבא הצלחה בוועדה. <a href="#map">איך מחושב</a></p>`;
  if (window.matchMedia && matchMedia('(min-width: 900px)').matches) $('#allpaths').open = true;
  wireTopicChips(m);
  const rs = $('#resume'); if (rs) rs.onclick = () => resumeSession();
  const ds = $('#dropses'); if (ds) ds.onclick = () => { S.session = null; quickPlan = null; scen = null; sim = null; saveLocal(); route(); };
  $$('[data-min]', m).forEach(b => b.onclick = () => { homeSel.minutes = +b.dataset.min; route(); });
  $$('[data-dep]', m).forEach(b => b.onclick = () => { homeSel.depth = b.dataset.dep === 'auto' ? 'auto' : +b.dataset.dep; route(); });
  $$('[data-ddep]', m).forEach(b => b.onclick = () => { homeSel.deskDepth = b.dataset.ddep === 'auto' ? 'auto' : +b.dataset.ddep; route(); });
  $('#goRec').onclick = () => startQuick(homeSel.minutes, rec.depth, rec);
  $('#goQuick').onclick = () => { const r2 = recommend('phone'); startQuick(homeSel.minutes, homeSel.depth === 'auto' ? r2.depth : homeSel.depth, r2); };
  $('#goAudio').onclick = () => { audioSel.lesson = resumeA ? resumeA.id : recommend('audio').lesson; audioSel.autoplay = true; go('audio'); };
  $('#goDrive').onclick = () => { audioSel.lesson = resumeA ? resumeA.id : recommend('audio').lesson; audioSel.drive = true; go('audio'); };
  $('#goDesk').onclick = () => { const d = homeSel.deskDepth === 'auto' ? autoDepth(weakComps()[0].c) : homeSel.deskDepth; const wc = weakComps()[0].c; if (d === 2 && compTopic(wc) !== 'G') { startQuick(10, 2, { comps: activeComps().filter(c => compTopic(c) === compTopic(wc)), reason: `תרחישי החלטה בפרק "${TOPICS[compTopic(wc)].name}", שבו היעד החלש ביותר שלך.` }); return; } if (d === 1) lessonTopic = null; go(d === 1 ? 'lesson' : d === 2 ? 'scenario' : 'sim'); };
  const gh = $('#goHeard'); if (gh) gh.onclick = () => startQuick(5, heard[0].depth, recommend('phone'));
  wireMatrix(m);
};
function matrixHtml() {
  const cell = (mode, d, title, sub) => `<span class="cell" data-mx="${mode}:${d}" role="button" tabindex="0">${title}<b>${sub}</b></span>`;
  const AL = activeAudio();
  const aud = d => AL.find(a => a.depth === d) || AL[Math.min(d - 1, AL.length - 1)];
  const acell = d => { const a = aud(d); return cell('audio', a.id, esc(a.title), `${a.mins} דק'`); };
  const gScen = curTopic() === 'all' || curTopic() === 'G';
  return `<div class="card" style="overflow-x:auto"><table class="matrix"><tr><th></th><th>בסיסי</th><th>יישומי</th><th>ועדה</th></tr>
  <tr><th>כמה דקות בטלפון</th><td>${cell('phone', 1, 'מושג ושאלות קצרות', '2–15 דק\'')}</td><td>${cell('phone', 2, 'מקרה קצר והחלטה', 'כולל נימוק')}</td><td>${cell('phone', 3, 'שאלת ועדה קצרה', 'עם משוב')}</td></tr>
  <tr><th>אודיו</th><td>${acell(1)}</td><td>${acell(2)}</td><td>${acell(3)}</td></tr>
  <tr><th>מחשב</th><td>${cell('desk', 'lesson', 'שיעור מודרך', 'עם בדיקות הבנה')}</td><td>${gScen ? cell('desk', 'scenario', 'תרחיש אינטראקטיבי', 'מפגעים, החלטות, נוהל') : cell('phone', 2, 'תרחישי החלטה בנושא', 'סבב יישומי')}</td><td>${cell('desk', 'sim', 'סימולציית ועדה ותחקיר', 'בעל פה')}</td></tr></table></div>`;
}
function wireMatrix(m) {
  $$('[data-mx]', m).forEach(c => {
    const f = () => { const [mode, d] = c.dataset.mx.split(':'); if (mode === 'phone') startQuick(5, +d, recommend('phone')); else if (mode === 'audio') { audioSel.lesson = d; go('audio'); } else go(d); };
    c.onclick = f; c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); f(); } };
  });
}

/* ---------------- VIEW: QUICK SESSION (phone) ---------------- */
let quickPlan = null;
function buildQuick(minutes, depth, rec) {
  const per = { 1: { 2: 4, 5: 8, 10: 14, 15: 20 }, 2: { 2: 1, 5: 3, 10: 5, 15: 7 }, 3: { 2: 1, 5: 1, 10: 2, 15: 3 } }[depth][minutes] || 4;
  const target = new Set(rec?.comps || []);
  const typeOk = q => depth === 1 ? (q.type === 'mcq' || q.type === 'tf') : depth === 2 ? q.type === 'scenario' : q.type === 'open';
  let pool = Q.filter(q => typeOk(q) && (target.size ? target.has(q.comp) || inCur(q.comp) : inCur(q.comp)));
  if (pool.length < 2) pool = Q.filter(typeOk);
  const scoreQ = q => {
    let s = Math.random();
    if (isDue(q.id)) s += 5;
    if (S.srs[q.id] && S.srs[q.id].lastOk === false) s += 4;
    if (S.srs[q.id] && S.srs[q.id].hyper) s += 6;
    if (target.has(q.comp)) s += 3;
    if (!S.srs[q.id]) s += 1.5;
    if (S.srs[q.id] && S.srs[q.id].box >= 4 && !isDue(q.id)) s -= 3;
    return s;
  };
  let picked = pool.map(q => ({ q, s: scoreQ(q) })).sort((a, b) => b.s - a.s).slice(0, per).map(x => x.q);
  // שילוב נושאים: לא שתי שאלות רצופות מאותו יעד, ככל שניתן
  const inter = []; const rest = picked.slice();
  while (rest.length) { const i = rest.findIndex(q => !inter.length || q.comp !== inter[inter.length - 1].comp); inter.push(rest.splice(i < 0 ? 0 : i, 1)[0]); }
  const items = [];
  if (depth === 1) { const c = inter[0]?.comp || [...target][0] || 'C1'; const f = FACTS.find(f => f.comp === c); if (f) items.push({ kind: 'fact', f }); }
  const gOk = target.size ? [...target].some(c => compTopic(c) === 'G') : inCur('C1');
  if (depth === 2 && minutes >= 5 && gOk) items.push({ kind: 'hazard' });
  inter.forEach(q => items.push({ kind: 'q', q }));
  return { minutes, depth, items, i: 0, results: [], started: Date.now(), reason: rec?.reason || '' };
}
function startQuick(minutes, depth, rec) { quickPlan = buildQuick(minutes, depth, rec); persistQuick(); if (location.hash === '#quick') route(); else location.hash = 'quick'; }
function persistQuick() {
  if (!quickPlan) return;
  S.session = { kind: 'quick', t: Date.now(), plan: { minutes: quickPlan.minutes, depth: quickPlan.depth, i: quickPlan.i, reason: quickPlan.reason, results: quickPlan.results, ids: quickPlan.items.map(it => it.kind === 'q' ? { k: 'q', id: it.q.id } : it.kind === 'fact' ? { k: 'fact', id: it.f.id } : { k: it.kind }) } };
  saveLocal();
}
function resumeSession() {
  const s = S.session; if (!s) return;
  if (s.kind === 'quick') {
    const p = s.plan;
    quickPlan = { minutes: p.minutes, depth: p.depth, i: p.i, reason: p.reason, results: p.results || [], started: Date.now(),
      items: p.ids.map(x => x.k === 'q' ? { kind: 'q', q: QMAP[x.id] } : x.k === 'fact' ? { kind: 'fact', f: FMAP[x.id] } : { kind: x.k }).filter(it => it.kind !== 'q' || it.q) };
    go('quick');
  } else if (s.kind === 'scenario') { scen = s.scen; go('scenario'); }
  else if (s.kind === 'lesson') { lessonIdx = s.idx || 0; lessonTopic = s.topic || 'G'; go('lesson'); }
  else if (s.kind === 'sim') { sim = s.sim; go('sim'); }
}
VIEWS.quick = (m) => {
  if (!quickPlan) {
    m.innerHTML = `<h1>יש לי כמה דקות</h1><p class="muted">בחר זמן ורמה. בב״ח יבחר את הפעילות שתורמת לך הכי הרבה.</p>
    <div class="card"><div class="row">${[2, 5, 10, 15].map(n => `<button class="btn" data-q="${n}">${n} דקות</button>`).join('')}</div>
    <div class="row" style="margin-top:10px">${['auto', 1, 2, 3].map(d => `<button class="chip ${String(homeSel.depth) === String(d) ? 'on' : ''}" data-dep="${d}">${d === 'auto' ? 'אוטומטי' : DEPTH_NAME[d]}</button>`).join('')}</div></div>`;
    $$('[data-dep]', m).forEach(b => b.onclick = () => { homeSel.depth = b.dataset.dep === 'auto' ? 'auto' : +b.dataset.dep; route(); });
    $$('[data-q]', m).forEach(b => b.onclick = () => { const r = recommend('phone'); startQuick(+b.dataset.q, homeSel.depth === 'auto' ? r.depth : homeSel.depth, r); });
    return;
  }
  const p = quickPlan;
  const elapsed = (Date.now() - p.started) / 60000;
  if (p.i >= p.items.length) return quickSummary(m);
  const it = p.items[p.i];
  m.innerHTML = `<div class="row" style="justify-content:space-between"><div><h1 style="font-size:1.05rem;margin:0">${p.minutes} דקות · רמה ${DEPTH_NAME[p.depth]}</h1><div class="small muted">${p.i + 1} מתוך ${p.items.length}</div></div><button class="btn sm ghost" id="stop">עצור כאן</button></div>
  <div class="steps">${p.items.map((_, i) => `<span class="${i < p.i ? 'on' : ''}"></span>`).join('')}</div>
  ${p.i === 0 && p.reason ? `<div class="reason">${esc(p.reason)}</div>` : ''}
  <div class="card" id="item"></div>`;
  $('#stop').onclick = () => { p.i = p.items.length; route(); };
  const el = $('#item');
  const next = (r) => { if (r) p.results.push(r); p.i++; persistQuick(); route(); };
  if (it.kind === 'fact') {
    el.innerHTML = `<div class="small muted">מושג אחד</div>${factHtml(it.f)}<button class="btn primary" id="nx">הבנתי, לשאלות</button>`;
    logEvent('exposure', it.f.comp, { src: 'phone', fact: it.f.id }); save();
    $('#nx').onclick = () => next(null);
  } else if (it.kind === 'hazard') {
    hazardGame(el, { compact: true, src: 'phone', onDone: r => next(r) });
  } else renderQuestion(el, it.q, { src: 'phone', onDone: next });
  if (elapsed > p.minutes + 0.5 && p.i > 0) toast('הזמן שבחרת הסתיים. אפשר לעצור כאן או להמשיך.');
};
function quickSummary(m) {
  const p = quickPlan; const ok = p.results.filter(r => r.ok).length;
  S.session = null; saveLocal();
  m.innerHTML = `<h1>סיימת</h1><div class="card"><p><b>${ok} מתוך ${p.results.length}</b> נכונות.</p>
  <p class="small muted">התוצאות עודכנו במדד השליטה ובלוח החזרות המרווחות. שאלות שטעית בהן יחזרו בקרוב.</p>
  <div class="row"><button class="btn primary" id="again">עוד סבב מומלץ</button><a class="btn" href="#map">מפת שליטה</a><a class="btn" href="#home">לבית</a></div></div>`;
  $('#again').onclick = () => { const r = recommend('phone'); startQuick(p.minutes, r.depth, r); };
  quickPlan = null;
}

/* ---------------- HAZARD SPOTTING (SVG) ---------------- */
function hazardSVG() {
  return `<svg viewBox="0 0 620 340" style="width:100%;height:auto;background:var(--surface2);border-radius:12px" role="img" aria-label="מחסן עם עובד על סולם – מצא מפגעים">
  <rect x="0" y="320" width="620" height="20" fill="#9aa3ad"/>
  <rect x="380" y="120" width="240" height="12" fill="#6d7783"/><rect x="600" y="132" width="10" height="188" fill="#6d7783"/>
  <rect x="420" y="70" width="40" height="50" fill="#c49a6c"/><rect x="470" y="85" width="30" height="35" fill="#c49a6c"/>
  <circle cx="470" cy="55" r="10" fill="#e0b48a"/><rect x="462" y="65" width="16" height="30" rx="4" fill="#2f6fb0"/><path d="M465 95 l-6 25 M475 95 l6 25" stroke="#333" stroke-width="5"/>
  <rect x="170" y="130" width="95" height="190" fill="#7a5c3e" stroke="#4d3a27" stroke-width="3"/><circle cx="182" cy="225" r="5" fill="#d9c27a"/><text x="217" y="122" font-size="13" text-anchor="middle" fill="currentColor">דלת</text>
  <rect x="160" y="300" width="110" height="20" fill="#b8874f"/><path d="M165 300 v20 M200 300 v20 M235 300 v20 M265 300 v20" stroke="#8a6234" stroke-width="3"/>
  <path d="M200 300 L262 40 M240 300 L300 40" stroke="#c0c6cc" stroke-width="7"/>
  ${[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => { const y = 285 - i * 30; const x1 = 200 + (300 - y) * 62 / 260, x2 = 240 + (300 - y) * 60 / 260; return `<path d="M${x1} ${y} L${x2} ${y}" stroke="#c0c6cc" stroke-width="5"/>`; }).join('')}
  <circle cx="262" cy="18" r="11" fill="#e0b48a"/><rect x="254" y="29" width="18" height="34" rx="4" fill="#d06a2b"/><path d="M270 36 L305 105" stroke="#d06a2b" stroke-width="7"/><path d="M258 63 l-4 22 M268 63 l6 22" stroke="#333" stroke-width="5"/>
  <circle cx="300" cy="104" r="6" fill="#666"/><rect x="290" y="96" width="30" height="8" fill="#eee" stroke="#aaa"/>
  <circle cx="330" cy="248" r="11" fill="#e0b48a"/><rect x="321" y="259" width="18" height="40" rx="4" fill="#3c8d5a"/><path d="M325 299 v20 M335 299 v20" stroke="#333" stroke-width="5"/>
  <rect x="50" y="270" width="40" height="30" fill="#c8a06e"/><rect x="58" y="246" width="30" height="24" fill="#c8a06e"/><rect x="40" y="300" width="70" height="20" fill="#b8874f"/>
  <rect x="552" y="235" width="16" height="40" rx="5" fill="#c62828"/><rect x="556" y="228" width="8" height="8" fill="#333"/>
  ${HAZARDS.concat(DECOYS).map((z, i) => `<g class="hz" data-hz="${z.id}" role="button" tabindex="0" aria-label="אזור ${i + 1} בתמונה"><circle cx="${z.x}" cy="${z.y}" r="${Math.max(z.r, 34)}"/></g>`).join('')}
  </svg>`;
}
function hazardGame(el, opts) {
  const found = new Set(); const wrong = new Set();
  const cand = shuffle(HAZARDS.concat(DECOYS));
  el.innerHTML = `<div class="small muted">זיהוי מפגעים בתמונה · יישומי</div><h3>מחסן במפעל מזון: איש אחזקה מחליף נורה. גע בכל מפגע שאתה מזהה.</h3>
  <div class="row small" style="margin-bottom:6px"><button class="btn sm ghost" id="hzzoom" aria-pressed="false">🔍 הגדל תמונה</button><button class="btn sm ghost" id="hzlistmode">מצב רשימה (נגישות)</button></div>
  <div id="hzwrap" style="overflow:auto;border-radius:12px">${hazardSVG()}</div>
  <div id="hzalt" class="hide"><p class="small">סמן את המשפטים שמתארים מפגע בתמונה:</p>${cand.map(z => `<button class="opt" data-alt="${z.id}" aria-pressed="false">${esc(z.label)}</button>`).join('')}</div>
  <div class="row" style="justify-content:space-between;margin-top:8px"><span class="small" id="hzc" aria-live="polite">נמצאו 0 מתוך ${HAZARDS.length}</span><button class="btn primary sm" id="hzdone">סיימתי</button></div><ul id="hzlist" class="small"></ul>`;
  const list = $('#hzlist', el);
  $('#hzzoom', el).onclick = (e) => { const svg = $('#hzwrap svg', el); const on = svg.style.width !== '180%'; svg.style.width = on ? '180%' : '100%'; e.target.setAttribute('aria-pressed', on); e.target.textContent = on ? '🔍 הקטן' : '🔍 הגדל תמונה'; };
  $('#hzlistmode', el).onclick = () => { $('#hzwrap', el).classList.toggle('hide'); $('#hzalt', el).classList.toggle('hide'); };
  $$('[data-alt]', el).forEach(b => b.onclick = () => { const g = $(`.hz[data-hz="${b.dataset.alt}"]`, el); b.setAttribute('aria-pressed', 'true'); b.disabled = true; g.dispatchEvent(new Event('click')); });
  $$('.hz', el).forEach(g => g.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); g.dispatchEvent(new Event('click')); } });
  $$('.hz', el).forEach(g => g.onclick = () => {
    const id = g.dataset.hz; const hz = HAZARDS.find(h => h.id === id); const dc = DECOYS.find(d => d.id === id);
    if (hz && !found.has(id)) { found.add(id); g.classList.add('found'); list.insertAdjacentHTML('beforeend', `<li>✅ <b>${esc(hz.label)}</b> – ${esc(hz.fix)}</li>`); }
    if (dc && !wrong.has(id)) { wrong.add(id); list.insertAdjacentHTML('beforeend', `<li>✖ ${esc(dc.label)}: ${esc(dc.why)}</li>`); }
    $('#hzc', el).textContent = `נמצאו ${found.size} מתוך ${HAZARDS.length}`;
  });
  $('#hzdone', el).onclick = () => {
    HAZARDS.filter(h => !found.has(h.id)).forEach(h => { const g = $(`[data-hz="${h.id}"]`, el); g.classList.add('miss'); list.insertAdjacentHTML('beforeend', `<li>⬜ <b>פספסת:</b> ${esc(h.label)} – ${esc(h.fix)}</li>`); });
    const ratio = (found.size - wrong.size * 0.5) / HAZARDS.length;
    const byComp = {};
    HAZARDS.forEach(h => { byComp[h.comp] = byComp[h.comp] || { f: 0, n: 0 }; byComp[h.comp].n++; if (found.has(h.id)) byComp[h.comp].f++; });
    Object.entries(byComp).forEach(([c, v]) => logEvent('apply', c, { ok: v.f / v.n >= 0.75, score: v.f / v.n, src: opts.src, act: 'hazard' }));
    save();
    $('#hzdone', el).outerHTML = `<button class="btn primary sm" id="hznext">המשך</button>`;
    $('#hznext', el).onclick = () => opts.onDone({ ok: ratio >= 0.7, score: ratio });
  };
}

/* ---------------- VIEW: AUDIO ---------------- */
let audioSel = { lesson: null, autoplay: false, drive: false, driving: false, walkingPractice: true };
let player = null;
VIEWS.audio = (m) => {
  const lessonId = audioSel.lesson || recommend('audio').lesson;
  const L = AUDIO.find(a => a.id === lessonId);
  const st = S.audio[L.id] || { seg: 0 };
  const vm = Voice.mode();
  m.innerHTML = `<h1>אני בדרך – אודיו</h1>
  <p class="muted small">השיעורים נכתבו לשמיעה. ההתקדמות נשמרת לפי קטעים. ${vm === 'none' ? 'במכשיר הזה אין הקראה קולית, אז הטקסט יוצג לקריאה.' : vm === 'browser-nohe' ? 'לא נמצא קול עברי במכשיר, וייתכן שההקראה לא תהיה ברורה.' : ''}</p>
  <div class="card small" id="sndbox" style="margin:6px 0"><div class="row" style="justify-content:space-between;align-items:center"><span>🔊 לא שומע? <b>בדיקת קול</b> תאתר את הבעיה.</span><button class="btn sm" id="sndtest">בדיקת קול</button></div><div id="sndres"></div></div>
  <div class="row topicbar" style="margin:6px 0">${topicChips()}</div>
  <div class="grid g3">${activeAudio().map(a => { const s = S.audio[a.id]; return `<button class="card" style="text-align:right;cursor:pointer;${a.id === L.id ? 'border-color:var(--accent)' : ''}" data-l="${a.id}"><span class="tag">${esc(TOPICS[audioTopic(a)].short)}</span> <span class="tag">${DEPTH_NAME[a.depth]}</span> <span class="small muted">${a.mins} דק'</span><h3 style="margin-top:6px">${esc(a.title)}</h3><span class="small muted">${s?.doneAt ? '✔ נשמע (חשיפה)' : s?.seg ? `עצרת בקטע ${s.seg + 1}/${a.lines.length}` : 'טרם נשמע'}</span></button>`; }).join('')}</div>
  <div class="card player" style="margin-top:14px">
    <div class="row" style="justify-content:space-between"><b>${esc(L.title)}</b><span class="small muted" id="pos">קטע ${Math.min(st.seg + 1, L.lines.length)}/${L.lines.length}</span></div>
    <div class="bar"><i id="pbar" style="width:${(st.seg / L.lines.length) * 100}%"></i></div>
    <div class="nowline" id="now" aria-live="polite">${esc(L.lines[Math.min(st.seg, L.lines.length - 1)].t)}</div>
    <div class="row"><button class="btn" id="prev">⏮ קטע קודם</button><button class="btn primary big" id="play">▶ נגן</button><button class="btn" id="next">קטע הבא ⏭</button></div>
    <div class="row small"><span>מהירות:</span>${[0.8, 1, 1.2, 1.5].map(r => `<button class="chip ${S.settings.rate === r ? 'on' : ''}" data-rate="${r}">${r}×</button>`).join('')}
      <label style="margin-inline-start:12px"><input type="checkbox" id="cont" ${audioSel.cont !== false ? 'checked' : ''}> המשך רציף לשיעור הבא</label></div>
    <div class="row"><button class="btn" id="drive">🚗 מצב נהיגה בטוח</button><span class="small muted">בנהיגה: האזנה בלבד, בלי שאלות ובלי טקסט על המסך. תרגולים ימתינו לעצירה.</span></div>
  </div>
  <div id="after"></div>`;
  $$('[data-l]', m).forEach(b => b.onclick = () => { stopPlayer(); audioSel.lesson = b.dataset.l; route(); });
  $$('[data-topic]', m).forEach(b => b.onclick = () => { stopPlayer(); S.settings.topic = b.dataset.topic; audioSel.lesson = null; save(); route(); });
  $('#sndtest').onclick = async () => {
    const r = $('#sndres'); r.innerHTML = '<span class="muted">משמיע: "בדיקת קול. אם אתה שומע אותי, הכול תקין."…</span>';
    Voice.pickVoice();
    const ok = await Voice.speak('בדיקת קול. אם אתה שומע אותי, הכול תקין.');
    const eng = Voice.lastEngine === 'claude' ? 'קול Claude' : Voice.lastEngine ? 'קול הדפדפן (' + esc(Voice.lastEngine.replace('browser:', '')) + ')' : '—';
    const adv = Voice.advice();
    r.innerHTML = `<div class="fb ${ok ? 'ok' : 'warn'}" style="margin-top:8px">${ok ? `המערכת דיווחה שההקראה הושמעה דרך ${eng}. אם לא שמעת – בדוק שעוצמת השמע פתוחה ושהטלפון לא במצב שקט (באייפון: מתג השקט בצד).` : `ההקראה לא הושמעה${Voice.lastErr ? ' (' + esc(Voice.lastErr) + ')' : ''}.`}${adv ? '<br>' + esc(adv) : ''}</div>`;
  };
  $$('[data-rate]', m).forEach(b => b.onclick = () => { S.settings.rate = +b.dataset.rate; save(); $$('[data-rate]', m).forEach(x => x.classList.toggle('on', x === b)); try { Cap.tts && Cap.tts.setRate(S.settings.rate); } catch (e) { } try { if (Voice.aud) Voice.aud.playbackRate = S.settings.rate; } catch (e) { } });
  $('#cont').onchange = e => audioSel.cont = e.target.checked;
  $('#play').onclick = () => player && player.playing ? pausePlayer() : startPlayer(L.id);
  $('#prev').onclick = () => { stopPlayer(); setSeg(L.id, Math.max(0, (S.audio[L.id]?.seg || 0) - 1)); route(); };
  $('#next').onclick = () => { stopPlayer(); setSeg(L.id, Math.min(L.lines.length - 1, (S.audio[L.id]?.seg || 0) + 1)); route(); };
  $('#drive').onclick = () => enterDrive(L.id);
  current.cleanup = () => { if (!audioSel.driving) stopPlayer(); };
  if (audioSel.drive) { audioSel.drive = false; enterDrive(L.id); }
  else if (audioSel.autoplay) { audioSel.autoplay = false; startPlayer(L.id); }
  if (S.audio[L.id]?.doneAt && !audioSel.driving) afterLesson(L);
};
function setSeg(id, seg) { S.audio[id] = Object.assign(S.audio[id] || {}, { seg, at: Date.now() }); save(); }
function stopPlayer() { if (player) { player.stop = true; player.playing = false; } Voice.stop(); updatePlayUI(); }
function pausePlayer() { stopPlayer(); }
function updatePlayUI() {
  const b = $('#play'); if (b) b.textContent = player && player.playing ? '⏸ השהה' : '▶ נגן';
  const d = $('#dplay'); if (d) d.textContent = player && player.playing ? 'השהה' : 'נגן';
}
let wakeLock = null;
async function keepAwake(on) {
  try { if (on && 'wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; } } catch (e) { }
}
function mediaSession(id) {
  try {
    if (!('mediaSession' in navigator)) return;
    const L = AUDIO.find(a => a.id === id);
    navigator.mediaSession.metadata = new MediaMetadata({ title: L.title, artist: 'בב״ח – בוב בטיחות חניכים', artwork: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }] });
    navigator.mediaSession.setActionHandler('play', () => startPlayer(audioSel.lesson || id));
    navigator.mediaSession.setActionHandler('pause', () => stopPlayer());
    navigator.mediaSession.setActionHandler('nexttrack', () => { stopPlayer(); setSeg(id, Math.min(L.lines.length - 1, (S.audio[id]?.seg || 0) + 1)); startPlayer(id); });
    navigator.mediaSession.setActionHandler('previoustrack', () => { stopPlayer(); setSeg(id, Math.max(0, (S.audio[id]?.seg || 0) - 1)); startPlayer(id); });
  } catch (e) { }
}
async function startPlayer(id) {
  stopPlayer(); mediaSession(id);
  const me = player = { id, stop: false, playing: true };
  updatePlayUI();
  const L = AUDIO.find(a => a.id === id);
  let seg = S.audio[id]?.seg || 0;
  if (S.audio[id]?.doneAt && seg >= L.lines.length - 1) seg = 0;
  const vm = Voice.mode();
  const clips = await lessonClips(id);
  if (me.stop) return;
  while (seg < L.lines.length && !me.stop) {
    const line = L.lines[seg];
    if (line.v === 'q' && audioSel.driving) { seg++; continue; }   // בנהיגה: בלי שאלות שמחייבות תגובה
    const now = $('#now'); if (now) now.textContent = line.t;
    const pos = $('#pos'); if (pos) pos.textContent = `קטע ${seg + 1}/${L.lines.length}`;
    const pb = $('#pbar'); if (pb) pb.style.width = (seg / L.lines.length * 100) + '%';
    const dl = $('#dline'); if (dl) dl.textContent = `${L.title} · קטע ${seg + 1}/${L.lines.length}`;
    setSeg(id, seg);
    let ok = false;
    const clip = clips[seg];
    if (clip && clip.mp3 && clip.h === hashText(line.t)) ok = await Voice.playClip(clip.mp3, S.settings.rate || 1);
    if (!ok && !me.stop && vm !== 'none') ok = await Voice.speak(line.t, { voice: line.v === 'e' ? 'rounded' : line.v === 'c' ? 'airy' : 'buttery' });
    if (!ok && !me.stop) { await new Promise(r => setTimeout(r, Math.max(2500, line.t.length * 55 / (S.settings.rate || 1)))); }
    if (line.v === 'q' && !me.stop) {   // עצירת שליפה פעילה: זמן לענות בקול
      const nl = $('#now'); if (nl) nl.textContent = line.t + ' (' + (line.pause || 12) + ' שניות לענות בקול)';
      await new Promise(r => setTimeout(r, (line.pause || 12) * 1000));
      if (!me.stop) logEvent('exposure', L.comps[0], { src: 'audio', recall: true });
    }
    if (me.stop) return;
    seg++;
  }
  if (me.stop) return;
  // סיום שיעור: נרשם כחשיפה בלבד
  S.audio[id] = Object.assign(S.audio[id] || {}, { seg: L.lines.length - 1, doneAt: Date.now(), at: Date.now() });
  L.comps.forEach(c => logEvent('exposure', c, { src: 'audio', lesson: id }));
  save();
  me.playing = false; updatePlayUI();
  if (audioSel.cont !== false) {
    const nxt = activeAudio().find(a => !S.audio[a.id]?.doneAt) || AUDIO.find(a => !S.audio[a.id]?.doneAt);
    if (nxt) { audioSel.lesson = nxt.id; if (audioSel.driving) { startPlayer(nxt.id); return; } route(); startPlayer(nxt.id); return; }
  }
  if (!audioSel.driving && current.route === 'audio') route();
}
function afterLesson(L) {
  const el = $('#after'); if (!el) return;
  const q = Q.find(q => q.type === 'open' && L.comps.includes(q.comp));
  el.innerHTML = `<div class="card" style="margin-top:14px"><b>השיעור נשמע.</b> <span class="small muted">נרשם כחשיפה לחומר בלבד, לא כהוכחת שליטה.</span>
  <p class="small">אם אתה לא נוהג (הליכה, ישיבה), אפשר לתרגל עכשיו שאלה אחת בעל פה:</p>
  <button class="btn" id="walkq">אני לא נוהג – תרגול קולי קצר</button><div id="walkbox"></div></div>`;
  $('#walkq').onclick = () => {
    const box = $('#walkbox'); box.innerHTML = '<div class="card" style="margin-top:10px"></div>';
    Voice.speak(q.q, { voice: 'rounded' });
    renderOpen(box.firstChild, q, { src: 'audio-walk', onDone: () => { box.innerHTML = '<div class="fb ok">נשמר. התוצאה עודכנה במדד השליטה.</div>'; } });
  };
}
function enterDrive(id) {
  audioSel.driving = true;
  const ov = document.createElement('div'); ov.className = 'drive'; ov.id = 'driveov';
  ov.innerHTML = `<div style="font-size:1rem;opacity:.75">מצב נהיגה בטוח · האזנה בלבד</div>
  <div id="dline" style="font-size:1.1rem;opacity:.85">${esc(AUDIO.find(a => a.id === id).title)}</div>
  <button class="huge" id="dplay">נגן</button>
  <div style="font-size:.95rem;opacity:.6;max-width:340px">המסך יישאר דלוק. אפשר לשלוט גם בכפתורי המדיה של הרכב או האוזניות.</div>
  <button class="exit" id="dexit">עצרתי בבטחה – יציאה</button>`;
  document.body.appendChild(ov); keepAwake(true);
  $('#dplay').onclick = () => player && player.playing ? stopPlayer() : startPlayer(audioSel.lesson || id);
  $('#dexit').onclick = () => { audioSel.driving = false; stopPlayer(); keepAwake(false); ov.remove(); route(); const h = audioNotPracticed(); if (h.length) toast(`ממתין לך תרגול על ${h.length} שיעורים ששמעת`); };
  startPlayer(id);
}

/* ---------------- VIEW: DESK hub ---------------- */
VIEWS.desk = (m) => {
  m.innerHTML = `<h1>אני מתיישב ללמוד</h1><p class="muted">סביבת עבודה מעמיקה. ממליץ לעבוד לפי הסדר, אבל אפשר לבחור.</p>
  <div class="grid g3">
   <div class="card"><span class="tag">בסיסי</span><h3>שיעור מודרך</h3><p class="small muted">10 יחידות עם עובדות מאומתות ומקורות, ובדיקת הבנה אחרי כל יחידה.</p><a class="btn primary" href="#lesson">התחל</a></div>
   <div class="card"><span class="tag">יישומי</span><h3>תרחיש אינטראקטיבי</h3><p class="small muted">זיהוי מפגעים, בחירת שיטת עבודה, התאמת עובדים, וכתיבת היתר עבודה עם משוב.</p><a class="btn primary" href="#scenario">התחל</a></div>
   <div class="card"><span class="tag">ועדה</span><h3>סימולציית ועדה</h3><p class="small muted">שלושה בוחנים, שאלות המשך, לחץ זמן מדורג ותחקיר מלא.</p><a class="btn primary" href="#sim">התחל</a></div>
  </div>
  <h2>מורה AI לשאלות והבהרות</h2>${tutorHtml()}`;
  wireTutor(m);
};
function tutorHtml() {
  return `<div class="card"><p class="small muted">שאל כל שאלה על ${esc(topicName(curTopic()))}. המורה עונה מתוך המקורות באפליקציה, מציין מקור ואומר כשהוא לא בטוח.</p>
  <div id="tlog"></div><textarea id="tq" style="min-height:70px" placeholder="למשל: מה ההבדל בין 6 מ' ל-10 מ' בסולם קבוע?"></textarea>
  <div class="row" style="margin-top:6px">${micButton('#tq')}<button class="btn primary" id="task">שאל</button><button class="btn sm ghost" id="talt">הסבר בדרך אחרת</button></div>
  ${aiAvailable() ? '' : '<p class="small muted">שירות ה-AI לא זמין כרגע. אפשר לחפש בספריית המקורות.</p>'}</div>`;
}
const tutorHist = [];
function wireTutor(m) {
  wireMic(m);
  const ask = async (text) => {
    if (!text) return;
    const log = $('#tlog', m);
    log.insertAdjacentHTML('beforeend', `<div class="bubble me" style="margin:6px 0">${esc(text)}</div>`);
    if (!aiAvailable()) { log.insertAdjacentHTML('beforeend', `<div class="bubble" style="margin:6px 0">המורה לא זמין כרגע. הנה העובדות הרלוונטיות מהמאגר:${FACTS.filter(f => inCur(f.comp)).filter(f => text.split(/\s+/).some(w => w.length > 2 && f.text.includes(w))).slice(0, 3).map(factHtml).join('') || ' לא נמצאה התאמה. נסה את ספריית המקורות.'}</div>`); return; }
    const box = document.createElement('div'); box.className = 'bubble'; box.style.margin = '6px 0'; box.textContent = '…'; log.appendChild(box);
    tutorHist.push({ role: 'user', content: text });
    const sys = `אתה מורה פרטי מקצועי לממוני בטיחות בישראל, בנושא ${topicName(curTopic())}. ענה בעברית, קצר וברור (עד 150 מילים), והתאם להכנה לוועדת הסמכה. הסתמך על העובדות שלהלן וציין את מזהה המקור בסוגריים (למשל [S1]). הבחן בין חובה בדין, חומר הקורס והסבר לימודי. אם אינך בטוח או שהמידע לא נמצא, אמור זאת במפורש והפנה לנוסח הרשמי. אל תמציא סעיפים.\nעובדות:\n${FACTS.filter(f => inCur(f.comp)).map(f => `${f.id} [${KIND_LABEL[f.kind]}; מקור ${f.src.join(',')}]: ${f.text}`).join('\n')}`;
    try {
      const msgs = [{ role: 'user', content: sys + '\n\nשאלה: ' + tutorHist[0].content }].concat(tutorHist.slice(1));
      const r = await Cap.sample(msgs, { cache: false, onText: ({ text }) => { box.textContent = text; } });
      box.textContent = r.text; tutorHist.push({ role: 'assistant', content: r.text });
      const comp = Object.keys(COMPS).find(c => FACTS.some(f => f.comp === c && r.text.includes(f.src[0])));
      if (comp) { logEvent('exposure', comp, { src: 'tutor' }); save(); }
    } catch (e) { box.textContent = 'המורה לא זמין כרגע. נסה שוב בעוד דקה.'; tutorHist.pop(); }
  };
  $('#task', m).onclick = () => { const t = $('#tq', m).value.trim(); $('#tq', m).value = ''; ask(t); };
  $('#talt', m).onclick = () => ask('הסבר את התשובה האחרונה בדרך אחרת, עם דוגמה מהשטח במפעל מזון.');
}

/* ---------------- VIEW: GUIDED LESSON (desk basic) ---------------- */
let lessonIdx = 0;
/* שיעור Test-first: כל יחידה נפתחת בשאלה. מי שעונה נכון יכול לדלג; מי שטועה – מקבל את ההסבר הממוקד. */
let lessonTopic = null;
function lessonTopicNow() {
  if (lessonTopic && TOPIC_LESSONS[lessonTopic]) return lessonTopic;
  const t = curTopic() !== 'all' ? curTopic() : compTopic(weakComps()[0].c);
  return TOPIC_LESSONS[t] ? t : 'G';
}
VIEWS.lesson = (m) => {
  const LT = lessonTopicNow(); lessonTopic = LT;
  const LESSON = TOPIC_LESSONS[LT];
  if (lessonIdx >= LESSON.length) lessonIdx = 0;
  const L = LESSON[lessonIdx];
  S.session = { kind: 'lesson', idx: lessonIdx, topic: LT, t: Date.now() }; saveLocal();
  const showContent = (why) => {
    const box = $('#lcontent', m);
    box.innerHTML = `<div class="card">${why ? `<div class="reason">${why}</div>` : ''}<h2 style="margin-top:0">${esc(L.h)}</h2><p>${esc(L.body)}</p>${L.facts.map(id => factHtml(FMAP[id])).join('')}</div>`;
    L.facts.forEach(id => logEvent('exposure', FMAP[id].comp, { src: 'lesson', fact: id }));
    if (L.facts.length) save();
    $('#ln', m).disabled = false;
  };
  m.innerHTML = `<div class="row" style="justify-content:space-between"><h1 tabindex="-1">שיעור מודרך: ${esc(TOPICS[LT].name)}</h1><span class="small muted">${lessonIdx + 1}/${LESSON.length}</span></div>
  <div class="row topicbar" style="margin:4px 0 8px">${TOPIC_ORDER.map(t => `<button class="chip sm ${t === LT ? 'on' : ''}" data-lt="${t}" title="${esc(TOPICS[t].name)}">${esc(TOPICS[t].short)}</button>`).join('')}</div>
  <div class="steps">${LESSON.map((_, i) => `<span class="${i <= lessonIdx ? 'on' : ''}"></span>`).join('')}</div>
  ${L.check ? `<p class="small muted">${esc(L.h)} · נתחיל בשאלה. אם תענה נכון, תוכל לדלג על ההסבר.</p><div class="card" id="chk"></div>` : ''}
  <div id="lcontent" style="margin-top:12px"></div>
  <div class="row" style="margin-top:12px"><button class="btn" id="lp" ${lessonIdx === 0 ? 'disabled' : ''}>הקודם</button><button class="btn primary" id="ln" ${L.check ? 'disabled' : ''}>${lessonIdx === LESSON.length - 1 ? 'סיום השיעור' : 'הבא'}</button></div>`;
  if (L.check) renderQuestion($('#chk'), QMAP[L.check], { src: 'desk', onDone: (r) => {
    $('#chk').innerHTML = r.ok ? '<div class="fb ok">ענית נכון. אפשר להמשיך ליחידה הבאה, או לקרוא את ההסבר לחיזוק.</div><button class="btn sm" id="readanyway">הצג את ההסבר</button>' : '<div class="fb warn">כדאי לקרוא את ההסבר הממוקד שלמטה.</div>';
    $('#ln', m).disabled = false;
    if (r.ok) $('#readanyway').onclick = () => showContent(''); else showContent('בחרתי להציג את ההסבר, כי התשובה בשאלת הפתיחה לא הייתה נכונה.');
  } });
  else showContent('');
  $$('[data-lt]', m).forEach(b => b.onclick = () => { lessonTopic = b.dataset.lt; lessonIdx = 0; route(); });
  $('#lp').onclick = () => { lessonIdx--; route(); };
  $('#ln').onclick = () => {
    if (lessonIdx < LESSON.length - 1) { lessonIdx++; route(); return; }
    lessonIdx = 0; S.session = null; saveLocal();
    const nextT = TOPIC_ORDER[(TOPIC_ORDER.indexOf(LT) + 1) % TOPIC_ORDER.length];
    m.innerHTML = `<h1>סיימת את השיעור המודרך: ${esc(TOPICS[LT].name)}</h1><div class="card"><p>הקריאה נרשמה כחשיפה, ותשובות נכונות נרשמו כזיהוי.</p><p>השלב הבא, ליישום: ${LT === 'G' ? '<a class="btn primary" href="#scenario">תרחיש אינטראקטיבי</a>' : `<button class="btn primary" id="lapply">תרחישי החלטה בנושא – 5 דק'</button>`} <button class="btn" id="lnext">השיעור הבא: ${esc(TOPICS[nextT].short)}</button></p></div>`;
    const la = $('#lapply'); if (la) la.onclick = () => startQuick(5, 2, { comps: Object.keys(COMPS).filter(c => compTopic(c) === LT), reason: `יישום אחרי השיעור המודרך: ${TOPICS[LT].name}.` });
    $('#lnext').onclick = () => { lessonTopic = nextT; route(); };
  };
};

/* ---------------- VIEW: INTERACTIVE SCENARIO (desk applied) ---------------- */
let scen = null;
function workerProfiles() {
  const mAgo = n => { const d = new Date(); d.setMonth(d.getMonth() - n); return d; };
  const fmt = d => d.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
  return [
    { id: 'w1', name: 'דני', age: 34, cert: mAgo(8), note: 'טכנאי אחזקה, מוסמך להפעלת במה', ok: true, why: 'בגיר, ההדרכה לפני 8 חודשים ובתוקף.' },
    { id: 'w2', name: 'מוחמד', age: 41, cert: mAgo(29), note: 'חשמלאי ותיק, "עשה את זה מאה פעם"', ok: false, why: `ההדרכה מ${fmt(mAgo(29))}, יותר משנתיים, ולכן פג תוקפה. ניסיון לא מחליף אישור תקף.` },
    { id: 'w3', name: 'אור', age: 17, cert: null, note: 'עובד קיץ', ok: false, why: 'אינו בגיר.' },
    { id: 'w4', name: 'רונית', age: 29, cert: mAgo(3), note: 'דיווחה הבוקר על סחרחורת אחרי נטילת תרופה', ok: false, why: 'במצב שעלול לסכן אותה. לא עובדת היום בגובה.' },
    { id: 'w5', name: 'יגאל', age: 52, cert: mAgo(14), note: 'מנהל עבודה, יעמוד על הקרקע', ok: true, why: 'מתאים כאדם בגיר על הקרקע בקשר עין.' }
  ].map(w => Object.assign(w, { certTxt: w.cert ? fmt(w.cert) : 'אין' }));
}
VIEWS.scenario = (m) => {
  if (!scen) scen = (S.session && S.session.kind === 'scenario' && S.session.scen) || { step: 0, results: {} };
  S.session = { kind: 'scenario', scen, t: Date.now() }; saveLocal();
  const steps = ['זיהוי מפגעים', 'בחירת שיטת עבודה', 'מי עובד', 'היתר עבודה', 'סיכום'];
  m.innerHTML = `<h1>תרחיש: החלפת גופי תאורה במחסן מפעל מזון</h1>
  <p class="muted">שישה גופי תאורה בגובה 6.5 מ' מעל מדפים ומעבר מלגזות. חלקם מעל קצה יציע לא מגודר. מנהל האחזקה מבקש לבצע מחר בבוקר.</p>
  <div class="steps">${steps.map((s, i) => `<span class="${i <= scen.step ? 'on' : ''}" title="${s}"></span>`).join('')}</div>
  <div class="small muted">שלב ${scen.step + 1}: ${steps[scen.step]}</div><div class="card" id="sc" style="margin-top:8px"></div>`;
  const el = $('#sc');
  const nextStep = () => { scen.step++; route(); };
  if (scen.step === 0) hazardGame(el, { src: 'desk', onDone: r => { scen.results.hazard = r; nextStep(); } });
  else if (scen.step === 1) {
    const q = { id: 'sc_method', comp: 'C4', type: 'scenario', src: ['S11', 'S5', 'S2'], q: 'איזו שיטת עבודה תמליץ למנהל האחזקה להחלפת הגופים בגובה 6.5 מ\'?', options: [
      { t: 'במת הרמה ניידת (מספריים) עם מעקה, בהשבתת מעבר המלגזות ובגידור אזור הסכנה', ok: true, why: 'אמצעי קולקטיבי שמונע נפילה, מתאים לגובה ולמשימה החוזרת, ומטפל גם באזור הסכנה.' },
      { t: 'סולם נסמך 7 מ\' עם רתמה ועובד שמחזיק', ok: false, why: '6.5 מ\' רחוק מהסייג של 4.5 מ\', יש הטיית גוף, ועוגן מתאים לרתמה לא קיים. זה פתרון חלש.' },
      { t: 'משטח על מזלג מלגזה', ok: false, why: 'מסוכן ובדרך כלל אסור, אלא בסל ייעודי ומאושר להרמת אדם ובתנאים מלאים.' },
      { t: 'לטפס על המדפים עם רתמה המחוברת למדף', ok: false, why: 'מדף אינו נקודת עיגון ואינו דרך גישה.' }] };
    renderMCQ(el, q, { src: 'desk', onDone: r => { scen.results.method = r; nextStep(); } });
  } else if (scen.step === 2 && scen.results.method && !scen.results.method.ok && !scen.ackMethod) {
    el.innerHTML = `<div class="fb warn"><b>שים לב:</b> בחרת "${esc(scen.results.method.choice || '')}". בשטח, הבחירה הזו הייתה משנה את כל ההמשך: אילו הסמכות נדרשות, מה כתוב בהיתר ומה קורה בחירום. בהמשך התרחיש נעבוד עם במת הרמה, כי זו השיטה הנכונה כאן.</div><button class="btn primary" id="ackm">הבנתי, המשך</button>`;
    $('#ackm').onclick = () => { scen.ackMethod = true; route(); };
  } else if (scen.step === 2) {
    const W = workerProfiles();
    el.innerHTML = `<h3>סמן מי מהעובדים רשאי לעבוד מחר בבמה, ומי יכול לשמש אדם על הקרקע</h3><p class="small muted">תאריכי ההדרכה מחושבים ביחס להיום.</p>
    <table class="rtable"><tr><th></th><th>שם</th><th>גיל</th><th>הדרכה לעבודה בגובה</th><th>הערה</th></tr>${W.map(w => `<tr><td data-l="בחירה"><input type="checkbox" data-w="${w.id}" aria-label="${w.name}"></td><td data-l="שם">${w.name}</td><td data-l="גיל">${w.age}</td><td data-l="הדרכה">${w.certTxt}</td><td data-l="הערה" class="small">${esc(w.note)}</td></tr>`).join('')}</table>
    <button class="btn primary" id="wchk" style="margin-top:8px">בדוק</button><div id="wout"></div>`;
    $('#wchk').onclick = () => {
      let correct = 0;
      const rows = W.map(w => { const sel = $(`[data-w="${w.id}"]`).checked; const good = sel === w.ok; if (good) correct++; return `<li>${good ? '✅' : '❌'} <b>${w.name}</b>: ${w.ok ? 'מתאים' : 'לא מתאים'} – ${esc(w.why)}</li>`; });
      const ok = correct === W.length;
      logEvent('apply', 'C2', { ok, score: correct / W.length, src: 'desk', act: 'workers' }); save();
      $('#wout').innerHTML = `<div class="fb ${ok ? 'ok' : 'warn'}"><ul>${rows.join('')}</ul><span class="small">מקור: ${srcTags(['S1', 'S2'])}</span></div><button class="btn primary" id="wn">המשך</button>`;
      $('#wchk').disabled = true; $('#wn').onclick = nextStep;
    };
  } else if (scen.step === 3) {
    const pq = { id: 'sc_permit', comp: 'C9', type: 'open', src: ['S1', 'S2', 'S7', 'S11'], q: 'כתוב בקצרה את עיקרי היתר העבודה או הנוהל לביצוע: תנאים מוקדמים, אמצעים, בעלי תפקידים, וחירום.',
      points: [
        { t: 'תנאים מוקדמים: אישור הדרכה בתוקף, בדיקת הבמה בידי בודק מוסמך, מפעיל מוסמך', w: 1.5, kw: ['הדרכה','בודק מוסמך','תסקיר','מפעיל'] },
        { t: 'בדיקה יומית של הבמה וציוד המגן לפני העבודה', w: 1, kw: ['בדיקה יומית','לפני העבודה','לבדוק','בודקים'] },
        { t: 'אזור סכנה: השבתת מעבר המלגזות, גידור, שילוט וקסדות', w: 1.5, kw: ['מלגז','גידור','לגדר','שילוט','קסד'] },
        { t: 'ניתוק ונעילה של מעגל התאורה', w: 1, kw: ['ניתוק','לנתק','נעילה','חשמל'] },
        { t: 'עובד קשור לנקודת העיגון בסל, ואין עבודה ברוח חזקה', w: 1, kw: ['עיגון','קשור','רתום','רוח'] },
        { t: 'אדם בגיר על הקרקע בקשר עין, ומי מאשר ומפקח', w: 1, kw: ['קרקע','קשר עין','יגאל','מפקח','מנהל העבודה'] },
        { t: 'נוהל חילוץ ותקשורת חירום', w: 1, kw: ['חילוץ','חירום'] },
        { t: 'מה עושים עם הגופים מעל היציע הלא-מגודר (מעקה זמני או גישה מהבמה בלבד)', w: 1, kw: ['יציע','מעקה'] }
      ], models: { strong: 'תנאים מוקדמים: אישור הדרכה בתוקף לעובד, תסקיר בתוקף לבמה מבודק מוסמך, ומפעיל מוסמך. לפני העבודה בודקים את הבמה ואת הרתמה. משביתים את מעבר המלגזות, מגדרים ומשלטים, וכל מי שבאזור חובש קסדה. מנתקים ונועלים את מעגל התאורה. העובד קשור לנקודת העיגון בסל ולא עובדים ברוח חזקה. יגאל על הקרקע בקשר עין. הגופים מעל היציע מטופלים מהבמה בלבד, אחרי התקנת מעקה זמני. יש נוהל חילוץ, טלפון חירום, ומנהל העבודה חותם על ההיתר.', partial: 'לעבוד עם במה, לשים רתמה ולגדר.', weak: 'לעבוד בזהירות.' } };
    renderOpen(el, pq, { src: 'desk', kind: 'apply', onDone: r => { scen.results.permit = r; nextStep(); } });
  } else {
    const r = scen.results;
    el.innerHTML = `<h3>סיכום התרחיש</h3><table>
    <tr><td>זיהוי מפגעים</td><td>${r.hazard ? Math.round(r.hazard.score * 100) + '%' : '—'}</td></tr>
    <tr><td>בחירת שיטת עבודה</td><td>${r.method ? (r.method.ok ? 'נכון' : 'שגוי') : '—'}</td></tr>
    <tr><td>היתר עבודה</td><td>${r.permit ? Math.round(r.permit.score * 100) + '/100' : '—'}</td></tr></table>
    <p class="small muted">כל השלבים נרשמו כיישום במפת השליטה.</p><div class="row"><button class="btn" id="sagain">שוב מההתחלה</button><a class="btn primary" href="#sim">לסימולציית ועדה</a></div>`;
    S.session = null; saveLocal();
    $('#sagain').onclick = () => { scen = null; route(); };
  }
};

/* ---------------- VIEW: COMMITTEE SIMULATOR ---------------- */
let sim = null;
const PRESSURE = { none: { n: 'ללא לחץ זמן', s: 0 }, normal: { n: 'רגיל – 3 דקות לשאלה', s: 180 }, high: { n: 'מוגבר – 90 שניות', s: 90 } };
VIEWS.sim = (m) => {
  if (!sim || sim.phase === 'setup') return simSetup(m);
  if (sim.phase === 'run') return simRun(m);
  return simDebrief(m, sim.debrief);
};
function simSetup(m) {
  sim = sim || { phase: 'setup', len: 'short', pressure: S.settings.pressure || 'normal', mode: 'topic' };
  sim.mode = sim.mode || 'topic';
  const hasProj = !!(S.project && S.project.site);
  m.innerHTML = `<h1>סימולטור ועדת הסמכה</h1>
  <div class="card"><h3>על מה הוועדה תשאל?</h3><div class="row">${[['topic', `נושאי הקורס (${topicName(curTopic())})`], ['project', 'הגנה על פרויקט הגמר שלי']].map(([k, n]) => `<button class="chip ${sim.mode === k ? 'on' : ''}" data-mode="${k}">${n}</button>`).join('')}</div>
  ${sim.mode !== 'project' ? `<div class="row topicbar" style="margin-top:8px">${topicChips()}</div>` : ''}
  ${sim.mode === 'project' ? (hasProj ? `<p class="small muted" style="margin-top:8px">הפרויקט: ${esc(S.project.site)}. <a href="#project">עריכה</a></p>` : `<div class="fb warn">כדי לתרגל הגנה על הפרויקט, מלא קודם 4 שדות קצרים על הפרויקט שלך. <a class="btn sm primary" href="#project">מלא עכשיו</a></div>`) : ''}</div>
  <div class="card"><p>שלושה בוחנים מדומים בהתמחויות שונות. הם שואלים שאלות פתוחות, מקשיבים, מנתחים, שואלים שאלות המשך ומאתגרים טעויות. אפשר לענות בקול או בהקלדה.</p>
  <div class="row">${Object.values(EXAMINERS).map(e => `<span class="tag">${esc(e.name)}</span>`).join('')}</div>
  <h3 style="margin-top:14px">אורך</h3><div class="row">${[['short', 'תרגול קצר – 2 שאלות'], ['topic', 'תרגול תחומי – 4 שאלות'], ['full', 'ועדה מדומה מלאה – 6 שאלות']].map(([k, n]) => `<button class="chip ${sim.len === k ? 'on' : ''}" data-len="${k}">${n}</button>`).join('')}</div>
  <h3 style="margin-top:14px">לחץ זמן</h3><div class="row">${Object.entries(PRESSURE).map(([k, v]) => `<button class="chip ${sim.pressure === k ? 'on' : ''}" data-pr="${k}">${v.n}</button>`).join('')}</div>
  <p class="small muted" style="margin-top:10px">${aiAvailable() ? 'הבוחנים מופעלים בידי AI, ושאלות ההמשך נבנות לפי הפערים בתשובה שלך.' : 'שירות ה-AI לא זמין. הסימולציה תרוץ עם שאלות המשך קבועות והערכה עצמית מול מחוון.'}</p>
  <label class="small"><input type="checkbox" id="consent" ${S.settings.consent ? 'checked' : ''}> אני מסכים לשמור תמלול של תשובותיי בתחקיר (נשמר רק בחשבון שלי; ניתן למחוק בהגדרות). הקלטת קול אינה נשמרת.</label>
  <div class="row" style="margin-top:12px"><button class="btn primary big" id="simgo">היכנס לוועדה</button></div></div>
  <h2>על הוועדה האמיתית (מאומת)</h2><div class="card"><ul>${COMMITTEE_INFO.map(c => `<li>${esc(c.t)} ${srcTags([c.src])}</li>`).join('')}</ul></div>`;
  $$('[data-len]', m).forEach(b => b.onclick = () => { sim.len = b.dataset.len; route(); });
  $$('[data-mode]', m).forEach(b => b.onclick = () => { sim.mode = b.dataset.mode; route(); });
  wireTopicChips(m);
  $$('[data-pr]', m).forEach(b => b.onclick = () => { sim.pressure = b.dataset.pr; S.settings.pressure = sim.pressure; save(); route(); });
  $('#consent').onchange = e => { S.settings.consent = e.target.checked; save(); };
  $('#simgo').onclick = async () => {
    const n = { short: 2, topic: 4, full: 6 }[sim.len];
    if (sim.mode === 'project') {
      if (!hasProj) { go('project'); return; }
      $('#simgo').disabled = true; $('#simgo').textContent = 'הבוחנים קוראים את הפרויקט…';
      const qs = (await projectQuestions(n)).slice(0, n);
      sim = Object.assign(sim, { phase: 'run', qs, qi: 0, stage: 'main', turns: [], scores: [], fuIdx: 0, startedAt: Date.now() });
      route(); return;
    }
    const opens = activeQ().filter(q => q.type === 'open');
    const weakSet = new Set(weakComps().slice(0, 4).map(w => w.c));
    const ranked = opens.map(q => ({ q, s: (weakSet.has(q.comp) ? 2 : 0) + Math.random() })).sort((a, b) => b.s - a.s).map(x => x.q);
    // פיזור: קודם שאלה אחת מכל פרק, ואז השלמה
    const qs = []; const seenT = new Set();
    ranked.forEach(q => { if (qs.length < n && !seenT.has(compTopic(q.comp))) { qs.push(q); seenT.add(compTopic(q.comp)); } });
    ranked.forEach(q => { if (qs.length < n && !qs.includes(q)) qs.push(q); });
    // סדר: פתיחה בשאלה "רכה" יותר, סיום בשילוב תחומים
    qs.sort((a, b) => a.diff - b.diff);
    sim = Object.assign(sim, { phase: 'run', qs, qi: 0, stage: 'main', turns: [], scores: [], fuIdx: 0, startedAt: Date.now() });
    route();
  };
}
function simRun(m) {
  S.session = { kind: 'sim', sim, t: Date.now() }; saveLocal();
  const q = sim.qs[sim.qi];
  const ex = EXAMINERS[q.examiner || 'mgmt'];
  const isFu = sim.stage === 'fu';
  const askText = isFu ? sim.fuText : q.q;
  const secs = PRESSURE[sim.pressure].s * (isFu ? 0.6 : 1);
  m.innerHTML = `<div class="row" style="justify-content:space-between"><b>ועדה מדומה · שאלה ${sim.qi + 1}/${sim.qs.length}${isFu ? ' · שאלת המשך' : ''}</b>${secs ? `<span class="timer" id="tm">${fmtT(secs)}</span>` : ''}</div>
  <div class="steps">${sim.qs.map((_, i) => `<span class="${i <= sim.qi ? 'on' : ''}"></span>`).join('')}</div>
  <div id="conv">${sim.turns.filter(t => t.qi === sim.qi).map(turnHtml).join('')}</div>
  <div class="examiner" style="margin:10px 0"><div class="avatar">${ex.name.split(' ')[1]?.[0] || 'ב'}</div><div><div class="small muted">${esc(ex.name)}</div><div class="bubble"><b>${esc(askText)}</b></div><button class="btn sm ghost" id="say">🔊 השמע</button></div></div>
  <div class="row" style="margin-bottom:6px">${Cap.dict ? micButton('#simans').replace('btn sm mic', 'btn primary mic') : '<span class="small muted">ענה בקול לעצמך, ואז הקלד את עיקרי התשובה.</span>'}<span class="timer small" id="think"></span></div>
  <textarea id="simans" aria-label="התשובה שלך" placeholder="התשובה שלך…"></textarea>
  <div class="row" style="margin-top:8px"><button class="btn primary" id="simsub">סיימתי לענות</button><button class="btn ghost sm" id="simskip">אני לא יודע – המשך</button><button class="btn ghost sm" id="simend">סיים ועדה</button></div>
  <div id="simout"></div>`;
  wireMic(m);
  $('#say').onclick = () => Voice.speak(askText, { voice: ex.voice });
  const t0 = Date.now(); let tFirst = null, method = 'typed';
  const thinkEl = $('#think');
  const thinkT = setInterval(() => { if (tFirst || !thinkEl.isConnected) return clearInterval(thinkT); const s = Math.floor((Date.now() - t0) / 1000); thinkEl.textContent = `שתיקה: ${s} שנ'`; thinkEl.style.color = s >= 8 ? 'var(--bad)' : s >= 5 ? 'var(--warn)' : ''; if (s === 8) toast('בוועדה, שתיקה ארוכה מורגשת. התחל במשפט מסגרת: "קודם כול אגדיר את הבעיה…"'); }, 1000);
  const first = () => { if (!tFirst) { tFirst = Date.now(); thinkEl.textContent = `התחלת אחרי ${Math.round((tFirst - t0) / 1000)} שנ'`; thinkEl.style.color = ''; } };
  $('#simans').addEventListener('input', first);
  const mb = $('[data-mic]', m); if (mb) mb.addEventListener('click', () => { method = 'voice'; first(); });
  let left = secs, tmr = null;
  if (secs) tmr = setInterval(() => { left--; const t = $('#tm'); if (t) { t.textContent = fmtT(Math.max(0, left)); if (left <= 20) t.style.color = 'var(--warn)'; } if (left <= 0) { clearInterval(tmr); toast('הזמן עבר. סיים את המשפט והגש.'); } }, 1000);
  current.cleanup = () => { clearInterval(tmr); clearInterval(thinkT); Voice.stop(); };
  const submit = async (skip) => {
    clearInterval(tmr); clearInterval(thinkT);
    const ans = skip ? '(המועמד אמר שאינו יודע)' : $('#simans').value.trim();
    if (!skip && ans.length < 10) { toast('נסה לנסח תשובה, גם חלקית. בוועדה עדיף להראות דרך חשיבה.'); return; }
    $('#simsub').disabled = true; $('#simskip').disabled = true;
    const out = $('#simout');
    out.innerHTML = `<div class="fb info">${aiAvailable() ? 'הבוחנים מתייעצים…' : 'הערכה עצמית:'}</div>`;
    const history = sim.turns.filter(t => t.qi === sim.qi).flatMap(t => [{ role: 'e', text: t.ask }, { role: 'c', text: t.ans }]);
    const evalQ = isFu ? Object.assign({}, q, { q: q.q + ' | שאלת המשך: ' + askText }) : q;
    let ev = skip ? normalizeEval(q, { covered: [] }, 'self') : await aiEvaluate(evalQ, ans, history);
    const proceed = (ev) => {
      sim.turns.push({ qi: sim.qi, stage: sim.stage, ask: askText, ans: S.settings.consent ? ans : '(תמלול לא נשמר – לא ניתנה הסכמה)', ev, examiner: q.examiner, ansFull: ans, method, responseSec: tFirst ? Math.round((tFirst - t0) / 1000) : null });
      if (!isFu) {
        sim.fuText = (ev.followup && ev.by === 'ai') ? ev.followup : q.followups[sim.fuIdx++ % q.followups.length];
        sim.stage = 'fu';
      } else { sim.stage = 'main'; sim.qi++; }
      if (sim.qi >= sim.qs.length) return finishSim();
      route();
    };
    if (ev) { out.innerHTML = `<div class="fb info small">הבוחן רשם את התשובה. המשוב המלא יוצג בתחקיר.</div>`; setTimeout(() => proceed(ev), 700); }
    else {
      out.innerHTML = '';
      selfAssess(out, q, ans, false, ev2 => { out.insertAdjacentHTML('beforeend', '<button class="btn primary" id="simnx">לשאלה הבאה</button>'); $('#simnx').onclick = () => proceed(ev2); });
    }
  };
  $('#simsub').onclick = () => submit(false);
  $('#simskip').onclick = () => submit(true);
  $('#simend').onclick = () => { if (sim.turns.length) finishSim(); else { sim = null; route(); } };
}
const fmtT = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function turnHtml(t) { return `<div class="examiner" style="margin:6px 0"><div class="avatar">ב</div><div class="bubble">${esc(t.ask)}</div></div><div class="examiner" style="margin:6px 0;justify-content:flex-end"><div class="bubble me">${esc(t.ansFull || t.ans)}</div></div>`; }
function finishSim() {
  const byQ = {};
  sim.turns.forEach(t => { (byQ[t.qi] = byQ[t.qi] || []).push(t); });
  const items = Object.entries(byQ).map(([qi, ts]) => {
    const q = sim.qs[qi];
    const main = ts.find(t => t.stage === 'main'); const fu = ts.find(t => t.stage === 'fu');
    const score = main ? (fu ? 0.7 * main.ev.score + 0.3 * fu.ev.score : main.ev.score) : 0;
    const by = ts.some(t => t.ev.by === 'ai') ? 'ai' : 'self';
    const method = ts.every(t => t.method === 'voice') ? 'voice' : 'typed';
    logEvent('committee', q.comp, { score, qid: q.id, src: 'desk-sim', by, method });
    if (QMAP[q.id]) srsAnswer(q.id, score >= 0.7);
    return { qid: q.id, q: q.q, points: q.points, models: q.models, src: q.src, comp: q.comp, score, turns: ts.map(t => ({ stage: t.stage, ask: t.ask, ans: t.ans, ev: t.ev, method: t.method, responseSec: t.responseSec })) };
  });
  const avg = items.length ? items.reduce((a, i) => a + i.score, 0) / items.length : 0;
  const crit = {}; let crN = 0;
  items.forEach(i => i.turns.forEach(t => { if (t.ev.criteria && Object.keys(t.ev.criteria).length) { crN++; RUBRIC.forEach(k => crit[k] = (crit[k] || 0) + (Number(t.ev.criteria[k]) || 0)); } }));
  if (crN) RUBRIC.forEach(k => crit[k] = Math.round(crit[k] / crN * 10) / 10);
  const rs = sim.turns.map(t => t.responseSec).filter(x => x != null);
  const d = { id: uid(), t: Date.now(), len: sim.len, mode: sim.mode || 'topic', pressure: sim.pressure, avg: Math.round(avg * 100), items, crit, durMin: Math.round((Date.now() - sim.startedAt) / 60000),
    oral: { voiceTurns: sim.turns.filter(t => t.method === 'voice').length, turns: sim.turns.length, avgResponse: rs.length ? Math.round(rs.reduce((a, b) => a + b, 0) / rs.length) : null, longSilences: rs.filter(x => x >= 8).length } };
  S.debriefs.push(d); if (S.debriefs.length > 30) S.debriefs = S.debriefs.slice(-30);
  save();
  sim.phase = 'debrief'; sim.debrief = d; S.session = null; saveLocal(); route();
}
function simDebrief(m, d) {
  const weak = d.items.filter(i => i.score < 0.7);
  m.innerHTML = `<h1>תחקיר אישי – ועדה מדומה</h1><p class="small muted">${new Date(d.t).toLocaleString('he-IL')} · ${d.durMin} דקות · ${PRESSURE[d.pressure]?.n || ''}</p>
  <div class="fb warn small">זו הערכה לימודית. היא אינה ציון רשמי ואינה מנבאת הצלחה בוועדה.</div>
  <div class="card"><div class="row" style="justify-content:space-between"><b>ממוצע תוכן: ${d.avg}/100</b><span class="small muted">רף מעבר בוועדה האמיתית: 70 (בנוהל)</span></div><div class="bar" style="margin-top:6px"><i style="width:${d.avg}%"></i></div>
  ${d.oral ? `<h3 style="margin-top:12px">ביצוע בעל פה</h3><p class="small">ענית בקול ב-${d.oral.voiceTurns} מתוך ${d.oral.turns} תשובות. ${d.oral.avgResponse != null ? `זמן ממוצע עד תחילת תשובה: ${d.oral.avgResponse} שניות. ` : ''}${d.oral.longSilences ? `${d.oral.longSilences} פעמים השתיקה נמשכה 8 שניות או יותר. תרגל משפטי פתיחה כמו "קודם כול אגדיר את הבעיה".` : ''}</p>
  ${d.oral.voiceTurns < d.oral.turns ? '<p class="small muted">תשובות מוקלדות מעידות על התוכן, לא על יכולת הדיבור. בפעם הבאה נסה לענות הכול בקול.</p>' : ''}` : ''}
  ${Object.keys(d.crit || {}).length ? `<h3 style="margin-top:12px">פירוק לפי ממדים (0–4)</h3><table>${RUBRIC.map(k => `<tr><td>${k}</td><td>${d.crit[k] ?? '—'}</td><td style="width:45%"><div class="bar"><i style="width:${(d.crit[k] || 0) * 25}%"></i></div></td></tr>`).join('')}</table>` : ''}</div>
  <h2>שאלה אחר שאלה</h2>
  ${d.items.map(i => { const q = QMAP[i.qid] || { q: i.q, points: i.points || [], models: i.models || { strong: '', partial: '', weak: '' }, src: i.src || [] }; return `<details class="card" style="margin:8px 0"><summary>${esc(q.q)} — <b>${Math.round(i.score * 100)}</b></summary>
    ${i.turns.map(t => `<p class="small muted" style="margin-top:8px">${t.stage === 'fu' ? 'שאלת המשך' : 'שאלה'}: ${esc(t.ask)}</p><div class="bubble me">${esc(t.ans)}</div>
    ${t.ev.feedback ? `<p class="small" style="margin-top:6px">${esc(t.ev.feedback)}</p>` : ''}${t.ev.errors?.length ? `<p class="small" style="color:var(--bad)">טעויות: ${t.ev.errors.map(esc).join(' · ')}</p>` : ''}`).join('')}
    <p class="small"><b>נקודות שחסרו:</b></p><ul class="small">${q.points.filter((p, k) => !i.turns[0].ev.covered.includes(k)).map(p => `<li>${esc(p.t)}</li>`).join('') || '<li>אין</li>'}</ul>
    ${modelAnswersHtml(q)}<p class="small">מקורות: ${srcTags(q.src)}</p></details>`; }).join('')}
  <h2>משימות תיקון ותוכנית חזרה</h2><div class="card"><ol>
  ${weak.length ? weak.map(i => `<li>חזור על "${esc(COMPS[i.comp] || 'פרויקט הגמר')}": שיעור קצר, ואחריו תרגול יישומי (<a href="#quick" data-fix="${i.comp}">5 דקות</a>). השאלה תחזור בסימולציה הבאה.</li>`).join('') : '<li>כל השאלות מעל 70. בפעם הבאה העלה את לחץ הזמן או בחר ועדה מלאה.</li>'}
  <li>חזרה מרווחת: השאלות נכנסו ללוח החזרות. מחר תופיע חזרה קצרה.</li></ol>
  <div class="row"><button class="btn primary" id="simnew">סימולציה חדשה</button><a class="btn" href="#debriefs">כל התחקירים</a></div></div>`;
  $$('[data-fix]', m).forEach(a => a.onclick = (e) => { e.preventDefault(); const c = a.dataset.fix; startQuick(5, 2, { comps: [c], reason: `משימת תיקון מהתחקיר: "${COMPS[c]}".` }); });
  $('#simnew').onclick = () => { sim = { phase: 'setup', len: d.len, pressure: d.pressure, mode: d.mode || 'topic' }; route(); };
}

/* ---------------- OTHER VIEWS ---------------- */
VIEWS.more = (m) => {
  m.innerHTML = `<h1>עוד</h1><div class="grid g2">${NAV.slice(5).concat([['desk', 'מחשב', 'desk']]).map(([r, l, i]) => `<a class="card row" href="#${r}" style="text-decoration:none;color:inherit"><span class="gate"><span class="ico">${ICON[i]}</span></span><b>${l}</b></a>`).join('')}</div>`;
};
VIEWS.map = (m) => {
  const rd = readiness();
  const CK = Object.keys(COMPS); const msBy = Object.fromEntries(CK.map((c, i) => [c, rd.ms[i]]));
  const row = c => { const mm = msBy[c]; return `<tr><td data-l="יעד">${esc(COMPS[c])}<div class="small muted">${mm.last ? `הצלחה אחרונה לפני ${mm.days} ימים${mm.ret < 1 ? ' · דעיכה' : ''}` : mm.exposures ? 'חשיפה בלבד, עוד אין ביצוע' : 'לא התחלת'}</div></td>
  <td data-l="רמות"><div class="lvl">${LEVELS.map((l, k) => `<span class="${mm[l.k] ? (k === 0 ? 'exp' : 'on') : ''}" title="${l.n}"></span>`).join('')}</div><div class="small muted">${LEVELS.filter(l => mm[l.k]).map(l => l.n).slice(-1)[0] || '—'}</div></td>
  <td data-l="ציון"><b>${mm.score}</b>${mm.selfOnly ? '<div class="small muted">הערכה עצמית בלבד</div>' : ''}</td><td data-l="ראיות" class="small">${mm.evidence} ביצוע · ${mm.exposures} חשיפה</td></tr>`; };
  const tps = TOPIC_ORDER.filter(t => curTopic() === 'all' || t === curTopic());
  const tAvg = t => { const cs = CK.filter(c => compTopic(c) === t); return Math.round(cs.reduce((a, c) => a + msBy[c].score, 0) / cs.length); };
  m.innerHTML = `<h1>מפת שליטה – ${esc(topicName(curTopic()))}</h1>
  <div class="row topicbar" style="margin:4px 0 8px">${topicChips()}</div>
  <div class="card small"><b>ממוצע לפי פרק:</b> ${TOPIC_ORDER.map(t => `${esc(TOPICS[t].short)} <b>${tAvg(t)}</b>`).join(' · ')}</div>
  <p class="muted small">לכל יעד כשירות חמש רמות ראיה. הרמה הראשונה, "נחשפתי", מוצגת בגוון בהיר: היא נרשמת מהאזנה וקריאה ואינה נספרת בציון.</p>
  <div class="card"><table class="rtable"><tr><th>יעד כשירות</th><th style="width:36%">רמות</th><th>ציון</th><th>ראיות</th></tr>
  ${tps.map(t => `<tr class="tgroup"><th colspan="4">${esc(TOPICS[t].name)} · ממוצע ${tAvg(t)}</th></tr>${CK.filter(c => compTopic(c) === t).map(row).join('')}`).join('')}</table></div>
  <h2>איך מחושב מדד המוכנות</h2><div class="card small"><p>לכל יעד: זיהוי נכון (לפחות 2 הצלחות, והאחרונה נכונה) = 20; הסבר בלי עזרה (שאלה פתוחה ≥70, בלי לצפות בתשובה לדוגמה) = 25; יישום בתרחיש (הניסיון האחרון הצליח) = 25; שאלת ועדה בסימולטור ≥70 = 30. אחרי 14 יום בלי הצלחה הציון דועך בהדרגה עד 60% ממנו.</p>
  <p>הממוצע של היעדים הוא ${rd.avg}. <b>תנאי סף:</b> המדד לא עולה על ממוצע הביצועים בשאלות ועדה ועוד 15 נקודות, כי הוועדה בוחנת בעל פה. ${rd.capped ? `לכן המדד שלך הוא <b>${rd.score}</b>: כדי שיעלה צריך לתרגל שאלות ועדה.` : `המדד שלך: <b>${rd.score}</b>.`}</p>
  <p><b>הערכה עצמית</b> נספרת כהוכחת שליטה רק אם הצלחת בה בשני ימים שונים. הערכת בוחן AI נספרת מיד. <b>כיסוי ראיות</b> (${rd.coverage}) תלוי בכמות הביצועים ובמגוון סוגי המשימות. זה לא רווח סמך סטטיסטי.</p><p><b>מגבלות:</b> המדד מבוסס על שאלות מקוריות שנוצרו בסיוע AI ועל הערכה אוטומטית או עצמית. הוא מכסה את כל 11 פרקי הקורס (מדד כולל = ממוצע כל היעדים) ואינו הסתברות מעבר.</p></div>`;
  wireTopicChips(m);
};
VIEWS.plan = (m) => {
  const daysTo = S.settings.examDate ? Math.ceil((new Date(S.settings.examDate) - Date.now()) / DAY) : null;
  const weeks = daysTo ? Math.max(1, Math.ceil(daysTo / 7)) : null;
  const w = weakComps();
  m.innerHTML = `<h1>תוכנית לימודים</h1>
  <div class="card"><h3>מפת הקורס (מתוך תוכנית הקורס בפועל)</h3><table>${COURSE_MAP.map(c => `<tr><td>פרק ${c.id === 'K' ? 'י"א' : 'אבגדהוזחטי'['ABCDEFGHIJ'.indexOf(c.id)]}'</td><td>${esc(c.name)}</td><td>${c.built ? `<span class="tag law">פעיל – 9 מסלולים</span> <span class="small muted">${Object.keys(COMPS).filter(k => compTopic(k) === c.id).length} יעדים · ${Q.filter(q => compTopic(q.comp) === c.id).length} שאלות</span>` : '<span class="tag">טרם הושלם</span>'}</td></tr>`).join('')}</table>
  <p class="small muted">כל 11 הפרקים פעילים באותה תבנית. "עבודה בגובה" הוא המעמיק ביותר (כולל תרחיש אינטראקטיבי ושלושה שיעורי אודיו). בשאר הפרקים יש שיעור מודרך, שיעור אודיו, שאלות בכל הרמות ושאלות ועדה.</p></div>
  <h2>תוכנית שבועית גמישה</h2><div class="card">
  ${daysTo == null ? '<p>לא הוגדר תאריך יעד. <a href="#settings">הגדר תאריך</a> והתוכנית תתאים את עצמה.</p>' : `<p>${daysTo} ימים לוועדה (כ-${weeks} שבועות).</p>`}
  <ol class="small"><li><b>השבוע:</b> חיזוק "${esc(COMPS[w[0].c])}" ו"${esc(COMPS[w[1].c])}". 4 סבבי 5 דקות, שיעור אודיו אחד ותרחיש אחד במחשב.</li>
  <li><b>כל יום:</b> חזרה מרווחת (2 דקות) לשאלות שהגיע מועדן.</li><li><b>פעם בשבוע:</b> סימולציית ועדה ותחקיר.</li>
  <li><b>לקראת הוועדה:</b> ועדות מלאות בלחץ זמן מוגבר, ושילוב פרויקט הגמר (מפעל המזון) בתשובות.</li></ol></div>
  <h2>רצף ההוראה בכל נושא</h2><div class="card small"><table><tr><th>שלב</th><th>טלפון</th><th>אודיו</th><th>מחשב</th></tr>
  ${[['אבחון ידע קודם', 'סבב ראשון אדפטיבי', '—*', 'בדיקות הבנה'], ['מושגים ועקרונות', 'כרטיס מושג', 'שיעור יסוד', 'שיעור מודרך'], ['חקיקה ויישומה', 'שאלות עם מקור', 'הסבר הדין בשיעור', 'עובדות מתויגות לפי מקור'], ['המחשות מהשטח', 'זיהוי מפגעים', 'סיפור מקרה', 'תרחיש אינטראקטיבי'], ['תרגול מדורג', 'בסיסי ← יישומי ← ועדה', 'ניתוח החלטות', 'החלטות, עובדים, היתר'], ['שאלות ועדה', 'שאלה קצרה', 'דיון ועדה מדומה', 'סימולטור'], ['משוב', 'מיידי', 'ניתוח תשובות', 'AI או מחוון'], ['הערכה מסכמת', 'סיכום סבב', '—*', 'תחקיר'], ['חזרות', 'לוח חזרות', 'המשך רציף', 'משימות תיקון']].map(r => `<tr>${r.map(x => `<td>${x}</td>`).join('')}</tr>`).join('')}</table>
  <p class="muted">* באודיו אין שאלות שמחייבות תגובה (בטיחות בנהיגה). אבחון והערכה מתבצעים בתרגול שמוצע אחרי ההאזנה.</p></div>`;
};
let bankFilter = { depth: 'all', comp: 'all' };
VIEWS.bank = (m) => {
  if (bankFilter.comp !== 'all' && !inCur(bankFilter.comp)) bankFilter.comp = 'all';
  const list = activeQ().filter(q => (bankFilter.depth === 'all' || String(q.depth) === bankFilter.depth) && (bankFilter.comp === 'all' || q.comp === bankFilter.comp));
  const cov = activeComps().map(c => ({ c, n: Q.filter(q => q.comp === c).length, t: new Set(Q.filter(q => q.comp === c).map(q => q.type)).size }));
  m.innerHTML = `<h1>בנק שאלות</h1><div class="row topicbar" style="margin:4px 0 8px">${topicChips()}</div><p class="small muted">${activeQ().length} שאלות (${esc(topicName(curTopic()))}), מתוך ${Q.length} בכל הקורס. כל השאלות מקוריות ונוצרו בסיוע AI על בסיס המקורות. אף אחת מהן אינה שאלה מוועדה אמיתית.</p>
  <div class="card small"><b>כיסוי לפי יעד:</b> ${cov.map(x => `${esc(COMPS[x.c])}: ${x.n} (${x.t} סוגים)`).join(' · ')}</div>
  <div class="row" style="margin:10px 0"><select id="fd"><option value="all">כל הרמות</option>${[1, 2, 3].map(d => `<option value="${d}" ${bankFilter.depth == d ? 'selected' : ''}>${DEPTH_NAME[d]}</option>`).join('')}</select>
  <select id="fc"><option value="all">כל היעדים</option>${Object.entries(COMPS).filter(([k]) => inCur(k)).map(([k, v]) => `<option value="${k}" ${bankFilter.comp === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
  <div class="card"><table><tr><th>שאלה</th><th>רמה</th><th>סוג</th><th>קושי</th><th>מקור</th><th>ביצוע</th><th></th></tr>
  ${list.map(q => { const r = S.srs[q.id]; return `<tr><td>${esc(q.q)}</td><td>${DEPTH_NAME[q.depth]}</td><td class="small">${{ mcq: 'רב-ברירה', tf: 'נכון/לא נכון', scenario: 'תרחיש', open: 'פתוחה' }[q.type]}</td><td>${'●'.repeat(q.diff)}</td><td>${srcTags(q.src)}</td><td class="small">${r ? `${r.n} ניסיונות${r.lastOk === false ? ' · אחרון שגוי' : ''}` : '—'}</td><td><button class="btn sm" data-try="${q.id}">תרגל</button></td></tr>`; }).join('')}</table>
  <p class="small muted">לכל שאלה נשמרים: יעד, רמה, קושי, סוג, תשובה או מחוון, הסבר, מקורות, טעויות שכיחות, נימוק לכל מסיח, תאריך בדיקה (${CHECKED}) וסטטוס בקרה ("נבדקה מול מקור"). ${ORIGIN}.</p></div><div id="try"></div>`;
  wireTopicChips(m);
  $('#fd').onchange = e => { bankFilter.depth = e.target.value; route(); };
  $('#fc').onchange = e => { bankFilter.comp = e.target.value; route(); };
  $$('[data-try]', m).forEach(b => b.onclick = () => { const box = $('#try'); box.innerHTML = '<div class="card" style="margin-top:12px"></div>'; renderQuestion(box.firstChild, QMAP[b.dataset.try], { src: 'desk', onDone: () => { box.innerHTML = '<div class="fb ok">נשמר.</div>'; } }); box.scrollIntoView({ behavior: 'smooth' }); });
};
VIEWS.debriefs = (m) => {
  const ds = S.debriefs.slice().reverse();
  m.innerHTML = `<h1>משוב ותחקירים</h1>${ds.length ? `<div class="card"><table><tr><th>תאריך</th><th>אורך</th><th>ממוצע</th><th></th></tr>${ds.map(d => `<tr><td>${new Date(d.t).toLocaleDateString('he-IL')}</td><td>${{ short: 'קצר', topic: 'תחומי', full: 'מלא' }[d.len]}</td><td>${d.avg}</td><td><button class="btn sm" data-d="${d.id}">פתח</button></td></tr>`).join('')}</table></div>` : '<p class="muted">עוד אין תחקירים. <a href="#sim">התחל סימולציה</a></p>'}`;
  $$('[data-d]', m).forEach(b => b.onclick = () => { sim = { phase: 'debrief', debrief: S.debriefs.find(d => d.id === b.dataset.d) }; go('sim'); });
};
VIEWS.sources = (m) => {
  m.innerHTML = `<h1>ספריית מקורות</h1><p class="small muted">כל עובדה מקצועית מתויגת לפי סוג (חובה בדין / חומר הקורס / עיקרון מקצועי / הסבר לימודי) וסטטוס אימות. תאריך בדיקה: ${CHECKED}. פרשנות אינה מוצגת כהוראת חוק.</p>
  <div class="card"><table><tr><th>מזהה</th><th>מקור</th><th>סוג</th><th>פרסום</th><th>סטטוס</th></tr>${Object.entries(SOURCES).map(([k, s]) => `<tr id="src-${k}"><td><b>${k}</b></td><td><a href="${s.url}" target="_blank" rel="noopener">${esc(s.title)}</a><div class="small muted">${esc(s.via)}</div></td><td class="small">${esc(s.kind)}</td><td class="small">${esc(s.published)}</td><td class="small">${STATUS_LABEL[s.status]}</td></tr>`).join('')}</table></div>
  <h2>עובדות במאגר (${FACTS.length})</h2>${TOPIC_ORDER.map(t => `<details${t === (curTopic() === 'all' ? '' : curTopic()) ? ' open' : ''}><summary><b>${esc(TOPICS[t].name)}</b> <span class="small muted">(${FACTS.filter(f => compTopic(f.comp) === t).length})</span></summary>${Object.keys(COMPS).filter(c => compTopic(c) === t).map(c => `<h3 style="margin-top:14px">${esc(COMPS[c])}</h3>${FACTS.filter(f => f.comp === c).map(factHtml).join('')}`).join('')}</details>`).join('')}
  <h2>פערים וסתירות שזוהו</h2><div class="card small"><ul>
  <li>חוברת הקורס מציינת מרחקי בטיחות מקווי חשמל (3.25 מ' עד 33 ק"ו, 5 מ' מעל) ותוקף בדיקת במה (6/14 חודשים). אלה לא אומתו מול נוסח רשמי, ולכן לא נכללו כעובדות "חובה בדין".</li>
  <li>החוברת מנסחת את פטורי הסולמות (4.5 / 6 / 10 מ') בצורה לא אחידה. באפליקציה הם מוצגים לפי ציטוטי התקנות בפרסומי מוס"ל (S5, S6).</li>
  <li><b>אימות 16.11.2026:</b> עובדות החקיקה המרכזיות אומתו מול הנוסח (S26–S37): ספי מינוי ממונה (50), ועדת בטיחות (25 לפחות, 8 ישיבות בשנה), צו שיפור (לפחות 14 יום), דיווח תאונה (יותר מ-3 ימי אי כושר), מכונת הרמה ודוד קיטור (14 חודשים), קולט אוויר (26 חודשים), רעש (85 dB ל-8 שעות, 3 dB), הדרכה שנתית, תוכנית לניהול הבטיחות, ניטור וצמ"א.</li>
  <li>תיקונים שבוצעו מול חוברת הקורס: ועדת בטיחות היא מ-25 עובדים <i>לפחות</i> (לא "יותר מ-25"). ימי השתלמות לממונה: 12 בכל 3 שנים מאז תיקון 2025 (לא 8 בשנה). בבנייה: חובת ממונה גם באתר עם 50 עובדים, והאכיפה באתרים של 50–100 נדחתה ל-15.10.2027. התוכנית לניהול הבטיחות מאושרת אחרי התייעצות עם ועדת הבטיחות, ונבחנת ומתעדכנת מדי שנה ובכל נושא חדש. ההגדרות של תאונה, מפגע וסיכון עודכנו לפי תקנות 2013. על מחלת מקצוע מודיעים לרופא הממשלתי ולמפקח האזורי.</li>
  <li>עדיין מסומן "טעון אימות" או "אומת חלקית": בדיקה של 6 חודשים לציוד מסוים בבנייה, מקרים מסוכנים, ערכי חמצן במקום מוקף (19.5%–23%) ו-10% מה-LEL בעבודה חמה, וחלק מתפקידי הממונה לפי החוברת.</li>
  <li>נוהל הקורסים (S3) עודכן ב-2017. ב-2025 תוקנו תקנות הממונים (S8), ויש לוודא מול המכללה אם השתנה דבר בהליך הוועדה.</li></ul></div>`;
};
VIEWS.settings = (m) => {
  m.innerHTML = `<h1>הגדרות ופרטיות</h1>
  <div class="card"><h3>פרופיל</h3><p class="small">${esc(S.profile?.nick || '')} · ${esc(S.profile?.stage || '')} · ${esc(S.profile?.bg || '')} · יעד יומי ${S.profile?.goal || 20} דק'</p><a class="btn sm" href="#welcome">ערוך פרופיל</a>
  <h3 style="margin-top:12px">יעד</h3><label>תאריך ועדה (אופציונלי): <input type="date" id="ed" value="${S.settings.examDate}"></label></div>
  <div class="card" style="margin-top:10px"><h3>מצב מערכת</h3><div class="kv"><span>סנכרון:</span><span>${esc(Sync.label)}</span><span>מורה ובוחן AI:</span><span>${aiAvailable() ? 'זמין' : 'לא זמין – תוכן ושאלות שמורים זמינים, הערכה עצמית במקום AI'}</span><span>הקראה:</span><span>${{ claude: 'קול Claude', browser: 'קול עברי של המכשיר', 'browser-nohe': 'קול המכשיר (לא נמצא קול עברי)', none: 'לא זמינה – טקסט בלבד' }[Voice.mode()]}</span><span>הכתבה:</span><span>${Cap.dict ? 'זמינה' : 'לא זמינה כאן – הקלדה'}</span><span>חיבור:</span><span>${navigator.onLine === false ? 'לא מקוון – התוכן זמין במלואו' : 'מקוון'}</span></div></div>
  ${window.__standalone ? aiSettingsHtml() : ''}
  ${window.__audioStore && window.__audioStore.isAdmin() ? naturalVoiceHtml() : ''}
  <div class="card" style="margin-top:10px"><h3>פרטיות ונתונים</h3><ul class="small">${window.__standalone ? `<li>${window.__auth.isGuest() ? 'מחובר כאורח: ההתקדמות נשמרת בענן אבל קשורה לדפדפן הזה בלבד. כדי לסנכרן בין מכשירים, התנתק והתחבר עם Google. ההתקדמות שצברת כאורח לא תעבור לחשבון.' : 'מחובר כ-' + esc(window.__auth.email() || '') + '.'} ההתקדמות נשמרת באזור פרטי שרק אתה יכול לקרוא.</li><li>אם חיברת מפתח AI, הוא נשמר רק בדפדפן הזה, ותשובות פתוחות נשלחות ישירות ממנו לספק שבחרת (Google או Anthropic).</li>` : `<li>ההתקדמות נשמרת בחשבון Claude שלך, באזור פרטי שאפילו בעל הדף לא רואה, ובמכשיר.</li><li>תשובות לשאלות פתוחות נשלחות להערכה ל-Claude בלבד, ולא לשירות חיצוני אחר.</li>`}<li>הקלטות קול לא נשמרות. ההכתבה הופכת דיבור לטקסט, ותמלול נשמר בתחקיר רק אם הסכמת.</li><li>העובדות באפליקציה נכתבו מראש, עם הפניה למקור.</li></ul>
  <label class="small"><input type="checkbox" id="cs" ${S.settings.consent ? 'checked' : ''}> שמירת תמלול תשובות בתחקירים</label>
  <div class="row" style="margin-top:10px"><button class="btn" id="exp">העתק קוד גיבוי</button><button class="btn" id="imp">שחזר מקוד גיבוי</button><button class="btn" id="deltr">מחק תמלולים מתחקירים</button><button class="btn" id="delall" style="color:var(--bad)">מחק את כל הנתונים</button>${window.__standalone ? '<button class="btn" id="signout">התנתק</button>' : ''}</div><div id="confirm"></div></div>`;
  if (window.__standalone) wireAiSettings(m);
  if (window.__audioStore && window.__audioStore.isAdmin()) wireNaturalVoice(m);
  const so = $('#signout'); if (so) so.onclick = () => window.__auth.signOut();
  $('#ed').onchange = e => { S.settings.examDate = e.target.value; save(); toast('נשמר'); };
  $('#cs').onchange = e => { S.settings.consent = e.target.checked; save(); };
  $('#exp').onclick = () => navigator.clipboard.writeText(JSON.stringify(S)).then(() => toast('קוד הגיבוי הועתק'), () => { $('#confirm').innerHTML = `<p class="small">ההעתקה נחסמה. סמן והעתק ידנית:</p><textarea readonly style="min-height:80px">${esc(JSON.stringify(S))}</textarea>`; });
  $('#imp').onclick = () => {
    $('#confirm').innerHTML = `<p class="small">הדבק את קוד הגיבוי. הנתונים ימוזגו עם ההתקדמות הקיימת, ושום דבר לא יימחק.</p><textarea id="impta" style="min-height:80px"></textarea><button class="btn sm primary" id="impgo">שחזר</button>`;
    $('#impgo').onclick = () => { try { const r = JSON.parse($('#impta').value); if (!r || !r.v) throw 0; r.updatedAt = Date.now(); mergeRemote(r); save(); toast('השחזור הושלם'); route(); } catch (e) { toast('הקוד לא תקין'); } };
  };
  $('#deltr').onclick = () => { S.debriefs.forEach(d => d.items.forEach(i => i.turns.forEach(t => t.ans = '(נמחק)'))); save(); toast('התמלולים נמחקו'); };
  $('#delall').onclick = () => {
    $('#confirm').innerHTML = `<div class="fb no">כל ההתקדמות, החזרות והתחקירים יימחקו מכל המכשירים. <button class="btn sm" id="yes">כן, מחק</button> <button class="btn sm" id="no">ביטול</button></div>`;
    $('#no').onclick = () => $('#confirm').innerHTML = '';
    $('#yes').onclick = () => { S = DEF(); S.updatedAt = Date.now(); save(); if (Sync.ref) Sync.ref.set(JSON.parse(JSON.stringify(S))).catch(() => { }); toast('הנתונים נמחקו'); route(); };
  };
};

/* ---------------- ACCESS GATE ---------------- */
VIEWS.gate = (m) => {
  if (Account.state === 'checking') { m.innerHTML = `<div class="card" style="margin-top:30px;text-align:center"><h1>מתחבר לחשבון Claude…</h1><p class="muted">בודק הרשאות ושומר מקום להתקדמות שלך.</p></div>`; return; }
  const msg = {
    'no-claude': ['האפליקציה פועלת רק בתוך Claude', 'פתח את הקישור כשאתה מחובר לחשבון Claude. כך ההתקדמות נשמרת בחשבון שלך ועוברת בין הטלפון למחשב.'],
    'signed-out': ['נדרשת התחברות לחשבון Claude', 'התחבר ל-Claude באותו דפדפן ופתח את הקישור שוב. ההתקדמות, האבחון וההמלצות נשמרים באזור פרטי בחשבון שלך, ואף אחד אחר לא רואה אותם.'],
    'view-only': ['יש לך הרשאת צפייה בלבד', 'אתה מחובר, אבל ההרשאה שקיבלת לא מאפשרת לשמור התקדמות. בקש ממי ששיתף איתך את הקישור לתת לך הרשאת שימוש (Contributor).']
  }[Account.reason] || ['אין גישה', ''];
  if (window.__standalone) {
    const conf = window.__auth && window.__auth.configured();
    m.innerHTML = `<div class="card" style="margin-top:30px"><div style="text-align:center"><svg class="logo-big" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="112" fill="#0f6e6a"/><path d="M256 64 L410 120 V252 C410 350 340 418 256 450 C172 418 102 350 102 252 V120 Z" fill="none" stroke="#fff" stroke-width="20" stroke-linejoin="round"/><path d="M184 200 C184 156 216 128 256 128 C296 128 328 156 328 200 Z" fill="#f5b72e"/><rect x="168" y="196" width="176" height="18" rx="9" fill="#f5b72e"/><path d="M159.18 336L140.58 336L140.64 270.16L170.06 270.16Q182.91 270.16 189.58 276.47Q196.25 282.79 196.31 295.04L196.31 336L177.77 336L177.71 293.45Q177.71 289.08 175.75 286.84Q173.78 284.59 170.06 284.59L159.18 284.59L159.18 336M217.31 289.35L206.10 285.03Q208.67 281.42 210.28 276.69Q211.89 271.96 211.89 267.91L211.89 256.43L228.41 256.43L228.36 266.16Q228.36 270.27 226.93 274.61Q225.51 278.96 223.02 282.79Q220.54 286.62 217.31 289.35M241.97 289.35L230.76 285.03Q233.39 281.42 234.97 276.69Q236.56 271.96 236.56 267.91L236.56 256.43L253.18 256.43L253.07 266.16Q253.07 270.27 251.63 274.61Q250.18 278.96 247.69 282.79Q245.20 286.62 241.97 289.35M317.33 336L260.24 336L260.24 321.56L291.14 321.56L291.14 293.29Q291.14 288.97 288.81 286.78Q286.49 284.59 281.84 284.59L263.79 284.59L263.79 270.16L283.21 270.16Q295.73 270.16 302.73 276.47Q309.73 282.79 309.73 294.16L309.73 320.96L317.33 322.16L317.33 336M378.69 336L321.60 336L321.60 321.56L352.50 321.56L352.50 293.29Q352.50 288.97 350.17 286.78Q347.85 284.59 343.20 284.59L325.15 284.59L325.15 270.16L344.57 270.16Q357.09 270.16 364.09 276.47Q371.09 282.79 371.09 294.16L371.09 320.96L378.69 322.16" fill="#fff"/></svg></div><h1 style="text-align:center">בב״ח – בוב בטיחות חניכים</h1><p style="text-align:center" class="muted">הכנה לוועדת ההסמכה לממונים על הבטיחות בעבודה</p>
    <p>הכנה לוועדת ההסמכה בתרגול אדפטיבי: שאלון אבחון, תרגולים קצרים בטלפון, שיעורי אודיו לדרך, תרחישים, סימולטור ועדה, ודוח התקדמות עם המלצות למיקוד.</p>
    <p class="small muted">כדי לשמור את ההתקדמות ולסנכרן בין הטלפון למחשב צריך להתחבר עם חשבון Google. ההתקדמות שלך פרטית, ואף משתמש אחר לא רואה אותה.</p>
    ${window.__auth.inApp ? '<div class="fb warn">נראה שפתחת את הקישור מתוך וואטסאפ או רשת חברתית. התחברות עם Google לא עובדת שם: לחץ על ⋮ או על סמל השיתוף ובחר "פתח בדפדפן" (Chrome או Safari). אפשר גם להמשיך בלי Google.</div>' : ''}
    ${conf ? `<div class="row" style="margin-top:10px"><button class="btn primary big" id="gsign">התחבר עם Google</button><button class="btn big" id="guest">המשך בלי Google</button></div>
    <p class="small muted" style="margin-top:8px">"בלי Google": ההתקדמות נשמרת בענן אבל קשורה לדפדפן הזה בלבד, ולא תעבור למכשיר אחר. אם תמחק נתוני גלישה, היא תאבד.</p><div id="gerr">${window.__auth.lastError() ? '<div class="fb no">ההתחברות לא הושלמה. נסה שוב, או המשך בלי Google.</div>' : ''}</div>` : '<div class="fb no">האתר עדיין לא חובר למסד הנתונים.</div>'}</div>`;
    const fail = e => { $('#gerr').innerHTML = `<div class="fb no">ההתחברות נכשלה (${esc(e && e.code || '')}). נסה שוב, פתח בדפדפן Chrome או Safari, או המשך בלי Google.</div>`; };
    const b = $('#gsign'); if (b) b.onclick = () => window.__auth.signIn().catch(fail);
    const g = $('#guest'); if (g) g.onclick = () => window.__auth.signInGuest().catch(fail);
    return;
  }
  m.innerHTML = `<div class="card" style="margin-top:30px"><h1>${msg[0]}</h1><p>${msg[1]}</p>
  <p class="small muted">כשמחוברים, האפליקציה כוללת: הרשמה, שאלון אבחון, תרגול אדפטיבי, אודיו, סימולטור ועדה, דוח התקדמות והמלצות למיקוד ולהעמקה.</p></div>`;
};

/* ---------------- REGISTRATION ---------------- */
const STAGES = ['באמצע הקורס', 'סיימתי את הקורס, לפני המבחן בכתב', 'עברתי את המבחן בכתב, לפני הוועדה', 'חזרה לוועדה (ניסיון נוסף)'];
const BACKGROUNDS = ['חדש בתחום הבטיחות', 'עד 3 שנות ניסיון בבטיחות', 'יותר מ-3 שנות ניסיון בבטיחות'];
const FIELDS = ['תעשייה ומפעלים', 'בנייה', 'חקלאות', 'מעבדות ומוסדות', 'ביטחון וצבא', 'מוסדות ציבור', 'אחר'];
VIEWS.welcome = (m) => {
  const p = S.profile || {};
  const opt = (arr, v) => arr.map(x => `<option ${x === v ? 'selected' : ''}>${x}</option>`).join('');
  m.innerHTML = `<h1>${S.profile ? 'עריכת פרופיל' : 'ברוך הבא – הרשמה קצרה'}</h1>
  <p class="muted">רק כינוי, ואפשר להתחיל. שאר הפרטים עוזרים להתאים את התוכנית, ואפשר להשלים אותם בהמשך.</p>
  <form class="card" id="reg" novalidate>
    <label>איך לקרוא לך? <span class="small muted">(כינוי, לא חובה שם מלא)</span><br><input type="text" id="nick" maxlength="30" value="${esc(p.nick || '')}" required style="width:100%;margin-top:4px"></label>
    <details style="margin-top:12px" ${S.profile ? 'open' : ''}><summary>פרטים נוספים (אופציונלי)</summary>
    <div class="grid g2" style="margin-top:8px">
      <label>היכן אתה בתהליך?<br><select id="stage" style="width:100%">${opt(STAGES, p.stage)}</select></label>
      <label>רקע מקצועי<br><select id="bg" style="width:100%">${opt(BACKGROUNDS, p.bg)}</select></label>
      <label>תחום עיסוק עיקרי<br><select id="field" style="width:100%">${opt(FIELDS, p.field)}</select></label>
      <label>תאריך ועדה (אם ידוע)<br><input type="date" id="exam" value="${esc(S.settings.examDate || '')}" style="width:100%"></label>
    </div>
    <div style="margin-top:12px">זמן יומי שאתה מתכנן להשקיע:<div class="row" style="margin-top:6px">${[10, 20, 30, 60].map(n => `<button type="button" class="chip ${(p.goal || 20) === n ? 'on' : ''}" data-goal="${n}">${n} דק'</button>`).join('')}</div></div></details>
    <p class="small muted" style="margin-top:12px">${window.__standalone ? 'בוחן ה-AI אופציונלי: אפשר לחבר בהגדרות מפתח אישי (Gemini חינמי, או Claude בתשלום). בלי מפתח ההערכה נעשית מול מחוון. הקלטות קול לא נשמרות.' : 'שים לב: תשובות פתוחות נשלחות ל-Claude לצורך הערכה לימודית. הקלטות קול לא נשמרות.'}</p>
    <div class="row" style="margin-top:10px">${S.profile ? '<button class="btn primary" type="submit">שמור</button>' : '<button class="btn primary" type="button" id="skipdiag">התחל לתרגל</button><button class="btn" type="submit">אבחון קצר קודם (3 דק\')</button>'}</div>
    <div id="regerr"></div>
  </form>`;
  let goal = p.goal || 20;
  $$('[data-goal]', m).forEach(b => b.onclick = () => { goal = +b.dataset.goal; $$('[data-goal]', m).forEach(x => x.classList.toggle('on', x === b)); });
  const store = () => {
    const nick = $('#nick').value.trim();
    if (!nick) { $('#regerr').innerHTML = '<div class="fb no">נא למלא כינוי.</div>'; $('#nick').focus(); return false; }
    S.profile = { nick, stage: $('#stage').value, bg: $('#bg').value, field: $('#field').value, goal, at: Date.now(), created: p.created || Date.now() };
    S.settings.examDate = $('#exam').value; save(); return true;
  };
  $('#reg').onsubmit = e => { e.preventDefault(); if (!store()) return; if (S.diag && p.nick) { toast('נשמר'); go('home'); } else go('diag'); };
  const sk = $('#skipdiag'); if (sk) sk.onclick = () => { if (store()) go('home'); };
};

/* ---------------- DIAGNOSTIC ---------------- */
const DIAG_Q = ['Aq1', 'Bq3', 'Cq1', 'Dq1', 'Eq4', 'Fq2', 'q1', 'Hq1', 'Iq4', 'Jq3', 'Kq1'];  // שאלה אחת מכל פרק
const CONF = [['sure', 'בטוח'], ['mid', 'די בטוח'], ['guess', 'מנחש']];
let diagRun = null;
VIEWS.diag = (m) => {
  if (!diagRun) {
    m.innerHTML = `<h1>שאלון אבחון</h1><div class="card"><p>11 שאלות קצרות, אחת מכל פרק בקורס. בכל שאלה תסמן גם עד כמה אתה בטוח בתשובה. בסוף אפשר לנסות שאלת ועדה אחת, או לדלג.</p>
    <p class="small muted">התשובות הנכונות יוצגו בסוף, בדוח. משך משוער: 5 דקות.</p><button class="btn primary big" id="dstart">התחל</button></div>`;
    $('#dstart').onclick = () => { diagRun = { i: 0, ans: [], t0: Date.now() }; route(); };
    return;
  }
  const d = diagRun;
  if (d.i < DIAG_Q.length) {
    const q = QMAP[DIAG_Q[d.i]];
    const opts = shuffle(q.options);
    m.innerHTML = `<div class="row" style="justify-content:space-between"><h1 style="font-size:1.05rem;margin:0">אבחון · ${d.i + 1}/${DIAG_Q.length + 1}</h1><span class="small muted">${esc(COMPS[q.comp])}</span></div>
    <div class="steps">${Array.from({ length: DIAG_Q.length + 1 }, (_, i) => `<span class="${i < d.i ? 'on' : ''}"></span>`).join('')}</div>
    <div class="card"><h3>${esc(q.q)}</h3>${opts.map((o, i) => `<button class="opt" data-i="${i}">${esc(o.t)}</button>`).join('')}
    <div id="conf" class="hide" style="margin-top:10px"><b>עד כמה אתה בטוח?</b><div class="row" style="margin-top:6px">${CONF.map(([k, n]) => `<button class="chip" data-c="${k}">${n}</button>`).join('')}</div></div>
    <button class="btn ghost sm" id="dunk" style="margin-top:8px">לא יודע</button></div>`;
    let pick = null;
    $$('.opt', m).forEach(b => b.onclick = () => { pick = +b.dataset.i; $$('.opt', m).forEach(x => x.style.outline = ''); b.style.outline = '2px solid var(--accent)'; $('#conf').classList.remove('hide'); });
    const record = (ok, conf, chosen) => {
      d.ans.push({ qid: q.id, comp: q.comp, ok, conf, chosen });
      logEvent(q.type === 'scenario' ? 'apply' : 'recognize', q.comp, { ok, qid: q.id, src: 'diag', conf, quality: q.type === 'scenario' ? 'choice' : undefined });
      srsAnswer(q.id, ok, conf); save(); d.i++; route();
    };
    $$('[data-c]', m).forEach(b => b.onclick = () => { if (pick != null) record(!!opts[pick].ok, b.dataset.c, opts[pick].t); });
    $('#dunk').onclick = () => record(false, 'unknown', null);
    return;
  }
  if (d.i === DIAG_Q.length) {
    const q = QMAP.Co1;
    m.innerHTML = `<div class="row" style="justify-content:space-between"><h1 style="font-size:1.05rem;margin:0">אבחון · שאלת ועדה</h1><button class="btn ghost sm" id="dskip">דלג וסיים</button></div><div class="card" id="dopen"></div>`;
    renderOpen($('#dopen'), q, { src: 'diag', onDone: r => { d.open = { score: r.score, by: r.eval?.by }; d.i++; finishDiag(); } });
    $('#dskip').onclick = () => { d.i++; finishDiag(); };
    return;
  }
  finishDiag();
};
function finishDiag() {
  const d = diagRun; if (!d) return go('report');
  S.diag = { t: Date.now(), ans: d.ans, open: d.open || null, mins: Math.round((Date.now() - d.t0) / 60000) };
  save(); diagRun = null; go('report');
}
function levelLabel(score, diagPct) {
  const x = Math.max(score, diagPct * 0.6);
  return x >= 75 ? 'מוכנות גבוהה – שלב הליטוש' : x >= 50 ? 'בסיס טוב – שלב היישום' : x >= 25 ? 'ידע חלקי – שלב החיזוק' : 'נקודת פתיחה – שלב היסודות';
}

/* ---------------- PROGRESS REPORT ---------------- */
VIEWS.report = (m) => {
  const rd = readiness();
  const D = S.diag;
  const diagOk = D ? D.ans.filter(a => a.ok).length : 0;
  const diagPct = D ? Math.round(diagOk / D.ans.length * 100) : 0;
  const now = Date.now();
  const perf = S.events.filter(e => e.kind !== 'exposure');
  const okOf = e => e.ok === true || (e.score != null && e.score >= 0.7);
  const win = (a, b) => perf.filter(e => e.t > now - a * DAY && e.t <= now - b * DAY);
  const w1 = win(7, 0), w0 = win(14, 7);
  const acc = arr => arr.length ? Math.round(arr.filter(okOf).length / arr.length * 100) : null;
  const a1 = acc(w1), a0 = acc(w0);
  const bySrc = k => S.events.filter(e => e.t > now - 7 * DAY && (k === 'audio' ? e.src === 'audio' : k === 'phone' ? e.src === 'phone' || e.src === 'diag' : (e.src || '').startsWith('desk') || e.src === 'lesson' || e.src === 'tutor')).length;
  const activeDays = new Set(S.events.filter(e => e.t > now - 7 * DAY).map(e => new Date(e.t).toDateString())).size;
  const confEv = S.events.filter(e => e.conf && e.conf !== 'unknown');
  const over = confEv.filter(e => e.conf === 'sure' && !e.ok).length;
  const under = confEv.filter(e => e.conf === 'guess' && e.ok).length;
  const sureAcc = acc(confEv.filter(e => e.conf === 'sure'));
  const comps = activeComps().map(c => ({ c, m: mastery(c), diag: D?.ans.find(a => a.comp === c) }));
  const strengths = comps.filter(x => x.m.score >= 45 || (x.diag?.ok && x.diag.conf === 'sure')).slice(0, 4);
  const focus = comps.slice().sort((a, b) => (a.m.score - (a.diag?.ok ? 10 : 0) + (a.diag && a.diag.conf === 'sure' && !a.diag.ok ? -15 : 0)) - (b.m.score - (b.diag?.ok ? 10 : 0) + (b.diag && b.diag.conf === 'sure' && !b.diag.ok ? -15 : 0))).filter(x => x.m.score < 70).slice(0, 3);
  const deepen = comps.filter(x => (x.m.recognized || x.m.applied || x.diag?.ok) && !x.m.committee && !focus.includes(x)).slice(0, 3);
  const whyFocus = x => {
    if (x.diag && !x.diag.ok && x.diag.conf === 'sure') return 'באבחון ענית בביטחון מלא ובטעות. זו טעות מסוכנת במיוחד בוועדה.';
    if (x.diag && !x.diag.ok) return 'טעית בשאלת האבחון בנושא הזה.';
    const f = recentFailures().find(r => r.c === x.c); if (f) return `טעית לאחרונה ${f.fails > 1 ? f.fails + ' פעמים' : ''} ועדיין לא הצלחת מאז.`;
    if (x.m.exposures && !x.m.evidence) return 'נחשפת לחומר (האזנה או קריאה), אבל עוד לא תרגלת אותו.';
    if (!x.m.evidence) return 'עוד לא תרגלת את הנושא.';
    return `מדד השליטה נמוך (${x.m.score}/100).`;
  };
  const daysTo = S.settings.examDate ? Math.ceil((new Date(S.settings.examDate) - now) / DAY) : null;
  const danger = comps.filter(x => x.diag && !x.diag.ok && x.diag.conf === 'sure');
  const hyperQs = Q.filter(q => S.srs[q.id] && S.srs[q.id].hyper);
  const top = danger[0] || focus[0];
  const noCommittee = !comps.some(x => x.m.committee);
  const verdict = top ? { text: `הדבר האחד שהכי חשוב עכשיו: "${COMPS[top.c]}".`, why: whyFocus(top), btn: `<button class="btn primary" data-focus="${top.c}">תרגל את זה עכשיו – 5 דק'</button>` }
    : noCommittee ? { text: 'הדבר האחד שהכי חשוב עכשיו: לתרגל שאלות ועדה בעל פה.', why: 'יש לך בסיס טוב, אבל עוד אין ראיה לביצוע מול שאלות ועדה, ולכן המדד נעצר.', btn: '<a class="btn primary" href="#sim">לסימולטור הוועדה</a>' }
    : { text: 'אתה במצב טוב בנושא הזה. הדבר הבא: ועדה מלאה בלחץ זמן.', why: '', btn: '<a class="btn primary" href="#sim">לסימולטור הוועדה</a>' };
  m.innerHTML = `<h1 tabindex="-1">דוח התקדמות${S.profile ? ' – ' + esc(S.profile.nick) : ''}</h1>
  <p class="small muted">נכון ל-${new Date().toLocaleDateString('he-IL')}. ${daysTo != null && daysTo >= 0 ? `${daysTo} ימים לוועדה.` : ''} זה דוח לימודי, לא ציון רשמי.</p>
  <div class="card" style="border-color:var(--accent)"><h3 style="margin:0 0 6px">${esc(verdict.text)}</h3>${verdict.why ? `<div class="reason">${esc(verdict.why)}</div>` : ''}${verdict.btn}</div>
  ${danger.length || hyperQs.length ? `<div class="fb no" style="margin-top:10px"><b>אזור סכנה – היית בטוח וטעית:</b> ${[...new Set(danger.map(x => COMPS[x.c]).concat(hyperQs.map(q => COMPS[q.comp])))].map(esc).join(' · ')}. בוועדה זה הסוג המסוכן ביותר של טעות, כי היא נשמעת משכנעת.</div>` : ''}
  <details style="margin-top:14px"><summary><b>פירוט מלא: רמה, אבחון, מיקוד, העמקה וביטחון</b></summary>
  <div class="grid g3">
    <div class="card"><div class="small muted">רמה נוכחית</div><h3 style="margin-top:4px">${levelLabel(rd.score, diagPct)}</h3><div class="small muted">מדד ראיות לשליטה ${rd.score}/100 · כיסוי ראיות ${rd.coverage}</div><div class="bar" style="margin-top:6px"><i style="width:${rd.score}%"></i></div></div>
    <div class="card"><div class="small muted">אבחון ראשוני</div>${D ? `<h3 style="margin-top:4px">${diagOk}/${D.ans.length} נכונות (${diagPct}%)</h3><div class="small muted">${D.open ? `שאלת ועדה: ${Math.round(D.open.score * 100)}/100` : 'שאלת הוועדה דולגה'} · ${new Date(D.t).toLocaleDateString('he-IL')}</div>` : `<p>טרם בוצע.</p><a class="btn sm primary" href="#diag">התחל אבחון</a>`}</div>
    <div class="card"><div class="small muted">7 הימים האחרונים</div><h3 style="margin-top:4px">${activeDays} ימי לימוד · ${w1.length} תרגולים</h3><div class="small muted">דיוק: ${a1 == null ? '—' : a1 + '%'}${a0 != null && a1 != null ? ` (לעומת ${a0}% בשבוע הקודם ${a1 > a0 ? '↑' : a1 < a0 ? '↓' : '='})` : ''}<br>טלפון ${bySrc('phone')} · אודיו ${bySrc('audio')} · מחשב ${bySrc('desk')}</div></div>
  </div>
  <h2>🎯 נושאים למיקוד</h2>
  <div class="card">${focus.length ? focus.map(x => `<div style="padding:10px 0;border-bottom:1px solid var(--line)"><b>${esc(COMPS[x.c])}</b> <span class="small muted">· ${x.m.score}/100</span><div class="reason">${esc(whyFocus(x))}</div><div class="row"><button class="btn sm primary" data-focus="${x.c}">תרגול ממוקד – 5 דק'</button><a class="btn sm" href="#lesson">חזרה בשיעור המודרך</a></div></div>`).join('') : '<p>אין יעדים חלשים כרגע. עבור להעמקה.</p>'}</div>
  <h2>📈 נושאים להעמקה</h2>
  <div class="card">${deepen.length ? deepen.map(x => `<div style="padding:10px 0;border-bottom:1px solid var(--line)"><b>${esc(COMPS[x.c])}</b><div class="reason">אתה מזהה ${x.m.applied ? 'ומיישם ' : ''}נכון, אבל עוד לא הוכחת שליטה מול שאלות ועדה עם שאלות המשך. זה השלב הבא.</div><div class="row"><button class="btn sm primary" data-deep="${x.c}">שאלת ועדה קצרה</button><a class="btn sm" href="#sim">סימולציית ועדה</a></div></div>`).join('') : '<p class="small muted">יופיע אחרי שתצליח בשאלות זיהוי או יישום.</p>'}</div>
  <h2>✅ חוזקות</h2><div class="card">${strengths.length ? `<ul>${strengths.map(x => `<li>${esc(COMPS[x.c])}${x.m.committee ? ' – כולל שאלות ועדה' : ''}</li>`).join('')}</ul>` : '<p class="small muted">עוד אין מספיק ראיות.</p>'}</div>
  <h2>ביטחון מול ביצוע</h2><div class="card small">${confEv.length ? `<p>כשסימנת "בטוח" צדקת ב-${sureAcc ?? '—'}% מהמקרים.</p><p>${over ? `<b>${over}</b> פעמים היית בטוח וטעית. אלה הנושאים שבהם בוועדה תישמע משכנע ותטעה, ולכן הם קיבלו עדיפות במיקוד.` : 'לא נמצאו מקרים של ביטחון מוטעה.'} ${under ? `${under} פעמים ניחשת וצדקת. כדאי לחזק את הידע כדי שתוכל לנמק אותו.` : ''}</p>` : '<p>הנתון יופיע אחרי האבחון.</p>'}</div>
  <h2>תוכנית מומלצת להמשך</h2><div class="card small"><ol>
  <li>${focus[0] ? `היום: תרגול ממוקד ב"${esc(COMPS[focus[0].c])}" (${S.profile?.goal || 20} דקות לפי היעד היומי שלך).` : 'היום: סימולציית ועדה קצרה.'}</li>
  <li>בדרך: האזנה לשיעור "${esc(AUDIO.find(a => a.id === recommend('audio').lesson).title)}", ואחריה תרגול על אותו חומר.</li>
  <li>פעם בשבוע: סימולציית ועדה מלאה ותחקיר.</li>
  <li>כל יום: חזרה מרווחת קצרה. ${Q.filter(q => isDue(q.id)).length} שאלות ממתינות כרגע.</li></ol>
  <p class="muted">כיסוי: כל 11 פרקי הקורס פעילים. ההמלצות מחושבות על הנושא הפעיל (${esc(topicName(curTopic()))}).</p></div>
  </details>
  ${D ? `<details class="card" style="margin-top:12px"><summary>תשובות האבחון</summary><ul class="small">${D.ans.map(a => { const q = QMAP[a.qid]; const right = q.options.find(o => o.ok); return `<li style="margin:6px 0">${a.ok ? '✅' : '❌'} ${esc(q.q)}<br><span class="muted">התשובה הנכונה: ${esc(right.t)}. ${esc(right.why)}</span></li>`; }).join('')}</ul><a class="btn sm" href="#diag" id="rediag">אבחון חוזר</a></details>` : ''}`;
  $$('[data-focus]', m).forEach(b => b.onclick = () => { const c = b.dataset.focus; const dpt = autoDepth(c) === 3 ? 2 : autoDepth(c); startQuick(5, dpt, { comps: [c], reason: `מיקוד מהדוח: "${COMPS[c]}". ${whyFocus(comps.find(x => x.c === c))}` }); });
  $$('[data-deep]', m).forEach(b => b.onclick = () => { const c = b.dataset.deep; startQuick(5, 3, { comps: [c], reason: `העמקה: "${COMPS[c]}" ברמת ועדה.` }); });
  const rdg = $('#rediag'); if (rdg) rdg.onclick = () => { diagRun = null; };
};

/* ---------------- AI KEY SETTINGS (גרסה עצמאית) ---------------- */
function aiSettingsHtml() {
  const c = window.__byok.get() || { provider: 'gemini', key: '', model: '' };
  const u = window.__byok.usage();
  return `<div class="card" style="margin-top:10px"><h3>בוחן ומורה AI (אופציונלי)</h3>
  <p class="small">בלי מפתח הכול עובד, וההערכה בשאלות פתוחות נעשית מול מחוון. עם מפתח מקבלים בוחן שמנתח את התשובה, שואל שאלות המשך ומסביר.</p>
  <div class="row"><label><input type="radio" name="prov" value="gemini" ${c.provider !== 'claude' ? 'checked' : ''}> Gemini (Google) – יש מכסה חינמית</label><label><input type="radio" name="prov" value="claude" ${c.provider === 'claude' ? 'checked' : ''}> Claude (Anthropic) – בתשלום לפי שימוש</label></div>
  <details style="margin:8px 0"><summary class="small">איך משיגים מפתח?</summary><div class="small">
  <p><b>Gemini, בחינם:</b> 1) היכנס ל-<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> עם חשבון Google. 2) לחץ Create API key. 3) העתק את המפתח והדבק אותו כאן. במכסה החינמית יש מגבלה יומית, ו-Google רשאית להשתמש בתוכן לשיפור המוצרים שלה.</p>
  <p><b>Claude, בתשלום:</b> 1) היכנס ל-<a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a>. 2) רכוש קרדיט ב-Billing (אפשר להגדיר תקרה). 3) צור מפתח ב-API Keys והדבק אותו כאן.</p></div></details>
  <input type="text" id="aikey" placeholder="הדבק כאן את המפתח" value="${esc(c.key || '')}" style="width:100%;direction:ltr" autocomplete="off">
  <details style="margin-top:6px"><summary class="small">מתקדם: שם מודל</summary><input type="text" id="aimodel" placeholder="ברירת מחדל: gemini-flash-latest / claude-haiku-5-5" value="${esc(c.model || '')}" style="width:100%;direction:ltr"></details>
  <div class="row" style="margin-top:8px"><button class="btn primary" id="aisave">שמור ובדוק</button>${c.key ? '<button class="btn" id="aidel">הסר מפתח</button>' : ''}<span class="small muted">שימוש החודש: ${u.n || 0} פניות</span></div><div id="aiout"></div>
  <p class="small muted">המפתח נשמר רק בדפדפן הזה ולא נשלח לשום מקום חוץ מהספק שבחרת. בכל מכשיר מוסיפים אותו בנפרד.</p></div>`;
}
function wireAiSettings(m) {
  const sv = $('#aisave', m); if (!sv) return;
  sv.onclick = async () => {
    const v = { provider: $$('[name=prov]', m).find(r => r.checked).value, key: $('#aikey', m).value.trim(), model: $('#aimodel', m).value.trim() };
    if (!v.key) { $('#aiout').innerHTML = '<div class="fb no">לא הוזן מפתח.</div>'; return; }
    $('#aiout').innerHTML = '<div class="fb info">בודק את המפתח…</div>';
    try { await window.__byok.test(v); window.__byok.set(v); $('#aiout').innerHTML = '<div class="fb ok">המפתח תקין. הבוחן מופעל.</div>'; setTimeout(() => location.reload(), 900); }
    catch (e) { $('#aiout').innerHTML = `<div class="fb no">הבדיקה נכשלה: ${e && e.code === 'bad_key' ? 'המפתח לא תקין או שאין לו הרשאה.' : e && e.code === 'rate_limited' ? 'הגעת למגבלת השימוש. נסה מאוחר יותר.' : 'שגיאה (' + esc(e && (e.status || e.message || e.code) || '') + '). בדוק את שם המודל או את החיבור.'}</div>`; }
  };
  const dl = $('#aidel', m); if (dl) dl.onclick = () => { window.__byok.set(null); location.reload(); };
}

/* ---------------- מנהל: יצירת קול טבעי לשיעורי האודיו ---------------- */
let nvRun = null;
function naturalVoiceHtml() {
  const total = AUDIO.reduce((a, L) => a + L.lines.length, 0);
  return `<div class="card" style="margin-top:10px;border-color:var(--accent)"><h3>🎙️ קול טבעי לשיעורי האודיו (מנהל)</h3>
  <p class="small">יוצר הקראה טבעית בקול Gemini לכל ${total} הקטעים ב-${AUDIO.length} השיעורים, ושומר אותה בענן לכל החניכים. משתמש במפתח ה-Gemini שבהגדרות למעלה. קטעים שכבר נוצרו ולא השתנו מדולגים, כך שאפשר לעצור ולהמשיך.</p>
  <div class="row"><button class="btn primary" id="nvgo">צור / השלם קול טבעי</button><button class="btn" id="nvstop" disabled>עצור</button><button class="btn sm" id="nvcheck">בדוק מצב</button></div>
  <div id="nvout" class="small" style="margin-top:8px"></div></div>`;
}
function wireNaturalVoice(m) {
  const out = $('#nvout', m), go = $('#nvgo', m), st = $('#nvstop', m);
  const status = async () => {
    out.textContent = 'בודק…'; let have = 0, total = 0;
    for (const L of AUDIO) { const c = await lessonClips(L.id); delete clipCache[L.id]; L.lines.forEach((ln, i) => { total++; if (c[i] && c[i].h === hashText(ln.t)) have++; }); }
    out.innerHTML = `מוכנים <b>${have}/${total}</b> קטעים.`; return { have, total };
  };
  $('#nvcheck', m).onclick = status;
  st.onclick = () => { if (nvRun) nvRun.stop = true; st.disabled = true; };
  go.onclick = async () => {
    const c = window.__byok.get(); if (!c || !c.key || c.provider === 'claude') { out.innerHTML = '<div class="fb warn">צריך קודם לשמור מפתח Gemini בכרטיס "בוחן ומורה AI".</div>'; return; }
    nvRun = { stop: false }; go.disabled = true; st.disabled = false;
    let done = 0, made = 0, total = AUDIO.reduce((a, L) => a + L.lines.length, 0); const t0 = Date.now();
    try {
      for (const L of AUDIO) {
        const have = await lessonClips(L.id); delete clipCache[L.id];
        for (let i = 0; i < L.lines.length; i++) {
          if (nvRun.stop) throw { code: 'stopped' };
          const ln = L.lines[i], h = hashText(ln.t);
          done++;
          if (have[i] && have[i].h === h) continue;
          let tries = 0;
          for (;;) {
            out.innerHTML = `יוצר קטע ${done}/${total} · "${esc(L.title)}" · נוצרו ${made} חדשים${tries ? ` · ניסיון ${tries + 1}` : ''}`;
            try { const r = await window.__audioStore.generate(L.id, i, ln.t, h, LINE_VOICE[ln.v] || 'Kore'); made++; out.innerHTML += ` · מודל: ${esc(r.model)}`; break; }
            catch (e) {
              if (e && e.code === 'rate_limited' && tries < 6) { tries++; const w = 20 + tries * 15; for (let s = w; s > 0 && !nvRun.stop; s--) { out.innerHTML = `מגבלת קצב של Gemini – ממתין ${s} שניות… (${done}/${total})`; await new Promise(r => setTimeout(r, 1000)); } continue; }
              throw e;
            }
          }
          await new Promise(r => setTimeout(r, 2500));
        }
      }
      out.innerHTML = `<div class="fb ok">הסתיים. נוצרו ${made} קטעים חדשים (${Math.round((Date.now() - t0) / 60000)} דק'). כל החניכים ישמעו עכשיו קול טבעי.</div>`;
    } catch (e) {
      const msg = e && e.code === 'stopped' ? 'נעצר. אפשר להמשיך מאותה נקודה.' : e && e.code === 'rate_limited' ? 'המכסה היומית של Gemini נגמרה כנראה. נסה שוב מחר – ההתקדמות נשמרה.' : e && e.code === 'bad_key' ? 'המפתח נדחה (ייתכן שלמודל הקול נדרש חיוב בחשבון Google AI Studio).' : 'שגיאה: ' + esc((e && (e.message || e.code)) || e);
      out.innerHTML = `<div class="fb warn">${msg} נוצרו ${made} קטעים בסבב הזה.</div>`;
    } finally { go.disabled = false; st.disabled = true; nvRun = null; }
  };
}

/* ---------------- פרויקט הגמר – הגנה בעל פה ---------------- */
VIEWS.project = (m) => {
  const p = S.project || {};
  m.innerHTML = `<h1>פרויקט הגמר שלי</h1>
  <p class="muted">הוועדה בוחנת גם את פרויקט הגמר. מלא כמה שדות, והבוחנים ישאלו עליו שאלות קשות. הפרטים נשמרים רק בחשבון שלך.</p>
  <form class="card" id="pf" novalidate>
    <label>מקום העבודה בפרויקט וסוג הפעילות<br><input type="text" id="p_site" style="width:100%" maxlength="120" placeholder="למשל: מפעל לייצור סלטים, 40 עובדים" value="${esc(p.site || '')}"></label>
    <label style="display:block;margin-top:10px">שלושת הסיכונים המרכזיים שזיהית<br>${[0, 1, 2].map(i => `<input type="text" data-risk="${i}" style="width:100%;margin-top:4px" maxlength="100" placeholder="סיכון ${i + 1}" value="${esc((p.risks || [])[i] || '')}">`).join('')}</label>
    <label style="display:block;margin-top:10px">שיטת הערכת הסיכונים שבחרת<br><input type="text" id="p_method" style="width:100%" maxlength="100" placeholder="למשל: מטריצת חומרה × סבירות לפי ת״י 31010" value="${esc(p.method || '')}"></label>
    <label style="display:block;margin-top:10px">חקיקה מרכזית שהסתמכת עליה<br><input type="text" id="p_laws" style="width:100%" maxlength="200" value="${esc(p.laws || '')}"></label>
    <label style="display:block;margin-top:10px">ההמלצות העיקריות<br><textarea id="p_recs" style="min-height:70px" maxlength="500">${esc(p.recs || '')}</textarea></label>
    <div class="row" style="margin-top:10px"><button class="btn primary" type="submit">שמור והתחל הגנה בעל פה</button></div><div id="perr"></div>
  </form>`;
  $('#pf').onsubmit = e => {
    e.preventDefault();
    const site = $('#p_site').value.trim();
    if (!site) { $('#perr').innerHTML = '<div class="fb no">נא למלא לפחות את מקום העבודה.</div>'; return; }
    S.project = { site, risks: $$('[data-risk]').map(x => x.value.trim()).filter(Boolean), method: $('#p_method').value.trim(), laws: $('#p_laws').value.trim(), recs: $('#p_recs').value.trim(), at: Date.now() };
    save(); sim = { phase: 'setup', len: 'short', pressure: S.settings.pressure || 'normal', mode: 'project' }; go('sim');
  };
};
const PROJ_POINTS = [
  { t: 'מנמק את הבחירה (בשיטה, בסיכון או בבקרה) ולא רק מתאר אותה', w: 1.5, kw: ['בחרתי', 'כי', 'מאחר', 'הסיבה'] },
  { t: 'מקשר לחקיקה או לתקן הרלוונטיים בצורה מדויקת', w: 1.5, kw: ['תקנות', 'פקודת', 'חוק', 'ת"י', 'תקן'] },
  { t: 'מציג בקרות לפי היררכיה (ביטול, הנדסי, מנהלי, ציוד מגן)', w: 1, kw: ['הנדסי', 'מנהלי', 'ציוד מגן', 'ביטול', 'היררכי'] },
  { t: 'מתאר יישום ומעקב: מי אחראי, לוח זמנים ואיך מודדים', w: 1, kw: ['אחראי', 'לוח זמנים', 'מעקב', 'מדד', 'מבדק'] },
  { t: 'מודה במגבלות הפרויקט ומציע שיפור', w: 1, kw: ['מגבל', 'הייתי משפר', 'לשפר', 'חסר'] }
];
async function projectQuestions(n) {
  const p = S.project;
  const risks = p.risks.length ? p.risks : ['הסיכון המרכזי שזיהית'];
  const tpl = [
    `ספר בקצרה על ${p.site}: למה בחרת דווקא בו, ומה הסיכון החמור ביותר שמצאת?`,
    `בחרת בשיטה "${p.method || 'שבחרת'}" להערכת סיכונים. למה דווקא בה, ומה החולשה שלה?`,
    `לגבי "${risks[0]}": איזו חקיקה חלה, ואילו בקרות המלצת לפי היררכיה?`,
    `נניח שההנהלה ב${p.site} דוחה את ההמלצה היקרה ביותר שלך. מה תעשה?`,
    `איך תמדוד שההמלצות שלך יושמו ושהסיכון "${risks[1] || risks[0]}" באמת ירד?`,
    `אם היית מתחיל את הפרויקט מחדש, מה היית עושה אחרת?`
  ];
  let qs = tpl;
  if (aiAvailable()) {
    try {
      const r = await Cap.sample.json(`אתה בוחן קפדני בוועדת הסמכה לממוני בטיחות בישראל. לפניך תקציר פרויקט גמר של מועמד (ניהול סיכונים במקום עבודה). נסח ${n + 2} שאלות קשות, ספציפיות לפרויקט, שבודקות נימוק, חקיקה, היררכיית בקרות, יישום ומגבלות. כתוב בעברית, משפט אחד או שניים לכל שאלה.
מקום: ${p.site}
סיכונים: ${risks.join('; ')}
שיטה: ${p.method}
חקיקה: ${p.laws}
המלצות: ${p.recs}
החזר JSON בלבד: {"questions":["...","..."]}`, { modelTier: 'default' });
      if (r && Array.isArray(r.questions) && r.questions.length >= n) qs = r.questions;
    } catch (e) { }
  }
  return qs.slice(0, Math.max(n, 2)).map((text, i) => ({ id: 'fp' + i, comp: 'C9', depth: 3, diff: 2, type: 'open', src: ['S3'], examiner: ['law', 'mgmt', 'field'][i % 3], q: text, points: PROJ_POINTS,
    followups: ['מה הראיה לכך במקום העבודה עצמו?', 'ומה אם הבוחן יגיד לך שזה לא מספיק – איך תגן על ההמלצה?'], models: null }));
}

/* ---------------- BOOT ---------------- */
shell();
window.addEventListener('hashchange', route);
window.addEventListener('online', rerenderSoft); window.addEventListener('offline', rerenderSoft);
route();
setTimeout(initCaps, 0);
if (window.__standalone && 'serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
window.__app = { S: () => S, mastery, readiness, recommend, buildQuick, logEvent, audioNotPracticed, normalizeEval, mergeRemote };
