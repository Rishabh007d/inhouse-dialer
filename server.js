const express = require("express");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");

const { JWT_SECRET, ADMIN_USER = "admin", ADMIN_PASS, SIP_WSS, SIP_DOMAIN, PORT = 3000 } = process.env;
if (!JWT_SECRET || !ADMIN_PASS) { console.error("JWT_SECRET aur ADMIN_PASS set karo (.env.example dekho)"); process.exit(1); }

const db = new Database("dialer.db");
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent', ext TEXT, ext_secret TEXT, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS calls(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, type TEXT NOT NULL, number TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
if (!db.prepare("SELECT 1 FROM users WHERE username=?").get(ADMIN_USER))
  db.prepare("INSERT INTO users(username,hash,role) VALUES(?,?,'admin')").run(ADMIN_USER, bcrypt.hashSync(ADMIN_PASS, 12));

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "10kb" }), cookieParser());

const publicUser = u => ({ username: u.username, role: u.role });
const sipFor = u => (u.ext && u.ext_secret && SIP_WSS && SIP_DOMAIN)
  ? { wss: SIP_WSS, domain: SIP_DOMAIN, ext: u.ext, secret: u.ext_secret } : null;

function auth(req, res, next) {
  try {
    const { id } = jwt.verify(req.cookies.tok || "", JWT_SECRET);
    const u = db.prepare("SELECT * FROM users WHERE id=? AND active=1").get(id);
    if (!u) throw new Error();
    req.user = u; next();
  } catch (e) { res.status(401).json({ error: "Login karo" }); }
}
const admin = (req, res, next) => auth(req, res, () =>
  req.user.role === "admin" ? next() : res.status(403).json({ error: "Sirf admin" }));

const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: "Bahut attempts. 15 minute baad try karo." } });

app.post("/api/login", loginLimit, (req, res) => {
  const { username = "", password = "" } = req.body;
  const u = db.prepare("SELECT * FROM users WHERE username=? AND active=1").get(String(username));
  if (!u || !bcrypt.compareSync(String(password), u.hash)) return res.status(401).json({ error: "ID ya password galat hai" });
  res.cookie("tok", jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: "12h" }),
    { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", maxAge: 12 * 3600 * 1000 });
  res.json({ user: publicUser(u), sip: sipFor(u) });
});
app.post("/api/logout", (req, res) => { res.clearCookie("tok"); res.json({ ok: true }); });
app.get("/api/me", auth, (req, res) => res.json({ user: publicUser(req.user), sip: sipFor(req.user) }));

// har user ki apni call history
app.get("/api/calls", auth, (req, res) =>
  res.json({ calls: db.prepare("SELECT type,number,at FROM calls WHERE user_id=? ORDER BY id DESC LIMIT 50").all(req.user.id) }));
app.post("/api/calls", auth, (req, res) => {
  const { type, number } = req.body;
  if (!["in", "out", "miss"].includes(type) || !number) return res.status(400).json({ error: "Invalid" });
  db.prepare("INSERT INTO calls(user_id,type,number) VALUES(?,?,?)").run(req.user.id, type, String(number).slice(0, 40));
  res.json({ ok: true });
});

// admin: users banao / manage karo
app.get("/api/admin/users", admin, (req, res) =>
  res.json({ users: db.prepare("SELECT id,username,role,ext,active FROM users ORDER BY id").all() }));
app.post("/api/admin/users", admin, (req, res) => {
  const { username, password, ext, ext_secret, role = "agent" } = req.body;
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username || "")) return res.status(400).json({ error: "User ID 3-32 letters/numbers ho" });
  if (!password || password.length < 8) return res.status(400).json({ error: "Password kam se kam 8 character ka ho" });
  if (!["agent", "admin"].includes(role)) return res.status(400).json({ error: "Role galat hai" });
  try {
    db.prepare("INSERT INTO users(username,hash,role,ext,ext_secret) VALUES(?,?,?,?,?)")
      .run(username, bcrypt.hashSync(password, 12), role, ext || null, ext_secret || null);
    res.json({ ok: true });
  } catch (e) { res.status(409).json({ error: "Ye User ID pehle se hai" }); }
});
app.patch("/api/admin/users/:id", admin, (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if (!u) return res.status(404).json({ error: "User nahi mila" });
  const { password, ext, ext_secret, active } = req.body;
  if (password && password.length < 8) return res.status(400).json({ error: "Password kam se kam 8 character ka ho" });
  if (u.id === req.user.id && active === 0) return res.status(400).json({ error: "Khud ko disable nahi kar sakte" });
  db.prepare("UPDATE users SET hash=?,ext=?,ext_secret=?,active=? WHERE id=?")
    .run(password ? bcrypt.hashSync(password, 12) : u.hash, ext ?? u.ext, ext_secret ?? u.ext_secret, active ?? u.active, u.id);
  res.json({ ok: true });
});
app.delete("/api/admin/users/:id", admin, (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: "Khud ko delete nahi kar sakte" });
  db.prepare("DELETE FROM calls WHERE user_id=?").run(req.params.id);
  db.prepare("DELETE FROM users WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

app.use(express.static("public"));
app.listen(PORT, () => console.log("Dialer server chal raha hai: http://localhost:" + PORT));
