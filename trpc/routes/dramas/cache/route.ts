import { z } from 'zod';
import { publicProcedure, protectedProcedure, type Context } from '../../../create-context';

// Configuração da API do TMDb
const TMDB_API_KEY = process.env.TMDB_API_KEY || process.env.EXPO_PUBLIC_TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

console.log('[CACHE] TMDB_API_KEY configured:', !!TMDB_API_KEY);
console.log('[CACHE] Available TMDB env vars:', Object.keys(process.env).filter(key => key.includes('TMDB')));

if (!TMDB_API_KEY) {
  console.error('TMDB_API_KEY não configurada! Verifique as variáveis de ambiente.');
  console.error('Available env vars:', Object.keys(process.env).filter(key => key.includes('TMDB')));
}

// Schemas de validação
const dramaSearchSchema = z.object({
  query: z.string().min(1),
  page: z.number().optional().default(1),
});

const dramaByIdSchema = z.object({
  id: z.number(),
  forceRefresh: z.boolean().optional().default(false),
});

const popularDramasSchema = z.object({
  page: z.number().optional().default(1),
});

// Utilitários
const normalizePath = (p: unknown): string | null => {
  if (typeof p !== 'string') return null;
  if (!p) return null;
  return p.startsWith('/') ? p : `/${p}`;
};

// Função auxiliar para buscar do TMDb com timeout e retry
async function fetchFromTMDb(endpoint: string, retryCount: number = 0) {
  const maxRetries = 2;
  const url = new URL(`${TMDB_BASE_URL}${endpoint}`);
  if (!url.searchParams.has('language')) {
    url.searchParams.set('language', 'pt-BR');
  }

  let headers: Record<string, string> | undefined;
  if (TMDB_API_KEY && TMDB_API_KEY.startsWith('eyJ')) {
    headers = { Authorization: `Bearer ${TMDB_API_KEY}` };
  } else if (TMDB_API_KEY) {
    if (!url.searchParams.has('api_key')) {
      url.searchParams.set('api_key', TMDB_API_KEY);
    }
  }

  // Create AbortController with timeout
  const controller = new AbortController();
  const timeoutDuration = 8000 + (retryCount * 3000); // 8s, 11s, 14s
  const timeoutId = setTimeout(() => {
    console.log(`[CACHE] Timeout triggered for ${endpoint} after ${timeoutDuration}ms`);
    controller.abort();
  }, timeoutDuration);

  try {
    const response = await fetch(url.toString(), { 
      headers,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`TMDb API error: ${response.status} ${text}`);
    }

    return response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    
    // Handle AbortError with retry
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn(`[CACHE] Request timeout for ${endpoint} (attempt ${retryCount + 1})`);
      
      if (retryCount < maxRetries) {
        console.log(`[CACHE] Retrying ${endpoint} in ${1000 * (retryCount + 1)}ms...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return fetchFromTMDb(endpoint, retryCount + 1);
      } else {
        console.error(`[CACHE] Max retries exceeded for ${endpoint}`);
        throw new Error(`Request timeout after ${maxRetries + 1} attempts`);
      }
    }
    
    throw error;
  }
}

// Função para verificar se série existe no cache
async function getSerieFromCache(supabase: any, tmdbId: number) {
  console.log(`[CACHE] getSerieFromCache - buscando tmdb_id: ${tmdbId}`);
  
  const { data, error, status } = await supabase
    .from('series')
    .select(`
      *,
      temporadas:temporadas(*),
      elenco:elenco(*),
      videos:videos(*),
      imagens:imagens(*)
    `)
    .eq('tmdb_id', tmdbId)
    .maybeSingle();
    
  if (error) {
    console.warn(`[CACHE] Erro ao buscar série ${tmdbId} do cache (status ${status}):`, error);
    // Quando não encontra, o PostgREST pode retornar 406/400 com PGRST116; tratar como não encontrado
    if (error.code === 'PGRST116' || status === 406 || status === 400) {
      console.log(`[CACHE] Série ${tmdbId} não encontrada no cache (tratado como miss)`);
      return null;
    }
    throw error;
  }

  if (!data) {
    console.log(`[CACHE] Série ${tmdbId} não encontrada no cache (data null)`);
    return null;
  }
  
  console.log(`[CACHE] Série ${tmdbId} encontrada no cache:`, {
    id: data.id,
    nome: data.nome,
    last_update: data.last_update
  });
    
  return data;
}

// Função para verificar se série precisa ser atualizada
async function serieNeedsUpdate(supabase: any, tmdbId: number, maxAgeDays = 7) {
  try {
    const { data, error } = await supabase.rpc('serie_needs_update', {
      p_tmdb_id: tmdbId,
      p_max_age_days: maxAgeDays
    });
    
    if (error) {
      console.error('Erro ao verificar se série precisa atualizar:', error);
      return true; // Em caso de erro, assumir que precisa atualizar
    }
    
    return data;
  } catch (error) {
    console.error('Função serie_needs_update não existe, assumindo que precisa atualizar:', error);
    return true;
  }
}

// Função para salvar série no cache
async function upsertSerieCache(supabase: any, serieData: any) {
  console.log(`[CACHE] upsertSerieCache iniciado para tmdb_id: ${serieData.id}`);
  
  try {
    console.log(`[CACHE] Tentando RPC upsert_serie_cache...`);
    const { data, error } = await supabase.rpc('upsert_serie_cache', {
      p_tmdb_id: serieData.id,
      p_nome: serieData.name || serieData.original_name,
      p_nome_original: serieData.original_name,
      p_descricao: serieData.overview,
      p_cover: serieData.poster_path,
      p_backcover: serieData.backdrop_path,
      p_ano: serieData.first_air_date ? new Date(serieData.first_air_date).getFullYear() : null,
      p_avaliacao: serieData.vote_average,
      p_status: serieData.status,
      p_generos: serieData.genre_ids || (serieData.genres?.map((g: any) => g.id)) || [],
      p_paises: serieData.origin_country || [],
      p_popularidade: serieData.popularity,
      p_votos: serieData.vote_count,
      p_primeira_exibicao: serieData.first_air_date || null,
      p_ultima_exibicao: serieData.last_air_date || null,
      p_runtime_episodio: serieData.episode_run_time?.[0] || null,
      p_linguagem_original: serieData.original_language,
      p_homepage: serieData.homepage,
      p_tagline: serieData.tagline
    });

    if (error) {
      console.error('[CACHE] Erro ao chamar RPC upsert_serie_cache:', error);
      throw error; // Pula para o bloco catch para usar o fallback
    }

    console.log(`[CACHE] RPC retornou:`, data, typeof data);

    if (typeof data === 'number') {
      console.log(`[CACHE] RPC sucesso - ID: ${data}`);
      return data;
    }

    // Tentar obter o ID direto da tabela caso o RPC não retorne número
    console.log(`[CACHE] RPC não retornou número, buscando ID manualmente...`);
    const { data: maybeRow, error: fetchErr } = await supabase
      .from('series')
      .select('id')
      .eq('tmdb_id', serieData.id)
      .maybeSingle();

    if (fetchErr) {
      console.error('[CACHE] Falha ao buscar série após RPC:', fetchErr);
      throw fetchErr;
    }

    if (maybeRow?.id && typeof maybeRow.id === 'number') {
      console.log(`[CACHE] ID encontrado após RPC: ${maybeRow.id}`);
      return maybeRow.id;
    }

    throw new Error('RPC upsert_serie_cache não retornou um ID válido e não foi possível localizar a série.');
  } catch (rpcError) {
    console.log('[CACHE] RPC falhou, usando fallback de upsert direto para a tabela series.');
    console.log('[CACHE] Erro RPC:', rpcError);
    
    const { data, error: insertError } = await supabase
      .from('series')
      .upsert({
        tmdb_id: serieData.id,
        nome: serieData.name || serieData.original_name,
        nome_original: serieData.original_name,
        descricao: serieData.overview,
        cover: serieData.poster_path,
        backcover: serieData.backdrop_path,
        ano: serieData.first_air_date ? new Date(serieData.first_air_date).getFullYear() : null,
        avaliacao: serieData.vote_average,
        status: serieData.status,
        generos: serieData.genre_ids || (serieData.genres?.map((g: any) => g.id)) || [],
        paises: serieData.origin_country || [],
        popularidade: serieData.popularity,
        votos: serieData.vote_count,
        primeira_exibicao: serieData.first_air_date || null,
        ultima_exibicao: serieData.last_air_date || null,
        runtime_episodio: serieData.episode_run_time?.[0] || null,
        linguagem_original: serieData.original_language,
        homepage: serieData.homepage,
        tagline: serieData.tagline,
        last_update: new Date().toISOString()
      }, {
        onConflict: 'tmdb_id'
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('[CACHE] Erro no fallback de inserção direta:', insertError);
      throw insertError;
    }

    if (data?.id) {
      console.log(`[CACHE] Fallback sucesso - ID: ${data.id}`);
      return data.id;
    }

    // Última tentativa: buscar o ID
    console.log(`[CACHE] Última tentativa - buscando ID após upsert...`);
    const { data: fetched, error: fetchAfterUpsertErr } = await supabase
      .from('series')
      .select('id')
      .eq('tmdb_id', serieData.id)
      .maybeSingle();

    if (fetchAfterUpsertErr) {
      console.error('[CACHE] Erro ao buscar série após upsert direto:', fetchAfterUpsertErr);
      throw fetchAfterUpsertErr;
    }

    if (fetched?.id) {
      console.log(`[CACHE] ID encontrado na última tentativa: ${fetched.id}`);
      return fetched.id;
    }

    console.error('[CACHE] Falha completa - não foi possível obter ID');
    throw new Error('Falha completa ao salvar série no cache');
  }
}

// Função para salvar elenco no cache
async function upsertCastCache(supabase: any, serieId: number, tmdbId: number, castData: any) {
  if (!castData?.cast?.length) return;
  if (typeof serieId !== 'number' || Number.isNaN(serieId)) {
    console.warn('upsertCastCache: serieId inválido, abortando. tmdbId:', tmdbId, 'serieId:', serieId);
    return;
  }
  await supabase
    .from('elenco')
    .delete()
    .eq('serie_id', serieId);
  const castToInsert = castData.cast.slice(0, 20).map((person: any, index: number) => ({
    serie_id: serieId,
    tmdb_person_id: person.id,
    nome: person.name,
    personagem: person.character,
    foto: person.profile_path,
    ordem: index,
    tipo: 'cast'
  }));
  if (castToInsert.length > 0) {
    const { error } = await supabase
      .from('elenco')
      .insert(castToInsert);
    if (error) {
      console.error('Erro ao salvar elenco:', error);
    }
  }
}

// Função para salvar vídeos no cache
async function upsertVideosCache(supabase: any, serieId: number, tmdbId: number, videosData: any) {
  if (!videosData?.results?.length) return;
  if (typeof serieId !== 'number' || Number.isNaN(serieId)) {
    console.warn('upsertVideosCache: serieId inválido, abortando. tmdbId:', tmdbId, 'serieId:', serieId);
    return;
  }
  await supabase
    .from('videos')
    .delete()
    .eq('serie_id', serieId);
  const videosToInsert = videosData.results
    .filter((v: any) => ['Trailer', 'Teaser'].includes(v.type))
    .slice(0, 10)
    .map((v: any) => ({
      serie_id: serieId,
      tmdb_video_id: v.id,
      key: v.key,
      site: v.site,
      tipo: v.type,
      nome: v.name,
      tamanho: v.size,
      oficial: v.official,
      publicado_em: v.published_at
    }));
  if (videosToInsert.length > 0) {
    const { error } = await supabase
      .from('videos')
      .insert(videosToInsert);
    if (error) {
      console.error('Erro ao salvar vídeos:', error);
    }
  }
}

// Função para salvar temporadas no cache
async function upsertSeasonsCache(
  supabase: any,
  serieId: number,
  tmdbId: number,
  seasons: Array<any>
) {
  console.log('[CACHE] upsertSeasonsCache iniciado', { serieId, tmdbId, seasonsCount: Array.isArray(seasons) ? seasons.length : 0 });
  if (!Array.isArray(seasons) || seasons.length === 0) return;
  if (typeof serieId !== 'number' || Number.isNaN(serieId)) {
    console.warn('upsertSeasonsCache: serieId inválido, abortando.', { tmdbId, serieId });
    return;
  }

  const seasonsWithDetails = await Promise.all(
    seasons.map(async (s: any) => {
      const hasOverview = !!s.overview && typeof s.overview === 'string' && s.overview.length > 0;
      const hasEpisodeCount = typeof s.episode_count === 'number' && s.episode_count >= 0;
      if (hasOverview && hasEpisodeCount) return s;
      try {
        const detail = await fetchFromTMDb(`/tv/${tmdbId}/season/${s.season_number}`);
        return {
          ...s,
          overview: detail?.overview ?? s.overview ?? null,
          episode_count: typeof detail?.episodes?.length === 'number' ? detail.episodes.length : (s.episode_count ?? null),
          air_date: detail?.air_date ?? s.air_date ?? null,
          name: detail?.name ?? s.name ?? null,
          poster_path: detail?.poster_path ?? s.poster_path ?? null,
          id: detail?.id ?? s.id ?? null
        };
      } catch (e) {
        console.warn('[CACHE] Falha ao buscar detalhes da temporada', { season_number: s?.season_number, tmdbId, error: (e as Error)?.message });
        return s;
      }
    })
  );

  await supabase
    .from('temporadas')
    .delete()
    .eq('serie_id', serieId);

  const rows = seasonsWithDetails
    .filter((s: any) => s != null && typeof s.season_number === 'number')
    .map((s: any) => ({
      serie_id: serieId,
      tmdb_season_id: s.id ?? null,
      numero: s.season_number ?? null,
      nome: s.name ?? null,
      descricao: s.overview ?? null,
      capa: s.poster_path ?? null,
      data_exibicao: s.air_date ?? null,
      total_episodios: s.episode_count ?? (Array.isArray(s.episodes) ? s.episodes.length : null)
    }));

  if (rows.length === 0) {
    console.log('[CACHE] Nenhuma temporada para inserir');
    return;
  }

  const { error } = await supabase.from('temporadas').insert(rows);
  if (error) {
    console.error('[CACHE] Erro ao salvar temporadas:', error);
  } else {
    console.log(`[CACHE] ${rows.length} temporadas salvas para série ${tmdbId}`);
  }
}

// Função para salvar imagens no cache
async function upsertImagesCache(
  supabase: any,
  serieId: number,
  tmdbId: number,
  imagesData: any
) {
  console.log('[CACHE] upsertImagesCache iniciado', { serieId, tmdbId });
  if (typeof serieId !== 'number' || Number.isNaN(serieId)) {
    console.warn('upsertImagesCache: serieId inválido, abortando.', { tmdbId, serieId });
    return;
  }
  const backdrops: Array<any> = Array.isArray(imagesData?.backdrops) ? imagesData.backdrops : [];
  const posters: Array<any> = Array.isArray(imagesData?.posters) ? imagesData.posters : [];
  const logos: Array<any> = Array.isArray(imagesData?.logos) ? imagesData.logos : [];

  if (backdrops.length === 0 && posters.length === 0 && logos.length === 0) {
    console.log('[CACHE] Nenhuma imagem para inserir');
    return;
  }

  await supabase
    .from('imagens')
    .delete()
    .eq('serie_id', serieId);

  const mapItem = (item: any, tipo: 'backdrop' | 'poster' | 'logo') => ({
    serie_id: serieId,
    caminho: normalizePath(item.file_path ?? item.caminho ?? null),
    tipo,
    largura: item.width ?? item.largura ?? null,
    altura: item.height ?? item.altura ?? null,
    aspecto: typeof item.aspect_ratio === 'number' ? Number(item.aspect_ratio.toFixed(2)) : null,
    votos: item.vote_count ?? item.votos ?? 0,
    avaliacao: typeof item.vote_average === 'number' ? Number(item.vote_average.toFixed(1)) : null,
    linguagem: item.iso_639_1 ?? item.linguagem ?? null,
  });

  const rows = [
    ...backdrops.slice(0, 20).map((i: any) => mapItem(i, 'backdrop')),
    ...posters.slice(0, 20).map((i: any) => mapItem(i, 'poster')),
    ...logos.slice(0, 20).map((i: any) => mapItem(i, 'logo')),
  ].filter((r) => r.caminho != null);

  if (rows.length === 0) {
    console.log('[CACHE] Nenhuma imagem válida para inserir');
    return;
  }

  const { error } = await supabase.from('imagens').insert(rows);
  if (error) {
    console.error('[CACHE] Erro ao salvar imagens:', error);
  } else {
    console.log(`[CACHE] ${rows.length} imagens salvas para série ${tmdbId}`);
  }
}

// Função principal para obter série com cache
async function getSerieWithCache(supabase: any, tmdbId: number, forceRefresh = false): Promise<{ serie: any | null; status: 'cache-hit' | 'stale-refreshed' | 'miss-saved' | 'cache-after-error' | 'not-found'; serieId?: number | null; }> {
  console.log(`[CACHE] getSerieWithCache iniciado - tmdbId: ${tmdbId}, forceRefresh: ${forceRefresh}`);
  let serie: any | null = null;
  let status: 'cache-hit' | 'stale-refreshed' | 'miss-saved' | 'cache-after-error' | 'not-found' = 'not-found';
  let serieId: number | null | undefined = null;
  
  if (!forceRefresh) {
    console.log(`[CACHE] Tentando buscar do cache primeiro...`);
    // Tentar buscar do cache primeiro
    serie = await getSerieFromCache(supabase, tmdbId);
    console.log(`[CACHE] Resultado do cache:`, serie ? 'ENCONTRADO' : 'NÃO ENCONTRADO');
    
    // Se existe no cache, verificar se precisa atualizar
    if (serie) {
      const needsUpdate = await serieNeedsUpdate(supabase, tmdbId);
      console.log(`[CACHE] Série precisa atualizar?`, needsUpdate);
      // Se não precisa atualizar, mas faltam imagens, tentar completar assets leves
      const hasImages = Array.isArray(serie?.imagens) && serie.imagens.length > 0;
      if (!needsUpdate && !hasImages) {
        try {
          console.log('[CACHE] Cache-hit sem imagens. Buscando imagens do TMDb para completar...');
          const imagesData = await fetchFromTMDb(`/tv/${tmdbId}/images`);
          await upsertImagesCache(supabase, serie.id as number, tmdbId, imagesData);
          console.log('[CACHE] Imagens salvas. Recarregando série do cache...');
          const updated = await getSerieFromCache(supabase, tmdbId);
          if (updated) {
            status = 'cache-hit';
            return { serie: updated, status, serieId: updated?.id ?? null };
          }
        } catch (e) {
          console.warn('[CACHE] Falha ao completar imagens em cache-hit:', e);
        }
      }
      if (!needsUpdate) {
        console.log(`[CACHE] Retornando dados do cache (atualizados)`);
        status = 'cache-hit';
        return { serie, status, serieId: serie?.id ?? null };
      }
    }
  }
  
  try {
    console.log(`[CACHE] Buscando dados do TMDb para ID: ${tmdbId}`);
    
    // Buscar dados básicos do TMDb
    const tmdbData = await fetchFromTMDb(`/tv/${tmdbId}`);
    console.log(`[CACHE] Dados TMDb recebidos:`, { id: tmdbData.id, name: tmdbData.name });
    
    // Salvar série no cache
    console.log(`[CACHE] Salvando série no cache...`);
    serieId = await upsertSerieCache(supabase, tmdbData);
    console.log(`[CACHE] Série salva com ID: ${serieId}`);

    if (typeof serieId !== 'number' || Number.isNaN(serieId)) {
      console.log(`[CACHE] ID inválido, tentando buscar manualmente...`);
      const { data: fetchedRow, error: fetchIdErr } = await supabase
        .from('series')
        .select('id')
        .eq('tmdb_id', tmdbId)
        .maybeSingle();
      if (fetchIdErr) {
        console.error('[CACHE] Erro ao localizar ID da série após upsert:', fetchIdErr);
      }
      if (fetchedRow?.id) {
        serieId = fetchedRow.id as number;
        console.log(`[CACHE] ID encontrado manualmente: ${serieId}`);
      }
    }

    // Buscar dados adicionais em paralelo
    console.log(`[CACHE] Buscando dados adicionais (cast, videos, images)...`);
    const [castData, videosData, imagesData] = await Promise.allSettled([
      fetchFromTMDb(`/tv/${tmdbId}/credits`),
      fetchFromTMDb(`/tv/${tmdbId}/videos`),
      fetchFromTMDb(`/tv/${tmdbId}/images`),
    ]);

    // Salvar temporadas primeiro usando dados do tmdbData
    try {
      const seasonsArray: Array<any> = Array.isArray((tmdbData as any)?.seasons) ? (tmdbData as any).seasons : [];
      console.log('[CACHE] Salvando temporadas...', { count: seasonsArray.length });
      await upsertSeasonsCache(supabase, serieId as number, tmdbId, seasonsArray);
    } catch (e) {
      console.error('[CACHE] Erro ao salvar temporadas:', e);
    }
    
    // Salvar dados adicionais se disponíveis
    if (castData.status === 'fulfilled') {
      console.log(`[CACHE] Salvando elenco...`);
      await upsertCastCache(supabase, serieId as number, tmdbId, castData.value);
    } else {
      console.log(`[CACHE] Erro ao buscar elenco:`, castData.reason);
    }
    
    if (videosData.status === 'fulfilled') {
      console.log(`[CACHE] Salvando vídeos...`);
      await upsertVideosCache(supabase, serieId as number, tmdbId, videosData.value);
    } else {
      console.log(`[CACHE] Erro ao buscar vídeos:`, videosData.reason);
    }

    if (imagesData.status === 'fulfilled') {
      console.log(`[CACHE] Salvando imagens...`);
      await upsertImagesCache(supabase, serieId as number, tmdbId, imagesData.value);
    } else {
      console.log(`[CACHE] Erro ao buscar imagens:`, imagesData.reason);
    }
    
    // Buscar dados atualizados do cache
    console.log(`[CACHE] Buscando dados atualizados do cache...`);
    serie = await getSerieFromCache(supabase, tmdbId);
    console.log(`[CACHE] Dados finais do cache:`, serie ? 'SUCESSO' : 'FALHOU');
    
    status = (serie && !forceRefresh) ? 'stale-refreshed' : 'miss-saved';
    return { serie, status, serieId: serieId ?? (serie?.id ?? null) };
    
  } catch (error) {
    console.error('[CACHE] Erro ao buscar série do TMDb:', error);
    console.error('[CACHE] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
    // Se falhou ao buscar do TMDb, retornar do cache se existir
    if (serie) {
      console.log(`[CACHE] Retornando dados do cache após erro TMDb`);
      status = 'cache-after-error';
      return { serie, status, serieId: serie?.id ?? null };
    }
    
    throw new Error(`Série não encontrada: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
  }
}

// Procedures tRPC
export const getDramaById = publicProcedure
  .input(dramaByIdSchema)
  .query(async ({ input, ctx }: { input: z.infer<typeof dramaByIdSchema>; ctx: Context }) => {
    const { id, forceRefresh } = input;
    
    console.log(`[CACHE] Buscando dorama ID: ${id}, forceRefresh: ${forceRefresh}`);
    
    try {
      // Usar o sistema de cache primeiro
      const { serie, status, serieId } = await getSerieWithCache(ctx.supabase, id, forceRefresh);
      
      if (!serie) {
        throw new Error('Dorama não encontrado no cache. Tentando fallback.');
      }
      
      // Transformar dados do banco para o formato da API
      return {
        id: serie.tmdb_id,
        name: serie.nome,
        original_name: serie.nome_original,
        overview: serie.descricao,
        poster_path: serie.cover,
        backdrop_path: serie.backcover,
        first_air_date: serie.primeira_exibicao,
        last_air_date: serie.ultima_exibicao,
        vote_average: serie.avaliacao,
        vote_count: serie.votos,
        popularity: serie.popularidade,
        genre_ids: serie.generos,
        origin_country: serie.paises,
        number_of_episodes: serie.total_episodios,
        number_of_seasons: serie.total_temporadas,
        status: serie.status,
        episode_run_time: serie.runtime_episodio ? [serie.runtime_episodio] : [],
        original_language: serie.linguagem_original,
        homepage: serie.homepage,
        tagline: serie.tagline,
        cast: (serie.elenco && Array.isArray(serie.elenco)) ? serie.elenco.map((actor: any) => ({
          id: actor.tmdb_person_id,
          name: actor.nome,
          character: actor.personagem,
          profile_path: actor.foto,
          order: actor.ordem
        })) : [],
        videos: {
          results: (Array.isArray(serie?.videos) ? serie.videos : []).filter((video: any) => video != null).map((video: any) => ({
            id: video.tmdb_video_id || null,
            key: video.key || null,
            site: video.site || null,
            type: video.tipo || null,
            name: video.nome || null,
            size: video.tamanho || null,
            official: video.oficial || false,
            published_at: video.publicado_em || null
          }))
        },
        images: (() => {
          const list: Array<any> = Array.isArray(serie?.imagens) ? serie.imagens : [];
          const mapImg = (img: any) => ({
            file_path: normalizePath(img.caminho ?? null),
            width: img.largura ?? null,
            height: img.altura ?? null,
            vote_average: typeof img.avaliacao === 'number' ? img.avaliacao : 0,
            vote_count: typeof img.votos === 'number' ? img.votos : 0,
            iso_639_1: img.linguagem ?? null,
            aspect_ratio: typeof img.aspecto === 'number' ? img.aspecto : (typeof img.largura === 'number' && typeof img.altura === 'number' && img.altura > 0 ? Number((img.largura / img.altura).toFixed(2)) : null),
          });
          return {
            backdrops: list.filter((img: any) => img != null && img.tipo === 'backdrop').map(mapImg),
            posters: list.filter((img: any) => img != null && img.tipo === 'poster').map(mapImg),
            logos: list.filter((img: any) => img != null && img.tipo === 'logo').map(mapImg),
          };
        })(),
        seasons: (Array.isArray(serie?.temporadas) ? serie.temporadas : []).filter((season: any) => season != null).map((season: any) => ({
          id: season.tmdb_season_id || season.id || null,
          season_number: season.numero || null,
          name: season.nome || null,
          overview: season.descricao || null,
          poster_path: season.capa || null,
          air_date: season.data_exibicao || null,
          episode_count: season.total_episodios || null
        })),
        _cache: {
          status,
          serieId: serieId ?? null,
          last_update: serie?.last_update ?? null
        }
      };
    } catch (error) {
      console.error('[CACHE] Erro no sistema de cache:', error);
      console.error('[CACHE] Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
      
      // Fallback para TMDb em caso de erro
      try {
        console.log(`[CACHE] Tentando fallback TMDb para ID: ${id}`);
        
        if (!TMDB_API_KEY) {
          console.error('[CACHE] TMDB_API_KEY não encontrada.');
          console.error('[CACHE] process.env.TMDB_API_KEY:', !!process.env.TMDB_API_KEY);
          console.error('[CACHE] process.env.EXPO_PUBLIC_TMDB_API_KEY:', !!process.env.EXPO_PUBLIC_TMDB_API_KEY);
          console.error('[CACHE] Env vars disponíveis:', Object.keys(process.env).filter(key => key.includes('TMDB')));
          throw new Error('TMDB_API_KEY não configurada');
        }
        
        const tmdbData = await fetchFromTMDb(`/tv/${id}`);
        console.log(`[CACHE] TMDb data recebida para ${id}:`, { 
          id: tmdbData.id, 
          name: tmdbData.name,
          status: tmdbData.status 
        });
        
        const [castData, videosData, imagesData] = await Promise.allSettled([
          fetchFromTMDb(`/tv/${id}/credits`),
          fetchFromTMDb(`/tv/${id}/videos`),
          fetchFromTMDb(`/tv/${id}/images`),
        ]);
        
        return {
          id: tmdbData.id,
          name: tmdbData.name,
          original_name: tmdbData.original_name,
          overview: tmdbData.overview,
          poster_path: tmdbData.poster_path,
          backdrop_path: tmdbData.backdrop_path,
          first_air_date: tmdbData.first_air_date,
          last_air_date: tmdbData.last_air_date,
          vote_average: tmdbData.vote_average,
          vote_count: tmdbData.vote_count,
          popularity: tmdbData.popularity,
          genre_ids: tmdbData.genres?.map((g: any) => g.id) || [],
          origin_country: tmdbData.origin_country || [],
          number_of_episodes: tmdbData.number_of_episodes,
          number_of_seasons: tmdbData.number_of_seasons,
          status: tmdbData.status,
          episode_run_time: tmdbData.episode_run_time || [],
          original_language: tmdbData.original_language,
          homepage: tmdbData.homepage,
          tagline: tmdbData.tagline,
          cast: castData.status === 'fulfilled' ? castData.value?.cast?.slice(0, 20).map((actor: any) => ({
            id: actor.id,
            name: actor.name,
            character: actor.character,
            profile_path: actor.profile_path,
            order: actor.order
          })) || [] : [],
          videos: {
            results: videosData.status === 'fulfilled' ? videosData.value?.results?.filter((video: any) => ['Trailer', 'Teaser'].includes(video.type)).slice(0, 10) || [] : []
          },
          images: imagesData.status === 'fulfilled' ? {
            backdrops: Array.isArray(imagesData.value?.backdrops) ? imagesData.value.backdrops.map((img: any) => ({
              file_path: normalizePath(img.file_path ?? null),
              width: img.width ?? null,
              height: img.height ?? null,
              vote_average: img.vote_average ?? 0,
              vote_count: img.vote_count ?? 0,
              iso_639_1: img.iso_639_1 ?? null,
              aspect_ratio: typeof img.aspect_ratio === 'number' ? Number(img.aspect_ratio.toFixed(2)) : null,
            })) : [],
            posters: Array.isArray(imagesData.value?.posters) ? imagesData.value.posters.map((img: any) => ({
              file_path: normalizePath(img.file_path ?? null),
              width: img.width ?? null,
              height: img.height ?? null,
              vote_average: img.vote_average ?? 0,
              vote_count: img.vote_count ?? 0,
              iso_639_1: img.iso_639_1 ?? null,
              aspect_ratio: typeof img.aspect_ratio === 'number' ? Number(img.aspect_ratio.toFixed(2)) : null,
            })) : [],
            logos: Array.isArray(imagesData.value?.logos) ? imagesData.value.logos.map((img: any) => ({
              file_path: normalizePath(img.file_path ?? null),
              width: img.width ?? null,
              height: img.height ?? null,
              vote_average: img.vote_average ?? 0,
              vote_count: img.vote_count ?? 0,
              iso_639_1: img.iso_639_1 ?? null,
              aspect_ratio: typeof img.aspect_ratio === 'number' ? Number(img.aspect_ratio.toFixed(2)) : null,
            })) : [],
          } : { backdrops: [], posters: [], logos: [] },
          seasons: tmdbData.seasons || []
        };
      } catch (fallbackError) {
        console.error('[CACHE] Fallback para TMDb também falhou:', fallbackError);
        console.error('[CACHE] Fallback error stack:', fallbackError instanceof Error ? fallbackError.stack : 'No stack trace');
        console.error('[CACHE] TMDB_API_KEY exists:', !!TMDB_API_KEY);
        console.error('[CACHE] Requested drama ID:', id);
        throw new Error(`Erro ao carregar dorama: ${fallbackError instanceof Error ? fallbackError.message : 'Erro desconhecido'}`);
      }
    }
  });

export const searchDramas = publicProcedure
  .input(dramaSearchSchema)
  .query(async ({ input }: { input: z.infer<typeof dramaSearchSchema> }) => {
    const { query, page } = input;
    
    try {
      // Buscar do TMDb (busca sempre é em tempo real)
      const data = await fetchFromTMDb(`/search/tv?query=${encodeURIComponent(query)}&page=${page}`);
      
      return {
        page: data.page,
        results: data.results.map((drama: any) => ({
          id: drama.id,
          name: drama.name,
          original_name: drama.original_name,
          overview: drama.overview,
          poster_path: drama.poster_path,
          backdrop_path: drama.backdrop_path,
          first_air_date: drama.first_air_date,
          vote_average: drama.vote_average,
          vote_count: drama.vote_count,
          popularity: drama.popularity,
          genre_ids: drama.genre_ids,
          origin_country: drama.origin_country
        })),
        total_pages: data.total_pages,
        total_results: data.total_results
      };
      
    } catch (error) {
      console.error('Erro ao buscar doramas:', error);
      throw new Error('Erro ao buscar doramas');
    }
  });

export const getPopularDramas = publicProcedure
  .input(popularDramasSchema)
  .query(async ({ input, ctx }: { input: z.infer<typeof popularDramasSchema>; ctx: Context }) => {
    const { page } = input;
    
    try {
      console.log(`[CACHE] getPopularDramas iniciado - página ${page}`);
      
      // Primeiro, tentar buscar do cache (séries populares que já estão salvas)
      console.log('[CACHE] Verificando cache de séries populares...');
      const { data: cachedSeries, error: cacheError } = await ctx.supabase
        .from('series')
        .select('*')
        .order('popularidade', { ascending: false })
        .range((page - 1) * 20, page * 20 - 1);
      
      if (cacheError) {
        console.error('[CACHE] Erro ao buscar do cache:', cacheError);
      } else {
        console.log(`[CACHE] Cache retornou ${cachedSeries?.length || 0} séries`);
      }
      
      // Se temos dados no cache, retornar
      if (cachedSeries && cachedSeries.length > 0) {
        console.log('[CACHE] Retornando dados do cache');
        return {
          page,
          results: cachedSeries.map((serie: any) => ({
            id: serie.tmdb_id,
            name: serie.nome,
            original_name: serie.nome_original,
            overview: serie.descricao,
            poster_path: serie.cover,
            backdrop_path: serie.backcover,
            first_air_date: serie.primeira_exibicao,
            vote_average: serie.avaliacao,
            vote_count: serie.votos,
            popularity: serie.popularidade,
            genre_ids: serie.generos,
            origin_country: serie.paises
          })),
          total_pages: Math.ceil(cachedSeries.length / 20),
          total_results: cachedSeries.length
        };
      }
      
      // Se não tem no cache, buscar do TMDb
      console.log('[CACHE] Cache vazio, buscando do TMDb...');
      const data = await fetchFromTMDb(`/tv/popular?page=${page}`);
      console.log(`[CACHE] TMDb retornou ${data.results?.length || 0} resultados`);
      
      // Salvar no cache em background (não bloquear resposta)
      console.log('[CACHE] Salvando resultados no cache em background...');
      Promise.all(
        data.results.slice(0, 10).map(async (drama: any) => {
          try {
            console.log(`[CACHE] Salvando drama popular ${drama.id} (${drama.name})`);
            await upsertSerieCache(ctx.supabase, drama);
            console.log(`[CACHE] Drama popular ${drama.id} salvo com sucesso`);
          } catch (error) {
            console.error(`[CACHE] Erro ao salvar série ${drama.id} no cache:`, error);
          }
        })
      ).catch(console.error);
      
      return {
        page: data.page,
        results: data.results.map((drama: any) => ({
          id: drama.id,
          name: drama.name,
          original_name: drama.original_name,
          overview: drama.overview,
          poster_path: drama.poster_path,
          backdrop_path: drama.backdrop_path,
          first_air_date: drama.first_air_date,
          vote_average: drama.vote_average,
          vote_count: drama.vote_count,
          popularity: drama.popularity,
          genre_ids: drama.genre_ids,
          origin_country: drama.origin_country
        })),
        total_pages: data.total_pages,
        total_results: data.total_results
      };
      
    } catch (error) {
      console.error('[CACHE] Erro ao buscar doramas populares:', error);
      throw new Error('Erro ao carregar doramas populares');
    }
  });

export const getTrendingDramas = publicProcedure
  .query(async ({ ctx }: { ctx: Context }) => {
    try {
      console.log('[CACHE] getTrendingDramas iniciado');
      
      // Buscar trending do TMDb
      const data = await fetchFromTMDb('/trending/tv/week');
      console.log(`[CACHE] TMDb trending retornou ${data.results?.length || 0} resultados`);
      
      // Salvar no cache em background
      console.log('[CACHE] Salvando trending dramas no cache...');
      Promise.all(
        data.results.slice(0, 10).map(async (drama: any) => {
          try {
            console.log(`[CACHE] Salvando trending drama ${drama.id} (${drama.name})`);
            await upsertSerieCache(ctx.supabase, drama);
            console.log(`[CACHE] Trending drama ${drama.id} salvo com sucesso`);
          } catch (error) {
            console.error(`[CACHE] Erro ao salvar série trending ${drama.id} no cache:`, error);
          }
        })
      ).catch(console.error);
      
      return {
        results: data.results.map((drama: any) => ({
          id: drama.id,
          name: drama.name,
          original_name: drama.original_name,
          overview: drama.overview,
          poster_path: drama.poster_path,
          backdrop_path: drama.backdrop_path,
          first_air_date: drama.first_air_date,
          vote_average: drama.vote_average,
          vote_count: drama.vote_count,
          popularity: drama.popularity,
          genre_ids: drama.genre_ids,
          origin_country: drama.origin_country
        }))
      };
      
    } catch (error) {
      console.error('[CACHE] Erro ao buscar doramas em alta:', error);
      throw new Error('Erro ao carregar doramas em alta');
    }
  });

// Procedure para sincronização manual (apenas para admins)
export const syncSeriesCache = protectedProcedure
  .mutation(async ({ ctx }: { ctx: Context & { user: NonNullable<Context['user']> } }) => {
    try {
      // Buscar séries que precisam ser atualizadas
      const { data: outdatedSeries } = await ctx.supabase.rpc('get_series_to_update', {
        p_max_age_days: 7,
        p_limit: 50
      });
      
      let updated = 0;
      
      for (const serie of outdatedSeries || []) {
        try {
          const tmdbData = await fetchFromTMDb(`/tv/${serie.tmdb_id}`);
          await upsertSerieCache(ctx.supabase, tmdbData);
          updated++;
        } catch (error) {
          console.error(`Erro ao atualizar série ${serie.tmdb_id}:`, error);
        }
      }
      
      return {
        message: `${updated} séries atualizadas com sucesso`,
        updated
      };
      
    } catch (error) {
      console.error('Erro na sincronização:', error);
      throw new Error('Erro ao sincronizar cache');
    }
  });

// Procedure para limpeza do cache (apenas para admins)
export const cleanupCache = protectedProcedure
  .mutation(async ({ ctx }: { ctx: Context & { user: NonNullable<Context['user']> } }) => {
    try {
      const { data: deletedCount } = await ctx.supabase.rpc('cleanup_old_cache_data', {
        p_max_age_days: 90
      });
      
      return {
        message: `${deletedCount} registros antigos removidos`,
        deleted: deletedCount
      };
      
    } catch (error) {
      console.error('Erro na limpeza:', error);
      throw new Error('Erro ao limpar cache');
    }
  });

// Procedure para buscar streaming providers
export const getDramaProviders = publicProcedure
  .input(z.object({ id: z.number() }))
  .query(async ({ input }: { input: { id: number } }) => {
    const { id } = input;
    
    try {
      console.log(`[PROVIDERS] Buscando providers para drama ${id}`);
      
      // Buscar providers do TMDb
      const data = await fetchFromTMDb(`/tv/${id}/watch/providers`);
      console.log(`[PROVIDERS] TMDb retornou providers:`, Object.keys(data.results || {}));
      
      // Focar no Brasil (BR) primeiro, depois outros países
      const brProviders = data.results?.BR;
      const usProviders = data.results?.US;
      const providers = brProviders || usProviders || {};
      
      console.log(`[PROVIDERS] Providers encontrados:`, {
        flatrate: providers.flatrate?.length || 0,
        rent: providers.rent?.length || 0,
        buy: providers.buy?.length || 0
      });
      
      // Retornar providers organizados por tipo
      return {
        country: brProviders ? 'BR' : (usProviders ? 'US' : null),
        flatrate: providers.flatrate || [], // Streaming (Netflix, Prime Video, etc.)
        rent: providers.rent || [], // Aluguel
        buy: providers.buy || [], // Compra
        link: providers.link || null
      };
      
    } catch (error) {
      console.error(`[PROVIDERS] Erro ao buscar providers para drama ${id}:`, error);
      // Retornar vazio em caso de erro
      return {
        country: null,
        flatrate: [],
        rent: [],
        buy: [],
        link: null
      };
    }
  });