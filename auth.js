"use strict";
// Вхід за паролем і розшифрування даних. Підключається першим на кожній сторінці.
// Дані (data/*.enc, журнал) зашифровані публічним ключем pubkey.json. Приватний ключ лежить у keyring.json,
// зашифрований ключем з пароля (PBKDF2-SHA256). Після входу приватний ключ зберігається на пристрої
// в IndexedDB як невитягуваний CryptoKey: сторінки читають дані без повторного пароля.
// Також тут кругла кнопка перезавантаження для телефона.
window.AUTH = (() => {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = u8 => { let s = ""; const b = new Uint8Array(u8); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const RSA = { name: "RSA-OAEP", hash: "SHA-256" };
  let priv = null, pub = null;

  // ---------- IndexedDB ----------
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open("forma-auth", 1); r.onupgradeneeded = () => r.result.createObjectStore("k"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function idbGet() { try { const db = await idb(); return await new Promise(res => { const q = db.transaction("k").objectStore("k").get("priv"); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch { return null; } }
  async function idbSet(v) { try { const db = await idb(); await new Promise(res => { const t = db.transaction("k", "readwrite"); v ? t.objectStore("k").put(v, "priv") : t.objectStore("k").delete("priv"); t.oncomplete = res; t.onerror = res; }); } catch { } }

  // ---------- ключі ----------
  async function keyring() { const r = await fetch(`keyring.json?t=${Date.now()}`, { cache: "no-store" }); if (!r.ok) throw new Error("keyring"); return r.json(); }
  async function kek(pw, kr, usage) {
    const base = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: unb64(kr.salt), iterations: kr.iter }, base, { name: "AES-GCM", length: 256 }, false, usage);
  }
  // Код відновлення: друга копія приватного ключа в keyring.json (поле recovery), зашифрована довгим випадковим кодом.
  const normCode = s => s.toUpperCase().replace(/[^A-Z2-9]/g, "");
  async function unwrap(secret, w) {
    const k = await kek(secret, w, ["decrypt"]);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(w.iv) }, k, unb64(w.wrapped)); // кидає помилку при невірному секреті
  }
  async function wrap(secret, raw) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const w = { v: 1, kdf: "PBKDF2-SHA256", iter: 600000, salt: b64(salt), iv: b64(iv) };
    w.wrapped = b64(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await kek(secret, w, ["encrypt"]), raw));
    return w;
  }
  // приймає пароль або код відновлення; повертає { raw, via }
  async function pkcs8From(secret, kr) {
    try { return { raw: await unwrap(secret, kr), via: "password" }; }
    catch (e) {
      const c = normCode(secret);
      if (kr.recovery && c.length >= 16) return { raw: await unwrap(c, kr.recovery), via: "recovery" };
      throw e;
    }
  }
  async function unlock(secret) {
    const kr = await keyring();
    const { raw, via } = await pkcs8From(secret, kr);
    priv = await crypto.subtle.importKey("pkcs8", raw, RSA, false, ["decrypt"]);
    await idbSet(priv);
    return via;
  }
  // новий пароль; поле recovery у keyring.json зберігається (див. settings.html)
  async function newKeyring(cur, newPw) { const { raw } = await pkcs8From(cur, await keyring()); return wrap(newPw, raw); }
  // новий код відновлення: XXXXX-XXXXX-XXXXX-XXXXX (≈100 біт)
  async function newRecovery(cur) {
    const { raw } = await pkcs8From(cur, await keyring());
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", r = crypto.getRandomValues(new Uint8Array(20));
    const code = Array.from(r, x => A[x % 32]).join("").match(/.{5}/g).join("-");
    const rec = await wrap(normCode(code), raw); rec.createdAt = new Date().toISOString();
    return { code, rec };
  }
  const hasRecovery = async () => { try { return (await keyring()).recovery?.createdAt || null; } catch { return null; } };
  async function logout() { priv = null; await idbSet(null); }

  // ---------- шифрування об'єктів ----------
  async function pubKey() {
    if (pub) return pub;
    const j = await (await fetch("pubkey.json", { cache: "no-store" })).json();
    return pub = await crypto.subtle.importKey("spki", unb64(j.spki), RSA, false, ["encrypt"]);
  }
  async function decrypt(obj) {
    if (!obj || !obj.ct || !obj.k) return obj; // незашифроване (старі файли, планер)
    const k = await crypto.subtle.decrypt(RSA, priv, unb64(obj.k));
    const ak = await crypto.subtle.importKey("raw", k, "AES-GCM", false, ["decrypt"]);
    return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(obj.iv) }, ak, unb64(obj.ct))));
  }
  async function encrypt(obj) {
    const k = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ak = await crypto.subtle.importKey("raw", k, "AES-GCM", false, ["encrypt"]);
    return { v: 1, k: b64(await crypto.subtle.encrypt(RSA, await pubKey(), k)), iv: b64(iv), ct: b64(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, ak, enc.encode(JSON.stringify(obj)))) };
  }
  // data/<name>.enc → об'єкт; якщо зашифрованого нема — data/<name>.json
  async function keyMismatch() { try { if (sessionStorage.getItem("forma-km")) return; sessionStorage.setItem("forma-km", "1"); } catch { } await logout(); location.reload(); }
  async function load(name) {
    let r = null; try { r = await fetch(`data/${name}.enc?t=${Date.now()}`); } catch { }
    if (r?.ok) { const j = await r.json(); try { return await decrypt(j); } catch { await keyMismatch(); return null; } }
    try { const r = await fetch(`data/${name}.json?t=${Date.now()}`); if (r.ok) return await r.json(); } catch { }
    return null;
  }

  // ---------- екран входу ----------
  const css = `
html.locked body>*:not(#authGate):not(.reload-fab){visibility:hidden}
#authGate{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--bg,#eef1f4);font-family:var(--f-body,system-ui,sans-serif);color:var(--ink,#15202b)}
#authGate form{width:min(360px,100%);display:flex;flex-direction:column;gap:12px;background:var(--panel,#fff);border:1px solid var(--line,#d6dde5);border-radius:8px;padding:22px 20px}
#authGate h1{font-family:var(--f-display,system-ui);font-size:34px;margin:0;line-height:1}
#authGate p{margin:0;font-size:14px;color:var(--muted,#5b6876)}
#authGate input{font:inherit;font-size:16px;padding:10px 12px;border:1px solid var(--line,#d6dde5);border-radius:6px;background:var(--bg,#eef1f4);color:inherit;width:100%}
#authGate button{font:inherit;font-weight:600;padding:10px 14px;border-radius:6px;border:none;background:var(--ink,#15202b);color:var(--panel,#fff);cursor:pointer}
#authGate .err{color:var(--bad,#c4372f);min-height:1.2em}
.reload-fab{display:none}
@media (max-width:820px){.reload-fab{display:flex;position:fixed;z-index:60;top:calc(env(safe-area-inset-top,0px) + 10px);right:calc(env(safe-area-inset-right,0px) + 12px);width:42px;height:42px;border-radius:50%;align-items:center;justify-content:center;border:1px solid color-mix(in srgb,var(--ink,#15202b) 18%,transparent);background:color-mix(in srgb,var(--panel,#fff) 55%,transparent);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:var(--ink,#15202b);opacity:.8;cursor:pointer;padding:0}
.reload-fab:active{opacity:1}
.reload-fab.spin svg{animation:fabspin .8s linear infinite}}
@keyframes fabspin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.reload-fab.spin svg{animation:none}}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  document.documentElement.classList.add("locked");

  function fab() {
    const b = document.createElement("button");
    b.type = "button"; b.className = "reload-fab"; b.setAttribute("aria-label", "Оновити сторінку");
    b.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg>`;
    b.onclick = () => { b.classList.add("spin"); location.reload(); };
    document.body.appendChild(b);
  }

  function gate(resolve) {
    const g = document.createElement("div"); g.id = "authGate";
    g.innerHTML = `<form><h1>Форма Назара</h1><p>Сайт закритий паролем. На цьому пристрої його треба ввести один раз.</p><input type="password" id="authPw" autocomplete="current-password" placeholder="Пароль або код відновлення" aria-label="Пароль або код відновлення" required><button type="submit">Увійти</button><p class="err" id="authErr" role="alert"></p><p style="font-size:12px">Забув пароль — введи код відновлення з Налаштувань.</p></form>`;
    document.body.appendChild(g);
    const f = g.querySelector("form"), btn = f.querySelector("button");
    setTimeout(() => g.querySelector("input").focus(), 50);
    f.onsubmit = async e => {
      e.preventDefault(); btn.disabled = true; btn.textContent = "Перевіряю…"; g.querySelector("#authErr").textContent = "";
      try {
        const via = await unlock(g.querySelector("input").value);
        if (via === "recovery") { try { sessionStorage.setItem("forma-recovered", "1"); } catch { } location.href = "settings.html#pwForm"; return; }
        g.remove(); document.documentElement.classList.remove("locked"); resolve();
      }
      catch (err) { g.querySelector("#authErr").textContent = err.message === "keyring" ? "Не вдалося завантажити ключ. Перевір інтернет." : "Невірний пароль або код."; btn.disabled = false; btn.textContent = "Увійти"; }
    };
  }

  const ready = new Promise(resolve => {
    const start = async () => {
      fab();
      priv = await idbGet();
      if (priv) { document.documentElement.classList.remove("locked"); resolve(); } else gate(resolve);
    };
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", start) : start();
  });

  return { ready, load, decrypt, encrypt, unlock, newKeyring, newRecovery, hasRecovery, logout, keyMismatch };
})();
