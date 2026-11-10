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
import { rotuloBanco } from '../lib/bancosBacen'

// =============================================================================
// DADOS DA EMPRESA (B6.1).
//
// Até 09/11/2026 a configuração da empresa existia, mas espalhada: o CNPJ era
// gravado por um script, o e-mail de entrada por um campo escondido dentro da
// Caixa de entrada, e a data de corte só por consulta ao banco. Não havia
// lugar para olhar e dizer "é isto que o sistema sabe sobre a empresa".
//
// ── POR QUE OS DADOS FISCAIS VOLTARAM PARA CÁ ─────────────────────────────
//
// Até 10/11/2026 a inscrição municipal, o CNAE, o município do ISS e o regime
// tributário ficavam só na Configuração de NFS-e, e esta tela trazia um aviso
// no rodapé mandando procurar lá. Pergunta dela, no primeiro uso: "n deveria
// ficar td na mesma página, e dps o sistema só buscar na tela do cadastro?".
//
// Deveria. Quem está cadastrando a empresa está cadastrando a empresa inteira,
// e não tem como saber que metade da ficha mora numa tela chamada NFS-e. A
// divisão fazia sentido para quem escreveu o sistema (duas tabelas), nunca
// para quem o usa.
//
// O corte agora é por natureza do dado, não por tabela:
//   • o que DESCREVE a empresa  → aqui (inscrição municipal, CNAE, município
//     do ISS, regime tributário, optante do Simples);
//   • o que PARAMETRIZA a nota  → Configuração de NFS-e (ambiente, item da
//     lista de serviço, alíquota de ISS, ISS retido, modelos de texto).
//
// O dado NÃO foi copiado: ele continua morando em nfse_config, que é de onde
// o Simples Nacional já lê. Esta tela passou a ser o lugar de digitá-lo. Um
// campo, uma fonte — que é exatamente o contrário de duplicar.
//
// O NOME ANTERIOR tem função, não é nostalgia: a razão social antiga aparece
// em documentos de 2023 a 2025 e em guias antigas. Registrada aqui, ela
// explica por que um documento em nome de "Juliana Cristina Carolino Apoio
// Adm" é da mesma empresa — e evita abrir uma ressalva de titularidade que
// não existe.
// =============================================================================
// Os mesmos regimes da Configuração de NFS-e: a lista é da empresa, e não
// do formulário que por acaso a mostrava primeiro.
const REGIMES = ["Simples Nacional - ME/EPP", "MEI", "Regime Normal"]

export default function DadosEmpresa() {
  const { user } = useAuth()
  const [linhaId, setLinhaId] = useState(null)
  const [d, setD] = useState({})
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [avisoCnpj, setAvisoCnpj] = useState(null)
  // A ficha fiscal mora em nfse_config. Esta tela edita; não copia.
  const [fiscal, setFiscal] = useState({})
  const [fiscalId, setFiscalId] = useState(null)
  // As contas moram em contas_bancarias. Esta tela mostra e marca quais são
  // usadas em documentos; cadastrar e corrigir é em Contas e Cartões.
  const [contasBanco, setContasBanco] = useState([])
  const [usoOriginal, setUsoOriginal] = useState({})

  const carregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    Promise.all([
      supabase.from('config_empresa').select('id, data').limit(1),
      supabase.from('nfse_config').select('id, data').limit(1),
      supabase.from('contas_bancarias').select('id, data').order('created_at', { ascending: true }),
    ]).then(([rEmp, rFis, rCtas]) => {
      // A ficha fiscal pode não existir ainda, e isso não é erro: só erro da
      // tabela da empresa impede a tela de abrir.
      if (rEmp.error) { setErro(rEmp.error); setLoading(false); return }
      setErro(null)
      setLinhaId(rEmp.data?.[0]?.id || null)
      setD(rEmp.data?.[0]?.data || {})
      setFiscalId(rFis.data?.[0]?.id || null)
      setFiscal(rFis.data?.[0]?.data || {})
      // Cartão de crédito não recebe: a lista aqui é só de contas.
      const ctas = (rCtas.data || []).filter(c => c.data?.tipo !== 'cartao')
      setContasBanco(ctas)
      setUsoOriginal(Object.fromEntries(ctas.map(c => [c.id, c.data?.usar_em_documentos === true])))
      setLoading(false)
    })
  }, [user])

  useEffect(() => { carregar() }, [carregar])


  const campo = (k) => d[k] ?? ''
  const mudar = (k, v) => setD(prev => ({ ...prev, [k]: v }))
  const fis = (k) => fiscal[k] ?? ''
  const mudarFiscal = (k, v) => setFiscal(prev => ({ ...prev, [k]: v }))

  // ── AS CONTAS DE RECEBIMENTO ──────────────────────────────────────────
  //
  // Esta tela chegou a cadastrar banco, agência, conta e chave Pix. Era um
  // segundo cadastro da mesma conta: a corrente do Sicoob já estava em Contas
  // e Cartões, com a mesma agência e o mesmo número, e foi digitada duas
  // vezes. Quem viu foi ela, 10/11/2026: "achei duplicidade... o cadastro da
  // conta acontece tanto nos dados da empresa, qto na aba contas e cartões".
  //
  // Estava certa, e o agravante é meu: eu tinha visto as duas telas e escrito
  // aqui uma dica explicando a separação, em vez de tratá-la como o que era.
  //
  // Agora a conta tem um lugar só, que é Contas e Cartões — inclusive a chave
  // Pix, que é dado bancário. O que esta tela faz é MARCAR quais dessas
  // contas aparecem em documentos que a empresa emite, porque isso é uso, e
  // uso é assunto da ficha da empresa.
  function alternarUso(id) {
    setContasBanco(prev => prev.map(c => (
      c.id === id
        ? { ...c, data: { ...c.data, usar_em_documentos: !(c.data?.usar_em_documentos === true) } }
        : c
    )))
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
      // A ficha fiscal também se beneficia da consulta: o CNAE vem da Receita
      // e o município do ISS é o da sede, enquanto ela não disser outro. O que
      // já estiver preenchido não é sobrescrito.
      setFiscal(prev => ({
        ...prev,
        cnae: prev.cnae || r.dados.cnae || '',
        municipio_incidencia: prev.municipio_incidencia || r.dados.cidade || '',
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

      // A ficha fiscal vai para a tabela onde ela já mora. O registro é
      // preservado inteiro: esta tela edita cinco campos dele e não tem
      // opinião sobre o resto (ambiente, modelos de texto, reforma IBS/CBS),
      // que continua sendo da Configuração de NFS-e.
      const fiscalLimpo = {
        ...fiscal,
        inscricao_municipal: String(fiscal.inscricao_municipal || '').trim(),
        cnae: String(fiscal.cnae || '').trim(),
        municipio_incidencia: String(fiscal.municipio_incidencia || '').trim(),
        codigo_municipio_ibge: String(fiscal.codigo_municipio_ibge || '').trim(),
      }
      const { error: erroFiscal } = fiscalId
        ? await supabase.from('nfse_config').update({ data: fiscalLimpo }).eq('id', fiscalId)
        : await supabase.from('nfse_config').insert({ user_id: user.id, data: fiscalLimpo })
      // A marca de uso vai para a própria conta, e só para as que mudaram.
      for (const c of contasBanco) {
        const agora = c.data?.usar_em_documentos === true
        if (agora === (usoOriginal[c.id] === true)) continue
        const { error: erroConta } = await supabase.from('contas_bancarias')
          .update({ data: { ...c.data, usar_em_documentos: agora } }).eq('id', c.id)
        if (erroConta) {
          showToast(msgErro(erroConta, 'Não foi possível gravar quais contas aparecem em documentos.'), 'error')
          carregar()
          return
        }
      }

      // A ficha fiscal falhou depois de a identificação ter sido gravada: a
      // mensagem diz qual das duas partes ficou para trás, senão ela salva de
      // novo sem saber o que conferir.
      if (erroFiscal) {
        showToast(msgErro(erroFiscal, "A identificação foi salva, mas a ficha fiscal não. Tente salvar de novo."), "error")
        carregar()
        return
      }

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
            Ficha cadastral da empresa. O CNPJ registrado aqui define a
            <strong> titularidade</strong> dos documentos que chegam por e-mail.
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

          <Bloco titulo="Identificação fiscal">
            <Linha>
              <Campo rotulo="Inscrição municipal">
                <input value={fis('inscricao_municipal')} onChange={e => mudarFiscal('inscricao_municipal', e.target.value)} style={input} />
                <Dica>Número da inscrição na prefeitura onde a empresa presta serviço.</Dica>
              </Campo>
              <Campo rotulo="CNAE">
                <input value={fis('cnae')} onChange={e => mudarFiscal('cnae', e.target.value)} placeholder="Ex: 7020400" style={input} />
                <Dica>Atividade principal registrada na Receita. Preenchido pela busca do CNPJ.</Dica>
              </Campo>
              <Campo rotulo="Regime tributário" flex="2 1 260px">
                <select value={fis('regime_tributario') || REGIMES[0]} onChange={e => mudarFiscal('regime_tributario', e.target.value)} style={input}>
                  {REGIMES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </Campo>
            </Linha>
            <Linha>
              <Campo rotulo="Município do ISS" flex="2 1 240px">
                <input value={fis('municipio_incidencia')} onChange={e => mudarFiscal('municipio_incidencia', e.target.value)} style={input} />
                <Dica>Onde o ISS é devido. É o que o Simples Nacional usa para separar o imposto municipal.</Dica>
              </Campo>
              <Campo rotulo="Código IBGE do município">
                <input value={fis('codigo_municipio_ibge')} onChange={e => mudarFiscal('codigo_municipio_ibge', e.target.value)} placeholder="Ex: 3556206" style={input} />
              </Campo>
              <Campo rotulo="Simples Nacional" flex="1 1 200px">
                <label style={caixaCheck}>
                  <input
                    type="checkbox"
                    checked={fiscal.optante_simples !== false}
                    onChange={e => mudarFiscal('optante_simples', e.target.checked)}
                  />
                  Empresa optante
                </label>
              </Campo>
            </Linha>
            <Dica>
              Esta é a ficha fiscal da empresa, e ela se digita aqui. O que configura a emissão da
              nota — ambiente, item da lista de serviço, alíquota de ISS e modelos de texto — fica
              em Configuração de NFS-e, que lê estes campos daqui.
            </Dica>
          </Bloco>

          <Bloco titulo="Contas de recebimento">
            {contasBanco.length === 0 ? (
              <Dica>Nenhuma conta cadastrada. As contas ficam em Configurações › Contas e Cartões.</Dica>
            ) : contasBanco.map(c => {
              const b = c.data || {}
              const usada = b.usar_em_documentos === true
              return (
                <label key={c.id} style={{ ...contaLinha, ...(usada ? contaLinhaUsada : null) }}>
                  <input
                    type="checkbox"
                    checked={usada}
                    onChange={() => alternarUso(c.id)}
                    style={{ accentColor: 'var(--navy)', marginTop: 2 }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={contaNome}>{b.nome || 'Conta sem nome'}</div>
                    <div style={contaDetalhe}>
                      {rotuloBanco(b.banco_codigo, b.banco) || 'Banco não informado'}
                      {b.agencia ? ` · ag. ${b.agencia}` : ''}
                      {b.conta ? ` · c/c ${b.conta}` : ''}
                    </div>
                    <div style={contaDetalhe}>
                      {b.pix ? `Pix: ${b.pix}` : 'Sem chave Pix cadastrada'}
                    </div>
                  </div>
                </label>
              )
            })}
            <Dica>
              Marque as contas que aparecem em proposta, contrato e cobrança. O cadastro da conta —
              banco, agência, número e chave Pix — fica em Contas e Cartões, que é a mesma conta que
              o sistema concilia. Aqui não se cadastra conta de novo.
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
            Esta tela é a ficha da empresa. Nada do que está aqui precisa ser digitado de novo em
            outro lugar.
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
const caixaCheck = {
  display: "flex", alignItems: "center", gap: 8, height: 36,
  fontSize: 13, color: "var(--text)", cursor: "pointer",
}
const contaLinha = {
  display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
  padding: '10px 12px', border: '1.5px solid var(--cream-dark)', borderRadius: 6,
  marginBottom: 8, background: 'var(--white)',
}
const contaLinhaUsada = { borderColor: 'var(--navy)', background: 'var(--cream)' }
const contaNome = { fontSize: 13, fontWeight: 600, color: 'var(--navy)', fontFamily: 'var(--body)' }
const contaDetalhe = { fontSize: 12, color: 'var(--text-mid)', fontFamily: 'var(--body)', marginTop: 2 }
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
const rodape = {
  fontSize: 11.5, color: 'var(--text-mid)', lineHeight: 1.7, padding: '4px 2px 20px',
}
const vazio = {
  background: 'var(--white)', border: '1px solid var(--cream-dark)', borderRadius: 10,
  padding: '40px 24px', textAlign: 'center', fontSize: 13, color: 'var(--text-mid)',
}
