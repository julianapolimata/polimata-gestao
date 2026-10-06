/* global __BUILD_ID__ */
import { useEffect, useRef, useState } from 'react'

// =============================================================================
// AVISO DE VERSÃO NOVA.
//
// Pedido da Juliana (06/10), depois de uma tarde em que ela respondia "ainda
// não aparece" a conserto após conserto — e parte das vezes estava olhando a
// tela antiga, porque o navegador ainda servia o bundle anterior. Sem este
// aviso, o sistema não tem como dizer "o que você está vendo não é o mais
// recente", e a conversa vira adivinhação.
//
// Mesmo mecanismo que já roda no polimata-app (o sistema de CI), trazido para
// cá: o build embute um __BUILD_ID__ e publica /version.json com o mesmo
// número. Diferiram, há deploy novo.
//
// TRÊS DECISÕES DE DESENHO, e as três são sobre não atrapalhar:
//
//   1. NÃO BLOQUEIA. É uma faixa discreta no rodapé, não um modal. Quem está
//      no meio de uma conciliação de 43 linhas termina o que está fazendo.
//   2. NUNCA ATUALIZA SOZINHO. Recarregar no meio de um formulário perde o que
//      foi digitado. O reload só acontece no clique dela.
//   3. "AGORA NÃO" SILENCIA DE VERDADE, por 10 minutos. Aviso que volta a cada
//      dois minutos é pior que aviso nenhum: ensina a ignorar.
// =============================================================================

const BUILD_ID = (typeof __BUILD_ID__ !== 'undefined') ? __BUILD_ID__ : ''
const ADIAR_MS = 10 * 60 * 1000

export default function AtualizacaoDisponivel() {
  const [novaVersao, setNovaVersao] = useState(false)
  const adiadoAte = useRef(0)

  useEffect(() => {
    let parado = false
    async function checar() {
      try {
        // `no-store` + querystring: sem isso o próprio version.json vem do
        // cache e o aviso nunca apareceria — o arquivo que denuncia a versão
        // velha seria servido pela versão velha.
        const res = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (parado || !data?.buildId || !BUILD_ID) return
        if (String(data.buildId) !== String(BUILD_ID) && Date.now() >= adiadoAte.current) {
          setNovaVersao(true)
        }
      } catch { /* offline, ou dev sem version.json: não é problema, só não avisa */ }
    }
    checar()
    const iv = setInterval(checar, 120000)
    // Voltar para a aba é o momento em que ela mais provavelmente quer o novo:
    // é o gesto de quem foi fazer outra coisa e voltou para testar.
    const aoVoltar = () => { if (document.visibilityState === 'visible') checar() }
    window.addEventListener('focus', checar)
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      parado = true
      clearInterval(iv)
      window.removeEventListener('focus', checar)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [])

  async function atualizar() {
    // Limpa o cache antes de recarregar, senão o navegador pode servir o mesmo
    // bundle e a pessoa clica em "Atualizar" sem nada mudar — que é o jeito
    // mais rápido de o aviso perder a credibilidade.
    try {
      if ('caches' in window) {
        const nomes = await caches.keys()
        await Promise.all(nomes.map(n => caches.delete(n)))
      }
    } catch { /* cache indisponível: recarrega assim mesmo */ }
    // Se houver texto não salvo, a guarda de beforeunload do sistema intercepta
    // e pergunta antes de sair — não precisa confirmar duas vezes.
    window.location.reload()
  }

  function adiar() {
    adiadoAte.current = Date.now() + ADIAR_MS
    setNovaVersao(false)
  }

  if (!novaVersao) return null

  return (
    <div style={fora} role="status" aria-live="polite">
      <div style={faixa}>
        <div style={{ fontSize: 22, lineHeight: 1 }}>🔄</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>Nova versão disponível</div>
          <div style={{ fontSize: 11.5, opacity: 0.8, lineHeight: 1.4, marginTop: 2 }}>
            Termine o que está fazendo e atualize quando quiser.
          </div>
        </div>
        <button onClick={adiar} style={btnAdiar} type="button">Agora não</button>
        <button onClick={atualizar} style={btnAtualizar} type="button">Atualizar</button>
      </div>
    </div>
  )
}

const fora = {
  position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 99999,
  display: 'flex', justifyContent: 'center',
  padding: '0 12px calc(12px + env(safe-area-inset-bottom, 0px))',
  pointerEvents: 'none',
}
const faixa = {
  pointerEvents: 'auto', background: '#00203E', color: '#fff', borderRadius: 12,
  boxShadow: '0 12px 34px rgba(0,0,0,0.35)', padding: '12px 14px', maxWidth: 440, width: '100%',
  border: '1px solid rgba(204,145,94,0.5)', fontFamily: 'var(--body)',
  display: 'flex', alignItems: 'center', gap: 12,
}
const btnAdiar = {
  flexShrink: 0, background: 'none', border: 'none', color: 'rgba(243,238,228,0.65)',
  fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', padding: '8px 6px',
}
const btnAtualizar = {
  flexShrink: 0, background: '#CC915E', color: '#fff', border: 'none', borderRadius: 8,
  padding: '9px 16px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
}
