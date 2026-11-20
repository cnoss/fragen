# Fragen

Gesprächsfragen zum Durchwischen auf dem Smartphone – für bessere Gespräche mit den eigenen Leuten und beim Kennenlernen.
Progressive Web App: auf den Home-Bildschirm legen, läuft dann auch offline.

- Fragen nach Kategorien filtern, immer in derselben Reihenfolge, Filter „Neu“ für Fragen der letzten 30 Tage
- Personen anlegen, Fragen für sie vormerken („Vorrat“) und abhaken, wenn sie gestellt sind (mit Datum)
- Export als JSON-Datei über das Teilen-Menü (z. B. per Mail an sich selbst), Import ergänzt

Personen und Häkchen liegen nur im Speicher des Geräts. Die Fragen liegen im Repo nur verschlüsselt (`data/fragen.enc`), beim ersten Start fragt die App einmal nach dem Passwort.

## Fragen ändern

Die Klartext-Fragen liegen lokal in `fragen/` (nicht im Repo). Nach jeder Änderung:

```sh
node scripts/build.mjs
```

Das Skript braucht das Passwort in `.passwort` (erste Zeile, nicht im Repo) oder in `FRAGEN_PASSWORT`. Danach `data/fragen.enc` committen und pushen.

Passwort ändern: neues Passwort in `.passwort` schreiben, bauen, pushen. Die App merkt das beim nächsten Start und fragt nach dem neuen Passwort.

## Einrichten

Einmalig im Repo unter *Settings → Pages*: Source „Deploy from a branch“, Branch `main`, Ordner `/ (root)`.
