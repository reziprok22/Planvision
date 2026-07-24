/**
 * onboarding.js – Einführungs-Modal ("Tour") für neue Nutzer.
 *
 * Zeigt beim ersten Besuch automatisch ein durchklickbares Modal mit 4 Schritten
 * (Upload & Massstab → Labels → Zeichnen → Export). Jeder Schritt kann ein
 * Bild oder ein stummes Loop-Video zeigen; der Medientyp wird aus der
 * Dateiendung abgeleitet (.mp4/.webm/.ogg → <video>, sonst <img>).
 *
 * Medien liegen unter static/media/onboarding/ und werden im Template per
 * {% static %} in #onboardingData (JSON) eingetragen. Fehlt eine Datei
 * (404/Ladefehler), wird die Medienbox für diesen Schritt ausgeblendet –
 * die Schritte funktionieren also auch ohne Medien.
 *
 * Das Modal erscheint nur einmal automatisch (localStorage-Flag). Über den
 * Toolbar-Button #onboardingBtn lässt es sich jederzeit erneut öffnen.
 */

const SEEN_KEY = 'planli_onboarding_seen_v1';
const VIDEO_EXT = /\.(mp4|webm|ogg)(\?.*)?$/i;

let steps = [];
let index = 0;
let els = null;

function readSteps() {
  const dataEl = document.getElementById('onboardingData');
  if (!dataEl) return [];
  try {
    const parsed = JSON.parse(dataEl.textContent);
    return Array.isArray(parsed.steps) ? parsed.steps : [];
  } catch (e) {
    console.warn('Onboarding: konnte Step-Daten nicht lesen:', e);
    return [];
  }
}

function buildMedia(src) {
  const box = els.media;
  box.innerHTML = '';
  // Layout-Platz bleibt reserviert (flex:1); nur Rahmen/Hintergrund per Klasse.
  box.classList.remove('has-media');
  if (!src) return;

  // Rahmen erst zeigen, wenn das Medium erfolgreich lädt (vermeidet leere Box).
  const onError = () => { box.classList.remove('has-media'); box.innerHTML = ''; };
  const onReady = () => { box.classList.add('has-media'); };

  if (VIDEO_EXT.test(src)) {
    const v = document.createElement('video');
    v.src = src;
    v.autoplay = true;
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.addEventListener('loadeddata', onReady);
    v.addEventListener('error', onError);
    box.appendChild(v);
    // Manche Browser feuern loadeddata nicht zuverlässig bei Cache-Hits.
    if (v.readyState >= 2) onReady();
  } else {
    const img = document.createElement('img');
    img.alt = '';
    img.addEventListener('load', onReady);
    img.addEventListener('error', onError);
    img.src = src;
    box.appendChild(img);
    if (img.complete && img.naturalWidth > 0) onReady();
  }
}

function renderDots() {
  els.dots.innerHTML = '';
  steps.forEach((_, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'onboarding-dot' + (i === index ? ' active' : '');
    dot.setAttribute('aria-label', `Schritt ${i + 1}`);
    dot.addEventListener('click', () => goTo(i));
    els.dots.appendChild(dot);
  });
}

function render() {
  const step = steps[index];
  if (!step) return;
  els.counter.textContent = `Schritt ${index + 1}/${steps.length}`;
  els.title.textContent = step.title || '';
  els.body.textContent = step.body || '';
  buildMedia(step.media);
  renderDots();

  els.prev.disabled = index === 0;
  const last = index === steps.length - 1;
  els.next.textContent = last ? "Los geht's" : 'Weiter →';
}

function goTo(i) {
  index = Math.max(0, Math.min(steps.length - 1, i));
  render();
}

function open(startAt = 0) {
  if (!steps.length) return;
  index = Math.max(0, Math.min(steps.length - 1, startAt));
  render();
  els.modal.style.display = 'block';
}

function close() {
  els.modal.style.display = 'none';
  // Laufende Videos anhalten, damit sie im Hintergrund keine Ressourcen ziehen.
  els.media.querySelectorAll('video').forEach(v => v.pause());
  try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* ignore */ }
}

function next() {
  if (index >= steps.length - 1) { close(); return; }
  goTo(index + 1);
}

function isVisible() {
  return els && els.modal.style.display === 'block';
}

/**
 * Initialisiert das Onboarding-Modal. Beim ersten Besuch (kein localStorage-Flag)
 * öffnet es sich automatisch.
 */
export function setupOnboarding() {
  const modal = document.getElementById('onboardingModal');
  if (!modal) return;

  steps = readSteps();
  if (!steps.length) return;

  els = {
    modal,
    media: document.getElementById('onboardingMedia'),
    counter: document.getElementById('onboardingCounter'),
    title: document.getElementById('onboardingTitle'),
    body: document.getElementById('onboardingBody'),
    dots: document.getElementById('onboardingDots'),
    prev: document.getElementById('onboardingPrev'),
    next: document.getElementById('onboardingNext'),
    skip: document.getElementById('onboardingSkip'),
    close: document.getElementById('onboardingClose'),
  };

  els.next.addEventListener('click', next);
  els.prev.addEventListener('click', () => goTo(index - 1));
  els.skip.addEventListener('click', close);
  els.close.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  // Tastatursteuerung, solange das Modal sichtbar ist.
  document.addEventListener('keydown', (e) => {
    if (!isVisible()) return;
    if (e.key === 'Escape') { close(); }
    else if (e.key === 'ArrowRight') { next(); }
    else if (e.key === 'ArrowLeft') { goTo(index - 1); }
  });

  // Toolbar-Button: jederzeit erneut öffnen.
  document.getElementById('onboardingBtn')?.addEventListener('click', () => open(0));

  // Erstbesuch-Anleitung erscheint nur beim EDITOR-Einstieg für ein neues
  // Projekt (Upload-/Massstab-Anleitung), nie über der Projektübersicht: bei
  // eingeloggten Nutzern ist das Dashboard die Startansicht, dort würde das
  // Modal nur den leeren Überblick verdecken. Deshalb kein Auto-Open hier,
  // sondern ein Hook, den der "Neues Projekt"-Flow (upload-modal.js) auslöst.
  // Für den Fall, dass der Editor bereits die Startansicht ist (kein Dashboard,
  // z.B. BETA_MODE ohne Login), zeigen wir es direkt beim Setup.
  window.planliMaybeShowOnboarding = maybeAutoOpen;
  if (!document.body.classList.contains('dashboard-open')) maybeAutoOpen();
}

/**
 * Öffnet die Anleitung automatisch beim ersten Editor-Einstieg — einmalig
 * (localStorage-Flag), nie im Demo-Modus (/app?demo=1), wo das Modal den
 * frisch geladenen Demo-Plan verdecken würde. Das Seen-Flag bleibt im Demo
 * ungesetzt, damit die Anleitung beim nächsten echten Neu-Projekt kommt.
 */
function maybeAutoOpen() {
  if (!steps.length || isVisible()) return;
  if (new URLSearchParams(window.location.search).has('demo')) return;
  let seen = false;
  try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch (e) { /* ignore */ }
  if (!seen) open(0);
}
