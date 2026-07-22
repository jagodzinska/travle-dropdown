// ==UserScript==
// @name         Travle Stern-Dropdown
// @namespace    https://github.com/jagodzinska/travle-dropdown
// @version      1.0.0
// @description  Stern (*) ins Suchfeld von Travle Weekly (travle.earth/challenge) tippen zeigt alle ratbaren Länder/Gebiete als Dropdown. Auswahl füllt das Suchfeld wie ein Original-Vorschlag; der Rateversuch wird wie gewohnt mit dem Guess-Button/Enter bestätigt (änderbar über AUTO_GUESS).
// @author       jago/claude
// @license      MIT
// @match        https://travle.earth/*
// @icon         https://travle.earth/icons/favicon.ico
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  if (window.top !== window.self) return; // nicht in Ad-iframes laufen

  const LIST_ID = 'travle-star-dropdown';

  // true: Auswahl im Dropdown löst sofort den Rateversuch aus (wie beim
  // Geodle-Skript). false: Auswahl füllt nur das Suchfeld – so verhält sich
  // auch das Original-Dropdown von Travle; bestätigt wird mit Button/Enter.
  const AUTO_GUESS = false;

  // Gilt für die Weekly Challenge und deren Archiv-Seiten. Beide nutzen den
  // Datensatz "challenge" (/data/challenge/, /locales/challenge/).
  const isWeekly = () => /^\/challenge\/?$/.test(location.pathname);
  const isArchive = () => /^\/archive\/challenge(\/|$)/.test(location.pathname);
  const onChallengePage = () => isWeekly() || isArchive();

  // Sprache setzt die Seite selbst als Cookie (siehe Sprachwahl im Menü)
  const lang = () =>
    (document.cookie.match(/(?:^|;\s*)lang=([a-zA-Z-]+)/)?.[1] || 'en').toLowerCase();

  // ---- Ratbare Gebiete + Namen von der Seite selbst laden ----------
  // Die IDs kommen aus /data/challenge/regions.json (dieselbe Datei, die die
  // Seite für Karte und Suchfeld lädt): "ZWE#1" -> Code "ZWE". Die Namen
  // stehen in /locales/challenge/<lang>.json unter "regions" (en als
  // Fallback, nicht jede Sprache übersetzt alle Gebiete). Dadurch muss hier
  // nichts hartkodiert werden und neue Gebiete erscheinen automatisch.
  let cache = null;
  let cacheLang = null;

  function loadEntries() {
    const l = lang();
    if (cache && cacheLang === l) return cache;
    cacheLang = l;
    cache = (async () => {
      const codes = await fetch('/data/challenge/regions.json')
        .then((r) => r.json())
        .then((t) => [
          ...new Set(
            t.objects.regions.geometries.map((g) => g.properties.ID.split('#')[0]),
          ),
        ]);
      const en = await fetch('/locales/challenge/en.json')
        .then((r) => (r.ok ? r.json() : {}))
        .then((j) => j.regions || {});
      let loc = {};
      if (l !== 'en') {
        try {
          loc = await fetch(`/locales/challenge/${l}.json`)
            .then((r) => (r.ok ? r.json() : {}))
            .then((j) => j.regions || {});
        } catch {}
      }
      return codes
        .map((code) => ({ code, name: loc[code] || en[code] || code }))
        .sort((a, b) => a.name.localeCompare(b.name, l));
    })();
    cache.catch(() => {
      cache = null; // bei Netzfehler beim nächsten Stern erneut versuchen
    });
    return cache;
  }

  // ---- Bereits geratene Gebiete aus dem localStorage ---------------
  // Die Seite speichert den Spielstand unter travle_challenge-game-state
  // (Archiv: -A-) und legt darin pastGuessIds mit den Codes ab.
  function guessedCodes() {
    const key = isArchive()
      ? 'travle_challenge-A-game-state'
      : 'travle_challenge-game-state';
    try {
      const st = JSON.parse(localStorage.getItem(key));
      if (Array.isArray(st?.pastGuessIds)) return new Set(st.pastGuessIds);
    } catch {}
    return new Set();
  }

  // ---- Auswahl einlösen --------------------------------------------
  // Svelte (bind:value) übernimmt den Wert über den nativen Setter plus
  // input-Event; danach kennt die Seite den exakten Namen genau so, als
  // wäre er über ihr eigenes Vorschlags-Dropdown eingesetzt worden.
  const nativeSetValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  ).set;

  function typeInto(input, text) {
    nativeSetValue.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ---- Eigenes Dropdown ---------------------------------------------
  // Optik: Klassen des Original-Dropdowns (div.guess-select) werden vom
  // lebenden Element kopiert, inklusive Svelte-Scope-Klasse. So sieht die
  // Liste exakt aus wie die der Seite und übersteht Build-Updates, solange
  // sich die Struktur nicht ändert.
  const close = () => document.getElementById(LIST_ID)?.remove();

  async function open(input) {
    const wrap = input.parentElement; // div.flex.items-center.relative
    const siteList = wrap?.querySelector('.guess-select:not(#' + LIST_ID + ')');
    if (!siteList) return;

    let entries;
    try {
      entries = await loadEntries();
    } catch {
      return;
    }
    // Während des Ladens weitergetippt oder gelöscht? Dann nicht öffnen.
    if (input.value.trim() !== '*' || !document.contains(input)) return;
    close();

    const guessed = guessedCodes();
    const scope =
      [...siteList.classList].find((c) => c.startsWith('svelte-')) || '';

    const box = document.createElement('div');
    box.id = LIST_ID;
    box.className = siteList.className;
    box.style.display = 'block';

    for (const { code, name } of entries) {
      if (guessed.has(code)) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      if (scope) btn.className = scope;
      btn.textContent = name;
      // Fokus im Input lassen (sonst klappt auf Mobilgeräten die Tastatur zu)
      btn.addEventListener('pointerdown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        close();
        typeInto(input, name);
        if (AUTO_GUESS) {
          const submit = input.nextElementSibling; // Guess-Button der Seite
          if (submit instanceof HTMLButtonElement) {
            setTimeout(() => submit.click(), 0);
          }
        }
      });
      box.appendChild(btn);
    }
    wrap.appendChild(box);
  }

  // ---- Ereignisse ---------------------------------------------------
  // Das Suchfeld ist das Textfeld, neben dem die Seite ihr eigenes
  // Vorschlags-Dropdown (div.guess-select) rendert; Erkennung darüber,
  // damit z. B. die Spielesuche auf der Startseite nicht reagiert.
  function isTravleInput(t) {
    return (
      t instanceof HTMLInputElement &&
      t.type === 'text' &&
      onChallengePage() &&
      !!t.parentElement?.querySelector('.guess-select')
    );
  }

  document.addEventListener(
    'input',
    (e) => {
      if (!isTravleInput(e.target)) return;
      if (e.target.value.trim() === '*') open(e.target);
      else close();
    },
    true,
  );

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape') close();
    },
    true,
  );

  // Klick außerhalb von Dropdown und Suchfeld schließt die Liste
  document.addEventListener(
    'pointerdown',
    (e) => {
      const box = document.getElementById(LIST_ID);
      if (!box) return;
      if (box.contains(e.target) || isTravleInput(e.target)) return;
      close();
    },
    true,
  );
})();
