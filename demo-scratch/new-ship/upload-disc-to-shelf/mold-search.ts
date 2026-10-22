const normalize = (value: string) => value.toLocaleLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, ' ');

function editDistance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + Number(a[i - 1] !== b[j - 1]));
      diagonal = above;
    }
  }
  return row[b.length];
}

function tokenScore(token: string, text: string, words: string[]) {
  if (text === token) return 0;
  const at = text.indexOf(token); if (at >= 0) return 1 + at / 100;
  if (token.length < 3) return Infinity;
  let best = Infinity;
  for (const word of words) {
    const distance = editDistance(token, word);
    const allowance = token.length >= 4 ? 2 : 1;
    if (distance <= allowance) best = Math.min(best, 10 + distance + Math.abs(token.length - word.length) / 10);
  }
  return best;
}

/** Exact/prefix/substring matches lead; small spelling errors remain discoverable. */
export function fuzzyMoldOptions<T>(collection: readonly T[], query: string, label: (row: T) => string, limit = 12): T[] {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  return collection.map((row, index) => {
    const text = normalize(label(row)), words = text.split(' ');
    const scores = tokens.map(token => tokenScore(token, text, words));
    return { row, index, score: scores.reduce((sum, score) => sum + score, 0), matches: scores.every(Number.isFinite) };
  }).filter(result => result.matches).sort((a, b) => a.score - b.score || a.index - b.index).slice(0, limit).map(result => result.row);
}
