import { useCallback, useEffect, useMemo, useState } from 'react'
import CampoData from '../components/CampoData'
import { msgErro } from '../lib/erros'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'
import EstadoErro from '../components/EstadoErro'
import ModalContrato from './components/ModalContrato'
import ModalProjeto from './components/ModalProjeto'
import { showToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import { faturamentoPorProjeto, confrontoDoProjeto } from '../lib/projetoDaVenda'
import { useNavigate } from 'react-router-dom'

function fmtMoeda(v) {
  const n = parseFloat(v) || 0
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function fmtData(s) {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

export default function Catalogo({ tabela, titulo, labelParte = 'Cliente' }) {
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [receitas, setReceitas] = useState([])
  const navegar = useNavigate()
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)
  const [busca, setBusca] = useState('')
  const [dataDe, setDataDe] = useState('')
  const [dataAte, setDataAte] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [edicao, setEdicao] = useState(null)

  const isContrato = tabela === 'contracts'
  const novoLabel = isContrato ? 'contrato' : 'projeto'

  const recarregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    Promise.all([
      supabase.from(tabela).select('*').order('updated_at', { ascending: false }),
      // O FATURAMENTO DE CADA PROJETO.
      //
      // So os campos que a conta usa: trazer o `data` inteiro de centenas de
      // receitas para ler tres campos seria pagar caro por um numero.
      // Em contratos isto nao se aplica -- o elo e do projeto.
      isContrato
        ? Promise.resolve({ data: [] })
        : supabase.from('receivable')
            .select('projeto_id:data->>projeto_id, value:data->>value, status:data->>status, data_pagamento:data->>data_pagamento'),
    ]).then(([rT, rR]) => {
      if (rT.error) { setErro(rT.error); setRows([]) }
      else { setErro(null); setRows(rT.data || []) }
      // Falha aqui nao derruba a tela: a lista aparece sem a coluna de
      // faturamento, que e um ganho, nao um requisito.
      setReceitas(rR?.error ? [] : (rR?.data || []).map(r => ({ data: r })))
      setLoading(false)
    }).catch((e) => { setErro(e); setLoading(false) })
  }, [user, tabela, isContrato])

  useEffect(() => { recarregar() }, [recarregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const campoData = isContrato ? 'start' : 'deadline'
    let r = rows
    if (q) {
      r = r.filter(item => {
        const d = item.data || {}
        const blob = [item.codigo, d.name, d.party, d.client, d.object, d.value, d.status, d.notes]
          .filter(Boolean).join(' ').toLowerCase()
        return blob.includes(q)
      })
    }
    if (dataDe || dataAte) {
      r = r.filter(item => {
        const v = item.data?.[campoData]
        if (!v) return true // não esconde a linha que não tem a data selecionada
        if (dataDe && v < dataDe) return false
        if (dataAte && v > dataAte) return false
        return true
      })
    }
    return r
  }, [rows, busca, dataDe, dataAte, isContrato])

  const total = useMemo(
    () => filtrados.reduce((s, x) => s + (parseFloat(x.data?.value) || 0), 0),
    [filtrados],
  )

  // ── O PROJETO NASCE DA VENDA ──────────────────────────────────────────
  //
  // Todo projeto veio de uma proposta (decisão dela, 05/11). Criado solto,
  // ele não tem de onde ler o valor vendido -- e sem valor vendido não há
  // contra o que comparar o faturado. Foi assim que as duas cascas de R$ 0
  // existiram, ligadas ao cliente por texto.
  //
  // A tela ORIENTA, não bloqueia: pode haver projeto que não veio de venda
  // (um trabalho interno), e quem sabe disso é ela. O caminho certo é o que
  // aparece primeiro; o outro continua ali.
  async function abrirNovo() {
    if (isContrato) { setEdicao(null); setModalOpen(true); return }
    const criarAssimMesmo = await confirmar({
      titulo: "Projeto sem venda vinculada",
      texto: "O projeto gerado a partir de uma oportunidade herda o valor vendido e o vínculo com o cliente e a proposta.",
      consequencias: [
        "Criado nesta tela, o projeto nasce sem valor vendido.",
        "Sem valor vendido, a coluna Faturado fica sem base de comparação.",
        "Trabalho que não teve proposta é cadastrado aqui.",
      ],
      confirmarLabel: "Criar sem vínculo",
      cancelarLabel: "Ir para o Funil",
    })
    if (criarAssimMesmo) { setEdicao(null); setModalOpen(true); return }
    navegar("/funil")
  }
  function abrirEdicao(row) { setEdicao(row); setModalOpen(true) }

  const [confirmar, dialogoConfirmacao] = useConfirm()

  async function excluir(row, e) {
    e?.stopPropagation()
    const nome = row.data?.name || row.data?.party || row.codigo || `este ${novoLabel}`
    const ok = await confirmar({
      titulo: `Excluir "${nome}"?`,
      consequencias: [
        'O item sai do catálogo e deixa de ser oferecido nos lançamentos novos.',
        'O que já foi lançado com ele continua como está.',
      ],
      confirmarLabel: 'Excluir',
      variante: 'perigo',
    })
    if (!ok) return
    const { error } = await supabase.from(tabela).delete().eq('id', row.id)
    if (error) { showToast(msgErro(error, 'Não foi possível excluir este item do catálogo.'), 'error'); return }
    showToast(`${isContrato ? 'Contrato' : 'Projeto'} excluído.`, 'info')
    recarregar()
  }

  // Quanto cada projeto ja faturou, por identificador.
  const faturamento = useMemo(() => faturamentoPorProjeto(receitas), [receitas])

  const colgroup = (
    <colgroup>
      <col style={{ width: 110 }} />
      <col />
      <col />
      <col style={{ width: 130 }} />
      {!isContrato && <col style={{ width: 160 }} />}
      <col style={{ width: 100 }} />
      <col style={{ width: 105 }} />
      <col style={{ width: 50 }} />
    </colgroup>
  )
  const temDados = !loading && filtrados.length > 0

  return (
    <AppLayout
      title={titulo}
      stickyTop={(
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, maxWidth: 480 }}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
                style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-mid)' }}>
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder={`Buscar ${titulo.toLowerCase()}...`} style={searchInput} />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={resumo}>
                <span style={{ color: 'var(--text-mid)' }}>{filtrados.length} {filtrados.length === 1 ? 'registro' : 'registros'}</span>
                <span style={{ width: 1, height: 14, background: 'var(--cream-dark)' }} />
                <span style={{ fontWeight: 600, color: 'var(--navy)' }}>{fmtMoeda(total)}</span>
              </div>
              <button onClick={abrirNovo} style={btnNovo} title={isContrato ? undefined : 'O projeto nasce da venda, no Funil'}>
                <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Novo {novoLabel}
              </button>
            </div>
          </div>

          {/* Filtro por data */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', padding: '10px 14px', background: 'var(--white)', borderRadius: 10, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)' }}>
            <span style={{ fontSize: 11, color: 'var(--text-mid)', fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>{isContrato ? 'Início' : 'Prazo'}</span>
            <CampoData value={dataDe} onChange={e => setDataDe(e.target.value)} style={inputData} title="De" />
            <span style={{ fontSize: 11, color: 'var(--text-mid)' }}>até</span>
            <CampoData value={dataAte} onChange={e => setDataAte(e.target.value)} style={inputData} title="Até" />
            {(dataDe || dataAte) && (
              <button onClick={() => { setDataDe(''); setDataAte('') }} style={{ background: 'none', border: 'none', color: 'var(--text-mid)', cursor: 'pointer', fontSize: 14, fontWeight: 700, padding: '4px 6px' }} title="Limpar">×</button>
            )}
          </div>

          {temDados && (
            <div style={{ ...tableWrap, marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: 'none' }}>
              <table style={{ ...tbl, tableLayout: 'fixed' }}>
                {colgroup}
                <thead>
                  <tr>
                    <th style={th}>Cód.</th>
                    <th style={th}>{isContrato ? 'Objeto' : 'Nome'}</th>
                    <th style={th}>{labelParte}</th>
                    <th style={{ ...th, textAlign: 'right' }}>{isContrato ? 'Valor' : 'Vendido'}</th>
                    {!isContrato && (
                      <th style={{ ...th, textAlign: 'right' }} title="Quanto ja foi faturado neste projeto, pelos lancamentos de receita ligados a ele. Recebido e a receber ficam separados: receita pendente e promessa.">
                        Faturado
                      </th>
                    )}
                    <th style={th}>{isContrato ? 'Início' : 'Prazo'}</th>
                    <th style={th}>Status</th>
                    <th style={{ ...th, textAlign: 'center' }}></th>
                  </tr>
                </thead>
              </table>
            </div>
          )}
        </>
      )}
    >
      <div style={{ ...tableWrap, borderTopLeftRadius: temDados ? 0 : 10, borderTopRightRadius: temDados ? 0 : 10, borderTop: temDados ? 'none' : '1px solid var(--cream-dark)' }}>
        {loading ? (
          <div style={emptyState}>Carregando…</div>
        ) : erro ? (
          <EstadoErro onRetry={recarregar} />
        ) : filtrados.length === 0 ? (
          <div style={emptyState}>
            {rows.length > 0 ? 'Nenhum resultado para a busca.' : isContrato ? (
              'Nenhum contrato cadastrado. Clique em "Novo contrato" para começar.'
            ) : (
              <>
                {/* O PROJETO NASCE DA VENDA.
                    Todo projeto veio de uma proposta -- decisão dela, 05/11. Um
                    projeto criado solto não tem de onde ler o valor vendido, e
                    sem valor vendido não há contra o que comparar o faturado.
                    Foi assim que as duas cascas de R$ 0 existiram. */}
                <div style={{ fontWeight: 600, color: 'var(--navy)', marginBottom: 8 }}>
                  Nenhum projeto cadastrado.
                </div>
                <div style={{ maxWidth: 520, margin: '0 auto', lineHeight: 1.7 }}>
                  O projeto é gerado a partir de uma oportunidade ganha, no Funil, e herda dela o
                  valor vendido e o vínculo com o cliente e a proposta.
                </div>
                <button onClick={() => navegar('/funil')} style={{ ...btnNovo, margin: '16px auto 0' }}>
                  Ir para o Funil
                </button>
              </>
            )}
          </div>
        ) : (
          <table style={{ ...tbl, tableLayout: 'fixed' }}>
            {colgroup}
            <tbody>
              {filtrados.map(p => {
                const d = p.data || {}
                return (
                  <tr key={p.id} onClick={() => abrirEdicao(p)} style={{ cursor: 'pointer' }} title="Clique para editar">
                    <td style={tdMono}>{p.codigo || '—'}</td>
                    <td style={td}>{(isContrato ? d.object : d.name) || '—'}</td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{(isContrato ? d.party : d.client) || '—'}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtMoeda(d.value)}</td>
                    {!isContrato && <CelulaFaturado confronto={confrontoDoProjeto(p, faturamento.get(p.id))} />}
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{fmtData(isContrato ? d.start : d.deadline)}</td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{d.status || '—'}</td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      <button onClick={e => excluir(p, e)} title="Excluir" aria-label="Excluir" style={btnExcluir}>×</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {isContrato ? (
        <ModalContrato open={modalOpen} onClose={() => setModalOpen(false)} registro={edicao} onSaved={recarregar} />
      ) : (
        <ModalProjeto open={modalOpen} onClose={() => setModalOpen(false)} registro={edicao} onSaved={recarregar} />
      )}
    {dialogoConfirmacao}
    </AppLayout>
  )
}

const inputData = { padding: '7px 10px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const btnNovo = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 16px', borderRadius: 6,
  border: 'none', background: 'var(--gold)', color: '#fff',
  fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, letterSpacing: 0.5,
  cursor: 'pointer', textTransform: 'uppercase',
}
// ── O FATURADO DE UM PROJETO ────────────────────────────────────────────────
//
// Tres numeros, e eles nao sao a mesma coisa:
//   recebido    o dinheiro que entrou;
//   a receber   o que foi lancado e ainda nao entrou -- promessa, e somar as
//               duas faria o projeto parecer pago antes da hora;
//   diferenca   faturado menos vendido. Negativa, falta faturar; positiva,
//               faturou-se mais que o vendido (aditivo, hora extra).
//
// Projeto sem valor vendido nao mostra diferenca: zero afirmaria estar em dia.
function CelulaFaturado({ confronto }) {
  const c = confronto
  if (!c || !c.lancamentos) {
    return (
      <td style={{ ...td, textAlign: "right", color: "var(--text-mid)", fontSize: 11 }}
          title="Nenhum lancamento de receita aponta para este projeto.">
        sem receita ligada
      </td>
    )
  }
  return (
    <td style={{ ...td, textAlign: "right" }}>
      <div style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{fmtMoeda(c.recebido)}</div>
      {c.aReceber > 0 && (
        <div style={{ fontSize: 10, color: "var(--text-mid)", fontVariantNumeric: "tabular-nums" }}
             title="Lancado e ainda nao recebido.">
          + {fmtMoeda(c.aReceber)} a receber
        </div>
      )}
      {c.diferenca !== null && (
        <div style={{ fontSize: 10, color: c.diferenca < 0 ? "var(--gold-dark)" : "var(--green)" }}
             title={c.diferenca < 0 ? "Ainda falta faturar este valor do que foi vendido." : "Faturado acima do vendido."}>
          {c.diferenca < 0 ? "faltam " + fmtMoeda(Math.abs(c.diferenca)) : "+" + fmtMoeda(c.diferenca) + " acima"}
        </div>
      )}
    </td>
  )
}

const btnExcluir = {
  background: 'none', border: '1px solid transparent', borderRadius: 4,
  color: 'var(--text-mid)', fontSize: 18, lineHeight: 1, cursor: 'pointer',
  width: 26, height: 26, padding: 0,
}
const searchInput = { width: '100%', padding: '10px 13px 10px 32px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const resumo = { display: 'flex', alignItems: 'center', gap: 12, fontFamily: 'var(--body)', fontSize: 12, padding: '8px 14px', background: 'var(--white)', border: '1px solid var(--cream-dark)', borderRadius: 6 }
const tableWrap = { background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', overflow: 'clip' }
const tbl = { width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--body)' }
const th = { textAlign: 'left', padding: '12px 14px', fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: '#fff', textTransform: 'uppercase', background: 'var(--navy)', borderBottom: '2px solid var(--gold)' }
const td = { padding: '12px 14px', fontSize: 12, color: 'var(--navy)', borderBottom: '1px solid var(--cream-dark)', verticalAlign: 'middle' }
const tdMono = { ...td, fontWeight: 600, color: 'var(--text-mid)', letterSpacing: 0.5 }
const emptyState = { padding: '60px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13 }
