// =============================================================================
// CAMPO DE DATA — o calendário da casa, no lugar do calendário do Windows.
//
// A Juliana abriu o seletor de data e viu um painel com a fonte do sistema
// operacional, azul de link, nada da identidade: "arruma o visual do
// calendário, tá em windows e não na nossa fonte".
//
// Ela está certa, e não havia CSS que resolvesse. O `<input type="date">` abre
// um painel desenhado pelo NAVEGADOR, fora da página — a folha de estilo não
// alcança. A única saída é desenhar o nosso.
//
// ── POR QUE A API É IGUAL À DO INPUT NATIVO ─────────────────────────────────
//
// Este componente recebe `value` e devolve `onChange({ target: { value } })`,
// exatamente como o input que ele substitui. Foi decisão de projeto: eram 32
// campos em 13 telas, e uma API diferente obrigaria a reescrever 32 trechos de
// lógica — 32 chances de trocar um `dataDe` por um `dataAte` em tela que já
// funcionava. Com a mesma API, a troca é só o nome da tag.
//
// ── DIGITAR CONTINUA VALENDO MAIS QUE CLICAR ────────────────────────────────
//
// Quem lança 200 notas não quer abrir calendário 200 vezes: digita 22052025 e
// passa para o próximo campo. Por isso o campo é de TEXTO, aceita todo formato
// que se escreve de verdade (src/lib/datas.js converte), e o calendário é uma
// ajuda ao lado — não o caminho obrigatório.
//
// O que a pessoa digitou só vira data quando sai do campo. Converter a cada
// tecla faria "2" virar 02/10/2026 antes de ela terminar de escrever.
// =============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MESES, DIAS_SEMANA, hojeISO, ehISO, paraBR, deBR, gradeDoMes, mesDe, somarMeses, foraDoLimite,
} from '../lib/datas'

// capitalize do CSS sobe a letra de TODA palavra: "maio de 2025" virava
// "Maio De 2025". Em portugues so a primeira sobe.
const comMaiuscula = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

export default function CampoData({
  value = '',
  onChange,
  style,
  disabled = false,
  min = '',
  max = '',
  placeholder = 'dd/mm/aaaa',
  title,
  'aria-label': ariaLabel,
  ...resto
}) {
  const [texto, setTexto] = useState(() => paraBR(value))
  const [aberto, setAberto] = useState(false)
  const [visivel, setVisivel] = useState(() => mesDe(value))
  const caixa = useRef(null)

  // A data pode mudar por fora (limpar filtros, carregar um registro): o texto
  // acompanha, menos enquanto ela está digitando.
  useEffect(() => { setTexto(paraBR(value)) }, [value])
  useEffect(() => { if (aberto) setVisivel(mesDe(value)) }, [aberto, value])

  const emitir = useCallback(iso => {
    onChange?.({ target: { value: iso || '' } })
  }, [onChange])

  // Fechar ao clicar fora: um calendário aberto em cima da lista atrapalha
  // mais que ajuda.
  useEffect(() => {
    if (!aberto) return
    const fora = e => { if (caixa.current && !caixa.current.contains(e.target)) setAberto(false) }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [aberto])

  function confirmarTexto() {
    const t = texto.trim()
    if (!t) { if (value) emitir(''); return }
    const iso = deBR(t)
    if (iso && !foraDoLimite(iso, min, max)) {
      if (iso !== value) emitir(iso)
      setTexto(paraBR(iso))
    } else {
      // Não dá para entender (ou está fora do limite): volta ao que valia.
      // Apagar o que ela escreveu sem dizer nada seria pior — aqui ela vê o
      // valor anterior de volta e sabe que não foi aceito.
      setTexto(paraBR(value))
    }
  }

  function aoDigitar(e) {
    const k = e.key
    if (k === 'Enter') { e.preventDefault(); confirmarTexto(); setAberto(false) }
    else if (k === 'Escape' && aberto) { e.preventDefault(); setAberto(false) }
    else if (k === 'ArrowDown' && !aberto) { e.preventDefault(); setAberto(true) }
  }

  function escolher(iso) {
    if (foraDoLimite(iso, min, max)) return
    emitir(iso)
    setTexto(paraBR(iso))
    setAberto(false)
  }

  const grade = useMemo(() => gradeDoMes(visivel.ano, visivel.mes), [visivel])
  const hoje = hojeISO()
  const invalido = texto.trim() !== '' && !deBR(texto)

  return (
    <div ref={caixa} style={{ position: 'relative', display: 'inline-flex', ...(style?.flex ? { flex: style.flex } : {}) }}>
      <input
        type="text"
        inputMode="numeric"
        value={texto}
        disabled={disabled}
        placeholder={placeholder}
        title={title}
        aria-label={ariaLabel || title || 'Data'}
        onChange={e => setTexto(e.target.value)}
        onBlur={confirmarTexto}
        onKeyDown={aoDigitar}
        style={{ ...campoBase, ...style, ...(invalido ? { borderColor: 'var(--red)' } : {}), paddingRight: 30 }}
        {...resto}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={() => setAberto(v => !v)}
        aria-label="Abrir calendário"
        title="Abrir calendário"
        style={botaoCalendario}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <line x1="3" y1="10" x2="21" y2="10" />
          <line x1="8" y1="3" x2="8" y2="7" />
          <line x1="16" y1="3" x2="16" y2="7" />
        </svg>
      </button>

      {aberto && (
        <div style={painel}>
          <div style={cabecalho}>
            <button type="button" onClick={() => setVisivel(mesDe(somarMeses(`${visivel.ano}-${String(visivel.mes + 1).padStart(2, '0')}-01`, -1)))} style={seta} aria-label="Mês anterior">‹</button>
            <span style={tituloMes}>{comMaiuscula(MESES[visivel.mes])} de {visivel.ano}</span>
            <button type="button" onClick={() => setVisivel(mesDe(somarMeses(`${visivel.ano}-${String(visivel.mes + 1).padStart(2, '0')}-01`, 1)))} style={seta} aria-label="Próximo mês">›</button>
          </div>

          <div style={semana}>
            {DIAS_SEMANA.map(d => <span key={d} style={diaSemana}>{d}</span>)}
          </div>

          <div style={gradeEstilo}>
            {grade.map(c => {
              const bloqueado = foraDoLimite(c.iso, min, max)
              const selecionado = ehISO(value) && c.iso === value
              return (
                <button
                  key={c.iso}
                  type="button"
                  disabled={bloqueado}
                  onClick={() => escolher(c.iso)}
                  style={{
                    ...dia,
                    ...(c.doMes ? null : diaDeFora),
                    ...(c.iso === hoje ? diaHoje : null),
                    ...(selecionado ? diaSelecionado : null),
                    ...(bloqueado ? diaBloqueado : null),
                  }}
                >{c.dia}</button>
              )
            })}
          </div>

          <div style={rodape}>
            <button type="button" onClick={() => escolher(hoje)} style={acao}>Hoje</button>
            <button type="button" onClick={() => { emitir(''); setTexto(''); setAberto(false) }} style={acao}>Limpar</button>
          </div>
        </div>
      )}
    </div>
  )
}

const campoBase = {
  padding: '7px 9px',
  border: '1.5px solid var(--cream-dark)',
  borderRadius: 6,
  fontFamily: 'var(--body)',
  fontSize: 12,
  color: 'var(--navy)',
  background: 'var(--white)',
  outline: 'none',
  width: '100%',
  minWidth: 110,
}
const botaoCalendario = {
  position: 'absolute', right: 1, top: 1, bottom: 1, width: 28,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'none', border: 'none', borderRadius: '0 6px 6px 0',
  color: 'var(--gold-dark)', cursor: 'pointer', padding: 0,
}
const painel = {
  position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 400,
  background: 'var(--white)', border: '1px solid var(--cream-dark)', borderRadius: 10,
  boxShadow: '0 8px 24px rgba(0,32,62,0.16)', padding: 10, width: 252,
  fontFamily: 'var(--body)',
}
const cabecalho = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }
const tituloMes = { fontSize: 12, fontWeight: 700, color: 'var(--navy)' }
const seta = {
  width: 24, height: 24, borderRadius: 6, border: '1px solid var(--cream-dark)',
  background: 'var(--white)', color: 'var(--navy)', cursor: 'pointer',
  fontSize: 15, lineHeight: 1, fontFamily: 'var(--body)', padding: 0,
}
const semana = { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 2 }
const diaSemana = {
  textAlign: 'center', fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5,
  textTransform: 'uppercase', color: 'var(--text-mid)', padding: '3px 0',
}
const gradeEstilo = { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }
const dia = {
  height: 28, borderRadius: 6, border: '1px solid transparent',
  background: 'none', color: 'var(--navy)', cursor: 'pointer',
  fontFamily: 'var(--body)', fontSize: 11.5, padding: 0,
}
const diaDeFora = { color: 'var(--text-mid)', opacity: 0.45 }
const diaHoje = { border: '1px solid var(--gold-dark)', fontWeight: 700 }
const diaSelecionado = { background: 'var(--navy)', color: '#fff', fontWeight: 700, borderColor: 'var(--navy)' }
const diaBloqueado = { opacity: 0.25, cursor: 'not-allowed' }
const rodape = { display: 'flex', gap: 6, marginTop: 8, borderTop: '1px dashed var(--cream-dark)', paddingTop: 8 }
const acao = {
  flex: 1, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--cream-dark)',
  background: 'var(--white)', color: 'var(--text-mid)', cursor: 'pointer',
  fontFamily: 'var(--body)', fontSize: 11, fontWeight: 600,
}
