-- Editors may request Evidence Matrix extraction for papers linked to a project.
begin;
create or replace function public.request_paper_extraction(p_paper_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_status text; v_generation timestamptz; v_inserted int; e_status text; e_generation timestamptz;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select p.status, p.processing_completed_at into v_status, v_generation from public.papers p
   where p.id = p_paper_id and (p.user_id = v_uid or exists (select 1 from public.paper_project_links l where l.paper_id = p.id and public.can_edit_project(l.project_id))) for key share;
  if not found then return 'not_found'; end if;
  if v_status <> 'ready' or v_generation is null then return 'not_ready'; end if;
  select e.status, e.source_completed_at into e_status, e_generation from public.paper_extractions e where e.paper_id = p_paper_id and e.schema_version = 1 for update;
  if found and e_status in ('pending','running') then return 'unchanged'; end if;
  if found and e_status = 'complete' and e_generation = v_generation then return 'unchanged'; end if;
  if found then
    update public.paper_extractions set status='pending', source_completed_at=v_generation, attempts=0, claimed_at=null, completed_at=null, updated_at=now(), last_error=null where paper_id=p_paper_id and schema_version=1;
  else
    insert into public.paper_extractions(paper_id, schema_version, status, source_completed_at) values (p_paper_id, 1, 'pending', v_generation);
  end if;
  return 'requested';
end; $$;
commit;
