create table if not exists members (
  id serial primary key, full_name text not null, short_name text not null unique,
  token_hash text not null unique, is_admin boolean not null default false,
  revoked_at timestamptz, last_seen_at timestamptz, created_at timestamptz not null default now());
create table if not exists projects (id serial primary key, name text not null unique, git_remote text);
create table if not exists member_projects (
  member_id int not null references members(id), project_id int not null references projects(id),
  local_path text, primary key (member_id, project_id));
-- переписка разрешена только в проектах Evapps (git на *.evapps.ru или пометка админа)
alter table projects add column if not exists is_evapps boolean not null default false;
-- доступ к каналу (проекту) подтверждает админ
alter table member_projects add column if not exists approved boolean not null default false;
-- одноразовые именные приглашения со сроком
create table if not exists invites (
  id serial primary key, token_hash text not null unique, full_name text not null, is_admin boolean not null default false,
  created_by int references members(id), expires_at timestamptz not null, used_at timestamptz, used_by int references members(id),
  created_at timestamptz not null default now());
create table if not exists threads (
  id serial primary key, subject text not null, project_id int references projects(id),
  created_by int not null references members(id),
  status text not null default 'open' check (status in ('open','waiting','closed','needs_human')),
  turns int not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
-- запрос виден Claude получателя только после того, как человек-получатель его принял
alter table threads add column if not exists accepted_at timestamptz;
alter table threads drop constraint if exists threads_status_check;
alter table threads add constraint threads_status_check check (status in ('open','waiting','closed','needs_human','rejected'));
create table if not exists thread_participants (
  thread_id int not null references threads(id), member_id int not null references members(id),
  last_read_message_id int not null default 0, primary key (thread_id, member_id));
create table if not exists messages (
  id serial primary key, thread_id int not null references threads(id), author_id int not null references members(id),
  text text not null, actions jsonb not null default '[]', created_at timestamptz not null default now());
alter table messages add column if not exists kind text not null default 'answer' check (kind in ('question','answer','status','note'));
-- quarantined — ждёт решения админа (эвристика инъекции), deleted — удалено админом
alter table messages add column if not exists state text not null default 'delivered' check (state in ('delivered','quarantined','deleted'));
create table if not exists decisions (
  id serial primary key, thread_id int not null references threads(id), project_id int references projects(id),
  summary text not null, links jsonb not null default '[]', created_by int not null references members(id),
  created_at timestamptz not null default now());
create table if not exists settings (key text primary key, value text not null);
create table if not exists alerts (
  id serial primary key, kind text not null check (kind in ('secret','injection')), member_id int references members(id),
  message_id int, details text not null, resolved_at timestamptz, created_at timestamptz not null default now());
-- журнал только на добавление: кто, что, когда, кому (без текста сообщений)
create table if not exists audit_log (
  id bigserial primary key, at timestamptz not null default now(), actor_id int, action text not null,
  target text, details jsonb not null default '{}');
create or replace function audit_log_append_only() returns trigger language plpgsql as $$
begin raise exception 'audit_log: только добавление'; end $$;
drop trigger if exists audit_log_no_change on audit_log;
create trigger audit_log_no_change before update or delete or truncate on audit_log for each statement execute function audit_log_append_only();
drop table if exists jobs;
-- перенос со старой версии: проекты админов подтверждены, репозитории на *.evapps.ru — проекты Evapps
update member_projects set approved=true where not approved and member_id in (select id from members where is_admin);
update projects set is_evapps=true where not is_evapps and git_remote ~* '^([a-z+]+://)?([^@/]+@)?([a-z0-9-]+\.)*evapps\.ru[:/]';
delete from settings where key='invite_code_hash';
create index if not exists messages_thread on messages(thread_id, id);
create index if not exists messages_author_time on messages(author_id, created_at);
