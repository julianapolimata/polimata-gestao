// =============================================================================
// Relatórios — monta os dados e exporta em PDF e Excel com a identidade
// Polímata (navy + gold). As bibliotecas (jspdf, exceljs) são carregadas
// SOB DEMANDA (import dinâmico) — só baixam quando a usuária exporta.
// =============================================================================
import { fmtMoney, fmtDate, flatten } from './finance'

const BRAND = {
  navy: '#00203E',
  navyMid: '#1D3B5C',
  gold: '#CC915E',
  goldDark: '#A6512F',
  cream: '#F3EEE4',
  creamDark: '#E0D9CC',
  textMid: '#5A6A7A',
  white: '#FFFFFF',
}

const EMPRESA = {
  nome: 'Polímata GRC',
  razao: 'Polímata Consultoria em GRC Ltda',
  cnpj: '48.948.776/0001-64',
}

function statusLabel(s) {
  const map = { Recebido: 'Recebido', Pago: 'Pago', Pendente: 'Pendente', 'Provisão': 'Provisão' }
  return map[s] || s || 'Pendente'
}

// ── Construção dos dados de cada relatório ─────────────────────────────────
// Retorna { titulo, colunas:[{header, align, largura}], linhas:[[...]], totais:{...} }

function noPeriodo(dateStr, de, ate) {
  if (!dateStr) return false
  return (!de || dateStr >= de) && (!ate || dateStr <= ate)
}

export function construirRelatorio(tipo, { receivable = [], payable = [], de, ate }) {
  if (tipo === 'receber') return relLancamentos('Contas a Receber', receivable.map(flatten), 'client', de, ate)
  if (tipo === 'pagar') return relLancamentos('Contas a Pagar', payable.map(flatten), 'supplier', de, ate)
  if (tipo === 'movimento') return relMovimento(receivable.map(flatten), payable.map(flatten), de, ate)
  return { titulo: 'Relatório', colunas: [], linhas: [], totais: {} }
}

function relLancamentos(titulo, rows, parteKey, de, ate) {
  const filtrados = rows.filter(r => noPeriodo(r.due || r.data?.data_competencia, de, ate))
    .sort((a, b) => (a.due || '').localeCompare(b.due || ''))
  const colunas = [
    { header: 'Código', align: 'left', largura: 55 },
    { header: parteKey === 'client' ? 'Cliente' : 'Fornecedor', align: 'left', largura: 120 },
    { header: 'Descrição', align: 'left', largura: 150 },
    { header: 'Competência', align: 'center', largura: 70 },
    { header: 'Vencimento', align: 'center', largura: 70 },
    { header: 'Status', align: 'center', largura: 60 },
    { header: 'Valor', align: 'right', largura: 80 },
  ]
  let total = 0
  const linhas = filtrados.map(r => {
    const val = Number(r.value) || 0
    total += val
    return [
      r.codigo || '—',
      r.data?.[parteKey] || r[parteKey] || '—',
      r.desc || '—',
      fmtDate(r.data?.data_competencia),
      fmtDate(r.due),
      statusLabel(r.status),
      fmtMoney(val),
    ]
  })
  return { titulo, colunas, linhas, totais: { label: 'Total', valor: total, colIndex: 6 } }
}

function relMovimento(receivable, payable, de, ate) {
  const entradas = receivable.filter(r => noPeriodo(r.due, de, ate)).map(r => ({ ...r, _tipo: 'Entrada' }))
  const saidas = payable.filter(r => noPeriodo(r.due, de, ate)).map(r => ({ ...r, _tipo: 'Saída' }))
  const todos = [...entradas, ...saidas].sort((a, b) => (a.due || '').localeCompare(b.due || ''))
  const colunas = [
    { header: 'Vencimento', align: 'center', largura: 70 },
    { header: 'Tipo', align: 'center', largura: 55 },
    { header: 'Descrição', align: 'left', largura: 160 },
    { header: 'Categoria', align: 'left', largura: 110 },
    { header: 'Status', align: 'center', largura: 60 },
    { header: 'Valor', align: 'right', largura: 85 },
  ]
  let totalIn = 0, totalOut = 0
  const linhas = todos.map(r => {
    const val = Number(r.value) || 0
    if (r._tipo === 'Entrada') totalIn += val; else totalOut += val
    return [
      fmtDate(r.due),
      r._tipo,
      r.desc || '—',
      r.data?.cat || '—',
      statusLabel(r.status),
      `${r._tipo === 'Saída' ? '- ' : ''}${fmtMoney(val)}`,
    ]
  })
  return {
    titulo: 'Movimento Consolidado',
    colunas, linhas,
    totais: { label: `Entradas ${fmtMoney(totalIn)}  ·  Saídas ${fmtMoney(totalOut)}  ·  Saldo`, valor: totalIn - totalOut, colIndex: 5 },
  }
}

function periodoLabel(de, ate) {
  if (de && ate) return `${fmtDate(de)} a ${fmtDate(ate)}`
  if (de) return `a partir de ${fmtDate(de)}`
  if (ate) return `até ${fmtDate(ate)}`
  return 'Todo o período'
}

function hojeExtenso() {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function nomeArquivo(rel, de, ate, ext) {
  const slug = rel.titulo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')
  const per = (de || 'inicio') + '_' + (ate || 'fim')
  return `polimata_${slug}_${per}.${ext}`
}

// ── PDF (jspdf + autotable), branded ───────────────────────────────────────
export async function exportarPDF(rel, { de, ate } = {}) {
  const { default: jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()

  // Faixa navy do cabeçalho
  doc.setFillColor(BRAND.navy)
  doc.rect(0, 0, W, 68, 'F')
  doc.setFillColor(BRAND.gold)
  doc.rect(0, 68, W, 3, 'F')

  doc.setTextColor(BRAND.gold)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.text(EMPRESA.nome, 40, 30)
  doc.setTextColor('#F3EEE4')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(`${EMPRESA.razao}  ·  CNPJ ${EMPRESA.cnpj}`, 40, 44)

  doc.setTextColor('#FFFFFF')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text(rel.titulo, W - 40, 30, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor('#E0D9CC')
  doc.text(`Período: ${periodoLabel(de, ate)}`, W - 40, 44, { align: 'right' })
  doc.text(`Emitido em ${hojeExtenso()}`, W - 40, 56, { align: 'right' })

  const foot = rel.totais ? [(() => {
    const row = new Array(rel.colunas.length).fill('')
    row[0] = rel.totais.label
    row[rel.totais.colIndex] = fmtMoney(rel.totais.valor)
    return row
  })()] : undefined

  autoTable(doc, {
    startY: 84,
    head: [rel.colunas.map(c => c.header)],
    body: rel.linhas.length ? rel.linhas : [['—', ...rel.colunas.slice(1).map(() => '')]],
    foot,
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 5, textColor: BRAND.navy, lineColor: BRAND.creamDark, lineWidth: 0.3 },
    headStyles: { fillColor: BRAND.navy, textColor: '#FFFFFF', fontStyle: 'bold', fontSize: 8, halign: 'left' },
    footStyles: { fillColor: BRAND.cream, textColor: BRAND.navy, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: '#FBF8F2' },
    columnStyles: rel.colunas.reduce((acc, c, i) => { acc[i] = { halign: c.align }; return acc }, {}),
    margin: { left: 40, right: 40 },
    didDrawPage: () => {
      const h = doc.internal.pageSize.getHeight()
      const pg = doc.internal.getNumberOfPages()
      doc.setFontSize(7)
      doc.setTextColor(BRAND.textMid)
      doc.text('Gerado por Polímata Gestão', 40, h - 18)
      doc.text(`Página ${pg}`, W - 40, h - 18, { align: 'right' })
    },
  })

  doc.save(nomeArquivo(rel, de, ate, 'pdf'))
}

// ── Excel (exceljs), branded ───────────────────────────────────────────────
export async function exportarExcel(rel, { de, ate } = {}) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Polímata Gestão'
  const ws = wb.addWorksheet(rel.titulo.slice(0, 31))
  const nCols = rel.colunas.length

  // Título (linha mesclada, navy/gold)
  ws.mergeCells(1, 1, 1, nCols)
  const t = ws.getCell(1, 1)
  t.value = `${EMPRESA.nome} — ${rel.titulo}`
  t.font = { bold: true, size: 14, color: { argb: 'FFCC915E' } }
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00203E' } }
  t.alignment = { vertical: 'middle', horizontal: 'left' }
  ws.getRow(1).height = 24

  ws.mergeCells(2, 1, 2, nCols)
  const sub = ws.getCell(2, 1)
  sub.value = `Período: ${periodoLabel(de, ate)}  ·  Emitido em ${hojeExtenso()}  ·  CNPJ ${EMPRESA.cnpj}`
  sub.font = { size: 9, color: { argb: 'FF5A6A7A' } }

  // Cabeçalho (navy)
  const headerRow = ws.addRow(rel.colunas.map(c => c.header))
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00203E' } }
    cell.alignment = { horizontal: 'left' }
  })

  // Dados
  rel.linhas.forEach(linha => {
    const row = ws.addRow(linha)
    row.eachCell((cell, col) => {
      cell.font = { size: 9, color: { argb: 'FF00203E' } }
      cell.alignment = { horizontal: rel.colunas[col - 1]?.align === 'right' ? 'right' : (rel.colunas[col - 1]?.align || 'left') }
    })
  })

  // Total
  if (rel.totais) {
    const totalArr = new Array(nCols).fill('')
    totalArr[0] = rel.totais.label
    totalArr[rel.totais.colIndex] = fmtMoney(rel.totais.valor)
    const tr = ws.addRow(totalArr)
    tr.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FF00203E' }, size: 10 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3EEE4' } }
    })
  }

  ws.columns.forEach((c, i) => { c.width = Math.max(12, (rel.colunas[i]?.largura || 90) / 5.2) })

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  baixarBlob(blob, nomeArquivo(rel, de, ate, 'xlsx'))
}

function baixarBlob(blob, nome) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
