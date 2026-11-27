# Fragen

Kleine PWA mit Gesprächsfragen für Christian: durchwischen, nach Kategorien filtern, Fragen für bestimmte Menschen vormerken („Vorrat“) und abhaken, wem man welche Frage schon gestellt hat. Läuft als statische Seite auf GitHub Pages (`.nojekyll`, kein Build-Schritt auf GitHub), Design aus „Marla sucht Job“ (Zine-Look).

## Vertraulichkeit – wichtig

- **Die Fragen sind teils gekauft** (Convovi-Guide, Kartenset „100 Fragen“). Im Repo liegen sie deshalb nur verschlüsselt (`data/fragen.enc`). Klartext liegt ausschließlich lokal in `fragen/` und ist per `.gitignore` ausgeschlossen. Nie committen: `fragen/`, `_input/`, `.passwort`.
- **Personen stehen nie im Repo.** Christian legt sie in der App an, sie leben nur im `localStorage` des Geräts.

## Aufbau

- `fragen/NN-kategorie.md` – eine Kategorie pro Datei. Frontmatter: `titel`, `beschreibung`, `reihenfolge`. Jeder Listenpunkt ist eine Frage. Die Kategorie-ID ist der Dateiname ohne Nummer.
- `scripts/build.mjs` – vergibt IDs, verschlüsselt alles nach `data/fragen.enc` (PBKDF2 + AES-GCM, Passwort aus `.passwort`).
- `app/main.js` (UI), `app/store.js` (localStorage, Export/Import), `app/crypto.js` (Entschlüsseln im Browser).
- `sw.js` – Service Worker, network first, offline aus dem Cache. Neue Dateien in `FILES` eintragen.

## Neue Fragen einpflegen

Wenn Christian Fragen diktiert:

1. Formulierung behutsam glätten (Rechtschreibung, Fragezeichen), Sinn und Ton lassen. **Anrede immer „du“.** Ausnahme: In `12-toechter.md` (Fragen an beide Töchter zusammen) ist „ihr“ richtig.
2. Der passenden Kategorie zuordnen und als Listenpunkt **ohne** `{…}` ans Ende der Datei schreiben. Passt keine: nachfragen oder eine neue Datei vorschlagen (nächste freie Nummer, Frontmatter wie die anderen).
3. Dubletten und sehr ähnliche Fragen nicht aufnehmen, sondern melden.
4. `node scripts/build.mjs` ausführen. Das hängt an jede neue Frage `{id datum}` an. Das Datum steuert den Filter „Neu“ (30 Tage).
5. **IDs nie ändern oder wiederverwenden.** Vorrat und Häkchen auf dem Handy hängen an der ID. Eine Frage umformulieren ist okay, die ID bleibt.
6. Frage löschen nur nach Rückfrage (Häkchen dazu werden in der App unsichtbar).
7. Committen und pushen nur `data/fragen.enc` (plus ggf. Code), nach Freigabe.

Rückfragen an Christian immer einzeln stellen, nie mehrere auf einmal.

## Export abgleichen

Christian schickt ab und zu eine `fragen-export-*.json` (aus „Mehr → Exportieren“). Sie enthält unter `personen` lesbar pro Person den Vorrat und die gestellten Fragen (mit Text und Datum) und unter `daten` den Rohzustand für den Import. Typische Aufgaben: zusammenfassen, wem was schon gestellt wurde, passende nächste Fragen vorschlagen, Lücken in Kategorien zeigen. Den Export nicht ins Repo legen (enthält Namen).

**Favoriten:** Unter `favoriten` stehen die Fragen, die Christian mit ♥ markiert hat. Sie zeigen seinen Geschmack: Beim Vorschlagen neuer Fragen daran orientieren. Die Reihenfolge der Fragen bleibt trotzdem fest (kein Ranking).

**Aussortierte Fragen:** Unter `aussortiert` stehen Fragen, die Christian in der App rausgeworfen hat (mit ID und Text). Diese Zeilen aus `fragen/*.md` löschen (per ID suchen), neu bauen und kurz auflisten, was gelöscht wurde. Die ID danach nicht wiederverwenden. In der App bleiben die Einträge im Speicher, das stört nicht: Die Frage existiert dann einfach nicht mehr.

## Testen

Lokal: `python3 -m http.server 8765` und `http://127.0.0.1:8765` öffnen (WebCrypto braucht localhost oder https).
