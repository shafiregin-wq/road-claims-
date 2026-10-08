// App state shared by every screen, plus small lookups.

import { monthOf, todayISO } from "./util.js";

export const S = {
  backend: null,
  phase: "loading",          // loading | config | auth | onboard | app
  user: null,                // { id, email }
  workspace: null,           // { id, name, inviteCode }
  members: [],               // [{ userId, displayName, role, profile }]
  expenses: [],
  templates: {},             // { fuel: { fileName, filePath, mapping } }
  settlements: [],           // payments between the two: { id, fromUser, toUser, amount, date, note, createdBy }
  loaded: false,
  view: "home",
  calMonth: monthOf(todayISO()),
  calDay: todayISO(),
  sumMonth: monthOf(todayISO()),
  repMonth: monthOf(todayISO()),
  repWho: null,              // null = only mine (default), "" = both, otherwise a user id
  xf: { month: monthOf(todayISO()), date: "", user: "", category: "", trip: "", sort: "newest" }
};

export const me = () => S.members.find(m => m.userId === (S.user && S.user.id)) || null;
export const colleague = () => S.members.find(m => m.userId !== (S.user && S.user.id)) || null;
export const memberName = id => {
  const m = S.members.find(x => x.userId === id);
  return m ? m.displayName : "Former member";
};
// "Me" wording for the signed-in person, their name for the colleague.
export const whoLabel = id => (S.user && id === S.user.id) ? "Me" : memberName(id);

let renderFn = () => {};
export const setRenderer = fn => { renderFn = fn; };
export const rerender = () => renderFn();
