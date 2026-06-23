const db = require('../models');

exports.listar = (req, res) => {
  db.all(
    `SELECT c.id, c.nombre, c.descripcion, c.emoji, c.orden
     FROM colecciones c WHERE c.activo = 1 ORDER BY c.orden ASC, c.created_at ASC`,
    [],
    (err, cols) => {
      if (err) return res.status(500).json({ error: 'Error interno' });
      if (!cols.length) return res.json([]);

      let pendientes = cols.length;
      const resultado = cols.map(c => ({ ...c, patrones: [] }));

      resultado.forEach((col, i) => {
        db.all(
          `SELECT p.id, p.titulo, p.autor, p.diseñadora, p.categoria, p.dificultad,
                  p.thumbnail_path, p.es_preview
           FROM coleccion_patrones cp
           JOIN patrones p ON p.id = cp.patron_id
           WHERE cp.coleccion_id = ? AND p.activo = 1
           ORDER BY cp.orden ASC`,
          [col.id],
          (err2, patrones) => {
            resultado[i].patrones = patrones || [];
            if (--pendientes === 0) res.json(resultado);
          }
        );
      });
    }
  );
};

exports.detalle = (req, res) => {
  const { id } = req.params;
  db.get(`SELECT * FROM colecciones WHERE id = ? AND activo = 1`, [id], (err, col) => {
    if (err) return res.status(500).json({ error: 'Error interno' });
    if (!col) return res.status(404).json({ error: 'Colección no encontrada' });

    db.all(
      `SELECT p.id, p.titulo, p.autor, p.diseñadora, p.categoria, p.subcategoria,
              p.dificultad, p.thumbnail_path, p.es_preview, p.paginas
       FROM coleccion_patrones cp
       JOIN patrones p ON p.id = cp.patron_id
       WHERE cp.coleccion_id = ? AND p.activo = 1
       ORDER BY cp.orden ASC`,
      [id],
      (err2, patrones) => {
        if (err2) return res.status(500).json({ error: 'Error interno' });
        res.json({ ...col, patrones: patrones || [] });
      }
    );
  });
};
