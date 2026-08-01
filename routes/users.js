var express = require('express');
var router = express.Router();

// GET users listing route
// When a user visits '/users', respond with a simple message.
router.get('/', function(req, res, next) {
  res.send('respond with a resource');
});

// Export the router so it can be mounted in app.js
module.exports = router;
