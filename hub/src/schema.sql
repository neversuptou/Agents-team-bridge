create table if not exists members (
  id serial primary key, full_name text not null, short_name text not null unique,
  token_hash text not null unique, is_admin boolean not null default false,
  revoked_at timestamptz, last_seen_at timestamptz, created_at timestamptz not null default now());
create table if not exists projects (id serial primary key, name text not null unique, git_remote text);
create table if not exists member_projects (
  member_id int not null references members(id), project_id int not null references projects(id),
  local_path text, primary key (member_id, project_id));
create table if not exists threads (
  id serial primary key, subject text not null, project_id int references projects(id),
  created_by int not null references members(id),
  status text not null default 'open' check (status in ('open','waiting','closed','needs_human')),
  turns int not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists thread_participants (
  thread_id int not null references threads(id), member_id int not null references members(id),
  last_read_message_id int not null default 0, primary key (thread_id, member_id));
create table if not exists messages (
  id serial primary key, thread_id int not null references threads(id), author_id int not null references members(id),
  text text not null, actions jsonb not null default '[]', created_at timestamptz not null default now());
create table if not exists decisions (
  id serial primary key, thread_id int not null references threads(id), project_id int references projects(id),
  summary text not null, links jsonb not null default '[]', created_by int not null references members(id),
  created_at timestamptz not null default now());
create table if not exists jobs (
  id serial primary key, thread_id int not null references threads(id), member_id int not null references members(id),
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  attempts int not null default 0, error text, created_at timestamptz not null default now(),
  started_at timestamptz, finished_at timestamptz);
create table if not exists settings (key text primary key, value text not null);
create index if not exists jobs_member_status on jobs(member_id, status);
create index if not exists messages_thread on messages(thread_id, id);
