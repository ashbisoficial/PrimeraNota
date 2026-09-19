const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

const store = require('./lib/store');
const jobs = require('./lib/jobs');
const downloader = require('./lib/downloader');
const audio = require('./lib/audio');
const game = require('./lib/game');
const { normalize } = require('./lib/match');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// No-auth health check, used by the frontend to test a backend connection
// and by hosting platforms for liveness probes.
app.get('/api/health', (req, res) => res.json({ ok: true }));

// When API_KEY is set (recommended for any publicly reachable deployment,
// e.g. behind a GitHub Pages frontend), every other /api route requires it.
app.use('/api', (req, res, next) => {
  if (!API_KEY) return next();
  if (req.header('x-api-key') === API_KEY) return next();
  res.status(401).json({ error: 'Falta o es inválida la API key (header x-api-key).' });
});

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function songSummary(song) {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    aliases: song.aliases || [],
    sourceUrl: song.sourceUrl,
    platform: song.platform,
    thumbnail: song.thumbnail,
    startSeconds: song.startSeconds || 0,
    durationSeconds: song.durationSeconds || 0,
    addedAt: song.addedAt,
    playlistIds: song.playlistIds || []
  };
}

// ---------- Songs ----------

app.get('/api/songs', (req, res) => {
  const db = store.load();
  res.json(Object.values(db.songs).map(songSummary));
});

app.get('/api/songs/search', (req, res) => {
  const db = store.load();
  const q = normalize(req.query.q || '');
  const playlistId = req.query.playlistId;
  let songs = Object.values(db.songs);
  if (playlistId) songs = songs.filter((s) => (s.playlistIds || []).includes(playlistId));
  if (q) {
    songs = songs.filter((s) => normalize(s.title).includes(q) || normalize(s.artist).includes(q));
  }
  res.json(songs.slice(0, 15).map((s) => ({ id: s.id, title: s.title, artist: s.artist })));
});

app.post('/api/songs/import', (req, res) => {
  const { url, playlistIds, title: titleOverride, artist: artistOverride } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Falta la URL de YouTube/TikTok.' });
  }
  const job = jobs.create();
  res.status(202).json({ jobId: job.id });

  (async () => {
    try {
      jobs.update(job.id, { status: 'metadata', message: 'Obteniendo información...' });
      const meta = await downloader.fetchMetadata(url);

      const songId = store.newId('song');
      const destNoExt = path.join(store.AUDIO_DIR, songId);

      jobs.update(job.id, { status: 'downloading', message: 'Descargando audio...' });
      const audioFile = await downloader.downloadAudio(url, destNoExt);

      jobs.update(job.id, { status: 'processing', message: 'Procesando...' });
      const durationSeconds = await audio.probeDuration(audioFile);

      const song = {
        id: songId,
        title: titleOverride || meta.title,
        artist: artistOverride || meta.artist,
        aliases: [],
        sourceUrl: url,
        platform: meta.platform,
        thumbnail: meta.thumbnail,
        startSeconds: 0,
        durationSeconds,
        audioFile,
        addedAt: new Date().toISOString(),
        playlistIds: []
      };

      await store.update((db) => {
        const targetPlaylists = (Array.isArray(playlistIds) && playlistIds.length ? playlistIds : ['default'])
          .filter((id) => db.playlists[id]);
        if (!targetPlaylists.length) targetPlaylists.push('default');
        song.playlistIds = targetPlaylists;
        db.songs[songId] = song;
        for (const pid of targetPlaylists) {
          if (!db.playlists[pid].songIds.includes(songId)) db.playlists[pid].songIds.push(songId);
        }
      });

      jobs.update(job.id, { status: 'done', message: 'Listo', songId });
    } catch (err) {
      jobs.update(job.id, { status: 'error', message: err.message, error: err.message });
    }
  })();
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job no encontrado.' });
  res.json(job);
});

app.patch('/api/songs/:id', wrap(async (req, res) => {
  const { title, artist, startSeconds, aliases, playlistIds } = req.body || {};
  const result = await store.update((db) => {
    const song = db.songs[req.params.id];
    if (!song) throw game.httpError(404, 'Canción no encontrada.');
    if (title !== undefined) song.title = title;
    if (artist !== undefined) song.artist = artist;
    if (startSeconds !== undefined) {
      const s = Number(startSeconds);
      song.startSeconds = Number.isFinite(s) && s >= 0 ? Math.floor(s) : 0;
    }
    if (Array.isArray(aliases)) song.aliases = aliases.filter((a) => typeof a === 'string' && a.trim());
    if (Array.isArray(playlistIds)) {
      for (const pid of Object.keys(db.playlists)) {
        db.playlists[pid].songIds = db.playlists[pid].songIds.filter((id) => id !== song.id);
      }
      const valid = playlistIds.filter((pid) => db.playlists[pid]);
      song.playlistIds = valid.length ? valid : ['default'];
      for (const pid of song.playlistIds) db.playlists[pid].songIds.push(song.id);
    }
    return songSummary(song);
  });
  res.json(result);
}));

app.delete('/api/songs/:id', wrap(async (req, res) => {
  const id = req.params.id;
  await store.update((db) => {
    const song = db.songs[id];
    if (!song) throw game.httpError(404, 'Canción no encontrada.');
    delete db.songs[id];
    for (const pid of Object.keys(db.playlists)) {
      db.playlists[pid].songIds = db.playlists[pid].songIds.filter((sid) => sid !== id);
    }
    if (song.audioFile && fs.existsSync(song.audioFile)) fs.unlinkSync(song.audioFile);
  });
  const clipsDir = path.join(store.DATA_DIR, 'clips');
  if (fs.existsSync(clipsDir)) {
    for (const file of fs.readdirSync(clipsDir)) {
      if (file.startsWith(`${id}_`)) fs.unlinkSync(path.join(clipsDir, file));
    }
  }
  res.json({ ok: true });
}));

// ---------- Playlists ----------

app.get('/api/playlists', (req, res) => {
  const db = store.load();
  res.json(Object.values(db.playlists));
});

app.post('/api/playlists', wrap(async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Falta el nombre de la playlist.' });
  const playlist = await store.update((db) => {
    const id = store.newId('pl');
    const pl = { id, name: name.trim(), songIds: [] };
    db.playlists[id] = pl;
    return pl;
  });
  res.status(201).json(playlist);
}));

app.patch('/api/playlists/:id', wrap(async (req, res) => {
  const { name, songIds } = req.body || {};
  const result = await store.update((db) => {
    const pl = db.playlists[req.params.id];
    if (!pl) throw game.httpError(404, 'Playlist no encontrada.');
    if (name !== undefined && name.trim()) pl.name = name.trim();
    if (Array.isArray(songIds)) pl.songIds = songIds.filter((id) => db.songs[id]);
    return pl;
  });
  res.json(result);
}));

app.delete('/api/playlists/:id', wrap(async (req, res) => {
  if (req.params.id === 'default') return res.status(400).json({ error: 'No se puede borrar la playlist General.' });
  await store.update((db) => {
    if (!db.playlists[req.params.id]) throw game.httpError(404, 'Playlist no encontrada.');
    delete db.playlists[req.params.id];
    for (const song of Object.values(db.songs)) {
      song.playlistIds = (song.playlistIds || []).filter((id) => id !== req.params.id);
      if (!song.playlistIds.length) {
        song.playlistIds = ['default'];
        db.playlists.default.songIds.push(song.id);
      }
    }
  });
  res.json({ ok: true });
}));

// ---------- Settings ----------

app.get('/api/settings', (req, res) => {
  res.json(store.load().settings);
});

app.patch('/api/settings', wrap(async (req, res) => {
  const { attemptDurations, language } = req.body || {};
  const result = await store.update((db) => {
    if (Array.isArray(attemptDurations) && attemptDurations.length >= 2) {
      const cleaned = attemptDurations.map(Number).filter((n) => Number.isFinite(n) && n > 0);
      if (cleaned.length >= 2) db.settings.attemptDurations = cleaned;
    }
    if (typeof language === 'string' && language.trim()) db.settings.language = language.trim();
    return db.settings;
  });
  res.json(result);
}));

// ---------- Game ----------

app.post('/api/game/start', wrap(async (req, res) => {
  const state = await game.startGame((req.body || {}).playlistId);
  res.status(201).json(state);
}));

app.get('/api/game/:id', wrap(async (req, res) => {
  res.json(game.publicState(game.getSession(req.params.id)));
}));

app.get('/api/game/:id/clip', wrap(async (req, res) => {
  const clipFile = await game.getClip(req.params.id);
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.resolve(clipFile));
}));

app.post('/api/game/:id/guess', wrap(async (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Escribí una respuesta.' });
  res.json(await game.submitGuess(req.params.id, text.trim()));
}));

app.post('/api/game/:id/skip', wrap(async (req, res) => {
  res.json(await game.skip(req.params.id));
}));

app.post('/api/game/:id/giveup', wrap(async (req, res) => {
  res.json(await game.giveUp(req.params.id));
}));

app.get('/api/game/:id/reveal', wrap(async (req, res) => {
  res.json(game.reveal(req.params.id));
}));

// ---------- Error handling ----------

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message || 'Error interno.' });
});

app.listen(PORT, () => {
  console.log(`Primera Nota escuchando en http://localhost:${PORT}`);
});
