// =============================================================================
// O cartão do PRÓXIMO PASSO.
//
// Uma frase no imperativo, o porquê em uma linha, e um botão. Nada mais.
//
// A tentação é listar as dez pendências do mês — e é exatamente isso que faz
// a pessoa olhar a tela e não saber por onde começar. O fechamento é
// cronológico: só um mês pode ser o próximo, e dentro dele só o primeiro item
// obrigatório importa. O resto aparece quando chegar a vez dele.
// =============================================================================
import { Link } from 'react-router-dom'

export default function ProximoPasso({ passo, loading }) {
  if (loading) return null

  if (!passo) {
    return (
      <div style={{ ...caixa, borderLeftColor: 'var(--green)' }}>
        <div style={rotulo}>Próximo passo</div>
        <div style={{ ...titulo, color: 'var(--green)' }}>Nada em aberto. Os meses anteriores estão fechados.</div>
      </div>
    )
  }

  return (
    <div style={{ ...caixa, borderLeftColor: passo.pronto ? 'var(--green)' : 'var(--gold-dark)' }}>
      <div style={rotulo}>Próximo passo</div>
      <div style={titulo}>{passo.titulo}</div>

      {passo.detalhe && <div style={detalhe}>{passo.detalhe}</div>}
      {passo.porque && <div style={porque}>Por quê: {passo.porque}.</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
        <Link to={passo.link} style={botao}>{passo.botao} →</Link>
        {passo.restantes > 0 && (
          <span style={{ fontSize: 11.5, color: 'var(--text-mid)' }}>
            depois deste, faltam mais {passo.restantes} item(ns) obrigatório(s) neste mês
          </span>
        )}
      </div>
    </div>
  )
}

const caixa = {
  background: 'var(--white)',
  border: '1px solid var(--cream-dark)',
  borderLeft: '4px solid var(--gold-dark)',
  borderRadius: 10,
  padding: '16px 18px',
  marginBottom: 18,
  boxShadow: 'var(--shadow)',
}
const rotulo = { fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--text-mid)', marginBottom: 6 }
const titulo = { fontSize: 17, fontWeight: 700, color: 'var(--navy)', lineHeight: 1.35, fontFamily: 'var(--heading, var(--body))' }
const detalhe = { fontSize: 13, color: 'var(--navy)', marginTop: 5 }
const porque = { fontSize: 11.5, color: 'var(--text-mid)', marginTop: 3, lineHeight: 1.5 }
const botao = {
  display: 'inline-block', padding: '9px 18px', borderRadius: 7,
  background: 'var(--navy)', color: '#fff', textDecoration: 'none',
  fontSize: 12.5, fontWeight: 700, fontFamily: 'var(--body)', whiteSpace: 'nowrap',
}
