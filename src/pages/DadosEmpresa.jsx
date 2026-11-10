import { useCallback, useEffect, useState } from 'react'
import AppLayout from '../components/AppLayout'
import EstadoErro from '../components/EstadoErro'
import { showToast } from '../components/Toast'
import CampoData from '../components/CampoData'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { msgErro } from '../lib/erros'
import { maskDocumento, maskTelefone, maskCEP } from '../lib/mascaras'
import { consultarCnpjNaReceita } from '../lib/receitaCnpj'

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
  const [buscando, setBuscando] = useState(false)
  const [avisoCnpj, setAvisoCnpj] = useState(null)

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

  // ── AS CONTAS DE RECEBIMENTO ──────────────────────────────────────────
  //
  // São uma lista, e não um conjunto de quatro campos: a empresa pode receber
  // em mais de uma conta, e a conta que vai na proposta não é sempre a mesma
  // que vai no boleto.
  //
  // O formato antigo — banco, agência, conta e pix soltos no registro — é lido
  // como a primeira conta da lista. Nada do que já foi preenchido se perde.
  const contas = Array.isArray(d.contas_recebimento)
    ? d.contas_recebimento
    : (d.banco || d.agencia || d.conta || d.pix
      ? [{ banco: d.banco || '', agencia: d.agencia || '', conta: d.conta || '', pix: d.pix || '' }]
      : [])

  function mudarConta(i, chave, valor) {
    const lista = contas.map((c, j) => (j === i ? { ...c, [chave]: valor } : c))
    setD(prev => ({ ...prev, contas_recebimento: lista }))
  }
  function novaConta() {
    setD(prev => ({
      ...prev,
      contas_recebimento: [...contas, { banco: '', agencia: '', conta: '', pix: '' }],
    }))
  }
  function removerConta(i) {
    setD(prev => ({ ...prev, contas_recebimento: contas.filter((_, j) => j !== i) }))
  }

  // ── A CONSULTA À RECEITA ──────────────────────────────────────────────
  //
  // A mesma do cadastro de pessoa. A tela pedia o CNPJ e não oferecia a busca:
  // a mesma informação, digitada à mão aqui e buscada lá.
  async function buscarNaReceita() {
    setBuscando(true)
    setAvisoCnpj(null)
    try {
      const r = await consultarCnpjNaReceita(d.cnpj)
      if (r.estado !== 'confirmado') {
        // "Não existe" e "não consegui perguntar" são coisas diferentes, e a
        // tela diz qual das duas foi.
        setAvisoCnpj({ tipo: r.estado, texto: r.detalhe })
        return
      }
      setD(prev => ({
        ...prev,
        razao_social: r.dados.razao_social || prev.razao_social || '',
        nome_fantasia: r.dados.nome_fantasia || prev.nome_fantasia || '',
        logradouro: r.dados.logradouro || prev.logradouro || '',
        bairro: r.dados.bairro || prev.bairro || '',
        cidade: r.dados.cidade || prev.cidade || '',
        uf: r.dados.uf || prev.uf || '',
        cep: r.dados.cep || prev.cep || '',
        telefone: r.dados.telefone || prev.telefone || '',
        situacao_cadastral: r.dados.situacao || '',
        validado_em: new Date().toISOString().slice(0, 10),
      }))
      setAvisoCnpj({
        tipo: r.dados.ativa ? 'confirmado' : 'atencao',
        texto: r.dados.ativa
          ? 'Dados preenchidos. Situação na Receita: ATIVA.'
          : `Dados preenchidos. Situação na Receita: ${r.dados.situacao || 'não informada'}.`,
      })
    } finally { setBuscando(false) }
  }

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
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={maskDocumento(campo('cnpj'))}
                    onChange={e => { mudar('cnpj', e.target.value); setAvisoCnpj(null) }}
                    style={{ ...input, flex: 1 }}
                  />
                  <button
                    type="button" onClick={buscarNaReceita}
                    disabled={buscando || String(campo('cnpj')).replace(/\D/g, '').length !== 14}
                    style={btnReceita}
                  >
                    {buscando ? 'Consultando…' : 'Buscar na Receita'}
                  </button>
                </div>
                {avisoCnpj && (
                  <div style={{
                    ...dica,
                    color: avisoCnpj.tipo === 'inexistente' ? 'var(--red)'
                      : avisoCnpj.tipo === 'confirmado' ? 'var(--green)' : 'var(--gold-dark)',
                    fontWeight: 600,
                  }}>
                    {avisoCnpj.texto}
                  </div>
                )}
                <Dica>
                  É por ele que o portão de entrada decide se um documento é da empresa. Sem ele,
                  o portão não acusa documento nenhum.
                </Dica>
                {campo('validado_em') && (
                  <Dica>
                    Conferido na Receita em {String(campo('validado_em')).split('-').reverse().join('/')}
                    {campo('situacao_cadastral') ? ` · situação ${campo('situacao_cadastral')}` : ''}.
                  </Dica>
                )}
              </Campo>
              {/* O campo "Razão social anterior" foi removido em 10/11/2026.
                  Pergunta dela: "pra que serve, se busca sempre pelo CNPJ?".
                  Não serve. Nenhuma rotina lê, e não faria diferença se lesse:
                  a mudança de razão social manteve o CNPJ, e é por ele que a
                  empresa é identificada em todo lugar. Como anotação também não
                  se sustentava — ela sabe o nome anterior da própria empresa. */}
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

          <Bloco titulo="Contas de recebimento">
            {contas.length === 0 ? (
              <Dica>Nenhuma conta cadastrada.</Dica>
            ) : contas.map((c, i) => (
              <Linha key={i}>
                <Campo rotulo={contas.length > 1 ? `Banco · conta ${i + 1}` : 'Banco'}>
                  <input value={c.banco || ''} onChange={e => mudarConta(i, 'banco', e.target.value)} style={input} />
                </Campo>
                <Campo rotulo="Agência" flex="0 1 130px">
                  <input value={c.agencia || ''} onChange={e => mudarConta(i, 'agencia', e.target.value)} style={input} />
                </Campo>
                <Campo rotulo="Conta" flex="0 1 170px">
                  <input value={c.conta || ''} onChange={e => mudarConta(i, 'conta', e.target.value)} style={input} />
                </Campo>
                <Campo rotulo="Chave Pix" flex="2 1 240px">
                  <input value={c.pix || ''} onChange={e => mudarConta(i, 'pix', e.target.value)} style={input} />
                </Campo>
                <div style={{ flex: '0 0 auto', paddingTop: 22 }}>
                  <button
                    type="button" onClick={() => removerConta(i)}
                    title="Remover esta conta" aria-label="Remover esta conta"
                    style={btnRemover}
                  >×</button>
                </div>
              </Linha>
            ))}
            <button type="button" onClick={novaConta} style={btnAdicionar}>+ Adicionar conta</button>
            <Dica>
              Usadas em documentos que a empresa emite. Não têm efeito sobre conciliação: as contas
              que o sistema concilia ficam em Contas e Cartões.
            </Dica>
          </Bloco>

          <Bloco titulo="Entrada de documentos">
            <Linha>
              <Campo rotulo="E-mail de entrada" flex="2 1 280px">
                <input value={campo('email_entrada')} onChange={e => mudar('email_entrada', e.target.value)} style={input} />
                <Dica>Destinatário que o robô lê para importar os documentos.</Dica>
              </Campo>
              <Campo rotulo="Documentos a partir de">
                <CampoData value={campo('documentos_desde')} onChange={v => mudar('documentos_desde', v)} />
                <Dica>
                  Documento emitido antes desta data é descartado na entrada e fica na trilha, sem
                  virar ficha na Caixa de entrada.
                </Dica>
              </Campo>
            </Linha>
            {/* O VALOR ANTERIOR DA DATA DE CORTE NÃO APARECE AQUI.
                Ele continua gravado no registro, porque é histórico barato de
                guardar. Mas na tela não respondia a pergunta de ninguém: saber
                que a data era outra em maio não muda decisão nenhuma de quem
                está configurando o sistema agora. Pergunta dela, 10/11/2026:
                "pra que importa, no sistema, a informação de que era 01/05 e
                foi alterado em 06/11? pq e pra quem?" — e eu não tinha
                resposta. Onde a informação serve é na trilha do documento
                descartado, que já diz contra qual data ele foi medido. */}
          </Bloco>

          {/* O BLOCO "MARCA" FOI REMOVIDO EM 10/11/2026.
              Ele tinha um campo de endereço do logo, com a dica "usado nos
              relatórios em PDF". Verificado a pedido dela: NENHUM relatório lê
              esse campo. Era campo escrito e nunca lido — o mesmo defeito que
              a auditoria do dia anterior encontrou em três lugares — e com
              uma promessa falsa escrita embaixo.
              O logo volta quando houver quem o use: a emissão de NFS-e ou um
              relatório com marca. Enquanto isso, pedir o dado é pedir trabalho
              que não serve para nada. */}

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
const btnReceita = {
  padding: '0 14px', borderRadius: 6, border: 'none', background: 'var(--navy)',
  color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700,
  cursor: 'pointer', whiteSpace: 'nowrap',
}
const btnAdicionar = {
  padding: '6px 12px', borderRadius: 6, border: '1px solid var(--cream-dark)',
  background: 'var(--white)', color: 'var(--navy)', fontFamily: 'var(--body)',
  fontSize: 11.5, fontWeight: 700, cursor: 'pointer', marginTop: 2,
}
const btnRemover = {
  background: 'none', border: 'none', color: 'var(--text-mid)',
  fontSize: 20, lineHeight: 1, cursor: 'pointer', padding: '0 4px',
}
const rodape = {
  fontSize: 11.5, color: 'var(--text-mid)', lineHeight: 1.7, padding: '4px 2px 20px',
}
const vazio = {
  background: 'var(--white)', border: '1px solid var(--cream-dark)', borderRadius: 10,
  padding: '40px 24px', textAlign: 'center', fontSize: 13, color: 'var(--text-mid)',
}
