#!/usr/bin/env node
// Builds data/fragen.enc from the plaintext questions in fragen/*.md.
//
//   node scripts/build.mjs           new questions get today's date (filter "Neu")
//   node scripts/build.mjs --basis   new questions get no date (initial import)
//
// Every list item gets a stable ID on first build, written back into the file:
//   - Wofür hättest du heute gerne mehr Zeit gehabt? {k3f9}
//   - Eine neu diktierte Frage? {x7q2 2026-11-20}
// The ID keeps "Vorrat" and "gestellt" on the phone attached to the question,
// even if the wording changes later. Never reuse or change an ID.
//
// Password: file .passwort (first line) or env FRAGEN_PASSWORT. Both stay local.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto as crypto } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'fragen');
const OUT = join(ROOT, 'data', 'fragen.enc');
const ITERATIONS = 310000;
const today = new Date().toISOString().slice(0, 10);
const basis = process.argv.includes('--basis');

const ITEM = /^- (.+?)(?:\s+\{([a-z0-9]+)(?:\s+(\d{4}-\d{2}-\d{2}))?\})?\s*$/;

function password() {
  if (process.env.FRAGEN_PASSWORT) return process.env.FRAGEN_PASSWORT.trim();
  const file = join(ROOT, '.passwort');
  if (existsSync(file)) return readFileSync(file, 'utf8').split('\n')[0].trim();
  throw new Error('Kein Passwort: .passwort anlegen oder FRAGEN_PASSWORT setzen.');
}

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].trim();
  }
  return { meta, body: text.slice(match[0].length) };
}

function newId(used) {
  let id;
  do id = Math.random().toString(36).slice(2, 6); while (id.length < 4 || used.has(id));
  used.add(id);
  return id;
}

const files = readdirSync(SRC).filter((f) => f.endsWith('.md')).sort();
const used = new Set();
const parsed = files.map((file) => {
  const text = readFileSync(join(SRC, file), 'utf8');
  for (const m of text.matchAll(/\{([a-z0-9]+)(?:\s+\d{4}-\d{2}-\d{2})?\}\s*$/gm)) {
    if (used.has(m[1])) throw new Error(`ID ${m[1]} kommt doppelt vor (${file}).`);
    used.add(m[1]);
  }
  return { file, text, ...parseFrontmatter(text) };
});

const categories = [];
const questions = [];
let added = 0;

for (const { file, text, meta } of parsed) {
  const id = file.replace(/\.md$/, '').replace(/^\d+-/, '');
  categories.push({ id, titel: meta.titel || id, beschreibung: meta.beschreibung || '', reihenfolge: Number(meta.reihenfolge) || 99 });

  let changed = false;
  const lines = text.split('\n').map((line) => {
    const m = line.match(ITEM);
    if (!m) return line;
    let [, q, qid, date] = m;
    if (!qid) {
      qid = newId(used);
      if (!basis) date = today;
      changed = true;
      added++;
    }
    questions.push({ id: qid, cat: id, text: q.trim(), ...(date && { added: date }) });
    return `- ${q.trim()} {${qid}${date ? ` ${date}` : ''}}`;
  });
  if (changed) writeFileSync(join(SRC, file), lines.join('\n'));
}

categories.sort((a, b) => a.reihenfolge - b.reihenfolge);
const order = new Map(categories.map((c, i) => [c.id, i]));
questions.sort((a, b) => order.get(a.cat) - order.get(b.cat)); // stable: file order within a category

const payload = JSON.stringify({ built: new Date().toISOString(), categories, questions });

const enc = new TextEncoder();
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const baseKey = await crypto.subtle.importKey('raw', enc.encode(password()), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
  baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt'],
);
const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(payload)));
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ v: 1, iter: ITERATIONS, salt: b64(salt), iv: b64(iv), ct: b64(ct) }) + '\n');

console.log(`${questions.length} Fragen in ${categories.length} Kategorien verschlüsselt → data/fragen.enc`);
if (added) console.log(`${added} neue Frage(n) mit ID versehen${basis ? '' : ` (Datum ${today}, Filter „Neu“)`}.`);
