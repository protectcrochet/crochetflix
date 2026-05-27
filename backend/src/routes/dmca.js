const express = require('express');
const router = express.Router();
const dmcaController = require('../controllers/dmcaController');

router.post('/', dmcaController.submitClaim);

module.exports = router;
