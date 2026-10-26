import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/min';

/** Enlace wa.me con mensaje prellenado. `numero` en formato internacional (+57...). */
export function enlaceWhatsApp(numero: string, texto: string): string {
  return `https://wa.me/${numero.replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`;
}

/**
 * Convierte lo que escribe el socio en un número internacional (E.164).
 * Acepta el número con o sin indicativo; si no lo trae, usa el país elegido.
 * Devuelve null si el número no es válido.
 */
export function normalizarWhatsapp(numero: string, pais: string): string | null {
  const limpio = numero.trim();
  if (!limpio) return null;
  const tel = parsePhoneNumberFromString(limpio, esPais(pais) ? pais : 'CO');
  return tel?.isValid() ? tel.number : null;
}

export function formatoWhatsapp(numero: string): string {
  return parsePhoneNumberFromString(numero)?.formatInternational() ?? numero;
}

function esPais(pais: string): pais is CountryCode {
  return (getCountries() as string[]).includes(pais);
}

/** Países para el selector, con Colombia primero. */
export function listaPaises(): { codigo: string; nombre: string }[] {
  const nombres = new Intl.DisplayNames(['es'], { type: 'region' });
  const todos = getCountries().map((codigo) => ({
    codigo,
    nombre: `${nombres.of(codigo) ?? codigo} (+${getCountryCallingCode(codigo)})`,
  }));
  todos.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const co = todos.findIndex((p) => p.codigo === 'CO');
  return [todos[co], ...todos.slice(0, co), ...todos.slice(co + 1)];
}
