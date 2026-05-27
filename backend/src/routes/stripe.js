const express = require('express');
const router = express.Router();
const stripeCtrl = require('../controllers/stripeController');
const authMiddleware = require('../middleware/auth');

router.post('/checkout', authMiddleware, stripeCtrl.crearCheckout);
router.post('/webhook', stripeCtrl.webhook);       // público — verificado por firma
router.post('/portal', authMiddleware, stripeCtrl.portal);

module.exports = router;
