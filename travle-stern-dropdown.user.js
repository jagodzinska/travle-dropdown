// ==UserScript==
// @name         Travle Stern-Dropdown
// @namespace    https://github.com/jagodzinska/travle-dropdown
// @version      1.1.1
// @description  Stern (*) ins Suchfeld von Travle Weekly (travle.earth/challenge) tippen zeigt alle ratbaren Gebiete der aktuellen Challenge als Dropdown (Länder, Meere, ... je nach Woche). Auswahl füllt das Suchfeld wie ein Original-Vorschlag; der Rateversuch wird wie gewohnt mit dem Guess-Button/Enter bestätigt (änderbar über AUTO_GUESS).
// @author       jago/claude
// @license      MIT
// @homepageURL  https://github.com/jagodzinska/travle-dropdown
// @supportURL   https://github.com/jagodzinska/travle-dropdown/issues
// @downloadURL  https://raw.githubusercontent.com/jagodzinska/travle-dropdown/main/travle-stern-dropdown.user.js
// @updateURL    https://raw.githubusercontent.com/jagodzinska/travle-dropdown/main/travle-stern-dropdown.user.js
// @match        https://travle.earth/*
// @icon         https://travle.earth/icons/favicon.ico
// @run-at       document-start
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

  // ---- Aktiven Datensatz der Challenge mitlesen --------------------
  // Jede Weekly-Challenge definiert ihren eigenen Datensatz (geojson/graph),
  // z. B. regions.json (Länder), seas_regions.json (Meere/Ozeane) oder
  // coastal_regions.json. Welcher gerade gilt, steht nur im Spielcode der
  // Seite. Deshalb wird fetch() gehookt (@run-at document-start, läuft vor
  // dem App-Code) und die zuletzt geladene Topologie-Datei unter
  // /data/challenge/ ausgewertet – daraus ergibt sich exakt die ratbare
  // Gebietsmenge der aktuellen Challenge, ohne die Wochenlogik der Seite
  // nachbauen zu müssen. (Grenzfall: Wer per SPA-Navigation zwischen Weekly
  // und Challenge-Archiv wechselt, ohne dass die Seite neu lädt, bekommt den
  // zuletzt geladenen Datensatz; ein Reload der Seite behebt das.)
  let capturedCodes = null; // Codes der zuletzt geladenen Challenge-Topologie
  let capturedFile = null;

  function topologyCodes(json) {
    const obj = json && json.type === 'Topology' && json.objects;
    const first = obj && Object.values(obj)[0];
    if (!first || !Array.isArray(first.geometries)) return null;
    const codes = [
      ...new Set(
        first.geometries
          .map((g) => g?.properties?.ID)
          .filter((id) => typeof id === 'string')
          .map((id) => id.split('#')[0]),
      ),
    ];
    return codes.length ? codes : null;
  }

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const p = origFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      const m = url.match(/\/data\/challenge\/([\w-]+)\.json(\?|$)/);
      if (m && !m[1].includes('adjacency')) {
        p.then((res) => {
          if (!res.ok) return;
          res
            .clone()
            .json()
            .then((json) => {
              const codes = topologyCodes(json);
              if (codes) {
                capturedCodes = codes;
                capturedFile = m[1];
              }
            })
            .catch(() => {});
        }).catch(() => {});
      }
    } catch {}
    return p;
  };

  // Gilt für die Weekly Challenge und deren Archiv-Seiten. Beide nutzen den
  // Datensatz "challenge" (/data/challenge/, /locales/challenge/).
  const isWeekly = () => /^\/challenge\/?$/.test(location.pathname);
  const isArchive = () => /^\/archive\/challenge(\/|$)/.test(location.pathname);
  const onChallengePage = () => isWeekly() || isArchive();

  // Sprache setzt die Seite selbst als Cookie (siehe Sprachwahl im Menü)
  const lang = () =>
    (document.cookie.match(/(?:^|;\s*)lang=([a-zA-Z-]+)/)?.[1] || 'en').toLowerCase();

  // ---- Anzeigenamen laden ------------------------------------------
  // /locales/challenge/<lang>.json enthält unter "regions" die Namen ALLER
  // Challenge-Datensätze (Länder, Meere, ...), z. B. AdrS -> Adriatisches
  // Meer. en dient als Fallback, nicht jede Sprache übersetzt alles.
  let namesCache = null;
  let namesCacheLang = null;

  function loadNames() {
    const l = lang();
    if (namesCache && namesCacheLang === l) return namesCache;
    namesCacheLang = l;
    namesCache = (async () => {
      const en = await origFetch('/locales/challenge/en.json')
        .then((r) => (r.ok ? r.json() : {}))
        .then((j) => j.regions || {});
      let loc = {};
      if (l !== 'en') {
        try {
          loc = await origFetch(`/locales/challenge/${l}.json`)
            .then((r) => (r.ok ? r.json() : {}))
            .then((j) => j.regions || {});
        } catch {}
      }
      return { ...en, ...loc };
    })();
    namesCache.catch(() => {
      namesCache = null; // bei Netzfehler beim nächsten Stern erneut versuchen
    });
    return namesCache;
  }

  // Ratbare Gebiete der aktuellen Challenge. Notnagel, falls der fetch-Hook
  // nichts mitbekommen hat (sollte mit document-start nicht passieren):
  // regions.json, der Standard-Datensatz der meisten Wochen.
  async function loadEntries() {
    const l = lang();
    let codes = capturedCodes;
    if (!codes) {
      codes = topologyCodes(
        await origFetch('/data/challenge/regions.json').then((r) => r.json()),
      );
      if (!codes) throw new Error('no dataset');
    }
    const names = await loadNames();
    return codes
      .map((code) => ({ code, name: names[code] || code }))
      .sort((a, b) => a.name.localeCompare(b.name, l));
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
