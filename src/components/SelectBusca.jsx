import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { chaveNome } from '../lib/vinculoPessoa'

// =============================================================================
// LISTA SUSPENSA COM BUSCA — escolha única.
//
// Irmã da SelectMultiplo, para quando a lista é longa demais para ser lida de
// cima a baixo: a do Banco Central tem cerca de 460 linhas.
//
// POR QUE NÃO O <datalist> DO NAVEGADOR: ele funciona, e foi o primeiro
// caminho. Mas quem desenha o painel é o navegador, não o sistema — vem com a
// fonte dele, a borda dele, o espaçamento dele, e nenhuma folha de estilo
// alcança aquilo. Observação dela, 10/11/2026, na primeira vez que a lista
// abriu: "show! mas esta fora do padrão da identidade visual da polímata".
// Estava. Um campo que destoa no meio do formulário diz a quem usa que ali
// começa outro sistema.
//
// O painel é posicionado em relação à JANELA, como o da SelectMultiplo, para
// não ser cortado quando o campo está perto da borda de um corpo que rola.
//
// ── TEXTO FORA DA LISTA ────────────────────────────────────────────────────
// Com permitirLivre, o que foi digitado e não casa com nenhuma linha vira uma
// opção explícita no fim do painel. É escolha, e não acidente: sair do campo
// sem escolher não grava nada, e o valor anterior continua valendo.
// =============================================================================
export default function SelectBusca({
  opcoes,              // [{ v, label }]
  selecionado,         // o v atual, para destacar na lista
  rotuloAtual,         // o que mostrar com o campo fechado
  onEscolher,          // (opcao) => void
  onLivre,             // (texto) => void — só com permitirLivre
  permitirLivre = false,
  vazio = 'Selecione',
  id,
}) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const [destaque, setDestaque] = useState(0)
  const [lugar, setLugar] = useState(null)
  const campoRef = useRef(null)
  const painelRef = useRef(null)
  const itemRef = useRef(null)

  const filtradas = useMemo(() => {
    const alvo = chaveNome(busca)
    if (!alvo) return opcoes
    return opcoes.filter(o => chaveNome(o.label).includes(alvo))
  }, [opcoes, busca])

  // A linha do texto fora da lista. Só aparece quando há o que escrever e
  // nenhuma linha da lista é exatamente aquilo.
  const livreDisponivel = permitirLivre
    && busca.trim().length > 0
    && !opcoes.some(o => chaveNome(o.label) === chaveNome(busca))
  const total = filtradas.length + (livreDisponivel ? 1 : 0)

  function abrir() {
    if (aberto) return
    setBusca('')
    const i = opcoes.findIndex(o => o.v === selecionado)
    setDestaque(i >= 0 ? i : 0)
    setAberto(true)
  }
  const fechar = useCallback(() => {
    setAberto(false)
    setBusca('')
  }, [])
  function escolher(i) {
    if (livreDisponivel && i === filtradas.length) {
      onLivre?.(busca.trim())
    } else {
      const o = filtradas[i]
      if (!o) return
      onEscolher?.(o)
    }
    fechar()
    campoRef.current?.focus()
  }

  // Onde o painel cabe: abaixo do campo, ou acima quando falta espaço.
  useLayoutEffect(() => {
    if (!aberto) return undefined
    const medir = () => {
      const b = campoRef.current?.getBoundingClientRect()
      if (!b) return
      const alturaEstimada = Math.min(total * 36 + 12, 300)
      const cabeAbaixo = window.innerHeight - b.bottom > alturaEstimada + 12
      setLugar({
        left: b.left,
        width: Math.max(b.width, 280),
        ...(cabeAbaixo ? { top: b.bottom + 4 } : { bottom: window.innerHeight - b.top + 4 }),
      })
    }
    medir()
    window.addEventListener('resize', medir)
    window.addEventListener('scroll', medir, true)
    return () => {
      window.removeEventListener('resize', medir)
      window.removeEventListener('scroll', medir, true)
    }
  }, [aberto, total])

  // O destaque volta ao topo a cada letra: a lista é outra.
  useEffect(() => { setDestaque(0) }, [busca])

  // E acompanha quem navega pelo teclado, para não sumir na rolagem.
  useEffect(() => {
    if (aberto) itemRef.current?.scrollIntoView({ block: 'nearest' })
  }, [destaque, aberto])

  // Clicar fora fecha. Nada é gravado: o valor anterior continua valendo.
  useEffect(() => {
    if (!aberto) return undefined
    const fora = (e) => {
      if (painelRef.current?.contains(e.target)) return
      if (campoRef.current?.contains(e.target)) return
      fechar()
    }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [aberto, fechar])

  function tecla(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!aberto) { abrir(); return }
      if (!total) return
      const passo = e.key === 'ArrowDown' ? 1 : -1
      setDestaque(d => (d + passo + total) % total)
      return
    }
    if (e.key === 'Enter' && aberto) { e.preventDefault(); escolher(destaque); return }
    if (e.key === 'Escape' && aberto) { e.stopPropagation(); fechar(); return }
    if (e.key === 'Tab' && aberto) fechar()
  }

  return (
    <>
      <div style={{ ...moldura, borderColor: aberto ? 'var(--navy)' : 'var(--cream-dark)' }}>
        <input
          id={id}
          ref={campoRef}
          type="text"
          role="combobox"
          aria-expanded={aberto}
          aria-autocomplete="list"
          autoComplete="off"
          value={aberto ? busca : (rotuloAtual || '')}
          placeholder={aberto ? 'Digite para buscar' : vazio}
          onChange={e => { if (!aberto) abrir(); setBusca(e.target.value) }}
          onFocus={abrir}
          onClick={abrir}
          onKeyDown={tecla}
          style={entrada}
        />
        <span aria-hidden="true" style={{ ...seta, transform: aberto ? 'rotate(180deg)' : 'none' }}>▾</span>
      </div>

      {aberto && lugar && (
        <div ref={painelRef} role="listbox" style={{ ...painel, ...lugar }}>
          {filtradas.map((o, i) => (
            <div
              key={o.v + o.label}
              ref={i === destaque ? itemRef : null}
              role="option"
              aria-selected={o.v === selecionado}
              onMouseEnter={() => setDestaque(i)}
              onMouseDown={e => { e.preventDefault(); escolher(i) }}
              style={{
                ...linha,
                ...(i === destaque ? linhaDestaque : null),
                ...(o.v === selecionado ? linhaAtual : null),
              }}
            >
              {o.label}
            </div>
          ))}

          {livreDisponivel && (
            <div
              ref={destaque === filtradas.length ? itemRef : null}
              role="option"
              aria-selected={false}
              onMouseEnter={() => setDestaque(filtradas.length)}
              onMouseDown={e => { e.preventDefault(); escolher(filtradas.length) }}
              style={{
                ...linha, ...linhaLivre,
                ...(destaque === filtradas.length ? linhaDestaque : null),
              }}
            >
              Usar o que foi digitado: {busca.trim()}
            </div>
          )}

          {!total && <div style={linhaNada}>Nada encontrado.</div>}
        </div>
      )}
    </>
  )
}

const moldura = {
  width: '100%', display: 'flex', alignItems: 'center', gap: 6,
  padding: '0 10px 0 0', border: '1.5px solid var(--cream-dark)', borderRadius: 6,
  background: 'var(--white)', boxSizing: 'border-box',
}
const entrada = {
  flex: 1, minWidth: 0, padding: '9px 12px', border: 'none', outline: 'none',
  background: 'transparent', fontFamily: 'var(--body)', fontSize: 13,
  color: 'var(--navy)', borderRadius: 6,
}
const seta = { fontSize: 10, color: 'var(--text-mid)', transition: 'transform .15s', flexShrink: 0 }
const painel = {
  position: 'fixed', zIndex: 1300, background: 'var(--white)',
  border: '1.5px solid var(--navy)', borderRadius: 6, padding: 6,
  boxShadow: '0 8px 24px rgba(0,17,44,.18)', maxHeight: 300, overflowY: 'auto',
}
const linha = {
  padding: '8px 10px', borderRadius: 5, fontSize: 13, color: 'var(--navy-mid)',
  fontFamily: 'var(--body)', cursor: 'pointer', whiteSpace: 'nowrap',
  overflow: 'hidden', textOverflow: 'ellipsis',
}
const linhaDestaque = { background: 'var(--cream)', color: 'var(--navy)' }
const linhaAtual = { fontWeight: 600 }
const linhaLivre = { borderTop: '1px solid var(--cream-dark)', marginTop: 4, paddingTop: 10, fontStyle: 'italic' }
const linhaNada = { padding: '10px', fontSize: 13, color: 'var(--text-mid)', fontFamily: 'var(--body)' }
