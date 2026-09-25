-- R11 manual, read-only verification. Run in staging after applying 0020.
select profile_key, request_limit, token_limit
  from public.ai_allowance_profiles
 order by profile_key;

select
  has_function_privilege('authenticated', 'public.get_my_ai_allowance()', 'execute')
    as authenticated_can_read_own_allowance,
  has_function_privilege('authenticated', 'public.get_ai_allowance_for_actor(uuid)', 'execute')
    as browser_can_check_other_actor,
  has_table_privilege('authenticated', 'public.ai_allowance_profiles', 'select')
    as browser_can_read_allowance_config,
  has_table_privilege('authenticated', 'public.user_ai_allowance_profiles', 'update')
    as browser_can_assign_allowance_profile;

select * from public.get_my_ai_allowance();
