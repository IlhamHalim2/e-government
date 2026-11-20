"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "ekelurahan.sqlite");
const MAX_ATTACHMENT_BYTES = 1.5 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 5;
const ATTACHMENT_TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".pdf": "application/pdf" };
const sessions = new Map();

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_FILE);

let legacyAccounts = [];
const accountColumns = db.prepare("PRAGMA table_info(accounts)").all();
if (accountColumns.length && !accountColumns.some(column => column.name === "password_hash")) {
  legacyAccounts = db.prepare("SELECT email, password, role, name, initials, nik FROM accounts").all();
  db.exec("DROP TABLE accounts");
}

db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS accounts (
    email TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    name TEXT NOT NULL,
    initials TEXT NOT NULL,
    nik TEXT
  );
  CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    nik TEXT NOT NULL,
    phone TEXT,
    type TEXT NOT NULL,
    date TEXT NOT NULL,
    status TEXT NOT NULL,
    rt TEXT,
    note TEXT,
    attachments TEXT,
    owner_email TEXT,
    letter_no TEXT,
    signed_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

const hashPassword = password => {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
};

function verifyPassword(password, storedHash) {
  const [algorithm, saltHex, hashHex] = String(storedHash || "").split("$");
  if (algorithm !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

const obsoleteDemoEmails = new Set([
  "operator@cihideung.go.id",
  "warga@cihideung.go.id",
  "lurah@cihideung.go.id"
]);
const insertLegacyAccount = db.prepare(`
  INSERT OR IGNORE INTO accounts (email, password_hash, role, name, initials, nik)
  VALUES (?, ?, ?, ?, ?, ?)
`);
for (const account of legacyAccounts) {
  if (!obsoleteDemoEmails.has(String(account.email).toLowerCase())) {
    insertLegacyAccount.run(
      account.email,
      hashPassword(String(account.password || crypto.randomBytes(24).toString("base64url"))),
      account.role,
      account.name,
      account.initials,
      account.nik
    );
  }
}

function seedStaffAccount({ email, role, name, initials, passwordEnv }) {
  if (db.prepare("SELECT email FROM accounts WHERE email = ?").get(email)) return;
  const configuredPassword = process.env[passwordEnv];
  if (configuredPassword && configuredPassword.length < 12) {
    throw new Error(`${passwordEnv} harus memiliki minimal 12 karakter.`);
  }
  const password = configuredPassword || crypto.randomBytes(18).toString("base64url");
  db.prepare(`
    INSERT INTO accounts (email, password_hash, role, name, initials)
    VALUES (?, ?, ?, ?, ?)
  `).run(email, hashPassword(password), role, name, initials);
  if (!process.env[passwordEnv]) {
    console.log(`Akun awal ${role}: ${email} / ${password}`);
    console.log("Simpan kata sandi ini. Kata sandi tidak disimpan dalam bentuk teks dan tidak ditampilkan lagi.");
  }
}

seedStaffAccount({
  email: process.env.OPERATOR_EMAIL || "operator@cihideung.go.id",
  role: "Operator Kelurahan",
  name: "Operator Kelurahan",
  initials: "OK",
  passwordEnv: "OPERATOR_PASSWORD"
});
seedStaffAccount({
  email: process.env.LURAH_EMAIL || "lurah@cihideung.go.id",
  role: "Lurah / Seklur",
  name: "Lurah / Seklur",
  initials: "LS",
  passwordEnv: "LURAH_PASSWORD"
});

const sampleIds = ["EKL-2026-00423", "EKL-2026-00424", "EKL-2026-00425", "EKL-2026-00426", "EKL-2026-00427", "EKL-2026-00428"];
const removeOldSamples = db.prepare("DELETE FROM requests WHERE id = ? AND name = ?");
const sampleOwners = new Map([
  ["EKL-2026-00423", "Budi Setiawan"],
  ["EKL-2026-00424", "Yuni Kartika"],
  ["EKL-2026-00425", "Ahmad Fauzan"],
  ["EKL-2026-00426", "Rina Marlina"],
  ["EKL-2026-00427", "Dimas Saputra"],
  ["EKL-2026-00428", "Siti Nurhaliza"]
]);
for (const id of sampleIds) removeOldSamples.run(id, sampleOwners.get(id));

function mapRequest(row) {
  if (!row) return null;
  const storedAttachments = JSON.parse(row.attachments || "[]");
  if (!Array.isArray(storedAttachments)) throw new Error(`Format lampiran permohonan ${row.id} tidak valid.`);
  const attachments = storedAttachments.map(attachment => {
    if (typeof attachment === "string") return attachment;
    return {
      name: attachment.name,
      size: attachment.size,
      type: attachment.type,
      available: typeof attachment.dataUrl === "string"
    };
  });
  return {
    id: row.id,
    name: row.name,
    nik: row.nik,
    phone: row.phone,
    type: row.type,
    date: row.date,
    status: row.status,
    rt: row.rt,
    note: row.note,
    attachments,
    ownerEmail: row.owner_email,
    letterNo: row.letter_no,
    signedAt: row.signed_at,
    createdAt: row.created_at
  };
}

function readRequests() {
  return db.prepare("SELECT * FROM requests ORDER BY created_at DESC").all().map(mapRequest);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 12 * 1024 * 1024) {
        reject(new Error("Ukuran payload terlalu besar."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (error) { reject(new Error("JSON tidak valid.")); }
    });
  });
}

function getCookie(req, name) {
  const match = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function getUser(req) {
  const token = getCookie(req, "ekelurahan_session");
  const email = token ? sessions.get(token) : null;
  if (!email) return null;
  const account = db.prepare("SELECT email, role, name, initials, nik FROM accounts WHERE email = ?").get(email);
  return account || null;
}

function requireAuth(req, res) {
  const user = getUser(req);
  if (!user) {
    sendJson(res, 401, { error: "Sesi belum masuk atau telah berakhir." });
    return null;
  }
  return user;
}

function visibleRequests(user, items) {
  return user.role === "Warga / Pemohon"
    ? items.filter(item => item.ownerEmail === user.email)
    : items;
}

function canReject(user, item) {
  return (user.role === "Operator Kelurahan" && item.status === "Menunggu verifikasi")
    || (user.role === "Lurah / Seklur" && item.status === "Menunggu tanda tangan");
}

async function apiHandler(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readJson(req);
    const email = String(body.email || "").trim().toLowerCase();
    const account = db.prepare("SELECT * FROM accounts WHERE email = ?").get(email);
    if (!account || typeof body.password !== "string" || !verifyPassword(body.password, account.password_hash)) {
      return sendJson(res, 401, { error: "Email atau kata sandi tidak sesuai." });
    }
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, email);
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.setHeader("Set-Cookie", `ekelurahan_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${8 * 60 * 60}${secure}`);
    return sendJson(res, 200, {
      user: { email: account.email, role: account.role, name: account.name, initials: account.initials, nik: account.nik }
    });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/register") {
    const body = await readJson(req);
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const nik = String(body.nik || "").trim();
    const password = body.password;
    if (name.length < 3 || name.length > 100) {
      return sendJson(res, 400, { error: "Nama harus terdiri dari 3 sampai 100 karakter." });
    }
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendJson(res, 400, { error: "Format email tidak valid." });
    }
    if (!/^\d{16}$/.test(nik)) {
      return sendJson(res, 400, { error: "NIK harus terdiri dari 16 angka." });
    }
    if (typeof password !== "string" || password.length < 12 || password.length > 128) {
      return sendJson(res, 400, { error: "Kata sandi harus terdiri dari 12 sampai 128 karakter." });
    }
    if (db.prepare("SELECT email FROM accounts WHERE email = ?").get(email)) {
      return sendJson(res, 409, { error: "Email sudah terdaftar. Silakan masuk." });
    }
    if (db.prepare("SELECT email FROM accounts WHERE nik = ?").get(nik)) {
      return sendJson(res, 409, { error: "NIK sudah terdaftar pada akun lain." });
    }
    const user = {
      email,
      role: "Warga / Pemohon",
      name,
      initials: name.split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase(),
      nik
    };
    db.prepare(`
      INSERT INTO accounts (email, password_hash, role, name, initials, nik)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(email, hashPassword(password), user.role, user.name, user.initials, user.nik);
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, email);
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.setHeader("Set-Cookie", `ekelurahan_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${8 * 60 * 60}${secure}`);
    return sendJson(res, 201, { user });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const token = getCookie(req, "ekelurahan_session");
    if (token) sessions.delete(token);
    res.setHeader("Set-Cookie", "ekelurahan_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/me") {
    return sendJson(res, 200, { user: getUser(req) });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  if (req.method === "GET" && url.pathname === "/api/requests") {
    return sendJson(res, 200, { requests: visibleRequests(user, readRequests()) });
  }

  const attachmentMatch = url.pathname.match(/^\/api\/requests\/([^/]+)\/attachments\/(\d+)$/);
  if (req.method === "GET" && attachmentMatch) {
    const id = decodeURIComponent(attachmentMatch[1]);
    const index = Number(attachmentMatch[2]);
    const row = db.prepare("SELECT id, owner_email, attachments FROM requests WHERE id = ?").get(id);
    if (!row) return sendJson(res, 404, { error: "Permohonan tidak ditemukan." });
    if (user.role === "Warga / Pemohon" && row.owner_email !== user.email) {
      return sendJson(res, 403, { error: "Anda tidak memiliki akses ke berkas ini." });
    }

    const attachments = JSON.parse(row.attachments || "[]");
    const attachment = Array.isArray(attachments) ? attachments[index] : null;
    if (!attachment || typeof attachment !== "object" || typeof attachment.dataUrl !== "string") {
      return sendJson(res, 404, { error: "Berkas persyaratan tidak tersedia." });
    }
    const match = attachment.dataUrl.match(/^data:(application\/pdf|image\/jpeg|image\/png);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match || match[1] !== attachment.type) {
      return sendJson(res, 422, { error: "Format berkas persyaratan tidak valid." });
    }

    const content = Buffer.from(match[2], "base64");
    const fileName = String(attachment.name || "berkas-persyaratan");
    const encodedName = encodeURIComponent(fileName).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
    res.writeHead(200, {
      "Content-Type": match[1],
      "Content-Length": content.length,
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodedName}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store"
    });
    return res.end(content);
  }

  if (req.method === "POST" && url.pathname === "/api/requests") {
    if (user.role !== "Warga / Pemohon") return sendJson(res, 403, { error: "Hanya warga yang dapat membuat permohonan." });
    const body = await readJson(req);
    if (!/^\d{16}$/.test(body.nik || "")) {
      return sendJson(res, 400, { error: "NIK harus terdiri dari 16 angka." });
    }
    if (body.attachments !== undefined && !Array.isArray(body.attachments)) {
      return sendJson(res, 400, { error: "Format lampiran tidak valid." });
    }
    const incomingAttachments = body.attachments || [];
    if (incomingAttachments.length > MAX_ATTACHMENT_COUNT) {
      return sendJson(res, 400, { error: `Pilih maksimal ${MAX_ATTACHMENT_COUNT} file persyaratan.` });
    }
    let totalAttachmentBytes = 0;
    const attachments = [];
    for (const file of incomingAttachments) {
      const name = String(file?.name || "").trim();
      const type = ATTACHMENT_TYPES[path.extname(name).toLowerCase()];
      const dataUrlMatch = typeof file?.dataUrl === "string"
        ? file.dataUrl.match(/^data:(application\/pdf|image\/jpeg|image\/png);base64,([A-Za-z0-9+/]+={0,2})$/)
        : null;
      if (!name || name.length > 255 || !type || type !== file.type || !dataUrlMatch || dataUrlMatch[1] !== type) {
        return sendJson(res, 400, { error: "Berkas harus berupa PDF, JPG, atau PNG yang valid." });
      }
      const content = Buffer.from(dataUrlMatch[2], "base64");
      if (!content.length || content.toString("base64") !== dataUrlMatch[2] || Number(file.size) !== content.length) {
        return sendJson(res, 400, { error: `Isi berkas ${name} tidak valid.` });
      }
      totalAttachmentBytes += content.length;
      if (totalAttachmentBytes > MAX_ATTACHMENT_BYTES) {
        return sendJson(res, 400, { error: "Total ukuran berkas maksimal 1,5 MB." });
      }
      attachments.push({ name, size: content.length, type, dataUrl: file.dataUrl });
    }
    const now = new Date();
    const latest = db.prepare("SELECT id FROM requests ORDER BY created_at DESC LIMIT 1").get();
    const sequence = latest ? Number(String(latest.id).match(/(\d+)$/)?.[1] || 428) : 428;
    const id = `EKL-${now.getFullYear()}-${String(sequence + 1).padStart(5, "0")}`;
    const date = new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(now);
    const item = {
      id,
      name: String(body.name || "").trim(),
      nik: `${body.nik.slice(0, 6)}••••••${body.nik.slice(-4)}`,
      phone: String(body.phone || "").trim(),
      type: String(body.type || "").trim(),
      date,
      status: "Menunggu verifikasi",
      rt: String(body.rt || "").trim(),
      note: String(body.note || "").trim(),
      attachments,
      ownerEmail: user.role === "Warga / Pemohon" ? user.email : null,
      createdAt: now.toISOString()
    };
    db.prepare(`
      INSERT INTO requests (id, name, nik, phone, type, date, status, rt, note, attachments, owner_email)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(item.id, item.name, item.nik, item.phone, item.type, item.date, item.status, item.rt, item.note, JSON.stringify(item.attachments), item.ownerEmail);
    return sendJson(res, 201, { request: mapRequest(db.prepare("SELECT * FROM requests WHERE id = ?").get(item.id)) });
  }

  const statusMatch = url.pathname.match(/^\/api\/requests\/([^/]+)\/status$/);
  if (req.method === "PATCH" && statusMatch) {
    const id = decodeURIComponent(statusMatch[1]);
    const body = await readJson(req);
    const row = db.prepare("SELECT * FROM requests WHERE id = ?").get(id);
    if (!row) return sendJson(res, 404, { error: "Data permohonan tidak ditemukan." });
    const item = mapRequest(row);
    if (user.role === "Warga / Pemohon" && item.ownerEmail !== user.email) {
      return sendJson(res, 403, { error: "Anda hanya dapat mengakses permohonan milik akun ini." });
    }
    const authorized = (body.status === "Menunggu tanda tangan" && user.role === "Operator Kelurahan" && item.status === "Menunggu verifikasi")
      || (body.status === "Selesai" && user.role === "Lurah / Seklur" && item.status === "Menunggu tanda tangan")
      || (body.status === "Ditolak" && canReject(user, item));
    if (!authorized) return sendJson(res, 403, { error: "Aksi ini hanya dapat dilakukan petugas yang berwenang." });

    let signedAt = row.signed_at;
    if (body.status === "Selesai") signedAt = new Date().toISOString();
    db.prepare("UPDATE requests SET status = ?, note = ?, letter_no = ?, signed_at = ? WHERE id = ?")
      .run(body.status, body.note !== undefined ? String(body.note) : row.note, row.letter_no, signedAt, id);
    return sendJson(res, 200, { request: mapRequest(db.prepare("SELECT * FROM requests WHERE id = ?").get(id)) });
  }

  return sendJson(res, 404, { error: "Endpoint tidak ditemukan." });
}

function serveStatic(req, res, url) {
  let relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const filePath = path.resolve(ROOT, relative);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    sendJson(res, 403, { error: "Akses ditolak." });
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) return sendJson(res, 404, { error: "Berkas tidak ditemukan." });
    const ext = path.extname(filePath).toLowerCase();
    const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg" };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) await apiHandler(req, res, url);
    else {
      if (req.method !== "GET") return sendJson(res, 405, { error: "Metode tidak diizinkan." });
      serveStatic(req, res, url);
    }
  } catch (error) {
    sendJson(res, 500, { error: "Terjadi kesalahan pada server.", detail: error.message });
  }
});

server.listen(PORT, HOST, () => console.log(`E-Kelurahan aktif di http://${HOST}:${PORT}`));

