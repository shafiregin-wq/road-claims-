import test from "node:test";
import assert from "node:assert/strict";
import { balance } from "../../js/reports.js";

test("who owes who: shares of each other's expenses, less payments", () => {
  const expenses = [
    { id: "1", paidBy: "regin", amount: 100, otherShare: 50, date: "2026-10-01" },   // half each
    { id: "2", paidBy: "regin", amount: 60, otherShare: 40, date: "2026-10-02" },    // food: mine 20, his 40
    { id: "3", paidBy: "ashkar", amount: 30, otherShare: 15, date: "2026-10-03" },
    { id: "4", paidBy: "ashkar", amount: 20, otherShare: 0, date: "2026-10-03" }     // not shared
  ];
  const payments = [{ fromUser: "ashkar", toUser: "regin", amount: 25 }];
  const r = balance(expenses, payments, "regin", "ashkar");
  assert.deepEqual({ net: r.net, owedToMe: r.owedToMe, iOwe: r.iOwe, paidToMe: r.paidToMe, paidByMe: r.paidByMe }, { net: 50, owedToMe: 90, iOwe: 15, paidToMe: 25, paidByMe: 0 });
  assert.deepEqual(r.shared.map(e => e.id), ["3", "2", "1"], "shared expenses, newest first");
  assert.equal(balance(expenses, payments, "ashkar", "regin").net, -50, "the same balance seen from the other side");
  assert.equal(balance(expenses, [...payments, { fromUser: "ashkar", toUser: "regin", amount: 50 }], "regin", "ashkar").net, 0, "settled up");
});
