import { env } from "cloudflare:workers";

type Person = { id: string; roomId: string; name: string; kind: "family" | "guest"; color: string };
type Entry = { personId: string; amount: number; eastMoney: number };
type Room = { id: string; name: string; createdAt: string };
type History = { actor: string; at: string; action: string; previous?: { date: string; title: string; entries: Entry[] } };
type Game = { id: string; roomId: string; date: string; title: string; entries: Entry[]; version: number; shareToken: string; createdAt: string; updatedAt: string; archived: boolean; history: History[] };
type Data = { demo: boolean; rooms: Room[]; people: Person[]; games: Game[] };
type Stored = { version: number; data: Data };
type ApiResult = { status: number; body: unknown; headers?: Record<string, string> };

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function fail(status: number, message: string): never { throw new ApiError(status, message); }
const output = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
const bytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));
const hex = (length: number) => Array.from(bytes(length), value => value.toString(16).padStart(2, "0")).join("");
const initial = (): Data => ({ demo: false, rooms: [], people: [], games: [] });

function database(): D1Database {
  if (!env.DB) fail(503, "資料庫尚未設定");
  return env.DB;
}
async function read(): Promise<Stored> {
  const db = database();
  await db.prepare("INSERT OR IGNORE INTO ledger_state (id, version, data) VALUES (1, 0, ?)").bind(JSON.stringify(initial())).run();
  const row = await db.prepare("SELECT version, data FROM ledger_state WHERE id = 1").first<{ version: number; data: string }>();
  if (!row) fail(503, "資料庫暫時無法讀取");
  return { version: row.version, data: JSON.parse(row.data) as Data };
}
async function mutate(change: (data: Data) => ApiResult, retries = 0): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const stored = await read();
    const result = change(stored.data);
    stored.data.demo = false;
    const saved = await database().prepare("UPDATE ledger_state SET data = ?, version = version + 1 WHERE id = 1 AND version = ?")
      .bind(JSON.stringify(stored.data), stored.version).run();
    if (saved.meta.changes) return output(result.body, result.status, result.headers);
  }
  fail(409, "資料剛由別人更新，請重新載入再試");
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") || 0) > 100_000) fail(413, "資料太大");
  const raw = await request.text();
  if (raw.length > 100_000) fail(413, "資料太大");
  try {
    const value: unknown = raw ? JSON.parse(raw) : {};
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(400, "資料格式錯誤");
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    fail(400, "資料格式錯誤");
  }
}
function name(value: unknown): string {
  const clean = String(value || "").trim();
  if (!clean || clean.length > 20) fail(400, "名稱請輸入 1 至 20 個字");
  return clean;
}
function actor(value: unknown): string { return String(value || "家人").trim().slice(0, 20) || "家人"; }
function validDate(value: unknown): string {
  const date = String(value || "");
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) fail(400, "請選擇有效日期");
  return date;
}
function validAmount(value: unknown, label: string): number {
  if (value === "" || value == null) fail(400, `請輸入${label}`);
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || Math.abs(amount) > 10_000_000) fail(400, `請輸入有效的${label}整數`);
  return amount;
}
function gameFields(value: Record<string, unknown>, people: Person[], roomId: string) {
  const date = validDate(value.date);
  const title = String(value.title || "").trim().slice(0, 40);
  if (!Array.isArray(value.entries) || value.entries.length < 1 || value.entries.length > 100) fail(400, "請選擇 1 至 100 位參與者");
  const known = new Set(people.filter(person => person.roomId === roomId).map(person => person.id));
  const used = new Set<string>();
  const entries = value.entries.map((row: Record<string, unknown>): Entry => {
    const personId = String(row.personId || "");
    if (!known.has(personId) || used.has(personId)) fail(400, "參與者不可重複");
    used.add(personId);
    const amount = validAmount(row.amount, "輸贏");
    const eastMoney = validAmount(row.eastMoney ?? 0, "東錢");
    return { personId, amount, eastMoney };
  });
  return { date, title, entries };
}
async function key() {
  if (!env.SESSION_SECRET) fail(503, "家庭登入尚未設定");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function signedSession() {
  const expires = String(Math.floor(Date.now() / 1000) + 30 * 86400);
  const signature = await crypto.subtle.sign("HMAC", await key(), new TextEncoder().encode(expires));
  return `${expires}.${Array.from(new Uint8Array(signature), value => value.toString(16).padStart(2, "0")).join("")}`;
}
async function authorized(request: Request) {
  const cookie = /(?:^|;\s*)mahjong_session=([^;]+)/.exec(request.headers.get("cookie") || "")?.[1];
  if (!cookie) return false;
  const match = /^(\d+)\.([a-f0-9]{64})$/.exec(cookie);
  if (!match || Number(match[1]) <= Date.now() / 1000) return false;
  const signature = new Uint8Array(match[2].match(/../g)!.map(part => parseInt(part, 16)));
  return crypto.subtle.verify("HMAC", await key(), signature, new TextEncoder().encode(match[1]));
}

async function route(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  const method = request.method;
  if (path === "/api/unlock" && method === "POST") {
    if (!env.FAMILY_CODE) fail(503, "家庭編輯碼尚未設定");
    const value = await body(request);
    if (String(value.code || "") !== env.FAMILY_CODE) fail(401, "編輯碼不正確");
    const cookie = await signedSession();
    return output({ ok: true }, 200, { "Set-Cookie": `mahjong_session=${cookie}; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=2592000` });
  }
  if (path.startsWith("/api/shared/") && method === "GET") {
    const token = path.slice("/api/shared/".length);
    if (!/^[a-f0-9]{48}$/.test(token)) fail(404, "這個分享連結不存在或已失效");
    const { data } = await read();
    const game = data.games.find(item => item.shareToken === token && !item.archived);
    if (!game) fail(404, "這個分享連結不存在或已失效");
    const ids = new Set(game.entries.map(item => item.personId));
    return output({ game: { date: game.date, title: game.title, entries: game.entries }, people: data.people.filter(item => ids.has(item.id)).map(item => ({ id: item.id, name: item.name })) });
  }
  if (!(await authorized(request))) fail(401, "請先輸入家庭編輯碼");
  if (path === "/api/state" && method === "GET") return output((await read()).data);
  if (path === "/api/export" && method === "GET") return output((await read()).data, 200, { "Content-Disposition": 'attachment; filename="mahjong-ledger.json"' });
  if (path === "/api/import" && method === "POST") {
    const value = await body(request);
    return mutate(data => {
      if (data.rooms.length || data.people.length || data.games.length) fail(409, "帳本已有紀錄，無法再匯入");
      if (!Array.isArray(value.rooms) || !Array.isArray(value.people) || !Array.isArray(value.games)) fail(400, "匯入格式錯誤");
      if (value.rooms.length > 100 || value.people.length > 1000 || value.games.length > 10000) fail(413, "匯入資料太大");
      const rooms = value.rooms as Room[];
      const people = value.people as Person[];
      const games = value.games as Game[];
      const roomIds = new Set(rooms.map(item => item.id));
      const personIds = new Set(people.map(item => item.id));
      if (roomIds.size !== rooms.length || personIds.size !== people.length ||
          rooms.some(item => !item.id || !item.name) ||
          people.some(item => !item.id || !item.name || !roomIds.has(item.roomId)) ||
          games.some(item => !item.id || !roomIds.has(item.roomId) || !/^[a-f0-9]{48}$/.test(item.shareToken) ||
            !Array.isArray(item.entries) || item.entries.some(entry => !personIds.has(entry.personId)))) fail(400, "匯入資料不完整");
      data.rooms = rooms;
      data.people = people;
      data.games = games;
      return { status: 200, body: { rooms: rooms.length, people: people.length, games: games.length } };
    });
  }
  if (path === "/api/people" && method === "POST") {
    const value = await body(request);
    return mutate(data => {
      const roomId = String(value.roomId || "");
      if (!data.rooms.some(room => room.id === roomId)) fail(400, "請先選擇房間");
      const clean = name(value.name);
      if (data.people.some(person => person.roomId === roomId && person.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) fail(409, "這個名字已經在名單裡");
      if (value.kind !== "family" && value.kind !== "guest") fail(400, "請選擇家人或朋友");
      const colors = ["#EC7F58", "#A97DD4", "#57A5A0", "#D1A64A", "#6B91B8", "#B97A9B"];
      const person: Person = { id: crypto.randomUUID(), roomId, name: clean, kind: value.kind as "family" | "guest", color: colors[data.people.length % colors.length] };
      data.people.push(person);
      return { status: 201, body: person };
    });
  }
  if (path === "/api/rooms" && method === "POST") {
    const value = await body(request);
    return mutate(data => {
      const clean = name(value.name);
      if (data.rooms.some(room => room.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) fail(409, "這個房間名稱已經存在");
      const room: Room = { id: crypto.randomUUID(), name: clean, createdAt: new Date().toISOString() };
      data.rooms.push(room);
      return { status: 201, body: room };
    });
  }
  const roomId = /^\/api\/rooms\/([^/]+)$/.exec(path)?.[1];
  if (roomId && method === "PUT") {
    const value = await body(request);
    return mutate(data => {
      const room = data.rooms.find(item => item.id === roomId);
      if (!room) fail(404, "找不到房間");
      const clean = name(value.name);
      if (data.rooms.some(item => item.id !== roomId && item.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) fail(409, "這個房間名稱已經存在");
      room.name = clean;
      return { status: 200, body: room };
    });
  }
  if (path === "/api/day-entry" && method === "POST") {
    const value = await body(request);
    const requestedRoomId = String(value.roomId || "");
    const date = validDate(value.date);
    const personId = String(value.personId || "");
    const amount = validAmount(value.amount, "輸贏");
    const eastMoney = validAmount(value.eastMoney ?? 0, "東錢");
    const by = actor(value.actor);
    return mutate(data => {
      if (!data.rooms.some(room => room.id === requestedRoomId)) fail(400, "請先選擇房間");
      if (!data.people.some(person => person.id === personId && person.roomId === requestedRoomId)) fail(400, "請選擇這個房間的人物");
      const now = new Date().toISOString();
      const existing = data.games.filter(item => item.roomId === requestedRoomId && item.date === date && !item.archived)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (!existing) {
        const game: Game = {
          id: crypto.randomUUID(), roomId: requestedRoomId, date, title: "",
          entries: [{ personId, amount, eastMoney }], version: 1, shareToken: hex(24),
          createdAt: now, updatedAt: now, archived: false,
          history: [{ actor: by, at: now, action: "登錄" }],
        };
        data.games.push(game);
        return { status: 201, body: game };
      }
      const previous = { date: existing.date, title: existing.title, entries: existing.entries.map(entry => ({ ...entry })) };
      const row = existing.entries.find(entry => entry.personId === personId);
      if (row) {
        row.amount = amount;
        row.eastMoney = eastMoney;
      } else {
        if (existing.entries.length >= 100) fail(400, "今天的名單已達上限");
        existing.entries.push({ personId, amount, eastMoney });
      }
      existing.history.push({ actor: by, at: now, action: row ? "更新" : "登錄", previous });
      existing.version += 1;
      existing.updatedAt = now;
      return { status: 200, body: existing };
    }, 2);
  }
  if (path === "/api/games" && method === "POST") {
    const value = await body(request);
    return mutate(data => {
      const roomId = String(value.roomId || "");
      if (!data.rooms.some(room => room.id === roomId)) fail(400, "請先選擇房間");
      const fields = gameFields(value, data.people, roomId);
      if (data.games.some(item => item.roomId === roomId && item.date === fields.date && !item.archived)) fail(409, "這一天已有紀錄，請直接補上或修改");
      const now = new Date().toISOString();
      const game: Game = { id: crypto.randomUUID(), roomId, ...fields, version: 1, shareToken: hex(24), createdAt: now, updatedAt: now, archived: false, history: [{ actor: actor(value.actor), at: now, action: "建立" }] };
      data.games.push(game);
      return { status: 201, body: game };
    });
  }
  const gameId = /^\/api\/games\/([^/]+)$/.exec(path)?.[1];
  if (gameId && (method === "PUT" || method === "DELETE")) {
    const value = await body(request);
    return mutate(data => {
      const game = data.games.find(item => item.id === gameId && !item.archived);
      if (!game) fail(404, "找不到這場牌局");
      if (value.version !== game.version) fail(409, "這場已由別人更新，請重新載入後再修改");
      const now = new Date().toISOString();
      const by = actor(value.actor);
      const previous = { date: game.date, title: game.title, entries: game.entries };
      if (method === "DELETE") {
        game.archived = true;
        game.history.push({ actor: by, at: now, action: "刪除", previous });
      } else {
        const fields = gameFields(value, data.people, game.roomId);
        if (fields.date !== game.date && data.games.some(item => item.id !== game.id && item.roomId === game.roomId && item.date === fields.date && !item.archived)) fail(409, "這一天已有紀錄，請選擇其他日期");
        game.history.push({ actor: by, at: now, action: "修改", previous });
        Object.assign(game, fields);
      }
      game.version += 1;
      game.updatedAt = now;
      return { status: 200, body: game };
    });
  }
  if (path === "/api/reset-demo" && method === "POST") fail(409, "雲端帳本沒有示範資料");
  fail(404, "找不到此功能");
}

export async function handleApi(request: Request): Promise<Response> {
  try { return await route(request); }
  catch (error) {
    if (error instanceof ApiError) return output({ error: error.message }, error.status);
    console.error(error);
    return output({ error: "伺服器發生錯誤" }, 500);
  }
}
