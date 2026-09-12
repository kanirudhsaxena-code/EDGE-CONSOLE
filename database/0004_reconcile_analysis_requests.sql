begin;

alter table analysis_requests
  add column if not exists framework_version text,
  add column if not exists output_contract_version text,
  add column if not exists error jsonb,
  add column if not exists updated_at timestamptz not null default now();

update analysis_requests
set framework_version = coalesce(framework_version, '5DR_V2_1'),
    output_contract_version = coalesce(output_contract_version, '5DR_V2_1_2');

alter table analysis_requests
  alter column framework_version set not null,
  alter column output_contract_version set not null,
  alter column batch_id set not null;

create unique index if not exists idx_analysis_requests_batch_id_unique
  on analysis_requests(batch_id);

commit;
