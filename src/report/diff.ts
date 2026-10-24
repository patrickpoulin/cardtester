export interface Change {
  /** 1-based line number in the original where the change starts. */
  line: number;
  removed: string[];
  added: string[];
}

/** Line-by-line differences between two texts (longest common subsequence). */
export function diffLines(before: string, after: string): Change[] {
  const a = before.split('\n');
  const b = after.split('\n');
  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..]
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const changes: Change[] = [];
  let current: Change | null = null;
  let i = 0;
  let j = 0;
  const open = () => (current ??= { line: i + 1, removed: [], added: [] });
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      if (current) changes.push(current);
      current = null;
      i++;
      j++;
    } else if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      open().added.push(b[j++]);
    } else {
      open().removed.push(a[i++]);
    }
  }
  if (current) changes.push(current);
  return changes;
}
