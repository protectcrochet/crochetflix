const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const dbPath = path.join(__dirname, '../database/crochetflix.sqlite');
const db = new sqlite3.Database(dbPath);

const patronesDemo = [
  {
    titulo: 'Amigurumi Unicornio Mágico',
    descripcion: 'Un adorable unicornio de 15cm con cuerno dorado y melena arcoíris. Perfecto para regalo.',
    autor: 'Ana Crochet',
    categoria: 'amigurumi',
    dificultad: 'intermedio',
    tiempo_minutos: 180,
    paginas: 8,
    es_preview: 1
  },
  {
    titulo: 'Bufanda Otoño Dorado',
    descripcion: 'Bufanda texturizada en tonos otoñales con punto de relieve.',
    autor: 'María Puntos',
    categoria: 'ropa',
    dificultad: 'principiante',
    tiempo_minutos: 240,
    paginas: 5,
    es_preview: 0
  },
  {
    titulo: 'Gorro Beanie Clásico',
    descripcion: 'Gorro básico en punto elástico, adaptable a cualquier talla.',
    autor: 'Lucía Teje',
    categoria: 'ropa',
    dificultad: 'principiante',
    tiempo_minutos: 90,
    paginas: 4,
    es_preview: 0
  },
  {
    titulo: 'Conejito de Pascua',
    descripcion: 'Conejito con huevo decorativo. Ideal para decoración primaveral.',
    autor: 'Ana Crochet',
    categoria: 'amigurumi',
    dificultad: 'intermedio',
    tiempo_minutos: 150,
    paginas: 6,
    es_preview: 0
  },
  {
    titulo: 'Manta Bebé Nube',
    descripcion: 'Manta suave en punto waffle para bebé. Incluye borde decorativo.',
    autor: 'María Puntos',
    categoria: 'decoracion',
    dificultad: 'principiante',
    tiempo_minutos: 480,
    paginas: 7,
    es_preview: 0
  },
  {
    titulo: 'Bolso Playa Verano',
    descripcion: 'Bolso grande en punto red con asas reforzadas.',
    autor: 'Sofía Hilos',
    categoria: 'accesorios',
    dificultad: 'avanzado',
    tiempo_minutos: 360,
    paginas: 10,
    es_preview: 0
  },
  {
    titulo: 'Posavasos Geométricos',
    descripcion: 'Set de 4 posavasos hexagonales en colores vibrantes.',
    autor: 'Lucía Teje',
    categoria: 'decoracion',
    dificultad: 'principiante',
    tiempo_minutos: 60,
    paginas: 3,
    es_preview: 0
  },
  {
    titulo: 'Jirafa Safari',
    descripcion: 'Jirafa de 30cm con manchas bordadas. Proyecto de fin de semana.',
    autor: 'Ana Crochet',
    categoria: 'amigurumi',
    dificultad: 'intermedio',
    tiempo_minutos: 300,
    paginas: 9,
    es_preview: 0
  },
  {
    titulo: 'Guantes Sin Dedos',
    descripcion: 'Guantes elegantes en punto musgo con pulgar separado.',
    autor: 'María Puntos',
    categoria: 'ropa',
    dificultad: 'intermedio',
    tiempo_minutos: 180,
    paginas: 5,
    es_preview: 0
  },
  {
    titulo: 'Cesto Organizador',
    descripcion: 'Cesto rígido en punto cesta para organizar hilos o juguetes.',
    autor: 'Sofía Hilos',
    categoria: 'decoracion',
    dificultad: 'intermedio',
    tiempo_minutos: 270,
    paginas: 6,
    es_preview: 0
  }
];

async function seed() {
  console.log('🌱 Creando datos de prueba...');

  // Crear directorio de uploads si no existe
  const uploadsDir = path.join(__dirname, '../backend/uploads/patrones');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  for (const patronData of patronesDemo) {
    const patronId = uuidv4();

    // Insertar patrón
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO patrones (id, titulo, descripcion, autor, categoria, dificultad, tiempo_minutos, paginas, es_preview)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [patronId, patronData.titulo, patronData.descripcion, patronData.autor, 
         patronData.categoria, patronData.dificultad, patronData.tiempo_minutos, 
         patronData.paginas, patronData.es_preview],
        function(err) {
          if (err) reject(err);
          resolve();
        }
      );
    });

    // Crear páginas ficticias (en producción serían imágenes reales)
    const patronDir = path.join(uploadsDir, patronId);
    fs.mkdirSync(patronDir, { recursive: true });

    for (let i = 1; i <= patronData.paginas; i++) {
      const paginaId = uuidv4();
      const fileName = `pagina_${i}.jpg`;
      const filePath = path.join(patronDir, fileName);

      // Crear archivo placeholder (en producción sería imagen real)
      fs.writeFileSync(filePath, Buffer.from('PLACEHOLDER_IMAGE_DATA'));

      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO paginas (id, patron_id, numero, archivo_path) VALUES (?, ?, ?, ?)`,
          [paginaId, patronId, i, `${patronId}/${fileName}`],
          function(err) {
            if (err) reject(err);
            resolve();
          }
        );
      });
    }

    console.log(`✅ ${patronData.titulo} (${patronData.paginas} páginas)`);
  }

  console.log('🎉 Seed completado. 10 patrones creados.');
  db.close();
}

seed().catch(err => {
  console.error('Error:', err);
  db.close();
});