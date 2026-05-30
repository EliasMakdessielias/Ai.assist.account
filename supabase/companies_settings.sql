-- Företagsinställningar: flexibel inställnings-blob (kryssrutor, serier, texter m.m.)
alter table companies add column if not exists settings jsonb not null default '{}'::jsonb;
