/**
 * VecindarioCam — Bridge Script
 * Captura stream RTSP de la cámara QC5 y sube clips de 2 minutos a Supabase Storage.
 * Requiere: Node.js 18+, ffmpeg instalado en el sistema.
 * 
 * Instalar dependencias:
 *   npm install @supabase/supabase-js node-cron dotenv
 * 
 * Correr:
 *   node bridge.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

// ─── CONFIG ───
const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY= process.env.SUPABASE_SERVICE_KEY;
const RTSP_URL            = process.env.RTSP_URL || 'rtsp://admin:@192.168.1.100:554/onvif1';
const CLIP_DURATION       = parseInt(process.env.CLIP_DURATION || '120'); // segundos
const CAMERA_ID           = process.env.CAMERA_ID || 'qc5-estacionamiento';
const RETENTION_HOURS     = parseInt(process.env.RETENTION_HOURS || '72');
const TEMP_DIR            = process.env.TEMP_DIR || '/tmp/vecindariocam';

// ─── SUPABASE ───
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ─── SETUP ───
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

console.log(`
╔══════════════════════════════════════╗
║   VecindarioCam Bridge v1.0          ║
╠══════════════════════════════════════╣
║  Cámara : ${CAMERA_ID.padEnd(26)}║
║  RTSP   : ${RTSP_URL.substring(0,26).padEnd(26)}║
║  Clip   : ${String(CLIP_DURATION + 's').padEnd(26)}║
║  Retenc. : ${String(RETENTION_HOURS + 'h').padEnd(25)}║
╚══════════════════════════════════════╝
`);

// ─── GRABAR UN CLIP ───
async function recordClip() {
  const startedAt = new Date();
  const filename  = `clip_${startedAt.toISOString().replace(/[:.]/g, '-')}.mp4`;
  const filepath  = path.join(TEMP_DIR, filename);

  console.log(`[${new Date().toLocaleTimeString('es-CL')}] Iniciando grabación → ${filename}`);

  return new Promise((resolve, reject) => {
    // FFmpeg: captura RTSP por CLIP_DURATION segundos, guarda como MP4
    const ffmpeg = spawn('ffmpeg', [
      '-rtsp_transport', 'tcp',       // más estable en WiFi
      '-i', RTSP_URL,
      '-t', String(CLIP_DURATION),    // duración
      '-c:v', 'copy',                 // sin recodificar (rápido)
      '-c:a', 'aac',
      '-movflags', '+faststart',      // compatible con streaming web
      '-y',                           // sobreescribir si existe
      filepath
    ]);

    let stderr = '';
    ffmpeg.stderr.on('data', d => { stderr += d.toString(); });

    ffmpeg.on('close', code => {
      if (code === 0 && fs.existsSync(filepath)) {
        console.log(`[OK] Clip grabado: ${filename}`);
        resolve({ filepath, filename, startedAt });
      } else {
        console.error(`[ERROR] FFmpeg salió con código ${code}`);
        console.error(stderr.slice(-300));
        reject(new Error(`FFmpeg error: code ${code}`));
      }
    });

    ffmpeg.on('error', err => {
      console.error('[ERROR] No se pudo iniciar FFmpeg:', err.message);
      console.error('Verifica que ffmpeg esté instalado: ffmpeg -version');
      reject(err);
    });
  });
}

// ─── DETECTAR MOVIMIENTO (simple: comparar tamaño de frame) ───
async function detectMotion(filepath) {
  return new Promise(resolve => {
    execFile('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      filepath
    ], (err, stdout) => {
      if (err) { resolve(false); return; }
      try {
        const info = JSON.parse(stdout);
        const video = info.streams.find(s => s.codec_type === 'video');
        // Heurística simple: si el bitrate es alto, hay movimiento
        const bitrate = parseInt(video?.bit_rate || 0);
        resolve(bitrate > 200000); // >200kbps = movimiento probable
      } catch {
        resolve(false);
      }
    });
  });
}

// ─── SUBIR A SUPABASE ───
async function uploadClip({ filepath, filename, startedAt }) {
  const storagePath = `${CAMERA_ID}/${filename}`;

  console.log(`[↑] Subiendo a Supabase Storage...`);

  const fileBuffer = fs.readFileSync(filepath);

  const { error: uploadError } = await sb.storage
    .from('recordings')
    .upload(storagePath, fileBuffer, {
      contentType: 'video/mp4',
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  const hasMotion = await detectMotion(filepath);
  const stat = fs.statSync(filepath);

  // Insertar metadata en DB
  const { error: dbError } = await sb.from('recordings').insert({
    camera_id:    CAMERA_ID,
    started_at:   startedAt.toISOString(),
    duration_sec: CLIP_DURATION,
    storage_path: storagePath,
    has_motion:   hasMotion,
  });

  if (dbError) {
    throw new Error(`DB insert failed: ${dbError.message}`);
  }

  // Limpiar archivo local
  fs.unlinkSync(filepath);

  console.log(`[✓] Subido: ${storagePath} | Movimiento: ${hasMotion ? 'SÍ' : 'no'} | ${(stat.size/1024/1024).toFixed(1)}MB`);
  return { storagePath, hasMotion };
}

// ─── LIMPIAR GRABACIONES ANTIGUAS (>72h) ───
async function cleanupOldRecordings() {
  const cutoff = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000).toISOString();

  const { data: old, error } = await sb
    .from('recordings')
    .select('id, storage_path')
    .lt('started_at', cutoff);

  if (error || !old || old.length === 0) return;

  console.log(`[CLEANUP] Eliminando ${old.length} grabaciones antiguas...`);

  // Eliminar de Storage
  const paths = old.map(r => r.storage_path);
  await sb.storage.from('recordings').remove(paths);

  // Eliminar de DB
  const ids = old.map(r => r.id);
  await sb.from('recordings').delete().in('id', ids);

  console.log(`[CLEANUP] ${old.length} grabaciones eliminadas`);
}

// ─── CICLO PRINCIPAL ───
async function runCycle() {
  try {
    const clip = await recordClip();
    await uploadClip(clip);
  } catch (err) {
    console.error(`[ERROR] Ciclo fallido: ${err.message}`);
    console.log('[RETRY] Reintentando en el próximo ciclo...');
  }
}

// ─── INICIO ───
console.log('[INIT] Verificando conexión con Supabase...');
sb.from('recordings').select('count', { count: 'exact', head: true })
  .then(({ count, error }) => {
    if (error) {
      console.error('[ERROR] No se pudo conectar a Supabase:', error.message);
      console.error('Verifica SUPABASE_URL y SUPABASE_SERVICE_KEY en .env');
      process.exit(1);
    }
    console.log(`[OK] Supabase conectado. Grabaciones en DB: ${count || 0}`);
    console.log(`[START] Primera grabación iniciando...\n`);

    // Primer ciclo inmediato
    runCycle();

    // Ciclos cada CLIP_DURATION segundos
    setInterval(runCycle, CLIP_DURATION * 1000);

    // Limpieza cada hora
    cron.schedule('0 * * * *', cleanupOldRecordings);
  });

// Manejo de señales
process.on('SIGINT', () => {
  console.log('\n[STOP] Bridge detenido. Los clips pendientes se subirán en la próxima sesión.');
  process.exit(0);
});
