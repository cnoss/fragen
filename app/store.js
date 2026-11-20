// Everything personal lives here, in localStorage only: people, "Vorrat", "gestellt".
//
//   people: [{ id, name }]
//   vorrat: { personId: { questionId: 'YYYY-MM-DD' } }   noted as a good question for them
//   asked:  { personId: { questionId: 'YYYY-MM-DD' } }   asked on that day

const KEY = 'fragen:data:v1';

function empty() {
  return { people: [], vorrat: {}, asked: {} };
}

let data = load();

function load() {
  try {
    return { ...empty(), ...JSON.parse(localStorage.getItem(KEY)) };
  } catch {
    return empty();
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD, local time

// People ---------------------------------------------------------------------

export function people() {
  return [...data.people].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

export function person(id) {
  return data.people.find((p) => p.id === id) || null;
}

export function addPerson(name) {
  const id = Math.random().toString(36).slice(2, 8);
  data.people.push({ id, name: name.trim() });
  save();
  return id;
}

export function renamePerson(id, name) {
  const p = person(id);
  if (p) p.name = name.trim();
  save();
}

export function removePerson(id) {
  data.people = data.people.filter((p) => p.id !== id);
  delete data.vorrat[id];
  delete data.asked[id];
  save();
}

// Vorrat and asked -------------------------------------------------------------

function toggle(map, personId, questionId) {
  const entries = (map[personId] ||= {});
  if (entries[questionId]) delete entries[questionId];
  else entries[questionId] = today();
  save();
  return !!entries[questionId];
}

export const inVorrat = (personId, questionId) => !!data.vorrat[personId]?.[questionId];
export const askedOn = (personId, questionId) => data.asked[personId]?.[questionId] || null;
export const toggleVorrat = (personId, questionId) => toggle(data.vorrat, personId, questionId);
export const toggleAsked = (personId, questionId) => toggle(data.asked, personId, questionId);

/** { questionId: date } for one person. */
export const vorratOf = (personId) => ({ ...data.vorrat[personId] });
export const askedOf = (personId) => ({ ...data.asked[personId] });

// Export and import ----------------------------------------------------------

/** Machine part for re-import, plus a readable part per person (question texts included). */
export function exportData(questions) {
  const text = new Map(questions.map((q) => [q.id, q.text]));
  const readable = {};
  for (const p of people()) {
    const vorrat = Object.entries(vorratOf(p.id))
      .filter(([qid]) => !askedOn(p.id, qid))
      .map(([qid, date]) => ({ id: qid, frage: text.get(qid) || '(gelöschte Frage)', seit: date }));
    const gestellt = Object.entries(askedOf(p.id))
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([qid, date]) => ({ id: qid, frage: text.get(qid) || '(gelöschte Frage)', am: date }));
    readable[p.name] = { vorrat, gestellt };
  }
  return {
    app: 'fragen',
    version: 1,
    exportiert: new Date().toISOString(),
    personen: readable,
    daten: data,
  };
}

/** Merges an export into the local data. Local entries win; nothing gets deleted. */
export function importData(json) {
  const incoming = json?.daten;
  if (json?.app !== 'fragen' || !incoming || !Array.isArray(incoming.people)) {
    throw new Error('Das ist keine Export-Datei dieser App.');
  }
  let newPeople = 0;
  let entries = 0;
  for (const p of incoming.people) {
    if (!person(p.id)) {
      data.people.push({ id: p.id, name: p.name });
      newPeople++;
    }
  }
  for (const field of ['vorrat', 'asked']) {
    for (const [pid, map] of Object.entries(incoming[field] || {})) {
      const local = (data[field][pid] ||= {});
      for (const [qid, date] of Object.entries(map)) {
        if (!local[qid]) {
          local[qid] = date;
          entries++;
        }
      }
    }
  }
  save();
  return { newPeople, entries };
}

// Small preferences (filter, position, password) ------------------------------

export function getPref(name, fallback) {
  try {
    const value = localStorage.getItem(`fragen:pref:${name}`);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function setPref(name, value) {
  try {
    if (value === undefined) localStorage.removeItem(`fragen:pref:${name}`);
    else localStorage.setItem(`fragen:pref:${name}`, JSON.stringify(value));
  } catch {
    // Preferences are optional.
  }
}
