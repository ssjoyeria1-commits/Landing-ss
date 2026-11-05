// Las variables vienen de wrangler.jsonc (tipos en worker-configuration.d.ts, `npm run types`).
// No se usan los tipos completos del runtime de Workers porque chocan con los del navegador: aquí
// van solo los que usa el proyecto (el Durable Object del contador de intentos).

interface DurableObjectStorage {
  get<T>(clave: string): Promise<T | undefined>;
  put<T>(clave: string, valor: T): Promise<void>;
  setAlarm(momento: number): Promise<void>;
  deleteAll(): Promise<void>;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
}

interface DurableObjectId {}

/** Stub de un Durable Object: sus métodos públicos se llaman por RPC (devuelven promesas). */
type DurableObjectStub<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never;
};

interface DurableObjectNamespace<T = unknown> {
  idFromName(nombre: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub<T>;
}

declare module 'cloudflare:workers' {
  export const env: Cloudflare.Env;
  export abstract class DurableObject<E = Cloudflare.Env> {
    protected ctx: DurableObjectState;
    protected env: E;
    constructor(ctx: DurableObjectState, env: E);
  }
}

declare namespace App {
  interface Locals {
    supabase: import('./lib/supabase').Supabase;
    /** Presente solo si la sesión es de un admin. */
    usuario?: { id: string; email: string };
  }
}
