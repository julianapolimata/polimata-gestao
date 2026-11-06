import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// =============================================================================
// LISTA SUSPENSA DE MÚLTIPLA ESCOLHA.
//
// Por que existe: caixas de marcação soltas ocupam a largura toda e deixam o
// formulário desalinhado — o campo vizinho fica em outra altura. Fechada, esta
// lista ocupa o mesmo espaço de um campo comum; aberta, mostra as opções.
//
// O comportamento de múltipla escolha fica preservado: uma pessoa pode ser
// cliente E fornecedora, e isso continua sendo um cadastro só.
//
// O painel é posicionado em relação à JANELA, e não ao formulário. O corpo do
// modal rola, e um painel preso a ele seria cortado na borda quando o campo
// estivesse perto do fim.
// =============================================================================
export default function SelectMultiplo({
  opcoes,            // [{ v, label }]
  valor,             // array de v
  onChange,          // (array) => void
  vazio = 'Selecione',
  id,
}) {
  const [aberto, setAberto] = useState(false)
  const [lugar, setLugar] = useState(null)
  const botaoRef = useRef(null)
  const painelRef = useRef(null)

  const marcados = opcoes.filter(o => valor.includes(o.v))
  const resumo = marcados.length ? marcados.map(o => o.label).join(', ') : vazio

  // Onde o painel cabe: abaixo do campo, ou acima quando falta espaço.
  useLayoutEffect(() => {
    if (!aberto) return undefined
    const medir = () => {
      const b = botaoRef.current?.getBoundingClientRect()
      if (!b) return
      const alturaEstimada = Math.min(opcoes.length * 38 + 12, 280)
      const cabeAbaixo = window.innerHeight - b.bottom > alturaEstimada + 12
      setLugar({
        left: b.left,
        width: b.width,
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
  }, [aberto, opcoes.length])

  // Fecha ao clicar fora e no Esc. O foco volta ao campo, para quem usa teclado
  // não se perder no formulário.
  useEffect(() => {
    if (!aberto) return undefined
    const fora = (e) => {
      if (painelRef.current?.contains(e.target)) return
      if (botaoRef.current?.contains(e.target)) return
      setAberto(false)
    }
    const tecla = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setAberto(false)
      botaoRef.current?.focus()
    }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', tecla, true)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', tecla, true)
    }
  }, [aberto])

  const alternar = (v) => {
    onChange(valor.includes(v) ? valor.filter(x => x !== v) : [...valor, v])
  }

  return (
    <>
      <button
        type="button"
        id={id}
        ref={botaoRef}
        onClick={() => setAberto(a => !a)}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        style={{ ...campo, borderColor: aberto ? 'var(--navy)' : 'var(--cream-dark)' }}
      >
        <span style={marcados.length ? textoCheio : textoVazio}>{resumo}</span>
        <span aria-hidden="true" style={{ ...seta, transform: aberto ? 'rotate(180deg)' : 'none' }}>▾</span>
      </button>

      {aberto && lugar && (
        <div ref={painelRef} role="listbox" aria-multiselectable="true" style={{ ...painel, ...lugar }}>
          {opcoes.map(o => {
            const marcado = valor.includes(o.v)
            return (
              <label key={o.v} style={{ ...linha, ...(marcado ? linhaMarcada : null) }}>
                <input
                  type="checkbox"
                  checked={marcado}
                  onChange={() => alternar(o.v)}
                  style={{ accentColor: 'var(--navy)', margin: 0 }}
                />
                {o.label}
              </label>
            )
          })}
        </div>
      )}
    </>
  )
}

const campo = {
  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  gap: 8, padding: '9px 12px', border: '1.5px solid var(--cream-dark)', borderRadius: 6,
  fontFamily: 'var(--body)', fontSize: 13, background: 'var(--white)', cursor: 'pointer',
  textAlign: 'left', boxSizing: 'border-box', outline: 'none',
}
const textoCheio = {
  color: 'var(--navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}
const textoVazio = { ...textoCheio, color: 'var(--text-mid)' }
const seta = { fontSize: 10, color: 'var(--text-mid)', transition: 'transform .15s', flexShrink: 0 }
const painel = {
  position: 'fixed', zIndex: 1300, background: 'var(--white)',
  border: '1.5px solid var(--navy)', borderRadius: 6, padding: 6,
  boxShadow: '0 8px 24px rgba(0,17,44,.18)', maxHeight: 280, overflowY: 'auto',
}
const linha = {
  display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
  padding: '8px 10px', borderRadius: 5, fontSize: 13, color: 'var(--navy-mid)',
  fontFamily: 'var(--body)',
}
const linhaMarcada = { background: 'var(--cream)', color: 'var(--navy)', fontWeight: 600 }
