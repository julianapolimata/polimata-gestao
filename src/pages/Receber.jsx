import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Chart } from 'chart.js/auto'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'
import EstadoErro from '../components/EstadoErro'
import ModalLancamento from './components/ModalLancamento'
import { showToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import { msgErro } from '../lib/erros'
import { ehOperacional, ehPrincipalDeDivida, getDocStatus, isOverdue } from '../lib/finance'
import { calcMRR } from '../lib/indicadores'
import { proximoCodigoReceivable } from '../lib/codigos'
import { promoverProvisao } from '../lib/gerarRecorrencias'
import { fetchPlanoContas, categoriasDe } from '../lib/planoContas'
import { fetchFechamentos, competenciaDe, mesFechado, msgMesFechado } from '../lib/fechamento'

// ─── helpers ──────────────────────────────────────────────────────────────
function fmtMoeda(v) {
  const n = parseFloat(v) || 0
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function fmtData(s) {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}
function hojeISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Vocabulário (uma palavra = um sentido só):
//   Previsto  → status gravado 'Provisão' (ainda não é fato)
//   Em aberto → não foi recebido (engloba o legado 'Atrasado', que era a MESMA coisa)
//   Vencido   → em aberto E passou do vencimento — SEMPRE calculado pela data
//   Recebido  → liquidado
// Os valores gravados no banco não mudam: só o que a usuária lê.
function ehRecebido(d) { return (d?.status || '').toLowerCase() === 'recebido' }
function ehPrevisto(d) {
  const s = (d?.status || '').toLowerCase()
  return s === 'provisão' || s === 'provisao'
}
function emAberto(d) { return !ehRecebido(d) && !ehPrevisto(d) }
function estaVencido(d) { return emAberto(d) && isOverdue(d?.due) }

function statusCfg(d) {
  if (ehRecebido(d)) return { label: 'Recebido', bg: 'rgba(39,174,96,0.10)', color: 'var(--green)' }
  if (ehPrevisto(d)) return { label: 'Previsto', bg: 'rgba(29,59,92,0.10)', color: 'var(--navy-light)' }
  if (isOverdue(d?.due)) return { label: 'Vencido', bg: 'rgba(231,76,60,0.10)', color: 'var(--red)' }
  return { label: 'Em aberto', bg: 'rgba(230,126,34,0.10)', color: 'var(--orange)' }
}

// Situação fiscal — rótulo humano; o valor gravado continua vinculado/pendente/dispensado.
const FISCAL = [
  { valor: 'vinculado', label: 'Tenho a nota', chave: 'com_nf' },
  { valor: 'pendente', label: 'A nota vai chegar', chave: 'pendente' },
  { valor: 'dispensado', label: 'Não tem nota', chave: 'sem_nf' },
]

export default function Receber() {
  const { user } = useAuth()
  const [confirmar, dialogoConfirmacao] = useConfirm()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)
  const [busca, setBusca] = useState('')
  const [sortCol, setSortCol] = useState('due')
  const [sortDir, setSortDir] = useState('desc')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [filtroFiscal, setFiltroFiscal] = useState('')
  const [dataDe, setDataDe] = useState('')
  const [dataAte, setDataAte] = useState('')
  const [tipoData, setTipoData] = useState('due') // due | data_pagamento | data_competencia
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [vmin, setVmin] = useState('')
  const [vmax, setVmax] = useState('')
  const [maisFiltros, setMaisFiltros] = useState(false)
  const [categorias, setCategorias] = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const [edicao, setEdicao] = useState(null)
  const [anoSel, setAnoSel] = useState(String(new Date().getFullYear()))
  const [recorrencias, setRecorrencias] = useState([])
  const [popReceber, setPopReceber] = useState(null) // { row, data, top, left } — popover da data
  const [salvandoRec, setSalvandoRec] = useState(false)
  const chartRef = useRef(null)
  const chartInst = useRef(null)

  useEffect(() => {
    if (!user) return
    supabase.from('recurring_masters').select('*').then(({ data }) => setRecorrencias(data || []))
  }, [user])

  useEffect(() => {
    fetchPlanoContas()
      .then(plano => setCategorias(categoriasDe(plano, 'Entrada')))
      .catch(() => setCategorias([]))
  }, [])

  // Meses fechados (portão): pré-checagem amigável antes do erro do banco.
  const [fechamentos, setFechamentos] = useState([])
  useEffect(() => {
    if (!user) return
    fetchFechamentos().then(setFechamentos).catch(() => setFechamentos([]))
  }, [user])
  const bloqueadoPorFechamento = row => {
    const comp = competenciaDe(row?.data)
    if (!mesFechado(fechamentos, comp)) return false
    showToast(msgMesFechado(comp), 'warning')
    return true
  }

  const recarregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    supabase
      // Visão sem o arquivo da nota: desenhar a lista não precisa dele, e ele
      // responde pela quase totalidade do peso baixado.
      .from('receivable_lista')
      .select('*')
      .order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { setErro(error); setRows([]) }
        else { setErro(null); setRows(data || []) }
        setLoading(false)
      })
      .catch((e) => { setErro(e); setLoading(false) })
  }, [user])

  useEffect(() => { recarregar() }, [recarregar])

  // Filtro vindo por URL (ex.: cards de alerta do Início → ?filtro=vencidos)
  const [searchParams] = useSearchParams()
  useEffect(() => {
    const f = searchParams.get('filtro')
    if (f === 'vencidos') setFiltroStatus('__vencidos__')
    else if (f === 'sem_doc') setFiltroFiscal('pendente')
  }, [searchParams])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    // Captação de empréstimo é financiamento — não é conta a receber. Fica no Fluxo/Empréstimos.
    let r = rows.filter(item => !ehPrincipalDeDivida(item.data))
    if (filtroStatus) {
      if (filtroStatus === '__a_escriturar__') r = r.filter(item => item.data?.escriturado !== true && !ehPrevisto(item.data))
      else if (filtroStatus === '__vencidos__') r = r.filter(item => estaVencido(item.data))
      else if (filtroStatus === 'Pendente') r = r.filter(item => emAberto(item.data)) // 'Em aberto' engloba o legado 'Atrasado'
      else if (filtroStatus === 'Provisão') r = r.filter(item => ehPrevisto(item.data))
      else r = r.filter(item => (item.data?.status || '').toLowerCase() === filtroStatus.toLowerCase())
    }
    if (filtroFiscal) r = r.filter(item => getDocStatus(item) === filtroFiscal)
    if (q) {
      r = r.filter(item => {
        const d = item.data || {}
        const blob = [item.codigo, d.client, d.desc, d.value, d.cat].filter(Boolean).join(' ').toLowerCase()
        return blob.includes(q)
      })
    }
    // Período — uma semântica só: De/Até sobre a data escolhida no seletor.
    if (dataDe || dataAte) {
      r = r.filter(item => {
        const v = tipoData === 'due' ? item.data?.due : item.data?.[tipoData]
        if (!v) return true // opção A: sem a data selecionada, não esconde a linha
        if (dataDe && v < dataDe) return false
        if (dataAte && v > dataAte) return false
        return true
      })
    }
    if (filtroCategoria) r = r.filter(item => item.data?.cat === filtroCategoria)
    const min = parseFloat(vmin)
    const max = parseFloat(vmax)
    if (!isNaN(min)) r = r.filter(item => parseFloat(item.data?.value || 0) >= min)
    if (!isNaN(max)) r = r.filter(item => parseFloat(item.data?.value || 0) <= max)
    return [...r].sort((a, b) => {
      const va = (a.data?.[sortCol] ?? a[sortCol] ?? '').toString()
      const vb = (b.data?.[sortCol] ?? b[sortCol] ?? '').toString()
      let cmp = 0
      if (sortCol === 'value') cmp = parseFloat(va || 0) - parseFloat(vb || 0)
      else cmp = va.localeCompare(vb)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, busca, filtroStatus, filtroFiscal, dataDe, dataAte, tipoData, filtroCategoria, vmin, vmax, sortCol, sortDir])

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const algumFiltro = !!(busca || filtroStatus || filtroFiscal || dataDe || dataAte || filtroCategoria || vmin || vmax)
  function limparFiltros() {
    setBusca(''); setFiltroStatus(''); setFiltroFiscal('')
    setDataDe(''); setDataAte(''); setTipoData('due')
    setFiltroCategoria(''); setVmin(''); setVmax('')
  }

  // Resumo fiscal (o que tem nota, o que não tem, e o que falta escriturar).
  const resumoFiscal = useMemo(() => {
    const acc = { com_nf: 0, sem_nf: 0, pendente: 0, a_escriturar: 0 }
    for (const item of rows) {
      if (ehPrevisto(item.data)) continue
      if (item.data?.escriturado !== true) acc.a_escriturar++
      const ds = getDocStatus(item)
      if (ds === 'vinculado') acc.com_nf++
      else if (ds === 'dispensado') acc.sem_nf++
      else if (ds === 'pendente') acc.pendente++
    }
    return acc
  }, [rows])

  const total = useMemo(
    () => filtrados.reduce((s, x) => s + (parseFloat(x.data?.value) || 0), 0),
    [filtrados],
  )

  // ── Anos disponíveis (por competência ou vencimento) ────────────────
  const anosDisponiveis = useMemo(() => {
    const set = new Set()
    for (const r of rows) {
      const ref = r.data?.data_competencia || r.data?.due
      if (ref) set.add(ref.slice(0, 4))
    }
    if (!set.size) set.add(String(new Date().getFullYear()))
    return [...set].sort().reverse()
  }, [rows])
  useEffect(() => {
    if (anosDisponiveis.length && !anosDisponiveis.includes(anoSel)) setAnoSel(anosDisponiveis[0])
  }, [anosDisponiveis, anoSel])

  // ── Receita mês a mês do ano (competência), com composição por mês ──
  const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  const porMes = useMemo(() => {
    const meses = MESES.map((_, m) => ({ mes: m, total: 0, recebido: 0, aReceber: 0, itens: [] }))
    for (const r of rows) {
      const d = r.data
      if (!d || !ehOperacional(d)) continue // mesma regra do Início, da DRE e dos relatórios
      const ref = d.data_competencia || d.due
      if (!ref || !String(ref).startsWith(anoSel)) continue
      const m = parseInt(String(ref).slice(5, 7), 10) - 1
      if (m < 0 || m > 11) continue
      const v = Number(d.value || 0)
      const g = meses[m]
      g.total += v
      if (ehRecebido(d)) g.recebido += v
      else g.aReceber += v
      g.itens.push({ nome: d.client || '—', value: v, status: statusCfg(d).label, codigo: r.codigo })
    }
    return meses
  }, [rows, anoSel])

  const kpisRec = useMemo(() => {
    const faturado = porMes.reduce((s, m) => s + m.total, 0)
    const recebido = porMes.reduce((s, m) => s + m.recebido, 0)
    const aReceber = porMes.reduce((s, m) => s + m.aReceber, 0)
    let vencido = 0
    for (const r of rows) {
      const d = r.data
      if (!d || !ehOperacional(d)) continue // mesma regra do Início, da DRE e dos relatórios
      if (ehRecebido(d)) continue
      const ref = d.data_competencia || d.due
      if (ref && String(ref).startsWith(anoSel) && isOverdue(d.due)) vencido += Number(d.value || 0)
    }
    return { faturado, recebido, aReceber, vencido }
  }, [porMes, rows, anoSel])

  // ── Concentração por cliente + ticket médio + nº de notas ───────────
  const analiseAno = useMemo(() => {
    const porCliente = new Map()
    let nNotas = 0, faturado = 0
    for (const r of rows) {
      const d = r.data
      if (!d || !ehOperacional(d)) continue // mesma regra do Início, da DRE e dos relatórios
      const ref = d.data_competencia || d.due
      if (!ref || !String(ref).startsWith(anoSel)) continue
      const v = Number(d.value || 0)
      faturado += v; nNotas++
      const c = d.client || '—'
      porCliente.set(c, (porCliente.get(c) || 0) + v)
    }
    const clientes = [...porCliente.entries()]
      .map(([nome, val]) => ({ nome, val, pct: faturado ? val / faturado : 0 }))
      .sort((a, b) => b.val - a.val)
    return { clientes, nNotas, faturado, ticket: nNotas ? faturado / nNotas : 0, mesesComNota: porMes.filter(m => m.itens.length).length }
  }, [rows, anoSel, porMes])

  const mrr = useMemo(() => calcMRR(recorrencias), [recorrencias])

  // ── Gráfico de receita mês a mês ────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return
    if (chartInst.current) { chartInst.current.destroy(); chartInst.current = null }
    chartInst.current = new Chart(chartRef.current, {
      type: 'line',
      data: {
        labels: MESES,
        datasets: [
          { label: 'Faturado', data: porMes.map(m => m.total), borderColor: 'rgba(204,145,94,1)', backgroundColor: 'rgba(204,145,94,0.10)', borderWidth: 2.5, tension: 0.35, fill: true, pointRadius: 4, pointBackgroundColor: 'rgba(204,145,94,1)', pointBorderColor: '#fff', pointBorderWidth: 1.5, pointHoverRadius: 6 },
          { label: 'Recebido', data: porMes.map(m => m.recebido), borderColor: 'rgba(39,174,96,1)', backgroundColor: 'transparent', borderWidth: 2, borderDash: [5, 3], tension: 0.35, fill: false, pointRadius: 3, pointBackgroundColor: 'rgba(39,174,96,1)', pointBorderColor: '#fff', pointBorderWidth: 1 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { font: { family: 'Montserrat', size: 11 }, color: '#00203E', padding: 14 } },
          tooltip: {
            callbacks: {
              title: items => `${MESES[items[0].dataIndex]}/${anoSel}`,
              label: () => '',
              afterBody: items => {
                const m = items[0].dataIndex
                const itens = porMes[m].itens.slice().sort((a, b) => b.value - a.value)
                if (!itens.length) return ['(sem faturamento neste mês)']
                const lines = itens.slice(0, 12).map(it => `• ${String(it.nome).slice(0, 26)}  ${fmtMoeda(it.value)}${it.status === 'Recebido' ? ' ✓' : ''}`)
                if (itens.length > 12) lines.push(`  … +${itens.length - 12} nota(s)`)
                lines.push('────────────')
                lines.push(`Total: ${fmtMoeda(porMes[m].total)}`)
                return lines
              },
            },
            titleFont: { family: 'Montserrat', weight: '600' }, bodyFont: { family: 'Montserrat', size: 11 }, padding: 12,
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { family: 'Montserrat', size: 11 }, color: '#5a6a7a' } },
          y: { beginAtZero: true, grid: { color: 'rgba(0,32,62,0.05)' }, ticks: { font: { family: 'Montserrat', size: 10 }, color: '#5a6a7a', callback: v => 'R$ ' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v) } },
        },
      },
    })
    return () => { if (chartInst.current) { chartInst.current.destroy(); chartInst.current = null } }
  }, [porMes, anoSel])

  function abrirNovo() { setEdicao(null); setModalOpen(true) }
  // Busca o lançamento COMPLETO (com o arquivo da nota). A lista vem sem ele
  // de propósito; gravar a partir da versão reduzida apagaria o anexo.
  async function linhaCompleta(id) {
    const { data, error } = await supabase.from('receivable').select('*').eq('id', id).single()
    if (error) throw error
    return data
  }

  async function abrirEdicao(row) {
    try {
      setEdicao(await linhaCompleta(row.id))
      setModalOpen(true)
    } catch (e) {
      showToast(msgErro(e, 'Não consegui abrir o lançamento.'), 'error')
    }
  }

  // ── Marcar como recebido: popover ancorado na linha (nada de prompt) ─
  function abrirPopReceber(row, e) {
    e?.stopPropagation()
    if (ehRecebido(row.data)) {
      showToast('Este lançamento já está marcado como recebido.', 'info')
      return
    }
    const r = e?.currentTarget?.getBoundingClientRect?.()
    const largura = 268
    const left = r ? Math.max(12, Math.min(r.right - largura, window.innerWidth - largura - 12)) : 120
    const abaixo = r ? r.bottom + 6 : 120
    const top = r && abaixo + 160 > window.innerHeight ? Math.max(12, r.top - 166) : abaixo
    setPopReceber({ row, data: hojeISO(), top, left })
  }

  async function confirmarRecebimento() {
    if (!popReceber) return
    const { row, data: dataRec } = popReceber
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataRec || '')) {
      showToast('Escolha uma data de recebimento válida.', 'warning')
      return
    }
    setSalvandoRec(true)
    try {
      // O arquivo da nota não vem na lista: sem reler a linha inteira aqui, o
      // salvamento gravaria o lançamento SEM o anexo.
      const inteira = await linhaCompleta(row.id)
      const merged = { ...(inteira.data || {}), status: 'Recebido', data_pagamento: dataRec }
      const updates = { data: merged }
      if (!row.codigo) updates.codigo = await proximoCodigoReceivable() // previsto realizado direto ganha código
      const { error } = await supabase.from('receivable').update(updates).eq('id', row.id)
      if (error) { showToast(msgErro(error, 'Não consegui marcar como recebido.'), 'error'); return }
      setPopReceber(null)
      showToast(`Marcado como recebido em ${fmtData(dataRec)}.`, 'success')
      recarregar()
    } catch (err) {
      showToast(msgErro(err, 'Não consegui marcar como recebido.'), 'error')
    } finally {
      setSalvandoRec(false)
    }
  }

  async function confirmarProvisao(row, e) {
    e?.stopPropagation()
    if (bloqueadoPorFechamento(row)) return // muda status + código: travado em mês fechado
    try {
      const codigo = await promoverProvisao(row, 'receivable')
      showToast(`Previsto confirmado (${codigo}) — agora está Em aberto.`, 'success')
      recarregar()
    } catch (err) { showToast(msgErro(err, 'Não consegui confirmar este lançamento previsto.'), 'error') }
  }

  // ── Excluir: UM diálogo com todas as consequências + "Desfazer" no aviso ──
  async function desfazerExclusao(registro, filhos) {
    const { error } = await supabase.from('receivable').insert(registro)
    if (error) { showToast(msgErro(error, 'Não consegui trazer o lançamento de volta.'), 'error'); return }
    if (filhos?.length) {
      const { error: erroFilhos } = await supabase.from('receivable').insert(filhos)
      if (erroFilhos) {
        showToast(msgErro(erroFilhos, 'O lançamento voltou, mas as outras parcelas da série não.'), 'error')
        recarregar()
        return
      }
    }
    showToast('Lançamento restaurado.', 'success')
    recarregar()
  }

  async function excluir(row, e) {
    e?.stopPropagation()
    if (bloqueadoPorFechamento(row)) return // DELETE recusado em mês fechado
    const desc = row.data?.desc || row.codigo || 'este lançamento'
    // Lemos a linha INTEIRA antes de apagar: é o que permite o "Desfazer".
    const { data: atual, error: erroLeitura } = await supabase.from('receivable').select('*').eq('id', row.id).single()
    if (erroLeitura) { showToast(msgErro(erroLeitura, 'Não consegui ler o lançamento antes de excluir.'), 'error'); return }
    if (atual?.conciliado_em) {
      showToast('Este lançamento está conciliado com o extrato. Desconcilie na Conciliação antes de excluir.', 'warning')
      return
    }
    let filhos = []
    if (!atual?.parent_id) {
      const { data: parcelas } = await supabase.from('receivable').select('*').eq('parent_id', row.id)
      filhos = parcelas || []
    }
    // Um diálogo só, com TUDO que vai acontecer (antes eram confirm em sequência).
    const consequencias = []
    if (atual?.parent_id) consequencias.push('É uma parcela de uma série — as outras parcelas continuam como estão.')
    if (filhos.length) consequencias.push(`É a 1ª parcela de uma série: as outras ${filhos.length} parcela(s) também serão excluídas.`)
    if (atual?.recurring_id) consequencias.push('Veio de uma recorrência — o sistema pode gerar este lançamento de novo no mês.')
    if (ehPrevisto(atual?.data)) consequencias.push('Está como Previsto: nada de caixa é afetado.')
    else if (ehRecebido(atual?.data)) consequencias.push('Já está recebido: sai dos relatórios e do DRE da competência.')
    consequencias.push('Logo depois de excluir, o aviso na tela oferece "Desfazer".')

    const ok = await confirmar({
      titulo: 'Excluir lançamento?',
      texto: `"${desc}" será excluído das Contas a Receber.`,
      consequencias,
      confirmarLabel: 'Excluir',
      variante: 'perigo',
    })
    if (!ok) return

    const { error } = await supabase.from('receivable').delete().eq('id', row.id)
    if (error) { showToast(msgErro(error, 'Não consegui excluir o lançamento.'), 'error'); return }
    showToast('Lançamento excluído.', 'info', {
      acao: { label: 'Desfazer', onClick: () => desfazerExclusao(atual, filhos) },
    })
    recarregar()
  }

  const colgroup = (
    <colgroup>
      <col style={{ width: 90 }} />
      <col />
      <col />
      <col style={{ width: 120 }} />
      <col style={{ width: 140 }} />
      <col />
      <col style={{ width: 110 }} />
      <col style={{ width: 70 }} />
    </colgroup>
  )
  const temDados = !loading && filtrados.length > 0

  return (
    <AppLayout
      title="Contas a Receber"
      stickyTop={(
        <>
          {/* UMA barra de filtros: busca · período (com o seletor de qual data) ·
              status · situação fiscal. Antes eram chips + barra fiscal repetida +
              dois filtros de data com semânticas diferentes. */}
          <div style={barraFiltros}>
            <div style={linhaFiltros}>
              <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 420 }}>
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
                  style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-mid)' }}>
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  value={busca} onChange={e => setBusca(e.target.value)}
                  placeholder="Buscar por cliente, descrição, código..."
                  style={searchInput}
                  aria-label="Buscar"
                />
              </div>
              <div style={resumo}>
                <span style={{ color: 'var(--text-mid)' }}>{filtrados.length} {filtrados.length === 1 ? 'lançamento' : 'lançamentos'}</span>
                <span style={{ width: 1, height: 14, background: 'var(--cream-dark)' }} />
                <span style={{ fontWeight: 600, color: 'var(--navy)' }}>{fmtMoeda(total)}</span>
              </div>
              <button onClick={abrirNovo} style={btnNovo}>
                <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Nova conta
              </button>
            </div>

            <div style={linhaFiltros}>
              <Campo label="Período">
                <select value={tipoData} onChange={e => setTipoData(e.target.value)} style={selectFiltro} aria-label="Qual data usar no período">
                  <option value="due">Vencimento</option>
                  <option value="data_pagamento">Recebimento</option>
                  <option value="data_competencia">Competência</option>
                </select>
                <input type="date" value={dataDe} onChange={e => setDataDe(e.target.value)} style={inputData} aria-label="De" />
                <span style={{ fontSize: 11, color: 'var(--text-mid)' }}>até</span>
                <input type="date" value={dataAte} onChange={e => setDataAte(e.target.value)} style={inputData} aria-label="Até" />
                {(dataDe || dataAte) && (
                  <button onClick={() => { setDataDe(''); setDataAte('') }} style={btnLimparCampo} title="Limpar período" aria-label="Limpar período">×</button>
                )}
              </Campo>

              <Campo label="Status">
                <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)} style={selectFiltro} aria-label="Status">
                  <option value="">Todos</option>
                  <option value="Pendente">Em aberto</option>
                  <option value="__vencidos__">Vencido</option>
                  <option value="Recebido">Recebido</option>
                  <option value="Provisão">Previsto</option>
                  <option value="__a_escriturar__">A escriturar{resumoFiscal.a_escriturar ? ` (${resumoFiscal.a_escriturar})` : ''}</option>
                </select>
              </Campo>

              <Campo label="Situação fiscal">
                <select value={filtroFiscal} onChange={e => setFiltroFiscal(e.target.value)} style={selectFiltro} aria-label="Situação fiscal">
                  <option value="">Todas</option>
                  {FISCAL.map(f => (
                    <option key={f.valor} value={f.valor}>{f.label} ({resumoFiscal[f.chave]})</option>
                  ))}
                </select>
              </Campo>

              <button onClick={() => setMaisFiltros(v => !v)} style={btnMais} aria-expanded={maisFiltros}>
                {maisFiltros ? '▾' : '▸'} Mais filtros
              </button>
              {algumFiltro && (
                <button onClick={limparFiltros} style={btnLimparTudo}>Limpar filtros</button>
              )}
            </div>

            {maisFiltros && (
              <div style={linhaFiltros}>
                <Campo label="Categoria">
                  <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)} style={selectFiltro} aria-label="Categoria">
                    <option value="">Todas categorias</option>
                    {categorias.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Campo>
                <Campo label="Valor (R$)">
                  <input type="number" step="0.01" value={vmin} onChange={e => setVmin(e.target.value)} placeholder="mínimo" style={inputValor} aria-label="Valor mínimo" />
                  <span style={{ fontSize: 11, color: 'var(--text-mid)' }}>até</span>
                  <input type="number" step="0.01" value={vmax} onChange={e => setVmax(e.target.value)} placeholder="máximo" style={inputValor} aria-label="Valor máximo" />
                </Campo>
              </div>
            )}
          </div>
        </>
      )}
    >
      {/* Faixa de KPIs + gráfico de receita mês a mês */}
      {temDados && (
        <>
          <div style={kpiStrip}>
            <Kpi label={`Faturado ${anoSel}`} valor={fmtMoeda(kpisRec.faturado)} cor="var(--navy)" />
            <Kpi label="Recebido" valor={fmtMoeda(kpisRec.recebido)} cor="var(--green)" />
            <Kpi label="A receber" valor={fmtMoeda(kpisRec.aReceber)} cor="var(--gold-dark)" />
            <Kpi label="Vencido" valor={fmtMoeda(kpisRec.vencido)} cor="var(--red)" />
            <Kpi label="Ticket médio" valor={fmtMoeda(analiseAno.ticket)} cor="var(--navy)" />
            <Kpi label={`Nº de notas ${anoSel}`} valor={String(analiseAno.nNotas)} cor="var(--navy)" />
            <Kpi label="MRR · recorrente/mês" valor={fmtMoeda(mrr)} cor="var(--gold-dark)" />
          </div>
          <div style={chartCard}>
            <div style={chartHeader}>
              <div>
                <div style={chartTitle}>Evolução da receita — {anoSel}</div>
                <div style={chartSub}>Passe o mouse num mês pra ver a composição · linha cobre = faturado · tracejado verde = recebido</div>
              </div>
              <select value={anoSel} onChange={e => setAnoSel(e.target.value)} style={anoSelect}>
                {anosDisponiveis.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div style={{ height: 260, position: 'relative' }}><canvas ref={chartRef} /></div>
          </div>

          {analiseAno.clientes.length > 0 && (
            <div style={{ ...chartCard, marginTop: 16 }}>
              <div style={chartTitle}>Concentração por cliente — {anoSel}</div>
              <div style={chartSub}>Quem representa cada fatia da sua receita {analiseAno.clientes[0].pct > 0.5 && <strong style={{ color: 'var(--red)' }}>· ⚠️ dependência alta do maior cliente</strong>}</div>
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {analiseAno.clientes.slice(0, 6).map(c => (
                  <div key={c.nome} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: '0 0 210px', fontSize: 12, color: 'var(--navy)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.nome}>{c.nome}</div>
                    <div style={{ flex: 1, height: 16, background: 'var(--cream)', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.max(3, c.pct * 100)}%`, background: c.pct > 0.5 ? 'var(--red)' : 'linear-gradient(90deg, var(--gold), var(--gold-dark))', borderRadius: 999 }} />
                    </div>
                    <div style={{ flex: '0 0 130px', textAlign: 'right', fontSize: 12 }}>
                      <strong style={{ color: 'var(--navy)' }}>{(c.pct * 100).toFixed(1)}%</strong>
                      <span style={{ color: 'var(--text-mid)' }}> · {fmtMoeda(c.val)}</span>
                    </div>
                  </div>
                ))}
                {analiseAno.clientes.length > 6 && (
                  <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 2 }}>+ {analiseAno.clientes.length - 6} outro(s) cliente(s)</div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <div style={{ ...tableWrap, marginTop: temDados ? 16 : 0 }}>
        {loading ? (
          <div style={emptyState}>Carregando…</div>
        ) : erro ? (
          <EstadoErro onRetry={recarregar} />
        ) : filtrados.length === 0 ? (
          <div style={emptyState}>
            {rows.length === 0 ? 'Nenhuma conta a receber cadastrada. Clique em "Nova conta" pra começar.' : 'Nenhum resultado para os filtros.'}
          </div>
        ) : (
          <table style={{ ...tbl, tableLayout: 'fixed' }}>
            {colgroup}
            <thead>
              <tr>
                <Th onClick={() => toggleSort('codigo')} active={sortCol === 'codigo'} dir={sortDir}>Cód.</Th>
                <Th onClick={() => toggleSort('client')} active={sortCol === 'client'} dir={sortDir}>Cliente</Th>
                <th style={th}>Descrição</th>
                <Th onClick={() => toggleSort('value')} active={sortCol === 'value'} dir={sortDir} align="right">Valor</Th>
                <Th onClick={() => toggleSort('due')} active={sortCol === 'due'} dir={sortDir}>Datas</Th>
                <Th onClick={() => toggleSort('cat')} active={sortCol === 'cat'} dir={sortDir}>Categoria</Th>
                <Th onClick={() => toggleSort('status')} active={sortCol === 'status'} dir={sortDir}>Status</Th>
                <th style={{ ...th, textAlign: 'center' }}></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(item => {
                const d = item.data || {}
                const cfg = statusCfg(d)
                return (
                  <tr
                    key={item.id}
                    onClick={() => abrirEdicao(item)}
                    style={trStyle}
                    title="Clique para editar"
                  >
                    <td style={tdMono}>{item.codigo || '—'}{item.anexo_path && <span style={{ marginLeft: 6, color: 'var(--gold)' }} title="Anexo fiscal">📎</span>}</td>
                    <td style={td}>{d.client || '—'}</td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{d.desc || '—'}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtMoeda(d.value)}</td>
                    <td style={td}>
                      {d.data_competencia && <div style={{ fontSize: 10, color: 'var(--text-mid)', lineHeight: 1.4 }}>📄 {fmtData(d.data_competencia)}</div>}
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--navy)', lineHeight: 1.4 }}>📅 {fmtData(d.due)}</div>
                      {d.data_pagamento && <div style={{ fontSize: 10, color: 'var(--green)', lineHeight: 1.4 }}>✓ {fmtData(d.data_pagamento)}</div>}
                    </td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{d.cat || '—'}</td>
                    <td style={td}>
                      <span style={{
                        display: 'inline-block', padding: '3px 9px', borderRadius: 999,
                        fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                        background: cfg.bg, color: cfg.color, textTransform: 'uppercase',
                      }}>{cfg.label}</span>
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      {ehPrevisto(d) && (
                        <button
                          onClick={e => confirmarProvisao(item, e)}
                          title="Confirmar o previsto (passa a Em aberto — ex: NF emitida)"
                          style={{ ...btnExcluir, color: 'var(--gold)', fontSize: 15, fontWeight: 700 }}
                          aria-label="Confirmar lançamento previsto"
                        >⬆</button>
                      )}
                      <button
                        onClick={e => abrirPopReceber(item, e)}
                        title="Marcar como recebido"
                        style={{ ...btnExcluir, color: ehRecebido(d) ? 'var(--green)' : 'var(--text-mid)', fontSize: 14, fontWeight: 700 }}
                        disabled={ehRecebido(d)}
                        aria-label="Marcar como recebido"
                      >✓</button>
                      <button
                        onClick={e => excluir(item, e)}
                        title="Excluir"
                        style={btnExcluir}
                        aria-label="Excluir lançamento"
                      >×</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Popover da data de recebimento — ancorado na linha; Enter confirma, ESC fecha */}
      {popReceber && (
        <>
          <div style={popOverlay} onClick={() => setPopReceber(null)} role="presentation" />
          <div
            style={{ ...popCard, top: popReceber.top, left: popReceber.left }}
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-label="Data do recebimento"
          >
            <div style={popTitulo}>Data do recebimento</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="date"
                value={popReceber.data}
                autoFocus
                onChange={e => setPopReceber(p => (p ? { ...p, data: e.target.value } : p))}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); confirmarRecebimento() }
                  if (e.key === 'Escape') { e.preventDefault(); setPopReceber(null) }
                }}
                style={{ ...inputData, flex: 1 }}
                aria-label="Data do recebimento"
              />
              <button onClick={() => setPopReceber(p => (p ? { ...p, data: hojeISO() } : p))} style={btnHoje} type="button">Hoje</button>
            </div>
            <div style={popRodape}>
              <button onClick={() => setPopReceber(null)} style={btnPopCancelar} type="button">Cancelar</button>
              <button
                onClick={confirmarRecebimento}
                disabled={salvandoRec}
                style={{ ...btnPopOk, ...(salvandoRec ? { opacity: 0.6, cursor: 'wait' } : null) }}
                type="button"
              >{salvandoRec ? 'Salvando…' : 'Marcar como recebido'}</button>
            </div>
          </div>
        </>
      )}

      <ModalLancamento
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        tipo="rec"
        registro={edicao}
        onSaved={recarregar}
      />

      {dialogoConfirmacao}
    </AppLayout>
  )
}

// ─── celulas de cabeçalho com sort ─────────────────────────────────────────
function Th({ children, onClick, active, dir, align = 'left', width }) {
  return (
    <th
      onClick={onClick}
      style={{ ...th, cursor: 'pointer', userSelect: 'none', textAlign: align, width, color: active ? 'var(--gold-light)' : '#fff' }}
    >
      {children}
      <span style={{ fontSize: 9, marginLeft: 4, opacity: active ? 1 : 0.4 }}>{active && dir === 'asc' ? '▲' : '▼'}</span>
    </th>
  )
}

function Campo({ label, children }) {
  return (
    <div style={campoWrap}>
      <span style={campoLabel}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>{children}</div>
    </div>
  )
}

function Kpi({ label, valor, cor }) {
  return (
    <div style={{ background: 'var(--white)', borderRadius: 10, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', padding: '12px 16px', borderTop: `3px solid ${cor}` }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)', marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: cor, fontFamily: 'var(--body)' }}>{valor}</div>
    </div>
  )
}

// ─── styles ───────────────────────────────────────────────────────────────
const kpiStrip = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 14 }
const chartCard = { background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', padding: 18, marginBottom: 4 }
const chartHeader = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12, flexWrap: 'wrap' }
const chartTitle = { fontSize: 14, fontWeight: 600, color: 'var(--navy)', fontFamily: 'var(--body)' }
const chartSub = { fontSize: 11, color: 'var(--text-mid)', marginTop: 2 }
const anoSelect = { padding: '7px 10px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none', cursor: 'pointer' }
const barraFiltros = {
  display: 'flex', flexDirection: 'column', gap: 10,
  marginBottom: 14, padding: '12px 14px',
  background: 'var(--white)', borderRadius: 10,
  border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)',
}
const linhaFiltros = { display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' }
const campoWrap = { display: 'flex', flexDirection: 'column', gap: 4 }
const campoLabel = { fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)' }
const inputData = { padding: '7px 10px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const inputValor = { width: 110, padding: '7px 10px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const selectFiltro = { padding: '7px 28px 7px 10px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none', cursor: 'pointer', appearance: 'none', backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' stroke='%2300203E' stroke-width='1.5' fill='none'/></svg>\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }
const btnLimparCampo = { background: 'none', border: 'none', color: 'var(--text-mid)', cursor: 'pointer', fontSize: 14, fontWeight: 700, padding: '4px 6px' }
const btnMais = { background: 'none', border: 'none', color: 'var(--navy)', fontFamily: 'var(--body)', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', cursor: 'pointer', padding: '7px 4px' }
const btnLimparTudo = { background: 'var(--cream)', border: '1px solid var(--cream-dark)', borderRadius: 6, color: 'var(--text-mid)', fontFamily: 'var(--body)', fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: '7px 12px' }
const btnNovo = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 16px', borderRadius: 6,
  border: 'none', background: 'var(--gold)', color: '#fff',
  fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, letterSpacing: 0.5,
  cursor: 'pointer', textTransform: 'uppercase',
}
const btnExcluir = {
  background: 'none', border: '1px solid transparent', borderRadius: 4,
  color: 'var(--text-mid)', fontSize: 18, lineHeight: 1, cursor: 'pointer',
  width: 26, height: 26, padding: 0,
  transition: 'all .15s',
}
const searchInput = {
  width: '100%', padding: '10px 13px 10px 32px',
  border: '1.5px solid var(--cream-dark)', borderRadius: 6,
  fontFamily: 'var(--body)', fontSize: 12,
  color: 'var(--navy)', background: 'var(--white)', outline: 'none',
  boxSizing: 'border-box',
}
const resumo = {
  display: 'flex', alignItems: 'center', gap: 12,
  fontFamily: 'var(--body)', fontSize: 12,
  padding: '8px 14px', background: 'var(--white)',
  border: '1px solid var(--cream-dark)', borderRadius: 6,
}
const popOverlay = { position: 'fixed', inset: 0, zIndex: 90, background: 'transparent' }
const popCard = {
  position: 'fixed', zIndex: 91, width: 268,
  background: 'var(--white)', borderRadius: 10,
  border: '1px solid var(--cream-dark)',
  boxShadow: '0 12px 32px rgba(0,0,0,0.20)',
  padding: 14, fontFamily: 'var(--body)',
  display: 'flex', flexDirection: 'column', gap: 10,
}
const popTitulo = { fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)' }
const popRodape = { display: 'flex', justifyContent: 'flex-end', gap: 6 }
const btnHoje = { padding: '7px 10px', borderRadius: 6, border: '1.5px solid var(--cream-dark)', background: 'var(--cream)', color: 'var(--navy)', fontFamily: 'var(--body)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }
const btnPopCancelar = { padding: '7px 12px', borderRadius: 6, border: '1.5px solid var(--cream-dark)', background: 'var(--white)', color: 'var(--text-mid)', fontFamily: 'var(--body)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }
const btnPopOk = { padding: '7px 12px', borderRadius: 6, border: 'none', background: 'var(--green)', color: '#fff', fontFamily: 'var(--body)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }
const tableWrap = {
  background: 'var(--white)', borderRadius: 12,
  border: '1px solid var(--cream-dark)',
  boxShadow: 'var(--shadow)',
  overflow: 'hidden',
}
const tbl = { width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--body)' }
const th = {
  textAlign: 'left', padding: '12px 14px',
  fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
  color: '#fff', textTransform: 'uppercase',
  background: 'var(--navy)',
  borderBottom: '2px solid var(--gold)',
}
const trStyle = { transition: 'background .15s', cursor: 'pointer' }
const td = {
  padding: '12px 14px', fontSize: 12, color: 'var(--navy)',
  borderBottom: '1px solid var(--cream-dark)',
  verticalAlign: 'middle',
}
const tdMono = { ...td, fontFamily: 'var(--body)', fontWeight: 600, color: 'var(--text-mid)', letterSpacing: 0.5 }
const emptyState = {
  padding: '60px 24px', textAlign: 'center',
  fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13,
}
