/* ══════════════════════════════════════════════════════════════
   live.js — Sâm Lốc · Phòng xem trực tiếp Realtime (WebRTC P2P)
   Cho phép chủ phòng phát trực tiếp, người xem quét QR hoặc
   mở link để theo dõi điểm số nhảy số tức thì mà không cần F5.
══════════════════════════════════════════════════════════════ */

let isLiveHost = false;
let isSpectator = false;
let livePeer = null;
let liveRoomCode = null;
let liveConnections = [];
let spectatorPeer = null;
let spectatorConn = null;
let spectatorHostName = '';

const LIVE_PREFIX = 'samloc4u-';

// ── 1. HELPER: LẤY TOÀN BỘ TRẠNG THÁI HIỆN TẠI ĐỂ PHÁT ────────
function getLiveBroadcastState() {
    return {
        numP: typeof numP !== 'undefined' ? numP : 4,
        pnames: typeof pnames !== 'undefined' ? [...pnames] : [],
        rules: typeof rules !== 'undefined' ? { ...rules } : {},
        history: typeof history !== 'undefined' ? JSON.parse(JSON.stringify(history)) : [],
        vanNotes: typeof vanNotes !== 'undefined' ? { ...vanNotes } : {},
        timerSeconds: typeof timerSeconds !== 'undefined' ? timerSeconds : 0,
        hostName: (typeof pnames !== 'undefined' && pnames[0]) ? pnames[0] : 'Chủ phòng',
        ts: Date.now()
    };
}

// ── 2. PHÁT TRỰC TIẾP (HOST) ──────────────────────────────────
function startLiveBroadcast() {
    if (isLiveHost) {
        openLiveManagerModal();
        return;
    }

    if (typeof Peer === 'undefined') {
        showAlert({
            icon: '⚠️',
            title: 'Chưa tải xong thư viện',
            msg: 'Đang tải thư viện kết nối mạng, vui lòng kiểm tra kết nối internet và thử lại sau vài giây.'
        });
        return;
    }

    // Tạo mã phòng 4 số ngẫu nhiên
    liveRoomCode = String(Math.floor(1000 + Math.random() * 9000));
    const peerId = LIVE_PREFIX + liveRoomCode;

    showToast('📡 Đang khởi tạo phòng trực tiếp...', 2500);

    try {
        livePeer = new Peer(peerId, {
            debug: 1,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' }
                ]
            }
        });
    } catch (e) {
        showAlert({ icon: '⚠️', title: 'Lỗi khởi tạo', msg: 'Không thể mở phòng P2P: ' + e.message });
        return;
    }

    livePeer.on('open', (id) => {
        isLiveHost = true;
        liveConnections = [];
        updateLiveHeaderBtn();
        SFX.play('save');
        showToast(`🟢 Đã mở phòng SAM-${liveRoomCode}!`, 2500);
        openLiveManagerModal();
    });

    livePeer.on('connection', (conn) => {
        conn.on('open', () => {
            // Thêm người xem vào danh sách
            liveConnections.push(conn);
            updateLiveHeaderBtn();
            updateLiveModalViewers();

            // Gửi toàn bộ dữ liệu hiện tại ngay lập tức
            conn.send({
                type: 'INIT',
                state: getLiveBroadcastState()
            });

            SFX.play('click');
            showToast('👤 Có 1 người vừa kết nối vào phòng xem!', 2000);
        });

        conn.on('close', () => {
            liveConnections = liveConnections.filter(c => c !== conn);
            updateLiveHeaderBtn();
            updateLiveModalViewers();
        });

        conn.on('error', (err) => {
            console.warn('[live-host] conn error:', err);
            liveConnections = liveConnections.filter(c => c !== conn);
            updateLiveHeaderBtn();
            updateLiveModalViewers();
        });
    });

    livePeer.on('error', (err) => {
        console.error('[live-host] peer error:', err);
        if (err.type === 'unavailable-id') {
            // Trùng ID, thử lại mã khác
            stopLiveBroadcast(true);
            setTimeout(startLiveBroadcast, 500);
        } else {
            showAlert({
                icon: '⚠️',
                title: 'Lỗi phát trực tiếp',
                msg: 'Không thể kết nối đến máy chủ chia sẻ: ' + (err.message || err.type)
            });
            stopLiveBroadcast(true);
        }
    });
}

function broadcastLiveUpdate() {
    if (!isLiveHost || !livePeer || !liveConnections.length) return;
    const payload = {
        type: 'UPDATE',
        state: getLiveBroadcastState()
    };
    liveConnections.forEach(c => {
        try {
            if (c.open) c.send(payload);
        } catch (e) {
            console.warn('send error', e);
        }
    });
}
window.broadcastLiveUpdate = broadcastLiveUpdate;

function stopLiveBroadcast(silent = false) {
    if (liveConnections.length) {
        liveConnections.forEach(c => {
            try {
                c.send({ type: 'HOST_CLOSED' });
                c.close();
            } catch (_) { }
        });
    }
    liveConnections = [];
    if (livePeer) {
        try { livePeer.destroy(); } catch (_) { }
        livePeer = null;
    }
    isLiveHost = false;
    liveRoomCode = null;
    updateLiveHeaderBtn();
    closeLiveModal();

    if (!silent) {
        showToast('🔴 Đã dừng phát trực tiếp.', 2000);
    }
}

// ── 3. NGƯỜI XEM (SPECTATOR) ──────────────────────────────────
function checkLiveFromUrl() {
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    const m = hash.match(/live=(\d{4})/i) || search.match(/live=(\d{4})/i) || hash.match(/room=(\d{4})/i);
    if (m && m[1]) {
        joinLiveRoom(m[1]);
    }
}

function joinLiveRoom(code) {
    code = String(code).trim();
    if (!/^\d{4}$/.test(code)) {
        showAlert({ icon: '⚠️', title: 'Mã phòng không đúng', msg: 'Mã phòng phải gồm 4 chữ số (VD: 2849).' });
        return;
    }

    if (isLiveHost) {
        showAlert({ icon: '⚠️', title: 'Đang là chủ phòng', msg: 'Bạn đang phát trực tiếp. Dừng phát trước khi vào xem phòng khác.' });
        return;
    }

    if (typeof Peer === 'undefined') {
        showAlert({ icon: '⚠️', title: 'Đang tải thư viện', msg: 'Vui lòng đợi vài giây để thư viện kết nối tải xong rồi thử lại.' });
        return;
    }

    isSpectator = true;
    liveRoomCode = code;
    showToast(`📡 Đang kết nối tới phòng SAM-${code}...`, 3000);

    // Kích hoạt giao diện chế độ người xem
    setupSpectatorUI(code, 'Đang kết nối...');

    try {
        if (spectatorPeer) {
            try { spectatorPeer.destroy(); } catch (_) { }
        }

        spectatorPeer = new Peer({
            debug: 1,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' }
                ]
            }
        });
    } catch (e) {
        updateSpectatorStatus('❌ Lỗi khởi tạo: ' + e.message);
        return;
    }

    spectatorPeer.on('open', () => {
        const targetPeerId = LIVE_PREFIX + code;
        spectatorConn = spectatorPeer.connect(targetPeerId, { reliable: true });

        spectatorConn.on('open', () => {
            updateSpectatorStatus('🟢 Đã kết nối với chủ phòng');
            SFX.play('save');
            showToast(`🟢 Đã vào phòng xem SAM-${code}!`, 2000);
            closeLiveModal();
        });

        spectatorConn.on('data', (data) => {
            if (!data) return;
            if (data.type === 'INIT' || data.type === 'UPDATE') {
                applyLiveState(data.state, data.type === 'UPDATE');
            } else if (data.type === 'HOST_CLOSED') {
                updateSpectatorStatus('🔴 Chủ phòng đã dừng phát');
                showAlert({
                    icon: '📡',
                    title: 'Phòng đã kết thúc',
                    msg: 'Chủ phòng đã tắt chế độ phát trực tiếp.'
                });
            }
        });

        spectatorConn.on('close', () => {
            updateSpectatorStatus('⚠️ Mất kết nối tới chủ phòng');
        });

        spectatorConn.on('error', (err) => {
            console.warn('[spectator] conn error:', err);
            updateSpectatorStatus('❌ Lỗi kết nối');
        });
    });

    spectatorPeer.on('error', (err) => {
        console.error('[spectator] peer error:', err);
        updateSpectatorStatus('❌ Không tìm thấy phòng');
        showAlert({
            icon: '⚠️',
            title: 'Không tìm thấy phòng',
            msg: `Không kết nối được tới phòng SAM-${code}.\nCó thể chủ phòng đã tắt hoặc nhập sai mã phòng.`
        });
    });
}

function applyLiveState(state, isUpdate = false) {
    if (!state) return;
    spectatorHostName = state.hostName || 'Chủ phòng';
    updateSpectatorStatus(`🟢 Đang xem (${spectatorHostName})`);

    // Gán dữ liệu vào biến toàn cục của app.js trong bộ nhớ (KHÔNG gọi save() để không đè dữ liệu riêng của người xem)
    numP = state.numP || 4;
    pnames = state.pnames || pnames;
    if (state.rules) rules = state.rules;
    history = state.history || [];
    vanNotes = state.vanNotes || {};

    // Ẩn khối nhập ván, hiển thị bảng điểm
    const inputCard = document.getElementById('van-input-card');
    if (inputCard) inputCard.style.display = 'none';
    const boardWrap = document.getElementById('board-wrap');
    if (boardWrap) boardWrap.style.display = history.length ? 'block' : 'none';

    renderBoard();
    if (typeof updateRuleSummary === 'function') updateRuleSummary();
    if (typeof setActivePBtn === 'function') setActivePBtn();

    if (isUpdate) {
        SFX.play('save');
        showToast('🃏 Điểm số vừa được cập nhật!', 1600);
    }
}

function setupSpectatorUI(code, statusText) {
    // Ẩn thanh nhập tay và phím điều khiển
    const inputCard = document.getElementById('van-input-card');
    if (inputCard) inputCard.style.display = 'none';
    const modeSwitch = document.getElementById('input-mode-switcher');
    if (modeSwitch) modeSwitch.style.display = 'none';
    const presetsBtn = document.getElementById('presets-toggle-btn');
    if (presetsBtn) presetsBtn.style.display = 'none';
    const presetsPanel = document.getElementById('presets-panel');
    if (presetsPanel) presetsPanel.style.display = 'none';
    const timerBar = document.getElementById('timer-bar');
    if (timerBar) timerBar.style.display = 'none';

    // Tạo banner trạng thái người xem trên đầu trang
    let banner = document.getElementById('spectator-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'spectator-banner';
        banner.className = 'spectator-banner';
        const gamePage = document.getElementById('page-game');
        if (gamePage) gamePage.insertBefore(banner, gamePage.firstChild);
    }

    banner.innerHTML = `
        <span class="live-dot-pulse"></span>
        <span><b>Phòng xem SAM-${code}</b></span>
        <span id="spectator-status-text" style="margin-left:auto;font-size:12px;font-weight:600;opacity:.9;">${escapeHtml(statusText)}</span>
        <button class="spectator-exit-btn" onclick="exitSpectatorMode()" title="Thoát chế độ xem">✕ Thoát</button>
    `;
    banner.style.display = 'flex';
}

function updateSpectatorStatus(text) {
    const el = document.getElementById('spectator-status-text');
    if (el) el.textContent = text;
}

function exitSpectatorMode() {
    if (spectatorConn) {
        try { spectatorConn.close(); } catch (_) { }
        spectatorConn = null;
    }
    if (spectatorPeer) {
        try { spectatorPeer.destroy(); } catch (_) { }
        spectatorPeer = null;
    }

    isSpectator = false;
    liveRoomCode = null;

    // Xóa banner
    const banner = document.getElementById('spectator-banner');
    if (banner) banner.remove();

    // Hiện lại các công cụ nhập liệu
    const inputCard = document.getElementById('van-input-card');
    if (inputCard) inputCard.style.display = '';
    const modeSwitch = document.getElementById('input-mode-switcher');
    if (modeSwitch) modeSwitch.style.display = '';
    const presetsBtn = document.getElementById('presets-toggle-btn');
    if (presetsBtn) presetsBtn.style.display = '';
    const timerBar = document.getElementById('timer-bar');
    if (timerBar) timerBar.style.display = '';

    // Xóa hash trên URL mà không reload
    if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    // Tải lại dữ liệu riêng của người dùng từ localStorage
    load();
    updateRuleSummary();
    setActivePBtn();
    renderNames();
    renderGrid();
    renderXamPickers();
    if (history.length) {
        renderBoard();
        document.getElementById('board-wrap').style.display = 'block';
    } else {
        document.getElementById('board-wrap').style.display = 'none';
    }

    showToast('👋 Đã thoát chế độ xem trực tiếp', 1800);
}

// ── 4. GIAO DIỆN MODAL QUẢN LÝ PHÒNG TRỰC TIẾP ───────────────
function openLiveManagerModal() {
    SFX.play('click');
    const wrap = document.getElementById('live-host-modal-content');
    if (!wrap) return;

    if (isLiveHost) {
        // Đang là chủ phòng: Hiện mã QR, link chia sẻ, số người xem
        const liveUrl = getLiveShareUrl(liveRoomCode);
        wrap.innerHTML = `
            <div style="font-size:19px;font-weight:800;font-family:var(--font-display);font-style:italic;margin-bottom:4px;display:flex;align-items:center;gap:8px;">
                <span class="live-dot-pulse"></span> Đang phát trực tiếp
            </div>
            <div style="font-size:12.5px;color:var(--muted);margin-bottom:14px;">
                Mỗi khi bạn thêm hoặc sửa ván, điểm số trên máy người xem sẽ tự nhảy số ngay lập tức.
            </div>

            <div style="text-align:center;padding:12px;background:var(--surface2);border:1px solid var(--border2);border-radius:14px;margin-bottom:12px;">
                <div style="font-size:12px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;">Mã phòng xem</div>
                <div style="font-size:28px;font-weight:800;font-family:var(--font-display);color:var(--accent);letter-spacing:2px;margin:2px 0;">
                    SAM-${liveRoomCode}
                </div>
                <div id="live-modal-viewers-count" style="font-size:13px;font-weight:700;color:var(--green);">
                    👥 ${liveConnections.length} người đang xem
                </div>
            </div>

            <!-- Khung QR Code -->
            <div class="vietqr-box" style="margin-bottom:12px;">
                <div id="live-qr-canvas" style="display:flex;justify-content:center;padding:4px;"></div>
                <div class="vietqr-scan-hint" style="color:#444;font-size:12px;">📷 Quét mã QR bằng Camera điện thoại hoặc Zalo để vào xem</div>
            </div>

            <div style="display:flex;flex-direction:column;gap:8px;">
                <button class="modal-btn modal-btn-primary" onclick="copyLiveShareLink()">
                    📋 Sao chép Link phòng gửi bạn bè
                </button>
                <div style="display:flex;gap:8px;">
                    <button class="modal-btn modal-btn-cancel" onclick="closeLiveModal()">
                        Đóng cửa sổ (Vẫn phát ngầm)
                    </button>
                    <button class="modal-btn modal-btn-danger" onclick="stopLiveBroadcast()">
                        🔴 Dừng phát
                    </button>
                </div>
            </div>
        `;

        // Render QR Code sau khi DOM mở
        setTimeout(() => renderLiveQRCode(liveUrl), 50);

    } else if (isSpectator) {
        // Đang là người xem
        wrap.innerHTML = `
            <div style="font-size:18px;font-weight:800;font-family:var(--font-display);font-style:italic;margin-bottom:6px;">
                👀 Đang xem phòng SAM-${liveRoomCode}
            </div>
            <p style="font-size:13px;color:var(--muted);margin-bottom:14px;">
                Bạn đang theo dõi trực tiếp điểm số từ máy của <b>${escapeHtml(spectatorHostName || 'chủ phòng')}</b>.
            </p>
            <div style="display:flex;gap:8px;">
                <button class="modal-btn modal-btn-danger" onclick="exitSpectatorMode(); closeLiveModal();">
                    ✕ Thoát phòng xem
                </button>
                <button class="modal-btn modal-btn-cancel" onclick="closeLiveModal()">
                    Đóng
                </button>
            </div>
        `;

    } else {
        // Chưa phát & chưa xem: Cho chọn mở phòng hoặc vào xem
        wrap.innerHTML = `
            <div style="font-size:19px;font-weight:800;font-family:var(--font-display);font-style:italic;margin-bottom:4px;">
                📡 Phòng xem trực tiếp (Live Sync)
            </div>
            <p style="font-size:13px;color:var(--muted);margin-bottom:16px;line-height:1.5;">
                Cho phép cả 4 người cùng xem bảng điểm nhảy số trực tiếp trên điện thoại của mình mà không cần hỏi người ghi điểm.
            </p>

            <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:16px;">
                <button class="modal-btn modal-btn-primary" onclick="startLiveBroadcast()" style="padding:14px;font-size:14.5px;">
                    📡 Mở phòng phát (Nếu bạn ghi điểm)
                </button>

                <div style="display:flex;align-items:center;gap:8px;margin:4px 0;">
                    <hr style="flex:1;border:none;border-top:1px solid var(--border2);">
                    <span style="font-size:12px;color:var(--muted);font-weight:700;">HOẶC VÀO XEM</span>
                    <hr style="flex:1;border:none;border-top:1px solid var(--border2);">
                </div>

                <div style="display:flex;gap:6px;">
                    <input type="number" id="input-join-code" class="vqr-input" placeholder="Nhập mã phòng 4 số (VD: 2849)..."
                        style="text-align:center;font-size:15px;font-weight:700;letter-spacing:1px;"
                        onkeydown="if(event.key==='Enter'){handleJoinRoomInput();}">
                    <button class="modal-btn modal-btn-primary" onclick="handleJoinRoomInput()" style="flex:none;padding:10px 18px;">
                        Vào xem
                    </button>
                </div>
            </div>

            <button class="modal-btn modal-btn-cancel" onclick="closeLiveModal()" style="width:100%;">
                Đóng
            </button>
        `;
    }

    const ov = document.getElementById('live-host-modal-overlay');
    if (ov) {
        ov.style.display = 'flex';
        requestAnimationFrame(() => ov.classList.add('show'));
    }
}

function handleJoinRoomInput() {
    const inp = document.getElementById('input-join-code');
    if (!inp) return;
    const code = inp.value.trim();
    if (!code) {
        showToast('⚠️ Vui lòng nhập mã phòng!', 1800);
        return;
    }
    joinLiveRoom(code);
}

function closeLiveModal() {
    const ov = document.getElementById('live-host-modal-overlay');
    if (!ov) return;
    ov.classList.remove('show');
    setTimeout(() => { ov.style.display = 'none'; }, 200);
}

function liveHostClickOutside(e) {
    if (e.target.id === 'live-host-modal-overlay') {
        closeLiveModal();
    }
}

function getLiveShareUrl(code) {
    const base = window.location.origin + window.location.pathname;
    return `${base}#live=${code}`;
}

function copyLiveShareLink() {
    if (!liveRoomCode) return;
    const url = getLiveShareUrl(liveRoomCode);
    copyToClipboard(url, '📋 Đã copy link phòng xem trực tiếp!');
}

function renderLiveQRCode(text) {
    const container = document.getElementById('live-qr-canvas');
    if (!container) return;
    container.innerHTML = '';

    if (typeof QRCode !== 'undefined') {
        try {
            new QRCode(container, {
                text: text,
                width: 220,
                height: 220,
                colorDark: '#0a1030',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.M
            });
            return;
        } catch (e) {
            console.warn('QRCode error, fallback to img', e);
        }
    }

    // Fallback nếu thư viện qrcodejs chưa tải
    const img = document.createElement('img');
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(text)}`;
    img.alt = 'Mã QR phòng xem';
    img.style.width = '220px';
    img.style.height = '220px';
    img.style.borderRadius = '8px';
    container.appendChild(img);
}

function updateLiveHeaderBtn() {
    const btn = document.getElementById('live-btn-toggle');
    const lbl = document.getElementById('live-btn-label');
    if (!btn || !lbl) return;

    if (isLiveHost) {
        btn.classList.add('live-active');
        btn.title = `Đang phát trực tiếp phòng SAM-${liveRoomCode} (${liveConnections.length} người xem)`;
        lbl.innerHTML = `<span class="live-dot-pulse" style="display:inline-block;margin-right:2px;"></span> Live (${liveConnections.length})`;
    } else if (isSpectator) {
        btn.classList.add('live-active');
        btn.title = `Đang xem trực tiếp phòng SAM-${liveRoomCode}`;
        lbl.textContent = `Xem SAM-${liveRoomCode}`;
    } else {
        btn.classList.remove('live-active');
        btn.title = 'Phát hoặc xem trực tiếp';
        lbl.textContent = 'Trực tiếp';
    }
}

function updateLiveModalViewers() {
    const el = document.getElementById('live-modal-viewers-count');
    if (el) {
        el.textContent = `👥 ${liveConnections.length} người đang xem`;
    }
}

// ── 5. TỰ ĐỘNG KIỂM TRA LINK KHI TẢI TRANG ────────────────────
window.addEventListener('load', () => {
    setTimeout(checkLiveFromUrl, 400);
});
window.addEventListener('hashchange', checkLiveFromUrl);
