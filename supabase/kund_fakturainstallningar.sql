-- Faktureringsuppgifter på kundkortet (Fortnox-likt). ADDITIV. En JSONB-blob för de
-- Fortnox-replika-fält som ännu inte styr automatik (prislista, rabatt/avgifter,
-- räntefakturering, priser inkl moms, kundansvarig, momstyp, distributionssätt, e-post/GLN,
-- fakturatext, förvalda mallar). Fält med funktion ligger kvar i egna kolumner
-- (payment_terms, valuta, var_referens, er_referens, vat_nummer, forsaljningskonto).
alter table public.customers add column if not exists faktura_installningar jsonb not null default '{}'::jsonb;
