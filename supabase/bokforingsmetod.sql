-- Bokföringsmetod på företaget: faktura (faktureringsmetoden) eller kontant (kontantmetoden/bokslutsmetoden)
alter table companies add column if not exists bokforingsmetod text default 'faktura';
