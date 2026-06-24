-- =====================================================================================================
-- Etapp 3B: servergrund för säker synk av AI Bokslut-kommentar (bokslut_checks.comment).
-- Allt nytt är avstängt bakom company-level-flaggan offline_autosave_sync (explicit rad, ingen plan fallback).
-- Implementerar INTE: klientens sync queue, Background Sync, andra entiteter, automatisk konfliktlösning.
-- Separat från Etapp 3B-0 (user_company_ids-härdning, egen fil/migration).
-- =====================================================================================================

-- 1. KOMMENTARREVISION -------------------------------------------------------------------------------
alter table public.bokslut_checks
  add column if not exists comment_revision bigint not null default 1,
  add column if not exists comment_updated_at timestamptz,
  add column if not exists comment_updated_by uuid;   -- ingen FK till auth.users (undviker blockerad användarradering)

-- Backfill (idempotent): historiska rader med comment får updated_at som tidsstämpel, by = NULL.
update public.bokslut_checks
  set comment_updated_at = updated_at
  where comment is not null and comment_updated_at is null;

-- Trigger: serverägda revisionsfält. Ökar revision ENDAST vid faktisk comment-ändring; annars OLD-värden.
create or replace function public._bokslut_checks_comment_revision()
 returns trigger
 language plpgsql
 security definer
 set search_path = ''
as $fn$
begin
  if new.comment is distinct from old.comment then
    new.comment_revision := old.comment_revision + 1;
    new.comment_updated_at := pg_catalog.statement_timestamp();
    new.comment_updated_by := auth.uid();
  else
    -- comment oförändrad (t.ex. run_bokslut_analysis som rör updated_at men inte comment):
    -- återställ serverägda metadata till OLD → ingen falsk konflikt, ingen manuell manipulation möjlig.
    new.comment_revision := old.comment_revision;
    new.comment_updated_at := old.comment_updated_at;
    new.comment_updated_by := old.comment_updated_by;
  end if;
  return new;
end $fn$;

drop trigger if exists trg_bokslut_checks_comment_revision on public.bokslut_checks;
create trigger trg_bokslut_checks_comment_revision
  before update on public.bokslut_checks
  for each row execute function public._bokslut_checks_comment_revision();

-- 2. OPERATIONSTABELL (idempotency) ------------------------------------------------------------------
create table if not exists public.bokslut_sync_operations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  company_id      uuid not null,
  entity_type     text not null,
  entity_id       uuid not null,
  operation_type  text not null,
  idempotency_key uuid not null,
  request_hash    text not null,
  base_revision   bigint not null,
  status          text not null,
  result_payload  jsonb,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,
  expires_at      timestamptz not null default (now() + interval '90 days'),
  constraint bokslut_sync_ops_uniq        unique (user_id, idempotency_key),
  constraint bokslut_sync_ops_entity_chk  check (entity_type = 'bokslut_check'),
  constraint bokslut_sync_ops_optype_chk  check (operation_type in ('upsert_comment','clear_comment','overwrite_comment')),
  constraint bokslut_sync_ops_status_chk  check (status in ('claimed','final'))
);
create index if not exists bokslut_sync_ops_expires_idx on public.bokslut_sync_operations (expires_at);

-- RLS på: ingen klient-policy. REVOKE ALL → endast SECURITY DEFINER-RPC (owner postgres) når tabellen.
alter table public.bokslut_sync_operations enable row level security;
revoke all on public.bokslut_sync_operations from public;
revoke all on public.bokslut_sync_operations from anon;
revoke all on public.bokslut_sync_operations from authenticated;

-- Retention = 90 dagar. Ingen automatisk scheduler skapas (projektet saknar etablerad sådan).
-- Manuell/extern cleanup-query (kör som ägare/service_role vid behov):
--   delete from public.bokslut_sync_operations where expires_at < now();
-- CAS-skyddet (comment_revision) gör att en utgången+städad nyckel aldrig kan ge tyst dubbelmutation.

-- 3. SYNK-RPC ----------------------------------------------------------------------------------------
create or replace function public.bokslut_sync_comment(
  p_idempotency_key   uuid,
  p_check             uuid,
  p_operation_type    text,
  p_comment           text,
  p_base_revision     bigint,
  p_client_created_at timestamptz
) returns jsonb
 language plpgsql
 security definer
 set search_path = ''
as $fn$
declare
  v_uid       uuid;
  v_company   uuid;
  v_engagement uuid;
  v_fy        uuid;
  v_status    text;
  v_role      text;
  v_cur_comment text;
  v_cur_rev   bigint;
  v_norm      text;
  v_hash      text;
  v_rowcount  int;
  v_existing  public.bokslut_sync_operations;
  v_new_rev   bigint;
  v_action    text := null;
  v_result    jsonb;
  v_cv        public.bokslut_checks;   -- för färsk serverVersion i konflikt
begin
  -- per-anrop-timeouts (transaktionslokala)
  perform set_config('lock_timeout', '3000', true);
  perform set_config('statement_timeout', '10000', true);

  -- (1) auth: userId härleds ALLTID från JWT, aldrig payload
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  if p_operation_type not in ('upsert_comment','clear_comment','overwrite_comment') then
    raise exception 'invalid operation_type' using errcode = '22023';
  end if;

  -- (2-3) hitta check + engagement; härled company/fiscal_year/status (aldrig från payload)
  select c.company_id, c.engagement_id, c.comment, c.comment_revision, e.fiscal_year_id, e.status
    into v_company, v_engagement, v_cur_comment, v_cur_rev, v_fy, v_status
    from public.bokslut_checks c
    join public.bokslut_engagements e on e.id = c.engagement_id
    where c.id = p_check;

  if v_company is null then
    return jsonb_build_object('outcome','rejected','errorCode','entity_deleted','retryable',false,
      'operationId',p_idempotency_key,'entityId',p_check);   -- färskt, ej persisterat
  end if;

  -- (4) aktuellt medlemskap
  select uc.role into v_role from public.user_companies uc
    where uc.user_id = v_uid and uc.company_id = v_company;
  if v_role is null then
    raise exception 'membership_removed' using errcode = '42501';   -- transportfel
  end if;
  v_role := coalesce(v_role, 'member');

  -- (5) roll per operation
  if p_operation_type = 'overwrite_comment' and v_role <> 'admin' then
    raise exception 'forbidden' using errcode = '42501';            -- transportfel
  end if;
  -- upsert_comment/clear_comment: comment_check = alla medlemsroller (inget extra rollkrav)

  -- (6) feature offline_autosave_sync: EXPLICIT rad, enabled=true, INGEN plan fallback
  if not exists (
        select 1 from public.company_ai_features f
        where f.company_id = v_company and f.feature_key = 'offline_autosave_sync' and f.enabled
      ) then
    return jsonb_build_object('outcome','rejected','errorCode','feature_disabled','retryable',false,
      'operationId',p_idempotency_key,'entityId',p_check);   -- färskt, ej persisterat
  end if;

  -- (7) engagement-status
  if v_status = 'godkand' then
    return jsonb_build_object('outcome','rejected','errorCode','engagement_approved','retryable',false,
      'operationId',p_idempotency_key,'entityId',p_check,'baseRevision',p_base_revision,'currentRevision',v_cur_rev);
  elsif v_status = 'last' then
    return jsonb_build_object('outcome','rejected','errorCode','engagement_locked','retryable',false,
      'operationId',p_idempotency_key,'entityId',p_check,'baseRevision',p_base_revision,'currentRevision',v_cur_rev);
  end if;

  -- normaliserad payload + serverberäknad canonical SHA-256 (klient-hash används aldrig)
  if p_operation_type = 'clear_comment' then
    v_norm := null;
  else
    v_norm := normalize(coalesce(p_comment, ''), nfc);
  end if;
  v_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        jsonb_build_object(
          'version', 1,
          'entity_type', 'bokslut_check',
          'entity_id', p_check,
          'operation_type', p_operation_type,
          'base_revision', p_base_revision,
          'comment', case when p_operation_type = 'clear_comment' then null else v_norm end
        )::text, 'UTF8'),
      'sha256'),
    'hex');

  -- (8) idempotency-claim (efter alla färska grindar). Parallell väntan → transaction_retry.
  begin
    insert into public.bokslut_sync_operations
      (user_id, company_id, entity_type, entity_id, operation_type, idempotency_key,
       request_hash, base_revision, status, created_at, expires_at)
    values
      (v_uid, v_company, 'bokslut_check', p_check, p_operation_type, p_idempotency_key,
       v_hash, p_base_revision, 'claimed', pg_catalog.now(), pg_catalog.now() + interval '90 days')
    on conflict (user_id, idempotency_key) do nothing;
    get diagnostics v_rowcount = row_count;
  exception
    when lock_not_available or query_canceled then
      return jsonb_build_object('outcome','retryable_error','errorCode','transaction_retry','retryable',true,
        'operationId',p_idempotency_key,'entityId',p_check);
  end;

  if v_rowcount = 0 then
    -- konflikt: läs committad befintlig rad (replay eller mismatch)
    select * into v_existing from public.bokslut_sync_operations
      where user_id = v_uid and idempotency_key = p_idempotency_key;
    if v_existing.request_hash is distinct from v_hash then
      return jsonb_build_object('outcome','rejected','errorCode','idempotency_payload_mismatch','retryable',false,
        'operationId',p_idempotency_key,'entityId',p_check);   -- skriver INTE över ursprunglig rad
    end if;
    return v_existing.result_payload;   -- replay: tidigare terminalt resultat (grindar redan omkontrollerade ovan)
  end if;

  -- (9-10) mutation + CAS. Audit endast vid faktisk mutation.
  if p_operation_type = 'clear_comment' then
    if v_cur_comment is null then
      v_result := jsonb_build_object('outcome','no_change','errorCode',null,'retryable',false,
        'operationId',p_idempotency_key,'entityId',p_check,'baseRevision',p_base_revision,'currentRevision',v_cur_rev);
    else
      update public.bokslut_checks set comment = null
        where id = p_check and comment_revision = p_base_revision
        returning comment_revision into v_new_rev;
      if not found then
        select * into v_cv from public.bokslut_checks where id = p_check;
        v_result := jsonb_build_object('outcome','conflict','errorCode','revision_conflict','retryable',false,
          'operationId',p_idempotency_key,'entityId',p_check,'baseRevision',p_base_revision,'currentRevision',v_cv.comment_revision,
          'serverVersion', jsonb_build_object('comment',v_cv.comment,'commentRevision',v_cv.comment_revision,
            'commentUpdatedAt',v_cv.comment_updated_at,'commentUpdatedBy',v_cv.comment_updated_by),
          'allowedActions', jsonb_build_array('reload_newer','keep_separate','overwrite_with_confirmation'));
      else
        v_action := 'check_comment_sync_clear';
        v_result := jsonb_build_object('outcome','succeeded','errorCode',null,'retryable',false,
          'operationId',p_idempotency_key,'entityId',p_check,'baseRevision',p_base_revision,'currentRevision',v_new_rev);
      end if;
    end if;
  else
    -- upsert_comment / overwrite_comment: validering (NFC, 8000 bytes, ingen trunkering)
    if v_norm is null or pg_catalog.length(pg_catalog.btrim(v_norm)) = 0 then
      v_result := jsonb_build_object('outcome','rejected','errorCode','validation_failed','retryable',false,
        'operationId',p_idempotency_key,'entityId',p_check,'reason','empty');
    elsif pg_catalog.octet_length(v_norm) > 8000 then
      v_result := jsonb_build_object('outcome','rejected','errorCode','validation_failed','retryable',false,
        'operationId',p_idempotency_key,'entityId',p_check,'reason','too_large','bytes',pg_catalog.octet_length(v_norm));
    elsif v_norm is not distinct from v_cur_comment then
      -- önskat värde == nuvarande
      if p_base_revision = v_cur_rev then
        v_result := jsonb_build_object('outcome','no_change','errorCode',null,'retryable',false,
          'operationId',p_idempotency_key,'entityId',p_check,'baseRevision',p_base_revision,'currentRevision',v_cur_rev);
      else
        select * into v_cv from public.bokslut_checks where id = p_check;
        v_result := jsonb_build_object('outcome','conflict','errorCode','revision_conflict','retryable',false,
          'operationId',p_idempotency_key,'entityId',p_check,'baseRevision',p_base_revision,'currentRevision',v_cv.comment_revision,
          'serverVersion', jsonb_build_object('comment',v_cv.comment,'commentRevision',v_cv.comment_revision,
            'commentUpdatedAt',v_cv.comment_updated_at,'commentUpdatedBy',v_cv.comment_updated_by),
          'allowedActions', jsonb_build_array('reload_newer','keep_separate','overwrite_with_confirmation'));
      end if;
    else
      update public.bokslut_checks set comment = v_norm
        where id = p_check and comment_revision = p_base_revision
        returning comment_revision into v_new_rev;
      if not found then
        select * into v_cv from public.bokslut_checks where id = p_check;
        v_result := jsonb_build_object('outcome','conflict','errorCode','revision_conflict','retryable',false,
          'operationId',p_idempotency_key,'entityId',p_check,'baseRevision',p_base_revision,'currentRevision',v_cv.comment_revision,
          'serverVersion', jsonb_build_object('comment',v_cv.comment,'commentRevision',v_cv.comment_revision,
            'commentUpdatedAt',v_cv.comment_updated_at,'commentUpdatedBy',v_cv.comment_updated_by),
          'allowedActions', jsonb_build_array('reload_newer','keep_separate','overwrite_with_confirmation'));
      else
        v_action := case when p_operation_type = 'overwrite_comment' then 'check_comment_sync_overwrite'
                         else 'check_comment_sync_upsert' end;
        v_result := jsonb_build_object('outcome','succeeded','errorCode',null,'retryable',false,
          'operationId',p_idempotency_key,'entityId',p_check,'baseRevision',p_base_revision,'currentRevision',v_new_rev);
      end if;
    end if;
  end if;

  -- (11) audit ENDAST vid faktisk mutation (aldrig kommentartext/payload)
  if v_action is not null then
    insert into public.bokslut_audit_log (engagement_id, company_id, user_id, action, detail)
    values (v_engagement, v_company, v_uid, v_action,
      jsonb_build_object('check', p_check, 'revision_from', p_base_revision, 'revision_to', v_new_rev,
        'operation_id', p_idempotency_key));
  end if;

  -- (12-13) persistera terminalt resultat (succeeded/no_change/revision_conflict/validation_failed)
  update public.bokslut_sync_operations
    set status = 'final', result_payload = v_result, completed_at = pg_catalog.now()
    where user_id = v_uid and idempotency_key = p_idempotency_key;

  return v_result;
end $fn$;

revoke execute on function public.bokslut_sync_comment(uuid,uuid,text,text,bigint,timestamptz) from public;
revoke execute on function public.bokslut_sync_comment(uuid,uuid,text,text,bigint,timestamptz) from anon;
grant execute on function public.bokslut_sync_comment(uuid,uuid,text,text,bigint,timestamptz) to authenticated;

-- 4. HÄRDA GAMLA bokslut_comment_check ----------------------------------------------------------------
-- Ta bort tyst trunkering (left 2000) → NFC + 8000-byte-avvisning. Blockera godkand + last.
-- Behåller signatur. Revision sköts av triggern (samma revision som synk-vägen).
create or replace function public.bokslut_comment_check(p_check uuid, p_comment text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $fn$
declare g record; v_norm text; v_appr boolean;
begin
  if p_comment is null or length(trim(p_comment)) = 0 then
    raise exception 'tom kommentar' using errcode = '22023';
  end if;
  v_norm := normalize(p_comment, nfc);
  if octet_length(v_norm) > 8000 then
    raise exception 'Kommentaren är för lång (max 8000 byte).' using errcode = '22023';
  end if;
  g := public._bokslut_check_guard(p_check);   -- membership + status='last' (42501)
  -- blockera även godkand (samma regel som synk-vägen → gamla vägen kan inte kringgå statusregeln)
  select exists (select 1 from bokslut_engagements e where e.id = g.engagement_id and e.status = 'godkand') into v_appr;
  if v_appr then
    raise exception 'Engagemanget är godkänt – kommentarer kan inte ändras.' using errcode = '42501';
  end if;
  if not public.bokslut_can(g.company_id, 'comment_check') then
    raise exception 'Behörighet saknas: din roll får inte kommentera kontroller.' using errcode = '42501';
  end if;
  update bokslut_checks set comment = v_norm, updated_at = now() where id = p_check;   -- ingen trunkering; triggern ökar comment_revision
  insert into bokslut_audit_log (engagement_id, company_id, user_id, action, detail)
  values (g.engagement_id, g.company_id, auth.uid(), 'check_comment', jsonb_build_object('check', p_check));
end $fn$;
