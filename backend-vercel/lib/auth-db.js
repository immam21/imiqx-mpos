const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const USERS_DB_PATH = process.env.USERS_DB_PATH || path.join(__dirname, "..", "data", "users.db.json");

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function loadUsersDb() {
  try {
    const raw = fs.readFileSync(USERS_DB_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.users) ? parsed : { users: [] };
  } catch (_) {
    return { users: [] };
  }
}

function findUserByEmail(email) {
  const db = loadUsersDb();
  const normalized = String(email || "").trim().toLowerCase();
  return db.users.find((u) => String(u.email || "").toLowerCase() === normalized && u.active !== false) || null;
}

function verifyPassword(user, password) {
  if (!user || !user.password_hash) {
    return false;
  }
  return sha256(password) === String(user.password_hash);
}

module.exports = {
  sha256,
  findUserByEmail,
  verifyPassword
};
