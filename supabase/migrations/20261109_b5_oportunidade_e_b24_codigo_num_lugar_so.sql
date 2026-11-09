-- =============================================================================
-- B5.1 — A OPORTUNIDADE GANHA ENTIDADE PRÓPRIA.
-- B2.4 — O CÓDIGO MORA EM UM LUGAR SÓ.
--
-- As duas coisas andam juntas de propósito: a oportunidade nasce já com a
-- regra do código aplicada — a referência da venda mora na COLUNA, e nunca
-- dentro do `data`.
--
-- ── POR QUE A OPORTUNIDADE VIRA ENTIDADE (decidido com ela em 05/11/2026) ───
--
-- Hoje a etapa do funil é um campo colado na ficha da pessoa. Consequência:
-- a pessoa só pode estar em UMA etapa. Duas propostas para o mesmo cliente,
-- uma em aberto e uma perdida, não cabem — e a Poli Instrumentos carrega
-- "Fechado" na ficha como se fosse um atributo dela.
--
-- A oportunidade aponta para a PESSOA, e não o contrário: no momento da
-- proposta ela ainda não é cliente. E cliente não precisa entrar pelo CRM
-- para existir no cadastro.
--
-- ── POR QUE O CÓDIGO EM UM LUGAR SÓ (B2.4) ─────────────────────────────────
--
-- Medido em 09/11/2026: 13 dos 14 cadastros tinham `data.codigo` DIFERENTE da
-- coluna `codigo` — e o valor do `data` não era nem o código anterior daquela
-- pessoa. A PLANCUS, cujo código anterior era CLI-001, carregava "CLI-002" no
-- `data`, que era o código anterior da TRAMAR. As duas fontes divergiram em
-- algum momento e ninguém percebeu, porque nenhuma tela lê o `data.codigo`.
--
-- Lixo que ninguém lê hoje é armadilha para quem ler amanhã. A coluna é a
-- fonte (ela tem índice único por usuária); o `data.codigo` sai, e um gatilho
-- impede que volte.
-- =============================================================================

-- ── 1. A oportunidade ───────────────────────────────────────────────────────
create table if not exists public.oportunidades (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid(),
  -- A REFERÊNCIA DA VENDA (P-2026-001). Mora aqui, na coluna, e em lugar
  -- nenhum mais: é citável na nota, no lançamento e no nome do arquivo.
  codigo     text,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.oportunidades is
  'O que esta sendo negociado com uma pessoa. A etapa do funil mora AQUI, e nao na ficha da pessoa: duas propostas para o mesmo cliente precisam caber.';

create unique index if not exists uq_oportunidades_user_codigo
  on public.oportunidades (user_id, codigo) where codigo is not null;
create index if not exists idx_oportunidades_pessoa
  on public.oportunidades ((data->>'pessoa_id'));
create index if not exists idx_oportunidades_situacao
  on public.oportunidades ((data->>'situacao'), created_at desc);

alter table public.oportunidades enable row level security;

drop policy if exists oportunidades_own_select on public.oportunidades;
drop policy if exists oportunidades_own_insert on public.oportunidades;
drop policy if exists oportunidades_own_update on public.oportunidades;
drop policy if exists oportunidades_own_delete on public.oportunidades;

create policy oportunidades_own_select on public.oportunidades
  for select to authenticated using (user_id = auth.uid());
create policy oportunidades_own_insert on public.oportunidades
  for insert to authenticated with check (user_id = auth.uid());
create policy oportunidades_own_update on public.oportunidades
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy oportunidades_own_delete on public.oportunidades
  for delete to authenticated using (user_id = auth.uid());

drop trigger if exists oportunidades_set_updated_at on public.oportunidades;
create trigger oportunidades_set_updated_at
  before update on public.oportunidades
  for each row execute function public.set_updated_at();

-- ── 2. O código mora na coluna, e o gatilho garante ─────────────────────────
create or replace function public.codigo_so_na_coluna()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  -- Quem gravar o código só dentro do `data` não perde o valor: ele é
  -- promovido para a coluna. O que não pode é ficar nos dois lugares, porque
  -- é assim que as duas fontes divergem sem ninguém perceber.
  if (new.data ? 'codigo') then
    if new.codigo is null or new.codigo = '' then
      new.codigo := nullif(new.data->>'codigo', '');
    end if;
    new.data := new.data - 'codigo';
  end if;
  return new;
end;
$$;

comment on function public.codigo_so_na_coluna() is
  'O codigo do registro mora na coluna. Duas fontes para o mesmo dado divergem: medido em 09/11/2026, 13 de 14 cadastros tinham data.codigo diferente da coluna.';

drop trigger if exists pessoas_codigo_so_na_coluna on public.pessoas;
create trigger pessoas_codigo_so_na_coluna
  before insert or update on public.pessoas
  for each row execute function public.codigo_so_na_coluna();

drop trigger if exists payable_codigo_so_na_coluna on public.payable;
create trigger payable_codigo_so_na_coluna
  before insert or update on public.payable
  for each row execute function public.codigo_so_na_coluna();

drop trigger if exists receivable_codigo_so_na_coluna on public.receivable;
create trigger receivable_codigo_so_na_coluna
  before insert or update on public.receivable
  for each row execute function public.codigo_so_na_coluna();

drop trigger if exists oportunidades_codigo_so_na_coluna on public.oportunidades;
create trigger oportunidades_codigo_so_na_coluna
  before insert or update on public.oportunidades
  for each row execute function public.codigo_so_na_coluna();

-- ── 3. A limpeza do que já está lá ──────────────────────────────────────────
--
-- O valor removido está registrado em Backup_Codigo_No_Data_9nov2026.md, com
-- o antes de cada linha. A coluna `codigo` NÃO é tocada, e o campo
-- `codigo_anterior` — que é história deliberada da renumeração — fica.
update public.pessoas set data = data - 'codigo' where data ? 'codigo';
update public.payable set data = data - 'codigo' where data ? 'codigo';
update public.receivable set data = data - 'codigo' where data ? 'codigo';
