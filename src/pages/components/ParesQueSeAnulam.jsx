// =============================================================================
// OS PARES QUE SE ANULAM.
//
// Medido no extrato da Polimata: 10 pares de debito + estorno no mesmo dia,
// R$ 16.328,05 de cada lado, líquido ZERO. São 20 linhas pendentes que cobram
// 20 decisões para chegar a lugar nenhum — o banco cobrou e devolveu, não há
// despesa, não há receita, não há o que classificar.
//
// Este painel mostra os pares e anula os dois lados de uma vez. Não cria
// lançamento: arquiva as duas linhas com o motivo gravado, do mesmo jeito que
// o botão Arquivar faz — auditável, reversível, com o par citado no motivo.
//
// A regra de pareamento (estrita de propósito) e a prova estão em
// src/lib/paresEstorno.js e provas/pares-estorno.mjs.
// =============================================================================
import { useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtMoney } from '../../lib/finance'
import { msgErro } from '../../lib/erros'
import { showToast } from '../../components/Toast'
import { useConfirm } from '../../components/ConfirmDialog'
import { acharParesEstorno, resumoDosPares, motivoDoPar } from '../../lib/paresEstorno'

const diaBR = d => String(d || '').split('-').reverse().join('/')

export default function ParesQueSeAnulam({ linhas, onPronto }) {
  const [confirmar, dialogo] = useConfirm()
  const [abertos, setAbertos] = useState(false)
  const [anulando, setAnulando] = useState(false)

  const pares = useMemo(() => acharParesEstorno(linhas), [linhas])
  const resumo = useMemo(() => resumoDosPares(pares), [pares])

  if (!pares.length) return null

  async function anular(lista) {
    const n = lista.length
    const ok = await confirmar({
      titulo: n === 1 ? 'Anular este par?' : `Anular ${n} pares?`,
      texto: n === 1
        ? `${lista[0].descricao} - ${fmtMoney(lista[0].valor)} em ${diaBR(lista[0].data)}`
        : `${n * 2} linhas do extrato, ${fmtMoney(lista.reduce((s, p) => s + p.valor, 0))} de cada lado.`,
      consequencias: [
        'As duas linhas de cada par saem da fila de pendentes.',
        'Nenhum lançamento é criado: não entra na DRE nem no fluxo de caixa, porque não houve movimento.',
        'O motivo fica gravado em cada linha, com a data do par — dá para restaurar depois.',
      ],
      confirmarLabel: n === 1 ? 'Anular o par' : `Anular os ${n} pares`,
    })
    if (!ok) return

    setAnulando(true)
    try {
      const agora = new Date().toISOString()
      // Uma escrita por linha, as duas do par com o MESMO motivo e cada uma
      // apontando para a outra: seis meses depois, "por que estes R$ 2.836,09
      // não estão na DRE?" tem resposta dentro do sistema.
      const escritas = []
      for (const p of lista) {
        const motivo = motivoDoPar(p)
        for (const [linha, outra] of [[p.debito, p.estorno], [p.estorno, p.debito]]) {
          escritas.push(
            supabase.from('transacoes_extrato').update({
              status: 'ignorado',
              data: {
                ...(linha.data || {}),
                arquivada_motivo: motivo,
                arquivada_em: agora,
                anulada_com: outra.id,
              },
            }).eq('id', linha.id).eq('status', 'pendente'),
          )
        }
      }
      const res = await Promise.all(escritas)
      const erro = res.find(r => r.error)?.error
      if (erro) throw erro
      showToast(n === 1 ? 'Par anulado.' : `${n} pares anulados — ${n * 2} linhas fora da fila.`, 'success')
      onPronto?.()
    } catch (e) {
      showToast(msgErro(e, 'Não consegui anular os pares.'), 'error')
    } finally {
      setAnulando(false)
    }
  }

  return (
    <div style={caixa}>
      {dialogo}
      <div style={titulo}>Débito e estorno no mesmo dia</div>
      <div style={chamada}>
        <strong>{resumo.pares} par(es)</strong> em que o banco cobrou e devolveu no mesmo dia, mesmo valor e mesma
        descrição — <strong>{resumo.linhas} linhas</strong> que somam {fmtMoney(resumo.valor)} de cada lado e
        se anulam.
      </div>
      <div style={explicacao}>
        Não houve despesa nem receita, então não há o que classificar. Anular tira as duas linhas da fila sem
        criar lançamento — o motivo fica gravado em cada uma, e dá para restaurar.
      </div>

      <button onClick={() => setAbertos(v => !v)} style={linkVer}>
        {abertos ? 'ocultar os pares' : `ver os ${resumo.pares} pares`}
      </button>

      {abertos && (
        <div style={lista}>
          {pares.map(p => (
            <div key={p.debito.id} style={item}>
              <span style={{ color: 'var(--text-mid)', minWidth: 74 }}>{diaBR(p.data)}</span>
              <span style={desc} title={p.descricao}>{p.descricao}</span>
              <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtMoney(p.valor)}</span>
              <button onClick={() => anular([p])} disabled={anulando} style={botaoMini}>anular</button>
            </div>
          ))}
        </div>
      )}

      <button onClick={() => anular(pares)} disabled={anulando} style={botao}>
        {anulando ? 'Anulando…' : `Anular os ${resumo.pares} pares (${resumo.linhas} linhas)`}
      </button>
    </div>
  )
}

const caixa = { background: 'var(--white)', border: '1px solid var(--cream-dark)', borderRadius: 10, padding: '14px 16px', marginBottom: 14, boxShadow: 'var(--shadow)' }
const titulo = { fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--text-mid)', marginBottom: 8 }
const chamada = { fontSize: 13, color: 'var(--navy)', marginBottom: 6, lineHeight: 1.5 }
const explicacao = { fontSize: 11.5, color: 'var(--text-mid)', marginBottom: 12, lineHeight: 1.55, paddingLeft: 10, borderLeft: '2px solid var(--cream-dark)' }
const linkVer = { background: 'none', border: 'none', padding: 0, marginBottom: 8, color: 'var(--gold-dark)', fontFamily: 'var(--body)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', display: 'block' }
const lista = { maxHeight: 190, overflowY: 'auto', border: '1px solid var(--cream-dark)', borderRadius: 6, background: 'var(--cream)', padding: '4px 0', marginBottom: 10 }
const item = { display: 'flex', alignItems: 'center', gap: 9, padding: '5px 10px', fontSize: 11.5 }
const desc = { flex: 1, fontWeight: 600, color: 'var(--navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const botao = { padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--navy)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }
const botaoMini = { padding: '4px 9px', borderRadius: 6, border: '1px solid var(--cream-dark)', background: 'var(--white)', color: 'var(--text-mid)', fontFamily: 'var(--body)', fontSize: 11, cursor: 'pointer' }
