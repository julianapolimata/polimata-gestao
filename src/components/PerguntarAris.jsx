// =============================================================================
// "ARIS, O QUE É ISSO?" — a sugestão que vem com a prova junto.
//
// A Juliana olhou "DÉB. SEGURO PRESTAMISTA" e disse: "eu não tenho ideia de
// como classificar isso". São 82 descrições distintas esperando, contra 81
// subcategorias no plano — e é aí que o fechamento emperra.
//
// A tela segue a régua que ela mesma cobrou de mim quando eu dei um parecer
// bonito e errado: nada de resposta solta. Toda sugestão aparece com a
// EVIDÊNCIA ao lado, para que "tem certeza?" se responda olhando, não
// confiando.
//
// Por isso o cartão mostra, nesta ordem:
//   • de onde veio (histórico dela ou raciocínio da Aris) — dito com todas as
//     letras, porque as duas coisas não valem o mesmo;
//   • a evidência: quantas vezes, quando, e o que está no plano;
//   • a confiança, e o que faltaria confirmar quando ela é baixa.
//
// E o botão é "Usar esta sugestão": a Aris propõe, quem classifica é ela.
// =============================================================================
import { useState } from 'react'
import { perguntar } from '../lib/arisCliente'
import { ROTULO_CONFIANCA } from '../lib/aris'
import { msgErro } from '../lib/erros'

const CORES = {
  alta: { bg: 'rgba(39,174,96,0.10)', borda: 'rgba(39,174,96,0.40)', cor: 'var(--green)' },
  media: { bg: 'rgba(204,145,94,0.10)', borda: 'rgba(204,145,94,0.40)', cor: 'var(--gold-dark)' },
  baixa: { bg: 'rgba(29,59,92,0.07)', borda: 'var(--cream-dark)', cor: 'var(--text-mid)' },
}

export default function PerguntarAris({ descricao, parte, valor, tipo, plano, historico, onUsar }) {
  const [carregando, setCarregando] = useState(false)
  const [r, setR] = useState(null)
  const [erro, setErro] = useState('')

  async function consultar() {
    setCarregando(true); setErro(''); setR(null)
    try {
      setR(await perguntar({ descricao, parte, valor, tipo, plano, historico }))
    } catch (e) {
      setErro(msgErro(e, 'Não consegui falar com a Aris agora.'))
    } finally {
      setCarregando(false)
    }
  }

  if (!r && !erro) {
    return (
      <button type="button" onClick={consultar} disabled={carregando || !descricao} style={botaoPerguntar}>
        {carregando ? 'Aris está vendo…' : '✦ Aris, o que é isso?'}
      </button>
    )
  }

  if (erro) {
    return (
      <div style={{ ...cartao, ...CORES.baixa }}>
        <div style={{ color: 'var(--red)' }}>{erro}</div>
        <button type="button" onClick={consultar} style={botaoLink}>tentar de novo</button>
      </div>
    )
  }

  const cor = CORES[r.confianca] || CORES.baixa
  const achou = !!r.cat

  return (
    <div style={{ ...cartao, background: cor.bg, borderColor: cor.borda }}>
      <div style={cabecalho}>
        <span style={{ fontWeight: 700, color: 'var(--navy)' }}>✦ Aris</span>
        {/* De onde veio importa mais que o que veio: decisão anterior dela e
            raciocínio da Aris não valem o mesmo, e a tela não pode achatar
            os dois na mesma frase. */}
        <span style={{ ...etiqueta, color: cor.cor }}>
          {r.fonte === 'historico' ? 'Pelo seu histórico' : r.fonte === 'aris' ? 'Raciocínio da Aris' : 'Sem sugestão'}
        </span>
        <span style={{ ...etiqueta, color: cor.cor, marginLeft: 'auto' }}>{ROTULO_CONFIANCA[r.confianca]}</span>
      </div>

      {achou ? (
        <div style={sugestao}>{r.cat}{r.subcat ? ` › ${r.subcat}` : ''}</div>
      ) : (
        <div style={{ ...sugestao, color: 'var(--text-mid)', fontWeight: 600 }}>Não sei dizer.</div>
      )}

      {r.porque && <div style={texto}>{r.porque}</div>}

      {/* A EVIDÊNCIA. É o que torna a resposta conferível em vez de confiável. */}
      {r.evidencias?.length > 0 && (
        <ul style={listaEvidencia}>
          {r.evidencias.map((e, i) => <li key={i} style={itemEvidencia}>{e}</li>)}
        </ul>
      )}

      {r.faltaSaber && (
        <div style={{ ...texto, fontStyle: 'italic' }}>
          <strong>Para ter certeza:</strong> {r.faltaSaber}
        </div>
      )}

      {/* Mais de uma classificação no histórico significa que ela própria
          decidiu diferente em momentos diferentes. Mostrar as duas é mais
          honesto que escolher uma e calar a outra. */}
      {r.candidatos?.length > 1 && (
        <div style={texto}>
          <strong>Você já usou mais de uma para isto:</strong>{' '}
          {r.candidatos.slice(0, 3).map(c => `${c.cat}${c.subcat ? ` › ${c.subcat}` : ''} (${c.vezes}x)`).join(' · ')}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {achou && (
          <button type="button" onClick={() => onUsar?.(r.cat, r.subcat)} style={botaoUsar}>
            Usar esta sugestão
          </button>
        )}
        <button type="button" onClick={consultar} disabled={carregando} style={botaoLink}>
          {carregando ? 'perguntando…' : 'perguntar de novo'}
        </button>
      </div>
    </div>
  )
}

const botaoPerguntar = {
  padding: '6px 11px', borderRadius: 6, border: '1px solid var(--gold-dark)',
  background: 'var(--white)', color: 'var(--gold-dark)', fontFamily: 'var(--body)',
  fontSize: 11.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
}
const cartao = {
  border: '1px solid var(--cream-dark)', borderRadius: 8, padding: '10px 12px',
  marginTop: 8, fontSize: 11.5, lineHeight: 1.5, color: 'var(--navy)',
}
const cabecalho = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }
const etiqueta = { fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }
const sugestao = { fontSize: 13, fontWeight: 700, color: 'var(--navy)', marginBottom: 4 }
const texto = { marginTop: 4 }
const listaEvidencia = { margin: '6px 0 0', paddingLeft: 16 }
const itemEvidencia = { marginBottom: 2 }
const botaoUsar = {
  padding: '6px 12px', borderRadius: 6, border: 'none', background: 'var(--navy)',
  color: '#fff', fontFamily: 'var(--body)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
}
const botaoLink = {
  background: 'none', border: 'none', padding: '6px 2px', color: 'var(--text-mid)',
  fontFamily: 'var(--body)', fontSize: 11.5, cursor: 'pointer', textDecoration: 'underline',
}
