function normalize(text) {
  return (text || '')
    .toString()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/\(.*?\)|\[.*?\]/g, ' ') // drop parenthetical/bracket content (remix, feat, etc.)
    .replace(/feat\.?.*$/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

function similarity(a, b) {
  if (!a.length && !b.length) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

// Returns true if `guess` is an acceptable match for any of `candidates`
// (title, artist, aliases, "title artist" combos already normalized by caller).
function isMatch(guess, candidates, threshold = 0.82) {
  const g = normalize(guess);
  if (!g) return false;
  for (const raw of candidates) {
    const c = normalize(raw);
    if (!c) continue;
    if (g === c) return true;
    if (c.length > 3 && (c.includes(g) || g.includes(c)) && Math.min(g.length, c.length) >= 3) return true;
    if (similarity(g, c) >= threshold) return true;
  }
  return false;
}

module.exports = { normalize, similarity, isMatch };
