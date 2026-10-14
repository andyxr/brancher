import { describe, expect, it } from 'vitest';
import { parseMergeMessage } from '../src/infer/mergeMessage.ts';

describe('parseMergeMessage', () => {
  it.each([
    ["Merge branch 'feature/x'", ['feature/x']],
    ["Merge branch 'feature/x' into develop", ['feature/x']],
    ["Merge branch 'fix' into 'main'", ['fix']],
    ["Merge branch 'topic' of https://github.com/a/b", ['topic']],
    ["Merge remote-tracking branch 'origin/feature/y'", ['feature/y']],
    ["Merge branches 'a', 'b' and 'c'", ['a', 'b', 'c']],
    ["Merge tag 'v1.2'", ['v1.2']],
  ])('%s', (subject, names) => {
    expect(parseMergeMessage(subject)?.names).toEqual(names);
  });

  it('parses GitHub pull request merges', () => {
    expect(parseMergeMessage('Merge pull request #42 from octo/feature/login')).toEqual({
      names: ['feature/login'],
      prNumber: 42,
    });
  });

  it('parses Bitbucket and Azure merges', () => {
    expect(parseMergeMessage('Merged in bugfix/abc (pull request #3)')).toEqual({ names: ['bugfix/abc'], prNumber: 3 });
    expect(parseMergeMessage('Merged PR 17: Add thing')).toEqual({ names: [undefined], prNumber: 17 });
  });

  it('ignores ordinary commits', () => {
    expect(parseMergeMessage('Fix merge conflict handling')).toBeNull();
  });
});
