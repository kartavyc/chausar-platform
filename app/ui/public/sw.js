// Chausar's service worker on the hosted app (Ink v2 wave 4, package 4G3; spec 5.7, catalogue O13): phone alerts with
// a count only. A push carries {"count":N} and nothing else (platform/runtime/venture/notify/webpush.ts); this shows one
// notification, "Chausar" with "3 need you", under one tag so a newer count replaces the older one. A tap opens the
// approval page and decides nothing: there are no buttons, and nothing is approved from here. It keeps nothing in
// browser storage, keeps no copies of pages and fetches nothing; the subscription itself is kept by the browser. Plain JavaScript,
// served with the Ink files from /app/sw.js, so its scope is /app/.
'use strict';

const TAG = 'chausar-count';
const APPROVE = '#/approve/next';
const NO_COUNT = 'Something needs you in Chausar.';

/** The count in a push, or null: a whole number only, and every other field is ignored. */
function countOf(data) {
  if (!data) return null;
  let value = null;
  try { value = data.json(); } catch (error) { return null; }
  const count = value && typeof value === 'object' ? value.count : null;
  return Number.isSafeInteger(count) && count > 0 && count < 1000000 ? count : null;
}

/** Whether the browser's first language is Hindi (the app picks its language from the computer's the same way). 4G4. */
function hindi() {
  const nav = self.navigator;
  const first = nav && ((nav.languages && nav.languages[0]) || nav.language);
  return typeof first === 'string' && first.toLowerCase().indexOf('hi') === 0;
}

function bodyOf(count) {
  if (hindi()) {
    if (count === null) return 'Chausar में किसी चीज़ में आपकी ज़रूरत है।';
    return count === 1 ? '1 चीज़ में आपकी ज़रूरत है' : count + ' चीज़ों में आपकी ज़रूरत है';
  }
  if (count === null) return NO_COUNT;
  return count === 1 ? '1 needs you' : count + ' need you';
}

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });

// Browsers require every push to show a notification, so one that is not a count still shows, without a number.
self.addEventListener('push', function (event) {
  const count = countOf(event.data);
  event.waitUntil(self.registration.showNotification('Chausar', {
    body: bodyOf(count), tag: TAG, renotify: true, icon: 'icon-192.png', data: { open: APPROVE },
  }));
});

// A tap opens the single approval page: an open Chausar window is brought forward and moved there, else a new one opens.
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const target = new URL(APPROVE, self.registration.scope).href;
  event.waitUntil((async function () {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(function (client) { return typeof client.url === 'string' && client.url.indexOf(self.registration.scope) === 0; });
    if (open) {
      try {
        await open.focus();
        await open.navigate(target);
        return;
      } catch (error) { /* A window this worker does not control: open a new one instead. */ }
    }
    await self.clients.openWindow(target);
  })());
});
