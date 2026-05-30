-- Avstämningsmarkering per bokföringsrad (kassa/bank)
alter table verifikation_rows add column if not exists avstamd boolean default false;
