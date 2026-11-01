import { readFileSync } from "node:fs";

const input = await new Promise((resolve, reject) => {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => { raw += chunk; if (raw.length > 10000) reject(new Error("Input too long")); });
  process.stdin.on("end", () => {
    try { resolve(JSON.parse(raw)); } catch (error) { reject(error); }
  });
});
const { origin, code } = input;
if (!/^https:\/\//.test(origin) || typeof code !== "string") throw new Error("A secure Site URL and family code are required");
const original = JSON.parse(readFileSync("../data/ledger.json", "utf8"));
const rooms = original.rooms.filter(room => room.id !== "demo-room");
const roomIds = new Set(rooms.map(room => room.id));
const people = original.people.filter(person => roomIds.has(person.roomId));
const games = original.games.filter(game => roomIds.has(game.roomId));
const payload = { demo: false, rooms, people, games };

const login = await fetch(new URL("/api/unlock", origin), {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code }),
});
if (!login.ok) throw new Error(`Family login failed: ${login.status} ${await login.text()}`);
const cookie = login.headers.get("set-cookie")?.split(";")[0];
if (!cookie) throw new Error("Missing session cookie");
const headers = { "Content-Type": "application/json", Cookie: cookie };
const existing = await fetch(new URL("/api/state", origin), { headers });
if (!existing.ok) throw new Error(`Could not inspect cloud ledger: ${existing.status} ${await existing.text()}`);
const current = await existing.json();
if (current.rooms.length || current.people.length || current.games.length) throw new Error("Cloud ledger is not empty; import stopped");
const saved = await fetch(new URL("/api/import", origin), {
  method: "POST", headers, body: JSON.stringify(payload),
});
if (!saved.ok) throw new Error(`Cloud import failed: ${saved.status} ${await saved.text()}`);
const result = await saved.json();
const verified = await fetch(new URL("/api/state", origin), { headers });
const cloud = await verified.json();
if (cloud.rooms.length !== rooms.length || cloud.people.length !== people.length || cloud.games.length !== games.length) {
  throw new Error("Cloud import count mismatch");
}
console.log(JSON.stringify({ imported: result, verified: true }));
