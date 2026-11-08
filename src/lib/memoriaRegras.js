// =============================================================================
// A MEMÓRIA DAS REGRAS APRENDIDAS.
//
// O defeito que isto fecha: as 30 regras nunca existiram em lugar nenhum. Eram
// recalculadas em memória a cada abertura de tela, a partir dos próprios
// lançamentos. Quando a base foi apagada em 05/11/2026, elas sumiram — caladas,
// sem mensagem de erro. Quem descobriria seria ela, com a pré-carga muda.
//
// O QUE ESTA MEMÓRIA NÃO É: não substitui o cálculo. A regra VIVA continua
// saindo das escriturações manuais, com a mesma exigência de unanimidade — se
// o histórico de um fornecedor diverge, não vira regra, e isso não muda.
//
// O que ela faz é SOBREVIVER ao dado. Guarda o que foi aprendido, para que uma
// próxima limpeza não apague de novo o que ela decidiu uma a uma.
//
// A ordem de precedência, e ela importa: a regra viva SEMPRE ganha da guardada.
// O lançamento de hoje é mais verdadeiro que a lembrança de ontem.
// =============================================================================
import { supabase } from './supabase'

/** O que foi aprendido e ficou guardado. Map<chave, classificacao>. */
export async function lerMemoria() {
  const { data, error } = await supabase
    .from('regras_classificacao').select('chave,data')
  if (error) {
    // A memória é um ganho, não um requisito: falhando, a tela segue com as
    // regras vivas. Nada quebra por causa dela.
    console.warn('não consegui ler a memória das regras:', error.message)
    return new Map()
  }
  const m = new Map()
  for (const r of data || []) {
    if (!r.chave || !r.data) continue
    m.set(r.chave, {
      cat: r.data.cat || '',
      subcat: r.data.subcat || '',
      doc_status: r.data.doc_status || '',
      doc_motivo_dispensa: r.data.doc_motivo_dispensa || '',
      // De onde esta classificação veio, para a tela poder dizer. A regra
      // guardada é decisão dela de antes da limpeza: a tela mostra isso em
      // vez de apresentar o campo preenchido como se fosse palpite do sistema.
      origem: 'memoria',
      guardado_em: r.data.guardado_em || null,
    })
  }
  return m
}

/** Guarda as regras vivas, para elas atravessarem a próxima limpeza. */
export async function guardarMemoria(regrasVivas, memoriaAtual) {
  const novas = []
  for (const [chave, c] of regrasVivas) {
    const guardada = memoriaAtual?.get(chave)
    const igual = guardada
      && guardada.cat === c.cat
      && guardada.subcat === c.subcat
      && guardada.doc_status === c.doc_status
      && guardada.doc_motivo_dispensa === c.doc_motivo_dispensa
    if (igual) continue
    novas.push({
      chave,
      data: { ...semProcedencia(c), guardado_em: new Date().toISOString().slice(0, 10) },
    })
  }
  if (!novas.length) return 0
  const { error } = await supabase
    .from('regras_classificacao')
    .upsert(novas, { onConflict: 'user_id,chave' })
  if (error) { console.warn('não consegui guardar a memória das regras:', error.message); return 0 }
  return novas.length
}

/**
 * A classificação sem a procedência.
 *
 * `origem` e `quantos` dizem de onde a regra veio AGORA, e existem para a
 * tela. Guardá-los congelaria essa procedência: na próxima leitura, a memória
 * se apresentaria como regra viva, e a tela diria à usuária que há lançamentos
 * sustentando algo que já não tem nenhum.
 */
export function semProcedencia(c) {
  return {
    cat: c?.cat || "",
    subcat: c?.subcat || "",
    doc_status: c?.doc_status || "",
    doc_motivo_dispensa: c?.doc_motivo_dispensa || "",
  }
}

/** As vivas por cima das guardadas: o lançamento de hoje vence a lembrança. */
export function juntarRegras(memoria, vivas) {
  const m = new Map(memoria)
  for (const [k, v] of vivas) m.set(k, v)
  return m
}
