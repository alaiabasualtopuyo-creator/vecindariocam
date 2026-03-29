# VecindarioCam 🎥

Sistema de vigilancia vecinal para estacionamiento. App web con login para vecinos, historial de 72 horas, streaming en vivo y notificaciones de movimiento.

**Stack:** Vercel (frontend) · Supabase (auth + storage + DB) · GitHub · Node.js bridge local

---

## Arquitectura

```
Cámara QC5 (RTSP) → Bridge script (PC local) → Supabase Storage + DB → App web (Vercel)
```

El bridge script corre en tu computador o cualquier PC conectada al mismo WiFi que la cámara. Captura clips de 2 minutos y los sube automáticamente a Supabase.

---

## Inicio rápido

### 1. Supabase

1. Crear proyecto en [supabase.com](https://supabase.com)
2. Ir a **SQL Editor** y ejecutar `supabase_setup.sql`
3. Anotar `SUPABASE_URL` y `SUPABASE_ANON_KEY` (Settings → API)
4. Anotar `SUPABASE_SERVICE_KEY` (Settings → API → service_role)

### 2. App web

1. Editar `index.html`: reemplazar `TU-PROYECTO` y `TU-ANON-KEY` con tus valores de Supabase
2. Subir a GitHub (repositorio público o privado)
3. Conectar a [vercel.com](https://vercel.com) → Import Git Repository
4. Deploy automático ✓

### 3. Bridge script (PC local)

```bash
# Instalar ffmpeg (necesario para capturar RTSP)
# macOS:
brew install ffmpeg

# Ubuntu/Debian:
sudo apt install ffmpeg

# Instalar dependencias Node.js
cd bridge
npm install

# Configurar variables
cp .env.example .env
nano .env  # Editar con tus valores

# Iniciar bridge
npm start
```

### 4. Invitar vecinos

En Supabase Dashboard → **Authentication** → **Users** → **Invite user**

Ingresa el correo del vecino. Recibirá un email para crear su contraseña y podrá acceder a la app.

---

## Encontrar la URL RTSP de la QC5

La cámara QC5 usa protocolo RTSP estándar. Para encontrar su URL:

1. **Encontrar IP:** Revisa tu router → lista de dispositivos conectados. Busca "QC5" o similar.

2. **Probar con VLC:** Archivo → Abrir ubicación de red:
   ```
   rtsp://admin:@192.168.1.X:554/onvif1
   rtsp://admin:admin@192.168.1.X:554/stream
   rtsp://192.168.1.X:554/1
   ```

3. **Alternativa:** Instala [ONVIF Device Manager](https://sourceforge.net/projects/onvifdm/) para descubrir automáticamente la URL RTSP.

4. Copiar la URL que funcione en tu `.env` como `RTSP_URL`

---

## Estructura del proyecto

```
vecindariocam/
├── index.html              ← App web completa (deploar en Vercel)
├── supabase_setup.sql      ← Ejecutar en Supabase SQL Editor
├── README.md
└── bridge/
    ├── bridge.js           ← Script Node.js (correr en PC local)
    ├── package.json
    └── .env.example        ← Copiar a .env y configurar
```

---

## Costo estimado (piloto)

| Servicio | Plan | Costo |
|---|---|---|
| Vercel | Hobby | Gratis |
| Supabase | Free tier | Gratis |
| GitHub | Public repo | Gratis |
| PC local (bridge) | Tu computador | $0 adicional |
| **Total** | | **$0/mes** |

Supabase free tier incluye 1GB de storage — suficiente para varios meses de clips de 2 minutos.

---

## Expandir a múltiples cámaras

1. Copiar carpeta `bridge/`, crear nuevo `.env` con distinto `CAMERA_ID`
2. La app web muestra todas las cámaras automáticamente (filtradas por `camera_id`)
3. Agregar selector de cámara en el frontend si se necesita

---

## Licencia

MIT — Libre para uso comunitario y vecinal.
