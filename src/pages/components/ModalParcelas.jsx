import { useEffect, useMemo, useState } from 'react'
import Modal from '../../components/Modal'
import { supabase } from '../../lib/supabase'
import { fmtMoney } from '../../lib/finance'
import { msgErro } from '../../lib/erros'
import { parcelasDoContrato } from '../../lib/contratoVisao'

// =============================================================================
// AS PARCELAS DO CONTRATO, UMA A UMA.
//
// O que isto fecha: a tela dizia "5/36" e o saldo, e parava aí. Para saber
// QUAIS cinco, e por quê, era preciso consultar o banco — o que ela não faz e
// não deveria precisar fazer. A contagem é um resumo; o resumo sem o detalhe
// obriga a confiar.
//
// Duas listas, e elas são coisas diferentes:
//   PARCELAS  o cronograma do contrato, uma linha por parcela. Quando o
//             cronograma separa amortização de juros, a parcela tem as duas
//             em colunas próprias — e continua sendo UMA parcela.
//   AJUSTES   o que nasceu na conciliação: juro de mora, multa, tarifa. São
//             do contrato, mas não são parcela dele.
//
// A coluna que mais importa é a última. Uma parcela paga pode ter chegado a
// esse estado por dois caminhos muito diferentes: CONCILIADA contra o extrato
// (há prova) ou AJUSTADA como história anterior ao recorte (há presunção).
// Mostrar as duas como "Pago" e pronto apagaria justamente a diferença que a
// reforma inteira existe para preservar.
// =============================================================================
export default function ModalParcelas({ open, onClose, contrato }) {
  const [linhas, setLinhas] = useState(null)
  const [erro, setErro] = useState(null)

  useEffect(() => {
    if (!open || !contrato?.id) { setLinhas(null); setErro(null); return undefined }
    let cancelado = false
    setLinhas(null); setErro(null)
    supabase.from('payable')
      .select('id, codigo, conciliado_em, due:data->>due, st:data->>status, val:data->>value,'
        + ' num:data->>parcela_atual, subcat:data->>subcat, ajuste_tipo:data->>ajuste_tipo,'
        + ' ajuste_historico:data->>ajuste_historico, ajuste_motivo:data->>ajuste_motivo,'
        + ' data_pagamento:data->>data_pagamento,'
        + ' data_pagamento_presumida:data->>data_pagamento_presumida')
      .eq('emprestimo_id', contrato.id)
      .then(({ data, error }) => {
        if (cancelado) return
        if (error) { setErro(error); setLinhas([]); return }
        setLinhas(data || [])
      })
    return () => { cancelado = true }
  }, [open, contrato])

  const { parcelas, ajustes } = useMemo(
    () => parcelasDoContrato(linhas || []),
    [linhas],
  )

  const temJuros = parcelas.some(p => p.juros > 0)
  const pagas = parcelas.filter(p => p.pago).length
  const ajustadas = parcelas.filter(p => p.ajusteHistorico).length
  const emAberto = parcelas.filter(p => !p.pago).reduce((s, p) => s + p.total, 0)

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={820}
      title={`Parcelas · ${contrato?.codigo || ''} ${contrato?.nome || contrato?.credor || ''}`.trim()}
    >
      {linhas === null ? (
        <div style={aviso}>Carregando as parcelas…</div>
      ) : erro ? (
        <div style={{ ...aviso, color: 'var(--red)' }}>
          {msgErro(erro, 'Não consegui ler as parcelas deste contrato.')}
        </div>
      ) : !parcelas.length ? (
        <div style={aviso}>
          Este contrato não tem parcelas em Contas a Pagar. Sem parcelas não há conciliação, e o
          saldo não é apurado. O botão <strong>Gerar parcelas</strong>, na lista, lança o cronograma.
        </div>
      ) : (
        <>
          <div style={resumo}>
            <span><strong>{pagas}</strong> de {parcelas.length} pagas</span>
            <span style={divisor} />
            <span>em aberto <strong style={{ color: 'var(--red)' }}>{fmtMoney(emAberto)}</strong></span>
            {ajustadas > 0 && (
              <>
                <span style={divisor} />
                <span style={{ color: 'var(--gold-dark)' }}>
                  {ajustadas} ajustada(s) como história, sem conciliação
                </span>
              </>
            )}
          </div>

          <div style={rolagem}>
            <table style={tabela}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'center', width: 44 }}>#</th>
                  <th style={{ ...th, width: 96 }}>Vencimento</th>
                  {temJuros && <th style={{ ...th, textAlign: 'right', width: 96 }}>Principal</th>}
                  {temJuros && <th style={{ ...th, textAlign: 'right', width: 90 }}>Juros</th>}
                  <th style={{ ...th, textAlign: 'right', width: 100 }}>{temJuros ? 'Total' : 'Valor'}</th>
                  <th style={th}>Situação</th>
                </tr>
              </thead>
              <tbody>
                {parcelas.map((p, i) => (
                  <tr key={p.codigos[0] || i}>
                    <td style={{ ...td, textAlign: 'center', color: 'var(--text-mid)' }}>
                      {p.numero ?? '—'}
                    </td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{dataBR(p.vencimento)}</td>
                    {temJuros && <td style={tdNum}>{fmtMoney(p.principal)}</td>}
                    {temJuros && <td style={{ ...tdNum, color: 'var(--navy-mid)' }}>{fmtMoney(p.juros)}</td>}
                    <td style={{ ...tdNum, fontWeight: 600 }}>{fmtMoney(p.total)}</td>
                    <td style={td}>{situacao(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {ajustes.length > 0 && (
            <>
              <div style={subtitulo}>Ajustes da conciliação</div>
              <p style={nota}>
                Lançamentos criados na conciliação para explicar a diferença entre o valor pago e o
                valor da parcela. Pertencem ao contrato, mas não são parcela dele — por isso ficam
                fora da contagem acima.
              </p>
              <div style={rolagem}>
                <table style={tabela}>
                  <tbody>
                    {ajustes.map((a, i) => (
                      <tr key={a.codigo || i}>
                        <td style={{ ...td, width: 96, fontVariantNumeric: 'tabular-nums' }}>{dataBR(a.vencimento)}</td>
                        <td style={td}>{rotuloAjuste(a.tipo)}</td>
                        <td style={{ ...tdNum, fontWeight: 600 }}>{fmtMoney(a.total)}</td>
                        <td style={{ ...td, color: 'var(--text-mid)', fontSize: 11 }}>
                          {a.conciliadoEm ? 'medido na conciliação' : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  )
}

// ── A situação, e a diferença que ela precisa preservar ──────────────────
function situacao(p) {
  if (p.pago && p.ajusteHistorico) {
    return (
      <>
        <span style={{ ...selo, ...seloAjustada }}>Paga · ajustada</span>
        <div style={explica}>
          Venceu antes do recorte de jan/2026. Não houve conciliação: a data de pagamento
          {p.pagamentoPresumido ? ' é presumida igual ao vencimento' : ' foi informada'}.
        </div>
      </>
    )
  }
  if (p.pago) {
    return (
      <>
        <span style={{ ...selo, ...seloPaga }}>Paga</span>
        <div style={explica}>
          {p.conciliadoEm
            ? `conciliada contra o extrato em ${dataBR(String(p.conciliadoEm).slice(0, 10))}`
            : 'baixada sem conciliação registrada'}
        </div>
      </>
    )
  }
  const hoje = new Date().toISOString().slice(0, 10)
  const vencida = p.vencimento && p.vencimento < hoje
  return (
    <>
      <span style={{ ...selo, ...(vencida ? seloVencida : seloPendente) }}>
        {vencida ? 'Vencida' : 'A vencer'}
      </span>
      {vencida && <div style={explica}>espera a conciliação do extrato</div>}
    </>
  )
}

function rotuloAjuste(tipo) {
  const mapa = {
    juros: 'Juros / multa', tarifa: 'Tarifa bancária',
    retencao: 'Retenção', desconto: 'Desconto', iof: 'IOF',
  }
  return mapa[tipo] || tipo || 'Ajuste'
}

function dataBR(s) {
  if (!s) return '—'
  const [a, m, d] = String(s).slice(0, 10).split('-')
  return d ? `${d}/${m}/${a}` : s
}

const aviso = { fontSize: 13, color: 'var(--text-mid)', lineHeight: 1.6, padding: '18px 2px' }
const resumo = {
  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10,
  fontSize: 12, color: 'var(--text-mid)', marginBottom: 12,
  background: 'var(--cream)', border: '1px solid var(--cream-dark)',
  borderRadius: 7, padding: '8px 12px',
}
const divisor = { width: 1, height: 13, background: 'var(--cream-dark)' }
const rolagem = { overflowX: 'auto' }
const tabela = { width: '100%', minWidth: 520, borderCollapse: 'separate', borderSpacing: 0 }
const th = {
  textAlign: 'left', padding: '8px 10px', fontSize: 8.5, fontWeight: 700,
  letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--text-mid)',
  borderBottom: '1.5px solid var(--cream-dark)', whiteSpace: 'nowrap',
}
const td = {
  padding: '8px 10px', fontSize: 12, color: 'var(--navy)',
  borderBottom: '1px solid var(--cream-dark)', verticalAlign: 'top',
}
const tdNum = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
const selo = {
  display: 'inline-block', padding: '2px 8px', borderRadius: 999,
  fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
  whiteSpace: 'nowrap',
}
const seloPaga = { background: 'rgba(39,174,96,0.12)', color: 'var(--green)' }
const seloAjustada = { background: 'rgba(204,145,94,0.16)', color: 'var(--gold-dark)' }
const seloVencida = { background: 'rgba(231,76,60,0.10)', color: 'var(--red)' }
const seloPendente = { background: 'rgba(0,32,62,0.07)', color: 'var(--text-mid)' }
const explica = { fontSize: 10.5, color: 'var(--text-mid)', marginTop: 3, lineHeight: 1.4 }
const subtitulo = {
  marginTop: 20, fontSize: 9, fontWeight: 700, letterSpacing: 1.6,
  textTransform: 'uppercase', color: 'var(--navy)',
}
const nota = { fontSize: 11, color: 'var(--text-mid)', margin: '4px 0 10px', lineHeight: 1.5 }
