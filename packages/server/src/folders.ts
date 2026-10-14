import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { UserError } from './repos.ts';

export interface FolderEntry {
  name: string;
  path: string;
  isRepo: boolean;
}

export interface FolderListing {
  path: string;
  parent: string | null;
  isRepo: boolean;
  entries: FolderEntry[];
  roots: FolderEntry[];
}

const SKIP = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information']);
const MAX_ENTRIES = 2000;

/** A working tree (has .git) or a bare repository. */
function isRepo(dir: string): boolean {
  return (
    existsSync(path.join(dir, '.git')) ||
    (existsSync(path.join(dir, 'HEAD')) && existsSync(path.join(dir, 'objects')) && existsSync(path.join(dir, 'refs')))
  );
}

function roots(): FolderEntry[] {
  const home = homedir();
  const list: FolderEntry[] = [{ name: 'Home', path: home, isRepo: false }];
  if (process.platform === 'win32') {
    for (let c = 65; c <= 90; c++) {
      const drive = `${String.fromCharCode(c)}:\\`;
      if (existsSync(drive)) list.push({ name: drive, path: drive, isRepo: false });
    }
  } else {
    list.push({ name: '/', path: '/', isRepo: false });
  }
  return list;
}

/** Lists the subfolders of `dir` (default: home) for the in-app folder picker. */
export async function listFolders(dir?: string): Promise<FolderListing> {
  const target = path.resolve(dir || homedir());
  const info = await stat(target).catch(() => null);
  if (!info?.isDirectory()) throw new UserError(`Not a folder: ${target}`);

  let dirents;
  try {
    dirents = await readdir(target, { withFileTypes: true });
  } catch {
    throw new UserError(`Can't read ${target}`);
  }
  const entries = dirents
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !SKIP.has(d.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
    .slice(0, MAX_ENTRIES)
    .map((d) => {
      const p = path.join(target, d.name);
      return { name: d.name, path: p, isRepo: isRepo(p) };
    });

  const parent = path.dirname(target);
  return {
    path: target,
    parent: parent === target ? null : parent,
    isRepo: isRepo(target),
    entries,
    roots: roots(),
  };
}
