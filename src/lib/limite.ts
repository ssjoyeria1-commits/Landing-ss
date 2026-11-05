// Límite de intentos por IP con los contadores de Cloudflare (wrangler.jsonc → ratelimits).
// Página del chip: 30 por minuto (nadie la abre tanto; frena a quien prueba códigos al azar).
// Login del panel: 5 por minuto.
import { env } from 'cloudflare:workers';

type Contador = 'LIMITE_CHIP' | 'LIMITE_LOGIN';

/** true si la IP aún puede seguir. Sin contador (servidor local) o si el contador falla, deja pasar. */
export async function dentroDelLimite(contador: Contador, request: Request): Promise<boolean> {
  const limite = (env as Partial<Record<Contador, RateLimit>>)[contador];
  if (!limite) return true;
  const ip = request.headers.get('cf-connecting-ip') ?? 'sin-ip';
  try {
    return (await limite.limit({ key: ip })).success;
  } catch (e) {
    console.error('limite', contador, e);
    return true;
  }
}
