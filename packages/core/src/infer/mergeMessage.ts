export interface ParsedMerge {
  /** Branch names for parents[1..], in order. Entries may be undefined. */
  names: (string | undefined)[];
  prNumber?: number;
}

const quoted = /'([^']+)'/g;

function stripRemote(name: string): string {
  // `origin/feature/x` -> `feature/x`. Only the first segment is treated as a remote.
  const m = name.match(/^(?:origin|upstream)\/(.+)$/);
  return m ? m[1] : name;
}

/**
 * Extracts the merged branch name(s) from a merge commit subject. Handles the
 * formats written by git, GitHub, GitLab, Bitbucket and Azure DevOps.
 */
export function parseMergeMessage(subject: string): ParsedMerge | null {
  let m: RegExpMatchArray | null;

  // GitHub: "Merge pull request #12 from owner/feature/x"
  if ((m = subject.match(/^Merge pull request #(\d+) from ([^/\s]+)\/(\S+)/))) {
    return { names: [m[3]], prNumber: Number(m[1]) };
  }
  // Bitbucket: "Merged in feature/x (pull request #3)"
  if ((m = subject.match(/^Merged in (\S+)(?: \(pull request #(\d+)\))?/))) {
    return { names: [m[1]], prNumber: m[2] ? Number(m[2]) : undefined };
  }
  // Azure DevOps: "Merged PR 12: title" (no branch name available)
  if ((m = subject.match(/^Merged PR (\d+):/))) {
    return { names: [undefined], prNumber: Number(m[1]) };
  }
  // git / GitLab: "Merge branch 'x' [of url] [into 'y']", "Merge branches 'a', 'b' and 'c'",
  // "Merge remote-tracking branch 'origin/x'", "Merge remote-tracking branches ...", "Merge tag 'v1'"
  if ((m = subject.match(/^Merge (?:remote-tracking )?(branch|branches|tag) (.+)$/))) {
    let body = m[2];
    // Drop the "into 'target'" tail so we don't treat the target as a merged branch.
    body = body.replace(/\s+into\s+'?[^']+'?\s*$/, '');
    body = body.replace(/\s+of\s+\S+$/, '');
    const names = [...body.matchAll(quoted)].map((q) => stripRemote(q[1]));
    if (names.length) return { names };
  }
  return null;
}
