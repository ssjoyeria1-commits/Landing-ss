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

  const tablas = ['clientes', 'ventas', 'cajas', 'piezas', 'premios', 'escaneos', 'admins', 'clientes_circulo'];
  const inventario = ['categorias', 'productos', 'productos_catalogo', 'proveedores', 'lotes', 'unidades', 'unidades_detalle', 'existencias', 'lotes_resumen', 'ventas_margen', 'piezas_vendidas'];
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
