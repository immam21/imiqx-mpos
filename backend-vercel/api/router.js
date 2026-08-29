const v1Handler = require("./v1/[...route].js");

module.exports = async function handler(req, res) {
  const rawRoute = req.query && req.query.route;
  const routeText = Array.isArray(rawRoute) ? rawRoute.join("/") : String(rawRoute || "");
  const normalizedRoute = routeText.replace(/^\/+/, "").replace(/^v1\/?/, "");
  req.query = { ...(req.query || {}), route: normalizedRoute ? normalizedRoute.split("/") : [] };
  return v1Handler(req, res);
};