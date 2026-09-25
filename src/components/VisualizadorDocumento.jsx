import { useEffect, useState } from 'react'
import Modal from './Modal'
import { supabase } from '../lib/supabase'

// =============================================================================
// VISUALIZADOR DO DOCUMENTO — ver a nota antes de decidir sobre ela.
//
// Aprovar um lançamento sem olhar o documento é confiar na leitura automática.
// Aqui a pessoa vê o papel: o PDF como veio, a foto como foi tirada, o XML como
// a prefeitura escreveu.
//
// O arquivo NÃO viaja com a lista (são megabytes por documento). Ele é buscado
// aqui, só o do documento que foi aberto, e some da memória ao fechar.
// =============================================================================

// O tipo declarado no e-mail mente com frequência: a prefeitura de Valinhos
// manda a nota como "arquivo genérico". A extensão é mais confiável.
function tipoDeVerdade(nome, tipoDeclarado) {
  const n = String(nome || '').toLowerCase()
  if (n.endsWith('.pdf')) return 'application/pdf'
  if (n.endsWith('.xml')) return 'text/xml'
  if (n.endsWith('.png')) return 'image/png'
  if (/\.jpe?g$/.test(n)) return 'image/jpeg'
  const t = String(tipoDeclarado || '').toLowerCase()
  if (t.startsWith('image/') || t === 'application/pdf' || /xml/.test(t)) return t
  return 'application/octet-stream'
}

function bytesDeBase64(base64) {
  const bruto = atob(String(base64 || '').replace(/\s/g, ''))
  const bytes = new Uint8Array(bruto.length)
  for (let i = 0; i < bruto.length; i++) bytes[i] = bruto.charCodeAt(i)
  return bytes
}

export default function VisualizadorDocumento({ pendingId, nome, tipoDeclarado, titulo, onClose }) {
  const [estado, setEstado] = useState({ fase: 'carregando' })

  useEffect(() => {
    if (!pendingId) return undefined
    let vivo = true
    let urlCriada = null

    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('nf_pending').select('data').eq('id', pendingId).maybeSingle()
        if (error) throw error
        const base64 = data?.data?.anexo
        if (!base64) {
          if (vivo) setEstado({ fase: 'sem-arquivo' })
          return
        }
        const mime = tipoDeVerdade(nome || data?.data?.anexoNome, tipoDeclarado || data?.data?.anexoTipo)
        const bytes = bytesDeBase64(base64)

        // XML é para ler, não para renderizar: vira texto na tela.
        if (/xml/.test(mime)) {
          const texto = new TextDecoder('utf-8').decode(bytes)
          if (vivo) setEstado({ fase: 'texto', texto, mime })
          return
        }
        urlCriada = URL.createObjectURL(new Blob([bytes], { type: mime }))
        if (vivo) setEstado({ fase: 'arquivo', url: urlCriada, mime, tamanho: bytes.length })
      } catch (e) {
        if (vivo) setEstado({ fase: 'erro', erro: e.message })
      }
    })()

    return () => {
      vivo = false
      // Sem isso o arquivo continua ocupando memória do navegador depois de fechar.
      if (urlCriada) URL.revokeObjectURL(urlCriada)
    }
  }, [pendingId, nome, tipoDeclarado])

  return (
    <Modal open={!!pendingId} onClose={onClose} title={titulo || nome || 'Documento'} width={980}>
      <div style={{ minHeight: 420 }}>
        {estado.fase === 'carregando' && <div style={aviso}>Abrindo o documento…</div>}

        {estado.fase === 'sem-arquivo' && (
          <div style={aviso}>
            Este documento não tem arquivo guardado. Acontece com o que foi lançado à mão
            ou veio de uma leitura antiga, antes de o sistema guardar o original.
          </div>
        )}

        {estado.fase === 'erro' && (
          <div style={{ ...aviso, color: 'var(--red)' }}>Não consegui abrir o arquivo: {estado.erro}</div>
        )}

        {estado.fase === 'texto' && (
          <pre style={caixaTexto}>{estado.texto}</pre>
        )}

        {estado.fase === 'arquivo' && estado.mime.startsWith('image/') && (
          <img src={estado.url} alt={nome || 'documento'} style={{ maxWidth: '100%', display: 'block', margin: '0 auto' }} />
        )}

        {estado.fase === 'arquivo' && estado.mime === 'application/pdf' && (
          <iframe src={estado.url} title={nome || 'documento'} style={{ width: '100%', height: '70vh', border: 'none', borderRadius: 6 }} />
        )}

        {estado.fase === 'arquivo' && estado.mime === 'application/octet-stream' && (
          <div style={aviso}>
            Não dá para mostrar este tipo de arquivo aqui.{' '}
            <a href={estado.url} download={nome || 'documento'} style={link}>Baixar o arquivo</a>
          </div>
        )}

        {estado.fase === 'arquivo' && (
          <div style={rodape}>
            <a href={estado.url} download={nome || 'documento'} style={link}>Baixar</a>
            {' · '}{nome}{' · '}{(estado.tamanho / 1024).toFixed(0)} KB
          </div>
        )}
      </div>
    </Modal>
  )
}

const aviso = { padding: '40px 20px', textAlign: 'center', fontSize: 13, color: 'var(--text-mid)', lineHeight: 1.6 }
const caixaTexto = { margin: 0, padding: 14, maxHeight: '70vh', overflow: 'auto', background: 'var(--cream)', borderRadius: 6, fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace, Menlo, Consolas, monospace', color: 'var(--navy)' }
const rodape = { marginTop: 10, fontSize: 11, color: 'var(--text-mid)', textAlign: 'right' }
const link = { color: 'var(--gold-dark)', fontWeight: 700, textDecoration: 'underline' }
