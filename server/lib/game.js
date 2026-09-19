const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const store = require('./store');
const { cutClip } = require('./audio');
const { isMatch } = require('./match');

const CLIPS_DIR = path.join(store.DATA_DIR, 'clips');
fs.mkdirSync(CLIPS_DIR, { recursive: true });

const sessions = new Map();
const RECENT_HISTORY_SIZE = 10;

function pickSong(db, playlistId) {
  const playlist = db.playlists[playlistId];
  if (!playlist) throw httpError(404, 'La playlist no existe.');
  const candidateIds = playlist.songIds.filter((id) => {
    const song = db.songs[id];
    return song && song.audioFile;
  });
  if (!candidateIds.length) {
    throw httpError(400, 'Esta playlist no tiene canciones listas todavía. Agregá alguna en la Biblioteca.');
  }
  const recent = new Set(
    db.playLog
      .filter((entry) => entry.playlistId === playlistId)
      .slice(-RECENT_HISTORY_SIZE)
      .map((entry) => entry.songId)
  );
  let pool = candidateIds.filter((id) => !recent.has(id));
  if (!pool.length) pool = candidateIds;
  const songId = pool[Math.floor(Math.random() * pool.length)];
  return db.songs[songId];
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function startGame(playlistId) {
  const db = store.load();
  const durations = db.settings.attemptDurations;
  const song = pickSong(db, playlistId || 'default');
  const id = crypto.randomBytes(8).toString('hex');
  const session = {
    id,
    playlistId: playlistId || 'default',
    songId: song.id,
    durations,
    attempt: 1,
    guesses: [],
    finished: false,
    won: false,
    startedAt: Date.now()
  };
  sessions.set(id, session);
  return publicState(session);
}

function getSession(id) {
  const session = sessions.get(id);
  if (!session) throw httpError(404, 'La partida no existe o expiró.');
  return session;
}

function publicState(session) {
  return {
    id: session.id,
    playlistId: session.playlistId,
    attempt: session.attempt,
    maxAttempts: session.durations.length,
    durations: session.durations,
    currentDuration: session.durations[Math.min(session.attempt, session.durations.length) - 1],
    guesses: session.guesses,
    finished: session.finished,
    won: session.won
  };
}

async function getClip(sessionId) {
  const session = getSession(sessionId);
  const db = store.load();
  const song = db.songs[session.songId];
  if (!song) throw httpError(404, 'La canción de esta partida ya no existe.');
  const attemptIndex = Math.min(session.attempt, session.durations.length) - 1;
  const duration = session.durations[attemptIndex];
  const start = song.startSeconds || 0;
  const clipFile = path.join(CLIPS_DIR, `${song.id}_${start}_${duration}.mp3`);
  if (!fs.existsSync(clipFile)) {
    await cutClip(song.audioFile, start, duration, clipFile);
  }
  return clipFile;
}

async function submitGuess(sessionId, text) {
  const session = getSession(sessionId);
  if (session.finished) throw httpError(400, 'La partida ya terminó.');
  const db = store.load();
  const song = db.songs[session.songId];
  const candidates = [song.title, `${song.title} ${song.artist}`, ...(song.aliases || [])];
  const correct = isMatch(text, candidates);
  session.guesses.push({ text, correct, attempt: session.attempt });
  if (correct) {
    await finish(session, true);
  } else if (session.attempt >= session.durations.length) {
    await finish(session, false);
  } else {
    session.attempt += 1;
  }
  return publicState(session);
}

async function skip(sessionId) {
  const session = getSession(sessionId);
  if (session.finished) throw httpError(400, 'La partida ya terminó.');
  session.guesses.push({ text: null, correct: false, attempt: session.attempt, skipped: true });
  if (session.attempt >= session.durations.length) {
    await finish(session, false);
  } else {
    session.attempt += 1;
  }
  return publicState(session);
}

async function giveUp(sessionId) {
  const session = getSession(sessionId);
  if (session.finished) throw httpError(400, 'La partida ya terminó.');
  await finish(session, false);
  return publicState(session);
}

async function finish(session, won) {
  session.finished = true;
  session.won = won;
  await store.update((db) => {
    db.playLog.push({
      songId: session.songId,
      playlistId: session.playlistId,
      at: new Date().toISOString(),
      won,
      attempts: session.attempt
    });
    if (db.playLog.length > 500) db.playLog = db.playLog.slice(-500);
  });
}

function reveal(sessionId) {
  const session = getSession(sessionId);
  if (!session.finished) throw httpError(400, 'Todavía no terminó la partida.');
  const db = store.load();
  const song = db.songs[session.songId];
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    sourceUrl: song.sourceUrl,
    platform: song.platform,
    thumbnail: song.thumbnail,
    won: session.won,
    attempts: session.attempt
  };
}

module.exports = { startGame, getClip, submitGuess, skip, giveUp, reveal, publicState, getSession, httpError };
