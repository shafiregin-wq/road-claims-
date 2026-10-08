-- Privacy and workspace rules for supabase/schema.sql.
-- Run with tests/sql/run.sh, which loads the Supabase stand-in and the schema first.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
\set C '33333333-3333-3333-3333-333333333333'

create schema t;
grant usage on schema t to anon, authenticated, supabase_auth_admin;
create function t.expect_error(stmt text, needle text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if position(needle in sqlerrm) = 0 then
      raise exception 'expected error containing "%", got "%" for: %', needle, sqlerrm, stmt;
    end if;
    raise notice 'ok - refused: %', needle;
    return;
  end;
  raise exception 'expected error containing "%", but it succeeded: %', needle, stmt;
end $$;
create function t.eq(actual anyelement, expected anyelement, label text) returns void language plpgsql as $$
begin
  if actual is distinct from expected then raise exception 'FAIL %: expected %, got %', label, expected, actual; end if;
  raise notice 'ok - %', label;
end $$;
grant execute on all functions in schema t to anon, authenticated, supabase_auth_admin;

insert into auth.users (id, email) values (:'A', 'a@example.com'), (:'B', 'b@example.com'), (:'C', 'c@example.com');

-- ---------- User A creates the workspace ----------
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'A')::text, false) is not null as _ \gset
select create_workspace('  Shafi   Regin ') ->> 'invite_code' as code \gset
select my_workspace_id() as wid \gset
select t.eq((select display_name from members where user_id = :'A'), 'Shafi Regin', 'owner name is tidied');
select t.eq((select role from members where user_id = :'A'), 'owner', 'creator is the owner');
select t.eq(length(:'code'), 12, 'invite code has 12 characters');
select t.expect_error($$select create_workspace('Again')$$, 'MITAK_ALREADY_MEMBER');
select t.expect_error($$select join_workspace('000000000000', 'Again')$$, 'MITAK_ALREADY_MEMBER');
select t.expect_error($$select create_workspace('   ')$$, 'MITAK_ALREADY_MEMBER');

insert into expenses (workspace_id, category, amount, expense_date, paid_by, created_by, details)
values (:'wid', 'fuel', 150.5, '2026-10-03', :'A', :'B', '{"litres": 52.1, "odometer": 120345}');
select t.eq((select created_by from expenses limit 1), :'A'::uuid, 'created_by comes from the signed-in user, not the request');
select t.expect_error(format($$insert into expenses (workspace_id, category, amount, expense_date, paid_by) values (%L, 'toll', 4, '2026-10-03', %L)$$, :'wid', :'C'), 'MITAK_PAID_BY_NOT_MEMBER');
select t.expect_error(format($$insert into expenses (workspace_id, category, amount, expense_date, paid_by) values (%L, 'taxi', 4, '2026-10-03', %L)$$, :'wid', :'A'), 'expenses_category_check');
select t.expect_error(format($$insert into expenses (workspace_id, category, amount, expense_date, paid_by) values (%L, 'food', 0, '2026-10-03', %L)$$, :'wid', :'A'), 'expenses_amount_check');
select t.expect_error($$update members set role = 'member'$$, 'permission denied');
select t.expect_error($$update workspaces set invite_code = 'AAAAAAAAAAAA'$$, 'permission denied');
update members set display_name = 'Shafi', profile = '{"employee_id": "E-104"}' where user_id = :'A';
select t.eq((select display_name from members where user_id = :'A'), 'Shafi', 'members can edit their own name and details');
select regenerate_invite() as code \gset
select t.eq((select invite_code from workspaces), :'code', 'owner can make a fresh invite code');
select id as fuel_id from expenses where category = 'fuel' \gset
insert into storage.objects (bucket_id, name) values ('mitak', :'wid' || '/receipts/r1.jpg');
insert into storage.objects (bucket_id, name) values ('mitak', :'wid' || '/receipts/' || :'fuel_id' || '/bill.jpg');
insert into report_templates (workspace_id, category, file_name, mapping) values (:'wid', 'fuel', 'Fuel claim.xlsx', '{"columns": {"amount": "Amount"}}');

-- ---------- User C, a stranger with an account, before B joins ----------
select set_config('request.jwt.claims', json_build_object('sub', :'C')::text, false) is not null as _ \gset
select t.expect_error($$select create_workspace('Eve')$$, 'MITAK_WORKSPACE_EXISTS');
select t.expect_error($$select join_workspace('ABCDEF012345', 'Eve')$$, 'MITAK_INVITE_INVALID');
select t.expect_error($$select join_workspace('12345', 'Eve')$$, 'MITAK_INVITE_INVALID');
select t.expect_error($$select regenerate_invite()$$, 'MITAK_OWNER_ONLY');
select t.eq((select count(*) from workspaces), 0::bigint, 'stranger sees no workspace');
select t.eq((select count(*) from members), 0::bigint, 'stranger sees no members');
select t.eq((select count(*) from expenses), 0::bigint, 'stranger sees no expenses');
select t.eq((select count(*) from report_templates), 0::bigint, 'stranger sees no templates');
select t.eq((select count(*) from storage.objects where bucket_id = 'mitak'), 0::bigint, 'stranger sees no files');
select t.expect_error(format($$insert into expenses (workspace_id, category, amount, expense_date, paid_by) values (%L, 'toll', 4, '2026-10-03', %L)$$, :'wid', :'A'), 'row-level security');
select t.expect_error(format($$insert into storage.objects (bucket_id, name) values ('mitak', %L)$$, :'wid' || '/receipts/evil.jpg'), 'row-level security');
update expenses set amount = 1 where true;
delete from expenses where true;

-- ---------- User B joins with the code, typed loosely ----------
select set_config('request.jwt.claims', json_build_object('sub', :'B')::text, false) is not null as _ \gset
select join_workspace(' mitak-' || lower(substr(:'code', 1, 4) || '-' || substr(:'code', 5, 4) || ' ' || substr(:'code', 9)), 'Ahmed') is not null as _ \gset
select t.eq((select count(*) from members), 2::bigint, 'colleague sees both members');
select t.eq((select amount from expenses), 150.50::numeric, 'colleague sees the shared expense, untouched by the stranger');
select t.eq((select count(*) from storage.objects where bucket_id = 'mitak'), 2::bigint, 'colleague sees the receipt files');
select t.eq((select count(*) from report_templates), 1::bigint, 'colleague sees the template');
select t.eq((select invite_code from workspaces), null::text, 'invite code is used up once both have joined');
select t.eq((select role from members where user_id = :'B'), 'member', 'colleague joins as member');
-- Each member only adds, changes and deletes their own expenses.
select t.expect_error(format($$insert into expenses (workspace_id, category, amount, expense_date, paid_by) values (%L, 'parking', 20, '2026-10-03', %L)$$, :'wid', :'A'), 'row-level security');
update expenses set amount = 1 where category = 'fuel';
delete from expenses where category = 'fuel';
select t.eq((select amount from expenses where category = 'fuel'), 150.50::numeric, 'a member cannot change or delete the other''s expense');
select t.expect_error(format($$insert into storage.objects (bucket_id, name) values ('mitak', %L)$$, :'wid' || '/receipts/' || :'fuel_id' || '/swap.jpg'), 'row-level security');
delete from storage.objects where name like '%/bill.jpg';
select t.eq((select count(*) from storage.objects where name like '%/bill.jpg'), 1::bigint, 'nor its receipt');
-- Shared costs: Ahmed paid 60 for food, 40 of it is Shafi's.
insert into expenses (workspace_id, category, amount, expense_date, paid_by, split, other_share) values (:'wid', 'food', 60, '2026-10-03', :'B', 'custom', 40);
select t.expect_error(format($$insert into expenses (workspace_id, category, amount, expense_date, paid_by, split, other_share) values (%L, 'food', 10, '2026-10-03', %L, 'custom', 20)$$, :'wid', :'B'), 'expenses_split_check');
select t.expect_error(format($$insert into expenses (workspace_id, category, amount, expense_date, paid_by, split, other_share) values (%L, 'food', 10, '2026-10-03', %L, 'none', 5)$$, :'wid', :'B'), 'expenses_split_check');
insert into settlements (workspace_id, from_user, to_user, amount, note) values (:'wid', :'B', :'A', 25, 'cash');
select t.expect_error(format($$insert into settlements (workspace_id, from_user, to_user, amount) values (%L, %L, %L, 5)$$, :'wid', :'B', :'B'), 'MITAK_SAME_PERSON');
select t.expect_error(format($$insert into settlements (workspace_id, from_user, to_user, amount) values (%L, %L, %L, 5)$$, :'wid', :'B', :'C'), 'MITAK_PAID_BY_NOT_MEMBER');
select t.eq((select created_by from settlements), :'B'::uuid, 'payments record who entered them');
select t.expect_error($$update settlements set amount = 1$$, 'permission denied');
update members set display_name = 'Hacked' where role = 'owner';
select t.eq((select display_name from members where role = 'owner'), 'Shafi', 'a member cannot rename the other member');
select t.expect_error($$select regenerate_invite()$$, 'MITAK_OWNER_ONLY');

-- ---------- Push notification phones ----------
select save_push_subscription('https://push.example/b-phone', 'BPUBKEY', 'BAUTH', 'iPhone') is not null as _ \gset
select t.eq((select count(*) from push_subscriptions), 1::bigint, 'a member sees their own phone');
select t.expect_error($$select * from push_config$$, 'permission denied');
select t.expect_error($$insert into push_subscriptions (endpoint, user_id, workspace_id, p256dh, auth) values ('https://x', auth.uid(), my_workspace_id(), 'k', 'a')$$, 'permission denied');
select t.expect_error($$select save_push_subscription('javascript:alert(1)', 'k', 'a')$$, 'MITAK_PUSH_INVALID');
select set_config('request.jwt.claims', json_build_object('sub', :'A')::text, false) is not null as _ \gset
select t.eq((select count(*) from push_subscriptions), 0::bigint, 'the other member does not see it');
select delete_push_subscription('https://push.example/b-phone') is not null as _ \gset
select set_config('request.jwt.claims', json_build_object('sub', :'B')::text, false) is not null as _ \gset
select t.eq((select count(*) from push_subscriptions), 1::bigint, 'and cannot delete it');
select set_config('request.jwt.claims', json_build_object('sub', :'A')::text, false) is not null as _ \gset
select save_push_subscription('https://push.example/b-phone', 'APUBKEY', 'AAUTH') is not null as _ \gset
select t.eq((select user_id from push_subscriptions), :'A'::uuid, 'a phone signed in by someone else is taken over');
select set_config('request.jwt.claims', json_build_object('sub', :'C')::text, false) is not null as _ \gset
select t.expect_error($$select save_push_subscription('https://push.example/c', 'k', 'a')$$, 'MITAK_NOT_MEMBER');
select set_config('request.jwt.claims', json_build_object('sub', :'B')::text, false) is not null as _ \gset

-- ---------- The workspace is now closed ----------
select set_config('request.jwt.claims', json_build_object('sub', :'A')::text, false) is not null as _ \gset
update expenses set amount = 155 where category = 'fuel';
select t.eq((select array[created_by, updated_by, paid_by] from expenses where category = 'fuel'), array[:'A', :'A', :'A']::uuid[], 'the owner can edit their expense');
update expenses set amount = 1 where category = 'food';
select t.eq((select amount from expenses where category = 'food'), 60.00::numeric, 'and not the colleague''s');
select t.expect_error(format($$update expenses set paid_by = %L where category = 'fuel'$$, :'B'), 'row-level security');
delete from settlements;
select t.eq((select count(*) from settlements), 1::bigint, 'only the person who entered a payment can delete it');
select t.eq((select count(*) from storage.objects where name like '%/bill.jpg'), 1::bigint, 'the owner still has the receipt');
delete from storage.objects where name like '%/bill.jpg';
select t.eq((select count(*) from storage.objects where name like '%/bill.jpg'), 0::bigint, 'and can delete it');
select t.expect_error($$select regenerate_invite()$$, 'MITAK_WORKSPACE_FULL');
select set_config('request.jwt.claims', json_build_object('sub', :'C')::text, false) is not null as _ \gset
select t.expect_error(format($$select join_workspace(%L, 'Eve')$$, :'code'), 'MITAK_INVITE_INVALID');
select t.eq((select count(*) from expenses), 0::bigint, 'stranger still sees nothing');
reset role;
select t.expect_error(format($$insert into members (workspace_id, user_id, display_name) values (%L, %L, 'Eve')$$, :'wid', :'C'), 'MITAK_WORKSPACE_FULL');
set role supabase_auth_admin;
select t.expect_error($$insert into auth.users (email) values ('d@example.com')$$, 'MITAK_SIGNUPS_CLOSED');
set role anon;
select set_config('request.jwt.claims', '', false) is not null as _ \gset
select t.expect_error($$select count(*) from expenses$$, 'permission denied');
select t.expect_error($$select create_workspace('Anon')$$, 'permission denied');
reset role;
\o
\echo 'All schema tests passed.'
