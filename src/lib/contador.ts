// Contador exacto de intentos: un Durable Object por visitante y tipo (p. ej. "chip:1.2.3.4").
// Cuenta en una ventana fija y se borra solo al terminar, así no guarda nada de más.
import { DurableObject } from 'cloudflare:workers';

interface Ventana {
  inicio: number;
  intentos: number;
}

export class ContadorIntentos extends DurableObject {
  /** Suma un intento y dice si sigue dentro del límite (`limite` por cada `ventanaMs`). */
  async intentar(limite: number, ventanaMs: number): Promise<boolean> {
    const ahora = Date.now();
    let v = await this.ctx.storage.get<Ventana>('ventana');
    if (!v || ahora - v.inicio >= ventanaMs) {
      v = { inicio: ahora, intentos: 0 };
      // Al terminar la ventana (y un margen) se borra todo: no queda rastro de la IP.
      await this.ctx.storage.setAlarm(ahora + ventanaMs + 5_000);
    }
    v.intentos += 1;
    await this.ctx.storage.put('ventana', v);
    return v.intentos <= limite;
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
