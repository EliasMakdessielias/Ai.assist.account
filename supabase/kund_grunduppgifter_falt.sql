-- Grunduppgifter på kundkortet (Fortnox-likt). ADDITIVT. Faktura-/leveransadressens
-- kontaktfält + bransch/arbetsställe. Lagras i egna kolumner.
alter table public.customers add column if not exists landskod text;
alter table public.customers add column if not exists fax text;
alter table public.customers add column if not exists lev_telefon text;
alter table public.customers add column if not exists lev_telefon2 text;
alter table public.customers add column if not exists lev_fax text;
alter table public.customers add column if not exists lev_landskod text;
alter table public.customers add column if not exists sni text;          -- Branschkod (SNI)
alter table public.customers add column if not exists cfar text;         -- Arbetsställenr (CFAR)
alter table public.customers add column if not exists butiks_id text;
