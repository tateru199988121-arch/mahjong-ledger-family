const origin = process.env.SMOKE_BASE_URL || "http://127.0.0.1:4190";
const code = process.env.SMOKE_FAMILY_CODE;
if (!code) throw new Error("Set SMOKE_FAMILY_CODE to the local test ledger's family code.");
async function call(path, method = "GET", value, cookie = "") {
  const response = await fetch(origin + path, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
  return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
function expect(condition, message) { if (!condition) throw new Error(message); }

const denied = await call("/api/state");
expect(denied.status === 401, "The ledger should require a family code");
const opened = await call("/api/unlock", "POST", { code });
expect(opened.status === 200 && opened.cookie, "Family login failed");
const cookie = opened.cookie;
const room = await call("/api/rooms", "POST", { name: `測試麻將場-${Date.now()}` }, cookie);
expect(room.status === 201, "Room creation failed");
const id = room.body.id;
const a = await call("/api/people", "POST", { roomId: id, name: "甲", kind: "family" }, cookie);
const b = await call("/api/people", "POST", { roomId: id, name: "乙", kind: "guest" }, cookie);
expect(a.status === 201 && b.status === 201, "People creation failed");
const first = await call("/api/day-entry", "POST", {
  roomId: id, date: "2026-10-04", personId: a.body.id, amount: 100, eastMoney: 0, actor: "甲",
}, cookie);
expect(first.status === 201 && first.body.entries.length === 1, "Single-person day creation failed");
const second = await call("/api/day-entry", "POST", {
  roomId: id, date: "2026-10-04", personId: b.body.id, amount: -20, eastMoney: 25, actor: "甲",
}, cookie);
expect(second.status === 200 && second.body.entries.length === 2, "Another person's partial result failed");
const game = await call("/api/day-entry", "POST", {
  roomId: id, date: "2026-10-04", personId: a.body.id, amount: 0, eastMoney: 0, actor: "甲",
}, cookie);
expect(game.status === 200 && game.body.entries.length === 2 && game.body.entries[0].amount === 0, "Correcting a result should replace it");
const shared = await call("/api/shared/" + game.body.shareToken);
expect(shared.status === 200 && !shared.body.game.shareToken && shared.body.people.length === 2, "Guest sharing failed");
const stale = await call("/api/games/" + game.body.id, "DELETE", { version: 0, actor: "甲" }, cookie);
expect(stale.status === 409, "Stale edit should be rejected");
const removed = await call("/api/games/" + game.body.id, "DELETE", { version: game.body.version, actor: "甲" }, cookie);
expect(removed.status === 200, "Game deletion failed");
const expired = await call("/api/shared/" + game.body.shareToken);
expect(expired.status === 404, "Deleted game share should expire");
const state = await call("/api/state", "GET", undefined, cookie);
expect(state.status === 200 && state.body.games[0].archived, "Deleted game should be archived");
console.log("Mobile ledger API smoke test passed.");
