import { useCallback, useEffect, useRef, useState } from 'react'
import Modal from './Modal'

// =============================================================================
// CONFIRM DIALOG — substitui window.confirm / window.prompt.
//
// Por quê: os diálogos do navegador não dizem O QUE vai acontecer (e quando a
// ação tem 3 consequências, viravam 3 confirm em sequência). Aqui é UM diálogo,
// no visual do Modal.jsx, com a lista de consequências na cara da usuária.
//
// Uso (o jeito curto):
//   const [confirmar, dialogo] = useConfirm()
//   ...
//   if (!(await confirmar({ titulo: 'Excluir?', texto: '…', variante: 'perigo' }))) return
//   ...
//   return (<>{dialogo}</>)   // renderize o elemento uma vez na tela
//
// Com justificativa obrigatória (no lugar do window.prompt):
//   const motivo = await confirmar({ …, exigeTexto: { label: 'Motivo', minimo: 10 } })
//   if (!motivo) return        // false = cancelou; string = o que ela digitou
// =============================================================================

export default function ConfirmDialog({
  open,
  titulo = 'Confirmar',
  texto,
  consequencias,            // array de strings — o que vai acontecer de fato
  confirmarLabel = 'Confirmar',
  cancelarLabel = 'Cancelar',
  variante = 'normal',      // 'perigo' = ação destrutiva (botão vermelho)
  exigeTexto = null,        // { label, minimo, placeholder }
  onConfirm,
  onCancel,
  width = 480,
}) {
  const [valor, setValor] = useState('')
  const refConfirmar = useRef(null)
  const refCancelar = useRef(null)
  const refCampo = useRef(null)
  const perigo = variante === 'perigo'
  const minimo = exigeTexto?.minimo ?? 0
  const textoOk = !exigeTexto || valor.trim().length >= minimo

  // Reabriu: limpa o campo e põe o foco no botão SEGURO (cancelar, quando é
  // destrutivo) — ninguém apaga nada só por apertar Enter sem ler.
  useEffect(() => {
    if (!open) return
    setValor('')
    const t = setTimeout(() => {
      if (exigeTexto) refCampo.current?.focus()
      else if (perigo) refCancelar.current?.focus()
      else refConfirmar.current?.focus()
    }, 0)
    return () => clearTimeout(t)
  }, [open, perigo, exigeTexto])

  function confirmar() {
    if (!textoOk) return
    onConfirm?.(exigeTexto ? valor.trim() : true)
  }

  const footer = (
    <>
      <button ref={refCancelar} onClick={onCancel} style={btnCancelar} type="button">{cancelarLabel}</button>
      <button
        ref={refConfirmar}
        onClick={confirmar}
        disabled={!textoOk}
        style={{ ...btnConfirmar, ...(perigo ? btnPerigo : null), ...(textoOk ? null : btnDesabilitado) }}
        type="button"
      >{confirmarLabel}</button>
    </>
  )

  return (
    <Modal open={open} onClose={onCancel} title={titulo} footer={footer} width={width}>
      {texto && <div style={corpoTexto}>{texto}</div>}

      {Array.isArray(consequencias) && consequencias.length > 0 && (
        <div style={{ ...caixaConsequencias, ...(perigo ? caixaPerigo : null) }}>
          <div style={caixaTitulo}>O que vai acontecer</div>
          <ul style={lista}>
            {consequencias.map((c, i) => <li key={i} style={itemLista}>{c}</li>)}
          </ul>
        </div>
      )}

      {exigeTexto && (
        <label style={campoWrap}>
          <span style={campoLabel}>{exigeTexto.label || 'Justificativa'}</span>
          <textarea
            ref={refCampo}
            value={valor}
            onChange={e => setValor(e.target.value)}
            placeholder={exigeTexto.placeholder || ''}
            rows={3}
            style={campoInput}
          />
          {minimo > 0 && (
            <span style={{ ...campoAjuda, color: textoOk ? 'var(--text-mid)' : 'var(--orange)' }}>
              {textoOk ? 'Pode confirmar.' : `Escreva pelo menos ${minimo} caracteres (${valor.trim().length}/${minimo}).`}
            </span>
          )}
        </label>
      )}
    </Modal>
  )
}

/**
 * Hook: devolve [confirmar, elementoDoDialogo].
 * `confirmar(opcoes)` abre o diálogo e devolve uma Promise que resolve
 * `false` (cancelou), `true` (confirmou) ou o texto digitado (com exigeTexto).
 */
export function useConfirm() {
  const [pedido, setPedido] = useState(null) // { opcoes }
  const resolveRef = useRef(null)

  const confirmar = useCallback(opcoes => new Promise(resolve => {
    resolveRef.current = resolve
    setPedido({ opcoes: opcoes || {} })
  }), [])

  const responder = useCallback(valor => {
    const resolve = resolveRef.current
    resolveRef.current = null
    setPedido(null)
    resolve?.(valor)
  }, [])

  const elemento = (
    <ConfirmDialog
      open={!!pedido}
      {...(pedido?.opcoes || {})}
      onConfirm={valor => responder(valor)}
      onCancel={() => responder(false)}
    />
  )

  return [confirmar, elemento]
}

// ─── styles (mesmo vocabulário visual do Modal.jsx) ────────────────────────
const corpoTexto = { fontSize: 13, lineHeight: 1.6, color: 'var(--navy)' }
const caixaConsequencias = {
  marginTop: 14, padding: '12px 14px',
  background: 'var(--cream)', border: '1px solid var(--cream-dark)',
  borderLeft: '3px solid var(--gold)', borderRadius: 8,
}
const caixaPerigo = { borderLeft: '3px solid var(--red)' }
const caixaTitulo = {
  fontSize: 10, fontWeight: 700, letterSpacing: 1,
  textTransform: 'uppercase', color: 'var(--text-mid)', marginBottom: 6,
}
const lista = { margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }
const itemLista = { fontSize: 12.5, lineHeight: 1.5, color: 'var(--navy)' }
const campoWrap = { display: 'flex', flexDirection: 'column', gap: 5, marginTop: 16 }
const campoLabel = {
  fontSize: 10, fontWeight: 700, letterSpacing: 1,
  textTransform: 'uppercase', color: 'var(--text-mid)',
}
const campoInput = {
  width: '100%', padding: '9px 11px', resize: 'vertical',
  border: '1.5px solid var(--cream-dark)', borderRadius: 6,
  fontFamily: 'var(--body)', fontSize: 12.5, color: 'var(--navy)',
  background: 'var(--white)', outline: 'none', boxSizing: 'border-box',
}
const campoAjuda = { fontSize: 11 }
const btnBase = {
  padding: '8px 16px', borderRadius: 6,
  fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700,
  letterSpacing: 0.5, textTransform: 'uppercase', cursor: 'pointer',
}
const btnCancelar = {
  ...btnBase,
  border: '1.5px solid var(--cream-dark)', background: 'var(--white)', color: 'var(--text-mid)',
}
const btnConfirmar = { ...btnBase, border: 'none', background: 'var(--gold)', color: '#fff' }
const btnPerigo = { background: 'var(--red)' }
const btnDesabilitado = { opacity: 0.45, cursor: 'not-allowed' }
