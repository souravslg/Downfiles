const app = require("../server/index.js");

module.exports = (req, res) => {
    return app(req, res);
};
