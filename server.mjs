import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  readFileSync,
  existsSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { resolve, extname, sep } from "node:path";
import {
  randomBytes,
  timingSafeEqual,
  scrypt as scryptCallback,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const scrypt = promisify(scryptCallback);
const token = () => randomBytes(32).toString("hex");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const fail = (status, message) => {
  const error = new Error(message);
  error.status = status;
  throw error;
};
const same = (a, b) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const text = (value, min, max, label) => {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.trim().length > max
  )
    fail(400, `${label}: použite ${min} až ${max} znakov.`);
  return value.trim();
};
const phoneNumber = (value) => {
  let phone = text(value, 7, 25, "Telefón").replace(/[\s()-]/g, "");
  if (!/^\+?\d{7,15}$/.test(phone))
    fail(400, "Vyplňte platné telefónne číslo.");
  if (phone.startsWith("00")) phone = "+" + phone.slice(2);
  if (/^0\d{9}$/.test(phone)) phone = "+421" + phone.slice(1);
  return phone;
};

export function validateOffer(body) {
  if (!body || typeof body !== "object") fail(400, "Vyplňte ponuku.");
  const title = text(body.title, 2, 100, "Názov ponuky");
  const date = body.date;
  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    fail(400, "Vyberte platný dátum odberu.");
  if (
    !Array.isArray(body.items) ||
    !body.items.length ||
    body.items.length > 40
  )
    fail(400, "Ponuka musí mať 1 až 40 výrobkov.");
  const items = body.items.map((item) => {
    if (!item || typeof item !== "object") fail(400, "Neplatný výrobok.");
    const name = text(item.name, 2, 100, "Názov výrobku");
    const description =
      typeof item.description === "string" ? item.description.trim() : "";
    if (description.length > 1500)
      fail(400, "Popis môže mať najviac 1 500 znakov.");
    if (!Number.isInteger(item.price) || item.price < 1 || item.price > 100000)
      fail(400, "Cena musí byť od 0,01 € do 1 000 €.");
    if (!Number.isInteger(item.stock) || item.stock < 1 || item.stock > 10000)
      fail(400, "Počet dostupných kusov musí byť od 1 do 10 000.");
    return { name, description, price: item.price, stock: item.stock };
  });
  return { title, date, items };
}

export function createApp({
  dataDir = process.env.DATA_DIR || resolve(".data"),
  adminToken = process.env.ADMIN_TOKEN,
  secureCookies = process.env.COOKIE_SECURE === "true",
  trustProxy = process.env.TRUST_PROXY === "true",
} = {}) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (!adminToken) {
    const file = resolve(dataDir, "admin-token");
    if (!existsSync(file)) writeFileSync(file, token(), { mode: 0o600 });
    adminToken = readFileSync(file, "utf8").trim();
  }
  if (adminToken.length < 16)
    throw new Error("ADMIN_TOKEN musí mať aspoň 16 znakov.");
  const db = new DatabaseSync(resolve(dataDir, "orders.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS members (id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, member_id INTEGER NOT NULL REFERENCES members(id), expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS offers (id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, pickup_date TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','published','closed')), created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, offer_id INTEGER NOT NULL REFERENCES offers(id), name TEXT NOT NULL, description TEXT NOT NULL, price INTEGER NOT NULL, stock INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS reservations (offer_id INTEGER NOT NULL REFERENCES offers(id), member_id INTEGER NOT NULL REFERENCES members(id), updated_at TEXT NOT NULL, PRIMARY KEY(offer_id, member_id));
    CREATE TABLE IF NOT EXISTS reservation_items (offer_id INTEGER NOT NULL, member_id INTEGER NOT NULL, product_id INTEGER NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL CHECK(quantity>0), PRIMARY KEY(offer_id,member_id,product_id), FOREIGN KEY(offer_id,member_id) REFERENCES reservations(offer_id,member_id) ON DELETE CASCADE);
  `);
  const rateLimits = new Map();
  const json = (res, status, data) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(data));
  };
  const parseBody = async (req) => {
    let bytes = 0;
    const chunks = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 131072) fail(413, "Požiadavka je príliš veľká.");
      chunks.push(chunk);
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      fail(400, "Neplatné údaje.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      fail(400, "Neplatné údaje.");
    return body;
  };
  const sessionMember = (req) => {
    const raw = (req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("iky_session="))
      ?.slice(12);
    if (!raw) return null;
    return (
      db
        .prepare(
          "SELECT m.id, m.name, m.phone FROM members m JOIN sessions s ON m.id=s.member_id WHERE s.token_hash=? AND s.expires_at>?",
        )
        .get(hash(raw), Date.now()) || null
    );
  };
  const issueSession = (res, memberId) => {
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
    const raw = token();
    db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(
      hash(raw),
      memberId,
      Date.now() + 30 * 86400000,
    );
    res.setHeader(
      "Set-Cookie",
      `iky_session=${raw}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secureCookies ? "; Secure" : ""}`,
    );
  };
  const admin = (req) => {
    const supplied = req.headers.authorization?.replace(/^Bearer /, "") || "";
    if (!same(supplied, adminToken)) fail(401, "Nesprávny prístupový kľúč.");
  };
  const requireMember = (req) => {
    const member = sessionMember(req);
    if (!member) fail(401, "Najprv sa prihláste do svojho účtu.");
    return member;
  };
  const getOffer = (slug) => {
    if (typeof slug !== "string" || !/^[a-f0-9]{32}$/.test(slug))
      fail(404, "Neplatný odkaz na ponuku.");
    const offer = db
      .prepare("SELECT * FROM offers WHERE slug=? AND status<>?")
      .get(slug, "draft");
    if (!offer)
      fail(404, "Táto ponuka neexistuje alebo ešte nie je zverejnená.");
    return offer;
  };
  const offerDetails = (offer, member = null) => {
    const items = db
      .prepare(
        "SELECT p.*, COALESCE((SELECT SUM(quantity) FROM reservation_items ri WHERE ri.product_id=p.id),0) AS sold FROM products p WHERE p.offer_id=? ORDER BY p.id",
      )
      .all(offer.id);
    const ownItems = member
      ? db
          .prepare(
            "SELECT product_id AS id, quantity FROM reservation_items WHERE offer_id=? AND member_id=?",
          )
          .all(offer.id, member.id)
      : [];
    return {
      id: offer.id,
      slug: offer.slug,
      title: offer.title,
      date: offer.pickup_date,
      status: offer.status,
      items: items.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        price: p.price,
        stock: p.stock,
        sold: p.sold,
        available: p.stock - p.sold,
      })),
      ownItems,
    };
  };
  const transaction = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      db.exec("COMMIT");
      return value;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  const saveProducts = (id, items) => {
    const insert = db.prepare(
      "INSERT INTO products (offer_id,name,description,price,stock) VALUES (?,?,?,?,?)",
    );
    for (const p of items)
      insert.run(id, p.name, p.description, p.price, p.stock);
  };
  const limit = (req, bucket, max) => {
    const now = Date.now();
    for (const [key, value] of rateLimits)
      if (value.until < now) rateLimits.delete(key);
    const address = trustProxy
      ? req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
        req.socket.remoteAddress
      : req.socket.remoteAddress;
    const key = `${bucket}:${address}`;
    const value = rateLimits.get(key) || { count: 0, until: now + 600000 };
    if (value.count >= max)
      fail(429, "Príliš veľa pokusov. Skúste to o chvíľu znova.");
    value.count++;
    rateLimits.set(key, value);
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    );
    try {
      const url = new URL(req.url, "http://localhost");
      if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
        if (req.headers["sec-fetch-site"] === "cross-site")
          fail(403, "Požiadavka musí prísť z tohto webu.");
        if (
          req.headers.origin &&
          new URL(req.headers.origin).host !== req.headers.host
        )
          fail(403, "Požiadavka musí prísť z tohto webu.");
        if (!req.headers["content-type"]?.startsWith("application/json"))
          fail(415, "Očakávajú sa údaje JSON.");
      }
      if (url.pathname === "/api/health" && req.method === "GET")
        return json(res, 200, {
          ok: db.prepare("SELECT 1 AS ok").get().ok === 1,
        });
      if (url.pathname === "/api/session" && req.method === "GET")
        return json(res, 200, { member: sessionMember(req) });
      if (url.pathname === "/api/register" && req.method === "POST") {
        limit(req, "register", 20);
        const body = await parseBody(req);
        const offer = getOffer(body.offerSlug);
        if (offer.status !== "published")
          fail(409, "Registrácia je dostupná cez otvorenú ponuku.");
        const name = text(body.name, 2, 100, "Meno");
        const phone = phoneNumber(body.phone);
        const password = text(body.password, 8, 128, "Heslo");
        if (body.consent !== true)
          fail(400, "Potvrďte oboznámenie so spracovaním údajov.");
        const salt = token();
        const passwordHash = (await scrypt(password, salt, 64)).toString("hex");
        let id;
        try {
          id = Number(
            db
              .prepare(
                "INSERT INTO members (name,phone,salt,password_hash,created_at) VALUES (?,?,?,?,?)",
              )
              .run(name, phone, salt, passwordHash, new Date().toISOString())
              .lastInsertRowid,
          );
        } catch (error) {
          if (error.message.includes("UNIQUE"))
            fail(409, "Toto telefónne číslo už má účet. Použite prihlásenie.");
          throw error;
        }
        issueSession(res, id);
        return json(res, 201, { member: { id, name, phone } });
      }
      if (url.pathname === "/api/login" && req.method === "POST") {
        limit(req, "login", 30);
        const body = await parseBody(req);
        const phone = phoneNumber(body.phone);
        const password = text(body.password, 8, 128, "Heslo");
        const member = db
          .prepare("SELECT * FROM members WHERE phone=?")
          .get(phone);
        const candidate = (
          await scrypt(password, member?.salt || "missing-account-salt", 64)
        ).toString("hex");
        if (!member || !same(candidate, member.password_hash))
          fail(401, "Nesprávne telefónne číslo alebo heslo.");
        issueSession(res, member.id);
        return json(res, 200, {
          member: { id: member.id, name: member.name, phone: member.phone },
        });
      }
      if (url.pathname === "/api/logout" && req.method === "POST") {
        const raw = (req.headers.cookie || "")
          .split(";")
          .map((x) => x.trim())
          .find((x) => x.startsWith("iky_session="))
          ?.slice(12);
        if (raw)
          db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hash(raw));
        res.setHeader(
          "Set-Cookie",
          `iky_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookies ? "; Secure" : ""}`,
        );
        return json(res, 200, { ok: true });
      }
      if (url.pathname === "/api/offers/current" && req.method === "GET")
        return json(res, 200, {
          available: !!db
            .prepare("SELECT id FROM offers WHERE status='published' LIMIT 1")
            .get(),
        });
      const orderMatch = url.pathname.match(
        /^\/api\/offers\/([a-f0-9]{32})\/order$/,
      );
      if (orderMatch && req.method === "PUT") {
        const member = requireMember(req);
        const body = await parseBody(req);
        if (!Array.isArray(body.items) || body.items.length > 40)
          fail(400, "Neplatná objednávka.");
        const offer = getOffer(orderMatch[1]);
        transaction(() => {
          if (
            db.prepare("SELECT status FROM offers WHERE id=?").get(offer.id)
              .status !== "published"
          )
            fail(409, "Objednávanie tejto ponuky je už uzavreté.");
          const seen = new Set();
          const valid = body.items.map((item) => {
            if (
              !item ||
              !Number.isInteger(item.id) ||
              !Number.isInteger(item.quantity) ||
              item.quantity < 1 ||
              seen.has(item.id)
            )
              fail(400, "Neplatný počet kusov.");
            seen.add(item.id);
            const p = db
              .prepare("SELECT * FROM products WHERE id=? AND offer_id=?")
              .get(item.id, offer.id);
            if (!p) fail(400, "Výrobok nepatrí do tejto ponuky.");
            const sold = db
              .prepare(
                "SELECT COALESCE(SUM(quantity),0) AS count FROM reservation_items WHERE product_id=? AND member_id<>?",
              )
              .get(item.id, member.id).count;
            if (item.quantity > p.stock - sold)
              fail(
                409,
                `Z výrobku „${p.name}“ môžete teraz objednať najviac ${p.stock - sold} ks. Obnovte ponuku.`,
              );
            return item;
          });
          db.prepare(
            "DELETE FROM reservations WHERE offer_id=? AND member_id=?",
          ).run(offer.id, member.id);
          if (valid.length) {
            db.prepare("INSERT INTO reservations VALUES (?,?,?)").run(
              offer.id,
              member.id,
              new Date().toISOString(),
            );
            const insert = db.prepare(
              "INSERT INTO reservation_items VALUES (?,?,?,?)",
            );
            for (const item of valid)
              insert.run(offer.id, member.id, item.id, item.quantity);
          }
        });
        return json(res, 200, {
          offer: offerDetails(offer, member),
          saved: true,
        });
      }
      const offerMatch = url.pathname.match(/^\/api\/offers\/([a-f0-9]{32})$/);
      if (offerMatch && req.method === "GET")
        return json(res, 200, {
          offer: offerDetails(getOffer(offerMatch[1]), sessionMember(req)),
        });
      if (url.pathname.startsWith("/api/admin/")) {
        limit(req, "admin", 200);
        admin(req);
        if (url.pathname === "/api/admin/dashboard" && req.method === "GET") {
          const offers = db
            .prepare("SELECT * FROM offers ORDER BY id DESC")
            .all()
            .map((offer) => {
              const orders = db
                .prepare(
                  "SELECT r.member_id AS memberId, m.name, m.phone, r.updated_at AS updatedAt FROM reservations r JOIN members m ON m.id=r.member_id WHERE r.offer_id=? ORDER BY m.name",
                )
                .all(offer.id)
                .map((order) => ({
                  ...order,
                  items: db
                    .prepare(
                      "SELECT product_id AS id, quantity FROM reservation_items WHERE offer_id=? AND member_id=?",
                    )
                    .all(offer.id, order.memberId),
                }));
              return { ...offerDetails(offer), orders };
            });
          return json(res, 200, { offers });
        }
        if (url.pathname === "/api/admin/offers" && req.method === "POST") {
          const data = validateOffer(await parseBody(req));
          const id = transaction(() => {
            const result = db
              .prepare(
                "INSERT INTO offers (slug,title,pickup_date,status,created_at) VALUES (?,?,?,?,?)",
              )
              .run(
                randomBytes(16).toString("hex"),
                data.title,
                data.date,
                "draft",
                new Date().toISOString(),
              );
            const id = Number(result.lastInsertRowid);
            saveProducts(id, data.items);
            return id;
          });
          return json(res, 201, { id });
        }
        const editMatch = url.pathname.match(/^\/api\/admin\/offers\/(\d+)$/);
        if (editMatch && req.method === "PUT") {
          const data = validateOffer(await parseBody(req));
          const id = Number(editMatch[1]);
          transaction(() => {
            const offer = db.prepare("SELECT * FROM offers WHERE id=?").get(id);
            if (!offer) fail(404, "Ponuka neexistuje.");
            if (offer.status !== "draft")
              fail(
                409,
                "Zverejnenú ponuku už nemožno meniť. Vytvorte novú ponuku.",
              );
            db.prepare(
              "UPDATE offers SET title=?, pickup_date=? WHERE id=?",
            ).run(data.title, data.date, id);
            db.prepare("DELETE FROM products WHERE offer_id=?").run(id);
            saveProducts(id, data.items);
          });
          return json(res, 200, { ok: true });
        }
        const actionMatch = url.pathname.match(
          /^\/api\/admin\/offers\/(\d+)\/(publish|close)$/,
        );
        if (actionMatch && req.method === "POST") {
          const id = Number(actionMatch[1]);
          transaction(() => {
            const offer = db.prepare("SELECT * FROM offers WHERE id=?").get(id);
            if (!offer) fail(404, "Ponuka neexistuje.");
            if (actionMatch[2] === "publish") {
              if (offer.status !== "draft")
                fail(409, "Zverejniť možno iba rozpracovanú ponuku.");
              db.prepare(
                "UPDATE offers SET status='closed' WHERE status='published'",
              ).run();
              db.prepare("UPDATE offers SET status='published' WHERE id=?").run(
                id,
              );
            } else {
              if (offer.status !== "published")
                fail(409, "Ponuka nie je otvorená.");
              db.prepare("UPDATE offers SET status='closed' WHERE id=?").run(
                id,
              );
            }
          });
          return json(res, 200, { ok: true });
        }
        const resetMatch = url.pathname.match(
          /^\/api\/admin\/members\/(\d+)\/password$/,
        );
        if (resetMatch && req.method === "POST") {
          const body = await parseBody(req);
          const password = text(body.password, 8, 128, "Nové heslo");
          const salt = token();
          const passwordHash = (await scrypt(password, salt, 64)).toString(
            "hex",
          );
          transaction(() => {
            const result = db
              .prepare("UPDATE members SET salt=?, password_hash=? WHERE id=?")
              .run(salt, passwordHash, Number(resetMatch[1]));
            if (!result.changes) fail(404, "Člen neexistuje.");
            db.prepare("DELETE FROM sessions WHERE member_id=?").run(
              Number(resetMatch[1]),
            );
          });
          return json(res, 200, { ok: true });
        }
        if (url.pathname === "/api/admin/members" && req.method === "GET")
          return json(res, 200, {
            members: db
              .prepare("SELECT id,name,phone FROM members ORDER BY name")
              .all(),
          });
      }
      if (url.pathname.startsWith("/api/"))
        return json(res, 404, { error: "Nenájdené." });
      if (req.method !== "GET" && req.method !== "HEAD")
        return json(res, 405, { error: "Nepovolená metóda." });
      const root = resolve("dist");
      const spa =
        url.pathname === "/" ||
        url.pathname === "/admin" ||
        /^\/ponuka\/[a-f0-9]{32}$/.test(url.pathname);
      const file = resolve(
        root,
        "." + decodeURIComponent(spa ? "/index.html" : url.pathname),
      );
      if (
        !file.startsWith(root + sep) ||
        !existsSync(file) ||
        !statSync(file).isFile()
      )
        return json(res, 404, {
          error: "Stránka neexistuje. Najprv spustite npm run build.",
        });
      const types = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
      };
      res.writeHead(200, {
        "Content-Type": types[extname(file)] || "application/octet-stream",
        "Cache-Control":
          extname(file) === ".html" ? "no-cache" : "public, max-age=3600",
      });
      res.end(req.method === "HEAD" ? undefined : readFileSync(file));
    } catch (error) {
      if (!error.status) console.error("Request failed:", error.message);
      json(res, error.status || 500, {
        error: error.status
          ? error.message
          : "Niečo sa nepodarilo. Skúste to znova.",
      });
    }
  });
  server.on("close", () => db.close());
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, "0.0.0.0", () =>
    console.log(
      `Chlebíky od Iky: port ${port}. Správa ponúk: /admin. Kľúč je v .data/admin-token alebo ADMIN_TOKEN.`,
    ),
  );
}
