-- Avstämningsmarkering på inlästa banktransaktioner
alter table bank_transactions add column if not exists avstamd boolean default false;
