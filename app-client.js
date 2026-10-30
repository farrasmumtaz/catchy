import { api, openRealtime, publicPreview } from './api.js';
import { sipAddress, parseIceServers, mergeMessages } from './model.js';
import { releaseMedia, cameraConstraints, captureCamera, replaceVideoTrack } from './media.js';

export function startClient(JsSIP, { sipDefaults = {} } = {}) {
  const $ = id => document.getElementById(id);
  let user = null, ua, session, sipAccount = '', selected = '', iceServers = [];
  let generation = 0, realtime, noticeTimer, syncTimer, sending = false, retry = null;
  let previewStream = null, previewRequest = 0, preferredCamera = '';
  const peers = new Map(), messages = new Map(), pages = new Map(), requests = new Map();
  const welcome = $('messages').firstElementChild.cloneNode(true);
  $('app').dataset.view = 'list';
  if (sipDefaults.ws && sipDefaults.domain) {
    $('ws').value = sipDefaults.ws; $('domain').value = sipDefaults.domain;
    $('sipHelp').textContent = 'Server panggilan sudah diisi otomatis. Masukkan kredensial akun SIP milikmu; akun aplikasi dan akun SIP tetap terpisah.';
  }
  $('backToContacts').onclick = () => { $('app').dataset.view = 'list'; $('message').blur(); };
  const notify = text => {
    clearTimeout(noticeTimer);
    $('notice').textContent = text;
    noticeTimer = setTimeout(() => { $('notice').textContent = ''; }, 6000);
  };
  const handleError = error => {
    if (error.status === 401) setUser(null);
    notify(error.message || 'Koneksi gagal. Coba kembali.');
  };
  const guard = fn => async (...args) => { try { await fn(...args); } catch (error) { handleError(error); } };

  function stopPreview() {
    previewRequest++;
    previewStream?.getTracks().forEach(track => track.stop()); previewStream = null;
    $('cameraPreview').srcObject = null; $('cameraStop').disabled = true;
    $('cameraStart').disabled = false;
  }
  async function listCameras() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
    if (preferredCamera && !cameras.some(camera => camera.deviceId === preferredCamera)) preferredCamera = '';
    for (const id of ['cameraDevice', 'callCamera']) {
      const select = $(id); select.replaceChildren();
      const automatic = document.createElement('option'); automatic.value = ''; automatic.textContent = 'Kamera default'; select.append(automatic);
      cameras.forEach((device, index) => {
        const option = document.createElement('option'); option.value = device.deviceId;
        option.textContent = device.label || `Kamera ${index + 1}`; select.append(option);
      });
      select.value = cameras.some(camera => camera.deviceId === preferredCamera) ? preferredCamera : '';
    }
  }
  async function startPreview() {
    stopPreview();
    const request = previewRequest;
    $('cameraStart').disabled = true; $('cameraStatus').textContent = 'Menyalakan kamera...';
    try {
      const stream = await captureCamera(preferredCamera);
      if (request !== previewRequest || !$('cameraSettings').open) { stream.getTracks().forEach(track => track.stop()); return; }
      previewStream = stream; $('cameraPreview').srcObject = stream;
      $('cameraPreview').play().catch(() => {});
      $('cameraStop').disabled = false; $('cameraStatus').textContent = 'Preview aktif. Video ini hanya tampil di perangkatmu.';
      await listCameras().catch(() => {});
    } catch (error) { if (request === previewRequest) $('cameraStatus').textContent = error.message; }
    finally { if (request === previewRequest) $('cameraStart').disabled = false; }
  }
  $('cameraSettingsButton').onclick = guard(async () => {
    if (session) throw new Error('Pilih kamera melalui panel video call yang sedang aktif.');
    $('cameraSettings').showModal(); await listCameras();
  });
  $('cameraStart').onclick = startPreview;
  $('cameraStop').onclick = () => { stopPreview(); $('cameraStatus').textContent = 'Kamera dimatikan.'; };
  $('cameraClose').onclick = () => { stopPreview(); $('cameraSettings').close(); };
  $('cameraSettings').addEventListener('close', stopPreview);
  $('cameraDevice').onchange = async () => { preferredCamera = $('cameraDevice').value; if (previewStream) await startPreview(); };
  $('callCamera').onchange = guard(async () => {
    const current = session;
    if (!current?.isEstablished()) return;
    $('callCamera').disabled = true;
    let stream;
    try {
      stream = await captureCamera($('callCamera').value);
      if (session !== current || current.isEnded()) { stream.getTracks().forEach(track => track.stop()); return; }
      await replaceVideoTrack(current.connection, stream.getVideoTracks()[0]);
      if (session !== current) { stream.getTracks().forEach(track => track.stop()); return; }
      preferredCamera = $('callCamera').value;
      $('local').srcObject = new MediaStream(current.connection.getSenders().map(sender => sender.track).filter(Boolean));
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop()); $('callCamera').value = preferredCamera;
      if (session === current) $('callStatus').textContent = error.message;
    } finally { $('callCamera').disabled = session !== current || !current.isEstablished(); }
  });

  function updateConnectionUI() {
    const registered = Boolean(ua?.isRegistered());
    for (const id of ['voice', 'video']) {
      $(id).disabled = !registered || !selected;
      $(id).title = !registered ? 'Hubungkan akun SIP melalui Pengaturan panggilan.' : !selected ? 'Pilih tujuan dahulu.' : '';
    }
    $('message').disabled = !user || !selected;
    $('composer').querySelector('button').disabled = !user || !selected || sending;
    $('target').disabled = !user;
    $('contact').querySelector('button').disabled = !user;
    $('accountButton').textContent = user ? `Keluar dari ${user.username}` : 'Masuk / Daftar';
    $('accountButton').disabled = publicPreview;
    $('settingsButton').disabled = publicPreview;
    const empty = $('messages').querySelector('.welcome');
    if (empty) {
      empty.querySelector('h2').textContent = user ? 'Siap untuk menyapa.' : 'Percakapan dimulai dari sini.';
      empty.querySelector('p').textContent = user
        ? 'Tambahkan username akun aplikasi tujuan di panel Percakapan. Riwayat pesan tersimpan di server.'
        : 'Masuk atau buat akun Cathcy untuk menyimpan dan menyinkronkan percakapanmu.';
      empty.querySelector('button').textContent = user ? 'Tambah percakapan ↗' : 'Masuk / Daftar ↗';
      empty.querySelector('span').textContent = user ? `Akun aplikasi: ${user.username}` : 'Panggilan memakai koneksi SIP terpisah.';
    }
    if (!selected) $('subtitle').textContent = user ? `Akun aplikasi: ${user.username}` : 'Chat, suara, dan video dalam satu tempat.';
    if (publicPreview && empty) {
      empty.querySelector('h2').textContent = 'Kenalan dengan kameramu.';
      empty.querySelector('p').textContent = 'Coba preview dan pilih kamera di perangkatmu. Chat dan panggilan belum tersedia di preview publik ini.';
      empty.querySelector('button').textContent = 'Periksa kamera';
      empty.querySelector('span').textContent = 'Preview kamera tetap di perangkatmu.';
      $('subtitle').textContent = 'Preview Cathcy · kamera lokal';
    }
  }

  function renderContacts() {
    const nav = $('contacts'); nav.replaceChildren();
    const names = new Set(peers.keys());
    if (selected) names.add(selected);
    if (!names.size) {
      const empty = document.createElement('p'); empty.className = 'contacts-empty';
      empty.textContent = user ? 'Belum ada percakapan. Tambahkan username teman yang sudah mendaftar.' : 'Masuk untuk membuka percakapan tersimpan.';
      nav.append(empty);
    }
    for (const peer of names) {
      const button = document.createElement('button'); button.textContent = peer;
      button.className = selected === peer ? 'active' : '';
      button.title = peers.get(peer)?.lastMessage || peer;
      button.onclick = guard(() => selectPeer(peer));
      nav.append(button);
    }
  }
  function renderMessages(keepScroll = false) {
    const pane = $('messages');
    const oldHeight = pane.scrollHeight, oldTop = pane.scrollTop;
    pane.replaceChildren();
    if (!selected) {
      $('name').textContent = 'Selamat datang di Cathcy';
      pane.append(welcome.cloneNode(true));
    } else {
      $('name').textContent = selected;
      $('subtitle').textContent = 'Chat pribadi · tersimpan di server';
      const page = pages.get(selected);
      if (page?.hasMore) {
        const older = document.createElement('button'); older.textContent = 'Muat pesan sebelumnya';
        older.onclick = guard(() => loadMessages(selected, true)); pane.append(older);
      }
      const rows = messages.get(selected) || [];
      if (!rows.length) {
        const empty = document.createElement('p'); empty.className = 'contacts-empty';
        empty.textContent = page ? 'Belum ada pesan. Kirim sapaan pertamamu.' : 'Memuat riwayat…'; pane.append(empty);
      }
      for (const message of rows) {
        const bubble = document.createElement('article');
        bubble.className = message.sender === user?.username ? 'bubble mine' : 'bubble';
        const body = document.createElement('p'); body.textContent = message.body;
        const time = document.createElement('small');
        time.textContent = `${new Date(message.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} · Tersimpan`;
        bubble.append(body, time); pane.append(bubble);
      }
    }
    updateConnectionUI();
    pane.scrollTop = keepScroll ? pane.scrollHeight - oldHeight + oldTop : pane.scrollHeight;
  }
  function render() { renderContacts(); renderMessages(); }

  async function loadMessages(peer, older = false) {
    const owner = generation;
    const request = (requests.get(peer) || 0) + 1;
    requests.set(peer, request);
    const before = older ? pages.get(peer)?.nextBefore : null;
    let page;
    try { page = await api(`/messages/${encodeURIComponent(peer)}${before ? `?before=${before}` : ''}`); }
    catch (error) { if (owner !== generation) return; throw error; }
    if (owner !== generation || requests.get(peer) !== request) return;
    const current = messages.get(peer) || [];
    const ids = new Set(current.map(message => message.id));
    const reset = !older && !page.messages.some(message => ids.has(message.id));
    messages.set(peer, reset ? page.messages : mergeMessages(current, page.messages));
    if (older || reset || !pages.has(peer)) pages.set(peer, page);
    if (selected === peer) renderMessages(older);
  }
  async function sync() {
    if (!user) return;
    const owner = generation;
    let rows;
    try { rows = await api('/conversations'); }
    catch (error) { if (owner !== generation) return; throw error; }
    if (owner !== generation) return;
    for (const row of rows) peers.set(row.username, row);
    renderContacts();
    if (selected) await loadMessages(selected);
  }
  async function selectPeer(peer) {
    if (selected !== peer) { retry = null; $('message').value = ''; }
    selected = peer; $('app').dataset.view = 'chat'; render();
    await loadMessages(peer);
  }
  function setUser(next) {
    generation++; realtime?.disconnect(); clearTimeout(syncTimer);
    ua?.stop(); ua = null; sipAccount = ''; $('status').textContent = 'Panggilan SIP belum terhubung';
    user = next; $('app').dataset.view = 'list';
    if (user && sipDefaults.ws && sipDefaults.domain) $('username').value = user.username;
    selected = ''; retry = null; peers.clear(); messages.clear(); pages.clear(); requests.clear();
    $('message').value = ''; $('appStatus').textContent = user ? `Masuk sebagai ${user.username}` : 'Belum masuk ke aplikasi';
    render();
    if (!user) return;
    const socket = openRealtime(), owner = generation;
    realtime = socket;
    socket.on('session:ready', guard(async () => { if (owner !== generation || !user) return; $('appStatus').textContent = `Chat terhubung · ${user.username}`; await sync(); }));
    socket.on('messages:changed', () => { if (owner !== generation) return; clearTimeout(syncTimer); syncTimer = setTimeout(guard(sync), 80); });
    socket.on('disconnect', guard(async reason => {
      if (!user || owner !== generation) return;
      $('appStatus').textContent = 'Chat terputus · pesan tetap tersimpan di server';
      if (reason === 'io server disconnect') {
        try { await api('/auth/me'); }
        catch (error) { if (owner !== generation) return; throw error; }
        if (owner !== generation) return;
        $('appStatus').textContent = 'Koneksi chat ditolak server · muat ulang untuk mencoba kembali';
        notify('Sesi masih aktif, tetapi koneksi chat ditolak. Muat ulang halaman setelah memeriksa koneksi.');
      }
    }));
    socket.on('connect_error', () => { if (owner === generation) $('appStatus').textContent = 'Chat belum terhubung · mencoba kembali'; });
    socket.connect();
    void sync().catch(handleError);
  }

  $('accountButton').onclick = guard(async () => {
    if (!user) { $('auth').showModal(); return; }
    if (session) throw new Error('Akhiri panggilan sebelum keluar.');
    await api('/auth/logout', { method: 'POST' });
    setUser(null); notify('Kamu sudah keluar. Riwayat tetap tersimpan di server.');
  });
  $('closeAuth').onclick = () => $('auth').close();
  let authMode = 'login';
  $('authMode').onclick = () => {
    $('authError').textContent = '';
    authMode = authMode === 'login' ? 'register' : 'login';
    $('authTitle').textContent = authMode === 'login' ? 'Masuk ke Cathcy' : 'Buat akun Cathcy';
    $('authSubmit').textContent = authMode === 'login' ? 'Masuk' : 'Daftar';
    $('authMode').textContent = authMode === 'login' ? 'Belum punya akun? Daftar' : 'Sudah punya akun? Masuk';
    $('appPassword').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
  };
  $('authForm').onsubmit = async event => {
    event.preventDefault();
    if ($('authSubmit').disabled) return;
    $('authError').textContent = '';
    try {
      if (session) throw new Error('Akhiri panggilan sebelum mengganti akun aplikasi.');
      const username = $('appUsername').value.trim().toLowerCase();
      const password = $('appPassword').value;
      if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username)) throw new Error('Username harus 3 sampai 32 karakter: huruf kecil, angka, titik, garis bawah, atau tanda hubung.');
      const length = Array.from(password).length;
      if (length < 8 || length > 128) throw new Error('Password aplikasi harus 8 sampai 128 karakter. Jika baru punya akun SIP, klik Daftar dahulu untuk membuat akun aplikasi.');
      $('authSubmit').disabled = true;
      const next = await api(`/auth/${authMode}`, { method: 'POST', body: JSON.stringify({ username, password }) });
      $('appPassword').value = ''; $('auth').close(); setUser(next);
      notify('Akun aplikasi terhubung. Panggilan SIP dapat dihubungkan lewat Pengaturan panggilan.');
    } catch (error) { $('authError').textContent = error.message || 'Tidak dapat menghubungi server. Coba kembali.'; }
    finally { $('authSubmit').disabled = false; }
  };
  $('messages').addEventListener('click', event => {
    if (!event.target.closest('.welcome-connect')) return;
    if (publicPreview) { void $('cameraSettingsButton').onclick(); return; }
    if (user) $('target').focus(); else $('auth').showModal();
  });
  $('contact').onsubmit = guard(async event => {
    event.preventDefault();
    const peer = $('target').value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(peer)) throw new Error('Masukkan username aplikasi, bukan alamat SIP.');
    const owner = generation;
    await api(`/users/${encodeURIComponent(peer)}`);
    if (owner !== generation) return;
    $('target').value = ''; peers.set(peer, { username: peer }); await selectPeer(peer);
  });
  $('composer').onsubmit = guard(async event => {
    event.preventDefault(); if (sending) return;
    if (!user || !selected) throw new Error('Masuk dan pilih tujuan dahulu.');
    const body = $('message').value.trim(); if (!body) return;
    const owner = generation, peer = selected;
    if (!retry || retry.recipient !== peer || retry.body !== body) retry = { recipient: peer, body, clientId: crypto.randomUUID() };
    const payload = retry; sending = true; updateConnectionUI();
    try {
      const message = await api('/messages', { method: 'POST', body: JSON.stringify(payload) });
      if (owner !== generation) return;
      messages.set(peer, mergeMessages(messages.get(peer) || [], [message]));
      retry = null;
      if (selected === peer && $('message').value.trim() === body) $('message').value = '';
      if (selected === peer) renderMessages();
      await sync();
    } catch (error) { if (owner === generation) throw error; }
    finally { sending = false; updateConnectionUI(); }
  });

  const ready = () => {
    if (!ua?.isRegistered()) throw new Error('Hubungkan akun SIP melalui Pengaturan panggilan.');
    if (!selected) throw new Error('Pilih tujuan dahulu.');
  };
  $('settingsButton').onclick = () => $('settings').showModal();
  $('closeSettings').onclick = () => $('settings').close();
  $('connect').onsubmit = guard(event => {
    event.preventDefault(); if (session) throw new Error('Akhiri panggilan sebelum mengganti akun SIP.');
    const url = new URL($('ws').value);
    if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('Gunakan URL ws:// atau wss://.');
    const parsedIce = parseIceServers($('ice').value);
    const uri = sipAddress($('username').value, $('domain').value);
    const next = new JsSIP.UA({ sockets: [new JsSIP.WebSocketInterface(url.href)], uri, password: $('password').value, session_timers: false });
    ua?.stop(); ua = next; sipAccount = uri; iceServers = parsedIce;
    const status = text => { if (ua !== next) return; $('status').textContent = text; updateConnectionUI(); };
    next.on('connecting', () => status('Panggilan SIP menghubungkan…'));
    next.on('registered', () => {
      if (ua !== next) return;
      status(`SIP terhubung: ${sipAccount}`); notify('Panggilan SIP siap. Chat menggunakan akun aplikasi.');
    });
    next.on('disconnected', () => status('Panggilan SIP terputus · mencoba kembali'));
    next.on('registrationFailed', event => status(`Registrasi SIP gagal: ${event.cause}`));
    next.on('unregistered', () => status('Panggilan SIP belum terdaftar'));
    next.on('newRTCSession', event => {
      if (ua !== next) return;
      if (session) { event.session.terminate({ status_code: 486 }); return; }
      setupCall(event.session, event.originator === 'remote');
    });
    next.start(); $('password').value = ''; $('ice').value = ''; $('settings').close(); updateConnectionUI();
  });
  const options = video => ({ mediaConstraints: { audio: true, video: video ? cameraConstraints(preferredCamera) : false }, pcConfig: { iceServers } });
  function setupCall(current, incoming) {
    session = current; $('callName').textContent = current.remote_identity.uri.toString();
    $('callStatus').textContent = incoming ? 'Panggilan masuk' : 'Memanggil…';
    stopPreview(); $('cameraSettings').close();
    $('answer').hidden = !incoming; $('mute').textContent = 'Mute'; $('camera').textContent = 'Kamera';
    $('camera').disabled = true; $('callCameraLabel').hidden = true; $('callCamera').disabled = true; $('call').showModal();
    const showLocalMedia = () => {
      if (session !== current || !current.connection) return;
      const tracks = current.connection.getSenders().map(sender => sender.track).filter(Boolean);
      $('local').srcObject = new MediaStream(tracks);
      const hasVideo = tracks.some(track => track.kind === 'video');
      $('camera').disabled = !hasVideo; $('local').hidden = !hasVideo; $('callCameraLabel').hidden = !hasVideo;
      $('callCamera').disabled = !hasVideo || !current.isEstablished();
      $('camera').textContent = current.isMuted().video ? 'Aktifkan kamera' : 'Matikan kamera';
      if (hasVideo) void listCameras().catch(() => {});
    };
    const attached = new WeakSet();
    const attach = pc => {
      if (attached.has(pc)) return; attached.add(pc);
      pc.addEventListener('track', event => {
        if (session !== current) return;
        const stream = $('remote').srcObject || new MediaStream(); stream.addTrack(event.track); $('remote').srcObject = stream;
        $('remote').play().catch(() => { if (session === current) $('playAudio').hidden = false; });
      });
      pc.addEventListener('connectionstatechange', () => { if (session === current && pc.connectionState === 'failed') notify('Media gagal terhubung. Periksa ICE/TURN dan firewall.'); });
    };
    current.on('peerconnection', event => attach(event.peerconnection)); if (current.connection) attach(current.connection);
    current.on('confirmed', () => {
      if (session !== current) return;
      $('callStatus').textContent = 'Panggilan terhubung'; $('answer').hidden = true;
      showLocalMedia();
    });
    current.on('connecting', showLocalMedia);
    current.on('progress', () => { if (session === current && !incoming) $('callStatus').textContent = 'Menunggu jawaban…'; });
    const cleanup = event => {
      if (session !== current) return;
      session = null; releaseMedia(current.connection, [$('remote'), $('local')]);
      $('playAudio').hidden = true; $('call').close(); notify(`Panggilan selesai: ${event.cause}`);
    };
    current.on('ended', cleanup); current.on('failed', cleanup);
  }
  $('voice').onclick = guard(() => { ready(); if (session) throw new Error('Masih ada panggilan aktif.'); ua.call(sipAddress(selected, $('domain').value), options(false)); });
  $('video').onclick = guard(() => { ready(); if (session) throw new Error('Masih ada panggilan aktif.'); ua.call(sipAddress(selected, $('domain').value), options(true)); });
  $('answer').onclick = guard(() => {
    if (!session) throw new Error('Panggilan sudah berakhir.');
    session.answer({ pcConfig: { iceServers } }); $('answer').hidden = true;
  });
  $('hangup').onclick = guard(() => session?.terminate());
  $('call').addEventListener('cancel', event => event.preventDefault());
  $('mute').onclick = guard(() => { if (!session) return; const muted = session.isMuted().audio; muted ? session.unmute({ audio: true }) : session.mute({ audio: true }); $('mute').textContent = muted ? 'Mute' : 'Buka mikrofon'; });
  $('camera').onclick = guard(() => { if (!session) return; const muted = session.isMuted().video; muted ? session.unmute({ video: true }) : session.mute({ video: true }); $('camera').textContent = muted ? 'Matikan kamera' : 'Aktifkan kamera'; });
  $('playAudio').onclick = () => $('remote').play().then(() => { $('playAudio').hidden = true; }).catch(() => notify('Browser belum mengizinkan pemutaran audio.'));
  window.addEventListener('beforeunload', () => { stopPreview(); ua?.stop(); realtime?.disconnect(); });
  render();
  if (publicPreview) {
    $('appStatus').textContent = 'Preview publik · chat belum tersedia';
    $('status').textContent = 'Panggilan belum tersedia di preview ini';
    document.querySelector('footer').textContent = 'Preview kamera lokal · chat dan panggilan belum tersedia';
    return;
  }
  void api('/auth/me').then(next => { if (generation === 0) setUser(next); }).catch(error => {
    if (generation !== 0) return;
    if (error.status === 401) setUser(null);
    else { $('appStatus').textContent = 'API belum tersedia'; notify('Backend belum tersedia. Jalankan API, lalu refresh halaman.'); }
  });
}
