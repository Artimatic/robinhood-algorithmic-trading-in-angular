const express = require('express');
const handler = require('./quote.router');

const router = express.Router();

router.post('/', handler.quote);

module.exports = router;