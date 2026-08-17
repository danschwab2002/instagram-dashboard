import { z } from "zod";
import { runActorSync, type RunActorOptions } from "./client";

/**
 * Actor de posts de Instagram.
 *
 * ⚠ NO es el mismo actor que el de perfiles. DEC-001 eligio el actor oficial
 * `apify/instagram-profile-scraper` explicitamente **para perfiles**; para posts
 * hace falta apidojo, porque es el unico de los dos que devuelve
 * `videoViewCount`, `sharesCount`, `videoDuration`, `productType` y
 * `isPaidPartnership` — o sea, casi todo lo que alimenta las metricas:
 *
 *   engagement_rate    = (likes + comments + shares) / followers   → sharesCount
 *   performance_score  = views normalizadas * 0.6 + engagement * 0.4 → videoViewCount
 *   outlier scores     → videoViewCount
 *
 * Con el actor oficial esas columnas quedarian todas en null y el dashboard
 * ordenaria por campos vacios. Verificado comparando los JSON de ejemplo de
 * ambos actores en apify-documentation/.
 *
 * Actor ID interno: VLKR1emKm1YGLmiuZ.
 */
export const POST_SCRAPER_ACTOR = "apidojo~instagram-scraper-api";

/** Techo de posts por cuenta. Los primeros 10 son gratis; el resto ~$0.0005 c/u. */
export const DEFAULT_MAX_POSTS = 200;

/**
 * Forma del post que devuelve el actor.
 *
 * Casi todo es opcional: un post Image no trae ninguno de los campos de video,
 * y una cuenta sin ubicacion no trae locationName. Solo `shortCode` y `type`
 * son estructurales — sin ellos no hay fila que guardar.
 */
const apifyPostSchema = z.object({
  id: z.union([z.string(), z.number()]).nullish(),
  shortCode: z.string().min(1),
  // La tabla `posts` tiene un CHECK sobre estos tres valores exactos.
  type: z.enum(["Image", "Video", "Sidecar"]),
  url: z.string().nullish(),
  caption: z.string().nullish(),
  hashtags: z.array(z.string()).nullish(),
  mentions: z.array(z.string()).nullish(),
  likesCount: z.coerce.number().int().nullish(),
  commentsCount: z.coerce.number().int().nullish(),
  sharesCount: z.coerce.number().int().nullish(),
  videoViewCount: z.coerce.number().int().nullish(),
  videoPlayCount: z.coerce.number().int().nullish(),
  videoDuration: z.coerce.number().nullish(),
  displayUrl: z.string().nullish(),
  dimensionsWidth: z.coerce.number().int().nullish(),
  dimensionsHeight: z.coerce.number().int().nullish(),
  locationName: z.string().nullish(),
  locationId: z.union([z.string(), z.number()]).nullish(),
  isPaidPartnership: z.boolean().nullish(),
  productType: z.string().nullish(),
  transcript: z.string().nullish(),
  timestamp: z.string().nullish(),
  ownerUsername: z.string().nullish(),
});

export type ApifyPost = z.infer<typeof apifyPostSchema>;

/** Post ya mapeado a columnas de la tabla `posts`, con sus relaciones aparte. */
export interface PostRecord {
  instagram_id: string | null;
  short_code: string;
  url: string | null;
  type: "Image" | "Video" | "Sidecar";
  caption: string | null;
  likes_count: number;
  comments_count: number;
  shares_count: number;
  video_view_count: number | null;
  video_play_count: number | null;
  video_duration: number | null;
  display_url: string | null;
  dimensions_width: number | null;
  dimensions_height: number | null;
  location_name: string | null;
  location_id: string | null;
  is_paid_partnership: boolean;
  product_type: string | null;
  transcript: string | null;
  posted_at: string | null;
  /** Van a post_hashtags via upsert_post_hashtags(). */
  hashtags: string[];
  /** Van a post_mentions via upsert_post_mentions(). */
  mentions: string[];
}

export interface ScrapePostsOptions extends RunActorOptions {
  /** Solo posts publicados a partir de esta fecha (YYYY-MM-DD). */
  desde?: string;
  /** Techo de posts a traer. Default 200. */
  maxItems?: number;
}

export interface ScrapePostsOutcome {
  posts: PostRecord[];
  /** Items que vinieron con una forma que no se puede guardar. */
  descartados: Array<{ shortCode: string; motivo: string }>;
}

/**
 * Trae los posts de una cuenta, ya mapeados a columnas de `posts`.
 *
 * Un item con forma invalida (un `type` que no existe en el CHECK de la tabla,
 * un post sin shortCode) se descarta y se reporta, pero NO tumba a los demas:
 * en un feed de 200 posts, uno raro no puede costar los otros 199.
 */
export async function scrapePosts(
  username: string,
  options: ScrapePostsOptions
): Promise<ScrapePostsOutcome> {
  const input: Record<string, unknown> = {
    startUrls: [`https://www.instagram.com/${username}`],
    maxItems: options.maxItems ?? DEFAULT_MAX_POSTS,
  };

  // El actor lo llama `until`, pero significa "no traigas nada ANTERIOR a esta
  // fecha". Filtrar del lado de Apify es lo que evita pagar por posts viejos.
  if (options.desde) {
    input.until = options.desde;
  }

  const items = await runActorSync<unknown>(POST_SCRAPER_ACTOR, input, options);

  const posts: PostRecord[] = [];
  const descartados: ScrapePostsOutcome["descartados"] = [];

  for (const item of items) {
    const parsed = apifyPostSchema.safeParse(item);

    if (!parsed.success) {
      const shortCode =
        (item as { shortCode?: string })?.shortCode ?? "(sin shortCode)";
      descartados.push({
        shortCode,
        motivo: parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
      });
      continue;
    }

    posts.push(toPostRecord(parsed.data));
  }

  return { posts, descartados };
}

export function toPostRecord(post: ApifyPost): PostRecord {
  return {
    instagram_id: post.id != null ? String(post.id) : null,
    short_code: post.shortCode,
    url: post.url ?? null,
    type: post.type,
    caption: post.caption ?? null,
    // El actor devuelve -1 cuando la cuenta oculta el contador. Guardarlo tal
    // cual daria un engagement_rate negativo: (-1 + comments) / followers.
    likes_count: contadorValido(post.likesCount),
    comments_count: contadorValido(post.commentsCount),
    shares_count: contadorValido(post.sharesCount),
    video_view_count: contadorOpcional(post.videoViewCount),
    video_play_count: contadorOpcional(post.videoPlayCount),
    video_duration: post.videoDuration ?? null,
    display_url: post.displayUrl ?? null,
    dimensions_width: post.dimensionsWidth ?? null,
    dimensions_height: post.dimensionsHeight ?? null,
    location_name: post.locationName ?? null,
    location_id: post.locationId != null ? String(post.locationId) : null,
    is_paid_partnership: post.isPaidPartnership ?? false,
    product_type: post.productType ?? null,
    transcript: post.transcript ?? null,
    posted_at: post.timestamp ?? null,
    hashtags: dedupeMinusculas(post.hashtags),
    mentions: dedupeMinusculas(post.mentions),
  };
}

/** Un contador oculto (-1) o ausente vale 0. */
function contadorValido(valor: number | null | undefined): number {
  return valor != null && valor >= 0 ? valor : 0;
}

/** Igual, pero distingue "no aplica" (una foto no tiene views) de "cero". */
function contadorOpcional(valor: number | null | undefined): number | null {
  if (valor == null) return null;
  return valor >= 0 ? valor : null;
}

/** Las funciones SQL ya hacen lower(), pero deduplicar antes ahorra viajes. */
function dedupeMinusculas(valores: string[] | null | undefined): string[] {
  if (!valores?.length) return [];
  return [...new Set(valores.map((v) => v.trim().toLowerCase()).filter(Boolean))];
}
