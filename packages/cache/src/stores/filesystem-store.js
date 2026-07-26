// Filesystem cache store — survives restarts and is shareable by multiple
// worker processes on one box. Entries are sharded JSON files; writes are atomic
// (write to .tmp then rename). Tag/path reverse indexes are sidecar JSON lists.

import { mkdir, writeFile, readFile, rename, rm, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { hashKey } from '../key.js';

function safeName(s) {
  return createHash('sha256').update(String(s)).digest('hex');
}

export function createFilesystemStore({ dir }) {
  const entriesDir = join(dir, 'entries');
  const tagsDir = join(dir, 'tags');
  const pathsDir = join(dir, 'paths');

  const entryFile = (key) => join(entriesDir, hashKey(key) + '.json');
  const indexDir = (base, name) => join(base, safeName(name));
  const indexFile = (base, name, key) => join(indexDir(base, name), safeName(key) + '.json');
  // v0.11.7 and earlier wrote one JSON array per tag/path instead of a
  // directory. Left unread, an in-place upgrade would silently orphan every
  // pre-upgrade entry: revalidatePath would return [] while the webhook still
  // reported success, and the entries would keep being served from disk.
  const legacyIndexFile = (base, name) => join(base, safeName(name) + '.json');

  async function atomicWrite(file, contents) {
    await mkdir(dirname(file), { recursive: true });
    // The temp name must be unique per write: two workers (or two concurrent
    // writes in one process) targeting the same file would otherwise clobber
    // each other's partial temp file before the rename.
    const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(tmp, contents);
    await rename(tmp, file);
  }

  async function readJson(file) {
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      return null;
    }
  }

  // Reverse indexes are append-only directories with one file per key, not a
  // shared JSON list: a read-modify-write of one list loses entries whenever two
  // workers index different variants of the same path concurrently, orphaning an
  // entry that revalidatePath would then never find.
  async function addToIndex(base, name, key) {
    await atomicWrite(indexFile(base, name, key), JSON.stringify(key));
  }

  async function removeFromIndex(base, name, key) {
    await rm(indexFile(base, name, key), { force: true });
    const legacy = await readLegacyIndex(base, name);
    if (!legacy) return;
    const next = legacy.filter((k) => k !== key);
    if (next.length === legacy.length) return;
    if (next.length) await atomicWrite(legacyIndexFile(base, name), JSON.stringify(next));
    else await rm(legacyIndexFile(base, name), { force: true });
  }

  async function readLegacyIndex(base, name) {
    const list = await readJson(legacyIndexFile(base, name));
    return Array.isArray(list) ? list.filter((k) => typeof k === 'string') : null;
  }

  async function readIndex(base, name) {
    const keys = new Set(await readLegacyIndex(base, name) || []);
    const dirPath = indexDir(base, name);
    let files;
    try { files = await readdir(dirPath); } catch { return [...keys]; }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const k = await readJson(join(dirPath, f));
      if (typeof k === 'string') keys.add(k);
    }
    return [...keys];
  }

  async function deleteByIndex(base, name) {
    const keys = await readIndex(base, name);
    for (const k of keys) await removeKey(k);
    await rm(indexDir(base, name), { recursive: true, force: true });
    await rm(legacyIndexFile(base, name), { force: true });
    return keys;
  }

  async function removeKey(key) {
    const record = await readJson(entryFile(key));
    if (!record) return false;
    await rm(entryFile(key), { force: true });
    const entry = record.entry || {};
    for (const t of entry.tags || []) await removeFromIndex(tagsDir, t, key);
    if (entry.path) await removeFromIndex(pathsDir, entry.path, key);
    return true;
  }

  async function walkKeys() {
    const out = [];
    let shards;
    try { shards = await readdir(entriesDir); } catch { return out; }
    for (const a of shards) {
      const aDir = join(entriesDir, a);
      let st; try { st = await stat(aDir); } catch { continue; }
      if (!st.isDirectory()) continue;
      for (const b of await readdir(aDir)) {
        const bDir = join(aDir, b);
        try { if (!(await stat(bDir)).isDirectory()) continue; } catch { continue; }
        for (const f of await readdir(bDir)) {
          if (!f.endsWith('.json')) continue;
          const rec = await readJson(join(bDir, f));
          if (rec && rec.key != null) out.push(rec.key);
        }
      }
    }
    return out;
  }

  return {
    async get(key) {
      const rec = await readJson(entryFile(key));
      return rec ? rec.entry : null;
    },
    async set(key, entry) {
      // de-index any previous version's tags/path first
      const prev = await readJson(entryFile(key));
      if (prev && prev.entry) {
        for (const t of prev.entry.tags || []) await removeFromIndex(tagsDir, t, key);
        if (prev.entry.path) await removeFromIndex(pathsDir, prev.entry.path, key);
      }
      await atomicWrite(entryFile(key), JSON.stringify({ key, entry }));
      for (const t of entry.tags || []) await addToIndex(tagsDir, t, key);
      if (entry.path) await addToIndex(pathsDir, entry.path, key);
    },
    async delete(key) {
      return removeKey(key);
    },
    async deleteByTag(tag) {
      return deleteByIndex(tagsDir, tag);
    },
    async deleteByPath(path) {
      return deleteByIndex(pathsDir, path);
    },
    async clear() {
      await rm(dir, { recursive: true, force: true });
    },
    async keys() {
      return walkKeys();
    },
  };
}
