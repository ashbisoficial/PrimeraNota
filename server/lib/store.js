const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const DB_FILE = path.join(DATA_DIR, 'library.json');

const DEFAULT_DB = {
  settings: {
    attemptDurations: [1, 2, 4, 7, 11, 16],
    language: 'es'
  },
  songs: {},
  playlists: {
    default: { id: 'default', name: 'General', songIds: [] }
  },
  playLog: []
};

for (const dir of [DATA_DIR, AUDIO_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

function load() {
  if (!fs.existsSync(DB_FILE)) {
    save(DEFAULT_DB);
    return structuredClone(DEFAULT_DB);
  }
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  return {
    settings: { ...DEFAULT_DB.settings, ...parsed.settings },
    songs: parsed.songs || {},
    playlists: parsed.playlists && Object.keys(parsed.playlists).length
      ? parsed.playlists
      : structuredClone(DEFAULT_DB.playlists),
    playLog: parsed.playLog || []
  };
}

function save(db) {
  const tmpFile = DB_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2));
  fs.renameSync(tmpFile, DB_FILE);
}

// Serializes read-modify-write cycles so concurrent requests can't clobber each other.
let writeChain = Promise.resolve();
function update(mutator) {
  writeChain = writeChain.then(async () => {
    const db = load();
    const result = await mutator(db);
    save(db);
    return result;
  });
  return writeChain;
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

module.exports = { load, save, update, newId, DATA_DIR, AUDIO_DIR, DB_FILE };
