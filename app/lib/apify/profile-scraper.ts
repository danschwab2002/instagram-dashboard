import { z } from "zod";
import { runActorSync, type RunActorOptions } from "./client";

/**
 * Actor de perfiles de Instagram.
 *
 * DEC-001: es el actor oficial de Apify. Se probo antes `apidojo/instagram-scraper-api`
 * y Dan lo cambio por este tras testear. No cambiar sin revisar esa decision.
 */
export const PROFILE_SCRAPER_ACTOR = "apify~instagram-profile-scraper";

/**
 * Forma del perfil que devuelve el actor.
 *
 * Todo es opcional salvo `username`: Instagram no expone los mismos campos para
 * toda cuenta (una cuenta privada no trae postsCount, una personal no trae
 * businessCategoryName) y el actor omite lo que no consigue. Validar estricto
 * haria fallar cuentas perfectamente scrapeables.
 */
const apifyProfileSchema = z.object({
  id: z.union([z.string(), z.number()]).nullish(),
  username: z.string().min(1),
  fullName: z.string().nullish(),
  biography: z.string().nullish(),
  externalUrl: z.string().nullish(),
  followersCount: z.coerce.number().int().nonnegative().nullish(),
  followsCount: z.coerce.number().int().nonnegative().nullish(),
  postsCount: z.coerce.number().int().nonnegative().nullish(),
  isBusinessAccount: z.boolean().nullish(),
  businessCategoryName: z.string().nullish(),
  verified: z.boolean().nullish(),
  private: z.boolean().nullish(),
  profilePicUrl: z.string().nullish(),
  profilePicUrlHD: z.string().nullish(),
  // El actor mete un campo `error` en el item cuando no pudo resolver la cuenta.
  error: z.string().nullish(),
});

export type ApifyProfile = z.infer<typeof apifyProfileSchema>;

/** Perfil ya mapeado a columnas de la tabla `accounts`. */
export interface AccountProfile {
  instagram_id: string | null;
  username: string;
  full_name: string | null;
  biography: string | null;
  external_url: string | null;
  followers_count: number;
  follows_count: number;
  posts_count: number;
  is_business_account: boolean;
  business_category: string | null;
  is_verified: boolean;
  is_private: boolean;
  profile_pic_url: string | null;
}

/** La cuenta no existe, fue dada de baja, o Apify no devolvio nada para ella. */
export class ProfileNotFoundError extends Error {
  constructor(readonly username: string, detail?: string) {
    super(
      `Apify no devolvio perfil para @${username}` + (detail ? `: ${detail}` : "")
    );
    this.name = "ProfileNotFoundError";
  }
}

/** La respuesta llego pero no tiene la forma esperada. */
export class ProfileShapeError extends Error {
  constructor(readonly username: string, readonly issues: string) {
    super(`Perfil de @${username} con forma inesperada: ${issues}`);
    this.name = "ProfileShapeError";
  }
}

/**
 * Scrapea un perfil y lo devuelve ya mapeado a columnas de `accounts`.
 *
 * Mapeo tomado de scripts/test_mapping.py, que quedo validado contra la DB real.
 * Suma `external_url`, `profile_pic_url` y `follows_count`, que el WF2 de n8n
 * nunca escribia — por eso las fotos de perfil estaban vacias en el dashboard.
 */
export async function scrapeProfile(
  username: string,
  options: RunActorOptions
): Promise<AccountProfile> {
  const items = await runActorSync<unknown>(
    PROFILE_SCRAPER_ACTOR,
    {
      usernames: [username],
      // La seccion "about" agrega latencia y no usamos ninguno de sus campos.
      includeAboutSection: false,
    },
    options
  );

  if (items.length === 0) {
    throw new ProfileNotFoundError(username);
  }

  const parsed = apifyProfileSchema.safeParse(items[0]);
  if (!parsed.success) {
    throw new ProfileShapeError(
      username,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    );
  }

  if (parsed.data.error) {
    throw new ProfileNotFoundError(username, parsed.data.error);
  }

  return toAccountProfile(parsed.data);
}

export function toAccountProfile(profile: ApifyProfile): AccountProfile {
  return {
    instagram_id: profile.id != null ? String(profile.id) : null,
    username: profile.username,
    full_name: profile.fullName ?? null,
    biography: profile.biography ?? null,
    external_url: profile.externalUrl ?? null,
    followers_count: profile.followersCount ?? 0,
    follows_count: profile.followsCount ?? 0,
    posts_count: profile.postsCount ?? 0,
    is_business_account: profile.isBusinessAccount ?? false,
    business_category: profile.businessCategoryName ?? null,
    is_verified: profile.verified ?? false,
    is_private: profile.private ?? false,
    // La HD es la misma imagen en mejor resolucion; si no viene, cae a la normal.
    profile_pic_url: profile.profilePicUrlHD ?? profile.profilePicUrl ?? null,
  };
}
