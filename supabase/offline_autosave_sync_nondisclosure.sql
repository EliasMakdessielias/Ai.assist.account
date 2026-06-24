-- Etapp 3B-1: icke-avslöjande kontrakt för okänd/otillåten check i bokslut_sync_comment.
-- Tidigare läckte skillnaden mellan "check saknas" (entity_deleted) och "check finns i annan tenant"
-- (membership_removed) existensen av ett UUID i ett annat bolag. Ny modell:
--   * okänd check UTAN tidigare egen operation (samma user+nyckel)  -> not_found (icke-avslöjande)
--   * check i annan tenant (icke-medlem) UTAN tidigare egen operation -> not_found (samma svar)
--   * entity_deleted returneras ENDAST vid replay där operationraden redan binder user+nyckel till entiteten
--   * membership_removed (transportfel) ENDAST vid replay av en tidigare behörig operation vars medlemskap dragits in
-- Endast bokslut_sync_comment ändras. Övrig 3B-logik oförändrad.
create or replace function public.bokslut_sync_comment(
  p_idempotency_key   uuid,
  p_check             uuid,
  p_operation_type    text,
  p_comment           text,
  p_base_revision     bigint,
  p_client_created_at timestamptz
) returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare
  v_uid uuid; v_company uuid; v_engagement uuid; v_fy uuid; v_status text; v_role text;
  v_cur_comment text; v_cur_rev bigint; v_norm text; v_hash text; v_rowcount int;
  v_existing public.bokslut_sync_operations; v_new_rev bigint; v_action text := null;
  v_result jsonb; v_cv public.bokslut_checks; v_bound boolean;
begin
  perform set_config('lock_timeout', '3000', true);
  perform set_config('statement_timeout', '10000', true);

  v_uid := auth.uid();
  if v_uid is null then raise exception 'unauthorized' using errcode = '28000'; end if;
  if p_operation_type not in ('upsert_comment','clear_comment','overwrite_comment') then
    raise exception 'invalid operation_type' using errcode = '22023'; end if;

  -- tidigare egen operation med samma nyckel (binder user+nyckel+entitet) – för icke-avslöjande beslut
  select * into v_existing from public.bokslut_sync_operations
    where user_id = v_uid and idempotency_key = p_idempotency_key;
  v_bound := (v_existing.id is not null and v_existing.entity_id = p_check);

  select c.company_id, c.engagement_id, c.comment, c.comment_revision, e.fiscal_year_id, e.status
    into v_company, v_engagement, v_cur_comment, v_cur_rev, v_fy, v_status
    from public.bokslut_checks c join public.bokslut_engagements e on e.id = c.engagement_id
    where c.id = p_check;

  if v_company is null then
    if v_bound then
      return jsonb_build_object('outcome','rejected','errorCode','entity_deleted','retryable',false,
        'operationId',p_idempotency_key,'entityId',p_check);
    end if;
    return jsonb_build_object('outcome','rejected','errorCode','not_found','retryable',false,
      'operationId',p_idempotency_key,'entityId',p_check);   -- icke-avslöjande
  end if;

  select uc.role into v_role from public.user_companies uc
    where uc.user_id = v_uid and uc.company_id = v_company;
  if v_role is null then
    if v_bound then
      raise exception 'membership_removed' using errcode = '42501';   -- replay av tidigare behörig op
    end if;
    return jsonb_build_object('outcome','rejected','errorCode','not_found','retryable',false,
      'operationId',p_idempotency_key,'entityId',p_check);   -- cross-tenant-probe → samma not_found
  end if;
  v_role := coalesce(v_role, 'member');

  if p_operation_type = 'overwrite_comment' and v_role <> 'admin' then
    raise exception 'forbidden' using errcode = '42501'; end if;

  if not exists (select 1 from public.company_ai_features f
        where f.company_id = v_company and f.feature_key = 'offline_autosave_sync' and f.enabled) then
    return jsonb_build_object('outcome','rejected','errorCode','feature_disabled','retryable',false,
      'operationId',p_idempotency_key,'entityId',p_check); end if;

  if v_status = 'godkand' then
    return jsonb_build_object('outcome','rejected','errorCode','engagement_approved','retryable',false,
      'operationId',p_idempotency_key,'entityId',p_check,'baseRevision',p_base_revision,'currentRevision',v_cur_rev);
  elsif v_status = 'last' then
    return jsonb_build_object('outcome','rejected','errorCode','engagement_locked','retryable',false,
      'operationId',p_idempotency_key,'entityId',p_check,'baseRevision',p_base_revision,'currentRevision',v_cur_rev);
  end if;

  if p_operation_type = 'clear_comment' then v_norm := null;
  else v_norm := normalize(coalesce(p_comment, ''), nfc); end if;
  v_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      jsonb_build_object('version',1,'entity_type','bokslut_check','entity_id',p_check,
        'operation_type',p_operation_type,'base_revision',p_base_revision,
        'comment', case when p_operation_type = 'clear_comment' then null else v_norm end)::text,'UTF8'),
      'sha256'),'hex');

  begin
    insert into public.bokslut_sync_operations
      (user_id, company_id, entity_type, entity_id, operation_type, idempotency_key,
       request_hash, base_revision, status, created_at, expires_at)
    values (v_uid, v_company, 'bokslut_check', p_check, p_operation_type, p_idempotency_key,
       v_hash, p_base_revision, 'claimed', pg_catalog.now(), pg_catalog.now() + interval '90 days')
    on conflict (user_id, idempotency_key) do nothing;
    get diagnostics v_rowcount = row_count;
  exception when lock_not_available or query_canceled then
    return jsonb_build_object('outcome','retryable_error','errorCode','transaction_retry','retryable',true,
      'operationId',p_idempotency_key,'entityId',p_check);
  end;

  if v_rowcount = 0 then
    select * into v_existing from public.bokslut_sync_operations
      where user_id = v_uid and idempotency_key = p_idempotency_key;
    if v_existing.request_hash is distinct from v_hash then
      return jsonb_build_object('outcome','rejected','errorCode','idempotency_payload_mismatch','retryable',false,
        'operationId',p_idempotency_key,'entityId',p_check); end if;
    return v_existing.result_payload;
  end if;

  if p_operation_type = 'clear_comment' then
    if v_cur_comment is null then
      v_result := jsonb_build_object('outcome','no_change','errorCode',null,'retryable',false,
        'operationId',p_idempotency_key,'entityId',p_check,'baseRevision',p_base_revision,'currentRevision',v_cur_rev);
    else
      update public.bokslut_checks set comment = null
        where id = p_check and comment_revision = p_base_revision returning comment_revision into v_new_rev;
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
    if v_norm is null or pg_catalog.length(pg_catalog.btrim(v_norm)) = 0 then
      v_result := jsonb_build_object('outcome','rejected','errorCode','validation_failed','retryable',false,
        'operationId',p_idempotency_key,'entityId',p_check,'reason','empty');
    elsif pg_catalog.octet_length(v_norm) > 8000 then
      v_result := jsonb_build_object('outcome','rejected','errorCode','validation_failed','retryable',false,
        'operationId',p_idempotency_key,'entityId',p_check,'reason','too_large','bytes',pg_catalog.octet_length(v_norm));
    elsif v_norm is not distinct from v_cur_comment then
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
        where id = p_check and comment_revision = p_base_revision returning comment_revision into v_new_rev;
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

  if v_action is not null then
    insert into public.bokslut_audit_log (engagement_id, company_id, user_id, action, detail)
    values (v_engagement, v_company, v_uid, v_action,
      jsonb_build_object('check', p_check, 'revision_from', p_base_revision, 'revision_to', v_new_rev, 'operation_id', p_idempotency_key));
  end if;

  update public.bokslut_sync_operations
    set status = 'final', result_payload = v_result, completed_at = pg_catalog.now()
    where user_id = v_uid and idempotency_key = p_idempotency_key;

  return v_result;
end $fn$;
