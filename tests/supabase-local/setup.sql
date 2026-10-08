-- Roles and schemas a Supabase project has before MITAK's schema.sql runs (local testing only).
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login password 'test' noinherit;
grant anon, authenticated, service_role to authenticator;
create role supabase_auth_admin login password 'test' createrole;
create schema auth authorization supabase_auth_admin;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
