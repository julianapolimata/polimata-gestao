import { Component } from 'react'

// =============================================================================
// ErrorBoundary global — captura erros de render que silenciariam a tela.
// Mostra a stack do erro pra você nos enviar pra mim debugar.
// =============================================================================

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info)
    this.setState({ info })
  }

  resetar = () => {
    this.setState({ error: null, info: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={wrap}>
        <div style={card}>
          <div style={emoji}>💥</div>
          <h1 style={title}>Algo deu errado nesta tela</h1>
          <p style={subtitle}>
            A tela quebrou ao renderizar. Me manda essa mensagem que eu conserto.
          </p>
          <div style={stackBox}>
            <div style={stackLabel}>Erro:</div>
            <pre style={stackPre}>{String(this.state.error?.message || this.state.error)}</pre>
            {this.state.error?.stack && (
              <>
                <div style={{ ...stackLabel, marginTop: 12 }}>Onde:</div>
                <pre style={stackPre}>{this.state.error.stack.split('\n').slice(0, 6).join('\n')}</pre>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'center' }}>
            <button onClick={this.resetar} style={btnGold}>↻ Tentar de novo</button>
            <button onClick={() => { window.location.href = '/dashboard' }} style={btnNavy}>Voltar pro Painel</button>
          </div>
        </div>
      </div>
    )
  }
}

const wrap = {
  minHeight: '100vh', background: 'var(--cream)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
  fontFamily: 'var(--body)',
}
const card = {
  background: 'var(--white)', borderRadius: 12, padding: 36,
  maxWidth: 720, width: '100%',
  boxShadow: '0 20px 60px rgba(0,0,0,0.10)',
  border: '1px solid var(--cream-dark)', textAlign: 'center',
}
const emoji = { fontSize: 48, marginBottom: 12 }
const title = { fontSize: 24, fontWeight: 600, color: 'var(--navy)', fontFamily: 'var(--display)', marginBottom: 8 }
const subtitle = { fontSize: 13, color: 'var(--text-mid)', maxWidth: 480, margin: '0 auto 24px', lineHeight: 1.5 }
const stackBox = {
  background: 'var(--cream)', borderRadius: 8, padding: 16,
  textAlign: 'left', maxHeight: 320, overflow: 'auto',
  border: '1px solid var(--cream-dark)',
}
const stackLabel = { fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)', marginBottom: 6 }
const stackPre = { fontFamily: 'monospace', fontSize: 11, color: 'var(--red)', whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.5 }
const btnGold = { padding: '10px 20px', borderRadius: 6, border: 'none', background: 'var(--gold)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5, textTransform: 'uppercase' }
const btnNavy = { padding: '10px 20px', borderRadius: 6, border: '1.5px solid var(--navy)', background: 'transparent', color: 'var(--navy)', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5, textTransform: 'uppercase' }
