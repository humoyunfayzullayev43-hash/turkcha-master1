const $ = (s, e = document) => e.querySelector(s);
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => new Date().toISOString().slice(0, 10);
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const toast = m => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600); };
const stat = (l, v) => `<div class="stat"><span>${l}</span><b>${v}</b></div>`;
const toWord = r => ({ id: uid(), tr: r.tr, uz: r.uz, right: 0, wrong: 0, ok: false, last: 0 });
let curId = null, curTr = '', revealed = false, soundOn = true;

// ---------- Dexie (IndexedDB) ----------
const dx = new Dexie('turkcha');
dx.version(1).stores({ decks: 'id', meta: 'id' });
const DB = {
  decks: () => dx.decks.toArray(),
  deck: id => dx.decks.get(id),
  save: d => { d.updated = Date.now(); return dx.decks.put(d); },
  remove: id => dx.decks.delete(id),
  meta: id => dx.meta.get(id),
  setMeta: m => dx.meta.put(m),
};
async function bumpDaily() {
  const m = (await DB.meta('daily')) || { id: 'daily', days: {} };
  const k = today(); m.days[k] = (m.days[k] || 0) + 1; await DB.setMeta(m);
}

// ---------- Theme ----------
const applyTheme = t => document.documentElement.dataset.theme = t;
async function initTheme() {
  const m = await DB.meta('theme');
  applyTheme(m?.v || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
}
$('#theme').onclick = async () => {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(t); await DB.setMeta({ id: 'theme', v: t });
};

function updSound() {
  document.querySelectorAll('#sound, [data-act="sound-toggle"]').forEach(b => {
    b.textContent = b.dataset.act === 'sound-toggle'
      ? (soundOn ? '🔊 Avto ovoz: yoqiq' : '🔇 Avto ovoz: o‘chiq')
      : (soundOn ? '🔊' : '🔇');
  });
}
async function setSound(v) { soundOn = v; updSound(); await DB.setMeta({ id: 'sound', v }); }
const sb = $('#sound');
if (sb) sb.onclick = async () => { await setSound(!soundOn); toast(soundOn ? 'Avto ovoz yoqildi' : 'Avto ovoz o‘chirildi'); };

let sharedCache = null;
async function getShared() {
  if (sharedCache) return sharedCache;
  const r = await fetch('shared.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  sharedCache = (d.levels || []).map(l => ({
    name: String(l.name),
    units: (l.units || []).map(u => ({
      name: String(u.name),
      words: (u.words || []).map(w => ({ tr: String(w.tr).trim(), uz: String(w.uz).trim() })).filter(w => w.tr && w.uz)
    })).filter(u => u.words.length)
  })).filter(l => l.units.length);
  window._levels = sharedCache;
  return sharedCache;
}

async function loadShared() {
  const box = document.createElement('section');
  box.className = 'shared panel';
  box.innerHTML = '<h2>Darajalar</h2><p class="muted">Yuklanmoqda...</p>';
  app.appendChild(box);
  let levels;
  try { levels = await getShared(); }
  catch { box.innerHTML = '<h2>Darajalar</h2><p class="muted">Hozircha mavjud emas yoki internet yo‘q.</p>'; return; }
  if (!levels.length) { box.remove(); return; }
  box.innerHTML = `<h2>Darajalar</h2>
    <p class="muted">Darajani tanlang, unitni oching va uni necha qismga bo‘lib yodlashni o‘zingiz belgilang.</p>
    <div class="grid">${levels.map(l => {
      const n = l.units.reduce((s, u) => s + u.words.length, 0);
      return `<a class="deck level" href="#/level/${encodeURIComponent(l.name)}"><h3>${esc(l.name)}</h3>
        <p>Unitlar: <b>${l.units.length}</b> · So‘zlar: <b>${n}</b></p><span class="btn">Ochish →</span></a>`;
    }).join('')}</div>`;
}

async function renderLevel(name) {
  let levels;
  try { levels = await getShared(); }
  catch { return app.innerHTML = '<section class="panel"><p>Internet kerak.</p><a class="btn ghost" href="#/">Orqaga</a></section>'; }
  const L = levels.find(l => l.name === name);
  if (!L) return location.hash = '#/';
  const decks = await DB.decks();
  app.innerHTML = `<section class="panel"><h2>${esc(name)} — unitlar</h2>
    <div class="units">${L.units.map((u, i) => {
      const key = `${name}|${u.name}`;
      const mine = decks.filter(d => d.sharedKey && d.sharedKey.startsWith(key + '|'));
      const ok = mine.reduce((s, d) => s + d.words.filter(w => w.ok).length, 0);
      return `<article class="deck unit"><h3>${esc(u.name)}</h3>
        <p>So‘zlar: <b>${u.words.length}</b>${mine.length ? ` · Qismlar: <b>${mine.length}</b> · O‘zlashtirilgan: <b>${ok}</b>` : ''}</p>
        <div class="row"><button data-act="split-open" data-level="${esc(name)}" data-unit="${i}">Bo‘lib yodlash</button></div></article>`;
    }).join('')}</div>
    <div class="row"><a class="btn ghost" href="#/">Orqaga</a></div></section>`;
}

function splitSizes(n, k) {
  const base = Math.floor(n / k), rem = n % k;
  return Array.from({ length: k }, (_, i) => base + (i < rem ? 1 : 0));
}

function openSplit(levelName, unitIdx) {
  const U = window._levels.find(l => l.name === levelName).units[unitIdx];
  const n = U.words.length;
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.innerHTML = `<div class="modalbox"><h2>${esc(levelName)} · ${esc(U.name)}</h2>
    <p class="muted">Jami so‘zlar: <b>${n}</b></p>
    <label>Necha qismga bo‘lamiz?<input id="parts" type="number" min="1" max="${n}" value="1"></label>
    <div id="sprev" class="muted small"></div>
    <div class="row"><button data-act="split-ok">Tasdiqlash</button><button class="ghost" data-act="split-cancel">Bekor qilish</button></div></div>`;
  document.body.appendChild(wrap);
  const upd = () => {
    const k = Math.max(1, Math.min(n, parseInt($('#parts').value) || 1));
    $('#sprev').textContent = `Natija: ${splitSizes(n, k).join(', ')} so‘z (${k} qism)`;
  };
  $('#parts').oninput = upd; upd();
  window._split = { levelName, unitIdx, close: () => wrap.remove() };
}

// ---------- Parsing ----------
const SEP = [/\s+[—–-]\s+/, /\s*:\s*/, /\s*;\s*/, /\s*\|\s*/, /\t/, /\s*,\s*/];
function parseText(text, swap = false) {
  return text.replace(/^\uFEFF/, '').split(/\r?\n/).map(raw => {
    const l = raw.trim(); if (!l) return null;
    for (const re of SEP) {
      const p = l.split(re); if (p.length < 2) continue;
      const a = p[0].trim(), b = p.slice(1).join(' ').trim();
      if (!a || !b) continue;
      if (/^turkcha$/i.test(a)) return null; // sarlavha qatori
      return swap ? { tr: b, uz: a, raw: l } : { tr: a, uz: b, raw: l };
    }
    return { bad: true, raw: l };
  }).filter(Boolean);
}
function uniq(rows) {
  const seen = new Set();
  return rows.filter(r => {
    if (r.bad) return false;
    const k = (r.tr + '|' + r.uz).toLowerCase();
    if (seen.has(k)) return false; seen.add(k); return true;
  });
}
function previewHTML(rows) {
  const seen = new Set(); let ok = 0, dup = 0, bad = 0;
  const body = rows.map(r => {
    if (r.bad) { bad++; return `<tr class="err"><td colspan="3">⚠ Noto‘g‘ri format: ${esc(r.raw)}</td></tr>`; }
    const k = (r.tr + '|' + r.uz).toLowerCase();
    if (seen.has(k)) { dup++; return `<tr class="warn"><td>${esc(r.tr)}</td><td>${esc(r.uz)}</td><td>Takror</td></tr>`; }
    seen.add(k); ok++;
    return `<tr><td>${esc(r.tr)}</td><td>${esc(r.uz)}</td><td>✓</td></tr>`;
  }).join('');
  return `<p>Tayyor: <b>${ok}</b> · Takror: <b>${dup}</b> · Xato: <b>${bad}</b></p><div class="tablewrap"><table>${body}</table></div>`;
}

// ---------- Views ----------
async function route() {
  const [, page, id] = (location.hash || '#/').split('/');
  if (page === 'new') return renderNew();
  if (page === 'study') return renderStudy(id);
  if (page === 'edit') return renderEdit(id);
  if (page === 'level') return renderLevel(decodeURIComponent(id));
  if (page === 'stats') return renderStats();
  if (page === 'backup') return renderBackup();
  return renderHome();
}
window.addEventListener('hashchange', route);

function deckCard(d) {
  const n = d.words.length, ok = d.words.filter(w => w.ok).length, p = n ? Math.round(ok / n * 100) : 0;
  return `<article class="deck" data-name="${esc(d.name.toLowerCase())}">
    <div class="deckhead"><label class="pick"><input type="checkbox" class="pk" value="${d.id}"></label><h3>${esc(d.name)}</h3></div>
    <p>So‘zlar: <b>${n}</b> · O‘zlashtirilgan: <b>${ok}</b></p>
    <div class="progress"><span style="width:${p}%"></span></div>
    <small class="muted">${p}% · ${d.updated ? new Date(d.updated).toLocaleString('uz-UZ') : ''}</small>
    <div class="row"><a class="btn" href="#/study/${d.id}">Boshlash</a><a class="btn ghost" href="#/edit/${d.id}">Tahrirlash</a><button class="ghost" data-act="copy" data-id="${d.id}">Nusxalash</button><button class="ghost danger" data-act="delete" data-id="${d.id}">O‘chirish</button></div>
  </article>`;
}

async function renderHome() {
  const decks = (await DB.decks()).sort((a, b) => b.updated - a.updated);
  const all = decks.flatMap(d => d.words);
  const ok = all.filter(w => w.ok).length, weak = all.filter(w => !w.ok && w.wrong > 0).length;
  const days = (await DB.meta('daily'))?.days || {};
  const pct = all.length ? Math.round(ok / all.length * 100) : 0;
  app.innerHTML = `
    <section class="stats">
      ${stat('Lug‘atlar', decks.length)}${stat('So‘zlar', all.length)}${stat('O‘zlashtirilgan', ok)}
      ${stat('Yaxshi emas', weak)}${stat('Bugun', days[today()] || 0)}${stat('Foiz', pct + '%')}
    </section>
    <div class="bar"><input id="q" type="search" placeholder="Lug‘at qidirish..."><a class="btn" href="#/new">+ Yangi lug‘at</a>
      <button class="ghost" id="mergeBtn" data-act="merge-go" hidden>Tanlanganlarni birlashtirish</button>
      <a class="btn ghost" href="#/stats">Statistika</a><a class="btn ghost" href="#/backup">Zaxira</a></div>
    <div class="grid">${decks.map(deckCard).join('') || '<div class="empty">Hali lug‘at yo‘q. “+ Yangi lug‘at” tugmasi bilan boshlang.</div>'}</div>`;
  loadShared(decks);
  $('#q').oninput = e => { const v = e.target.value.toLowerCase(); document.querySelectorAll('.deck').forEach(c => c.hidden = !c.dataset.name.includes(v)); };
  document.querySelectorAll('.pk').forEach(c => c.onchange = () => { $('#mergeBtn').hidden = document.querySelectorAll('.pk:checked').length < 2; });
}

function renderNew() {
  app.innerHTML = `<section class="panel"><h2>Yangi lug‘at</h2>
    <label>Lug‘at nomi<input id="dn" placeholder="Masalan: A1 – 7-dars"></label>
    <label>Fayl yuklash (TXT, CSV, JSON)<input id="file" type="file" accept=".txt,.csv,.json"></label>
    <label>Yoki matnni joylashtiring (har qatorda bitta so‘z). Xato qatorni shu yerda tuzating:
      <textarea id="txt" rows="8" placeholder="Öğrenmek — O‘rganmoq&#10;Yazmak - Yozmoq&#10;Okumak: O‘qimoq"></textarea></label>
    <label class="check"><input type="checkbox" id="swap"> Chap ustun o‘zbekcha bo‘lsa, almashtirish</label>
    <div class="preview" id="prev"></div>
    <div class="row"><button data-act="import">Import qilish</button><a class="btn ghost" href="#/">Bekor qilish</a></div></section>`;
  const txt = $('#txt'), sw = $('#swap');
  const refresh = () => $('#prev').innerHTML = previewHTML(parseText(txt.value, sw.checked));
  txt.oninput = refresh; sw.onchange = refresh;
  $('#file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    let text = await f.text();
    if (f.name.endsWith('.json')) {
      try { const j = JSON.parse(text); const arr = Array.isArray(j) ? j : (j.words || []);
        text = arr.map(w => `${w.tr} — ${w.uz}`).join('\n'); }
      catch { return toast('JSON fayl noto‘g‘ri'); }
    }
    if (!$('#dn').value) $('#dn').value = f.name.replace(/\.[^.]+$/, '');
    txt.value = text; refresh();
  };
  refresh();
}

async function renderStudy(id) {
  curId = id;
  const d = await DB.deck(id); if (!d) return location.hash = '#/';
  if (!d.session) return app.innerHTML = startHTML(d);
  const s = d.session;
  if (!s.queue.length && !s.next.length) {
    d.session = null; await DB.save(d);
    return app.innerHTML = `<section class="panel center"><h2>🎉 TABRIKLAYMIZ! BARCHA SO‘ZLARNI TO‘G‘RI TOPDINGIZ!</h2>
      <p>Aylanishlar: ${s.round} · Jami xato javoblar: ${s.wrong}</p><div class="row" style="justify-content:center"><a class="btn" href="#/">Bosh sahifa</a></div></section>`;
  }
  if (!s.queue.length) {
    return app.innerHTML = `<section class="panel center"><h2>Aylanish ${s.round} yakunlandi</h2>
      <p>Jami: ${s.roundTotal} · To‘g‘ri: ${s.roundTotal - s.next.length} · Xato: ${s.next.length}</p>
      <div class="row" style="justify-content:center"><button data-act="next-round">QAYTA ISHLASH</button><a class="btn ghost" href="#/">To‘xtatish</a></div></section>`;
  }
  const w = d.words.find(x => x.id === s.queue[0]);
  if (!w) { s.queue.shift(); await DB.save(d); return renderStudy(id); }
  curTr = w.tr; revealed = false;
  const pct = Math.round((s.roundTotal - s.queue.length) / s.roundTotal * 100);
  app.innerHTML = `<section class="study">
    <div class="progress"><span style="width:${pct}%"></span></div>
    <p class="muted">Aylanish ${s.round} · Qolgan: ${s.queue.length} · ✓ ${s.correct} · ✕ ${s.wrong}</p>
    <div class="card" id="card" data-act="flip">
      <div class="front"><small>O‘ZBEKCHA</small><h2>${esc(w.uz)}</h2><span class="muted">Turkchasini eslang...</span></div>
      <div class="back"><small>TURKCHA</small><h2>${esc(w.tr)}</h2></div>
    </div>
    <div class="row center" style="justify-content:center"><button class="ghost" data-act="flip">JAVOBNI KO‘RISH</button><button class="ghost" data-act="speak">🔊</button><button class="ghost" data-act="sound-toggle">${soundOn ? '🔊 Avto ovoz: yoqiq' : '🔇 Avto ovoz: o‘chiq'}</button><button class="ghost" id="bnext" data-act="next" disabled>Keyingi →</button></div>
    <div class="answers" style="margin-top:18px"><button class="ok" id="bok" data-act="right" disabled>✓ TO‘G‘RI</button><button class="bad" id="bbad" data-act="wrong" disabled>✕ NOTO‘G‘RI</button></div>
    <p class="muted small center">Klaviatura: Space — javob, 1 — to‘g‘ri, 2 — noto‘g‘ri · <a href="#/">To‘xtatish</a> (progress saqlanadi)</p>
  </section>`;
}

function startHTML(d) {
  const n = d.words.length, ok = d.words.filter(w => w.ok).length, errs = d.words.filter(w => !w.ok && w.wrong > 0).length;
  return `<section class="panel"><h2>${esc(d.name)}</h2>
    <p class="muted">Jami: ${n} · O‘zlashtirilgan: ${ok} · Xato so‘zlar: ${errs}</p>
    <div class="modes">
      <button class="mode" data-act="start" data-mode="all"><b>Barcha so‘zlar</b><span>Boshidan boshlash</span></button>
      <button class="mode" data-act="start" data-mode="errors"><b>Faqat xatolar</b><span>${errs} ta so‘z</span></button>
      <button class="mode" data-act="start" data-mode="learned"><b>O‘zlashtirilganlar</b><span>${ok} ta so‘z</span></button>
      <button class="mode" data-act="start" data-mode="random"><b>Tasodifiy tartib</b><span>Aralashtirib berish</span></button>
    </div>
    <div class="row"><a class="btn ghost" href="#/">Orqaga</a><button class="ghost danger" data-act="reset">Qayta boshlash</button></div></section>`;
}

async function renderEdit(id) {
  curId = id;
  const d = await DB.deck(id); if (!d) return location.hash = '#/';
  const editRow = w => `<tr data-id="${w ? w.id : ''}"><td><input type="checkbox" class="sel"></td><td><input class="tr" value="${esc(w ? w.tr : '')}"></td><td><input class="uz" value="${esc(w ? w.uz : '')}"></td><td><button class="ghost danger" data-act="del-row">✕</button></td></tr>`;
  app.innerHTML = `<section class="panel"><h2>Tahrirlash</h2>
    <label>Lug‘at nomi<input id="en" value="${esc(d.name)}"></label>
    <input id="esearch" type="search" placeholder="So‘z qidirish...">
    <div class="row"><button class="ghost danger" data-act="sel-del">Tanlanganlarni o‘chirish</button></div>
    <div class="row"><select id="mv"><option value="">Boshqa lug‘atga ko‘chirish...</option></select><button class="ghost" data-act="move">Ko‘chirish</button></div>
    <div class="tablewrap"><table id="etab"><thead><tr><th></th><th>Turkcha</th><th>O‘zbekcha</th><th></th></tr></thead>
      <tbody>${d.words.map(editRow).join('')}</tbody></table></div>
    <h3>Yangi so‘z</h3>
    <div class="row"><input id="ntr" placeholder="Turkcha"><input id="nuz" placeholder="O‘zbekcha"><button data-act="add-word">Qo‘shish</button></div>
    <div class="row"><button data-act="save-edit">Saqlash</button><a class="btn ghost" href="#/">Bekor qilish</a></div></section>`;
  DB.decks().then(ds => $('#mv').insertAdjacentHTML('beforeend', ds.filter(x => x.id !== id).map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')));
  const tb = $('#etab tbody');
  const sortBy = k => {
    const dir = tb.dataset.k === k && tb.dataset.dir === 'asc' ? 'desc' : 'asc';
    tb.dataset.k = k; tb.dataset.dir = dir; const m = dir === 'asc' ? 1 : -1;
    [...tb.rows].sort((a, b) => m * a.querySelector('.' + k).value.trim().localeCompare(b.querySelector('.' + k).value.trim(), 'tr')).forEach(r => tb.appendChild(r));
  };
  document.querySelectorAll('#etab thead th')[1].onclick = () => sortBy('tr');
  document.querySelectorAll('#etab thead th')[2].onclick = () => sortBy('uz');
  window._editRow = editRow;
  $('#esearch').oninput = e => {
    const v = e.target.value.toLowerCase();
    document.querySelectorAll('#etab tbody tr').forEach(r => {
      const t = [...r.querySelectorAll('input.tr,input.uz')].map(i => i.value).join(' ').toLowerCase();
      r.hidden = !t.includes(v);
    });
  };
}

let charts = [];
async function renderStats() {
  const decks = await DB.decks(), all = decks.flatMap(d => d.words);
  const days = (await DB.meta('daily'))?.days || {};
  const last7 = [...Array(7)].map((_, i) => { const k = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); return [k.slice(5), days[k] || 0]; }).reverse();
  const R = all.reduce((s, w) => s + w.right, 0), W = all.reduce((s, w) => s + w.wrong, 0);
  const acc = R + W ? Math.round(R / (R + W) * 100) : 0;
  const ok = all.filter(w => w.ok).length;
  const errs = all.filter(w => w.wrong > 0).sort((a, b) => b.wrong - a.wrong).slice(0, 10);
  app.innerHTML = `<section class="panel"><h2>Statistika</h2>
    <div class="stats">${stat('Lug‘atlar', decks.length)}${stat('So‘zlar', all.length)}${stat('To‘g‘ri', R)}${stat('Xato', W)}${stat('To‘g‘ri foiz', acc + '%')}</div>
    <div class="charts">
      <div class="chartbox"><h3>So‘nggi 7 kun (javoblar)</h3><canvas id="cDaily"></canvas></div>
      <div class="chartbox"><h3>Umumiy holat</h3><canvas id="cState"></canvas></div>
    </div>
    <div class="chartbox"><h3>Lug‘atlar bo‘yicha o‘zlashtirish (%)</h3><canvas id="cDecks"></canvas></div>
    <h3>Eng ko‘p xato qilinadigan so‘zlar</h3>
    ${errs.length ? `<ol>${errs.map(w => `<li>${esc(w.tr)} — ${esc(w.uz)} <b>(${w.wrong})</b></li>`).join('')}</ol>` : '<p class="muted">Hozircha xato yo‘q.</p>'}
    <div class="row"><a class="btn ghost" href="#/">Orqaga</a></div></section>`;
  charts.forEach(c => c.destroy()); charts = [];
  if (!window.Chart) return toast('Diagramma kutubxonasi yuklanmadi');
  Chart.defaults.color = '#8b97ad';
  charts.push(new Chart($('#cDaily'), { type: 'bar', data: { labels: last7.map(x => x[0]), datasets: [{ data: last7.map(x => x[1]), backgroundColor: '#6366f1', borderRadius: 8 }] }, options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } }));
  charts.push(new Chart($('#cState'), { type: 'doughnut', data: { labels: ['O‘zlashtirilgan', 'Hali emas'], datasets: [{ data: [ok, all.length - ok], backgroundColor: ['#16a34a', '#dc2626'], borderWidth: 0 }] }, options: { cutout: '70%' } }));
  charts.push(new Chart($('#cDecks'), { type: 'bar', data: { labels: decks.map(d => d.name), datasets: [{ data: decks.map(d => d.words.length ? Math.round(d.words.filter(w => w.ok).length / d.words.length * 100) : 0), backgroundColor: '#818cf8', borderRadius: 8 }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { min: 0, max: 100 } } } }));
}

function renderBackup() {
  app.innerHTML = `<section class="panel"><h2>Zaxira nusxa</h2>
    <p class="muted">Barcha lug‘atlar, so‘zlar va o‘rganish tarixi JSON faylga saqlanadi.</p>
    <div class="row"><button data-act="export">Eksport (JSON)</button><button class="ghost" data-act="export-csv">CSV</button><button class="ghost" data-act="export-txt">TXT</button></div>
    <h3>Tiklash</h3>
    <p class="muted">Mavjud lug‘atlar o‘chirilmaydi. Zaxiradagilari qo‘shiladi, bir xil ID bo‘lsa yangilanadi. Tiklashdan oldin tasdiqlash so‘raladi.</p>
    <input type="file" id="restore" accept=".json"><a class="btn ghost" href="#/">Orqaga</a></section>`;
  $('#restore').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    let j; try { j = JSON.parse(await f.text()); } catch { return toast('Fayl noto‘g‘ri'); }
    if (!Array.isArray(j.decks)) return toast('Bu zaxira fayli emas');
    if (!confirm(`${j.decks.length} ta lug‘at tiklansinmi? Mavjud lug‘atlar saqlanadi.`)) return;
    for (const d of j.decks) await DB.save(d);
    toast('Tiklandi'); location.hash = '#/';
  };
}

// ---------- Actions ----------
function flip() { if (revealed) return; revealed = true; $('#card')?.classList.add('flipped'); if (soundOn) speak(curTr); $('#bok').disabled = false; $('#bbad').disabled = false; $('#bnext').disabled = false; }
let utter = null, warnedVoice = false;
function speak(t) {
  if (!('speechSynthesis' in window) || !t) return toast('Ovoz qo‘llab-quvvatlanmaydi');
  const go = () => {
    const vs = speechSynthesis.getVoices();
    const v = vs.find(x => /^tr/i.test(x.lang));
    if (!v && !warnedVoice && vs.length) { warnedVoice = true; toast('Turkcha ovoz topilmadi. Telefon/kompyuter sozlamasidan Turkcha ovoz yuklang'); }
    const u = new SpeechSynthesisUtterance(t);
    u.lang = 'tr-TR'; u.rate = 0.9; if (v) u.voice = v;
    utter = u;
    speechSynthesis.speak(u);
  };
  speechSynthesis.cancel();
  speechSynthesis.resume();
  setTimeout(go, 150);
}

async function answer(ok) {
  const d = await DB.deck(curId); const s = d?.session; if (!s || !s.queue.length) return route();
  const wid = s.queue.shift(), w = d.words.find(x => x.id === wid);
  if (w) {
    w.last = Date.now();
    if (ok) { w.ok = true; w.right++; s.correct++; }
    else { w.ok = false; w.wrong++; s.wrong++; s.next.push(wid); }
  }
  await DB.save(d); await bumpDaily(); route();
}

async function startSession(mode) {
  const d = await DB.deck(curId); const W = d.words;
  let list = mode === 'errors' ? W.filter(w => w.wrong > 0 && !w.ok) : mode === 'learned' ? W.filter(w => w.ok) : W;
  const ids = list.map(w => w.id);
  if (!ids.length) return toast('Bu rejimda so‘z yo‘q');
  d.session = { mode, round: 1, queue: shuffle(ids), next: [], roundTotal: ids.length, total: ids.length, correct: 0, wrong: 0 };
  await DB.save(d); route();
}

async function nextRound() {
  const d = await DB.deck(curId); const s = d.session;
  s.round++; s.queue = shuffle(s.next); s.next = []; s.roundTotal = s.queue.length;
  await DB.save(d); route();
}

async function resetDeck() {
  if (!confirm('Lug‘at noldan boshlansinmi? Barcha o‘zlashtirish ma’lumotlari o‘chadi.')) return;
  const d = await DB.deck(curId);
  d.words.forEach(w => { w.ok = false; w.right = 0; w.wrong = 0; w.last = 0; });
  d.session = null; await DB.save(d); toast('Qayta boshlandi'); route();
}

async function saveEdit() {
  const d = await DB.deck(curId); const old = new Map(d.words.map(w => [w.id, w])); const words = [];
  document.querySelectorAll('#etab tbody tr').forEach(r => {
    const tr = r.querySelector('.tr').value.trim(), uz = r.querySelector('.uz').value.trim();
    if (!tr || !uz) return;
    const o = old.get(r.dataset.id);
    words.push(o ? { ...o, tr, uz } : toWord({ tr, uz }));
  });
  const name = $('#en').value.trim(); if (name) d.name = name;
  d.words = words;
  const ids = new Set(words.map(w => w.id));
  if (d.session) { d.session.queue = d.session.queue.filter(i => ids.has(i)); d.session.next = d.session.next.filter(i => ids.has(i)); }
  await DB.save(d); toast('Saqlandi'); location.hash = '#/';
}

async function importNew() {
  const name = $('#dn').value.trim() || 'Yangi lug‘at';
  const rows = uniq(parseText($('#txt').value, $('#swap').checked));
  if (!rows.length) return toast('Import uchun to‘g‘ri so‘z topilmadi');
  await DB.save({ id: uid(), name, words: rows.map(toWord), session: null, created: Date.now() });
  toast(`${rows.length} ta so‘z saqlandi`); location.hash = '#/';
}

async function postpone() {
  const d = await DB.deck(curId); const s = d?.session;
  if (!s || s.queue.length < 2) return;
  s.queue.push(s.queue.shift()); await DB.save(d); route();
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const csvCell = s => `"${String(s).replace(/"/g, '""')}"`;

app.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act;
  try {
    if (a === 'flip') return flip();
    if (a === 'right') return answer(true);
    if (a === 'wrong') return answer(false);
    if (a === 'speak') return speak(curTr);
    if (a === 'next') return postpone();
    if (a === 'sound-toggle') { await setSound(!soundOn); toast(soundOn ? 'Avto ovoz yoqildi' : 'Avto ovoz o‘chirildi'); return; }
    if (a === 'start') return startSession(el.dataset.mode);
    if (a === 'reset') return resetDeck();
    if (a === 'next-round') return nextRound();
    if (a === 'delete') {
      if (!confirm('Lug‘at o‘chirilsinmi?')) return;
      await DB.remove(el.dataset.id); toast('O‘chirildi'); return route();
    }
    if (a === 'import') return importNew();
    if (a === 'split-open') return openSplit(el.dataset.level, +el.dataset.unit);
    if (a === 'split-cancel') return window._split?.close();
    if (a === 'split-ok') {
      const { levelName, unitIdx, close } = window._split;
      const U = window._levels.find(l => l.name === levelName).units[unitIdx];
      const n = U.words.length;
      const k = Math.max(1, Math.min(n, parseInt($('#parts').value) || 1));
      const key = `${levelName}|${U.name}`;
      const decks = await DB.decks();
      const old = decks.filter(d => d.sharedKey && d.sharedKey.startsWith(key + '|'));
      if (old.length && !confirm(`Bu unit oldin ${old.length} qismga bo‘lingan. Qayta bo‘linsa, eski qismlar va ularning natijasi o‘chadi. Davom etilsinmi?`)) return;
      for (const d of old) await DB.remove(d.id);
      const sizes = splitSizes(n, k); let pos = 0;
      for (let i = 0; i < k; i++) {
        const chunk = U.words.slice(pos, pos + sizes[i]); pos += sizes[i];
        await DB.save({ id: uid(), name: `${levelName} · ${U.name} · ${i + 1}/${k}`, sharedKey: `${key}|${i + 1}/${k}`, words: chunk.map(toWord), session: null, created: Date.now() });
      }
      close(); toast(`${k} qism yaratildi`); return route();
    }
    if (a === 'copy') { const d = await DB.deck(el.dataset.id); await DB.save({ ...d, id: uid(), name: d.name + ' (nusxa)', words: d.words.map(w => ({ ...w, id: uid() })), session: null }); toast('Nusxa yaratildi'); return route(); }
    if (a === 'merge-go') {
      const ids = [...document.querySelectorAll('.pk:checked')].map(c => c.value);
      const name = prompt('Birlashtirilgan lug‘at nomi:', 'Birlashtirilgan'); if (!name || !name.trim()) return;
      const decks = await Promise.all(ids.map(i => DB.deck(i)));
      const seen = new Set(), words = [];
      decks.forEach(d => d.words.forEach(w => { const k = (w.tr + '|' + w.uz).toLowerCase(); if (!seen.has(k)) { seen.add(k); words.push({ ...w, id: uid() }); } }));
      await DB.save({ id: uid(), name: name.trim(), words, session: null });
      if (confirm('Asl lug‘atlar o‘chirilsinmi?')) for (const i of ids) await DB.remove(i);
      toast(`${words.length} ta so‘z birlashtirildi`); return route();
    }
    if (a === 'del-row') return el.closest('tr').remove();
    if (a === 'sel-del') { document.querySelectorAll('#etab .sel:checked').forEach(c => c.closest('tr').remove()); return; }
    if (a === 'add-word') {
      const tr = $('#ntr').value.trim(), uz = $('#nuz').value.trim();
      if (!tr || !uz) return toast('Ikkala maydonni ham to‘ldiring');
      $('#etab tbody').insertAdjacentHTML('beforeend', window._editRow({ id: '', tr, uz }));
      $('#ntr').value = ''; $('#nuz').value = ''; return;
    }
    if (a === 'save-edit') return saveEdit();
    if (a === 'move') {
      const to = $('#mv').value; if (!to) return toast('Lug‘atni tanlang');
      const ids = [...document.querySelectorAll('#etab .sel:checked')].map(c => c.closest('tr').dataset.id).filter(Boolean);
      if (!ids.length) return toast('So‘zlarni belgilang');
      const src = await DB.deck(curId), dst = await DB.deck(to);
      const moving = src.words.filter(w => ids.includes(w.id));
      src.words = src.words.filter(w => !ids.includes(w.id));
      if (src.session) { src.session.queue = src.session.queue.filter(i => !ids.includes(i)); src.session.next = src.session.next.filter(i => !ids.includes(i)); }
      const have = new Set(dst.words.map(w => (w.tr + '|' + w.uz).toLowerCase())); let n = 0;
      moving.forEach(w => { if (!have.has((w.tr + '|' + w.uz).toLowerCase())) { dst.words.push(w); n++; } });
      await DB.save(src); await DB.save(dst);
      toast(`${n} ta so‘z ko‘chirildi`); return renderEdit(curId);
    }
    if (a === 'export') {
      const payload = { app: 'turkcha-master', version: 1, exported: Date.now(), decks: await DB.decks() };
      return download(`turkcha-backup-${today()}.json`, JSON.stringify(payload, null, 2), 'application/json');
    }
    if (a === 'export-csv' || a === 'export-txt') {
      const decks = await DB.decks();
      if (a === 'export-csv') {
        const lines = ['Lug‘at,Turkcha,O‘zbekcha'];
        decks.forEach(d => d.words.forEach(w => lines.push([d.name, w.tr, w.uz].map(csvCell).join(','))));
        return download(`turkcha-${today()}.csv`, '\uFEFF' + lines.join('\n'), 'text/csv');
      }
      const out = decks.map(d => `# ${d.name}\n` + d.words.map(w => `${w.tr} - ${w.uz}`).join('\n')).join('\n\n');
      return download(`turkcha-${today()}.txt`, out, 'text/plain');
    }
  } catch (err) { console.error(err); toast('Xatolik: ' + err.message); }
});

document.addEventListener('keydown', e => {
  if (!$('#card') || e.target.matches('input,textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); flip(); }
  else if (e.key === '1' && revealed) answer(true);
  else if (e.key === '2' && revealed) answer(false);
  else if (e.key === 'ArrowRight' && revealed) postpone();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
initTheme().then(async () => {
  const snd = await DB.meta('sound'); soundOn = snd ? snd.v : true; updSound(); route();
});
