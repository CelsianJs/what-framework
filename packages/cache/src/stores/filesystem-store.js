// Filesystem cache store — survives restarts and is shareable by multiple
// worker processes on one box. Entries are sharded JSON files; writes are atomic
// (write to .tmp then rename). Tag/path reverse indexes are sidecar JSON lists.

import { mkdir, writeFile, readFile, rename, rm, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { hashKey } from '../key.js';

function safeName(s) {
  return createHash('sha256').update(String(s)).digest('hex');
}

export function createFilesystemStore({ dir }) {
  const entriesDir = join(dir, 'entries');
  const tagsDir = join(dir, 'tags');
  const pathsDir = join(dir, 'paths');

  const entryFile = (key) => join(entriesDir, hashKey(key) + '.json');
  const indexFile = (base, name) => join(base, safeName(name) + '.json');

  async function atomicWrite(file, contents) {
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${safeName(file).slice(0, 8)}.tmp`;
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

  async function addToIndex(base, name, key) {
    const file = indexFile(base, name);
    const list = (await readJson(file)) || [];
    if (!list.includes(key)) {
      list.push(key);
      await atomicWrite(file, JSON.stringify(list));
    }
  }

  async function removeFromIndex(base, name, key) {
    const file = indexFile(base, name);
    const list = await readJson(file);
    if (!list) return;
    const next = list.filter((k) => k !== key);
    if (next.length) await atomicWrite(file, JSON.stringify(next));
    else await rm(file, { force: true });
  }

  async function deleteByIndex(base, name) {
    const file = indexFile(base, name);
    const keys = await readJson(file);
    if (!keys) return [];
    for (const k of keys) await removeKey(k);
    await rm(file, { force: true });
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
