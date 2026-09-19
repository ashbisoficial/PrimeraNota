(() => {
  'use strict';

  // ---------- backend connection (URL + API key live in localStorage,
  // since the frontend can be static-hosted on a different origin, e.g.
  // GitHub Pages, than the Node/ffmpeg backend) ----------

  const conn = {
    base: localStorage.getItem('pn_api_base') || '',
    key: localStorage.getItem('pn_api_key') || ''
  };

  function saveConn(base, key) {
    conn.base = base.replace(/\/+$/, '');
    conn.key = key || '';
    localStorage.setItem('pn_api_base', conn.base);
    localStorage.setItem('pn_api_key', conn.key);
  }

  function clearConn() {
    conn.base = '';
    conn.key = '';
    localStorage.removeItem('pn_api_base');
    localStorage.removeItem('pn_api_key');
  }

  // ---------- helpers ----------

  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (conn.key) headers['x-api-key'] = conn.key;
    const res = await fetch(conn.base + path, {
      headers,
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (_) { /* no body */ }
    if (!res.ok) throw new Error((data && data.error) || `Error ${res.status}`);
    return data;
  }

  async function fetchBinary(path) {
    const headers = {};
    if (conn.key) headers['x-api-key'] = conn.key;
    const res = await fetch(conn.base + path, { headers });
    if (!res.ok) throw new Error('No se pudo cargar el audio.');
    return res.blob();
  }

  let toastTimer = null;
  function toast(message, isError = false) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.remove('hidden');
    el.classList.toggle('error', isError);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
  }

  // ---------- tabs ----------

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`view-${btn.dataset.view}`).classList.add('active');
      if (btn.dataset.view === 'biblioteca') loadSongs();
      if (btn.dataset.view === 'playlists') loadPlaylistsView();
      if (btn.dataset.view === 'ajustes') loadSettings();
    });
  });

  // ---------- shared state ----------

  let playlists = [];
  let currentGame = null;
  let currentClipUrl = null;
  let selectedImportPlaylists = new Set(['default']);

  async function refreshPlaylists() {
    playlists = await api('/api/playlists');
    const select = document.getElementById('playlist-select');
    select.innerHTML = playlists.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} (${p.songIds.length})</option>`).join('');
    renderImportPlaylistChips();
  }

  function escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ================= JUGAR =================

  const gameEmpty = document.getElementById('game-empty');
  const gameCard = document.getElementById('game-card');
  const revealCard = document.getElementById('reveal-card');
  const audioPlayer = document.getElementById('audio-player');

  document.getElementById('btn-new-game').addEventListener('click', startNewGame);
  document.getElementById('btn-again').addEventListener('click', startNewGame);

  async function startNewGame() {
    const playlistId = document.getElementById('playlist-select').value;
    if (!playlistId) return toast('Creá una playlist primero en la pestaña Playlists.', true);
    try {
      currentGame = await api('/api/game/start', { method: 'POST', body: { playlistId } });
      revealCard.classList.add('hidden');
      gameEmpty.classList.add('hidden');
      gameCard.classList.remove('hidden');
      if (currentClipUrl) { URL.revokeObjectURL(currentClipUrl); currentClipUrl = null; }
      audioPlayer.src = '';
      document.getElementById('guess-input').value = '';
      document.getElementById('guess-input').disabled = false;
      document.getElementById('guess-form').querySelector('button').disabled = false;
      document.getElementById('btn-skip').disabled = false;
      document.getElementById('btn-giveup').disabled = false;
      renderGame();
    } catch (err) {
      toast(err.message, true);
    }
  }

  function renderGame() {
    const row = document.getElementById('attempts-row');
    row.innerHTML = currentGame.durations.map((d, i) => {
      const attemptNum = i + 1;
      const g = currentGame.guesses.find((x) => x.attempt === attemptNum);
      let cls = '';
      if (g) cls = g.correct ? 'correct' : 'wrong';
      else if (attemptNum === currentGame.attempt && !currentGame.finished) cls = 'current';
      return `<div class="attempt-dot ${cls}">${d}s</div>`;
    }).join('');

    document.getElementById('current-duration').textContent = `${currentGame.currentDuration}s`;
    document.getElementById('current-attempt').textContent = Math.min(currentGame.attempt, currentGame.maxAttempts);
    document.getElementById('max-attempts').textContent = currentGame.maxAttempts;

    const history = document.getElementById('guess-history');
    history.innerHTML = currentGame.guesses.map((g) => {
      const label = g.skipped ? 'Saltado' : g.text;
      return `<li class="${g.correct ? 'correct' : 'wrong'}"><span>${escapeHtml(label)}</span><span>${g.correct ? '✔' : '✘'}</span></li>`;
    }).join('');

    if (currentGame.finished) {
      document.getElementById('guess-input').disabled = true;
      document.getElementById('guess-form').querySelector('button').disabled = true;
      document.getElementById('btn-skip').disabled = true;
      document.getElementById('btn-giveup').disabled = true;
      loadReveal();
    }
  }

  document.getElementById('btn-play').addEventListener('click', async () => {
    if (!currentGame) return;
    const btn = document.getElementById('btn-play');
    btn.disabled = true;
    try {
      const blob = await fetchBinary(`/api/game/${currentGame.id}/clip`);
      if (currentClipUrl) URL.revokeObjectURL(currentClipUrl);
      currentClipUrl = URL.createObjectURL(blob);
      audioPlayer.src = currentClipUrl;
      await audioPlayer.play();
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('guess-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('guess-input');
    const text = input.value.trim();
    if (!text || !currentGame) return;
    try {
      currentGame = await api(`/api/game/${currentGame.id}/guess`, { method: 'POST', body: { text } });
      input.value = '';
      hideAutocomplete();
      renderGame();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('btn-skip').addEventListener('click', async () => {
    if (!currentGame) return;
    try {
      currentGame = await api(`/api/game/${currentGame.id}/skip`, { method: 'POST' });
      renderGame();
    } catch (err) { toast(err.message, true); }
  });

  document.getElementById('btn-giveup').addEventListener('click', async () => {
    if (!currentGame) return;
    try {
      currentGame = await api(`/api/game/${currentGame.id}/giveup`, { method: 'POST' });
      renderGame();
    } catch (err) { toast(err.message, true); }
  });

  async function loadReveal() {
    try {
      const info = await api(`/api/game/${currentGame.id}/reveal`);
      document.getElementById('reveal-thumb').src = info.thumbnail || '';
      document.getElementById('reveal-title').textContent = info.title;
      document.getElementById('reveal-artist').textContent = info.artist || '';
      document.getElementById('reveal-link').href = info.sourceUrl;
      const resultEl = document.getElementById('reveal-result');
      resultEl.textContent = info.won ? `¡Acertaste en el intento ${info.attempts}!` : 'No esta vez';
      resultEl.className = `reveal-result ${info.won ? 'won' : 'lost'}`;
      revealCard.classList.remove('hidden');
    } catch (err) {
      toast(err.message, true);
    }
  }

  // autocomplete for guesses
  const guessInput = document.getElementById('guess-input');
  const autocompleteList = document.getElementById('autocomplete-list');
  let autocompleteTimer = null;

  guessInput.addEventListener('input', () => {
    clearTimeout(autocompleteTimer);
    const q = guessInput.value.trim();
    if (!q || !currentGame) return hideAutocomplete();
    autocompleteTimer = setTimeout(async () => {
      try {
        const playlistId = document.getElementById('playlist-select').value;
        const results = await api(`/api/songs/search?q=${encodeURIComponent(q)}&playlistId=${encodeURIComponent(playlistId)}`);
        if (!results.length) return hideAutocomplete();
        autocompleteList.innerHTML = results.map((s) => `<div class="autocomplete-item" data-title="${escapeHtml(s.title)}">${escapeHtml(s.title)} <span class="muted">${escapeHtml(s.artist || '')}</span></div>`).join('');
        autocompleteList.classList.remove('hidden');
      } catch (_) { hideAutocomplete(); }
    }, 200);
  });

  autocompleteList.addEventListener('click', (e) => {
    const item = e.target.closest('.autocomplete-item');
    if (!item) return;
    guessInput.value = item.dataset.title;
    hideAutocomplete();
    guessInput.focus();
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.autocomplete-wrap')) hideAutocomplete();
  });

  function hideAutocomplete() {
    autocompleteList.classList.add('hidden');
    autocompleteList.innerHTML = '';
  }

  // ================= BIBLIOTECA =================

  function renderImportPlaylistChips() {
    const wrap = document.getElementById('import-playlists');
    wrap.innerHTML = playlists.map((p) => `<div class="chip ${selectedImportPlaylists.has(p.id) ? 'selected' : ''}" data-id="${p.id}">${escapeHtml(p.name)}</div>`).join('');
    wrap.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const id = chip.dataset.id;
        if (selectedImportPlaylists.has(id)) selectedImportPlaylists.delete(id);
        else selectedImportPlaylists.add(id);
        chip.classList.toggle('selected');
      });
    });
  }

  document.getElementById('import-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = document.getElementById('import-url').value.trim();
    const title = document.getElementById('import-title').value.trim();
    const artist = document.getElementById('import-artist').value.trim();
    const statusEl = document.getElementById('import-status');
    const submitBtn = e.target.querySelector('button');
    submitBtn.disabled = true;
    statusEl.textContent = 'Enviando...';
    try {
      const { jobId } = await api('/api/songs/import', {
        method: 'POST',
        body: { url, title: title || undefined, artist: artist || undefined, playlistIds: Array.from(selectedImportPlaylists) }
      });
      pollJob(jobId, statusEl, submitBtn, e.target);
    } catch (err) {
      statusEl.textContent = err.message;
      submitBtn.disabled = false;
    }
  });

  function pollJob(jobId, statusEl, submitBtn, form) {
    const interval = setInterval(async () => {
      try {
        const job = await api(`/api/jobs/${jobId}`);
        statusEl.textContent = job.message;
        if (job.status === 'done') {
          clearInterval(interval);
          submitBtn.disabled = false;
          form.reset();
          toast('Canción agregada 🎶');
          await refreshPlaylists();
          loadSongs();
        } else if (job.status === 'error') {
          clearInterval(interval);
          submitBtn.disabled = false;
          toast(`Error: ${job.message}`, true);
        }
      } catch (err) {
        clearInterval(interval);
        submitBtn.disabled = false;
        statusEl.textContent = err.message;
      }
    }, 1500);
  }

  async function loadSongs() {
    const songs = await api('/api/songs');
    const list = document.getElementById('song-list');
    if (!songs.length) {
      list.innerHTML = '<p class="muted">Todavía no agregaste canciones.</p>';
      return;
    }
    list.innerHTML = songs.map((s) => `
      <div class="song-item" data-id="${s.id}">
        <img src="${s.thumbnail || ''}" alt="">
        <div class="song-main">
          <div class="title">${escapeHtml(s.title)}</div>
          <div class="muted">${escapeHtml(s.artist || '')} · ${s.platform}</div>
        </div>
        <div class="song-controls">
          <label class="muted">Inicio (s)</label>
          <input type="number" min="0" value="${s.startSeconds}" data-role="start">
          <button class="btn" data-role="save">Guardar</button>
          <button class="btn danger" data-role="delete">Borrar</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.song-item').forEach((item) => {
      const id = item.dataset.id;
      item.querySelector('[data-role="save"]').addEventListener('click', async () => {
        const startSeconds = Number(item.querySelector('[data-role="start"]').value) || 0;
        try {
          await api(`/api/songs/${id}`, { method: 'PATCH', body: { startSeconds } });
          toast('Guardado');
        } catch (err) { toast(err.message, true); }
      });
      item.querySelector('[data-role="delete"]').addEventListener('click', async () => {
        if (!confirm('¿Borrar esta canción de la biblioteca?')) return;
        try {
          await api(`/api/songs/${id}`, { method: 'DELETE' });
          await refreshPlaylists();
          loadSongs();
        } catch (err) { toast(err.message, true); }
      });
    });
  }

  // ================= PLAYLISTS =================

  document.getElementById('playlist-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('playlist-name');
    const name = input.value.trim();
    if (!name) return;
    try {
      await api('/api/playlists', { method: 'POST', body: { name } });
      input.value = '';
      await refreshPlaylists();
      loadPlaylistsView();
    } catch (err) { toast(err.message, true); }
  });

  async function loadPlaylistsView() {
    const [pls, songs] = await Promise.all([api('/api/playlists'), api('/api/songs')]);
    const container = document.getElementById('playlist-list');
    container.innerHTML = pls.map((pl) => `
      <div class="card playlist-item" data-id="${pl.id}">
        <div class="head">
          <strong>${escapeHtml(pl.name)}</strong>
          <div>
            <span class="muted">${pl.songIds.length} canciones</span>
            ${pl.id !== 'default' ? '<button class="btn danger" data-role="delete-playlist">Borrar</button>' : ''}
          </div>
        </div>
        <div class="songs-check">
          ${songs.map((s) => `
            <label>
              <input type="checkbox" data-song-id="${s.id}" ${pl.songIds.includes(s.id) ? 'checked' : ''}>
              ${escapeHtml(s.title)} <span class="muted">${escapeHtml(s.artist || '')}</span>
            </label>
          `).join('') || '<span class="muted">No hay canciones en la biblioteca.</span>'}
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.playlist-item').forEach((card) => {
      const id = card.dataset.id;
      const delBtn = card.querySelector('[data-role="delete-playlist"]');
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          if (!confirm('¿Borrar esta playlist?')) return;
          try {
            await api(`/api/playlists/${id}`, { method: 'DELETE' });
            await refreshPlaylists();
            loadPlaylistsView();
          } catch (err) { toast(err.message, true); }
        });
      }
      card.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.addEventListener('change', async () => {
          const checked = Array.from(card.querySelectorAll('input[type="checkbox"]:checked')).map((c) => c.dataset.songId);
          try {
            await api(`/api/playlists/${id}`, { method: 'PATCH', body: { songIds: checked } });
            await refreshPlaylists();
          } catch (err) { toast(err.message, true); }
        });
      });
    });
  }

  // ================= AJUSTES =================

  async function loadSettings() {
    const settings = await api('/api/settings');
    document.getElementById('settings-durations').value = settings.attemptDurations.join(',');
  }

  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = document.getElementById('settings-durations').value;
    const attemptDurations = raw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
    if (attemptDurations.length < 2) return toast('Necesitás al menos 2 valores.', true);
    try {
      await api('/api/settings', { method: 'PATCH', body: { attemptDurations } });
      document.getElementById('settings-status').textContent = 'Guardado ✔';
      setTimeout(() => { document.getElementById('settings-status').textContent = ''; }, 2000);
    } catch (err) { toast(err.message, true); }
  });

  // ---------- connection banner ----------

  const banner = document.getElementById('connection-banner');

  async function testConnection(base, key) {
    const headers = key ? { 'x-api-key': key } : {};
    const res = await fetch(base + '/api/health', { headers });
    if (!res.ok) throw new Error('No se pudo conectar. Revisá la URL y la API key.');
  }

  function showBanner() { banner.classList.remove('hidden'); }
  function hideBanner() { banner.classList.add('hidden'); }

  function updateConnLabel() {
    const label = document.getElementById('conn-current-url');
    if (label) label.textContent = conn.base || `${window.location.origin} (mismo servidor)`;
  }

  document.getElementById('connection-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = document.getElementById('conn-url').value.trim().replace(/\/+$/, '');
    const key = document.getElementById('conn-key').value.trim();
    const statusEl = document.getElementById('connection-status');
    statusEl.textContent = 'Conectando...';
    try {
      await testConnection(url, key);
      saveConn(url, key);
      statusEl.textContent = '';
      hideBanner();
      updateConnLabel();
      await refreshPlaylists();
      toast('Conectado ✔');
    } catch (err) {
      statusEl.textContent = err.message;
    }
  });

  const changeServerBtn = document.getElementById('btn-change-server');
  if (changeServerBtn) {
    changeServerBtn.addEventListener('click', () => {
      document.getElementById('conn-url').value = conn.base;
      document.getElementById('conn-key').value = conn.key;
      showBanner();
      banner.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // ---------- init ----------

  (async function init() {
    try {
      await testConnection(conn.base, conn.key);
      updateConnLabel();
      await refreshPlaylists();
    } catch (err) {
      const stale = conn.base;
      if (stale) clearConn(); // stale saved backend, let the user re-enter it
      document.getElementById('conn-url').value = stale;
      showBanner();
    }
  })();
})();
