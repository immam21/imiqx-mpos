module.exports = async function handler(_req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  res.status(200).json({ ok: true, service: "onecounter-backend-vercel" });
};
