import { supabase } from './supabase'

// Bucket configurado no Supabase Storage (criado nos primeiros PRs do projeto).
const STORAGE_BUCKET = 'anexos-fiscais'

/**
 * Faz upload de um anexo (File) pro Storage e retorna o path interno.
 * Path: `{user_id}/{tipo}/{lancamentoId}/{timestamp}_{fileName}`
 * Replica uploadAnexoToStorage do legado (linha 2278).
 */
export async function uploadAnexo(file, { tipo, lancamentoId, userId }) {
  if (!userId) throw new Error('Sessão expirada')
  const fileName = (file.name || 'anexo.pdf').replace(/[^\w.\-]/g, '_')
  const path = `${userId}/${tipo}/${lancamentoId}/${Date.now()}_${fileName}`
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type || 'application/octet-stream',
  })
  if (error) throw error
  return path
}

/** URL assinada (válida 1 hora) pra visualizar/baixar o anexo. */
export async function getAnexoSignedUrl(path) {
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(path, 3600)
  if (error) throw error
  return data.signedUrl
}

/** Apaga o anexo do Storage. */
export async function deleteAnexo(path) {
  if (!path) return
  await supabase.storage.from(STORAGE_BUCKET).remove([path])
}

/** Extrai o nome de arquivo amigável do path (último segmento, sem timestamp). */
export function nomeAnexoFromPath(path) {
  if (!path) return ''
  const seg = path.split('/').pop() || path
  // Remove o prefixo de timestamp (\d+_)
  return seg.replace(/^\d+_/, '')
}
