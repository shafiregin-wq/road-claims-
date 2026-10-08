// Push notifications on this phone: turning them on and off, and telling the colleague's phones
// about a new expense. Sending happens in the Supabase Edge Function "notify".

import { S, rerender } from "./state.js";
import { toast } from "./ui.js";

const KEY_CACHE = "mitak.pushKey";
const DISMISS_KEY = "mitak.pushBannerDismissed";
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const PUSH_ERRORS = {
  push_not_set_up: "The notification service isn’t set up yet. See “Notifications” in SETUP.md (the Supabase Edge Function “notify”).",
  offline: "You’re offline. Connect to the internet and try again.",
  MITAK_NOT_MEMBER: "Join the MITAK workspace first."
};
const pushErr = (e, fallback) => PUSH_ERRORS[e && e.code] || fallback;

function b64uToBytes(s) {
  const t = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(t), c => c.charCodeAt(0));
}
async function registration() {
  try { return (await navigator.serviceWorker.getRegistration()) || null; } catch (e) { return null; }
}
const cachedKey = () => { try { return localStorage.getItem(KEY_CACHE) || ""; } catch (e) { return ""; } };
async function publicKey() {
  let k = cachedKey();
  if (!k) { k = await S.backend.pushPublicKey(); try { localStorage.setItem(KEY_CACHE, k); } catch (e) {} }
  return k;
}
function subscriptionInfo(sub) {
  const j = sub.toJSON();
  return { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, userAgent: navigator.userAgent.slice(0, 300) };
}

// S.push.state: checking | demo | ios-browser | unsupported | denied | off | on
let synced = false;
export async function refreshPushState() {
  S.push = S.push || {};
  let state;
  if (!S.backend || S.backend.kind === "demo") state = "demo";
  else if (!supported()) state = isIOS() && !isStandalone() ? "ios-browser" : "unsupported";
  else if (Notification.permission === "denied") state = "denied";
  else {
    const reg = await registration();
    if (!reg) state = isIOS() && !isStandalone() ? "ios-browser" : "unsupported";
    else {
      const sub = await reg.pushManager.getSubscription().catch(() => null);
      state = sub && Notification.permission === "granted" ? "on" : "off";
      // Keep the server's copy current (phones sometimes renew their subscription).
      if (state === "on" && !synced) { synced = true; S.backend.savePushSubscription(subscriptionInfo(sub)).catch(() => {}); }
      if (state === "off" && !cachedKey()) publicKey().catch(() => {});
    }
  }
  if (S.push.state !== state) { S.push.state = state; rerender(); }
  return state;
}

export async function enablePush() {
  // Asking first, straight from the tap: iPhones only show the question in response to a tap.
  let permission;
  try { permission = await Notification.requestPermission(); } catch (e) { permission = Notification.permission; }
  if (permission !== "granted") {
    toast(permission === "denied" ? "Notifications are blocked. Allow them for MITAK in your phone’s settings." : "Notifications weren’t turned on.", "bad", 5000);
    await refreshPushState(); return;
  }
  try {
    const reg = await registration();
    if (!reg) throw new Error("no service worker");
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(await publicKey()) });
    await S.backend.savePushSubscription(subscriptionInfo(sub));
    synced = true;
    toast("Notifications are on for this phone.", "ok");
  } catch (e) {
    toast(pushErr(e, "Couldn’t turn on notifications. Try again."), "bad", 6000);
  }
  await refreshPushState();
}

export async function disablePush({ quiet = false } = {}) {
  try {
    const reg = await registration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) {
      await S.backend.deletePushSubscription(sub.endpoint).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
    if (!quiet) toast("Notifications are off for this phone.", "ok");
  } catch (e) { if (!quiet) toast("Couldn’t turn off notifications.", "bad"); }
  synced = false;
  if (!quiet) await refreshPushState();
}

export async function testPush() {
  try {
    const r = await S.backend.testPush();
    toast(r && r.sent ? "Test sent. It should arrive in a few seconds." : "No notification was sent. Turn notifications off and on again.", r && r.sent ? "ok" : "bad", 5000);
  } catch (e) { toast(pushErr(e, "Couldn’t send a test notification."), "bad", 6000); }
}

// After saving a new expense: let the colleague know. Never blocks or bothers the person saving.
export function notifyColleague(expenseId) {
  if (!S.backend || S.backend.kind === "demo" || typeof S.backend.notifyExpense !== "function") return;
  S.backend.notifyExpense(expenseId).catch(() => {});
}

export const bannerDismissed = () => { try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch (e) { return false; } };
export const dismissBanner = () => { try { localStorage.setItem(DISMISS_KEY, "1"); } catch (e) {} rerender(); };
