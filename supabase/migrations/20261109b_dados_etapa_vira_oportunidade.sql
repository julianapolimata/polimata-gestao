-- =============================================================================
-- MIGRAÇÃO DE DADOS — a etapa que estava na ficha vira oportunidade.
--
-- Cinco pessoas carregam `etapa_funil` na ficha. Cada uma vira UMA
-- oportunidade, e o que estava escrito é traduzido sem ser melhorado:
--
--   "Fechado"             → situação ganha, etapa vazia (saiu do funil)
--   "Sondagem"/"Proposta" → situação aberta, etapa igual
--   "Perdido"             → situação perdida, sem motivo (ninguém registrou)
--
-- A Terra Conttemporânea está como "Sondagem" na ficha, embora seja cliente.
-- Isso NÃO é corrigido aqui: o dado diz Sondagem, e inventar "ganha" seria
-- escrever uma venda que ninguém registrou. Ela corrige na tela do Funil, que
-- é justamente o que a ficha não permitia fazer sem mexer no cadastro.
--
-- O que NÃO vem junto, porque não existe em lugar nenhum: a referência
-- (P-2026-001) e o valor estimado. Ficam vazios, para ela preencher a partir
-- das propostas do Drive.
--
-- `etapa_funil` e `origin` CONTINUAM na ficha, intocados. O Polímata App
-- recebe esses campos no aviso de mudança de cadastro, e apagá-los agora
-- mudaria o que chega lá sem ninguém ter conferido o outro lado.
-- =============================================================================
insert into public.oportunidades (user_id, codigo, data)
select
  p.user_id,
  null,
  jsonb_build_object(
    'pessoa_id',     p.id::text,
    'situacao',      case p.data->>'etapa_funil'
                       when 'Fechado' then 'ganha'
                       when 'Perdido' then 'perdida'
                       else 'aberta' end,
    'etapa',         case p.data->>'etapa_funil'
                       when 'Fechado' then ''
                       when 'Perdido' then ''
                       else p.data->>'etapa_funil' end,
    'origem',        coalesce(p.data->>'origin', ''),
    'valor_estimado', null,
    'motivo_perda',  '',
    'descricao',     '',
    'data_proposta', null,
    -- De onde este registro veio. Sem isto, daqui a seis meses ninguém sabe
    -- se a oportunidade foi registrada por ela ou deduzida de um campo velho.
    'origem_do_dado', 'migracao da etapa que estava na ficha, 09/11/2026',
    'created',       to_char(now(), 'YYYY-MM-DD')
  )
from public.pessoas p
where nullif(p.data->>'etapa_funil', '') is not null
  and not exists (
    select 1 from public.oportunidades o where o.data->>'pessoa_id' = p.id::text
  );
