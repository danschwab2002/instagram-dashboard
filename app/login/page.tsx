"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/browser";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    const supabase = createClient();
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        router.push("/");
        router.refresh();
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        setMessage("Cuenta creada. Revisá tu email para confirmar.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
      <div className="w-full max-w-sm p-6 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]">
        <div className="mb-6 text-center">
          <h1 className="text-sm font-bold tracking-wide text-indigo-400 uppercase">
            Antigravity
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">Content Dashboard</p>
        </div>

        <div className="flex gap-1 mb-4 p-0.5 rounded bg-[var(--bg-tertiary)]">
          <button
            onClick={() => { setMode("login"); setError(""); setMessage(""); }}
            className={`flex-1 py-1.5 text-sm rounded transition-colors ${
              mode === "login"
                ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)]"
            }`}
          >
            Iniciar sesión
          </button>
          <button
            onClick={() => { setMode("signup"); setError(""); setMessage(""); }}
            className={`flex-1 py-1.5 text-sm rounded transition-colors ${
              mode === "signup"
                ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)]"
            }`}
          >
            Crear cuenta
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 text-sm rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-3 py-2 text-sm rounded border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-indigo-500"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
          {message && <p className="text-xs text-green-400">{message}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 text-sm rounded bg-indigo-500 text-white hover:bg-indigo-600 transition-colors disabled:opacity-50"
          >
            {loading
              ? "Cargando..."
              : mode === "login"
              ? "Iniciar sesión"
              : "Crear cuenta"}
          </button>
        </form>
      </div>
    </div>
  );
}
