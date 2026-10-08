// =============================================================================
// A ARIS NO APP INTEIRO.
//
// "ela tem que ficar disponível no app inteiro, e responder a tudo do sistema."
//
// Por isso mora no AppLayout: existe em toda tela que a Juliana abre, e sabe em
// qual delas ela está quando pergunta.
//
// ── O QUE A TELA MOSTRA ALÉM DA RESPOSTA ────────────────────────────────────
//
// Embaixo de cada resposta fica "no que me apoiei": os números do sistema que
// foram para o contexto e as classificações anteriores que ela de fato usou.
// Não é enfeite — é a régua que a Juliana me cobrou quando eu dei um parecer
// bonito e errado sobre o seguro prestamista. Evidência que não aparece na
// tela não serve de evidência.
//
// A base (plano, histórico, resumo) é carregada UMA vez, na primeira abertura,
// e reusada. Recarregar a cada pergunta custaria seis consultas por frase.
// =============================================================================
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { carregarBase, conversar } from '../lib/arisConversa'
import { msgErro } from '../lib/erros'

const NOMES_DE_TELA = {
  '/dashboard': 'Início', '/receber': 'Contas a Receber', '/pagar': 'Contas a Pagar',
  '/lancamentos': 'Lançamentos', '/conciliacao': 'Conciliação', '/classificar': 'Escrituração',
  '/dre': 'DRE Gerencial', '/fluxo-caixa': 'Fluxo de Caixa', '/simples-nacional': 'Simples Nacional',
  '/plano-contas': 'Plano de Contas', '/importar-nfs': 'Caixa de entrada',
  '/fechamento-mensal': 'Fechamento', '/emprestimos': 'Empréstimos',
  '/contas-bancarias': 'Contas e Cartões', '/conferencia-fatura': 'Fatura do Cartão',
}

const SUGESTOES = [
  'Quanto eu já recebi e quanto já paguei?',
  'O que ainda falta classificar?',
  'Como eu costumo classificar tarifa de banco?',
]

export default function ArisPainel() {
  const { pathname } = useLocation()
  const [aberto, setAberto] = useState(false)
  const [base, setBase] = useState(null)
  const [carregandoBase, setCarregandoBase] = useState(false)
  const [conversa, setConversa] = useState([])
  const [texto, setTexto] = useState('')
  const [pensando, setPensando] = useState(false)
  const fim = useRef(null)

  const tela = NOMES_DE_TELA[pathname] || ''

  // A base entra na primeira abertura, não no carregamento do app: quem nunca
  // abre a Aris não paga seis consultas por tela visitada.
  useEffect(() => {
    if (!aberto || base || carregandoBase) return
    setCarregandoBase(true)
    carregarBase()
      .then(setBase)
      .catch(e => setConversa(c => [...c, { papel: 'aris', texto: msgErro(e, 'Não consegui carregar os seus números.') }]))
      .finally(() => setCarregandoBase(false))
  }, [aberto, base, carregandoBase])

  useEffect(() => { fim.current?.scrollIntoView({ behavior: 'smooth' }) }, [conversa, pensando])

  async function enviar(perguntaDireta) {
    const pergunta = String(perguntaDireta ?? texto).trim()
    if (!pergunta || pensando || !base) return
    setTexto('')
    const anterior = conversa
    setConversa(c => [...c, { papel: 'voce', texto: pergunta }])
    setPensando(true)
    try {
      const r = await conversar({
        pergunta, conversa: anterior, tela,
        plano: base.plano, historico: base.historico, resumo: base.resumo,
      })
      setConversa(c => [...c, { papel: 'aris', texto: r.texto, apoio: r.usouHistorico, resumo: base.resumo }])
    } catch (e) {
      setConversa(c => [...c, { papel: 'aris', texto: msgErro(e, 'Não consegui falar com a Aris agora.'), erro: true }])
    } finally {
      setPensando(false)
    }
  }

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} style={bolha} title="Perguntar para a Aris" aria-label="Perguntar para a Aris">
        <span style={{ fontSize: 18, lineHeight: 1 }}>✦</span>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>Aris</span>
      </button>
    )
  }

  return (
    <aside style={painel} aria-label="Aris">
      <header style={cabecalho}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>✦ Aris</div>
          <div style={{ fontSize: 10.5, opacity: 0.75 }}>
            contabilidade e finanças{tela ? ` · você está em ${tela}` : ''}
          </div>
        </div>
        <button type="button" onClick={() => setAberto(false)} style={fechar} aria-label="Fechar">×</button>
      </header>

      <div style={corpo}>
        {!conversa.length && (
          <div style={vazio}>
            <p style={{ margin: '0 0 8px' }}>
              Eu respondo <strong>com os seus números e o seu plano de contas</strong>. O que eu não tiver aqui,
              eu digo que não tenho — e digo em que tela está.
            </p>
            <p style={{ margin: '0 0 10px', fontSize: 11 }}>
              Não cito norma nem lei: o que eu não puder mostrar, você não teria como conferir.
            </p>
            {SUGESTOES.map(s => (
              <button key={s} type="button" onClick={() => enviar(s)} disabled={!base} style={sugestao}>{s}</button>
            ))}
          </div>
        )}

        {conversa.map((m, i) => (
          <div key={i} style={m.papel === 'voce' ? balaoVoce : balaoAris}>
            <div style={{ whiteSpace: 'pre-wrap' }}>{m.texto}</div>

            {/* NO QUE ME APOIEI — a régua da evidência, na tela. */}
            {m.papel === 'aris' && !m.erro && (
              <details style={apoio}>
                <summary style={apoioTitulo}>no que me apoiei</summary>
                <div style={{ marginTop: 6 }}>
                  <div>Os números do sistema somados agora: {m.resumo?.lancamentos} lançamentos, {m.resumo?.realizados} realizados.</div>
                  {m.apoio?.length > 0 ? (
                    <>
                      <div style={{ marginTop: 4 }}>Classificações suas que eu consultei:</div>
                      <ul style={{ margin: '3px 0 0', paddingLeft: 16 }}>
                        {m.apoio.slice(0, 6).map((h, j) => (
                          <li key={j}>
                            “{h.descricao || h.parte}” → {h.cat}{h.subcat ? ` › ${h.subcat}` : ''} ({h.vezes}x)
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <div style={{ marginTop: 4 }}>Nenhuma classificação sua parecida com esta pergunta.</div>
                  )}
                </div>
              </details>
            )}
          </div>
        ))}

        {(pensando || carregandoBase) && (
          <div style={{ ...balaoAris, color: 'var(--text-mid)' }}>
            {carregandoBase ? 'lendo os seus números…' : 'pensando…'}
          </div>
        )}
        <div ref={fim} />
      </div>

      <form
        onSubmit={e => { e.preventDefault(); enviar() }}
        style={rodape}
      >
        <input
          value={texto}
          onChange={e => setTexto(e.target.value)}
          placeholder={base ? 'Pergunte alguma coisa…' : 'carregando os seus dados…'}
          disabled={!base || pensando}
          style={campo}
          aria-label="Pergunta para a Aris"
        />
        <button type="submit" disabled={!base || pensando || !texto.trim()} style={enviarBtn}>Enviar</button>
      </form>
    </aside>
  )
}

const bolha = {
  position: 'fixed', right: 20, bottom: 20, zIndex: 300,
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
  width: 56, height: 56, borderRadius: '50%', border: 'none',
  background: 'var(--navy)', color: 'var(--gold)', cursor: 'pointer',
  boxShadow: '0 6px 18px rgba(0,32,62,0.30)', fontFamily: 'var(--body)',
}
const painel = {
  position: 'fixed', right: 16, bottom: 16, zIndex: 300,
  width: 'min(380px, calc(100vw - 32px))', maxHeight: 'min(620px, calc(100vh - 32px))',
  display: 'flex', flexDirection: 'column',
  background: 'var(--white)', border: '1px solid var(--cream-dark)', borderRadius: 12,
  boxShadow: '0 12px 36px rgba(0,32,62,0.22)', overflow: 'hidden', fontFamily: 'var(--body)',
}
const cabecalho = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
  padding: '10px 14px', background: 'var(--navy)', color: '#fff',
}
const fechar = {
  background: 'none', border: 'none', color: '#fff', fontSize: 22, lineHeight: 1,
  cursor: 'pointer', padding: '0 4px',
}
const corpo = { flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5, lineHeight: 1.5 }
const vazio = { color: 'var(--text-mid)', fontSize: 12 }
const sugestao = {
  display: 'block', width: '100%', textAlign: 'left', marginBottom: 5,
  padding: '7px 9px', borderRadius: 7, border: '1px solid var(--cream-dark)',
  background: 'var(--cream)', color: 'var(--navy)', fontFamily: 'var(--body)',
  fontSize: 11.5, cursor: 'pointer',
}
const balaoVoce = {
  alignSelf: 'flex-end', maxWidth: '88%', padding: '7px 10px', borderRadius: '10px 10px 2px 10px',
  background: 'var(--navy)', color: '#fff',
}
const balaoAris = {
  alignSelf: 'flex-start', maxWidth: '94%', padding: '8px 10px', borderRadius: '10px 10px 10px 2px',
  background: 'var(--cream)', color: 'var(--navy)', border: '1px solid var(--cream-dark)',
}
const apoio = { marginTop: 7, borderTop: '1px dashed var(--cream-dark)', paddingTop: 6, fontSize: 10.5, color: 'var(--text-mid)' }
const apoioTitulo = { cursor: 'pointer', fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', fontSize: 9.5 }
const rodape = { display: 'flex', gap: 6, padding: 10, borderTop: '1px solid var(--cream-dark)', background: 'var(--white)' }
const campo = {
  flex: 1, padding: '8px 10px', border: '1.5px solid var(--cream-dark)', borderRadius: 7,
  fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', outline: 'none', minWidth: 0,
}
const enviarBtn = {
  padding: '8px 13px', borderRadius: 7, border: 'none', background: 'var(--navy)',
  color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
}
