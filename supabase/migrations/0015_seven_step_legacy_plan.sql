-- Keep existing drafts and finalized records intact while changing the active
-- wizard lifecycle to five data sections plus review and confirmation.

-- Old cursors were one-based: 4 = Financial Assets, 5 = Physical Assets,
-- 6 = Digital Assets, 7 = Witness Details, 8 = Special Wishes, 9 =
-- Attachments, 10 = Review and 11 = Confirmation. Removed sections and
-- Special Wishes now resume at step 4. Only draft cursors need rewriting;
-- finalized plans are already read through normalizeWizardStep().
update public.legacy_plans
   set current_step = case current_step
     when 5 then 4
     when 6 then 4
     when 7 then 4
     when 8 then 4
     when 9 then 5
     when 10 then 6
     when 11 then 7
     else current_step
   end
 where status = 'DRAFT'
   and current_step in (5, 6, 7, 8, 9, 10, 11);

create or replace function public.save_plan_step(
  p_plan_id uuid, p_step text, p_data jsonb, p_expected_lock_version integer, p_corr text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_sections constant text[] := array['personal-details','family-information','beneficiaries',
                                      'special-wishes','document-attachments'];
  v_user uuid := public.lv_require_user();
  v_plan public.legacy_plans%rowtype;
  v_complete boolean;
begin
  if p_step <> all (c_sections) then
    perform public.lv_raise_422('INVALID_STEP', jsonb_build_object('step', p_step));
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    perform public.lv_raise_422('INVALID_INPUT', '{"field":"data"}'::jsonb);
  end if;
  select * into v_plan from public.legacy_plans p
   where p.id = p_plan_id and p.user_id = v_user and p.deleted_at is null for update;
  if not found then perform public.lv_forbidden(); end if;
  if v_plan.status <> 'DRAFT' then perform public.lv_raise_409('PLAN_NOT_DRAFT'); end if;
  if v_plan.lock_version <> p_expected_lock_version then
    perform public.lv_raise_409('LOCK_CONFLICT', jsonb_build_object('lockVersion', v_plan.lock_version));
  end if;
  v_complete := coalesce((p_data ->> 'isComplete')::boolean, false);
  update public.legacy_plans
     set steps_data = steps_data || jsonb_build_object(p_step, p_data - 'isComplete'),
         completion_status = completion_status || jsonb_build_object(p_step, v_complete),
         current_step = greatest(current_step, array_position(c_sections, p_step)),
         lock_version = lock_version + 1
   where id = p_plan_id;
  perform public.lv_audit(v_user, 'plan.step_saved', 'legacy_plan', p_plan_id, 'SUCCESS',
    jsonb_build_object('step', p_step, 'complete', v_complete), p_corr);
  perform public.lv_end();
  return jsonb_build_object('lockVersion', v_plan.lock_version + 1, 'step', p_step, 'complete', v_complete);
end;
$$;

create or replace function public.finalize_legacy_plan(
  p_plan_id uuid, p_expected_lock_version integer, p_acknowledge_incomplete boolean default false, p_corr text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_sections constant text[] := array['personal-details','family-information','beneficiaries',
                                      'special-wishes','document-attachments'];
  v_user uuid := public.lv_require_user();
  v_plan public.legacy_plans%rowtype;
  v_incomplete text[];
  v_snapshot jsonb;
  v_version uuid;
  v_draft uuid;
  v_notif uuid;
  v_beneficiary_ids uuid[];
  v_financial_asset_ids uuid[];
  v_physical_asset_ids uuid[];
  v_digital_asset_ids uuid[];
  v_document_ids uuid[];
begin
  select * into v_plan from public.legacy_plans p
   where p.id = p_plan_id and p.user_id = v_user and p.deleted_at is null for update;
  if not found then perform public.lv_forbidden(); end if;
  if v_plan.status <> 'DRAFT' then perform public.lv_raise_409('PLAN_NOT_DRAFT'); end if;
  if v_plan.lock_version <> p_expected_lock_version then
    perform public.lv_raise_409('LOCK_CONFLICT', jsonb_build_object('lockVersion', v_plan.lock_version));
  end if;
  if coalesce((v_plan.completion_status ->> 'personal-details')::boolean, false) is not true then
    perform public.lv_raise_422('PERSONAL_DETAILS_REQUIRED');
  end if;
  select coalesce(array_agg(s order by s), '{}') into v_incomplete
    from unnest(c_sections) s
   where coalesce((v_plan.completion_status ->> s)::boolean, false) is not true;
  if cardinality(v_incomplete) > 0 and not coalesce(p_acknowledge_incomplete, false) then
    perform public.lv_raise_422('PLAN_INCOMPLETE', jsonb_build_object('incompleteSections', to_jsonb(v_incomplete)));
  end if;

  select a.id into v_draft from public.ai_drafts a
   where a.user_id = v_user and a.legacy_plan_id = p_plan_id and a.kind = 'WILL_DRAFT'
     and a.status = 'CONFIRMED' and a.deleted_at is null
   order by a.confirmed_at desc limit 1;

  select coalesce(array_agg(value::uuid), '{}') into v_beneficiary_ids
    from jsonb_array_elements_text(coalesce(v_plan.steps_data -> 'beneficiaries' -> 'beneficiaryIds', '[]'::jsonb));
  select coalesce(array_agg(value::uuid), '{}') into v_financial_asset_ids
    from jsonb_array_elements_text(coalesce(v_plan.steps_data -> 'financial-assets' -> 'assetIds', '[]'::jsonb));
  select coalesce(array_agg(value::uuid), '{}') into v_physical_asset_ids
    from jsonb_array_elements_text(coalesce(v_plan.steps_data -> 'physical-assets' -> 'assetIds', '[]'::jsonb));
  select coalesce(array_agg(value::uuid), '{}') into v_digital_asset_ids
    from jsonb_array_elements_text(coalesce(v_plan.steps_data -> 'digital-assets' -> 'assetIds', '[]'::jsonb));
  select coalesce(array_agg(value::uuid), '{}') into v_document_ids
    from jsonb_array_elements_text(coalesce(v_plan.steps_data -> 'document-attachments' -> 'documentIds', '[]'::jsonb));

  v_snapshot := jsonb_build_object(
    'stepsData', v_plan.steps_data,
    'beneficiaries', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'name', b.name, 'relationship', b.relationship, 'email', b.email, 'phone', b.phone, 'status', b.status)
        order by b.created_at)
        from public.beneficiaries b where b.user_id = v_user and b.deleted_at is null
          and b.id = any(v_beneficiary_ids)), '[]'::jsonb),
    'financialAssets', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'category', a.category, 'institution', a.institution,
        'estimatedValue', a.estimated_value, 'currency', a.currency, 'notes', a.notes) order by a.created_at)
        from public.financial_assets a where a.user_id = v_user and a.deleted_at is null
          and a.id = any(v_financial_asset_ids)), '[]'::jsonb),
    'physicalAssets', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'category', a.category, 'description', a.description, 'location', a.location,
        'estimatedValue', a.estimated_value, 'currency', a.currency, 'ownershipDetails', a.ownership_details, 'notes', a.notes)
        order by a.created_at)
        from public.physical_assets a where a.user_id = v_user and a.deleted_at is null
          and a.id = any(v_physical_asset_ids)), '[]'::jsonb),
    'digitalAssets', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'category', a.category, 'platform', a.platform, 'username', a.username,
        'estimatedValue', a.estimated_value, 'currency', a.currency, 'notes', a.notes) order by a.created_at)
        from public.digital_assets a where a.user_id = v_user and a.deleted_at is null
          and a.id = any(v_digital_asset_ids)), '[]'::jsonb),
    'assignments', coalesce((select jsonb_agg(jsonb_build_object(
        'beneficiaryId', ba.beneficiary_id, 'resourceType', ba.resource_type, 'resourceId', ba.resource_id,
        'allocationPercentage', ba.allocation_percentage) order by ba.created_at)
        from public.beneficiary_assignments ba where ba.user_id = v_user
          and (ba.beneficiary_id = any(v_beneficiary_ids)
            or ba.resource_id = any(v_financial_asset_ids)
            or ba.resource_id = any(v_physical_asset_ids)
            or ba.resource_id = any(v_digital_asset_ids)
            or ba.resource_id = any(v_document_ids))), '[]'::jsonb),
    'documentAttachments', coalesce((select jsonb_agg(jsonb_build_object(
        'documentId', da.document_id, 'name', d.name, 'mimeType', d.mime_type, 'sizeBytes', d.size_bytes,
        'resourceType', da.resource_type, 'resourceId', da.resource_id) order by da.created_at)
        from public.document_attachments da join public.documents d on d.id = da.document_id
        where da.user_id = v_user and d.deleted_at is null
          and da.document_id = any(v_document_ids)), '[]'::jsonb),
    'confirmedAiDraftId', v_draft
  );

  insert into public.legacy_plan_versions
    (legacy_plan_id, version_number, snapshot_data, completeness, acknowledged_incomplete, incomplete_sections, finalized_at)
  values (p_plan_id, v_plan.version, v_snapshot, v_plan.completion_status,
          cardinality(v_incomplete) > 0, v_incomplete, now())
  returning id into v_version;

  update public.legacy_plans
     set status = 'FINALIZED', finalized_at = now(), confirmed_by = v_user, current_step = 7,
         lock_version = lock_version + 1
   where id = p_plan_id;
  insert into public.notifications (user_id, type, title, content, channel, metadata)
  values (v_user, 'plan.finalized', 'Your legacy plan was finalized',
          'Version ' || v_plan.version::text || ' of your legacy plan is now finalized.', 'BOTH',
          jsonb_build_object('planId', p_plan_id, 'versionId', v_version))
  returning id into v_notif;
  perform public.lv_enqueue_job('notification.deliver', jsonb_build_object('notificationId', v_notif),
    'notification.deliver:' || v_notif::text);
  perform public.lv_audit(v_user, 'plan.finalized', 'legacy_plan', p_plan_id, 'SUCCESS',
    jsonb_build_object('versionId', v_version, 'version', v_plan.version,
                       'acknowledgedIncomplete', cardinality(v_incomplete) > 0, 'incompleteSections', to_jsonb(v_incomplete)), p_corr);
  perform public.lv_end();
  return v_version;
end;
$$;
