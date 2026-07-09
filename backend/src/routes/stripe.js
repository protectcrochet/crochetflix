const express = require('express');
const router = express.Router();

// Stripe webhooks — placeholder
router.post('/webhook', (req, res) => {
  res.json({ received: true });
});

module.exports = router;
