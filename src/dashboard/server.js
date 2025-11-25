// server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Static files (frontend)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, 'public')));

// Postgres pool
const pool = new Pool({
    host: process.env.PGHOST,
    port: process.env.PGPORT,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
});

// --- API: listado de llamados (tarjetas) ---
// Usa v_llamados_dashboard, que ya junta llamados + mejor análisis IA + adjuntos. :contentReference[oaicite:2]{index=2}
app.get('/api/llamados', async (req, res) => {
    try {
        const { rows } = await pool.query(`
      SELECT
        l.*,
        fu.es_relevante_real,
        fu.estado_seguimiento
      FROM v_llamados_dashboard l
      LEFT JOIN feedback_usuario fu
        ON fu.llamado_id = l.llamado_id
      ORDER BY
        l.dias_restantes ASC NULLS LAST,
        l.fecha_apertura ASC NULLS LAST;
    `);
        res.json(rows);
    } catch (err) {
        console.error('Error en GET /api/llamados', err);
        res.status(500).json({ error: 'Error al obtener llamados' });
    }
});

// --- API: detalle de un llamado ---
app.get('/api/llamados/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const client = await pool.connect();
        try {
            const llamadoQ = client.query(
                `
        SELECT
          l.*,
          fu.es_relevante_real,
          fu.estado_seguimiento,
          fu.comentario,
          fu.ia_es_relevante,
          fu.ia_confianza,
          fu.ia_razon
        FROM v_llamados_dashboard l
        LEFT JOIN feedback_usuario fu
          ON fu.llamado_id = l.llamado_id
        WHERE l.llamado_id = $1
        `,
                [id]
            );

            const adjuntosQ = client.query(
                `
        SELECT id, nombre, tipo, archivo_url, label
        FROM archivos_adjuntos
        WHERE llamado_id = $1
        ORDER BY id ASC;
        `,
                [id]
            );

            const aclaracionesQ = client.query(
                `
        SELECT id, fecha, hora, texto, archivo_url
        FROM aclaraciones
        WHERE id_llamado = $1
        ORDER BY fecha DESC, hora DESC;
        `,
                [id]
            );

            const [llamadoRes, adjuntosRes, aclaracionesRes] = await Promise.all([
                llamadoQ,
                adjuntosQ,
                aclaracionesQ,
            ]);

            if (llamadoRes.rows.length === 0) {
                res.status(404).json({ error: 'Llamado no encontrado' });
                return;
            }

            res.json({
                llamado: llamadoRes.rows[0],
                adjuntos: adjuntosRes.rows,
                aclaraciones: aclaracionesRes.rows,
            });
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Error en GET /api/llamados/:id', err);
        res.status(500).json({ error: 'Error al obtener detalle del llamado' });
    }
});

// --- API: guardar feedback de usuario ---
// UPSERT sobre feedback_usuario (llamado_id es único). :contentReference[oaicite:3]{index=3}
app.post('/api/feedback', async (req, res) => {
    const {
        llamado_id,
        es_relevante_real,
        estado_seguimiento,
        comentario,
        ia_es_relevante,
        ia_confianza,
        ia_razon,
    } = req.body;

    if (!llamado_id) {
        return res.status(400).json({ error: 'llamado_id es requerido' });
    }

    try {
        const { rows } = await pool.query(
            `
      INSERT INTO feedback_usuario (
        llamado_id,
        es_relevante_real,
        estado_seguimiento,
        comentario,
        ia_es_relevante,
        ia_confianza,
        ia_razon,
        actualizado_en
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, now()
      )
      ON CONFLICT (llamado_id)
      DO UPDATE SET
        es_relevante_real = EXCLUDED.es_relevante_real,
        estado_seguimiento = EXCLUDED.estado_seguimiento,
        comentario = EXCLUDED.comentario,
        ia_es_relevante = EXCLUDED.ia_es_relevante,
        ia_confianza = EXCLUDED.ia_confianza,
        ia_razon = EXCLUDED.ia_razon,
        actualizado_en = now()
      RETURNING *;
      `,
            [
                llamado_id,
                es_relevante_real,
                estado_seguimiento || 'pendiente',
                comentario,
                ia_es_relevante,
                ia_confianza,
                ia_razon,
            ]
        );

        res.json(rows[0]);
    } catch (err) {
        console.error('Error en POST /api/feedback', err);
        res.status(500).json({ error: 'Error al guardar feedback' });
    }
});

const port = process.env.PORT || 3000;
const host = process.env.HOST || '0.0.0.0';
app.listen(port, host, () => {
    console.log(`Servidor escuchando en http://${host}:${port}`);
});
