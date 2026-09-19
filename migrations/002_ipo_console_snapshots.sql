-- Governed read-model snapshot for IPO EDGE data displayed in EDGE Console.
-- Source-of-truth remains the IPO EDGE production database.
create table if not exists public.ipo_console_snapshots(
  id bigserial primary key,
  captured_at timestamptz not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_ipo_console_snapshots_latest
  on public.ipo_console_snapshots(captured_at desc,id desc);
