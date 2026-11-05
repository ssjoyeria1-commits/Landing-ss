// Límite de intentos por IP con un contador exacto (Durable Object ContadorIntentos, src/lib/contador.ts).
// Página del chip: 30 por minuto (nadie la abre tanto; frena a quien prueba códigos al azar).
// Login del panel: 5 por minuto.
import { env } from 'cloudflare:workers';

const LIMITES = {
  chip: { limite: 30, ventanaMs: 60_000 },
  login: { limite: 5, ventanaMs: 60_000 },
} as const;

/** true si la IP aún puede seguir. Sin contador (servidor local) o si el contador falla, deja pasar. */
export async function dentroDelLimite(tipo: keyof typeof LIMITES, request: Request): Promise<boolean> {
  const contadores = (env as Partial<Cloudflare.Env>).CONTADOR;
  if (!contadores) return true;
  const ip = request.headers.get('cf-connecting-ip') ?? 'sin-ip';
  const { limite, ventanaMs } = LIMITES[tipo];
  try {
    const contador = contadores.get(contadores.idFromName(`${tipo}:${ip}`));
    return await contador.intentar(limite, ventanaMs);
  } catch (e) {
    console.error('limite', tipo, e);
    return true;
  }
}
