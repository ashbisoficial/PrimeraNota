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

async function probeDuration(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file
  ]);
  const seconds = parseFloat(stdout.trim());
  return Number.isFinite(seconds) ? seconds : 0;
}

// Cuts [startSeconds, startSeconds+durationSeconds) from srcFile into destFile (mp3).
async function cutClip(srcFile, startSeconds, durationSeconds, destFile) {
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  await run('ffmpeg', [
    '-y',
    '-ss', String(Math.max(0, startSeconds)),
    '-t', String(durationSeconds),
    '-i', srcFile,
    '-vn',
    '-acodec', 'libmp3lame',
    '-q:a', '4',
    destFile
  ]);
  return destFile;
}

module.exports = { probeDuration, cutClip };
