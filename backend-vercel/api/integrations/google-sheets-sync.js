const v1Handler = require("../v1/[...route].js");

module.exports = async function handler(req, res) {
  req.query = { ...(req.query || {}), route: ["integrations", "google-sheets-sync"] };
  return v1Handler(req, res);
};