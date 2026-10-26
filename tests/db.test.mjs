// Pruebas de la base de datos: aplica las migraciones sobre PGlite (Postgres en memoria)
// con un entorno mínimo que imita a Supabase (roles anon/authenticated y auth.uid()).
// Ejecutar con: npm run test:db

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const DIR_MIGRACIONES = new URL('../supabase/migrations/', import.meta.url);
const MIGRACIONES = readdirSync(DIR_MIGRACIONES)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(new URL(f, DIR_MIGRACIONES), 'utf8'));

const ADMIN = '00000000-0000-4000-8000-000000000001';
const NO_ADMIN = '00000000-0000-4000-8000-000000000002';

// Lo que Supabase ya trae y la migración da por hecho.
const ENTORNO_SUPABASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

async function nuevaBase() {
  const db = new PGlite();
  await db.exec(ENTORNO_SUPABASE);
  for (const sql of MIGRACIONES) await db.exec(sql);
  await db.exec(`
    insert into auth.users (id) values ('${ADMIN}'), ('${NO_ADMIN}');
    insert into public.admins (user_id, nombre) values ('${ADMIN}', 'Socio');
  `);
  return db;
}

async function como(db, rol, usuario, fn) {
  await db.exec(`set role ${rol}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [usuario ?? '']);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}

async function uno(db, sql, params = []) {
  const { rows } = await db.query(sql, params);
  return rows[0];
}

let telefono = 3000000000;
function nuevoWhatsapp() {
  telefono += 1;
  return `+57${telefono}`;
}

function pieza(descripcion = 'Cadena') {
  return { descripcion, peso_gramos: 5.25, ley: '18k' };
}

/** Registra una venta como admin y devuelve el JSON de registrar_venta. */
async function venta(db, { whatsapp, nombre = 'María', monto = 700000, referidoDe, cajas, autoriza = true } = {}) {
  const payload = {
    cliente: { whatsapp: whatsapp ?? nuevoWhatsapp(), nombre, autorizo_datos: autoriza },
    codigo_referido_de: referidoDe,
    monto_cop: monto,
    cajas: cajas ?? [{ es_regalo: false, piezas: [pieza()] }],
  };
  return como(db, 'authenticated', ADMIN, async () =>
    (await uno(db, 'select public.registrar_venta($1) as r', [payload])).r,
  );
}

async function interacciones(db, clienteId) {
  return como(db, 'authenticated', ADMIN, async () =>
    uno(db, 'select * from public.clientes_circulo where id = $1', [clienteId]),
  );
}

async function pagina(db, codigo) {
  return como(db, 'anon', null, async () => (await uno(db, 'select public.pagina_caja($1) as p', [codigo])).p);
}

// ---------------------------------------------------------------------------

test('registra un cliente nuevo con códigos en el formato correcto', async () => {
  const db = await nuevaBase();
  const r = await venta(db, { nombre: '  María   José ' });

  assert.equal(r.cliente.creado, true);
  assert.match(r.cliente.codigo_referido, /^MARIA-\d{4}$/);
  assert.equal(r.cajas.length, 1);
  assert.match(r.cajas[0].codigo_chip, /^[a-km-np-z2-9]{10}$/);
  assert.match(r.cajas[0].referencia, /^SS-[A-HJ-NP-Z2-9]{5}$/);
});

test('el código de referido quita tildes y eñes y tiene respaldo para nombres sin letras latinas', async () => {
  const db = await nuevaBase();
  assert.match((await venta(db, { nombre: 'Ñuño' })).cliente.codigo_referido, /^NUNO-\d{4}$/);
  assert.match((await venta(db, { nombre: 'ángela' })).cliente.codigo_referido, /^ANGELA-\d{4}$/);
  assert.match((await venta(db, { nombre: '李' })).cliente.codigo_referido, /^SS-\d{4}$/);
});

test('los códigos de chip son distintos entre cajas', async () => {
  const db = await nuevaBase();
  const cajas = Array.from({ length: 20 }, () => ({ piezas: [pieza()] }));
  const r = await venta(db, { cajas });
  assert.equal(new Set(r.cajas.map((c) => c.codigo_chip)).size, 20);
  assert.equal(new Set(r.cajas.map((c) => c.referencia)).size, 20);
});

test('las compras de menos de 600.000 no cuentan, tampoco la primera', async () => {
  const db = await nuevaBase();
  const whatsapp = nuevoWhatsapp();
  const r = await venta(db, { whatsapp, monto: 400000 });
  assert.equal((await interacciones(db, r.cliente.id)).interacciones, 0);

  await venta(db, { whatsapp, monto: 600000 });
  assert.equal((await interacciones(db, r.cliente.id)).interacciones, 1);

  await venta(db, { whatsapp, monto: 599999 });
  assert.equal((await interacciones(db, r.cliente.id)).interacciones, 1);
});

test('del referido solo suma su primera compra que califique', async () => {
  const db = await nuevaBase();
  const a = await venta(db, { nombre: 'Juan' });
  assert.equal((await interacciones(db, a.cliente.id)).interacciones, 1);

  const whatsappB = nuevoWhatsapp();
  const b = await venta(db, { whatsapp: whatsappB, nombre: 'Ana', monto: 400000, referidoDe: a.cliente.codigo_referido.toLowerCase() });
  assert.equal((await interacciones(db, a.cliente.id)).interacciones, 1, 'la compra menor del referido no suma');

  await venta(db, { whatsapp: whatsappB, monto: 700000 });
  assert.equal((await interacciones(db, a.cliente.id)).interacciones, 2, 'la primera que califica sí suma');

  await venta(db, { whatsapp: whatsappB, monto: 900000 });
  const fila = await interacciones(db, a.cliente.id);
  assert.equal(fila.interacciones, 2, 'las siguientes no suman');
  assert.equal(fila.propias, 1);
  assert.equal(fila.por_referidos, 1);

  const filaB = await interacciones(db, b.cliente.id);
  assert.equal(filaB.interacciones, 2, 'al referido le cuentan sus propias compras');
  assert.equal(filaB.referido_por_codigo, a.cliente.codigo_referido);
});

test('solo se puede asignar referido a un cliente nuevo', async () => {
  const db = await nuevaBase();
  const a = await venta(db, { nombre: 'Juan' });
  const whatsapp = nuevoWhatsapp();
  await venta(db, { whatsapp, nombre: 'Ana' });

  await assert.rejects(
    venta(db, { whatsapp, referidoDe: a.cliente.codigo_referido }),
    /Solo se puede asignar un referido a un cliente nuevo/,
  );
});

test('rechaza códigos de referido inexistentes y clientes nuevos sin autorización de datos', async () => {
  const db = await nuevaBase();
  await assert.rejects(venta(db, { referidoDe: 'NADIE-0000' }), /No existe el código de referido NADIE-0000/);
  await assert.rejects(venta(db, { autoriza: false }), /Falta la autorización/);
});

test('rechaza ventas sin cajas o cajas sin piezas, sin dejar datos a medias', async () => {
  const db = await nuevaBase();
  await assert.rejects(venta(db, { cajas: [] }), /al menos una caja/);
  await assert.rejects(venta(db, { cajas: [{ piezas: [] }] }), /al menos una pieza/);
  assert.equal((await uno(db, 'select count(*)::int as n from public.clientes')).n, 0);
  assert.equal((await uno(db, 'select count(*)::int as n from public.ventas')).n, 0);
});

test('el contador se detiene en 10 y los premios no se entregan dos veces', async () => {
  const db = await nuevaBase();
  const whatsapp = nuevoWhatsapp();
  const r = await venta(db, { whatsapp });
  for (let i = 0; i < 11; i++) await venta(db, { whatsapp });

  let fila = await interacciones(db, r.cliente.id);
  assert.equal(fila.propias, 12);
  assert.equal(fila.interacciones, 10);
  assert.equal(fila.proximo_hito, null);
  assert.deepEqual(fila.premios_pendientes, [3, 5, 10]);

  await como(db, 'authenticated', ADMIN, () =>
    db.query('insert into public.premios (cliente_id, hito) values ($1, 3)', [r.cliente.id]),
  );
  fila = await interacciones(db, r.cliente.id);
  assert.deepEqual(fila.premios_pendientes, [5, 10]);

  await assert.rejects(
    como(db, 'authenticated', ADMIN, () =>
      db.query('insert into public.premios (cliente_id, hito) values ($1, 3)', [r.cliente.id]),
    ),
    /premios_una_vez/,
  );
});

test('una venta anulada no cuenta y su chip deja de funcionar', async () => {
  const db = await nuevaBase();
  const r = await venta(db);
  assert.equal((await interacciones(db, r.cliente.id)).interacciones, 1);

  await como(db, 'authenticated', ADMIN, () =>
    db.query('update public.ventas set anulada = true where id = $1', [r.venta_id]),
  );
  assert.equal((await interacciones(db, r.cliente.id)).interacciones, 0);
  assert.equal(await pagina(db, r.cajas[0].codigo_chip), null);
  assert.ok((await uno(db, 'select anulada_at from public.ventas where id = $1', [r.venta_id])).anulada_at);
});

test('el referido y el código de referido de un cliente no se pueden cambiar', async () => {
  const db = await nuevaBase();
  const a = await venta(db, { nombre: 'Juan' });
  const b = await venta(db, { nombre: 'Ana' });

  await assert.rejects(
    como(db, 'authenticated', ADMIN, () =>
      db.query('update public.clientes set referido_por = $1 where id = $2', [a.cliente.id, b.cliente.id]),
    ),
    /no se puede cambiar/,
  );
  await assert.rejects(
    como(db, 'authenticated', ADMIN, () =>
      db.query(`update public.clientes set codigo_referido = 'OTRO-1111' where id = $1`, [b.cliente.id]),
    ),
    /no se puede cambiar/,
  );
});

test('página de compra propia: solo datos públicos, mismo contador en todas las cajas y registra el escaneo', async () => {
  const db = await nuevaBase();
  const whatsapp = nuevoWhatsapp();
  const r = await venta(db, {
    whatsapp,
    nombre: 'María José',
    cajas: [{ piezas: [pieza('Cadena'), pieza('Dije')] }, { piezas: [pieza('Anillo')] }],
  });

  const p = await pagina(db, r.cajas[0].codigo_chip);
  assert.equal(p.tipo, 'propia');
  assert.equal(p.nombre, 'María');
  assert.equal(p.referencia, r.cajas[0].referencia);
  assert.deepEqual(p.piezas.map((x) => x.descripcion), ['Cadena', 'Dije']);
  assert.deepEqual(p.circulo, { interacciones: 1, hitos: [3, 5, 10], proximo_hito: 3, codigo_referido: r.cliente.codigo_referido });

  const texto = JSON.stringify(p);
  assert.ok(!texto.includes(whatsapp.slice(3)), 'no expone el WhatsApp');
  assert.ok(!texto.includes(r.cliente.id) && !texto.includes(r.venta_id) && !texto.includes(r.cajas[0].id), 'no expone ids');
  assert.ok(!texto.includes(r.cajas[0].codigo_chip), 'no repite el código del chip');

  const otra = await pagina(db, r.cajas[1].codigo_chip);
  assert.equal(otra.circulo.interacciones, p.circulo.interacciones);

  assert.equal((await uno(db, 'select count(*)::int as n from public.escaneos')).n, 2);
});

test('página de regalo: nombres y código del comprador, sin contador', async () => {
  const db = await nuevaBase();
  const r = await venta(db, {
    nombre: 'Carlos Andrés',
    cajas: [
      { es_regalo: true, nombre_destinatario: 'Laura', piezas: [pieza()] },
      { es_regalo: true, nombre_destinatario: '  ', piezas: [pieza()] },
    ],
  });

  const p = await pagina(db, r.cajas[0].codigo_chip);
  assert.equal(p.tipo, 'regalo');
  assert.equal(p.nombre_destinatario, 'Laura');
  assert.equal(p.nombre_comprador, 'Carlos');
  assert.equal(p.codigo_referido_comprador, r.cliente.codigo_referido);
  assert.equal(p.circulo, undefined);
  assert.equal(p.piezas.length, 1);

  assert.equal((await pagina(db, r.cajas[1].codigo_chip)).nombre_destinatario, null);
});

test('códigos inexistentes o mal formados devuelven null y no registran escaneo', async () => {
  const db = await nuevaBase();
  await venta(db);
  for (const codigo of ['abcdefghjk', 'ABC', "x' or 1=1 --", '', null]) {
    assert.equal(await pagina(db, codigo), null);
  }
  assert.equal((await uno(db, 'select count(*)::int as n from public.escaneos')).n, 0);
});

test('regenerar_chip invalida el código anterior', async () => {
  const db = await nuevaBase();
  const r = await venta(db);
  const anterior = r.cajas[0].codigo_chip;
  const nuevo = await como(db, 'authenticated', ADMIN, async () =>
    (await uno(db, 'select public.regenerar_chip($1) as c', [r.cajas[0].id])).c,
  );
  assert.notEqual(nuevo, anterior);
  assert.equal(await pagina(db, anterior), null);
  assert.equal((await pagina(db, nuevo)).tipo, 'propia');
});

test('el visitante anónimo no puede leer tablas ni usar funciones del panel', async () => {
  const db = await nuevaBase();
  const r = await venta(db);

  for (const tabla of ['clientes', 'ventas', 'cajas', 'piezas', 'premios', 'escaneos', 'admins', 'clientes_circulo']) {
    await assert.rejects(
      como(db, 'anon', null, () => db.query(`select * from public.${tabla}`)),
      /permission denied/,
      `anon no debe leer ${tabla}`,
    );
  }
  await assert.rejects(
    como(db, 'anon', null, () => db.query('select public.registrar_venta($1)', [{}])),
    /permission denied/,
  );
  await assert.rejects(
    como(db, 'anon', null, () => db.query('select public.regenerar_chip($1)', [r.cajas[0].id])),
    /permission denied/,
  );
  await assert.rejects(
    como(db, 'anon', null, () => db.query('select * from privado.circulo_conteo()')),
    /permission denied/,
  );
});

test('un usuario autenticado que no es admin no ve ni registra nada', async () => {
  const db = await nuevaBase();
  await venta(db);

  const filas = await como(db, 'authenticated', NO_ADMIN, async () => {
    const tablas = ['clientes', 'ventas', 'cajas', 'piezas', 'escaneos', 'admins', 'clientes_circulo'];
    const conteos = [];
    for (const t of tablas) conteos.push((await uno(db, `select count(*)::int as n from public.${t}`)).n);
    return conteos;
  });
  assert.deepEqual(filas, [0, 0, 0, 0, 0, 0, 0]);

  await assert.rejects(
    como(db, 'authenticated', NO_ADMIN, () =>
      db.query('select public.registrar_venta($1)', [{ cajas: [{ piezas: [pieza()] }] }]),
    ),
    /No autorizado/,
  );
});
