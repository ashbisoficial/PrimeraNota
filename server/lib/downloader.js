const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(`No se encontró el ejecutable "${cmd}". Instalalo antes de continuar.`));
      } else {
        reject(err);
      }
    });
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} salió con código ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

function detectPlatform(url) {
  const u = url.toLowerCase();
  if (u.includes('tiktok.com')) return 'tiktok';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  return 'other';
}

async function fetchMetadata(url) {
  const { stdout } = await run('yt-dlp', ['-J', '--no-playlist', '--no-warnings', url]);
  const info = JSON.parse(stdout);
  return {
    title: info.track || info.title || 'Desconocido',
    artist: info.artist || info.uploader || info.channel || '',
    thumbnail: info.thumbnail || (Array.isArray(info.thumbnails) && info.thumbnails.length
      ? info.thumbnails[info.thumbnails.length - 1].url
      : null),
    durationSeconds: Math.round(info.duration || 0),
    platform: detectPlatform(url)
  };
}

// Downloads best audio and extracts it as mp3 at destPathNoExt + ".mp3"
async function downloadAudio(url, destPathNoExt) {
  fs.mkdirSync(path.dirname(destPathNoExt), { recursive: true });
  const outputTemplate = `${destPathNoExt}.%(ext)s`;
  await run('yt-dlp', [
    '--no-playlist',
    '--no-warnings',
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '5',
    '-o', outputTemplate,
    url
  ]);
  const finalFile = `${destPathNoExt}.mp3`;
  if (!fs.existsSync(finalFile)) {
    throw new Error('yt-dlp terminó pero no se generó el archivo mp3 esperado.');
  }
  return finalFile;
}

module.exports = { fetchMetadata, downloadAudio, detectPlatform };
