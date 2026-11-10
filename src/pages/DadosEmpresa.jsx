import { useCallback, useEffect, useState } from 'react'
import AppLayout from '../components/AppLayout'
import EstadoErro from '../components/EstadoErro'
import { showToast } from '../components/Toast'
import CampoData from '../components/CampoData'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { msgErro } from '../lib/erros'
import { maskDocumento, maskTelefone, maskCEP } from '../lib/mascaras'

// =============================================================================
// DADOS DA EMPRESA (B6.1).
//
// Até 09/11/2026 a configuração da empresa existia, mas espalhada: o CNPJ era
// gravado por um script, o e-mail de entrada por um campo escondido dentro da
// Caixa de entrada, e a data de corte só por consulta ao banco. Não havia
// lugar para olhar e dizer "é isto que o sistema sabe sobre a empresa".
//
// O QUE NÃO ESTÁ AQUI, de propósito: os dados fiscais de emissão — inscrição
// municipal, CNAE, item da lista de serviço, alíquota de ISS. Eles já têm
// tela própria (Configuração de NFS-e) e duplicar o campo é duplicar a fonte.
//
// O NOME ANTERIOR tem função, não é nostalgia: a razão social antiga aparece
// em documentos de 2023 a 2025 e em guias antigas. Registrada aqui, ela
// explica por que um documento em nome de "Juliana Cristina Carolino Apoio
// Adm" é da mesma empresa — e evita abrir uma ressalva de titularidade que
// não existe.
// =============================================================================
export default function DadosEmpresa() {
  const { user } = useAuth()
  const [linhaId, setLinhaId] = useState(null)
  const [d, setD] = useState({})
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    supabase.from('config_empresa').select('id, data').limit(1)
      .then(({ data, error }) => {
        if (error) { setErro(error); setLoading(false); return }
        setErro(null)
        setLinhaId(data?.[0]?.id || null)
        setD(data?.[0]?.data || {})
        setLoading(false)
      })
  }, [user])

  useEffect(() => { carregar() }, [carregar])

  const campo = (k) => d[k] ?? ''
  const mudar = (k, v) => setD(prev => ({ ...prev, [k]: v }))

  async function salvar() {
    if (!user) { showToast('Sessão expirada.', 'error'); return }
    setSalvando(true)
    try {
      const limpo = {
        ...d,
        cnpj: String(d.cnpj || '').replace(/\D/g, ''),
        atualizado_em: new Date().toISOString().slice(0, 10),
      }
      const { error } = linhaId
        ? await supabase.from('config_empresa').update({ data: limpo }).eq('id', linhaId)
        : await supabase.from('config_empresa').insert({ user_id: user.id, data: limpo })
      if (error) throw error
      showToast('Dados da empresa salvos.', 'success')
      carregar()
    } catch (e) {
      showToast(msgErro(e, 'Não foi possível salvar os dados da empresa.'), 'error')
    } finally { setSalvando(false) }
  }

  if (erro) {
    return <AppLayout title="Dados da empresa"><EstadoErro erro={erro} onTentarDeNovo={carregar} /></AppLayout>
  }

  return (
    <AppLayout
      title="Dados da empresa"
      stickyTop={(
        <div style={barra}>
          <div style={aviso}>
            O que o sistema sabe sobre a empresa. O CNPJ daqui é o que decide
            a <strong>titularidade</strong> dos documentos que chegam por e-mail.
          </div>
          <button onClick={salvar} disabled={salvando || loading} style={btnSalvar}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      )}
    >
      {loading ? <div style={vazio}>Carregando…</div> : (
        <>
          <Bloco titulo="Identificação">
            <Linha>
              <Campo rotulo="Razão social" flex="2 1 320px">
                <input value={campo('razao_social')} onChange={e => mudar('razao_social', e.target.value)} style={input} />
              </Campo>
              <Campo rotulo="Nome fantasia">
                <input value={campo('nome_fantasia')} onChange={e => mudar('nome_fantasia', e.target.value)} style={input} />
              </Campo>
            </Linha>
            <Linha>
              <Campo rotulo="CNPJ">
                <input
                  value={maskDocumento(campo('cnpj'))}
                  onChange={e => mudar('cnpj', e.target.value)}
                  style={input}
                />
                <Dica>
                  É por ele que o portão de entrada decide se um documento é da empresa. Sem ele,
                  o portão não acusa documento nenhum.
                </Dica>
              </Campo>
              <Campo rotulo="Razão social anterior" flex="2 1 320px">
                <input value={campo('razao_social_anterior')} onChange={e => mudar('razao_social_anterior', e.target.value)} style={input} />
                <Dica>
                  Aparece em documentos e guias antigos. Registrada aqui, explica por que um
                  documento em outro nome é da mesma empresa.
                </Dica>
              </Campo>
            </Linha>
          </Bloco>

          <Bloco titulo="Endereço">
            <Linha>
              <Campo rotulo="Logradouro e número" flex="3 1 320px">
                <input value={campo('logradouro')} onChange={e => mudar('logradouro', e.target.value)} style={input} />
              </Campo>
              <Campo rotulo="Bairro">
                <input value={campo('bairro')} onChange={e => mudar('bairro', e.target.value)} style={input} />
              </Campo>
            </Linha>
            <Linha>
              <Campo rotulo="Cidade" flex="2 1 200px">
                <input value={campo('cidade')} onChange={e => mudar('cidade', e.target.value)} style={input} />
              </Campo>
              <Campo rotulo="UF" flex="0 1 90px">
                <input value={campo('uf')} onChange={e => mudar('uf', e.target.value.toUpperCase().slice(0, 2))} style={input} />
              </Campo>
              <Campo rotulo="CEP">
                <input value={maskCEP(campo('cep'))} onChange={e => mudar('cep', e.target.value)} style={input} />
              </Campo>
              <Campo rotulo="Telefone">
                <input value={maskTelefone(campo('telefone'))} onChange={e => mudar('telefone', e.target.value)} style={input} />
              </Campo>
            </Linha>
          </Bloco>

          <Bloco titulo="Dados bancários">
            <Linha>
              <Campo rotulo="Banco">
                <input value={campo('banco')} onChange={e => mudar('banco', e.target.value)} style={input} />
              </Campo>
              <Campo rotulo="Agência" flex="0 1 140px">
                <input value={campo('agencia')} onChange={e => mudar('agencia', e.target.value)} style={input} />
              </Campo>
              <Campo rotulo="Conta" flex="0 1 180px">
                <input value={campo('conta')} onChange={e => mudar('conta', e.target.value)} style={input} />
              </Campo>
              <Campo rotulo="Chave Pix" flex="2 1 260px">
                <input value={campo('pix')} onChange={e => mudar('pix', e.target.value)} style={input} />
              </Campo>
            </Linha>
            <Dica>
              Usados em documentos que a empresa emite. Não têm efeito sobre conciliação: as contas
              que o sistema concilia ficam em Contas bancárias.
            </Dica>
          </Bloco>

          <Bloco titulo="Entrada de documentos">
            <Linha>
              <Campo rotulo="E-mail de entrada" flex="2 1 280px">
                <input value={campo('email_entrada')} onChange={e => mudar('email_entrada', e.target.value)} style={input} />
                <Dica>Caixa que o robô lê para trazer as notas.</Dica>
              </Campo>
              <Campo rotulo="Documentos a partir de">
                <CampoData value={campo('documentos_desde')} onChange={v => mudar('documentos_desde', v)} />
                <Dica>
                  Documento emitido antes desta data é descartado na entrada e fica na trilha, sem
                  virar ficha na Caixa de entrada.
                </Dica>
              </Campo>
            </Linha>
            {campo('documentos_desde_anterior') && (
              <Dica>
                Antes era {String(campo('documentos_desde_anterior')).split('-').reverse().join('/')}
                {campo('documentos_desde_alterado_em')
                  ? `, alterado em ${String(campo('documentos_desde_alterado_em')).split('-').reverse().join('/')}`
                  : ''}.
              </Dica>
            )}
          </Bloco>

          <Bloco titulo="Marca">
            <Linha>
              <Campo rotulo="Endereço do logo" flex="1 1 100%">
                <input value={campo('logo_url')} onChange={e => mudar('logo_url', e.target.value)} placeholder="https://…" style={input} />
                <Dica>Usado nos relatórios em PDF.</Dica>
              </Campo>
            </Linha>
          </Bloco>

          <div style={rodape}>
            Os dados fiscais de emissão — inscrição municipal, CNAE, item da lista de serviço e
            alíquota de ISS — ficam em <strong>Configuração de NFS-e</strong>, e não são repetidos aqui.
            {campo('atualizado_em') && (
              <> Última alteração em {String(campo('atualizado_em')).split('-').reverse().join('/')}.</>
            )}
          </div>
        </>
      )}
    </AppLayout>
  )
}

function Bloco({ titulo, children }) {
  return (
    <section style={bloco}>
      <h2 style={blocoTitulo}>{titulo}</h2>
      {children}
    </section>
  )
}
function Linha({ children }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 10 }}>{children}</div>
}
function Campo({ rotulo, children, flex = '1 1 200px' }) {
  return (
    <div style={{ flex, minWidth: 0 }}>
      <div style={rotuloEstilo}>{rotulo}</div>
      {children}
    </div>
  )
}
function Dica({ children }) {
  return <div style={dica}>{children}</div>
}

const barra = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  gap: 12, marginBottom: 14, flexWrap: 'wrap',
}
const aviso = {
  flex: '1 1 320px', fontSize: 12, color: 'var(--navy-mid)', lineHeight: 1.55,
}
const btnSalvar = {
  padding: '9px 20px', borderRadius: 7, border: 'none', background: 'var(--gold-dark)',
  color: '#fff', fontFamily: 'var(--body)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
}
const bloco = {
  background: 'var(--white)', border: '1px solid var(--cream-dark)',
  borderRadius: 10, padding: '16px 18px', marginBottom: 14,
}
const blocoTitulo = {
  fontFamily: 'var(--body)', fontSize: 9.5, fontWeight: 700, letterSpacing: 1.6,
  textTransform: 'uppercase', color: 'var(--navy)', margin: '0 0 14px',
}
const rotuloEstilo = {
  fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
  color: 'var(--text-mid)', marginBottom: 6, fontFamily: 'var(--body)',
}
const input = {
  width: '100%', padding: '9px 12px', border: '1.5px solid var(--cream-dark)',
  borderRadius: 6, fontFamily: 'var(--body)', fontSize: 13, color: 'var(--navy)',
  background: 'var(--white)', outline: 'none', boxSizing: 'border-box',
}
const dica = { fontSize: 10.5, color: 'var(--text-mid)', marginTop: 4, lineHeight: 1.5 }
const rodape = {
  fontSize: 11.5, color: 'var(--text-mid)', lineHeight: 1.7, padding: '4px 2px 20px',
}
const vazio = {
  background: 'var(--white)', border: '1px solid var(--cream-dark)', borderRadius: 10,
  padding: '40px 24px', textAlign: 'center', fontSize: 13, color: 'var(--text-mid)',
}
