const crypto = require('crypto');

const jobs = new Map();

function create() {
  const id = crypto.randomBytes(6).toString('hex');
  const job = { id, status: 'pending', message: 'En cola...', songId: null, error: null, createdAt: Date.now() };
  jobs.set(id, job);
  return job;
}

function update(id, patch) {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, patch);
  return job;
}

function get(id) {
  return jobs.get(id) || null;
}

// Avoid unbounded growth: drop finished jobs older than 1 hour.
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff && (job.status === 'done' || job.status === 'error')) {
      jobs.delete(id);
    }
  }
}, 10 * 60 * 1000).unref();

module.exports = { create, update, get };
