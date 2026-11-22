/* Pragma Detective - Lapisan Multiplayer (Firebase Realtime Database)
 * Dimuat SETELAH script utama di index.html. Hanya menimpa fungsi mode TOGETHER.
 * Mode SOLO tidak tersentuh. */
(function () {
  const firebaseConfig = {
    apiKey: "AIzaSyAVMIaiiiyOubySfL1rCrFYTfTNeudFO0M",
    authDomain: "pragma-detective.firebaseapp.com",
    databaseURL: "https://pragma-detective-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "pragma-detective",
    storageBucket: "pragma-detective.firebasestorage.app",
    messagingSenderId: "195457311446",
    appId: "1:195457311446:web:a290ba0155ee7cb8efdf77"
  };

  let fbAuth = null, fbDb = null;
  try {
    firebase.initializeApp(firebaseConfig);
    fbAuth = firebase.auth();
    fbDb = firebase.database();
  } catch (e) { console.error('Firebase gagal diinisialisasi:', e); }

  const room = { code: null, uid: null, ref: null, offs: [], players: null, evReady: false, busy: false };
  const TS = () => firebase.database.ServerValue.TIMESTAMP;
  const clean = (s, n = 200) => String(s == null ? '' : s).replace(/[<>]/g, '').slice(0, n);
  const inTogether = () => state.gameMode === 'together' && !!room.ref;

  // ---------- Persiapan modal Room ----------
  (function prepModal() {
    const m = document.getElementById('room-modal');
    if (!m) return;
    const code = m.querySelector('input[type="text"]');
    code.id = 'room-code-input';
    code.placeholder = 'Kode Room (ex: 7712)';
    code.maxLength = 8;
    code.addEventListener('input', () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    ['friend-name-input', 'friend-name-input-2'].forEach(id => {
      const e = document.getElementById(id); if (e) e.style.display = 'none';
    });
    m.querySelectorAll('div').forEach(d => {
      if (d.children.length === 0 && /Undang Agen/i.test(d.textContent)) {
        d.classList.remove('uppercase');
        d.textContent = 'Pemain pertama membuat room. Teman memasukkan kode yang sama (maks 3 pemain).';
      }
    });
  })();

  // ---------- Masuk room ----------
  window.enterTogetherGame = async function () {
    const code = (document.getElementById('room-code-input').value || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(code)) return showNotification('Kode room harus 4-8 huruf/angka', 'error');
    if (!fbDb) return showNotification('Firebase gagal dimuat. Cek koneksi internet.', 'error');
    if (room.busy) return;
    room.busy = true;
    try {
      const user = fbAuth.currentUser || (await fbAuth.signInAnonymously()).user;
      const uid = user.uid;
      const rr = fbDb.ref('rooms/' + code);

      const ps = await rr.child('players').get();
      const players = ps.val() || {};
      if (!ps.exists()) {
        try { await rr.remove(); } catch (e) {}           // room kosong/sisa lama: bersihkan
      } else if (!players[uid] && Object.keys(players).length >= 3) {
        throw { code: 'room-full' };
      }
      try {
        await rr.child('meta').set({ caseId: state.activeCaseId, hostUid: uid, createdAt: TS() });
      } catch (e) { /* meta sudah ada = room sudah dibuat teman */ }

      const meta = (await rr.child('meta').get()).val();
      if (meta && meta.caseId && casesDB[meta.caseId - 1]) {
        state.activeCaseId = meta.caseId;
        window.selectedCaseTitle = casesDB[meta.caseId - 1].title;
      }

      const me = rr.child('players/' + uid);
      await me.set({ name: clean(state.username, 20) || 'GUEST', avatar: avatarsData[state.avatarIdx].emoji, joinedAt: TS() });
      me.onDisconnect().remove();

      room.code = code; room.uid = uid; room.ref = rr; room.players = null; room.evReady = false;
      state.gameMode = 'together';
      state.totalClues = 7;
      closeRoomModal();
      document.getElementById('mode-selection-screen').classList.add('hidden');
      startGame();
      document.getElementById('target-clue-display').innerText = '7';
      const mt = document.getElementById('mission-target'); if (mt) mt.innerText = '7';
      document.getElementById('team-chat-logs').innerHTML =
        '<div class="text-center text-[10px] text-slate-500 font-mono-cyber my-2">-- SECURE CHANNEL ESTABLISHED --</div>';
      attachListeners();
      showNotification('Masuk ke room ' + code, 'success');
    } catch (e) {
      console.error(e);
      const c = e && e.code;
      const msg = c === 'room-full' ? 'Room penuh (maks 3 pemain).'
        : c === 'auth/operation-not-allowed' ? 'Login Anonymous belum diaktifkan di Firebase.'
        : c === 'auth/unauthorized-domain' ? 'Domain situs belum ada di Authorized domains Firebase.'
        : (c === 'PERMISSION_DENIED' || /permission/i.test(String(e && e.message))) ? 'Akses ditolak database. Cek Rules sudah di-Publish.'
        : 'Gagal masuk room: ' + (c || (e && e.message) || 'error tidak diketahui');
      showNotification(msg, 'error');
      room.ref = null;
    } finally { room.busy = false; }
  };

  // ---------- Listener realtime ----------
  function on(ref, ev, fn) {
    ref.on(ev, fn, err => console.error('Listener error:', err));
    room.offs.push(() => ref.off(ev, fn));
  }

  function attachListeners() {
    const rr = room.ref;

    on(rr.child('players'), 'value', snap => {
      const p = snap.val() || {}, prev = room.players, ids = Object.keys(p);
      room.players = p;
      if (prev) {
        ids.filter(id => id !== room.uid && !prev[id]).forEach(id => playJoinNotification(clean(p[id].name, 20) || 'Agen'));
        Object.keys(prev).filter(id => id !== room.uid && !p[id]).forEach(id =>
          showNotification('Agen ' + clean(prev[id].name, 20).toUpperCase() + ' keluar dari ruangan.', 'warning'));
        if (ids.length >= 3 && Object.keys(prev).length < 3) showNotification('RUANG PENUH! Investigasi Bersama Dimulai.', 'warning');
      }
      const label = document.querySelector('#team-discussion span');
      if (label) label.textContent = '👥 ROOM ' + room.code + ' · ' + ids.length + '/3';
    });

    on(rr.child('chat').limitToLast(100), 'child_added', snap => {
      const m = snap.val(); if (!m) return;
      const logs = document.getElementById('team-chat-logs'); if (!logs) return;
      const mine = m.uid === room.uid;
      const d = document.createElement('div');
      d.className = (mine
        ? 'self-end bg-slate-800 rounded-tr-none text-slate-200 border-slate-700'
        : 'self-start bg-green-900/30 rounded-tl-none text-green-100 border-green-800')
        + ' p-2 rounded-xl text-xs max-w-[80%] border shadow-md slide-up';
      if (!mine) {
        const n = document.createElement('div');
        n.className = 'text-[9px] text-green-400 font-bold mb-1';
        n.textContent = clean(m.name, 20);
        d.appendChild(n);
      }
      const t = document.createElement('span'); t.textContent = clean(m.text); d.appendChild(t);
      logs.appendChild(d);
      logs.scrollTop = logs.scrollHeight;
      const hidden = document.getElementById('team-discussion').classList.contains('hidden');
      if (!mine && hidden && Date.now() - (m.ts || 0) < 8000)
        showNotification('Pesan tim dari ' + clean(m.name, 20).toUpperCase(), 'cyan');
    });

    on(rr.child('evidence'), 'value', snap => {
      const v = snap.val() || {};
      const list = Object.keys(v).map(k => Object.assign({ id: k }, v[k])).sort((a, b) => (a.ts || 0) - (b.ts || 0));
      const old = state.cluesFound, first = !room.evReady;
      room.evReady = true;

      state.evidence = list.map(e => ({ id: e.id, text: clean(e.text), type: clean(e.type, 60), reason: clean(e.reason, 500) }));
      state.cluesFound = list.reduce((s, e) => s + (Number(e.amount) || 1), 0);
      state.witness1Interviewed = !!v.witness_1;
      state.witness2Interviewed = !!v.witness_2;
      state.decryptSolved = !!v.decrypt;
      state.visualSolved = !!v.visual;
      list.forEach(e => { const m = chatScript.find(x => x.id === e.id); if (m) m.analyzed = true; });

      if (state.cluesFound > old && !state.caseSolved) {
        for (let i = old + 1; i <= Math.min(state.cluesFound, 5); i++) {
          if (first) {                                       // pemain baru masuk: isi chat diam-diam
            window.incomingChatEvent(i);
            const a = document.getElementById('alarm-sound'); if (a) a.pause();
            const ph = document.getElementById('phone-container'); if (ph) ph.classList.remove('animate-shake');
          } else {
            setTimeout(() => window.incomingChatEvent(i), (i - old) * 1500 + 1000);
          }
        }
      }
      renderChat();
      updateDashboard();
      const wm = document.getElementById('witness-modal');
      if (wm && !wm.classList.contains('hidden')) renderWitnesses();
    });
  }

  // ---------- Fungsi yang ditimpa ----------
  const _addClue = window.addClue;
  window.addClue = function (amount, id, text, type, reason) {
    if (!inTogether()) return _addClue.apply(this, arguments);
    const key = String(id).replace(/^witness_(\d)_\d+$/, 'witness_$1').replace(/^decrypt_\d+$/, 'decrypt').replace(/^visual_\d+$/, 'visual').replace(/[.$#\[\]\/]/g, '_');
    room.ref.child('evidence/' + key).set({
      uid: room.uid, name: clean(state.username, 20) || 'GUEST', amount: Number(amount) || 1,
      text: clean(text), type: clean(type, 60), reason: clean(reason, 500), ts: TS()
    }).catch(e => { if (!e || e.code !== 'PERMISSION_DENIED') console.error(e); }); // sudah dicatat teman = abaikan
  };

  const _incoming = window.incomingChatEvent;
  window.incomingChatEvent = function (level) {
    if (!inTogether()) return _incoming.apply(this, arguments);
    const id = 'm_c' + level;
    if (chatScript.some(m => m.id === id)) return;
    _incoming.call(this, level);
    const last = chatScript[chatScript.length - 1];
    if (last) {
      last.id = id;
      if (state.evidence.some(e => e.id === id)) last.analyzed = true;
    }
    renderChat();
  };

  const _send = window.sendTeamMessage;
  window.sendTeamMessage = function () {
    if (!inTogether()) return _send.apply(this, arguments);
    const inp = document.getElementById('team-chat-input');
    const text = clean(inp.value.trim());
    if (!text) return;
    inp.value = '';
    room.ref.child('chat').push({ uid: room.uid, name: clean(state.username, 20) || 'GUEST', text, ts: TS() })
      .catch(e => { console.error(e); showNotification('Pesan gagal terkirim', 'error'); });
  };

  function leaveRoom() {
    if (!room.ref) return;
    room.offs.forEach(f => f()); room.offs = [];
    const me = room.ref.child('players/' + room.uid);
    me.onDisconnect().cancel();
    me.remove().catch(() => {});
    room.ref = null; room.code = null; room.players = null; room.evReady = false;
  }
  if (typeof window.returnToMenu !== 'function') {          // cadangan jika fungsi ini hilang dari index.html
    window.returnToMenu = function () {
      document.getElementById('win-modal').classList.add('hidden');
      document.getElementById('game-main-ui').classList.add('hidden');
      ['phone-toggle-btn', 'map-toggle-btn', 'tutorial-toggle-btn'].forEach(id => document.getElementById(id).classList.add('hidden'));
      showCasesMenu();
    };
  }
  ['executeExit', 'returnToMenu'].forEach(name => {
    const orig = window[name];
    window[name] = function () { leaveRoom(); return orig.apply(this, arguments); };
  });

  const _askTeam = window.requestTeamClue;                   // ganti bot palsu dengan pesan ke teman sungguhan
  window.requestTeamClue = function () {
    if (!inTogether()) return _askTeam.apply(this, arguments);
    const b = document.getElementById('btn-ask-team'); if (b) b.disabled = true;
    room.ref.child('chat').push({ uid: room.uid, name: clean(state.username, 20) || 'GUEST',
      text: '[BANTUAN] Aku buntu di Bypass Firewall. Ada yang tahu kata kuncinya?', ts: TS() }).catch(console.error);
    showNotification('Permintaan bantuan dikirim ke tim', 'success');
  };
})();
