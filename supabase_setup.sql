-- ══════════════════════════════════════════════
--  VecindarioCam — Setup Supabase
--  Ejecutar en: Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════

-- 1. Tabla de grabaciones
create table if not exists recordings (
  id            uuid default gen_random_uuid() primary key,
  camera_id     text not null,
  started_at    timestamptz not null,
  duration_sec  int,
  storage_path  text not null,
  has_motion    bool default false,
  created_at    timestamptz default now()
);

-- Índice para búsquedas por fecha (historial 72h)
create index if not exists idx_recordings_started_at
  on recordings (started_at desc);

create index if not exists idx_recordings_camera
  on recordings (camera_id, started_at desc);

-- 2. Row Level Security: solo usuarios autenticados pueden leer
alter table recordings enable row level security;

-- Política de lectura para vecinos autenticados
create policy "vecinos pueden ver grabaciones"
  on recordings for select
  using (auth.role() = 'authenticated');

-- Política de escritura SOLO para el bridge (service role)
-- El service role bypasea RLS automáticamente, no necesita política.

-- 3. Storage bucket para los videos
-- Nota: esto se configura en Supabase Dashboard → Storage → New bucket
-- Nombre del bucket: "recordings"
-- Public: NO (privado, acceso solo con signed URLs)

-- Si prefieres hacerlo por SQL (Supabase Storage API):
insert into storage.buckets (id, name, public)
  values ('recordings', 'recordings', false)
  on conflict (id) do nothing;

-- RLS para Storage: usuarios autenticados pueden leer (GET signed URLs)
create policy "vecinos pueden leer videos"
  on storage.objects for select
  using (
    bucket_id = 'recordings'
    and auth.role() = 'authenticated'
  );

-- Solo service role puede subir (INSERT) — el bridge usa service key
create policy "bridge puede subir videos"
  on storage.objects for insert
  with check (
    bucket_id = 'recordings'
    and auth.role() = 'service_role'
  );

-- Solo service role puede borrar (para limpieza automática de 72h)
create policy "bridge puede borrar videos"
  on storage.objects for delete
  using (
    bucket_id = 'recordings'
    and auth.role() = 'service_role'
  );

-- 4. Vista útil: grabaciones recientes con señal de actividad
create or replace view recent_activity as
  select
    camera_id,
    started_at,
    duration_sec,
    has_motion,
    storage_path,
    extract(epoch from (now() - started_at))/3600 as hours_ago
  from recordings
  where started_at > now() - interval '72 hours'
  order by started_at desc;

-- 5. Verificar setup
select count(*) as total_recordings from recordings;
select * from recent_activity limit 5;
