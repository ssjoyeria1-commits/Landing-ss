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
  -- Lo mínimo de Supabase Storage para probar las políticas del bucket.
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text);
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated;
  grant all on storage.objects to anon, authenticated;
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
async function venta(db, { whatsapp, nombre = 'María', monto = 700000, referidoDe, cajas, autoriza = true, descuento } = {}) {
  const payload = {
    cliente: { whatsapp: whatsapp ?? nuevoWhatsapp(), nombre, autorizo_datos: autoriza },
    codigo_referido_de: referidoDe,
    monto_cop: monto,
    descuento_cop: descuento,
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

  // Entregar = anotar la fecha del premio que ya existe.
  await como(db, 'authenticated', ADMIN, () =>
    db.query('update public.premios set fecha_entrega = privado.hoy() where cliente_id = $1 and hito = 3', [r.cliente.id]),
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

test('caja de premio: el premio y su chip se crean solos al llegar al nivel; entregar solo anota la fecha', async () => {
  const db = await nuevaBase();
  const whatsapp = nuevoWhatsapp();
  const r = await venta(db, { whatsapp, nombre: 'Valentina Gómez' });
  const premios = () =>
    como(db, 'authenticated', ADMIN, async () =>
      (await db.query('select hito, fecha_entrega from public.premios where cliente_id = $1 order by hito', [r.cliente.id])).rows,
    );
  assert.deepEqual(await premios(), [], 'con 1 interacción todavía no hay premio');

  const ventas = [];
  for (let i = 0; i < 4; i++) ventas.push(await venta(db, { whatsapp }));
  assert.deepEqual((await premios()).map((p) => [p.hito, p.fecha_entrega]), [[3, null], [5, null]], 'pendientes, sin fecha');

  // Una anulación que lo baja de nivel borra el premio no entregado; el entregado se queda.
  await como(db, 'authenticated', ADMIN, async () => {
    await db.query('update public.premios set fecha_entrega = privado.hoy() where cliente_id = $1 and hito = 3', [r.cliente.id]);
    await db.query('update public.ventas set anulada = true where id = $1', [ventas[3].venta_id]);
  });
  assert.deepEqual((await premios()).map((p) => p.hito), [3], 'con 4 interacciones ya no está el de 5');
  await como(db, 'authenticated', ADMIN, () => db.query('update public.ventas set anulada = false where id = $1', [ventas[3].venta_id]));

  const premio = await como(db, 'authenticated', ADMIN, () =>
    uno(
      db,
      "update public.premios set detalle = 'Tejido cartier, 2,1 g', nota = 'nota interna' where cliente_id = $1 and hito = 5 returning codigo_chip, referencia",
      [r.cliente.id],
    ),
  );
  assert.match(premio.codigo_chip, /^[a-km-np-z2-9]{10}$/);
  assert.match(premio.referencia, /^SS-[A-HJ-NP-Z2-9]{5}$/);

  const p = await pagina(db, premio.codigo_chip);
  assert.equal(p.tipo, 'premio');
  assert.equal(p.nombre, 'Valentina');
  assert.equal(p.hito, 5);
  assert.equal(p.detalle, 'Tejido cartier, 2,1 g');
  assert.equal(p.circulo.interacciones, 5);
  assert.equal(p.circulo.proximo_hito, 10);
  const texto = JSON.stringify(p);
  assert.ok(!texto.includes('nota interna'), 'la nota interna no sale');
  assert.ok(!texto.includes(whatsapp.slice(3)) && !texto.includes(r.cliente.id), 'sin WhatsApp ni ids');
  assert.equal((await uno(db, 'select count(*)::int as n from public.escaneos')).n, 0, 'no suma escaneos');

  // El chip de la caja de la compra sigue abriendo su página normal.
  assert.equal((await pagina(db, r.cajas[0].codigo_chip)).tipo, 'propia');

  // Un referido que compra también le crea el premio a quien lo refirió.
  const otro = await venta(db, { nombre: 'Andrés' });
  for (let i = 0; i < 2; i++) await venta(db, { referidoDe: otro.cliente.codigo_referido });
  const delOtro = await como(db, 'authenticated', ADMIN, () =>
    uno(db, 'select count(*)::int as n from public.premios where cliente_id = $1 and hito = 3', [otro.cliente.id]),
  );
  assert.equal(delOtro.n, 1);
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

  // El certificado lee los mismos datos sin sumar escaneo, con la fecha de la compra.
  const cert = await como(db, 'anon', null, async () =>
    (await uno(db, 'select public.pagina_caja($1, false) as p', [r.cajas[0].codigo_chip])).p,
  );
  assert.equal(cert.referencia, p.referencia);
  assert.match(cert.fecha, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal((await uno(db, 'select count(*)::int as n from public.escaneos')).n, 2, 'el certificado no suma escaneo');
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

test('mensaje del regalo: se guarda en cajas de regalo, se edita después y la página lo muestra', async () => {
  const db = await nuevaBase();
  const r = await venta(db, {
    cajas: [
      { es_regalo: true, nombre_destinatario: 'Laura', mensaje_regalo: '  Feliz cumpleaños, mi amor  ', piezas: [pieza()] },
      { es_regalo: false, mensaje_regalo: 'No debe guardarse', piezas: [pieza()] },
    ],
  });
  assert.equal((await pagina(db, r.cajas[0].codigo_chip)).mensaje, 'Feliz cumpleaños, mi amor');
  const propia = await pagina(db, r.cajas[1].codigo_chip);
  assert.equal(propia.mensaje, undefined, 'la compra propia no lleva mensaje');
  // Se corrige desde el panel; una caja que no es regalo no puede tenerlo; máximo 300 caracteres.
  await como(db, 'authenticated', ADMIN, async () => {
    await db.query("update public.cajas set mensaje_regalo = 'Con cariño' where id = $1", [r.cajas[0].id]);
    await assert.rejects(db.query("update public.cajas set mensaje_regalo = 'x' where id = $1", [r.cajas[1].id]), /cajas_mensaje_solo_regalo/);
    await assert.rejects(db.query('update public.cajas set mensaje_regalo = $1 where id = $2', ['a'.repeat(301), r.cajas[0].id]));
  });
  assert.equal((await pagina(db, r.cajas[0].codigo_chip)).mensaje, 'Con cariño');
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

  const tablas = ['clientes', 'ventas', 'cajas', 'piezas', 'premios', 'escaneos', 'admins', 'clientes_circulo'];
  const inventario = ['categorias', 'productos', 'productos_catalogo', 'proveedores', 'lotes', 'unidades', 'unidades_detalle', 'existencias', 'lotes_resumen', 'ventas_margen', 'piezas_vendidas', 'conteos', 'ajustes', 'ajustes_detalle'];
  for (const tabla of [...tablas, ...inventario]) {
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
  await assert.rejects(
    como(db, 'anon', null, () => db.query('select public.registrar_lote($1)', [{}])),
    /permission denied/,
  );
});

test('un usuario autenticado que no es admin no ve ni registra nada', async () => {
  const db = await nuevaBase();
  await venta(db);

  const filas = await como(db, 'authenticated', NO_ADMIN, async () => {
    const tablas = ['clientes', 'ventas', 'cajas', 'piezas', 'escaneos', 'admins', 'clientes_circulo', 'categorias', 'productos', 'lotes', 'unidades'];
    const conteos = [];
    for (const t of tablas) conteos.push((await uno(db, `select count(*)::int as n from public.${t}`)).n);
    return conteos;
  });
  assert.deepEqual(filas, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

  await assert.rejects(
    como(db, 'authenticated', NO_ADMIN, () =>
      db.query('select public.registrar_venta($1)', [{ cajas: [{ piezas: [pieza()] }] }]),
    ),
    /No autorizado/,
  );
});

// ---------------------------------------------------------------------------
// Fase 4A: catálogo
// ---------------------------------------------------------------------------

async function categoria(db, { nombre = 'Cadenas', manoObra = 40000, precio = 320000 } = {}) {
  return como(db, 'authenticated', ADMIN, () =>
    uno(
      db,
      'insert into public.categorias (nombre, mano_obra_gramo_cop, precio_gramo_cop) values ($1, $2, $3) returning id',
      [nombre, manoObra, precio],
    ),
  );
}

test('catálogo: el producto trae el precio y la mano de obra por gramo de su categoría', async () => {
  const db = await nuevaBase();
  const c = await categoria(db, { manoObra: 40000, precio: 320000 });
  const p = await como(db, 'authenticated', ADMIN, async () => {
    await db.query("insert into public.productos (codigo, nombre, categoria_id) values ('CA-001', 'Cadena tejido lazo 50 cm', $1)", [c.id]);
    await db.query('update public.categorias set activa = false where id = $1', [c.id]);
    return uno(db, "select categoria, precio_gramo_cop, mano_obra_gramo_cop, activo from public.productos_catalogo where codigo = 'CA-001'");
  });
  assert.equal(p.categoria, 'Cadenas');
  assert.equal(Number(p.precio_gramo_cop), 320000);
  assert.equal(Number(p.mano_obra_gramo_cop), 40000);
  assert.equal(p.activo, false, 'un producto de una categoría inactiva no se puede vender');
});

test('catálogo: nombres de categoría únicos, códigos válidos y sin borrar categorías en uso', async () => {
  const db = await nuevaBase();
  const c = await categoria(db);
  await assert.rejects(categoria(db, { nombre: '  cadenas ' }), /duplicate key|unique/);
  await como(db, 'authenticated', ADMIN, async () => {
    await assert.rejects(
      db.query("insert into public.productos (codigo, nombre, categoria_id) values ('ca 1', 'X', $1)", [c.id]),
      /check constraint/,
    );
    await db.query("insert into public.productos (codigo, nombre, categoria_id) values ('CA-002', 'X', $1)", [c.id]);
    await assert.rejects(db.query('delete from public.categorias where id = $1', [c.id]), /foreign key/);
  });
});

test('catálogo: un usuario que no es admin no puede crear categorías ni productos', async () => {
  const db = await nuevaBase();
  await assert.rejects(
    como(db, 'authenticated', NO_ADMIN, () =>
      db.query("insert into public.categorias (nombre, mano_obra_gramo_cop, precio_gramo_cop) values ('Anillos', 1, 1)"),
    ),
    /row-level security/,
  );
});

test('las piezas nuevas quedan en 18k', async () => {
  const db = await nuevaBase();
  const r = await venta(db);
  const p = await uno(db, 'select ley from public.piezas where caja_id = $1', [r.cajas[0].id]);
  assert.equal(p.ley, '18k');
});

// ---------------------------------------------------------------------------
// Fase 4B: lotes y existencias
// ---------------------------------------------------------------------------

async function producto(db, categoriaId, codigo = 'AN-014', extra = {}) {
  return como(db, 'authenticated', ADMIN, () =>
    uno(
      db,
      'insert into public.productos (codigo, nombre, categoria_id, stock_minimo) values ($1, $2, $3, $4) returning id',
      [codigo, 'Anillo solitario', categoriaId, extra.minimo ?? 0],
    ),
  );
}

async function lote(db, piezas, oro = 300000) {
  return como(db, 'authenticated', ADMIN, async () =>
    (await uno(db, 'select public.registrar_lote($1) as r', [{ oro_gramo_cop: oro, piezas }])).r,
  );
}

test('lotes: cada pieza con su peso; costo = peso × (oro + mano de obra) y precio = peso × precio/g', async () => {
  const db = await nuevaBase();
  const c = await categoria(db, { nombre: 'Anillos', manoObra: 50000, precio: 420000 });
  const p = await producto(db, c.id, 'AN-014', { minimo: 3 });
  const r = await lote(db, [
    { producto_id: p.id, peso_gramos: 3.12 },
    { producto_id: p.id, peso_gramos: 2.98 },
  ]);
  assert.equal(r.piezas, 2);

  const { piezas, existencia, resumen } = await como(db, 'authenticated', ADMIN, async () => ({
    piezas: (await db.query('select peso_gramos, costo_cop, precio_cop from public.unidades_detalle order by peso_gramos desc')).rows,
    existencia: await uno(db, "select * from public.existencias where codigo = 'AN-014'"),
    resumen: await uno(db, 'select * from public.lotes_resumen where id = $1', [r.lote_id]),
  }));
  // 3,12 × (300.000 + 50.000) = 1.092.000; 3,12 × 420.000 = 1.310.400
  assert.equal(Number(piezas[0].costo_cop), 1092000);
  assert.equal(Number(piezas[0].precio_cop), 1310400);
  assert.equal(existencia.disponibles, 2);
  assert.equal(Number(existencia.gramos), 6.1);
  assert.equal(existencia.bajo_minimo, true, '2 piezas con mínimo de 3');
  assert.equal(resumen.piezas, 2);
  assert.equal(Number(resumen.costo_cop), 1092000 + 1043000);
});

test('lotes: la mano de obra queda fija al entrar; corregir el oro del lote corrige el costo', async () => {
  const db = await nuevaBase();
  const c = await categoria(db, { nombre: 'Anillos', manoObra: 50000 });
  const p = await producto(db, c.id);
  const r = await lote(db, [{ producto_id: p.id, peso_gramos: 2 }]);
  const costo = await como(db, 'authenticated', ADMIN, async () => {
    await db.query('update public.categorias set mano_obra_gramo_cop = 90000 where id = $1', [c.id]);
    await db.query('update public.lotes set oro_gramo_cop = 310000 where id = $1', [r.lote_id]);
    return (await uno(db, 'select costo_cop from public.unidades_detalle')).costo_cop;
  });
  assert.equal(Number(costo), 2 * (310000 + 50000));
});

test('lotes: todo o nada, sin piezas vacías ni productos inactivos', async () => {
  const db = await nuevaBase();
  const c = await categoria(db);
  const p = await producto(db, c.id);
  await assert.rejects(lote(db, []), /al menos una pieza/);
  await assert.rejects(lote(db, [{ producto_id: p.id, peso_gramos: 2 }, { producto_id: p.id, peso_gramos: 0 }]), /check constraint/);
  await como(db, 'authenticated', ADMIN, () => db.query('update public.productos set activo = false where id = $1', [p.id]));
  await assert.rejects(lote(db, [{ producto_id: p.id, peso_gramos: 2 }]), /inactivo/);
  const n = await como(db, 'authenticated', ADMIN, () => uno(db, 'select count(*)::int as n from public.lotes'));
  assert.equal(n.n, 0);
});

test('lotes: una pieza vendida no se puede borrar ni cambiar, tampoco borrando su lote', async () => {
  const db = await nuevaBase();
  const c = await categoria(db);
  const p = await producto(db, c.id);
  const r = await lote(db, [{ producto_id: p.id, peso_gramos: 2 }]);
  await como(db, 'authenticated', ADMIN, async () => {
    await db.query("update public.unidades set estado = 'vendida'");
    await assert.rejects(db.query('update public.unidades set peso_gramos = 3'), /No se puede cambiar/);
    await assert.rejects(db.query('delete from public.lotes where id = $1', [r.lote_id]), /No se puede borrar/);
  });
});

test('lotes: un usuario que no es admin no puede registrar lotes', async () => {
  const db = await nuevaBase();
  await assert.rejects(
    como(db, 'authenticated', NO_ADMIN, () => db.query('select public.registrar_lote($1)', [{ oro_gramo_cop: 1, piezas: [{}] }])),
    /No autorizado/,
  );
});

// ---------------------------------------------------------------------------
// Fase 4C: precio por pieza en la venta, cruzado con el inventario
// ---------------------------------------------------------------------------

/** Categoría Anillos (mano de obra 50.000/g, precio 400.000/g), un producto y un lote con esas piezas. */
async function inventario(db, pesos = [2, 1.5]) {
  const c = await categoria(db, { nombre: 'Anillos', manoObra: 50000, precio: 400000 });
  const p = await producto(db, c.id, 'AN-014');
  await lote(db, pesos.map((g) => ({ producto_id: p.id, peso_gramos: g })), 300000);
  const { rows } = await como(db, 'authenticated', ADMIN, () =>
    db.query('select id, peso_gramos from public.unidades order by peso_gramos desc'),
  );
  return rows.map((r) => r.id);
}

async function estadoUnidad(db, id) {
  return (await uno(db, 'select estado from public.unidades where id = $1', [id])).estado;
}

test('venta por pieza: monto = suma de precios − descuento; guarda precio y costo y marca vendida', async () => {
  const db = await nuevaBase();
  const [u2, u15] = await inventario(db);
  const r = await venta(db, {
    monto: 1, // se ignora: el monto sale de las piezas
    cajas: [{ es_regalo: false, piezas: [{ unidad_id: u2 }, { unidad_id: u15 }] }],
    descuento: 100000,
  });
  // 2 g y 1,5 g a 400.000/g = 1.400.000 − 100.000
  assert.equal(Number(r.monto_cop), 1300000);
  const piezas = (await db.query('select descripcion, peso_gramos, ley, precio_cop, costo_cop from public.piezas order by orden')).rows;
  assert.equal(piezas[0].descripcion, 'Anillo solitario');
  assert.equal(Number(piezas[0].precio_cop), 800000);
  assert.equal(Number(piezas[0].costo_cop), 2 * (300000 + 50000));
  assert.equal(piezas[0].ley, '18k');
  assert.equal(await estadoUnidad(db, u2), 'vendida');
  const m = await como(db, 'authenticated', ADMIN, () => uno(db, 'select * from public.ventas_margen where id = $1', [r.venta_id]));
  assert.equal(Number(m.margen_cop), 1300000 - 700000 - 525000);
});

test('venta por pieza: la página del chip nunca muestra precios ni costos', async () => {
  const db = await nuevaBase();
  const [u] = await inventario(db, [2]);
  const r = await venta(db, { cajas: [{ es_regalo: true, nombre_destinatario: 'Laura', piezas: [{ unidad_id: u }] }] });
  const codigo = (await uno(db, 'select codigo_chip from public.cajas where id = $1', [r.cajas[0].id])).codigo_chip;
  const texto = JSON.stringify(await pagina(db, codigo));
  assert.doesNotMatch(texto, /precio|costo|800000|700000|unidad/);
});

test('venta por pieza: no se vende dos veces la misma pieza y un error no deja nada a medias', async () => {
  const db = await nuevaBase();
  const [u] = await inventario(db, [2]);
  await assert.rejects(venta(db, { cajas: [{ piezas: [{ unidad_id: u }, { unidad_id: u }] }] }), /dos veces/);
  await venta(db, { cajas: [{ piezas: [{ unidad_id: u }] }] });
  await assert.rejects(venta(db, { cajas: [{ piezas: [{ unidad_id: u }] }] }), /ya no está disponible/);
  assert.equal((await uno(db, 'select count(*)::int as n from public.ventas')).n, 1);
});

test('venta por pieza: anular devuelve la pieza al inventario y reactivar la vuelve a vender', async () => {
  const db = await nuevaBase();
  const [u] = await inventario(db, [2]);
  const r = await venta(db, { cajas: [{ piezas: [{ unidad_id: u }] }] });
  const anular = (valor, id = r.venta_id) =>
    como(db, 'authenticated', ADMIN, () => db.query('update public.ventas set anulada = $1 where id = $2', [valor, id]));

  await anular(true);
  assert.equal(await estadoUnidad(db, u), 'disponible');
  await anular(false);
  assert.equal(await estadoUnidad(db, u), 'vendida');

  // Si mientras estaba anulada se vendió en otra venta, ya no se puede reactivar.
  await anular(true);
  await venta(db, { cajas: [{ piezas: [{ unidad_id: u }] }] });
  await assert.rejects(anular(false), /No se puede reactivar/);
});

test('venta por pieza: piezas fuera del inventario con precio, descuento válido y el Círculo usa el total', async () => {
  const db = await nuevaBase();
  const [u] = await inventario(db, [1.5]); // 600.000
  const whatsapp = nuevoWhatsapp();
  const manual = { descripcion: 'Topos', peso_gramos: 0.8, precio_cop: 250000 };
  await assert.rejects(
    venta(db, { whatsapp, cajas: [{ piezas: [{ unidad_id: u }, { descripcion: 'Topos', peso_gramos: 0.8 }] }] }),
    /Todas las piezas deben tener precio/,
  );
  await assert.rejects(venta(db, { whatsapp, cajas: [{ piezas: [manual] }], descuento: 250000 }), /descuento/);

  // 600.000 − 10.000 = 590.000: no llega al mínimo del Círculo.
  const r = await venta(db, { whatsapp, cajas: [{ piezas: [{ unidad_id: u }] }], descuento: 10000 });
  assert.equal((await interacciones(db, r.cliente.id)).interacciones, 0);
  const r2 = await venta(db, { whatsapp, cajas: [{ piezas: [manual, { ...manual, precio_cop: 400000 }] }] });
  assert.equal(Number(r2.monto_cop), 650000);
  assert.equal((await interacciones(db, r.cliente.id)).interacciones, 1);
});

// ---------------------------------------------------------------------------
// Fase 4D: informes
// ---------------------------------------------------------------------------

test('informes: cada pieza vendida reparte el descuento según su precio y trae su margen y días en inventario', async () => {
  const db = await nuevaBase();
  const [u2, u15] = await inventario(db); // 2 g = 800.000 y 1,5 g = 600.000; costo 700.000 y 525.000
  const manual = { descripcion: 'Topos', peso_gramos: 0.8, precio_cop: 200000 };
  await venta(db, { cajas: [{ piezas: [{ unidad_id: u2 }, { unidad_id: u15 }, manual] }], descuento: 160000 });
  const filas = await como(db, 'authenticated', ADMIN, async () =>
    (await db.query('select * from public.piezas_vendidas order by precio_cop desc')).rows,
  );
  // 160.000 repartido sobre 1.600.000: 10 % de cada precio.
  assert.deepEqual(filas.map((f) => Number(f.descuento_cop)), [80000, 60000, 20000]);
  assert.equal(Number(filas[0].precio_neto_cop), 720000);
  assert.equal(Number(filas[0].margen_cop), 720000 - 700000);
  assert.equal(filas[0].categoria, 'Anillos');
  assert.equal(filas[0].codigo, 'AN-014');
  assert.equal(filas[0].dias_en_inventario, 0);
  assert.equal(filas[2].categoria, 'Fuera del inventario');
  assert.equal(filas[2].margen_cop, null, 'sin costo no hay margen');
});

// ---------------------------------------------------------------------------
// Fase 4E: conteo físico y ajustes
// ---------------------------------------------------------------------------

async function rpc(db, funcion, p, usuario = ADMIN) {
  return como(db, 'authenticated', usuario, async () => (await uno(db, `select public.${funcion}($1) as r`, [p])).r);
}

test('conteo: las piezas que faltan de cada peso se dan de baja con su motivo y quedan registradas', async () => {
  const db = await nuevaBase();
  await inventario(db, [2, 2, 2, 1.5]);
  const producto = (await uno(db, "select id from public.productos where codigo = 'AN-014'")).id;
  const r = await rpc(db, 'registrar_conteo', {
    producto_id: producto,
    contadas: 2,
    faltantes: [{ peso_gramos: 2, cantidad: 2 }],
    nota: 'Conteo de fin de mes',
  });
  assert.equal(r.bajas, 2);
  assert.equal(r.en_sistema, 4);
  const estados = (await db.query('select peso_gramos, estado from public.unidades order by peso_gramos, estado')).rows;
  assert.deepEqual(estados.map((e) => `${Number(e.peso_gramos)} ${e.estado}`), ['1.5 disponible', '2 baja', '2 baja', '2 disponible']);
  const ajustes = await como(db, 'authenticated', ADMIN, async () => (await db.query('select * from public.ajustes_detalle')).rows);
  assert.equal(ajustes.length, 2);
  assert.equal(ajustes[0].motivo, 'Faltante en conteo');
  assert.equal(ajustes[0].creado_por_nombre, 'Socio');
  const conteo = await uno(db, 'select en_sistema, contadas from public.conteos');
  assert.deepEqual([conteo.en_sistema, conteo.contadas], [4, 2]);
  // Las dadas de baja ya no se pueden vender.
  const baja = (await uno(db, "select id from public.unidades where estado = 'baja' limit 1")).id;
  await assert.rejects(venta(db, { cajas: [{ piezas: [{ unidad_id: baja }] }] }), /ya no está disponible/);
});

test('conteo: no se pueden dar de baja más piezas de un peso de las que hay', async () => {
  const db = await nuevaBase();
  await inventario(db, [2]);
  const producto = (await uno(db, "select id from public.productos where codigo = 'AN-014'")).id;
  await assert.rejects(
    rpc(db, 'registrar_conteo', { producto_id: producto, contadas: 0, faltantes: [{ peso_gramos: 2, cantidad: 3 }] }),
    /Faltan más piezas/,
  );
  assert.equal((await uno(db, 'select count(*)::int as n from public.conteos')).n, 0, 'todo o nada');
});

test('ajustes: baja y reintegro de piezas sueltas; no se da de baja una pieza vendida', async () => {
  const db = await nuevaBase();
  const [u, v] = await inventario(db, [2, 1.5]);
  assert.equal(await rpc(db, 'ajustar_inventario', { tipo: 'baja', unidades: [u], motivo: 'Daño' }), 1);
  assert.equal(await estadoUnidad(db, u), 'baja');
  assert.equal(await rpc(db, 'ajustar_inventario', { tipo: 'reintegro', unidades: [u], motivo: 'Apareció' }), 1);
  assert.equal(await estadoUnidad(db, u), 'disponible');
  await venta(db, { cajas: [{ piezas: [{ unidad_id: v }] }] });
  await assert.rejects(rpc(db, 'ajustar_inventario', { tipo: 'baja', unidades: [v], motivo: 'Pérdida' }), /Solo se puede dar de baja/);
  await assert.rejects(rpc(db, 'ajustar_inventario', { tipo: 'baja', unidades: [u], motivo: ' ' }), /Falta el motivo/);
});

test('ajustes: solo los admins ajustan, y el historial no se puede editar ni borrar', async () => {
  const db = await nuevaBase();
  const [u] = await inventario(db, [2]);
  await assert.rejects(rpc(db, 'ajustar_inventario', { tipo: 'baja', unidades: [u], motivo: 'Daño' }, NO_ADMIN), /No autorizado/);
  await rpc(db, 'ajustar_inventario', { tipo: 'baja', unidades: [u], motivo: 'Daño' });
  await como(db, 'authenticated', ADMIN, async () => {
    await assert.rejects(db.query("update public.ajustes set motivo = 'x'"), /permission denied/);
    await assert.rejects(db.query('delete from public.ajustes'), /permission denied/);
  });
});

async function eliminarProducto(db, id, usuario = ADMIN) {
  return como(db, 'authenticated', usuario, async () => (await uno(db, 'select public.eliminar_producto($1) as r', [id])).r);
}

test('eliminar producto: borra sus piezas (también las de baja), fotos, conteos y los lotes que quedan vacíos', async () => {
  const db = await nuevaBase();
  const [u] = await inventario(db, [2, 1.5]);
  const p = (await uno(db, "select id, categoria_id from public.productos where codigo = 'AN-014'"));
  // Otro producto en otro lote: no se toca.
  const otro = await producto(db, p.categoria_id, 'AN-015');
  await lote(db, [{ producto_id: otro.id, peso_gramos: 3 }]);
  await rpc(db, 'ajustar_inventario', { tipo: 'baja', unidades: [u], motivo: 'Daño' });
  await rpc(db, 'registrar_conteo', { producto_id: p.id, contadas: 1, faltantes: [] });
  const foto = await como(db, 'authenticated', ADMIN, () =>
    uno(db, 'insert into public.fotos_producto (producto_id) values ($1) returning id', [p.id]),
  );
  await assert.rejects(eliminarProducto(db, p.id, NO_ADMIN), /No autorizado/);

  const r = await eliminarProducto(db, p.id);
  assert.deepEqual(r, { piezas: 2, lotes: 1, fotos: [foto.id] });
  assert.equal((await uno(db, "select count(*)::int as n from public.productos where codigo = 'AN-014'")).n, 0);
  assert.equal((await uno(db, 'select count(*)::int as n from public.unidades')).n, 1, 'queda la pieza del otro producto');
  assert.equal((await uno(db, 'select count(*)::int as n from public.lotes')).n, 1);
  assert.equal((await uno(db, 'select count(*)::int as n from public.ajustes')).n, 0);
  assert.equal((await uno(db, 'select count(*)::int as n from public.conteos')).n, 0);
  // Fuera de la función, una pieza dada de baja sigue sin poder borrarse.
  const [v] = (await db.query('select id from public.unidades')).rows.map((x) => x.id);
  await rpc(db, 'ajustar_inventario', { tipo: 'baja', unidades: [v], motivo: 'Daño' });
  await como(db, 'authenticated', ADMIN, () =>
    assert.rejects(db.query('delete from public.unidades where id = $1', [v]), /No se puede borrar una pieza baja/),
  );
});

test('eliminar producto: no se elimina si alguna pieza se vendió, aunque la venta esté anulada', async () => {
  const db = await nuevaBase();
  const [u] = await inventario(db, [2, 1.5]);
  const p = (await uno(db, "select id from public.productos where codigo = 'AN-014'")).id;
  await venta(db, { cajas: [{ piezas: [{ unidad_id: u }] }] });
  await assert.rejects(eliminarProducto(db, p), /tiene piezas vendidas/);
  await como(db, 'authenticated', ADMIN, () => db.query('update public.ventas set anulada = true'));
  assert.equal(await estadoUnidad(db, u), 'disponible');
  await assert.rejects(eliminarProducto(db, p), /tiene piezas vendidas/);
  assert.equal((await uno(db, 'select count(*)::int as n from public.unidades')).n, 2, 'no se borró nada');
});

// ---------------------------------------------------------------------------
// Fase C1: catálogo público
// ---------------------------------------------------------------------------

async function catalogo(db) {
  return como(db, 'anon', null, async () => (await uno(db, 'select public.catalogo_publico() as c')).c);
}

test('catálogo público: solo productos publicados y con foto; sin piezas salen agotados; un precio por peso, sin cantidades ni costos', async () => {
  const db = await nuevaBase();
  const [u2a, u2b, u15] = await inventario(db, [2, 2, 1.5]);
  const p = await como(db, 'authenticated', ADMIN, () => uno(db, "select id from public.productos where codigo = 'AN-014'"));
  assert.deepEqual(await catalogo(db), [], 'sin publicar no aparece');

  await como(db, 'authenticated', ADMIN, () =>
    db.query("update public.productos set publicado = true, descripcion_publica = 'Oro amarillo' where id = $1", [p.id]),
  );
  assert.deepEqual(await catalogo(db), [], 'sin foto no aparece');

  const f = await como(db, 'authenticated', ADMIN, () =>
    uno(db, 'insert into public.fotos_producto (producto_id) values ($1) returning id', [p.id]),
  );
  const [item] = await catalogo(db);
  assert.equal(item.codigo, 'AN-014');
  assert.equal(item.descripcion, 'Oro amarillo');
  assert.deepEqual(item.fotos, [`${p.id}/${f.id}`]);
  // Dos piezas de 2 g se muestran una sola vez; 400.000/g.
  assert.deepEqual(
    item.opciones.map((o) => [Number(o.peso_gramos), Number(o.precio_cop)]),
    [[1.5, 600000], [2, 800000]],
  );
  assert.deepEqual(Object.keys(item).sort(), ['categoria', 'codigo', 'descripcion', 'fotos', 'nombre', 'opciones']);
  assert.doesNotMatch(JSON.stringify(item), /costo|disponibles|lote|proveedor/);

  // Vender y dar de baja va quitando pesos; sin piezas, sigue con opciones vacías (agotado).
  await venta(db, { cajas: [{ piezas: [{ unidad_id: u15 }, { unidad_id: u2a }] }] });
  assert.deepEqual((await catalogo(db))[0].opciones.map((o) => Number(o.peso_gramos)), [2]);
  await rpc(db, 'ajustar_inventario', { tipo: 'baja', unidades: [u2b], motivo: 'Daño' });
  const [agotado] = await catalogo(db);
  assert.equal(agotado.codigo, 'AN-014');
  assert.deepEqual(agotado.opciones, []);

  // Uno con piezas va antes que el agotado en la misma categoría, aunque su nombre vaya después.
  const c = (await uno(db, 'select categoria_id from public.productos where id = $1', [p.id])).categoria_id;
  const otro = await producto(db, c, 'AN-099');
  await como(db, 'authenticated', ADMIN, async () => {
    await db.query("update public.productos set publicado = true, nombre = 'Zafiro' where id = $1", [otro.id]);
    await db.query('insert into public.fotos_producto (producto_id) values ($1)', [otro.id]);
  });
  await lote(db, [{ producto_id: otro.id, peso_gramos: 1 }]);
  assert.deepEqual((await catalogo(db)).map((x) => x.codigo), ['AN-099', 'AN-014']);
});

test('catálogo público: el visitante no lee tablas, hasta 5 fotos y solo los admins suben al bucket', async () => {
  const db = await nuevaBase();
  await inventario(db, [2]);
  const p = await como(db, 'authenticated', ADMIN, () => uno(db, "select id from public.productos where codigo = 'AN-014'"));
  await como(db, 'anon', null, async () => {
    await assert.rejects(db.query('select * from public.fotos_producto'), /permission denied/);
    await assert.rejects(db.query('select * from public.productos'), /permission denied/);
  });
  await como(db, 'authenticated', ADMIN, async () => {
    for (let i = 0; i < 5; i++) await db.query('insert into public.fotos_producto (producto_id, orden) values ($1, $2)', [p.id, i]);
    await assert.rejects(db.query('insert into public.fotos_producto (producto_id) values ($1)', [p.id]), /hasta 5 fotos/);
  });

  const subir = (rol, usuario) =>
    como(db, rol, usuario, () => db.query("insert into storage.objects (bucket_id, name) values ('catalogo', 'x/y.webp')"));
  await assert.rejects(subir('anon', null), /row-level security/);
  await assert.rejects(subir('authenticated', NO_ADMIN), /row-level security/);
  await subir('authenticated', ADMIN);
  const vistos = await como(db, 'authenticated', NO_ADMIN, () => uno(db, 'select count(*)::int as n from storage.objects'));
  assert.equal(vistos.n, 0, 'un usuario que no es admin no lista el bucket');
  const bucket = await uno(db, "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'catalogo'");
  assert.equal(bucket.public, true);
  assert.equal(Number(bucket.file_size_limit), 1024 * 1024, 'fotos de hasta 1 MB');
  assert.deepEqual(bucket.allowed_mime_types, ['image/webp', 'image/jpeg']);
});

// ---------------------------------------------------------------------------
// Fase A1: catálogo para aliados
// ---------------------------------------------------------------------------

/** Crea un aliado como admin y devuelve { id, token }. */
async function aliado(db, nombre = 'Laura Gómez', extra = {}) {
  return como(db, 'authenticated', ADMIN, () =>
    uno(db, 'insert into public.aliados (nombre, activo) values ($1, $2) returning id, token', [nombre, extra.activo ?? true]),
  );
}

async function catalogoAliado(db, token) {
  return como(db, 'anon', null, async () => (await uno(db, 'select public.catalogo_aliado($1) as c', [token])).c);
}

/** Inventario de Anillos (400.000/g público) con precio de aliado y una foto en AN-014. */
async function inventarioConAliado(db, pesos, precioAliado = 300000) {
  const ids = await inventario(db, pesos);
  await como(db, 'authenticated', ADMIN, async () => {
    await db.query("update public.categorias set precio_aliado_gramo_cop = $1 where nombre = 'Anillos'", [precioAliado]);
    await db.query("insert into public.fotos_producto (producto_id) select id from public.productos where codigo = 'AN-014'");
    await db.query("update public.productos set publicado = true where codigo = 'AN-014'");
  });
  return ids;
}

test('aliados: el enlace trae precio de aliado, precio público sugerido y cantidad por peso, sin costos', async () => {
  const db = await nuevaBase();
  const [u2a] = await inventarioConAliado(db, [2, 2, 1.5]);
  const a = await aliado(db);
  assert.match(a.token, /^[a-km-np-z2-9]{20}$/);

  const c = await catalogoAliado(db, a.token);
  assert.equal(c.aliado, 'Laura', 'solo el primer nombre');
  assert.equal(c.productos.length, 1);
  const [p] = c.productos;
  assert.equal(p.codigo, 'AN-014');
  assert.equal(p.fotos.length, 1);
  // 300.000/g de aliado y 400.000/g público; dos piezas de 2 g.
  assert.deepEqual(
    p.opciones.map((o) => [Number(o.peso_gramos), Number(o.precio_cop), Number(o.precio_publico_cop), o.cantidad]),
    [[1.5, 450000, 600000, 1], [2, 600000, 800000, 2]],
  );
  assert.doesNotMatch(JSON.stringify(c), /costo|lote|proveedor|mano_obra|token/);
  const acceso = await como(db, 'authenticated', ADMIN, () => uno(db, 'select ultimo_acceso from public.aliados where id = $1', [a.id]));
  assert.ok(acceso.ultimo_acceso, 'anota el último acceso');

  // Al vender una de 2 g, la cantidad baja.
  await venta(db, { cajas: [{ piezas: [{ unidad_id: u2a }] }] });
  const despues = (await catalogoAliado(db, a.token)).productos[0].opciones;
  assert.deepEqual(despues.map((o) => o.cantidad), [1, 1]);
});

test('aliados: mismas reglas del público (marcado y con foto); sin precio de aliado sale sin precio y sin piezas, agotado', async () => {
  const db = await nuevaBase();
  const [u] = await inventario(db, [2]);
  const a = await aliado(db);
  const p = (await uno(db, "select id from public.productos where codigo = 'AN-014'")).id;
  await como(db, 'authenticated', ADMIN, () => db.query('update public.productos set publicado = true where id = $1', [p]));
  assert.deepEqual((await catalogoAliado(db, a.token)).productos, [], 'sin foto');
  await como(db, 'authenticated', ADMIN, () => db.query('insert into public.fotos_producto (producto_id) values ($1)', [p]));
  // La categoría no tiene precio de aliado: aparece con precio null y el público sugerido.
  const [sinPrecio] = (await catalogoAliado(db, a.token)).productos;
  assert.deepEqual(sinPrecio.opciones.map((o) => [Number(o.peso_gramos), o.precio_cop, Number(o.precio_publico_cop), o.cantidad]), [[2, null, 800000, 1]]);
  await assert.rejects(ventaAliado(db, a.id, [{ producto_id: p, peso_gramos: 2, cantidad: 1 }]), /precio para aliados/);
  // Sin marcar para el catálogo no aparece.
  await como(db, 'authenticated', ADMIN, () => db.query('update public.productos set publicado = false where id = $1', [p]));
  assert.deepEqual((await catalogoAliado(db, a.token)).productos, [], 'sin marcar');
  await como(db, 'authenticated', ADMIN, () => db.query('update public.productos set publicado = true where id = $1', [p]));
  // Vendida la única pieza, sale agotado.
  await venta(db, { cajas: [{ piezas: [{ unidad_id: u }] }] });
  const [agotado] = (await catalogoAliado(db, a.token)).productos;
  assert.equal(agotado.codigo, 'AN-014');
  assert.deepEqual(agotado.opciones, []);
});

test('aliados: código inválido, inexistente o de un aliado inactivo no devuelve nada', async () => {
  const db = await nuevaBase();
  await inventarioConAliado(db, [2]);
  const a = await aliado(db);
  const inactivo = await aliado(db, 'Pedro', { activo: false });
  assert.equal(await catalogoAliado(db, 'abc'), null);
  assert.equal(await catalogoAliado(db, 'zzzzzzzzzzzzzzzzzzzz'), null);
  assert.equal(await catalogoAliado(db, inactivo.token), null);
  assert.notEqual(await catalogoAliado(db, a.token), null);
});

test('aliados: regenerar el enlace invalida el anterior; solo los admins lo hacen y nadie más lee la tabla', async () => {
  const db = await nuevaBase();
  await inventarioConAliado(db, [2]);
  const a = await aliado(db);
  const nuevo = await rpc(db, 'regenerar_enlace_aliado', a.id);
  assert.notEqual(nuevo, a.token);
  assert.equal(await catalogoAliado(db, a.token), null, 'el enlace viejo ya no sirve');
  assert.notEqual(await catalogoAliado(db, nuevo), null);

  await assert.rejects(rpc(db, 'regenerar_enlace_aliado', a.id, NO_ADMIN), /No autorizado/);
  await como(db, 'anon', null, async () => {
    await assert.rejects(db.query('select * from public.aliados'), /permission denied/);
    await assert.rejects(db.query('select public.regenerar_enlace_aliado($1)', [a.id]), /permission denied/);
  });
  const vistos = await como(db, 'authenticated', NO_ADMIN, () => uno(db, 'select count(*)::int as n from public.aliados'));
  assert.equal(vistos.n, 0, 'un usuario que no es admin no ve aliados');
});

// ---------------------------------------------------------------------------
// Fase A4: ventas a aliados
// ---------------------------------------------------------------------------

async function ventaAliado(db, aliadoId, lineas, extra = {}, usuario = ADMIN) {
  return rpc(db, 'registrar_venta_aliado', { aliado_id: aliadoId, lineas, ...extra }, usuario);
}

test('venta a aliado: a su precio, toma las piezas del lote más antiguo y no lleva cliente', async () => {
  const db = await nuevaBase();
  await inventarioConAliado(db, [2, 2, 1.5]);
  const a = await aliado(db);
  const producto = (await uno(db, "select id from public.productos where codigo = 'AN-014'")).id;
  const r = await ventaAliado(db, a.id, [{ producto_id: producto, peso_gramos: 2, cantidad: 2 }], { descuento_cop: 50000 });
  // 2 piezas de 2 g a 300.000/g de aliado = 1.200.000 − 50.000
  assert.equal(Number(r.monto_cop), 1150000);
  assert.match(r.referencia, /^SS-/);

  const venta = await uno(db, 'select cliente_id, aliado_id, pagada_aliado_at, descuento_cop from public.ventas where id = $1', [r.venta_id]);
  assert.equal(venta.cliente_id, null);
  assert.equal(venta.aliado_id, a.id);
  assert.equal(venta.pagada_aliado_at, null, 'queda pendiente de pago');
  const piezas = (await db.query('select precio_cop, costo_cop, unidad_id from public.piezas order by orden')).rows;
  assert.deepEqual(piezas.map((p) => Number(p.precio_cop)), [600000, 600000]);
  assert.ok(piezas.every((p) => Number(p.costo_cop) > 0 && p.unidad_id), 'guarda el costo y la pieza del inventario');
  const estados = (await db.query("select peso_gramos, estado from public.unidades order by peso_gramos, estado")).rows;
  assert.deepEqual(estados.map((u) => [Number(u.peso_gramos), u.estado]), [[1.5, 'disponible'], [2, 'vendida'], [2, 'vendida']]);
});

test('venta a aliado: no cuenta en el Círculo y su caja no abre la página del chip', async () => {
  const db = await nuevaBase();
  await inventarioConAliado(db, [3]);
  const a = await aliado(db);
  const producto = (await uno(db, "select id from public.productos where codigo = 'AN-014'")).id;
  const r = await ventaAliado(db, a.id, [{ producto_id: producto, peso_gramos: 3, cantidad: 1 }]);
  const chip = (await uno(db, 'select codigo_chip from public.cajas where venta_id = $1', [r.venta_id])).codigo_chip;
  assert.equal(await pagina(db, chip), null);
  assert.equal((await uno(db, 'select count(*)::int as n from public.escaneos')).n, 0, 'ni suma escaneo');
  const conteo = await como(db, 'authenticated', ADMIN, () => uno(db, 'select count(*)::int as n from public.clientes_circulo where interacciones > 0'));
  assert.equal(conteo.n, 0);
});

test('venta a aliado: sin piezas suficientes, sin precio de aliado o aliado inactivo, no guarda nada', async () => {
  const db = await nuevaBase();
  await inventario(db, [2]);
  const a = await aliado(db);
  const inactivo = await aliado(db, 'Pedro', { activo: false });
  const producto = (await uno(db, "select id from public.productos where codigo = 'AN-014'")).id;
  const linea = (cantidad) => [{ producto_id: producto, peso_gramos: 2, cantidad }];
  await assert.rejects(ventaAliado(db, a.id, linea(1)), /no tiene precio para aliados/);
  await como(db, 'authenticated', ADMIN, () => db.query('update public.categorias set precio_aliado_gramo_cop = 300000'));
  await assert.rejects(ventaAliado(db, a.id, linea(2)), /No hay 2 piezas/);
  await assert.rejects(ventaAliado(db, inactivo.id, linea(1)), /inactivo/);
  await assert.rejects(ventaAliado(db, a.id, []), /al menos una pieza/);
  await assert.rejects(ventaAliado(db, a.id, linea(1), {}, NO_ADMIN), /No autorizado/);
  assert.equal((await uno(db, 'select count(*)::int as n from public.ventas')).n, 0, 'todo o nada');
  assert.equal((await uno(db, "select estado from public.unidades")).estado, 'disponible');
});

test('venta a aliado: anular devuelve las piezas; se marca pagada; una venta no puede ser de cliente y aliado', async () => {
  const db = await nuevaBase();
  await inventarioConAliado(db, [2]);
  const a = await aliado(db);
  const producto = (await uno(db, "select id from public.productos where codigo = 'AN-014'")).id;
  const r = await ventaAliado(db, a.id, [{ producto_id: producto, peso_gramos: 2, cantidad: 1 }]);
  await como(db, 'authenticated', ADMIN, async () => {
    await db.query('update public.ventas set pagada_aliado_at = now() where id = $1', [r.venta_id]);
    await db.query('update public.ventas set anulada = true where id = $1', [r.venta_id]);
  });
  assert.equal((await uno(db, 'select estado from public.unidades')).estado, 'disponible');
  // Una venta normal de cliente no puede llevar aliado ni pago de aliado.
  const normal = await venta(db);
  await como(db, 'authenticated', ADMIN, async () => {
    await assert.rejects(db.query('update public.ventas set aliado_id = $1 where id = $2', [a.id, normal.venta_id]), /ventas_cliente_o_aliado/);
    await assert.rejects(db.query('update public.ventas set pagada_aliado_at = now() where id = $1', [normal.venta_id]), /ventas_pago_solo_aliado/);
  });
});

// ---------------------------------------------------------------------------
// Contabilidad: costos directos por venta y gastos
// ---------------------------------------------------------------------------

async function contable(db, ventaId) {
  return como(db, 'authenticated', ADMIN, () => uno(db, 'select * from public.ventas_contables where id = $1', [ventaId]));
}

async function compraEmpaques(db, dias, cantidad, total) {
  return como(db, 'authenticated', ADMIN, () =>
    uno(
      db,
      "insert into public.gastos (fecha, categoria_id, descripcion, monto_cop, cantidad) select privado.hoy() + $1::int, id, 'Compra de empaques', $3, $2 from public.categorias_gasto where es_empaque returning id",
      [dias, cantidad, total],
    ),
  );
}

test('contabilidad: la compra de empaques es un gasto y de ahí sale el costo por caja de cada venta', async () => {
  const db = await nuevaBase();
  const r = await venta(db, { cajas: [{ es_regalo: false, piezas: [pieza()] }, { es_regalo: true, piezas: [pieza('Dije')] }] });
  let c = await contable(db, r.venta_id);
  assert.equal(c.empaques, 2, 'uno por caja');
  assert.equal(Number(c.empaque_cop), 0, 'sin compra de empaques');

  // Registrada con fecha posterior a la venta: no aplica.
  const compra = await compraEmpaques(db, 2, 300, 900000);
  assert.equal(Number((await contable(db, r.venta_id)).empaque_cop), 0);
  // Se corrige la fecha: 900.000 / 300 = 3.000 por caja.
  await como(db, 'authenticated', ADMIN, () => db.query('update public.gastos set fecha = privado.hoy() - 5 where id = $1', [compra.id]));
  c = await contable(db, r.venta_id);
  assert.equal(Number(c.empaque_cop), 6000);
  assert.equal(Number(c.utilidad_cop), Number(c.ingresos_cop) - Number(c.costo_piezas_cop) - 6000 - Number(c.comision_cop) - Number(c.domicilio_pagado_cop));
  // Una compra más nueva (desde hoy) cambia el costo de las ventas desde su fecha.
  await compraEmpaques(db, 0, 100, 500000);
  assert.equal(Number((await contable(db, r.venta_id)).empaque_cop), 10000);
  // Borrar compras devuelve el costo a la anterior.
  await como(db, 'authenticated', ADMIN, () => db.query('delete from public.gastos where cantidad = 100'));
  assert.equal(Number((await contable(db, r.venta_id)).empaque_cop), 6000);
  // Solo hay una categoría de empaques.
  await assert.rejects(
    como(db, 'authenticated', ADMIN, () => db.query("update public.categorias_gasto set es_empaque = true where nombre = 'Otros'")),
    /duplicate|unique/,
  );
});

test('contabilidad: desactivar varias categorías de gasto a la vez', async () => {
  const db = await nuevaBase();
  await como(db, 'authenticated', ADMIN, () =>
    db.query("update public.categorias_gasto set activa = false where nombre = any($1)", [['Arriendo', 'Otros']]),
  );
  const activas = await como(db, 'authenticated', ADMIN, () =>
    uno(db, 'select count(*) filter (where activa)::int as si, count(*) filter (where not activa)::int as no from public.categorias_gasto'),
  );
  assert.deepEqual(activas, { si: 12, no: 2 });
});

test('contabilidad: comisión del medio de pago, domicilio cobrado y pagado, y utilidad de la venta', async () => {
  const db = await nuevaBase();
  const [u] = await inventario(db, [2]);
  const r = await venta(db, { cajas: [{ es_regalo: false, piezas: [{ unidad_id: u }] }] });
  await como(db, 'authenticated', ADMIN, async () => {
    await db.query("update public.medios_pago set comision_pct = 3 where nombre = 'Datáfono'");
    await db.query(
      "update public.ventas set medio_pago_id = (select id from public.medios_pago where nombre = 'Datáfono'), domicilio_cobrado_cop = 15000, domicilio_pagado_cop = 12000 where id = $1",
      [r.venta_id],
    );
  });
  const c = await contable(db, r.venta_id);
  // 2 g a 400.000/g = 800.000; costo 2 × (300.000 + 50.000) = 700.000.
  assert.equal(Number(c.ingresos_cop), 815000);
  assert.equal(Number(c.comision_cop), Math.round(815000 * 0.03));
  assert.equal(c.medio_pago, 'Datáfono');
  assert.equal(Number(c.costo_piezas_cop), 700000);
  assert.equal(Number(c.utilidad_cop), 815000 - 700000 - 12000 - Math.round(815000 * 0.03));

  // Si el medio cambia su comisión, la venta conserva la que tenía.
  await como(db, 'authenticated', ADMIN, () => db.query("update public.medios_pago set comision_pct = 5 where nombre = 'Datáfono'"));
  assert.equal(Number((await contable(db, r.venta_id)).comision_pct), 3);
});

test('contabilidad: gastos y medios de pago solo para admins', async () => {
  const db = await nuevaBase();
  await como(db, 'authenticated', ADMIN, () =>
    db.query(
      "insert into public.gastos (categoria_id, descripcion, monto_cop) select id, 'Arriendo de noviembre', 1200000 from public.categorias_gasto where nombre = 'Arriendo'",
    ),
  );
  const visto = await como(db, 'authenticated', NO_ADMIN, () => uno(db, 'select count(*)::int as n from public.gastos'));
  assert.equal(visto.n, 0, 'un usuario que no es admin no ve gastos');
  await assert.rejects(
    como(db, 'authenticated', NO_ADMIN, () =>
      db.query("insert into public.gastos (categoria_id, descripcion, monto_cop) values (gen_random_uuid(), 'x', 1)"),
    ),
    /row-level security/,
  );
  for (const tabla of ['gastos', 'medios_pago', 'categorias_gasto', 'ventas_contables']) {
    await assert.rejects(como(db, 'anon', null, () => db.query(`select * from public.${tabla}`)), /permission denied/, tabla);
  }
  await assert.rejects(
    como(db, 'authenticated', ADMIN, () =>
      db.query("insert into public.gastos (categoria_id, descripcion, monto_cop) select id, 'Negativo', -5 from public.categorias_gasto limit 1"),
    ),
  );
});

// ---------------------------------------------------------------------------
// Precio fijo por unidad y venta por cantidad (balinería)
// ---------------------------------------------------------------------------

test('precio fijo por unidad: reemplaza peso × precio por gramo en la venta, el inventario y los catálogos', async () => {
  const db = await nuevaBase();
  const [u2a, , u15] = await inventarioConAliado(db, [2, 2, 1.5]);
  const p = (await uno(db, "select id from public.productos where codigo = 'AN-014'")).id;
  await como(db, 'authenticated', ADMIN, () =>
    db.query('update public.productos set precio_unitario_cop = 20000, precio_aliado_unitario_cop = 15000, publicado = true where id = $1', [p]),
  );
  const d = await como(db, 'authenticated', ADMIN, () => uno(db, 'select precio_cop, precio_aliado_cop from public.unidades_detalle where id = $1', [u15]));
  assert.deepEqual([Number(d.precio_cop), Number(d.precio_aliado_cop)], [20000, 15000], 'mismo precio sin importar el peso');
  const ex = await como(db, 'authenticated', ADMIN, () => uno(db, 'select valor_cop from public.existencias where id = $1', [p]));
  assert.equal(Number(ex.valor_cop), 60000);

  const [item] = await catalogo(db);
  assert.deepEqual(item.opciones.map((o) => Number(o.precio_cop)), [20000, 20000]);
  const a = await aliado(db);
  const ca = await catalogoAliado(db, a.token);
  assert.deepEqual(ca.productos[0].opciones.map((o) => [Number(o.precio_cop), Number(o.precio_publico_cop)]), [[15000, 20000], [15000, 20000]]);

  const r = await venta(db, { cajas: [{ es_regalo: false, piezas: [{ unidad_id: u2a }] }] });
  assert.equal(Number(r.monto_cop), 20000);
  const va = await ventaAliado(db, a.id, [{ producto_id: p, peso_gramos: 1.5, cantidad: 1 }]);
  assert.equal(Number(va.monto_cop), 15000);

  // Sin precio fijo de aliado ni precio de aliado en la categoría, sale sin precio y no se le vende.
  await como(db, 'authenticated', ADMIN, async () => {
    await db.query('update public.productos set precio_aliado_unitario_cop = null where id = $1', [p]);
    await db.query("update public.categorias set precio_aliado_gramo_cop = null where nombre = 'Anillos'");
  });
  assert.deepEqual((await catalogoAliado(db, a.token)).productos[0].opciones.map((o) => o.precio_cop), [null]);
  await assert.rejects(ventaAliado(db, a.id, [{ producto_id: p, peso_gramos: 2, cantidad: 1 }]), /precio para aliados/);
});

test('venta por cantidad: toma esa cantidad de piezas del lote más antiguo y no deja vender más de las que hay', async () => {
  const db = await nuevaBase();
  await inventario(db, [0.03, 0.03, 0.03, 0.06]);
  const p = (await uno(db, "select id from public.productos where codigo = 'AN-014'")).id;
  await como(db, 'authenticated', ADMIN, () => db.query('update public.productos set precio_unitario_cop = 20000 where id = $1', [p]));

  const r = await venta(db, {
    cajas: [{ es_regalo: false, piezas: [{ producto_id: p, peso_gramos: 0.03, cantidad: 2 }, { producto_id: p, peso_gramos: 0.06, cantidad: 1 }] }],
  });
  assert.equal(Number(r.monto_cop), 60000);
  const vendidas = await como(db, 'authenticated', ADMIN, () =>
    uno(db, "select count(*) filter (where estado = 'vendida')::int as v, count(*) filter (where estado = 'disponible')::int as d from public.unidades"),
  );
  assert.deepEqual(vendidas, { v: 3, d: 1 });
  assert.equal((await pagina(db, r.cajas[0].codigo_chip)).piezas.length, 3, 'una fila por pieza física');

  await assert.rejects(
    venta(db, { cajas: [{ es_regalo: false, piezas: [{ producto_id: p, peso_gramos: 0.03, cantidad: 2 }] }] }),
    /No hay 2 piezas disponibles/,
  );
  // La que sí está elegida a mano no se repite al pedir por cantidad.
  const libre = (await uno(db, "select id from public.unidades where estado = 'disponible'")).id;
  await assert.rejects(
    venta(db, { cajas: [{ es_regalo: false, piezas: [{ unidad_id: libre }, { producto_id: p, peso_gramos: 0.03, cantidad: 1 }] }] }),
    /No hay 1 piezas disponibles/,
  );
  assert.equal(await estadoUnidad(db, libre), 'disponible', 'un error no deja nada a medias');
});
