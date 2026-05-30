-- Kommentar/notering på verifikation
alter table verifikationer add column if not exists kommentar text;
