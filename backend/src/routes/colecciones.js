const express = require('express');
const router = express.Router();
const coleccionController = require('../controllers/coleccionController');

router.get('/', coleccionController.listar);
router.get('/:id', coleccionController.detalle);

module.exports = router;
