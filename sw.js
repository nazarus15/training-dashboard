"use strict";
// Відкат офлайн-режиму: цей service worker видаляє збережені копії сайту і сам себе, після чого сторінки
// знову працюють лише з мережею. Файл лишається, щоб пристрої, де офлайн-режим уже встановився, отримали відкат.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) await caches.delete(k);
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: "window" })) c.navigate(c.url).catch(() => { });
  })());
});
