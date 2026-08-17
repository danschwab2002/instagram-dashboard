import { NextRequest, NextResponse, after } from "next/server";
import { pool, withTransaction } from "../../lib/pool";
import { normalizeUsernames } from "../../lib/instagram-username";
import { runResearchPipeline } from "../../lib/jobs/research-pipeline";
import { createClient } from "../../lib/supabase/server";

async function getUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// GET /api/researches — lista investigaciones del usuario
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const result = await pool.query(`
    SELECT
      r.id, r.name, r.description, r.status, r.created_at,
      COUNT(ra.account_id)::int as accounts_count
    FROM researches r
    LEFT JOIN research_accounts ra ON ra.research_id = r.id
    WHERE r.user_id = $1
    GROUP BY r.id
    ORDER BY r.created_at DESC
  `, [user.id]);

  return NextResponse.json(result.rows);
}

// POST /api/researches — crea una investigación y dispara su scraping
export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  let body: {
    name?: string;
    description?: string;
    usernames?: unknown[];
    days_back?: number;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido: se esperaba JSON" }, { status: 400 });
  }

  const { name, description, usernames, days_back } = body ?? {};
  const daysBack = Math.max(1, Math.min(365, Number(days_back) || 30));

  if (!name?.trim() || !Array.isArray(usernames) || usernames.length === 0) {
    return NextResponse.json(
      { error: "name y usernames son requeridos" },
      { status: 400 }
    );
  }

  // El form ya limpia los usernames, pero la API es publica a cualquier cliente
  // y `accounts.username` es UNIQUE: sin normalizar, "Tesla" y "tesla" crean dos
  // filas para la misma cuenta de Instagram.
  const cleanUsernames = normalizeUsernames(usernames);
  if (cleanUsernames.length === 0) {
    return NextResponse.json(
      { error: "Ninguno de los usernames es válido" },
      { status: 400 }
    );
  }

  // Se valida ANTES de crear nada: sin token el scraping falla igual, pero en
  // background — y el usuario se queda mirando una investigación que nunca
  // avanza sin saber por qué.
  const apifyToken = await resolveApifyToken(user.id);
  if (!apifyToken) {
    return NextResponse.json(
      { error: "Cargá tu API key de Apify en Configuración antes de scrapear" },
      { status: 400 }
    );
  }

  let researchId: number;

  try {
    researchId = await withTransaction(async (client) => {
      const research = await client.query<{ id: number }>(
        `INSERT INTO researches (name, description, status, user_id, days_back)
         VALUES ($1, $2, 'scraping', $3, $4)
         RETURNING id`,
        [name.trim(), description?.trim() || null, user.id, daysBack]
      );
      const id = research.rows[0].id;

      // Un solo INSERT para todas las cuentas en vez de N round-trips.
      // El upsert resetea los flags para que una cuenta ya conocida se
      // re-scrapee en el contexto de esta investigación (LES-009).
      const accounts = await client.query<{ id: number }>(
        `INSERT INTO accounts (username, account_type)
         SELECT u, 'competitor' FROM UNNEST($1::text[]) AS u
         ON CONFLICT (username) DO UPDATE SET
           updated_at          = NOW(),
           scraped             = FALSE,
           posts_scraped       = FALSE,
           scrape_status       = 'pending',
           posts_scrape_status = 'pending'
         RETURNING id`,
        [cleanUsernames]
      );

      await client.query(
        `INSERT INTO research_accounts (research_id, account_id)
         SELECT $1, a FROM UNNEST($2::int[]) AS a
         ON CONFLICT DO NOTHING`,
        [id, accounts.rows.map((row) => row.id)]
      );

      return id;
    });
  } catch (error) {
    console.error("Error creando la investigación:", error);
    return NextResponse.json(
      { error: "Error creando la investigación" },
      { status: 500 }
    );
  }

  // El scraping tarda minutos: se dispara DESPUES de responder. `after` es de
  // Next: mantiene vivo el trabajo una vez enviada la respuesta, sin bloquearla.
  // Antes esto era un fetch al webhook de n8n hecho DENTRO de la transacción,
  // que dejaba una conexión de Postgres tomada durante toda la llamada HTTP.
  //
  // Si el proceso muere a mitad, las cuentas quedan reclamadas y vuelven solas a
  // la cola pasados 15 min; se reintenta con `npm run scrape:profiles -- --research <id>`.
  after(() => runResearchPipeline(researchId));

  return NextResponse.json(
    { id: researchId, name: name.trim(), accounts_count: cleanUsernames.length },
    { status: 201 }
  );
}

/** El token del usuario manda; APIFY_TOKEN del entorno es el fallback compartido. */
async function resolveApifyToken(userId: string): Promise<string | null> {
  const result = await pool.query<{ apify_api_key: string | null }>(
    `SELECT apify_api_key FROM user_profiles WHERE user_id = $1`,
    [userId]
  );

  return result.rows[0]?.apify_api_key || process.env.APIFY_TOKEN || null;
}
