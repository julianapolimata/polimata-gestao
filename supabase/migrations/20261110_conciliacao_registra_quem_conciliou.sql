-- =============================================================================
-- Aplicada em 10/11/2026. Ver Laudo_Auditoria_Sistema_Gestao_10nov2026.md.
--
-- O SISTEMA DEIXA DE APRENDER COM AS PROPRIAS SUGESTOES.
--
-- Em src/lib/regrasConciliacao.js ha esta guarda, com este comentario:
--
--     // Aprender do que o proprio sistema propos seria aprender com ele mesmo.
--     if (e?.data?.conciliado_por === 'automatico') continue
--
-- O campo `conciliado_por` nunca era escrito -- nem pelo codigo, nem por funcao
-- do banco. A guarda nunca disparava: uma conciliacao feita pelo botao
-- automatico entrava no aprendizado como se fosse decisao dela, e o sistema
-- passava a confirmar os proprios palpites.
--
-- A correcao: `conciliar_vincular` recebe a ORIGEM e grava-a no extrato. O
-- parametro tem default 'manual', que e o caso seguro -- qualquer chamada que
-- nao informe origem continua valendo como decisao humana. Descartar o que nao
-- tem marca apagaria o aprendizado inteiro de uma vez.
--
-- A assinatura muda, por isso a funcao e recriada.
-- =============================================================================
drop function if exists public.conciliar_vincular(uuid, text, uuid, jsonb);

create or replace function public.conciliar_vincular(
  p_extrato_id uuid,
  p_target     text,
  p_lanc_id    uuid,
  p_merged     jsonb,
  p_origem     text default 'manual'
)
returns void
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  -- So dois valores sao aceitos. Texto livre aqui viraria, com o tempo, varios
  -- rotulos para a mesma coisa -- e a guarda do aprendizado compara por
  -- igualdade exata.
  v_origem text := case when p_origem = 'automatico' then 'automatico' else 'manual' end;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  update public.transacoes_extrato
     set status = 'conciliado',
         lancamento_tipo = p_target,
         lancamento_id = p_lanc_id,
         -- QUEM conciliou. E por este campo que o aprendizado sabe distinguir
         -- o que ela decidiu do que o sistema propos.
         data = coalesce(data, '{}'::jsonb) || jsonb_build_object('conciliado_por', v_origem)
   where id = p_extrato_id and user_id = v_uid and status = 'pendente';
  if not found then
    raise exception 'linha_indisponivel: esta linha do extrato já foi conciliada ou arquivada — recarregue a tela';
  end if;

  if p_target = 'receivable' then
    update public.receivable set data = p_merged, conciliado_em = now(), extrato_id = p_extrato_id
      where id = p_lanc_id and user_id = v_uid;
  elsif p_target = 'payable' then
    update public.payable set data = p_merged, conciliado_em = now(), extrato_id = p_extrato_id
      where id = p_lanc_id and user_id = v_uid;
  else
    raise exception 'target_invalido';
  end if;
  if not found then raise exception 'lancamento_nao_encontrado'; end if;
end;
$function$;

comment on function public.conciliar_vincular(uuid, text, uuid, jsonb, text) is
  'Concilia uma linha do extrato com um lancamento. p_origem grava quem conciliou: o aprendizado das regras ignora o que foi conciliado automaticamente, para o sistema nao aprender com as proprias sugestoes.';
