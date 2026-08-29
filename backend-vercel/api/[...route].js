const v1Handler = require("./v1/[...route].js");

module.exports = async function handler(req, res) {
  const route = Array.isArray(req.query && req.query.route) ? req.query.route : [];
  const normalizedRoute = route[0] === "v1" ? route.slice(1) : route;
  req.query = { ...(req.query || {}), route: normalizedRoute };
  return v1Handler(req, res);
};