import { defineMiddleware } from 'astro:middleware';
import { crearSupabase } from './lib/supabase';

const PUBLICAS_ADMIN = new Set(['/admin/login']);

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  const esAdmin = pathname === '/admin' || pathname.startsWith('/admin/');
  if (!esAdmin) return next();

  const supabase = crearSupabase(context.request, context.cookies);
  context.locals.supabase = supabase;

  // Validar la sesión antes de generar la respuesta, para que un token renovado alcance a guardarse.
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (userId) {
    // La política RLS de admins solo deja ver la fila propia.
    const { data: admin } = await supabase.from('admins').select('user_id').eq('user_id', userId).maybeSingle();
    if (admin) context.locals.usuario = { id: userId, email: String(data.claims.email ?? '') };
  }

  if (!context.locals.usuario && !PUBLICAS_ADMIN.has(pathname)) {
    return context.redirect('/admin/login');
  }

  const respuesta = await next();
  respuesta.headers.set('Cache-Control', 'private, no-store');
  respuesta.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return respuesta;
});
