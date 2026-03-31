import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { createClient } from "../../lib/supabase/server";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

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

// POST /api/researches — crea una investigación con sus cuentas
export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json();
  const { name, description, usernames } = body as {
    name: string;
    description?: string;
    usernames: string[];
  };

  if (!name || !usernames?.length) {
    return NextResponse.json(
      { error: "name y usernames son requeridos" },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Crear la investigación con user_id
    const researchResult = await client.query(
      `INSERT INTO researches (name, description, status, user_id) VALUES ($1, $2, 'draft', $3) RETURNING id`,
      [name, description || null, user.id]
    );
    const researchId = researchResult.rows[0].id;

    // 2. Insertar cuentas (upsert por username) y linkear a la investigación
    for (const username of usernames) {
      // Upsert: si la cuenta ya existe, resetear flags para que se re-scrapee
      const accountResult = await client.query(
        `INSERT INTO accounts (username, account_type)
         VALUES ($1, 'competitor')
         ON CONFLICT (username) DO UPDATE SET
           updated_at = NOW(),
           scraped = FALSE,
           posts_scraped = FALSE
         RETURNING id`,
        [username]
      );
      const accountId = accountResult.rows[0].id;

      // Linkear cuenta a investigación
      await client.query(
        `INSERT INTO research_accounts (research_id, account_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [researchId, accountId]
      );
    }

    // 3. Obtener API key de Apify del usuario
    const profileResult = await client.query(
      `SELECT apify_api_key FROM user_profiles WHERE user_id = $1`,
      [user.id]
    );
    const apifyApiKey = profileResult.rows[0]?.apify_api_key || null;

    // 4. Disparar webhook de n8n (si está configurado)
    const webhookUrl = process.env.N8N_RESEARCH_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            research_id: researchId,
            name,
            usernames,
            apify_api_key: apifyApiKey,
          }),
        });
        // Actualizar estado a scraping
        await client.query(
          `UPDATE researches SET status = 'scraping' WHERE id = $1`,
          [researchId]
        );
      } catch {
        // Si el webhook falla, la investigación queda en draft
        console.error("Failed to trigger n8n webhook");
      }
    }

    await client.query("COMMIT");

    return NextResponse.json(
      { id: researchId, name, accounts_count: usernames.length },
      { status: 201 }
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error creating research:", error);
    return NextResponse.json(
      { error: "Error creando la investigación" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
