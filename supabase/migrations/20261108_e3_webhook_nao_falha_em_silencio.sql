-- =============================================================================
-- E3 — O GATILHO DO POLÍMATA APP PARA DE FALHAR EM SILÊNCIO.
--
-- Como era: o gatilho monta o aviso e chama net.http_post, que é ASSÍNCRONO —
-- ele enfileira e devolve na hora. O resultado da entrega chega depois, numa
-- tabela interna do pg_net que ninguém lê e que é limpa sozinha. Se o token
-- sumisse do Vault, se o endereço mudasse, se a função do outro lado recusasse:
-- RAISE WARNING no log do servidor, e a vida seguia.
--
-- Consequência: um cliente podia existir no Gestão e não no CI, ou ser
-- desativado num e continuar ativo no outro, sem ninguém saber. Para uma
-- consultoria de governança, divergência silenciosa entre dois sistemas é
-- exatamente o furo que ela audita nos clientes.
--
-- Como fica: toda tentativa vira linha em `webhook_entregas`, com o que o
-- sistema SABE em cada momento — enviado, sem token, erro no envio, entregue,
-- recusado, ou "sem resposta" quando a janela de conferência passou. "Não sei"
-- continua sendo diferente de "falhou", e os dois ficam visíveis.
-- =============================================================================

-- ── 1. O registro ───────────────────────────────────────────────────────────
create table if not exists public.webhook_entregas (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid,
  criado_em     timestamptz not null default now(),
  tabela        text not null,
  operacao      text not null,
  registro_id   uuid,
  registro_nome text,
  -- O id que o pg_net devolve. É por ele que a resposta é encontrada depois.
  request_id    bigint,
  -- enviado | sem_token | erro_no_envio | entregue | recusado | sem_resposta
  status        text not null,
  http_status   int,
  detalhe       text,
  conferido_em  timestamptz
);

comment on table public.webhook_entregas is
  'Toda tentativa de avisar o Polímata App sobre mudança no cadastro. Existe para que divergência entre os dois sistemas deixe de ser silenciosa.';

create index if not exists idx_webhook_entregas_status
  on public.webhook_entregas (status, criado_em desc);
create index if not exists idx_webhook_entregas_request
  on public.webhook_entregas (request_id) where request_id is not null;

alter table public.webhook_entregas enable row level security;

-- Leitura só do dono, como o resto do sistema. Escrita é só do gatilho, que
-- roda como SECURITY DEFINER: nenhuma política de insert, de propósito.
drop policy if exists webhook_entregas_own_select on public.webhook_entregas;
create policy webhook_entregas_own_select on public.webhook_entregas
  for select to authenticated using (user_id = auth.uid());

-- ── 2. O gatilho passa a registrar ──────────────────────────────────────────
create or replace function public.notify_clientes_webhook()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'net', 'vault'
as $function$
declare
  v_token      text;
  v_url        text := 'https://iqtkpyrpwxypwcwrhulx.supabase.co/functions/v1/clientes-webhook';
  v_payload    jsonb;
  v_record     jsonb;
  v_old_record jsonb;
  v_req        bigint;
  v_linha      jsonb := to_jsonb(coalesce(new, old));
begin
  select decrypted_secret into v_token
    from vault.decrypted_secrets
   where name = 'webhook_clientes_token' limit 1;

  if v_token is null then
    -- Antes isto era só um WARNING no log. Agora fica escrito onde ela vê:
    -- sem o token, NENHUM cadastro chega ao outro sistema, e isso precisa
    -- aparecer no primeiro cadastro, não seis meses depois.
    insert into public.webhook_entregas
      (user_id, tabela, operacao, registro_id, registro_nome, status, detalhe)
    values (
      (v_linha->>'user_id')::uuid, tg_table_name, tg_op,
      (v_linha->>'id')::uuid, v_linha->'data'->>'nome',
      'sem_token',
      'O token do webhook não está no Vault. Enquanto não estiver, nenhuma mudança de cadastro chega ao Polímata App.'
    );
    return coalesce(new, old);
  end if;

  if (tg_op = 'INSERT' or tg_op = 'UPDATE') then v_record := to_jsonb(new); end if;
  if (tg_op = 'UPDATE' or tg_op = 'DELETE') then v_old_record := to_jsonb(old); end if;

  v_payload := jsonb_build_object(
    'type', tg_op, 'table', tg_table_name, 'schema', tg_table_schema,
    'record', v_record, 'old_record', v_old_record
  );

  -- http_post é ASSÍNCRONO: devolve um id e segue. O que ele garante é que a
  -- requisição foi enfileirada, não que chegou. Por isso o status aqui é
  -- "enviado", e não "entregue" — a diferença é conferida depois.
  v_req := net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-token', v_token),
    body    := v_payload,
    timeout_milliseconds := 5000
  );

  insert into public.webhook_entregas
    (user_id, tabela, operacao, registro_id, registro_nome, request_id, status)
  values (
    (v_linha->>'user_id')::uuid, tg_table_name, tg_op,
    (v_linha->>'id')::uuid, v_linha->'data'->>'nome',
    v_req, 'enviado'
  );

  return coalesce(new, old);
exception
  when others then
    -- O cadastro NÃO é desfeito por falha de aviso: travar o cadastro de um
    -- cliente porque o outro sistema está fora seria pior que a divergência.
    -- Mas a falha deixa de ser invisível.
    begin
      insert into public.webhook_entregas
        (user_id, tabela, operacao, registro_id, registro_nome, status, detalhe)
      values (
        (v_linha->>'user_id')::uuid, tg_table_name, tg_op,
        (v_linha->>'id')::uuid, v_linha->'data'->>'nome',
        'erro_no_envio', sqlerrm || ' (' || sqlstate || ')'
      );
    exception when others then null;
    end;
    return coalesce(new, old);
end;
$function$;

-- ── 3. A conferência ────────────────────────────────────────────────────────
--
-- A resposta do pg_net chega numa tabela interna que é limpa sozinha, em
-- algumas horas. Esta função casa o que já respondeu e, passada a janela,
-- assume "sem resposta" — que NÃO é o mesmo que recusado: é o sistema dizendo
-- que não soube, em vez de inventar um veredito.
create or replace function public.conferir_entregas_webhook()
returns table (entregues int, recusadas int, sem_resposta int)
language plpgsql
security definer
set search_path to 'public', 'net'
as $$
declare
  v_ok int := 0; v_nao int := 0; v_mudo int := 0;
begin
  with casadas as (
    update public.webhook_entregas e
       set status       = case when r.status_code between 200 and 299 then 'entregue' else 'recusado' end,
           http_status  = r.status_code,
           detalhe      = nullif(r.error_msg, ''),
           conferido_em = now()
      from net._http_response r
     where r.id = e.request_id and e.status = 'enviado'
    returning e.status
  )
  select count(*) filter (where status = 'entregue'),
         count(*) filter (where status = 'recusado')
    into v_ok, v_nao from casadas;

  -- Passadas 6 horas sem resposta encontrada, a resposta já não existe para
  -- ser encontrada. O registro passa a dizer isso, em vez de ficar "enviado"
  -- para sempre e parecer pendente.
  update public.webhook_entregas
     set status = 'sem_resposta',
         conferido_em = now(),
         detalhe = coalesce(detalhe, 'A resposta não foi encontrada dentro da janela de conferência. Não dá para afirmar que chegou nem que falhou.')
   where status = 'enviado' and criado_em < now() - interval '6 hours';
  get diagnostics v_mudo = row_count;

  return query select v_ok, v_nao, v_mudo;
end;
$$;

grant execute on function public.conferir_entregas_webhook() to authenticated;
