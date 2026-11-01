/* ══════════════════════════════════════════════════════════════
   app.js — Sâm Lốc · Core logic
══════════════════════════════════════════════════════════════ */

// ── localStorage keys ──────────────────────────────────────────
const LS_THEME = 'xamloc_theme';
const LS_RULES = 'xamloc_rules';
const LS_HISTORY = 'xamloc_history';
const LS_PLAYERS = 'xamloc_players';
const LS_SESSIONS = 'xamloc_sessions';
const LS_PRESETS = 'xamloc_presets';
const LS_NOTES = 'xamloc_notes'; // per-van notes: { [vanIdx]: string }
const LS_PLAYER_BANKS = 'xamloc_player_banks'; // { [playerName]: { bank, account, accountName } }

// ── Badge maps ─────────────────────────────────────────────────
const TMAP = { W: 'bx', X: 'bx', Q: 'bq', Qbat: 'bc', Qsafe: 'bchan', C: 'bc', Chan: 'bchan', Xchan: 'bc', DL: 'bdl', DLnhan: 'bdlnhan' };
const TLBL = { W: 'Ăn trắng ⚪', X: 'Sâm ✓', Q: 'T.quý 🔥', Qbat: 'Bị bắt 🔥', Qsafe: 'Thoát 🔥', C: 'Cháy', Chan: 'Chặn 🛡', Xchan: 'Bị chặn', DL: 'Đền làng 🏘️', DLnhan: 'Được đền 🏘️' };

// ── State ──────────────────────────────────────────────────────
let rules = { la: 0.5, xw: 10, xl: 30, tq: 5, tqOn: true, chay: 10, chayOn: true };
let history = [];
let numP = 4;
let pnames = ['Người 1', 'Người 2', 'Người 3', 'Người 4'];
let mode = 'normal';
let selXam = -1, selChan = -1, selTqChain = [], selChay = [], selWin = -1, selDenLang = -1;
let selAbsent = []; // cột (người) vắng ở ván đang nhập — không tính điểm ván đó
let currentHistoryFilter = 'all'; // 'all' | 'xam' | 'tq' | 'chay'

// ── Sessions & extras ─────────────────────────────────────────
let sessions = []; // [{id, date, label, history, names, numP, rules, tot}]
let vanNotes = {}; // { [vanIdx]: string }
let playerPresets = []; // string[] — tên hay dùng
let playerBanks = {}; // { [playerName]: { bank, account, accountName } }

// ── Timer state ────────────────────────────────────────────────
let timerRunning = false;
let timerSeconds = 0;
let timerInterval = null;
let timerStartTs = null; // epoch ms when started (for accurate resume)

// ── Undo state ─────────────────────────────────────────────────
let undoSnapshot = null; // last history before addVan

// ── Auto-save session ──────────────────────────────────────────
let currentSessionId = null; // ID của buổi đang chơi (để upsert)

// ── Input mode state ───────────────────────────────────────────
const LS_INPUT_SRC = 'xamloc_input_src';
let currentInputMode = 'manual';

// ── Helpers ────────────────────────────────────────────────────
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function roundScore(val) {
    if (typeof val !== 'number' || isNaN(val)) return 0;
    return Math.round(val * 100) / 100;
}

function setInputMode(m) {
    currentInputMode = m === 'auto' ? 'auto' : 'manual';
    try { localStorage.setItem(LS_INPUT_SRC, currentInputMode); } catch (_) { }

    const btnManual = document.getElementById('btn-mode-manual');
    const btnAuto = document.getElementById('btn-mode-auto');
    const cardAuto = document.getElementById('fb-live-card');
    const cardInput = document.getElementById('van-input-card');

    if (btnManual) btnManual.classList.toggle('active', currentInputMode === 'manual');
    if (btnAuto) btnAuto.classList.toggle('active', currentInputMode === 'auto');

    if (cardInput) cardInput.style.display = currentInputMode === 'manual' ? '' : 'none';
    if (cardAuto) cardAuto.style.display = currentInputMode === 'auto' ? '' : 'none';
}

// ══════════════════════════════════════════════════════════════
// DARK MODE
// ══════════════════════════════════════════════════════════════
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const icon = document.getElementById('theme-icon');
    if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) btn.title = theme === 'dark' ? 'Chuyển sang sáng' : 'Chuyển sang tối';
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.content = theme === 'dark' ? '#050716' : '#e9efff';
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem(LS_THEME, next);
    SFX.play('theme');
    showToast(next === 'dark' ? '🌙 Chế độ tối' : '☀️ Chế độ sáng', 1600);
    if (document.getElementById('page-chart').classList.contains('show')) {
        setTimeout(renderChartPage, 50);
    }
}

// ══════════════════════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════════════════════
function showToast(msg, duration) {
    duration = duration || 2500;
    const el = document.getElementById('toast-center');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), duration);
}

// ══════════════════════════════════════════════════════════════
// RIPPLE
// ══════════════════════════════════════════════════════════════
function spawnRipple(btn, e) {
    const rect = btn.getBoundingClientRect();
    const r = document.createElement('span');
    r.className = 'ripple';
    const size = Math.max(rect.width, rect.height) * 2.2;
    const x = (e ? e.clientX - rect.left : rect.width / 2) - size / 2;
    const y = (e ? e.clientY - rect.top : rect.height / 2) - size / 2;
    r.style.cssText = `width:${size}px;height:${size}px;left:${x}px;top:${y}px`;
    btn.appendChild(r);
    setTimeout(() => r.remove(), 650);
}

// ══════════════════════════════════════════════════════════════
// CONFETTI
// ══════════════════════════════════════════════════════════════
const CONFETTI_COLORS = ['#27cfff', '#2f6bff', '#8a4dff', '#33e0a2', '#ffc04d', '#ff6585'];
const CONFETTI_GOLD = ['#dcaa42', '#f4c15c', '#e8b923', '#fff3c4', '#b8860b'];

function burstConfetti(originEl, opts) {
    opts = opts || {};
    const count = opts.count || 22;
    const colors = opts.gold ? CONFETTI_GOLD : CONFETTI_COLORS;
    const rect = originEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top;
    const wrap = document.createElement('div');
    wrap.className = 'confetti-wrap';
    document.body.appendChild(wrap);
    for (let i = 0; i < count; i++) {
        const dot = document.createElement('div');
        dot.className = 'confetti-dot';
        const angle = (Math.random() * 220 - 110) * Math.PI / 180;
        const dist = (opts.gold ? 80 : 60) + Math.random() * (opts.gold ? 130 : 90);
        const tx = Math.sin(angle) * dist;
        const ty = -Math.cos(angle) * dist;
        dot.style.cssText = `left:${cx}px;top:${cy}px;background:${colors[i % colors.length]};--tx:${tx}px;--ty:${ty}px;--rot:${Math.random() * 540 - 270}deg;animation-delay:${Math.random() * .08}s;animation-duration:${.7 + Math.random() * .35}s;`;
        wrap.appendChild(dot);
    }
    setTimeout(() => wrap.remove(), 1400);
}

// ══════════════════════════════════════════════════════════════
// HAPTIC FEEDBACK (mobile)
// ══════════════════════════════════════════════════════════════
function haptic(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { }
}

// ══════════════════════════════════════════════════════════════
// BUTTON ANIMATIONS
// ══════════════════════════════════════════════════════════════
function handleAddVan(e) {
    const btn = document.getElementById('add-van-btn');
    const textEl = btn.querySelector('.btn-text');
    const iconEl = btn.querySelector('.btn-icon');
    spawnRipple(btn, e);
    btn.classList.add('loading');
    btn.disabled = true;
    setTimeout(() => {
        const result = addVan();
        if (result === false) {
            SFX.play('saveFail');
            haptic(60);
            btn.classList.remove('loading'); btn.disabled = false; return;
        }
        btn.classList.remove('loading');
        btn.classList.add('success');
        iconEl.innerHTML = '<span class="check-icon">✓</span>';
        textEl.textContent = `Ván ${history.length} đã lưu!`;

        // Chọn sound + confetti + haptic dựa theo mode/tags
        const lastVan = history[history.length - 1];
        const flatTags = lastVan ? lastVan.tags.flat().map(t => t.tag || t) : [];
        const hasXamWin = flatTags.includes('X');
        const hasTuQuy = flatTags.includes('Q');
        const hasChay = flatTags.includes('C');

        if (lastVan && lastVan.mode === 'xam') {
            SFX.play('saveOk');
            if (hasXamWin) {
                burstConfetti(btn, { gold: true, count: 40 });
                haptic([20, 40, 20, 40, 60]);
            } else {
                haptic(80);
            }
        } else {
            SFX.play('saveOk');
            if (hasTuQuy) {
                burstConfetti(btn, { gold: true, count: 34 });
                haptic([15, 30, 15, 30, 50]);
            } else if (hasChay) {
                burstConfetti(btn, { count: 28 });
                haptic([25, 40]);
            } else {
                burstConfetti(btn);
                haptic(15);
            }
        }
        setTimeout(() => {
            btn.classList.remove('success');
            btn.disabled = false;
            iconEl.innerHTML = '＋';
            textEl.textContent = 'Thêm ván này';
        }, 1400);
    }, 280);
}

function animateSaveBtn(doWork) {
    const btn = document.getElementById('save-rules-btn');
    const textEl = btn.querySelector('.btn-text');
    const iconEl = btn.querySelector('.btn-icon');
    btn.classList.add('loading');
    btn.disabled = true;
    setTimeout(() => {
        doWork();
        SFX.play('save');
        btn.classList.remove('loading');
        btn.classList.add('success');
        iconEl.innerHTML = '<span class="check-icon" style="display:inline-block;transform:scale(0) rotate(-20deg);transition:transform .25s cubic-bezier(.34,1.56,.64,1)">✓</span>';
        textEl.textContent = 'Đã lưu!';
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const ck = btn.querySelector('.check-icon');
            if (ck) ck.style.transform = 'scale(1) rotate(0deg)';
        }));
        setTimeout(() => {
            btn.classList.remove('success');
            btn.disabled = false;
            iconEl.innerHTML = '💾';
            textEl.textContent = 'Lưu luật chơi';
        }, 2000);
    }, 320);
}

// ══════════════════════════════════════════════════════════════
// MODAL
// ══════════════════════════════════════════════════════════════
function showModal({ icon = 'ℹ️', title, msg, buttons = [] }) {
    document.getElementById('modal-icon').textContent = icon;
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-msg').textContent = msg;
    const acts = document.getElementById('modal-actions');
    acts.innerHTML = '';
    buttons.forEach(b => {
        const btn = document.createElement('button');
        btn.className = 'modal-btn ' + (b.cls || 'modal-btn-primary');
        btn.textContent = b.label;
        btn.onclick = () => { closeModal(); if (b.cb) setTimeout(b.cb, 220); };
        acts.appendChild(btn);
    });
    const ov = document.getElementById('modal-overlay');
    ov.style.display = 'flex';
    requestAnimationFrame(() => ov.classList.add('show'));
}

function closeModal() {
    const ov = document.getElementById('modal-overlay');
    ov.classList.remove('show');
    setTimeout(() => { ov.style.display = 'none'; }, 200);
}

function modalClickOutside(e) {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
}

function showAlert({ icon = 'ℹ️', title = 'Thông báo', msg, onOk }) {
    showModal({ icon, title, msg, buttons: [{ label: 'Đồng ý', cls: 'modal-btn-primary', cb: onOk }] });
}

function showConfirm({ icon = '❓', title = 'Xác nhận', msg, onYes, onNo, yesDanger = false }) {
    showModal({
        icon, title, msg,
        buttons: [
            { label: 'Hủy', cls: 'modal-btn-cancel', cb: onNo },
            { label: 'Xác nhận', cls: yesDanger ? 'modal-btn-danger' : 'modal-btn-primary', cb: onYes },
        ],
    });
}

// ══════════════════════════════════════════════════════════════
// PERSIST
// ══════════════════════════════════════════════════════════════
function save() {
    for (let i = 0; i < numP; i++) {
        const el = document.getElementById('pn' + i);
        if (el) pnames[i] = el.value || ('Người ' + (i + 1));
    }
    try {
        localStorage.setItem(LS_RULES, JSON.stringify(rules));
        localStorage.setItem(LS_HISTORY, JSON.stringify(history));
        localStorage.setItem(LS_PLAYERS, JSON.stringify({ numP, pnames }));
        localStorage.setItem(LS_NOTES, JSON.stringify(vanNotes));
        localStorage.setItem(LS_PRESETS, JSON.stringify(playerPresets));
        localStorage.setItem(LS_PLAYER_BANKS, JSON.stringify(playerBanks));
    } catch (e) {
        console.warn('localStorage full', e);
        showToast('⚠️ Bộ nhớ máy đầy — dữ liệu mới có thể chưa lưu được! Vào tab 💾 Dữ liệu để dọn bớt.', 4000);
    }
    if (window.broadcastLiveUpdate) broadcastLiveUpdate();
}

function load() {
    try {
        const r = localStorage.getItem(LS_RULES);
        if (r) {
            const p = JSON.parse(r);
            rules = {
                la: p.la !== undefined ? p.la : rules.la,
                xw: p.xw !== undefined ? p.xw : rules.xw,
                xl: p.xl !== undefined ? p.xl : rules.xl,
                tq: p.tq !== undefined ? p.tq : rules.tq,
                tqOn: p.tqOn !== undefined ? p.tqOn : rules.tqOn,
                chay: p.chay !== undefined && p.chay >= 1 ? Math.round(p.chay) : rules.chay,
                chayOn: p.chayOn !== undefined ? p.chayOn : rules.chayOn,
            };
        }
        const h = localStorage.getItem(LS_HISTORY);
        if (h) history = JSON.parse(h);
        const pl = localStorage.getItem(LS_PLAYERS);
        if (pl) { const d = JSON.parse(pl); numP = d.numP || 4; pnames = d.pnames || pnames; }
        const sn = localStorage.getItem(LS_SESSIONS);
        if (sn) {
            sessions = JSON.parse(sn);
            // Khôi phục ID buổi đang chơi nếu có
            const live = sessions.find(s => s.autoSaved);
            if (live) currentSessionId = live.id;
        }
        const nt = localStorage.getItem(LS_NOTES);
        if (nt) vanNotes = JSON.parse(nt);
        const pr = localStorage.getItem(LS_PRESETS);
        if (pr) playerPresets = JSON.parse(pr);
        const pb = localStorage.getItem(LS_PLAYER_BANKS);
        if (pb) playerBanks = JSON.parse(pb);
    } catch (e) { console.warn('load error', e); }
}

function updateStorageInfo() {
    try {
        const used = JSON.stringify(localStorage).length;
        const kb = (used / 1024).toFixed(1);
        document.getElementById('storage-info').textContent =
            `Đang dùng ~${kb} KB localStorage · ${history.length} ván đã lưu`;
        document.getElementById('storage-dot').className =
            used > 4000000 ? 'storage-dot warn' : 'storage-dot';
    } catch (e) { }
}

// ══════════════════════════════════════════════════════════════
// NAV
// ══════════════════════════════════════════════════════════════
function goPage(p) {
    SFX.play('nav');
    ['game', 'admin', 'sessions', 'data', 'chart'].forEach(id => {
        document.getElementById('page-' + id).className = 'page' + (id === p ? ' show' : '');
        document.getElementById('nav-' + id).className = 'nav-btn' + (id === p ? ' active' : '');
    });
    if (p === 'admin') loadAdminFields();
    if (p === 'data') { updateStorageInfo(); loadDiscordField(); }
    if (p === 'chart') renderChartPage();
    if (p === 'sessions') { renderSessionsList(); renderHonorBoard(); renderHighlights(); }
}

// ══════════════════════════════════════════════════════════════
// GAME SETUP
// ══════════════════════════════════════════════════════════════
function setPlayers(n) {
    numP = n;
    ['pbtn2', 'pbtn3', 'pbtn4'].forEach(id => {
        document.getElementById(id).className =
            'btn-outline' + (parseInt(id.replace('pbtn', '')) === n ? ' active' : '');
    });
    selXam = -1; selChan = -1; selTqChain = []; selChay = []; selWin = -1; selDenLang = -1; selAbsent = [];
    renderNames(); renderGrid(); renderXamPickers(); save();
}

function renderNames() {
    const el = document.getElementById('player-names');
    if (!el) return;
    const presetOptions = playerPresets.map(n => `<option value="${escapeHtml(n)}">`).join('');
    let html = '<datalist id="name-presets">' + presetOptions + '</datalist>';
    for (let i = 0; i < numP; i++) {
        const v = pnames[i] || ('Người ' + (i + 1));
        html += `<div class="pname-wrap">
      <input type="text" id="pn${i}" value="${escapeHtml(v)}" list="name-presets"
        onchange="pnames[${i}]=this.value;save();renderXamPickers();renderGrid();"
        placeholder="Nhập tên ${i + 1}">
    </div>`;
    }
    el.innerHTML = html;
}

function getNames() {
    return Array.from({ length: numP }, (_, i) =>
        document.getElementById('pn' + i)?.value || `Người ${i + 1}`);
}

function renderGrid(reset = false) {
    const names = getNames();
    const g = document.getElementById('van-grid');
    if (!g) return;
    const prevVals = reset
        ? Array(numP).fill('')
        : Array.from({ length: numP }, (_, i) => document.getElementById('c' + i)?.value ?? '');

    const isAbs = (i) => selAbsent.includes(i);
    const allFilled = prevVals.every((v, i) =>
        isAbs(i) || (rules.chayOn && selChay.includes(i)) || (v !== '' && v !== null && v !== undefined));

    const filledVals = prevVals.map((v, i) => {
        if (isAbs(i)) return Infinity;
        if (rules.chayOn && selChay.includes(i)) return Infinity;
        if (v === '' || v === null || v === undefined) return Infinity;
        const n = parseInt(v);
        return isNaN(n) ? Infinity : n;
    });
    const minVal = Math.min(...filledVals);
    const tiedIdxs = filledVals.map((v, i) => v === minVal && minVal !== Infinity ? i : -1).filter(i => i >= 0);

    const displayWin = (allFilled && minVal !== Infinity && tiedIdxs.length > 0)
        ? (tiedIdxs.length === 1 ? tiedIdxs[0] : (tiedIdxs.includes(selWin) ? selWin : -1))
        : -1;

    let cardsHtml = '';
    for (let i = 0; i < numP; i++) {
        const absent = isAbs(i);
        const isChaybai = !absent && rules.chayOn && selChay.includes(i);
        const isWin = !absent && !isChaybai && i === displayWin;
        const isTied = !absent && !isChaybai && tiedIdxs.includes(i) && tiedIdxs.length > 1 && !isWin;
        let cardClass = 'van-card';
        if (absent) cardClass += ' van-card-absent';
        else if (isChaybai) cardClass += ' van-card-chay';
        else if (isWin) cardClass += ' van-card-win';

        const absentBtn = `<button type="button" class="absent-toggle" onclick="toggleAbsent(${i})" title="Người này không chơi ván này">😴 Vắng</button>`;
        let body;
        if (absent) {
            body = `<div class="absent-badge">😴 Vắng ván này</div>
           <button type="button" class="absent-toggle" onclick="toggleAbsent(${i})">↩ Có mặt</button>`;
        } else if (isChaybai) {
            body = `<button class="chay-badge chay-badge-btn" onclick="toggleChay(${i})" title="Bấm để bỏ cháy bài">⚡ Cháy bài <span style="font-size:12px;opacity:.7;">✕</span></button>${absentBtn}`;
        } else {
            body = `<input type="number" id="c${i}" value="${prevVals[i]}" min="0" max="10" inputmode="numeric" pattern="[0-9]*" placeholder="nhập lá"
              oninput="this.classList.remove('input-error');this.value=this.value===''?'':(Math.min(10,Math.max(0,parseInt(this.value)||0)));updateCardState(${i},this.value)">
           <div class="input-hint">số lá còn lại (0–10)</div>
           ${isWin
                ? `<div class="win-badge">🏆 Thắng!</div>`
                : isTied
                    ? `<button class="pick-win-btn" onclick="pickWin(${i})">🏆 Chọn thắng</button>`
                    : ''}${absentBtn}`;
        }
        cardsHtml += `<div class="${cardClass}" id="card${i}">
      <div class="p-name">${escapeHtml(names[i])}</div>
      ${body}
    </div>`;
    }
    g.innerHTML = cardsHtml;
}

// Đánh dấu/bỏ đánh dấu một người vắng ở ván đang nhập (vắng = không chơi ván này, không tính điểm)
function toggleAbsent(i) {
    if (selAbsent.includes(i)) {
        selAbsent = selAbsent.filter(x => x !== i);
    } else {
        if (numP - selAbsent.length <= 2) { showToast('Cần ít nhất 2 người có mặt trong ván', 1800); return; }
        selAbsent = [...selAbsent, i];
        selChay = selChay.filter(x => x !== i);
        if (selTqChain.includes(i)) selTqChain = [];
        if (selDenLang === i) selDenLang = -1;
        if (selChan === i) selChan = -1;
        if (selXam === i) {
            selXam = -1; selChan = -1;
            const cp = document.getElementById('chan-panel'); if (cp) cp.style.display = 'none';
        }
    }
    selWin = -1;
    SFX.play('click');
    renderGrid(); renderXamPickers();
}

// Thêm cột cho người mới giữa buổi (đã có ván): đệm các ván cũ (0 điểm, đánh dấu vắng)
// để mọi mảng điểm/tag/tên luôn dài đúng numP — bảng điểm, thống kê, biểu đồ, Excel không phải sửa gì.
function growColumns(newN, newNames) {
    if (newN <= numP) return;
    const oldN = numP;
    for (let c = oldN; c < newN; c++) {
        pnames[c] = (newNames && newNames[c]) || ('Người ' + (c + 1));
        history.forEach(v => {
            v.scores[c] = 0;
            if (v.scLa) v.scLa[c] = 0;
            if (v.scBonus) v.scBonus[c] = 0;
            v.tags[c] = [];
            v.names[c] = pnames[c];
            v.absent = [...(v.absent || []), c];
        });
    }
    setPlayers(newN);
}

function pickWin(i) { selWin = i; renderGrid(); if (rules.tqOn && selTqChain.length >= 2) renderBonusPickers(); }

function setMode(m) {
    mode = m;
    document.getElementById('tab-normal').className = 'mode-tab' + (m === 'normal' ? ' active' : '');
    document.getElementById('tab-xam').className = 'mode-tab' + (m === 'xam' ? ' active' : '');
    document.getElementById('mode-normal').style.display = m === 'normal' ? 'block' : 'none';
    document.getElementById('mode-xam').style.display = m === 'xam' ? 'block' : 'none';
    renderBonusPickers();
}

// ══════════════════════════════════════════════════════════════
// XAM PICKERS
// ══════════════════════════════════════════════════════════════
function renderXamPickers() {
    const names = getNames();
    let xp = '', cp = '';
    for (let i = 0; i < numP; i++) {
        if (selAbsent.includes(i)) continue;
        xp += `<button class="picker-btn${selXam === i ? ' sel-xam' : ''}" onclick="pickXam(${i})">${names[i]}</button>`;
        if (i !== selXam)
            cp += `<button class="picker-btn${selChan === i ? ' sel-chan' : ''}" onclick="pickChan(${i})">${names[i]}</button>`;
    }
    document.getElementById('xam-picker').innerHTML = xp;
    document.getElementById('chan-picker').innerHTML = cp;
    const h = document.getElementById('hint-chan');
    if (h) h.textContent = `Người chặn +${rules.xl}đ · Người sâm -${rules.xl}đ · Người khác không đổi`;
    renderBonusPickers();
}

// Tính trước điểm LÁ của ván đang nhập (giống addVan) — trả về null nếu chưa đủ dữ liệu
function previewLaScores() {
    for (let i = 0; i < numP; i++) {
        if (selAbsent.includes(i)) continue;
        if (rules.chayOn && selChay.includes(i)) continue;
        const el = document.getElementById('c' + i);
        if (!el || el.value === '' || el.value === null) return null;
    }
    const cards = Array.from({ length: numP }, (_, i) => selAbsent.includes(i) ? 0 : gn('c' + i));
    const eff = cards.map((c, i) => selAbsent.includes(i) ? Infinity : ((rules.chayOn && selChay.includes(i)) ? c + rules.chay : c));
    const minVal = Math.min(...eff);
    const tied = eff.map((v, i) => v === minVal ? i : -1).filter(i => i >= 0);
    let win;
    if (tied.length > 1) { if (!tied.includes(selWin)) return null; win = selWin; } else win = tied[0];
    const la = new Array(numP).fill(0);
    for (let i = 0; i < numP; i++) {
        if (i === win || selAbsent.includes(i)) continue;
        const pay = eff[i] * rules.la;
        la[win] += pay; la[i] -= pay;
    }
    return la;
}

function renderBonusPickers() {
    const names = getNames();
    const show = rules.tqOn || rules.chayOn;
    let html = '';

    if (rules.tqOn) {
        const n = selTqChain.length;
        const btns = names.slice(0, numP).map((nm, i) => {
            if (selAbsent.includes(i)) return '';
            const pos = selTqChain.indexOf(i);
            let cls = 'picker-btn';
            let badge = '';
            if (pos !== -1) {
                if (pos === n - 1) cls += ' sel-tq';
                else if (pos === n - 2) cls += ' sel-chay';
                else cls += ' sel-chan';
                badge = `<span class="tq-badge">${pos + 1}</span>`;
            }
            return `<button class="${cls}" onclick="pickTq(${i})">${badge}${nm}</button>`;
        }).join('');

        let flowHtml = '';
        if (n >= 2) {
            const debtAmt = rules.tq * (n - 1);
            const parts = selTqChain.map((pi, k) => {
                if (k === n - 1) {
                    return `<span class="tq-flow-win">🔥 ${names[pi]} <b>+${debtAmt}đ</b></span>`;
                } else if (k === n - 2) {
                    return `<span class="tq-flow-lose">${names[pi]} <b>-${debtAmt}đ</b></span>`;
                } else {
                    return `<span class="tq-flow-safe">${names[pi]} <b>thoát</b></span>`;
                }
            });
            flowHtml = `<div class="tq-flow">${parts.join('<span class="tq-arrow">→</span>')}</div>`;
            // Tổng hợp: Lá + Tứ quý = Tổng cho từng người
            const laArr = previewLaScores();
            const tqArr = new Array(numP).fill(0);
            tqArr[selTqChain[n - 2]] -= debtAmt;
            tqArr[selTqChain[n - 1]] += debtAmt;
            const f = v => (v > 0 ? '+' : '') + v;
            if (laArr) {
                const rowsSum = names.slice(0, numP).map((nm, i) => {
                    if (selAbsent.includes(i)) return `<div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;padding:2px 0;opacity:.6;"><span>${nm}</span><span>vắng</span></div>`;
                    const tot = laArr[i] + tqArr[i];
                    return `<div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;padding:2px 0;">
                        <span>${nm}</span>
                        <span>Lá <b>${f(laArr[i])}</b> · Tứ quý <b>${f(tqArr[i])}</b> = <b style="color:${tot >= 0 ? 'var(--green,#16a34a)' : 'var(--red,#ef4444)'}">${f(tot)}đ</b></span>
                    </div>`;
                }).join('');
                flowHtml += `<div class="hint-text" style="margin-top:8px;">${rowsSum}</div>`;
            } else {
                flowHtml += `<div class="hint-text" style="margin-top:8px;">Nhập đủ số lá (và chọn người thắng nếu hòa) để xem tổng <b>lá + tứ quý</b> của ván này.</div>`;
            }
        }

        html += `<div class="bonus-block tq-block">
      <div class="tq-half" style="padding-bottom:2px;">
        <div class="bonus-label" style="margin-bottom:2px;">🔥 Tứ quý — bắt chồng</div>
        <div class="hint-text" style="margin-bottom:8px;">Bấm lần lượt: người đánh trước → người bắt → người bắt tiếp theo... Người bị bắt <b>gần nhất</b> sẽ gánh hết (cộng dồn thêm 1×tứ quý mỗi lượt bắt), người bắt trước đó coi như thoát.</div>
        <div class="picker-grid">${btns}</div>
      </div>
      ${flowHtml
                ? `<div class="tq-half" style="padding-top:0;">${flowHtml}</div>`
                : `<div class="tq-half" style="padding-top:0;"><span class="tq-placeholder">Chọn ít nhất 2 người: người đánh trước, người bắt sau</span></div>`}
      ${n > 0 ? `<div class="tq-half" style="padding-top:0;"><button type="button" class="sec-btn" style="padding:6px 10px;font-size:12px;" onclick="event.stopPropagation();selTqChain=[];renderBonusPickers();">↺ Xóa lượt chọn</button></div>` : ''}
    </div>`;
    }

    if (rules.chayOn) {
        const btns = names.slice(0, numP).map((n, i) => selAbsent.includes(i) ? '' :
            `<button class="picker-btn${selChay.includes(i) ? ' sel-chay' : ''}" onclick="toggleChay(${i})">${n}</button>`).join('');
        html += `<div class="bonus-block">
      <div class="bonus-label">⚡ Cháy bài <span style="color:var(--red);font-size:11px;">+${rules.chay} lá phạt</span></div>
      <div class="picker-grid">${btns}</div>
    </div>`;
    }

    // Đền làng
    {
        const dlBtns = names.slice(0, numP).map((n, i) => selAbsent.includes(i) ? '' :
            `<button class="picker-btn${selDenLang === i ? ' sel-dl' : ''}" onclick="pickDenLang(${i})">${n}</button>`).join('');
        html += `<div class="bonus-block den-lang-block">
      <div class="bonus-label">🏘️ Đền làng <span style="color:var(--red);font-size:11px;">trả nợ cho người thua</span></div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:6px;">Người đền sẽ trả thay cho tất cả người bị thua ván này</div>
      <div class="picker-grid">${dlBtns}</div>
      ${selDenLang !== -1 ? `<div class="den-lang-note">🏘️ <b>${names[selDenLang]}</b> sẽ đền làng — chịu toàn bộ tiền thua cho những người thua</div>` : ''}
    </div>`;
    }

    const normalInner = document.getElementById('bonus-normal-inner');
    const normalWrap = document.getElementById('bonus-normal');
    if (normalInner) normalInner.innerHTML = html;
    if (normalWrap) normalWrap.style.display = (show || true) ? 'block' : 'none';
}

function pickXam(i) {
    selXam = i; selChan = -1;
    SFX.play('xam');
    document.getElementById('chan-panel').style.display = 'block';
    document.getElementById('xam-tc').checked = false;
    const cp = document.getElementById('chan-picker');
    cp.style.opacity = '1'; cp.style.pointerEvents = 'auto';
    renderXamPickers();
}
function pickChan(i) { SFX.play('pick'); selChan = (selChan === i) ? -1 : i; renderXamPickers(); }
function pickTq(i) {
    const pos = selTqChain.indexOf(i);
    if (pos !== -1) {
        // Bấm lại người đã chọn: bỏ người đó và tất cả người bắt sau đó (cắt chuỗi)
        selTqChain = selTqChain.slice(0, pos);
        SFX.play('pick');
    } else {
        if (selTqChain.length >= numP) return;
        selTqChain.push(i);
        SFX.play(selTqChain.length >= 2 ? 'tuquy' : 'pick');
    }
    renderBonusPickers();
}

function toggleChan() {
    const tc = document.getElementById('xam-tc').checked;
    if (tc) selChan = -1;
    const el = document.getElementById('chan-picker');
    el.style.opacity = tc ? '0.3' : '1';
    el.style.pointerEvents = tc ? 'none' : 'auto';
}

function toggleChay(i) {
    const wasIn = selChay.includes(i);
    selChay = wasIn ? selChay.filter(x => x !== i) : [...selChay, i];
    if (!wasIn) SFX.play('chay');
    else SFX.play('click');
    renderBonusPickers(); renderGrid();
}

function pickDenLang(i) {
    const wasSelected = selDenLang === i;
    selDenLang = wasSelected ? -1 : i;
    if (!wasSelected) SFX.play('denLang');
    else SFX.play('click');
    renderBonusPickers();
}

function updateCardState(i, val) { selWin = -1; autoChay(i, val); renderGrid(); if (rules.tqOn && selTqChain.length >= 2) renderBonusPickers(); }

function autoChay(i, val) {
    if (val === '' || val === null || val === undefined) return;
    if (parseInt(val) === 10 && !selChay.includes(i)) {
        selChay = [...selChay, i]; renderBonusPickers(); renderGrid();
    } else if (parseInt(val) < 10 && selChay.includes(i)) {
        selChay = selChay.filter(x => x !== i); renderBonusPickers(); renderGrid();
    }
}

// ══════════════════════════════════════════════════════════════
// ADD VAN
// ══════════════════════════════════════════════════════════════
function gn(id) { return parseInt(document.getElementById(id)?.value) || 0; }

function addVan() {
    const names = getNames();
    const sc = new Array(numP).fill(0);
    const scLa = new Array(numP).fill(0);
    const scBonus = new Array(numP).fill(0);
    const tags = Array.from({ length: numP }, () => []);
    let cardsCount = null; // số lá còn lại của từng người (chỉ có ở chế độ bình thường)

    // Người có mặt trong ván (người vắng: không nhập lá, không trả/nhận tiền ván này)
    const present = [...Array(numP).keys()].filter(i => !selAbsent.includes(i));
    if (present.length < 2) { showAlert({ icon: '😴', title: 'Thiếu người', msg: 'Cần ít nhất 2 người có mặt trong ván!' }); return false; }

    if (mode === 'xam') {
        if (selXam === -1) { showAlert({ icon: '🎯', title: 'Chưa chọn', msg: 'Chọn người báo sâm!' }); return false; }
        const tc = document.getElementById('xam-tc').checked;
        if (!tc && selChan === -1) { showAlert({ icon: '🛡️', title: 'Chưa chọn', msg: 'Chọn người chặn, hoặc tick "Sâm thành công"!' }); return false; }

        if (tc) {
            const earn = (present.length - 1) * rules.xw;
            sc[selXam] += earn; scBonus[selXam] += earn;
            for (const i of present) if (i !== selXam) { sc[i] -= rules.xw; scBonus[i] -= rules.xw; }
            tags[selXam].push({ tag: 'X', delta: earn });
        } else {
            sc[selXam] -= rules.xl; scBonus[selXam] -= rules.xl;
            sc[selChan] += rules.xl; scBonus[selChan] += rules.xl;
            tags[selXam].push({ tag: 'Xchan', delta: -rules.xl });
            tags[selChan].push({ tag: 'Chan', delta: +rules.xl });
        }

    } else {
        // Validate inputs
        for (let i = 0; i < numP; i++) {
            if (selAbsent.includes(i)) continue;
            if (rules.chayOn && selChay.includes(i)) continue;
            const el = document.getElementById('c' + i);
            if (!el || el.value === '' || el.value === null) {
                if (el) el.classList.add('input-error');
                showAlert({ icon: '⚠️', title: 'Chưa nhập đủ', msg: `${names[i]} chưa nhập số lá bài!`, onOk: () => { if (el) el.focus(); } });
                return false;
            }
        }

        const cards = Array.from({ length: numP }, (_, i) => selAbsent.includes(i) ? 0 : gn('c' + i));
        cardsCount = [...cards];
        const effectiveCards = cards.map((c, i) => selAbsent.includes(i) ? Infinity : ((rules.chayOn && selChay.includes(i)) ? c + rules.chay : c));
        const minVal = Math.min(...effectiveCards);
        const tiedIdxs = effectiveCards.map((v, i) => v === minVal ? i : -1).filter(i => i >= 0);

        let win;
        if (tiedIdxs.length > 1) {
            if (!tiedIdxs.includes(selWin)) {
                showAlert({ icon: '🏆', title: 'Có nhiều người cùng số lá!', msg: `Bấm nút "🏆 Chọn thắng" trên ô của người thắng để xác định ai thắng ván này.` });
                return false;
            }
            win = selWin;
        } else {
            win = tiedIdxs[0];
        }

        for (let i = 0; i < numP; i++) {
            if (i !== win && !selAbsent.includes(i)) {
                const pay = effectiveCards[i] * rules.la;
                sc[win] += pay; scLa[win] += pay;
                sc[i] -= pay; scLa[i] -= pay;
            }
        }
        for (let i = 0; i < numP; i++) {
            if (rules.chayOn && selChay.includes(i) && !selAbsent.includes(i))
                tags[i].push({ tag: 'C', delta: -(rules.chay * rules.la) });
        }

        // Tứ quý validation (hỗ trợ bắt chồng — người bị bắt gần nhất gánh hết, người trước đó thoát)
        if (rules.tqOn) {
            if (selTqChain.some(i => selAbsent.includes(i))) { showAlert({ icon: '🔥', title: 'Chuỗi tứ quý sai', msg: 'Chuỗi tứ quý có người đang vắng ván này!' }); return false; }
            if (selTqChain.length === 1) { showAlert({ icon: '🔥', title: 'Chưa chọn đủ', msg: 'Đã chọn người đánh tứ quý, cần chọn thêm người bắt!' }); return false; }
            if (selTqChain.length >= 2) {
                const n = selTqChain.length;
                const debtAmt = rules.tq * (n - 1);
                const loserIdx = selTqChain[n - 2];
                const winnerIdx = selTqChain[n - 1];

                for (let k = 0; k < n - 2; k++) {
                    tags[selTqChain[k]].push({ tag: 'Qsafe', delta: 0 });
                }
                sc[loserIdx] -= debtAmt; scBonus[loserIdx] -= debtAmt;
                tags[loserIdx].push({ tag: 'Qbat', delta: -debtAmt });
                sc[winnerIdx] += debtAmt; scBonus[winnerIdx] += debtAmt;
                tags[winnerIdx].push({ tag: 'Q', delta: +debtAmt });
            }
        }

        // Đền làng
        if (selDenLang !== -1) {
            let totalDen = 0;
            for (let i = 0; i < numP; i++) {
                if (i !== selDenLang && sc[i] < 0) {
                    const debt = -sc[i];
                    // người đền trả nợ cho người thua
                    sc[selDenLang] -= debt;
                    sc[i] += debt; // người thua về 0 (từ phần lá)
                    totalDen += debt;
                    tags[i].push({ tag: 'DLnhan', delta: +debt });
                }
            }
            if (totalDen > 0) {
                tags[selDenLang].push({ tag: 'DL', delta: -totalDen });
            }
        }
    }

    undoSnapshot = history.map(v => ({ ...v, scores: [...v.scores], scLa: [...v.scLa], scBonus: [...v.scBonus], cards: v.cards ? [...v.cards] : v.cards, tags: v.tags.map(arr => [...arr]), names: [...v.names], absent: v.absent ? [...v.absent] : [] }));

    history.push({
        scores: sc, scLa: [...scLa], scBonus: [...scBonus], cards: cardsCount,
        tags, names: [...names], mode, absent: [...selAbsent],
        ts: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    });
    save();
    autoSaveSession();
    renderBoard();

    selXam = -1; selChan = -1; selTqChain = []; selChay = []; selWin = -1; selDenLang = -1; selAbsent = [];
    document.getElementById('chan-panel').style.display = 'none';
    document.getElementById('xam-tc').checked = false;
    const cp = document.getElementById('chan-picker');
    cp.style.opacity = '1'; cp.style.pointerEvents = 'auto';
    renderGrid(true); renderXamPickers(); setMode('normal');
    document.getElementById('van-num').textContent = `Nhập ván ${history.length + 1}`;
    document.getElementById('board-wrap').style.display = 'block';
    // Show undo button
    const undoBtn = document.getElementById('undo-btn');
    if (undoBtn) {
        undoBtn.style.display = 'inline-flex';
        clearTimeout(undoBtn._hideT);
        undoBtn._hideT = setTimeout(() => { undoBtn.style.display = 'none'; undoSnapshot = null; }, 30000);
    }
    showToast(`🃏 Ván ${history.length} đã lưu!`);
    // Auto-start timer on first van
    if (history.length === 1 && !timerRunning) toggleTimer();
    // Auto-save names to presets
    autoAddCurrentNamesToPresets();
    renderPresetChips();
    return true;
}

// ══════════════════════════════════════════════════════════════
// TIMER
// ══════════════════════════════════════════════════════════════
function fmtTime(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function updateTimerDisplay() {
    const el = document.getElementById('timer-display');
    if (el) el.textContent = fmtTime(timerSeconds);
    const bar = document.getElementById('timer-bar');
    if (bar) {
        bar.classList.toggle('timer-running', timerRunning);
        // Color warning after 2h
        bar.classList.toggle('timer-warn', timerSeconds >= 7200);
    }
}

function toggleTimer() {
    if (timerRunning) {
        // Pause
        clearInterval(timerInterval);
        timerInterval = null;
        timerRunning = false;
        document.getElementById('timer-btn').textContent = '▶ Tiếp tục';
        SFX.play('click');
    } else {
        // Start / Resume
        timerRunning = true;
        document.getElementById('timer-btn').textContent = '⏸ Tạm dừng';
        SFX.play('click');
        timerInterval = setInterval(() => {
            timerSeconds++;
            updateTimerDisplay();
        }, 1000);
    }
    updateTimerDisplay();
}

function resetTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    timerRunning = false;
    timerSeconds = 0;
    document.getElementById('timer-btn').textContent = '▶ Bắt đầu';
    SFX.play('click');
    updateTimerDisplay();
}

// ══════════════════════════════════════════════════════════════
// UNDO
// ══════════════════════════════════════════════════════════════
function undoVan() {
    if (!undoSnapshot) return;
    SFX.play('del');
    showConfirm({
        icon: '↩️', title: 'Hoàn tác ván vừa thêm?',
        msg: `Xóa ván ${history.length} vừa nhập và khôi phục trạng thái trước đó?`,
        yesDanger: true,
        onYes: () => {
            history = undoSnapshot;
            undoSnapshot = null;
            save();
            document.getElementById('undo-btn').style.display = 'none';
            if (!history.length) {
                document.getElementById('board-wrap').style.display = 'none';
            } else {
                renderBoard();
            }
            document.getElementById('van-num').textContent = `Nhập ván ${history.length + 1}`;
            showToast('↩ Đã hoàn tác ván vừa thêm!', 2000);
        },
    });
}

// ══════════════════════════════════════════════════════════════
// HÒA VỐN
// ══════════════════════════════════════════════════════════════
function renderHoaVon(names, tot) {
    const wrap = document.getElementById('hoavon-wrap');
    if (!wrap) return;
    const hasNeg = tot.some(t => t < 0);
    if (!hasNeg) {
        wrap.innerHTML = '';
        return;
    }
    let html = '<div class="hoavon-title">🎯 Cần thắng để hòa vốn</div><div class="hoavon-grid">';
    for (let i = 0; i < numP; i++) {
        const t = roundScore(tot[i]);
        if (t >= 0) continue;
        const need = Math.abs(t);
        // Ước tính số ván cần thắng (giả định thắng trung bình = need / avg_win_per_van)
        const wins = history.map(v => v.scores[i]).filter(s => s > 0);
        const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : rules.la * 5;
        const vansEstimate = avgWin > 0 ? Math.ceil(need / avgWin) : '?';
        html += `<div class="hoavon-item">
            <span class="hoavon-name">${escapeHtml(names[i])}</span>
            <span class="hoavon-need neg">-${need}đ</span>
            <span class="hoavon-arrow">→</span>
            <span class="hoavon-est">~${vansEstimate} ván</span>
        </div>`;
    }
    html += '</div>';
    wrap.innerHTML = html;
}

// ══════════════════════════════════════════════════════════════
// THỐNG KÊ NHANH
// ══════════════════════════════════════════════════════════════
function renderStats(names, tot) {
    if (history.length < 2) {
        document.getElementById('stats-card').style.display = 'none';
        return;
    }
    document.getElementById('stats-card').style.display = 'block';

    // Tính các chỉ số
    const winCounts = new Array(numP).fill(0);
    const chayCounts = new Array(numP).fill(0);
    const xamCounts = new Array(numP).fill(0);
    const tqCounts = new Array(numP).fill(0);
    let biggestLoss = { val: 0, who: -1, van: -1 };
    let biggestWin = { val: 0, who: -1, van: -1 };

    history.forEach((v, vi) => {
        // Tìm người thắng ván (điểm cao nhất ván đó)
        const maxScore = Math.max(...v.scores);
        v.scores.forEach((s, i) => {
            if (s === maxScore && s > 0) winCounts[i]++;
            if (s > biggestWin.val) { biggestWin = { val: s, who: i, van: vi + 1 }; }
            if (s < -biggestLoss.val) { biggestLoss = { val: -s, who: i, van: vi + 1 }; }
        });
        v.tags.forEach((tArr, i) => tArr.forEach(t => {
            const tag = typeof t === 'string' ? t : t.tag;
            if (tag === 'C') chayCounts[i]++;
            if (tag === 'X') xamCounts[i]++;
            if (tag === 'Q') tqCounts[i]++;
        }));
    });

    const leader = tot.indexOf(Math.max(...tot));
    const loser = tot.indexOf(Math.min(...tot));
    const mostWins = winCounts.indexOf(Math.max(...winCounts));
    const mostChay = chayCounts.indexOf(Math.max(...chayCounts));

    const statRows = [
        { icon: '🏆', label: 'Đang dẫn đầu', val: names[leader], sub: `+${tot[leader]}đ tổng` },
        { icon: '😢', label: 'Đang thua nhiều nhất', val: names[loser], sub: `${tot[loser]}đ tổng` },
        { icon: '🎯', label: 'Thắng ván nhiều nhất', val: names[mostWins], sub: `${winCounts[mostWins]} ván` },
        chayCounts[mostChay] > 0
            ? { icon: '⚡', label: 'Cháy bài nhiều nhất', val: names[mostChay], sub: `${chayCounts[mostChay]} lần` }
            : null,
        biggestWin.who >= 0
            ? { icon: '💰', label: 'Ván thắng lớn nhất', val: names[biggestWin.who], sub: `+${biggestWin.val}đ (ván ${biggestWin.van})` }
            : null,
        biggestLoss.who >= 0
            ? { icon: '💸', label: 'Ván thua đau nhất', val: names[biggestLoss.who], sub: `-${biggestLoss.val}đ (ván ${biggestLoss.van})` }
            : null,
        xamCounts.some(c => c > 0)
            ? { icon: '🎴', label: 'Sâm thành công nhiều nhất', val: names[xamCounts.indexOf(Math.max(...xamCounts))], sub: `${Math.max(...xamCounts)} lần` }
            : null,
    ].filter(Boolean);

    let html = '<div class="stats-grid">';
    statRows.forEach(r => {
        html += `<div class="stat-item">
            <span class="stat-icon">${r.icon}</span>
            <div class="stat-body">
                <div class="stat-label">${r.label}</div>
                <div class="stat-val">${r.val}</div>
                <div class="stat-sub">${r.sub}</div>
            </div>
        </div>`;
    });
    html += '</div>';

    // Thêm tổng thời gian nếu timer đang chạy
    if (timerSeconds > 0) {
        html += `<div class="stats-timer-row">⏱️ Thời gian buổi chơi: <b>${fmtTime(timerSeconds)}</b> · ${history.length} ván</div>`;
    }

    document.getElementById('stats-content').innerHTML = html;
}

function fmtDelta(delta) {
    if (delta === undefined || delta === null) return '';
    return (delta > 0 ? '+' : '') + delta + 'đ';
}

function isVanXam(v) {
    if (!v) return false;
    if (v.mode === 'xam') return true;
    if (v.tags && v.tags.some(pTags => pTags.some(t => {
        const tag = typeof t === 'string' ? t : t.tag;
        return tag === 'X' || tag === 'Chan' || tag === 'Xchan';
    }))) return true;
    return false;
}

function isVanTQ(v) {
    if (!v) return false;
    if (v.tags && v.tags.some(pTags => pTags.some(t => {
        const tag = typeof t === 'string' ? t : t.tag;
        return tag === 'Q' || tag === 'Qbat' || tag === 'Qsafe';
    }))) return true;
    return false;
}

function isVanChay(v) {
    if (!v) return false;
    if (v.tags && v.tags.some(pTags => pTags.some(t => {
        const tag = typeof t === 'string' ? t : t.tag;
        return tag === 'C';
    }))) return true;
    return false;
}

function setHistoryFilter(f) {
    SFX.play('click');
    currentHistoryFilter = f;
    renderBoard();
}

function renderBoard() {
    if (!history.length) return;
    const names = history[history.length - 1].names;
    const tot = new Array(numP).fill(0);
    history.forEach(v => v.scores.forEach((s, i) => tot[i] += s));
    const order = [...Array(numP).keys()].sort((a, b) => tot[b] - tot[a]);

    // Scoreboard
    const sb = document.getElementById('scoreboard');
    if (sb) {
        let sbHtml = `<div class="sb-head"><span>#</span><span>Tên</span><span style="text-align:right">Điểm</span></div>`;
        order.forEach((pi, rank) => {
            const t = roundScore(tot[pi]);
            sbHtml += `<div class="sb-row${rank === 0 ? ' leader' : ''}">
          <span class="sb-rank">${['🥇', '🥈', '🥉'][rank] || '#' + (rank + 1)}</span>
          <span class="sb-name">${escapeHtml(names[pi])}</span>
          <span class="sb-pts ${t >= 0 ? 'pos' : 'neg'}">${t > 0 ? '+' : ''}${t}</span>
        </div>`;
        });
        sb.innerHTML = sbHtml;
    }

    // History Filter Bar
    const fb = document.getElementById('history-filter-bar');
    if (fb) {
        let countXam = 0, countTQ = 0, countChay = 0;
        history.forEach(v => {
            if (isVanXam(v)) countXam++;
            if (isVanTQ(v)) countTQ++;
            if (isVanChay(v)) countChay++;
        });

        fb.innerHTML = `
            <button class="hfilter-btn ${currentHistoryFilter === 'all' ? 'active' : ''}" onclick="setHistoryFilter('all')">
                Tất cả <span class="hfilter-badge">${history.length}</span>
            </button>
            <button class="hfilter-btn ${currentHistoryFilter === 'xam' ? 'active' : ''}" onclick="setHistoryFilter('xam')">
                🎯 Có Sâm <span class="hfilter-badge">${countXam}</span>
            </button>
            <button class="hfilter-btn ${currentHistoryFilter === 'tq' ? 'active' : ''}" onclick="setHistoryFilter('tq')">
                💣 Có Tứ quý <span class="hfilter-badge">${countTQ}</span>
            </button>
            <button class="hfilter-btn ${currentHistoryFilter === 'chay' ? 'active' : ''}" onclick="setHistoryFilter('chay')">
                🔥 Cháy bài <span class="hfilter-badge">${countChay}</span>
            </button>
        `;
    }

    // History table
    const ht = document.getElementById('hist-table');
    if (ht) {
        let th = `<tr><th>Ván</th><th>Giờ</th>`;
        names.forEach(n => th += `<th>${escapeHtml(n)}</th>`);
        th += `<th>📝</th><th></th></tr>`;

        let rows = '';
        let matchedCount = 0;
        const filterTot = new Array(numP).fill(0);

        for (let vi = history.length - 1; vi >= 0; vi--) {
            const v = history[vi];

            // Filter check
            if (currentHistoryFilter === 'xam' && !isVanXam(v)) continue;
            if (currentHistoryFilter === 'tq' && !isVanTQ(v)) continue;
            if (currentHistoryFilter === 'chay' && !isVanChay(v)) continue;

            matchedCount++;
            v.scores.forEach((s, i) => filterTot[i] += s);

            const isLast = vi === history.length - 1;
            let tr = `<tr${isLast ? ' class="new-row"' : ''}>
          <td style="color:var(--muted);font-weight:700;font-size:11px;">${v.mode === 'xam' ? '🎯 ' : ''}V${vi + 1}</td>
          <td style="color:var(--muted);font-size:11px;white-space:nowrap;">${v.ts || ''}</td>`;

            for (let i = 0; i < numP; i++) {
                if (v.absent && v.absent.includes(i)) {
                    tr += `<td><div class="score-cell"><span class="score-main" style="color:var(--muted);font-weight:500;font-size:12px;">😴 vắng</span></div></td>`;
                    continue;
                }
                const s = roundScore(v.scores[i]);
                const scLa = v.scLa ? roundScore(v.scLa[i]) : null;
                const tagList = v.tags[i] || [];
                let badges = tagList.map(tObj => {
                    const tag = typeof tObj === 'string' ? tObj : tObj.tag;
                    const delta = typeof tObj === 'string' ? null : tObj.delta;
                    const lbl = TLBL[tag] || tag;
                    const cls = TMAP[tag] || 'bx';
                    const deltaStr = delta !== null ? ` (${fmtDelta(roundScore(delta))})` : '';
                    return `<span class="badge ${cls}">${lbl}${deltaStr}</span>`;
                }).join('');
                let laStr = '';
                const nCards = v.cards ? v.cards[i] : null;
                if (nCards !== null && nCards !== undefined)
                    laStr = `<span class="badge ${nCards === 0 ? 'bq' : 'bx'}">🃏 ${nCards} lá</span>`;
                else if (scLa !== null && scLa !== 0) // ván cũ chưa lưu số lá
                    laStr = `<span class="badge ${scLa > 0 ? 'bq' : 'bc'}">Lá ${fmtDelta(scLa)}</span>`;
                tr += `<td>
            <div class="score-cell">
              <span class="score-main ${s >= 0 ? 'pos' : 'neg'}">${s > 0 ? '+' : ''}${s}</span>
              <div class="score-breakdown">${laStr}${badges}</div>
            </div>
          </td>`;
            }
            const noteText = vanNotes[vi] || '';
            tr += `<td>
              <div class="van-note-cell">
                <button class="note-btn${noteText ? ' has-note' : ''}" onclick="editVanNote(${vi})" title="${noteText ? escapeHtml(noteText) : 'Thêm ghi chú'}">
                  ${noteText ? '📝' : '✏️'}
                </button>
                ${noteText ? `<span class="note-preview">${escapeHtml(noteText.substring(0, 30))}${noteText.length > 30 ? '…' : ''}</span>` : ''}
              </div>
            </td>`;
            tr += `<td><button class="del-btn" onclick="delVan(${vi})">🗑</button></td></tr>`;
            rows += tr;
        }

        let totRow = '';
        if (matchedCount === 0) {
            rows = `<tr><td colspan="${numP + 4}" style="text-align:center;padding:24px;color:var(--muted);font-style:italic;">Không có ván nào khớp với bộ lọc này</td></tr>`;
        } else {
            const displayTotals = currentHistoryFilter === 'all' ? tot : filterTot;
            const labelTot = currentHistoryFilter === 'all' ? 'Tổng' : `Tổng (${matchedCount} ván)`;
            totRow = `<tr class="tot-row"><td>${labelTot}</td><td></td>`;
            for (let i = 0; i < numP; i++) {
                const t = roundScore(displayTotals[i]);
                totRow += `<td class="${t >= 0 ? 'pos' : 'neg'}">${t > 0 ? '+' : ''}${t}</td>`;
            }
            totRow += `<td></td><td></td></tr>`;
        }
        ht.innerHTML = th + rows + totRow;
    }

    // Extra panels
    renderHoaVon(names, tot);
    renderStats(names, tot);
    renderSettlement(names, tot);
}

function delVan(idx) {
    SFX.play('click');
    showConfirm({
        icon: '🗑️', title: 'Xóa ván?',
        msg: `Bạn có chắc muốn xóa ván ${idx + 1} không?\nHành động này không thể hoàn tác.`,
        yesDanger: true,
        onYes: () => {
            SFX.play('del');
            history.splice(idx, 1); save();
            if (!history.length) document.getElementById('board-wrap').style.display = 'none';
            else renderBoard();
            document.getElementById('van-num').textContent = `Nhập ván ${history.length + 1}`;
        },
    });
}

function resetGame() {
    showConfirm({
        icon: '🔄', title: 'Ván mới?',
        msg: 'Lưu buổi hiện tại và bắt đầu ván mới?',
        yesDanger: false,
        onYes: () => {
            // Tự động lưu buổi hiện tại trước khi reset
            if (history.length) {
                saveSession();
            }
            currentSessionId = null;
            currentHistoryFilter = 'all';
            history = []; undoSnapshot = null; vanNotes = {}; save();
            if (window.fbBridge && fbBridge.resetStat) fbBridge.resetStat();   // buổi mới → bộ đếm ván extension về 0
            resetTimer();
            document.getElementById('board-wrap').style.display = 'none';
            document.getElementById('van-num').textContent = 'Nhập ván 1';
            const undoBtn = document.getElementById('undo-btn');
            if (undoBtn) undoBtn.style.display = 'none';
            renderGrid(); renderXamPickers(); setMode('normal');
        },
    });
}

// ══════════════════════════════════════════════════════════════
// ADMIN
// ══════════════════════════════════════════════════════════════
function loadAdminFields() {
    document.getElementById('cfg-la').value = rules.la;
    document.getElementById('cfg-xw').value = rules.xw;
    document.getElementById('cfg-xl').value = rules.xl;
    document.getElementById('cfg-tq').value = rules.tq;
    document.getElementById('cfg-tq-on').checked = rules.tqOn;
    document.getElementById('cfg-chay').value = rules.chay;
    document.getElementById('cfg-chay-on').checked = rules.chayOn;
    previewRules();
}

function previewRules() {
    const la = parseFloat(document.getElementById('cfg-la').value);
    const xw = parseInt(document.getElementById('cfg-xw').value);
    const xl = parseInt(document.getElementById('cfg-xl').value);
    const tq = parseInt(document.getElementById('cfg-tq').value);
    const tqOn = document.getElementById('cfg-tq-on').checked;
    const chay = parseFloat(document.getElementById('cfg-chay').value);
    const chayOn = document.getElementById('cfg-chay-on').checked;
    let parts = [
        `<b>1 lá</b> = ${isNaN(la) ? '?' : la}đ`,
        `<b>🎯 Sâm thành công</b> = mỗi người -${isNaN(xw) ? '?' : xw}đ, người sâm +${isNaN(xw) ? '?' : xw * (numP - 1)}đ`,
        `<b>🛡 Bị chặn</b> = người sâm -${isNaN(xl) ? '?' : xl}đ, người chặn +${isNaN(xl) ? '?' : xl}đ`,
    ];
    if (tqOn) parts.push(`<b>🔥 Tứ quý</b> = +${isNaN(tq) ? '?' : tq}đ / -${isNaN(tq) ? '?' : tq}đ`);
    if (chayOn) parts.push(`<b>⚡ Cháy bài</b> = +${isNaN(chay) ? '?' : chay} lá`);
    document.getElementById('admin-preview').innerHTML = parts.join(' &nbsp;·&nbsp; ');
}

function handleSaveRules(e) {
    spawnRipple(document.getElementById('save-rules-btn'), e);
    animateSaveBtn(() => saveRules());
}

function saveRules() {
    const readInt = (id, fb) => { const v = parseInt(document.getElementById(id).value); return isNaN(v) || v < 1 ? fb : v; };
    const readFloat = (id, fb) => { const v = parseFloat(document.getElementById(id).value); return isNaN(v) || v < 0 ? fb : v; };
    rules = {
        la: readFloat('cfg-la', rules.la),
        xw: readInt('cfg-xw', rules.xw),
        xl: readInt('cfg-xl', rules.xl),
        tq: readInt('cfg-tq', rules.tq),
        tqOn: document.getElementById('cfg-tq-on').checked,
        chay: readInt('cfg-chay', rules.chay),
        chayOn: document.getElementById('cfg-chay-on').checked,
    };
    save();
    updateRuleSummary();
    renderGrid(); renderXamPickers(); renderBonusPickers();
    showToast('✅ Luật đã lưu! Áp dụng từ ván tiếp theo.', 3000);
}

function updateRuleSummary() {
    let parts = [
        `<b>1 lá</b> = ${rules.la}đ`,
        `<b>🎯 Sâm thành công</b> = mỗi người -${rules.xw}đ, người sâm +${rules.xw * (numP - 1)}đ`,
        `<b>🛡 Bị chặn</b> = người sâm -${rules.xl}đ, người chặn +${rules.xl}đ`,
    ];
    if (rules.tqOn) parts.push(`<b>🔥 Tứ quý</b> = +${rules.tq}đ / -${rules.tq}đ`);
    if (rules.chayOn) parts.push(`<b>⚡ Cháy bài</b> = +${rules.chay} lá`);
    document.getElementById('rule-summary').innerHTML = parts.map(p => `<span class="rs-chip">${p}</span>`).join('');
}

// ══════════════════════════════════════════════════════════════
// EXPORT EXCEL
// ══════════════════════════════════════════════════════════════
function exportXLSX() {
    if (!history.length) { showAlert({ icon: '📋', title: 'Chưa có dữ liệu', msg: 'Chưa có ván nào để xuất!' }); return; }
    const names = history[history.length - 1].names;
    const wb = XLSX.utils.book_new();
    const tot = new Array(numP).fill(0);
    history.forEach(v => v.scores.forEach((s, i) => tot[i] += s));

    // Sheet 1: Lịch sử ván
    const hdrs = ['Ván', 'Giờ', 'Loại', ...names.slice(0, numP), 'Ghi chú'];
    const rows = [hdrs];
    history.forEach((v, vi) => {
        const note = v.tags.map((tl, i) => {
            const tagNames = tl.map(t => { const tag = typeof t === 'string' ? t : t.tag; return TLBL[tag] || tag; });
            return tagNames.length ? `${names[i]}:[${tagNames.join(',')}]` : null;
        }).filter(Boolean).join(' | ');
        rows.push([`Ván ${vi + 1}`, v.ts || '', v.mode === 'xam' ? (v.white ? 'Ăn trắng' : 'Sâm') : 'Bình thường', ...v.scores.slice(0, numP), note]);
    });
    rows.push(['TỔNG', '', '', ...tot.slice(0, numP), '']);
    const ws1 = XLSX.utils.aoa_to_sheet(rows);
    ws1['!cols'] = [8, 8, 14, ...names.slice(0, numP).map(() => 12), 30].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws1, 'Lịch sử ván');

    // Sheet 2: Xếp hạng
    const rank = [...Array(numP).keys()].sort((a, b) => tot[b] - tot[a]);
    const ws2 = XLSX.utils.aoa_to_sheet([
        ['Hạng', 'Tên', 'Điểm tổng', 'Tiền (nghìn đồng)'],
        ...rank.map((pi, r) => [r + 1, names[pi], tot[pi], `${tot[pi] >= 0 ? '+' : ''}${tot[pi].toLocaleString('vi-VN')}k`]),
    ]);
    ws2['!cols'] = [{ wch: 8 }, { wch: 16 }, { wch: 14 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Xếp hạng');

    // Sheet 3: Luật chơi
    const ws3 = XLSX.utils.aoa_to_sheet([
        ['Luật', 'Giá trị'],
        ['1 lá bài', rules.la],
        ['Sâm thành công (đ/người)', rules.xw],
        ['Sâm bị chặn phạt (đ/người)', rules.xl],
        ['Tứ quý (đ/người)', rules.tq],
        ['Bật tứ quý', rules.tqOn ? 'Có' : 'Không'],
        ['Cháy bài (lá phạt)', rules.chay],
        ['Bật cháy bài', rules.chayOn ? 'Có' : 'Không'],
    ]);
    ws3['!cols'] = [{ wch: 28 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws3, 'Luật chơi');

    // Sheet 4: Thanh toán cuối buổi
    const balances = tot.map((t, i) => ({ i, bal: t }));
    const creditors = balances.filter(b => b.bal > 0).sort((a, b) => b.bal - a.bal);
    const debtors = balances.filter(b => b.bal < 0).sort((a, b) => a.bal - b.bal);
    const txns = [];
    const cred = creditors.map(c => ({ ...c }));
    const debt = debtors.map(d => ({ ...d }));
    let ci = 0, di = 0;
    while (ci < cred.length && di < debt.length) {
        const amount = Math.min(cred[ci].bal, -debt[di].bal);
        if (amount > 0) txns.push({ from: debt[di].i, to: cred[ci].i, amount });
        cred[ci].bal -= amount; debt[di].bal += amount;
        if (Math.abs(cred[ci].bal) < 0.01) ci++;
        if (Math.abs(debt[di].bal) < 0.01) di++;
    }
    const settRows = [['Người trả', 'Người nhận', 'Số tiền (đ)']];
    if (txns.length) {
        txns.forEach(t => {
            const amt = Number.isInteger(t.amount) ? t.amount : parseFloat(t.amount.toFixed(1));
            settRows.push([names[t.from], names[t.to], amt]);
        });
    } else {
        settRows.push(['—', 'Tất cả huề, không ai nợ ai!', '']);
    }
    const ws4 = XLSX.utils.aoa_to_sheet(settRows);
    ws4['!cols'] = [{ wch: 18 }, { wch: 18 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws4, 'Thanh toán');

    const date = new Date().toLocaleDateString('vi-VN').replace(/\//g, '-');
    XLSX.writeFile(wb, `XamLoc_${date}.xlsx`);
}

// ══════════════════════════════════════════════════════════════
// IMPORT EXCEL
// ══════════════════════════════════════════════════════════════
function importXLSX(e) {
    const file = e.target.files[0]; if (!file) return;
    processFile(file); e.target.value = '';
}

function handleDrop(e) {
    e.preventDefault();
    document.getElementById('drop-zone').classList.remove('drag');
    const file = e.dataTransfer.files[0]; if (file) processFile(file);
}

function processFile(file) {
    const reader = new FileReader();
    reader.onload = ev => {
        try {
            const wb = XLSX.read(ev.target.result, { type: 'binary' });
            const ws = wb.Sheets['Lịch sử ván'];
            if (!ws) { showAlert({ icon: '❌', title: 'Lỗi file', msg: 'Không tìm thấy sheet "Lịch sử ván". File không đúng định dạng!' }); return; }
            const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
            if (data.length < 2) { showAlert({ icon: '📋', title: 'File trống', msg: 'File không có dữ liệu!' }); return; }

            const headers = data[0];
            const nameStart = 3, nameEnd = headers.length - 1;
            const impNames = headers.slice(nameStart, nameEnd);
            const n = impNames.length;

            const newHist = [];
            for (let i = 1; i < data.length; i++) {
                const row = data[i];
                if (!row[0] || String(row[0]).startsWith('TỔNG')) continue;
                const scores = row.slice(nameStart, nameStart + n).map(v => Number(v) || 0);
                const noteStr = row[nameStart + n] || '';
                const tags = Array.from({ length: n }, () => []);
                const scBonus = scores.map(() => 0);
                noteStr.split('|').forEach(seg => {
                    const m = seg.trim().match(/^(.+?):\[(.+?)\]$/); if (!m) return;
                    const idx = impNames.findIndex(nm => nm.trim() === m[1].trim());
                    if (idx >= 0) {
                        tags[idx] = m[2].split(',').map(t => {
                            const found = Object.entries(TLBL).find(([, v]) => v === t.trim());
                            return found ? found[0] : t.trim();
                        });
                        // tính scBonus cho các tag bonus (không phải lá)
                        tags[idx].forEach(tag => {
                            if (['W', 'X', 'Xchan', 'Chan', 'Q', 'Qbat'].includes(tag)) {
                                // bonus sẽ là toàn bộ score nếu mode xam, hoặc phần bonus trong normal
                                scBonus[idx] = scores[idx]; // approximation
                            }
                        });
                    }
                });
                // scLa = scores - scBonus (phần điểm từ lá bài)
                const scLa = scores.map((s, i) => s - scBonus[i]);
                newHist.push({ scores, scLa, scBonus: scores.map(() => 0), tags, names: [...impNames], mode: (String(row[2]).includes('Sâm') || String(row[2]).includes('Ăn trắng')) ? 'xam' : 'normal', white: String(row[2]).includes('Ăn trắng'), ts: row[1] || '' });
            }

            showConfirm({
                icon: '📤', title: 'Xác nhận nhập file?',
                msg: `Tìm thấy ${newHist.length} ván với ${n} người:\n${impNames.join(', ')}\n\nNhập sẽ THAY THẾ lịch sử ván hiện tại (luật chơi giữ nguyên).`,
                onYes: () => {
                    numP = n;
                    pnames = [...impNames, 'Người 1', 'Người 2', 'Người 3', 'Người 4'].slice(0, 4);
                    history = newHist;
                    try {
                        localStorage.setItem(LS_RULES, JSON.stringify(rules));
                        localStorage.setItem(LS_HISTORY, JSON.stringify(history));
                        localStorage.setItem(LS_PLAYERS, JSON.stringify({ numP, pnames }));
                    } catch (e) { }
                    updateRuleSummary(); setActivePBtn();
                    renderNames(); renderGrid(); renderXamPickers();
                    if (history.length) {
                        renderBoard();
                        document.getElementById('board-wrap').style.display = 'block';
                        document.getElementById('van-num').textContent = `Nhập ván ${history.length + 1}`;
                    }
                    const msg = document.getElementById('import-msg');
                    if (msg) { msg.textContent = `✅ Nhập thành công ${newHist.length} ván!`; setTimeout(() => msg.textContent = '', 4000); }
                    showAlert({ icon: '✅', title: 'Nhập thành công!', msg: `Đã nhập ${newHist.length} ván thành công!` });
                },
            });
        } catch (err) { showAlert({ icon: '❌', title: 'Lỗi đọc file', msg: 'Lỗi: ' + err.message }); }
    };
    reader.readAsBinaryString(file);
}

// ══════════════════════════════════════════════════════════════
// CLEAR DATA
// ══════════════════════════════════════════════════════════════
function clearHistory() {
    showConfirm({
        icon: '🗑️', title: 'Xóa lịch sử?',
        msg: 'Xóa toàn bộ lịch sử ván chơi?\nHành động này không thể hoàn tác.',
        yesDanger: true,
        onYes: () => {
            history = []; save(); updateStorageInfo();
            document.getElementById('board-wrap').style.display = 'none';
            document.getElementById('van-num').textContent = 'Nhập ván 1';
            showAlert({ icon: '✅', title: 'Xong!', msg: 'Đã xóa toàn bộ lịch sử ván chơi.' });
        },
    });
}

function clearAll() {
    showModal({
        icon: '☢️',
        title: 'Xóa toàn bộ dữ liệu?',
        msg: '⚠️ Hành động này sẽ xóa VĨNH VIỄN:\n\n• Toàn bộ lịch sử ván chơi\n• Tất cả buổi chơi đã lưu\n• Tên người chơi & preset\n• Luật chơi tùy chỉnh\n• Cài đặt âm thanh & giao diện\n\nKhông thể hoàn tác. Ứng dụng sẽ về trạng thái mặc định hoàn toàn.',
        buttons: [
            { label: 'Hủy', cls: 'modal-btn-cancel' },
            {
                label: 'Tôi hiểu, xóa hết',
                cls: 'modal-btn-danger',
                cb: () => {
                    showConfirm({
                        icon: '🚨',
                        title: 'Xác nhận lần cuối',
                        msg: 'Chắc chắn xóa toàn bộ? Mọi dữ liệu sẽ mất hoàn toàn.',
                        yesDanger: true,
                        onYes: () => {
                            localStorage.clear();
                            localStorage.setItem('xamloc_theme', 'light');
                            location.reload();
                        },
                    });
                },
            },
        ],
    });
}

function setActivePBtn() {
    ['pbtn2', 'pbtn3', 'pbtn4'].forEach(id => {
        document.getElementById(id).className =
            'btn-outline' + (parseInt(id.replace('pbtn', '')) === numP ? ' active' : '');
    });
}

// ══════════════════════════════════════════════════════════════
// TÍNH TIỀN CUỐI BUỔI (Settlement)
// ══════════════════════════════════════════════════════════════
function renderSettlement(names, tot) {
    const wrap = document.getElementById('settlement-wrap');
    if (!wrap) return;
    if (!history.length) { wrap.innerHTML = ''; return; }

    // Tính ai trả ai bao nhiêu (min-transactions)
    const balances = tot.map((t, i) => ({ i, bal: t }));
    const creditors = balances.filter(b => b.bal > 0).sort((a, b) => b.bal - a.bal);
    const debtors = balances.filter(b => b.bal < 0).sort((a, b) => a.bal - b.bal);

    const txns = [];
    const cred = creditors.map(c => ({ ...c }));
    const debt = debtors.map(d => ({ ...d }));
    let ci = 0, di = 0;
    while (ci < cred.length && di < debt.length) {
        const amount = Math.min(cred[ci].bal, -debt[di].bal);
        if (amount > 0) {
            txns.push({ from: debt[di].i, to: cred[ci].i, amount });
        }
        cred[ci].bal -= amount;
        debt[di].bal += amount;
        if (Math.abs(cred[ci].bal) < 0.01) ci++;
        if (Math.abs(debt[di].bal) < 0.01) di++;
    }

    if (!txns.length) {
        wrap.innerHTML = `<div class="settlement-wrap"><div class="settlement-title">💰 Thanh toán cuối buổi</div><div class="settlement-zero">🎉 Tất cả huề — không ai nợ ai!</div></div>`;
        return;
    }

    let html = `<div class="settlement-wrap">
    <div id="settlement-capture" class="settlement-capture">
    <div class="settlement-title">💰 Thanh toán cuối buổi</div>
    <div class="settlement-list">`;
    txns.forEach(t => {
        const amt = roundScore(t.amount);
        const display = Number.isInteger(amt) ? amt : amt.toFixed(1).replace(/\.0$/, '');
        const safeFrom = names[t.from].replace(/'/g, "\\'");
        const safeTo = names[t.to].replace(/'/g, "\\'");
        html += `<div class="settlement-row" onclick="openVietQRModal('${safeFrom}', '${safeTo}', ${amt})" style="cursor:pointer;" title="Bấm để mở mã VietQR chuyển khoản">
      <span class="sett-from">${escapeHtml(names[t.from])}</span>
      <span class="sett-arrow">→</span>
      <span class="sett-to">${escapeHtml(names[t.to])}</span>
      <span class="sett-amt">${display}đ</span>
      <button class="sett-qr-btn" data-html2canvas-ignore="true" onclick="event.stopPropagation(); openVietQRModal('${safeFrom}', '${safeTo}', ${amt})" title="Tạo mã VietQR chuyển khoản">
        <span class="qr-icon">📲</span> QR
      </button>
    </div>`;
    });
    html += `</div>
    </div>
    <div class="share-actions" style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="share-btn" onclick="shareResult()">📤 Chia sẻ kết quả</button>
      <button class="share-btn" style="background:var(--surface2);color:var(--text);border:1px solid var(--border2);" onclick="exportSettlementImage()">📸 Lưu ảnh</button>
    </div>
    </div>`;
    wrap.innerHTML = html;
}

// ══════════════════════════════════════════════════════════════
// GHI CHÚ VÁN
// ══════════════════════════════════════════════════════════════
function editVanNote(vi) {
    SFX.play('click');
    const current = vanNotes[vi] || '';
    // Use a custom input modal
    showInputModal({
        icon: '📝',
        title: `Ghi chú ván ${vi + 1}`,
        placeholder: 'VD: ván này thằng A may vãi, sâm căng nhất...',
        value: current,
        onOk: (val) => {
            if (val.trim()) {
                vanNotes[vi] = val.trim();
            } else {
                delete vanNotes[vi];
            }
            save();
            renderBoard();
            SFX.play('save');
        }
    });
}

function showInputModal({ icon = '✏️', title, placeholder = '', value = '', onOk }) {
    document.getElementById('modal-icon').textContent = icon;
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-msg').textContent = '';
    const acts = document.getElementById('modal-actions');
    acts.innerHTML = `
      <textarea id="modal-input" rows="3" placeholder="${placeholder}" style="width:100%;padding:10px;border-radius:8px;border:1.5px solid var(--border2);background:var(--surface2);color:var(--text);font-size:14px;resize:vertical;margin-bottom:10px;font-family:inherit;">${value}</textarea>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="modal-btn modal-btn-cancel" id="modal-cancel-btn">Hủy</button>
        <button class="modal-btn modal-btn-primary" id="modal-ok-btn">Lưu</button>
      </div>`;
    document.getElementById('modal-cancel-btn').onclick = () => closeModal();
    document.getElementById('modal-ok-btn').onclick = () => {
        const val = document.getElementById('modal-input').value;
        closeModal();
        if (onOk) onOk(val);
    };
    const ov = document.getElementById('modal-overlay');
    ov.style.display = 'flex';
    requestAnimationFrame(() => {
        ov.classList.add('show');
        document.getElementById('modal-input').focus();
    });
}

// ══════════════════════════════════════════════════════════════
// LƯU NHIỀU BUỔI
// ══════════════════════════════════════════════════════════════
function saveSession() {
    if (!history.length) { showAlert({ icon: '📋', title: 'Chưa có dữ liệu', msg: 'Chưa có ván nào để lưu buổi!' }); return; }
    const names = history[history.length - 1].names;
    const tot = new Array(numP).fill(0);
    history.forEach(v => v.scores.forEach((s, i) => tot[i] += s));
    const label = new Date().toLocaleDateString('vi-VN', { weekday: 'short', day: 'numeric', month: 'numeric' });
    if (!currentSessionId) currentSessionId = Date.now();
    const session = {
        id: currentSessionId,
        date: new Date().toISOString(),
        label,
        numP,
        names: [...names],
        history: JSON.parse(JSON.stringify(history)),
        notes: JSON.parse(JSON.stringify(vanNotes)),
        rules: { ...rules },
        tot: [...tot],
        // autoSaved flag xóa đi — buổi này đã được lưu chính thức
    };
    const idx = sessions.findIndex(s => s.id === currentSessionId);
    if (idx >= 0) {
        sessions[idx] = session;
    } else {
        sessions.unshift(session);
        if (sessions.length > 50) sessions = sessions.slice(0, 50);
    }
    try {
        localStorage.setItem(LS_SESSIONS, JSON.stringify(sessions));
    } catch (e) {
        console.warn('sessions save error', e);
        showToast('⚠️ Bộ nhớ máy đầy, buổi chơi có thể chưa lưu được!', 3000);
    }

    // Vinh danh người dẫn đầu buổi (nếu có người rõ ràng #1, không hòa)
    const maxTot = Math.max(...tot);
    const leaders = tot.filter(t => t === maxTot);
    if (maxTot > 0 && leaders.length === 1) {
        SFX.play('rank1');
        const anchor = document.getElementById('nav-sessions') || document.body;
        burstConfetti(anchor, { gold: true, count: 30 });
        haptic([20, 30, 20, 30, 20, 60]);
    } else {
        SFX.play('save');
    }
    showToast(`💾 Đã lưu buổi ${label}!`, 2500);
    renderSessionsList();
    renderHighlights();
}

// Tự động lưu/cập nhật buổi hiện tại vào sessions (upsert)
function autoSaveSession() {
    if (!history.length) return;
    const names = history[history.length - 1].names;
    const tot = new Array(numP).fill(0);
    history.forEach(v => v.scores.forEach((s, i) => tot[i] += s));
    const label = new Date().toLocaleDateString('vi-VN', { weekday: 'short', day: 'numeric', month: 'numeric' });

    if (!currentSessionId) currentSessionId = Date.now();

    const session = {
        id: currentSessionId,
        date: new Date().toISOString(),
        label,
        numP,
        names: [...names],
        history: JSON.parse(JSON.stringify(history)),
        notes: JSON.parse(JSON.stringify(vanNotes)),
        rules: { ...rules },
        tot: [...tot],
        autoSaved: true,
    };

    // Upsert: thay thế nếu đã có, thêm mới nếu chưa
    const idx = sessions.findIndex(s => s.id === currentSessionId);
    if (idx >= 0) {
        sessions[idx] = session;
    } else {
        sessions.unshift(session);
        if (sessions.length > 50) sessions = sessions.slice(0, 50);
    }

    try {
        localStorage.setItem(LS_SESSIONS, JSON.stringify(sessions));
    } catch (e) { console.warn('autoSaveSession error', e); }
}

function renderSessionsList() {
    const wrap = document.getElementById('sessions-list');
    if (!wrap) return;
    if (!sessions.length) {
        wrap.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:16px;">Chưa có buổi nào được lưu</div>';
        return;
    }
    wrap.innerHTML = sessions.map((s, si) => {
        const winner = s.names[s.tot.indexOf(Math.max(...s.tot))];
        const totStr = s.tot.map((t, i) => `${s.names[i]}: ${t > 0 ? '+' : ''}${t}`).join(', ');
        const liveBadge = s.autoSaved ? ' <span style="font-size:10px;background:var(--green);color:#fff;padding:1px 5px;border-radius:6px;vertical-align:middle;">đang chơi</span>' : '';
        return `<div class="session-row">
      <div class="session-info">
        <div class="session-label">📅 ${s.label}${liveBadge} · ${s.history.length} ván · ${s.numP} người</div>
        <div class="session-sub">🏆 ${winner} thắng · ${totStr}</div>
      </div>
      <div class="session-actions">
        <button class="sec-btn" onclick="loadSession(${si})">Xem lại</button>
        <button class="sec-btn danger" onclick="deleteSession(${si})">🗑</button>
      </div>
    </div>`;
    }).join('');
}

function loadSession(si) {
    showSessionViewer(sessions[si]);
}

function showSessionViewer(s) {
    const tot = s.tot;
    const names = s.names;
    const order = [...Array(s.numP).keys()].sort((a, b) => tot[b] - tot[a]);

    let html = `<div style="max-height:70vh;overflow-y:auto;padding:4px;">
    <div style="font-size:15px;font-weight:700;margin-bottom:12px;">📅 ${s.label} — ${s.history.length} ván</div>
    <div style="margin-bottom:10px;">`;
    order.forEach((pi, rank) => {
        const t = tot[pi];
        html += `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);">
      <span>${rank === 0 ? '🏆' : '#' + (rank + 1)} ${names[pi]}</span>
      <span class="${t >= 0 ? 'pos' : 'neg'}" style="font-weight:700;">${t > 0 ? '+' : ''}${t}</span>
    </div>`;
    });
    html += `</div>`;

    // Settlement
    const creditors = order.filter(i => tot[i] > 0).map(i => ({ i, bal: tot[i] }));
    const debtors = order.filter(i => tot[i] < 0).map(i => ({ i, bal: tot[i] }));
    const txns = [];
    const cred = creditors.map(c => ({ ...c }));
    const debt = debtors.map(d => ({ ...d }));
    let ci = 0, di = 0;
    while (ci < cred.length && di < debt.length) {
        const amount = Math.min(cred[ci].bal, -debt[di].bal);
        if (amount > 0.01) txns.push({ from: debt[di].i, to: cred[ci].i, amount });
        cred[ci].bal -= amount; debt[di].bal += amount;
        if (Math.abs(cred[ci].bal) < 0.01) ci++;
        if (Math.abs(debt[di].bal) < 0.01) di++;
    }
    if (txns.length) {
        html += `<div style="margin-top:10px;font-size:13px;font-weight:600;color:var(--muted);margin-bottom:6px;">💰 Thanh toán</div>`;
        txns.forEach(t => {
            const amt = roundScore(t.amount);
            const display = Number.isInteger(amt) ? amt : amt.toFixed(1).replace(/\.0$/, '');
            const safeFrom = names[t.from].replace(/'/g, "\\'");
            const safeTo = names[t.to].replace(/'/g, "\\'");
            html += `<div style="display:flex;gap:8px;align-items:center;padding:5px 0;font-size:14px;cursor:pointer;" onclick="openVietQRModal('${safeFrom}', '${safeTo}', ${amt})" title="Bấm để mở mã VietQR">
        <span style="color:var(--red);font-weight:700;">${escapeHtml(names[t.from])}</span>
        <span style="color:var(--muted);">→</span>
        <span style="color:var(--green);font-weight:700;">${escapeHtml(names[t.to])}</span>
        <span style="margin-left:auto;font-weight:700;">${display}đ</span>
        <button class="sett-qr-btn" onclick="event.stopPropagation(); openVietQRModal('${safeFrom}', '${safeTo}', ${amt})" title="Tạo mã VietQR">📲 QR</button>
      </div>`;
        });
    }
    html += `</div>`;

    // Hiển thị modal trực tiếp, không qua showModal (để dùng innerHTML)
    document.getElementById('modal-icon').textContent = '📅';
    document.getElementById('modal-title').textContent = 'Xem buổi chơi';
    document.getElementById('modal-msg').innerHTML = html;
    const acts = document.getElementById('modal-actions');
    acts.innerHTML = '';
    const btn = document.createElement('button');
    btn.className = 'modal-btn modal-btn-primary';
    btn.textContent = 'Đóng';
    btn.onclick = () => closeModal();
    acts.appendChild(btn);
    const ov = document.getElementById('modal-overlay');
    ov.style.display = 'flex';
    requestAnimationFrame(() => ov.classList.add('show'));
}

function deleteSession(si) {
    showConfirm({
        icon: '🗑️', title: 'Xóa buổi chơi?',
        msg: `Xóa buổi "${sessions[si].label}"?`,
        yesDanger: true,
        onYes: () => {
            sessions.splice(si, 1);
            localStorage.setItem(LS_SESSIONS, JSON.stringify(sessions));
            renderSessionsList();
            showToast('🗑 Đã xóa buổi chơi', 1500);
        }
    });
}

// ══════════════════════════════════════════════════════════════
// TÊN NGƯỜI CHƠI HAY DÙNG (Presets)
// ══════════════════════════════════════════════════════════════
function addPreset(name) {
    name = name.trim();
    if (!name || playerPresets.includes(name)) return;
    playerPresets.push(name);
    if (playerPresets.length > 20) playerPresets = playerPresets.slice(-20);
    save();
}

function autoAddCurrentNamesToPresets() {
    getNames().forEach(n => {
        if (n && !n.startsWith('Người ')) addPreset(n);
    });
}

function renderPresetChips() {
    const wrap = document.getElementById('preset-chips');
    if (!wrap) return;
    if (!playerPresets.length) {
        wrap.innerHTML = '<span style="color:var(--muted);font-size:12px;">Chưa có tên nào được lưu</span>';
        return;
    }
    wrap.innerHTML = playerPresets.map((n, i) => {
        const bank = getPlayerBank(n);
        const bankBadge = bank && bank.account
            ? `<button class="preset-bank-btn has-bank" onclick="openBankSettingsModal('${n.replace(/'/g, "\\'")}', event)" title="STK: ${bank.bank} - ${bank.account}">🏦 ${bank.bank}</button>`
            : `<button class="preset-bank-btn" onclick="openBankSettingsModal('${n.replace(/'/g, "\\'")}', event)" title="Cài đặt STK ngân hàng">＋STK</button>`;
        return `<div class="preset-chip">
      <span onclick="applyPreset('${n.replace(/'/g, "\\'")}', event)">${escapeHtml(n)}</span>
      ${bankBadge}
      <button onclick="removePreset(${i})" class="preset-del">✕</button>
    </div>`;
    }).join('');
}

function applyPreset(name, e) {
    SFX.play('pick');
    // Find first empty/default slot
    for (let i = 0; i < numP; i++) {
        const el = document.getElementById('pn' + i);
        if (!el) continue;
        const v = el.value.trim();
        if (!v || v.startsWith('Người ')) {
            el.value = name;
            pnames[i] = name;
            save(); renderXamPickers(); renderGrid();
            showToast(`✅ Điền "${name}" vào ô trống`, 1200);
            return;
        }
    }
    showToast('⚠️ Tất cả ô tên đã được điền!', 1500);
}

function removePreset(i) {
    playerPresets.splice(i, 1);
    save();
    renderPresetChips();
}

function openPresetsManager() {
    renderPresetChips();
    const el = document.getElementById('presets-panel');
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function saveNewPreset() {
    const inp = document.getElementById('preset-input');
    if (!inp) return;
    const name = inp.value.trim();
    if (!name) return;
    addPreset(name);
    inp.value = '';
    renderPresetChips();
    SFX.play('save');
    showToast(`✅ Đã thêm "${name}"`, 1200);
}

// ══════════════════════════════════════════════════════════════
// KHOẢNH KHẮC ĐÁNG NHỚ (highlights)
// ══════════════════════════════════════════════════════════════
function buildHighlights() {
    if (!sessions.length && !history.length) return '<div style="color:var(--muted);text-align:center;padding:16px;font-size:13px;">Chưa đủ dữ liệu để tìm khoảnh khắc đáng nhớ.</div>';

    const allSessions = [...sessions];
    if (history.length) {
        const names = history[history.length - 1].names;
        allSessions.unshift({ names, history, numP });
    }

    const counts = {}; // name -> {xam, tuquy, chay}
    let biggestSingle = { val: -Infinity, name: '' };
    let biggestComeback = { val: -Infinity, name: '' };

    allSessions.forEach(s => {
        const names = s.names.slice(0, s.numP);
        const cum = new Array(s.numP).fill(0);
        const minCum = new Array(s.numP).fill(0);
        s.history.forEach(v => {
            v.scores.forEach((sc, pi) => {
                if (pi >= s.numP) return;
                const name = names[pi];
                if (!counts[name]) counts[name] = { xam: 0, tuquy: 0, chay: 0 };
                (v.tags[pi] || []).forEach(t => {
                    const tag = typeof t === 'string' ? t : t.tag;
                    if (tag === 'X') counts[name].xam++;
                    if (tag === 'Q') counts[name].tuquy++;
                    if (tag === 'C') counts[name].chay++;
                });
                if (sc > biggestSingle.val) biggestSingle = { val: sc, name };
                cum[pi] += sc;
                if (cum[pi] < minCum[pi]) minCum[pi] = cum[pi];
            });
        });
        names.forEach((name, pi) => {
            const cb = cum[pi] - minCum[pi];
            if (cb > biggestComeback.val) biggestComeback = { val: cb, name };
        });
    });

    const byField = (f) => Object.entries(counts).sort((a, b) => b[1][f] - a[1][f])[0];
    const topXam = byField('xam');
    const topTuquy = byField('tuquy');
    const topChay = byField('chay');

    const items = [];
    if (topXam && topXam[1].xam > 0) items.push({ icon: '🎯', label: 'Sâm thủ', val: `${topXam[0]} — ${topXam[1].xam} lần báo sâm thắng` });
    if (topTuquy && topTuquy[1].tuquy > 0) items.push({ icon: '👑', label: 'Vua tứ quý', val: `${topTuquy[0]} — ${topTuquy[1].tuquy} lần tứ quý` });
    if (topChay && topChay[1].chay > 0) items.push({ icon: '🔥', label: 'Cháy nhất', val: `${topChay[0]} — ${topChay[1].chay} lần cháy bài` });
    if (biggestSingle.name && biggestSingle.val > 0) items.push({ icon: '💥', label: 'Cú nổ lớn nhất', val: `${biggestSingle.name} — +${biggestSingle.val}đ trong 1 ván` });
    if (biggestComeback.name && biggestComeback.val > 0) items.push({ icon: '📈', label: 'Lội ngược dòng ngoạn mục', val: `${biggestComeback.name} — hồi phục ${biggestComeback.val}đ` });

    if (!items.length) return '<div style="color:var(--muted);text-align:center;padding:16px;font-size:13px;">Chưa đủ dữ liệu để tìm khoảnh khắc đáng nhớ.</div>';

    return `<div class="highlight-grid">` + items.map(it => `
      <div class="highlight-card">
        <div class="highlight-icon">${it.icon}</div>
        <div>
          <div class="highlight-label">${it.label}</div>
          <div class="highlight-val">${it.val}</div>
        </div>
      </div>`).join('') + `</div>`;
}

function renderHighlights() {
    const wrap = document.getElementById('highlights-content');
    if (wrap) wrap.innerHTML = buildHighlights();
}

// ══════════════════════════════════════════════════════════════
// BẢNG DANH DỰ CÁ NHÂN
// ══════════════════════════════════════════════════════════════
function buildPersonalHonor() {
    if (!sessions.length && !history.length) return '<div style="color:var(--muted);text-align:center;padding:16px;font-size:13px;">Cần ít nhất 1 buổi đã lưu để xem bảng danh dự.</div>';

    // Aggregate across sessions + current
    const allSessions = [...sessions];
    if (history.length) {
        const names = history[history.length - 1].names;
        const tot = new Array(numP).fill(0);
        history.forEach(v => v.scores.forEach((s, i) => tot[i] += s));
        allSessions.unshift({ names, history: JSON.parse(JSON.stringify(history)), tot, numP, rules });
    }

    const players = {};
    allSessions.forEach(s => {
        s.names.slice(0, s.numP).forEach((name, pi) => {
            if (!players[name]) players[name] = { name, sessions: 0, wins: 0, xam: 0, chay: 0, bigWin: 0, bigLoss: 0, totalScore: 0 };
            const p = players[name];
            p.sessions++;
            p.totalScore += s.tot[pi];
            s.history.forEach(v => {
                const sc = v.scores[pi] || 0;
                const tags = v.tags[pi] || [];
                const maxSc = Math.max(...v.scores.slice(0, s.numP));
                if (sc === maxSc && sc > 0) p.wins++;
                if (sc > p.bigWin) p.bigWin = sc;
                if (sc < p.bigLoss) p.bigLoss = sc;
                tags.forEach(t => {
                    const tag = typeof t === 'string' ? t : t.tag;
                    if (tag === 'X') p.xam++;
                    if (tag === 'C') p.chay++;
                });
            });
        });
    });

    const pArr = Object.values(players).sort((a, b) => b.totalScore - a.totalScore);
    if (!pArr.length) return '<div style="color:var(--muted);text-align:center;padding:16px;font-size:13px;">Chưa có dữ liệu.</div>';

    let html = `<div class="honor-grid">`;
    pArr.forEach((p, rank) => {
        const rankIcon = rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `#${rank + 1}`;
        html += `<div class="honor-card">
      <div class="honor-rank">${rankIcon}</div>
      <div class="honor-name">${p.name}</div>
      <div class="honor-score ${p.totalScore >= 0 ? 'pos' : 'neg'}">${p.totalScore >= 0 ? '+' : ''}${p.totalScore}đ tổng</div>
      <div class="honor-stats">
        <span>🏆 ${p.wins} ván thắng</span>
        <span>🎯 ${p.xam} sâm</span>
        <span>⚡ ${p.chay} cháy</span>
        <span>💰 +${p.bigWin}đ lớn nhất</span>
        ${p.bigLoss < 0 ? `<span>💸 ${p.bigLoss}đ thua nhất</span>` : ''}
        <span>📅 ${p.sessions} buổi</span>
      </div>
    </div>`;
    });
    html += `</div>`;
    return html;
}

function renderHonorBoard() {
    const wrap = document.getElementById('honor-content');
    if (wrap) wrap.innerHTML = buildPersonalHonor();
}

// ══════════════════════════════════════════════════════════════
// CHIA SẺ KẾT QUẢ
// ══════════════════════════════════════════════════════════════
function shareResult() {
    if (!history.length) return;
    const names = history[history.length - 1].names;
    const tot = new Array(numP).fill(0);
    history.forEach(v => v.scores.forEach((s, i) => tot[i] += s));
    const order = [...Array(numP).keys()].sort((a, b) => tot[b] - tot[a]);

    const date = new Date().toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric', year: 'numeric' });
    let txt = `🃏 Sâm Lốc — ${date}\n`;
    txt += `📊 Kết quả sau ${history.length} ván:\n`;
    txt += `${'─'.repeat(26)}\n`;
    order.forEach((pi, rank) => {
        const t = tot[pi];
        const medal = rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `#${rank + 1}`;
        txt += `${medal} ${names[pi]}: ${t >= 0 ? '+' : ''}${t}đ\n`;
    });
    txt += `${'─'.repeat(26)}\n`;

    // Settlement
    const creditors = order.filter(i => tot[i] > 0).map(i => ({ i, bal: tot[i] }));
    const debtors = order.filter(i => tot[i] < 0).map(i => ({ i, bal: tot[i] }));
    const txns = [];
    const cred = creditors.map(c => ({ ...c }));
    const debt = debtors.map(d => ({ ...d }));
    let ci = 0, di = 0;
    while (ci < cred.length && di < debt.length) {
        const amount = Math.min(cred[ci].bal, -debt[di].bal);
        if (amount > 0.01) txns.push({ from: debt[di].i, to: cred[ci].i, amount });
        cred[ci].bal -= amount; debt[di].bal += amount;
        if (Math.abs(cred[ci].bal) < 0.01) ci++;
        if (Math.abs(debt[di].bal) < 0.01) di++;
    }
    if (txns.length) {
        txt += `💰 Thanh toán:\n`;
        txns.forEach(t => { txt += `  ${names[t.from]} → ${names[t.to]}: ${Number.isInteger(t.amount) ? t.amount : t.amount.toFixed(1).replace(/\.0$/, "")}đ\n`; });
    }

    if (getDiscordWebhook()) { sendToDiscord(txt); return; }
    if (navigator.share) {
        navigator.share({ text: txt }).catch(() => copyToClipboard(txt));
    } else {
        copyToClipboard(txt);
    }
}

// ══════════════════════════════════════════════════════════════
// GỬI KẾT QUẢ SANG DISCORD (Webhook)
// ══════════════════════════════════════════════════════════════
const LS_DISCORD_WEBHOOK = 'xamloc_discord_webhook';
const DEFAULT_DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1560645908855652434/6b24NFVcdH703xYwf_Si3qZXF-F2wtr1iXQEJ8719EDMJYpXY8E_vrAMavviKammAjHD';
const DISCORD_WEBHOOK_RE = /^https:\/\/(?:(?:canary|ptb)\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;

function getDiscordWebhook() {
    try {
        const saved = localStorage.getItem(LS_DISCORD_WEBHOOK);
        if (saved !== null) return saved;
        return DEFAULT_DISCORD_WEBHOOK;
    } catch (e) {
        return DEFAULT_DISCORD_WEBHOOK;
    }
}

function loadDiscordField() {
    const el = document.getElementById('discord-webhook-input');
    if (el) el.value = getDiscordWebhook();
}

function saveDiscordWebhook() {
    const el = document.getElementById('discord-webhook-input');
    const url = (el.value || '').trim();
    if (url && !DISCORD_WEBHOOK_RE.test(url)) {
        showAlert({ icon: '⚠️', title: 'Link không hợp lệ', msg: 'Link webhook phải có dạng https://discord.com/api/webhooks/…' });
        return;
    }
    try {
        localStorage.setItem(LS_DISCORD_WEBHOOK, url);
    } catch (e) { }
    showToast(url ? '✅ Đã lưu Discord webhook' : '🗑 Đã xóa Discord webhook', 2000);
}

async function postToDiscord(content, blob) {
    const url = getDiscordWebhook();
    const payload = { username: 'Sâm Lốc', allowed_mentions: { parse: [] } };
    if (content) payload.content = content;
    let res;
    if (blob) {
        const fd = new FormData();
        fd.append('payload_json', JSON.stringify(payload));
        fd.append('files[0]', blob, 'samloc-ketqua.png');
        res = await fetch(url, { method: 'POST', body: fd });
    } else {
        res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
}

// Chụp 2 thẻ "Bảng điểm tổng" + "Thanh toán cuối buổi" ghép thành 1 ảnh (bỏ nút bấm)
async function captureResultBlob() {
    if (typeof html2canvas === 'undefined') return null;
    const cards = ['scoreboard-card', 'settlement-card'].map(id => document.getElementById(id)).filter(Boolean);
    if (!cards.length) return null;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const bg = isDark ? '#0a1030' : '#f4f7ff';
    const scale = 2, gap = 16 * scale, pad = 16 * scale;
    const shots = [];
    for (const el of cards) {
        shots.push(await html2canvas(el, {
            backgroundColor: bg, scale,
            onclone: (doc) => {
                doc.querySelectorAll('.share-actions').forEach(n => n.remove());
                // tắt hoạt ảnh trong bản sao, nếu không các dòng bảng điểm bị chụp lúc còn trong suốt
                const st = doc.createElement('style');
                st.textContent = '*,*::before,*::after{animation:none !important;transition:none !important;opacity:1 !important;transform:none !important;backdrop-filter:none !important;-webkit-backdrop-filter:none !important;box-shadow:none !important}.sb-row.leader{border-left:4px solid #e0a030 !important}';
                doc.head.appendChild(st);
            }
        }));
    }
    const W = Math.max(...shots.map(c => c.width)) + pad * 2;
    const H = shots.reduce((s, c) => s + c.height, 0) + gap * (shots.length - 1) + pad * 2;
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const ctx = out.getContext('2d');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    let y = pad;
    for (const c of shots) { ctx.drawImage(c, pad, y); y += c.height + gap; }
    return await new Promise(r => out.toBlob(r, 'image/png'));
}

async function sendToDiscord(txt) {
    showToast('📨 Đang chụp & gửi lên Discord…', 3000);
    try {
        let blob = null;
        try { blob = await captureResultBlob(); } catch (err) { console.warn('[discord] chụp ảnh lỗi', err); }
        // Có ảnh → chỉ gửi ảnh; không chụp được → gửi chữ để không mất kết quả
        await postToDiscord(blob ? '' : '```\n' + txt + '```', blob);
        SFX.play('save');
        showToast(blob ? '✅ Đã gửi ảnh kết quả lên Discord!' : '✅ Đã gửi kết quả (dạng chữ) lên Discord!', 2500);
    } catch (err) {
        SFX.play('error');
        showAlert({ icon: '⚠️', title: 'Gửi Discord thất bại', msg: 'Kiểm tra lại link webhook hoặc kết nối mạng. Kết quả đã được copy để bạn dán thủ công.' });
        copyToClipboard(txt);
    }
}

async function testDiscordWebhook() {
    saveDiscordWebhook();
    if (!getDiscordWebhook()) return;
    try { await postToDiscord('✅ Sâm Lốc đã kết nối với kênh này!'); showToast('✅ Gửi thử thành công!', 2000); }
    catch (e) { showAlert({ icon: '⚠️', title: 'Gửi thử thất bại', msg: 'Webhook sai hoặc đã bị xóa. Tạo lại webhook trong Discord rồi dán lại.' }); }
}

function exportSettlementImage() {
    if (typeof html2canvas === 'undefined') {
        showAlert({ icon: '⚠️', title: 'Không thể xuất ảnh', msg: 'Thư viện xuất ảnh chưa tải được, kiểm tra kết nối mạng rồi thử lại.' });
        return;
    }
    SFX.play('click');
    captureResultBlob().then(blob => {
        if (!blob) throw new Error('no blob');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `samloc-ketqua-${new Date().toISOString().slice(0, 10)}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        showToast('📸 Đã lưu ảnh kết quả!', 2000);
        SFX.play('save');
    }).catch(() => {
        showAlert({ icon: '⚠️', title: 'Xuất ảnh thất bại', msg: 'Có lỗi khi tạo ảnh, thử lại sau nhé.' });
    });
}

function copyToClipboard(txt, customMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(() => {
            showToast(customMsg || '📋 Đã copy kết quả!', 2000);
        }).catch(() => {
            fallbackCopy(txt, customMsg);
        });
    } else {
        fallbackCopy(txt, customMsg);
    }
}

function fallbackCopy(txt, customMsg) {
    try {
        const ta = document.createElement('textarea');
        ta.value = txt;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast(customMsg || '📋 Đã copy!', 2000);
    } catch (_) {
        showModal({
            icon: '📋', title: 'Nội dung sao chép',
            msg: txt,
            buttons: [{ label: 'Đóng', cls: 'modal-btn-primary' }]
        });
    }
}

// ══════════════════════════════════════════════════════════════
// VIETQR THANH TOÁN TỰ ĐỘNG
// ══════════════════════════════════════════════════════════════
const VIETNAMESE_BANKS = [
    { code: 'MB', name: 'MBBank (Quân Đội)' },
    { code: 'VCB', name: 'Vietcombank' },
    { code: 'TCB', name: 'Techcombank' },
    { code: 'ICB', name: 'VietinBank' },
    { code: 'BIDV', name: 'BIDV' },
    { code: 'ACB', name: 'ACB' },
    { code: 'VPB', name: 'VPBank' },
    { code: 'TPB', name: 'TPBank' },
    { code: 'STB', name: 'Sacombank' },
    { code: 'HDB', name: 'HDBank' },
    { code: 'VIB', name: 'VIB' },
    { code: 'SHB', name: 'SHB' },
    { code: 'MSB', name: 'MSB' },
    { code: 'OCB', name: 'OCB' },
    { code: 'LPB', name: 'LPBank' },
    { code: 'SEAB', name: 'SeABank' },
    { code: 'ABB', name: 'ABBank' },
    { code: 'VAB', name: 'VietABank' },
    { code: 'NAB', name: 'Nam A Bank' },
    { code: 'BAB', name: 'Bac A Bank' },
    { code: 'BVB', name: 'BaoViet Bank' },
    { code: 'KLB', name: 'Kienlongbank' },
    { code: 'PVB', name: 'PVcomBank' },
    { code: 'CAKE', name: 'Cake by VPBank' },
    { code: 'TIMO', name: 'Timo' },
    { code: 'VIETTELMONEY', name: 'Viettel Money' }
];

function removeVietnameseTones(str) {
    if (!str) return '';
    return String(str)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getPlayerBank(name) {
    if (!name) return null;
    const key = name.trim();
    return playerBanks[key] || null;
}

function setPlayerBank(name, bankData) {
    if (!name) return;
    const key = name.trim();
    if (!bankData || !bankData.account) {
        delete playerBanks[key];
    } else {
        playerBanks[key] = {
            bank: bankData.bank || 'MB',
            account: String(bankData.account).trim(),
            accountName: (bankData.accountName || '').trim()
        };
    }
    save();
    renderPresetChips();
}

let currentVietQRState = {
    senderName: '',
    receiverName: '',
    rawAmount: 0,
    multiplier: 1,
    customAmount: null,
    editingBank: false
};

function openVietQRModal(senderName, receiverName, rawAmount) {
    SFX.play('click');
    const nAmt = Number(rawAmount) || 0;
    currentVietQRState = {
        senderName: senderName || 'Nguoi choi',
        receiverName: receiverName || 'Nguoi nhan',
        rawAmount: nAmt,
        multiplier: (nAmt > 0 && nAmt < 1000) ? 1000 : 1,
        customAmount: null,
        editingBank: false
    };

    renderVietQRModalContent();

    const ov = document.getElementById('vietqr-modal-overlay');
    if (ov) {
        ov.style.display = 'flex';
        requestAnimationFrame(() => ov.classList.add('show'));
    }
}

function closeVietQRModal() {
    const ov = document.getElementById('vietqr-modal-overlay');
    if (!ov) return;
    ov.classList.remove('show');
    setTimeout(() => { ov.style.display = 'none'; }, 200);
}

function vietQRClickOutside(e) {
    if (e.target.id === 'vietqr-modal-overlay') {
        closeVietQRModal();
    }
}

function setVietQRMultiplier(mult) {
    SFX.play('click');
    currentVietQRState.multiplier = mult;
    currentVietQRState.customAmount = null;
    renderVietQRModalContent();
}

function openBankSettingsModal(playerName, e) {
    if (e) e.stopPropagation();
    SFX.play('click');
    currentVietQRState = {
        senderName: '',
        receiverName: playerName || '',
        rawAmount: 0,
        multiplier: 1,
        customAmount: null,
        editingBank: true
    };
    renderVietQRModalContent();
    const ov = document.getElementById('vietqr-modal-overlay');
    if (ov) {
        ov.style.display = 'flex';
        requestAnimationFrame(() => ov.classList.add('show'));
    }
}

function renderVietQRModalContent() {
    const wrap = document.getElementById('vietqr-modal-content');
    if (!wrap) return;

    const { senderName, receiverName, rawAmount, multiplier, customAmount, editingBank } = currentVietQRState;
    const bank = getPlayerBank(receiverName);

    // If no bank setup yet OR user clicked to edit bank
    if (!bank || !bank.account || editingBank) {
        const bankOptions = VIETNAMESE_BANKS.map(b =>
            `<option value="${b.code}" ${bank && bank.bank === b.code ? 'selected' : ''}>${b.name} (${b.code})</option>`
        ).join('');

        wrap.innerHTML = `
        <div style="font-size:18px;font-weight:800;font-family:var(--font-display);font-style:italic;margin-bottom:6px;">
            🏦 Cài đặt STK: <span style="color:var(--accent);">${escapeHtml(receiverName)}</span>
        </div>
        <p style="font-size:13px;color:var(--muted);margin-bottom:14px;line-height:1.5;">
            Cài đặt một lần — sau này mỗi khi thanh toán, hệ thống tự động tạo mã <b>VietQR</b> đúng số tiền để quét trả.
        </p>
        <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:18px;">
            <div>
                <label style="display:block;font-size:12px;font-weight:700;color:var(--muted);margin-bottom:4px;">Ngân hàng</label>
                <select id="vqr-bank-input" class="vqr-input">${bankOptions}</select>
            </div>
            <div>
                <label style="display:block;font-size:12px;font-weight:700;color:var(--muted);margin-bottom:4px;">Số tài khoản</label>
                <input type="text" id="vqr-acc-input" class="vqr-input" placeholder="Ví dụ: 0987654321..." value="${bank ? escapeHtml(bank.account) : ''}">
            </div>
            <div>
                <label style="display:block;font-size:12px;font-weight:700;color:var(--muted);margin-bottom:4px;">Tên chủ tài khoản (không dấu)</label>
                <input type="text" id="vqr-name-input" class="vqr-input" placeholder="Ví dụ: NGUYEN VAN A" value="${bank && bank.accountName ? escapeHtml(bank.accountName) : ''}">
            </div>
        </div>
        <div style="display:flex;gap:8px;">
            <button class="modal-btn modal-btn-primary" onclick="savePlayerBankForm('${receiverName.replace(/'/g, "\\'")}')">
                💾 Lưu & ${rawAmount > 0 ? 'Tạo mã QR' : 'Hoàn tất'}
            </button>
            ${bank && bank.account ? `<button class="modal-btn modal-btn-cancel" onclick="currentVietQRState.editingBank=false; renderVietQRModalContent();">Quay lại</button>` : `<button class="modal-btn modal-btn-cancel" onclick="closeVietQRModal()">Đóng</button>`}
        </div>
        `;
        return;
    }

    // Has bank info -> Show QR Code
    const effectiveAmount = customAmount !== null ? customAmount : Math.round(rawAmount * multiplier);
    const bankObj = VIETNAMESE_BANKS.find(b => b.code === bank.bank);
    const bankDisplay = bankObj ? bankObj.name : bank.bank;
    const memo = `Tien Sam Loc ${removeVietnameseTones(senderName)}`;
    const accName = removeVietnameseTones(bank.accountName || receiverName).toUpperCase();

    const qrUrl = `https://img.vietqr.io/image/${bank.bank}-${bank.account}-compact2.png?amount=${effectiveAmount}&addInfo=${encodeURIComponent(memo)}&accountName=${encodeURIComponent(accName)}`;

    wrap.innerHTML = `
    <div style="font-size:18px;font-weight:800;font-family:var(--font-display);font-style:italic;margin-bottom:2px;">
        📲 Mã VietQR Thanh Toán
    </div>
    <div style="font-size:12.5px;color:var(--muted);margin-bottom:12px;">
        <span style="color:var(--red);font-weight:700;">${escapeHtml(senderName)}</span> trả cho <span style="color:var(--green);font-weight:700;">${escapeHtml(receiverName)}</span>
    </div>

    <!-- Quy đổi điểm / tiền -->
    <div class="vqr-multipliers">
        <span style="font-size:11.5px;color:var(--muted);font-weight:700;">Quy đổi:</span>
        <button class="vqr-mul-btn ${multiplier === 1 ? 'active' : ''}" onclick="setVietQRMultiplier(1)">x1 (${Number(rawAmount).toLocaleString('vi-VN')}đ)</button>
        <button class="vqr-mul-btn ${multiplier === 1000 ? 'active' : ''}" onclick="setVietQRMultiplier(1000)">x1.000 (${Number(rawAmount * 1000).toLocaleString('vi-VN')}đ)</button>
        <button class="vqr-mul-btn ${multiplier === 5000 ? 'active' : ''}" onclick="setVietQRMultiplier(5000)">x5.000</button>
        <button class="vqr-mul-btn ${multiplier === 10000 ? 'active' : ''}" onclick="setVietQRMultiplier(10000)">x10.000</button>
    </div>

    <!-- Khung QR code -->
    <div class="vietqr-box">
        <img src="${qrUrl}" alt="VietQR" class="vietqr-img" id="vietqr-code-img">
        <div class="vietqr-scan-hint">📷 Mở app ngân hàng hoặc MoMo / ZaloPay quét mã để chuyển</div>
    </div>

    <!-- Thông tin chi tiết kèm nút copy -->
    <div class="vietqr-info-card">
        <div class="vietqr-info-row">
            <span class="vietqr-info-label">🏦 Ngân hàng:</span>
            <span class="vietqr-info-val">${bankDisplay}</span>
        </div>
        <div class="vietqr-info-row">
            <span class="vietqr-info-label">💳 Số tài khoản:</span>
            <span class="vietqr-info-val">
                <span>${bank.account}</span>
                <button class="vietqr-copy-btn" onclick="copyToClipboard('${bank.account}', '📋 Đã sao chép STK!')">Sao chép</button>
            </span>
        </div>
        <div class="vietqr-info-row">
            <span class="vietqr-info-label">👤 Chủ tài khoản:</span>
            <span class="vietqr-info-val">${escapeHtml(accName)}</span>
        </div>
        <div class="vietqr-info-row">
            <span class="vietqr-info-label">💵 Số tiền:</span>
            <span class="vietqr-info-val">
                <span style="color:var(--green);font-size:15px;font-weight:800;">${Number(effectiveAmount).toLocaleString('vi-VN')} đ</span>
                <button class="vietqr-copy-btn" onclick="copyToClipboard('${effectiveAmount}', '📋 Đã sao chép số tiền!')">Sao chép</button>
            </span>
        </div>
        <div class="vietqr-info-row">
            <span class="vietqr-info-label">📝 Nội dung CK:</span>
            <span class="vietqr-info-val">
                <span>${escapeHtml(memo)}</span>
                <button class="vietqr-copy-btn" onclick="copyToClipboard('${memo}', '📋 Đã sao chép nội dung CK!')">Sao chép</button>
            </span>
        </div>
    </div>

    <!-- Nút hành động -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="sec-btn" onclick="currentVietQRState.editingBank=true; renderVietQRModalContent();" style="font-size:12px;">✏️ Sửa STK</button>
        <button class="sec-btn success" onclick="downloadVietQRImage()" style="font-size:12px;">📥 Tải ảnh QR</button>
        <button class="sec-btn" onclick="closeVietQRModal()" style="font-size:12px;margin-left:auto;">Đóng</button>
    </div>
    `;
}

function savePlayerBankForm(receiverName) {
    const bankSel = document.getElementById('vqr-bank-input');
    const accInp = document.getElementById('vqr-acc-input');
    const nameInp = document.getElementById('vqr-name-input');

    const bankCode = bankSel ? bankSel.value : 'MB';
    const accNum = accInp ? accInp.value.trim() : '';
    const accName = nameInp ? nameInp.value.trim().toUpperCase() : '';

    if (!accNum) {
        showToast('⚠️ Vui lòng nhập số tài khoản!', 2000);
        return;
    }

    setPlayerBank(receiverName, {
        bank: bankCode,
        account: accNum,
        accountName: accName
    });

    SFX.play('save');
    showToast(`✅ Đã lưu STK cho ${receiverName}!`, 1800);
    currentVietQRState.editingBank = false;
    renderVietQRModalContent();
}

function downloadVietQRImage() {
    const img = document.getElementById('vietqr-code-img');
    if (!img || !img.src) return;
    const a = document.createElement('a');
    a.href = img.src;
    a.download = `vietqr-${removeVietnameseTones(currentVietQRState.receiverName || 'samloc')}.png`;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast('📥 Đang tải ảnh mã QR...', 1500);
}

// ══════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════════════════════
const LS_HINT_DISMISSED = 'xamloc_hint_dismissed';
const LS_BIGUPDATE_DISMISSED = 'xamloc_bigupdate_dismissed';

function dismissBigUpdateBadge() {
    const el = document.getElementById('big-update-badge');
    if (!el) return;
    el.style.animation = 'none';
    el.style.opacity = '0';
    el.style.transform = 'scale(.5)';
    el.style.transition = 'opacity .2s, transform .2s';
    setTimeout(() => { el.style.display = 'none'; }, 200);
    try { localStorage.setItem(LS_BIGUPDATE_DISMISSED, '1'); } catch (e) { }
}

function dismissShortcutHint() {
    const el = document.getElementById('shortcut-hint');
    if (!el) return;
    el.style.animation = 'none';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-6px)';
    el.style.transition = 'opacity .25s, transform .25s';
    setTimeout(() => { el.style.display = 'none'; }, 250);
    try { localStorage.setItem(LS_HINT_DISMISSED, '1'); } catch (e) { }
}

function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        const tag = (e.target.tagName || '').toLowerCase();
        const isTyping = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;

        // Esc luôn đóng modal, kể cả khi đang gõ
        if (e.key === 'Escape') {
            const ov = document.getElementById('modal-overlay');
            if (ov && ov.style.display === 'flex') closeModal();
            const qrov = document.getElementById('vietqr-modal-overlay');
            if (qrov && qrov.style.display === 'flex') closeVietQRModal();
            const liveov = document.getElementById('live-host-modal-overlay');
            if (liveov && liveov.style.display === 'flex') closeLiveModal();
            return;
        }

        if (isTyping) return; // đừng chặn gõ tên người chơi, ghi chú...

        const gamePage = document.getElementById('page-game');
        if (!gamePage || !gamePage.classList.contains('show')) return;
        const inputCard = document.getElementById('van-input-card');
        if (!inputCard || inputCard.style.display === 'none') return;

        // Enter = thêm ván (chỉ khi không có modal đang mở)
        if (e.key === 'Enter') {
            const ov = document.getElementById('modal-overlay');
            if (ov && ov.style.display === 'flex') return;
            const btn = document.getElementById('add-van-btn');
            if (btn && !btn.disabled) { e.preventDefault(); handleAddVan(e); }
            return;
        }

        // Số 1-9 = chọn người thắng (chỉ áp dụng khi đang ở mode thường, cần chọn thắng)
        if (/^[1-9]$/.test(e.key)) {
            const modeNormal = document.getElementById('mode-normal');
            const winBtn = document.querySelector(`.pick-win-btn`);
            if (modeNormal && modeNormal.style.display !== 'none' && winBtn) {
                const idx = parseInt(e.key, 10) - 1;
                if (idx < numP) { e.preventDefault(); pickWin(idx); SFX.play('pick'); }
            }
        }
    });
}

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════
(function init() {
    // Init sound engine
    if (typeof SFX !== 'undefined') SFX.init();

    // Ẩn gợi ý phím tắt nếu người dùng đã từng tắt trước đó
    try {
        if (localStorage.getItem(LS_HINT_DISMISSED) === '1') {
            const hintEl = document.getElementById('shortcut-hint');
            if (hintEl) hintEl.style.display = 'none';
        }
        if (localStorage.getItem(LS_BIGUPDATE_DISMISSED) === '1') {
            const badgeEl = document.getElementById('big-update-badge');
            if (badgeEl) badgeEl.style.display = 'none';
        }
    } catch (e) { }

    // Apply saved theme (mặc định: light)
    const savedTheme = localStorage.getItem(LS_THEME);
    if (savedTheme) applyTheme(savedTheme);
    else applyTheme('light');

    load();
    updateRuleSummary();
    setActivePBtn();
    renderNames();
    renderGrid();
    renderXamPickers();

    // Khởi tạo chế độ nhập (thủ công / extension)
    const savedInputMode = localStorage.getItem(LS_INPUT_SRC) || 'manual';
    setInputMode(savedInputMode);
    if (history.length) {
        renderBoard();
        document.getElementById('board-wrap').style.display = 'block';
        document.getElementById('van-num').textContent = `Nhập ván ${history.length + 1}`;
    }
    // New features init
    renderSessionsList();
    renderPresetChips();
    renderHonorBoard();
    renderHighlights();
    loadDiscordField();

    // Parallax nhẹ cho hình nền splash (chuột trên desktop, con quay trên mobile)
    initSplashParallax();
    initKeyboardShortcuts();

    // Cảnh báo trước khi rời trang nếu đang nhập dở ván (chưa bấm "Thêm ván này")
    window.addEventListener('beforeunload', (e) => {
        const grid = document.getElementById('van-grid');
        if (!grid) return;
        const hasUnsavedInput = Array.from(grid.querySelectorAll('input[type="number"]'))
            .some(inp => inp.value !== '' && inp.value !== null);
        if (hasUnsavedInput) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
})();

function initSplashParallax() {
    const splash = document.getElementById('intro-splash');
    const suits = document.querySelector('.intro-bg-suits');
    if (!splash || !suits) return;
    let raf = null;
    function setPos(px, py) {
        if (raf) return;
        raf = requestAnimationFrame(() => {
            suits.style.setProperty('--mx', px.toFixed(1));
            suits.style.setProperty('--my', py.toFixed(1));
            raf = null;
        });
    }
    splash.addEventListener('mousemove', (e) => {
        const w = window.innerWidth, h = window.innerHeight;
        const px = ((e.clientX / w) - 0.5) * 18;
        const py = ((e.clientY / h) - 0.5) * 18;
        setPos(px, py);
    });
    if (window.DeviceOrientationEvent) {
        window.addEventListener('deviceorientation', (e) => {
            if (e.gamma == null || e.beta == null) return;
            const px = Math.max(-18, Math.min(18, e.gamma / 2));
            const py = Math.max(-18, Math.min(18, (e.beta - 45) / 4));
            setPos(px, py);
        });
    }
}