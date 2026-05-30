-- Fler företagsfält för Företagsinställningar (flikar)
alter table companies add column if not exists postnr text;
alter table companies add column if not exists postort text;
alter table companies add column if not exists sate text;
alter table companies add column if not exists mobil text;
alter table companies add column if not exists valuta text default 'SEK';
alter table companies add column if not exists swish text;
alter table companies add column if not exists foretagsform text;
alter table companies add column if not exists momsperiod text;
alter table companies add column if not exists bokforing_last_tom text;
alter table companies add column if not exists nasta_fakturanr integer;
alter table companies add column if not exists faktura_text text;
alter table companies add column if not exists faktura_epost_text text;
