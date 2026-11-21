/**
 * /js/auth.js
 * Módulo de Autenticación Segura, Contexto Multi-Usuario, Bitácora Entrada/Salida,
 * Control de Inactividad, Perfil Fiscal e Imprenta SENIAT (SENIAT 2026)
 */

const TENANT_SAFE_COLS = [
  'id', 'auth_user_id', 'razon_social', 'rif', 'email', 'telefono', 'direccion',
  'rol', 'plan_activo', 'activo', 'ciclo_facturacion', 'fecha_vencimiento_plan',
  'estado_suscripcion', 'modulos_permitidos', 'codigo_referido', 'referido_por_id',
  'referido_nivel2_id', 'referido_nivel3_id', 'es_promotor_externo', 'datos_cobro_comision',
  'imprenta_nombre', 'imprenta_rif', 'imprenta_providencia', 'imprenta_rango',
  'max_usuarios', 'permisos_manuales', 'created_at'
].join(',');

let tenantActual = null;
let usuarioActual = null;
let sesionAuditoriaActiva = null;
let timerInactividadId = null;
const INACTIVIDAD_MAX_MS = 30 * 60 * 1000;

function sanitizarTenantSeguro(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { password, password_hash, ...safe } = raw;
  return safe;
}

function sanitizarUsuarioSeguro(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { password, password_hash, sha256_hash, ...safe } = raw;
  return safe;
}

function obtenerActorActual() {
  if (usuarioActual) {
    return {
      usuarioId: usuarioActual.id || tenantActual?.id || null,
      usuarioNombre: usuarioActual.nombre_completo || tenantActual?.razon_social || tenantActual?.email || 'Usuario',
      usuarioEmail: usuarioActual.email || tenantActual?.email || '',
      rolInterno: usuarioActual.rol_interno || 'PROPIETARIO',
      sucursalId: usuarioActual.sucursal_id || null,
      modulosPermitidos: Array.isArray(usuarioActual.modulos_permitidos) ? usuarioActual.modulos_permitidos : null,
      esPropietario: usuarioActual.es_propietario !== false
    };
  }
  return {
    usuarioId: tenantActual?.id || null,
    usuarioNombre: tenantActual?.razon_social || tenantActual?.email || 'Usuario',
    usuarioEmail: tenantActual?.email || '',
    rolInterno: String(tenantActual?.rol || '').toLowerCase() === 'master' ? 'MASTER_SAAS' : 'PROPIETARIO',
    sucursalId: null,
    modulosPermitidos: null,
    esPropietario: true
  };
}

async function generarHashSha256Salted(textoPlano) {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const salt = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const enc = new TextEncoder().encode(`${salt}:${textoPlano}`);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `sha256:${salt}:${hex}`;
}

async function verificarHashSha256Salted(textoPlano, hashGuardado) {
  if (!hashGuardado || !String(hashGuardado).startsWith('sha256:')) return false;
  const partes = String(hashGuardado).split(':');
  if (partes.length !== 3) return false;
  const [, salt, hexEsperado] = partes;
  const enc = new TextEncoder().encode(`${salt}:${textoPlano}`);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  const hexReal = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  return hexReal === hexEsperado;
}

function validarRifVzla(rif) {
  if (!rif) return true;
  const regexRif = /^[JGVEP][-]\d{7,10}([-]\d)?$/i;
  return regexRif.test(rif.trim());
}

function avisarAuth(mensaje, tipo = 'warning') {
  if (typeof notificarSistema === 'function') notificarSistema(mensaje, tipo, 6000);
  else console.log(`[${tipo}]`, mensaje);
}

function validarRifInput(inputEl) {
  const val = inputEl.value.trim();
  if (val && !validarRifVzla(val)) {
    inputEl.classList.add('border-rose-500');
    avisarAuth('Formato de RIF o Cédula inválido. Utilice formato venezolano estándar (ej. J-12345678-0 o V-12080468-1).', 'warning');
  } else {
    inputEl.classList.remove('border-rose-500');
  }
}

async function consultarTenantSeguroPorColumna(col, val) {
  if (!supabaseClient) return null;
  let res = await supabaseClient.from('tenants').select(TENANT_SAFE_COLS).eq(col, val).maybeSingle();
  if (res.error && typeof esErrorColumnaOTablaFaltante === 'function' && esErrorColumnaOTablaFaltante(res.error)) {
    res = await supabaseClient.from('tenants').select('id,auth_user_id,razon_social,rif,email,telefono,direccion,rol,plan_activo,activo,created_at').eq(col, val).maybeSingle();
  }
  return res.data ? sanitizarTenantSeguro(res.data) : null;
}

async function registrarIntentoFallidoSesion(email, motivo = 'Credenciales inválidas') {
  const nowIso = new Date().toISOString();
  const payload = {
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `aud-fail-${Date.now()}`,
    tenant_id: tenantActual?.id || '00000000-0000-0000-0000-000000000000',
    usuario_nombre: email,
    usuario_email: email,
    rol_interno: 'DESCONOCIDO',
    evento: 'INTENTO_FALLIDO',
    fecha_entrada: nowIso,
    fecha_salida: nowIso,
    duracion_segundos: 0,
    user_agent: (navigator.userAgent || '').slice(0, 180),
    detalle: motivo
  };
  if (supabaseClient) {
    try {
      await supabaseClient.from('sesiones_auditoria').insert([payload]);
    } catch (e) {}
  }
}

async function registrarEntradaSesion() {
  if (!tenantActual?.id) return null;
  const actor = obtenerActorActual();
  const nowIso = new Date().toISOString();
  const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const registro = {
    id,
    tenant_id: tenantActual.id,
    usuario_id: actor.usuarioId,
    usuario_nombre: actor.usuarioNombre,
    usuario_email: actor.usuarioEmail,
    rol_interno: actor.rolInterno,
    sucursal_id: actor.sucursalId,
    evento: 'ENTRADA',
    fecha_entrada: nowIso,
    fecha_salida: null,
    duracion_segundos: 0,
    user_agent: (navigator.userAgent || '').slice(0, 180),
    detalle: 'Inicio de sesión ERP'
  };

  sesionAuditoriaActiva = registro;
  try {
    localStorage.setItem('mfd_sesion_auditoria_activa', JSON.stringify(registro));
    const key = `mfd_sesiones_aud_${tenantActual.id}`;
    const prev = JSON.parse(localStorage.getItem(key) || '[]');
    prev.unshift(registro);
    localStorage.setItem(key, JSON.stringify(prev.slice(0, 250)));
  } catch (e) {}

  if (supabaseClient) {
    try {
      await supabaseClient.from('sesiones_auditoria').insert([registro]);
    } catch (e) {}
    try {
      await supabaseClient.from('audit_logs').insert([{
        tenant_id: tenantActual.id,
        accion: 'SESION_ENTRADA',
        detalle: JSON.stringify(registro)
      }]);
    } catch (e) {}
    if (!actor.esPropietario && actor.usuarioId) {
      try {
        await supabaseClient
          .from('tenant_usuarios')
          .update({ ultimo_acceso: nowIso, ultimo_evento: 'ENTRADA' })
          .eq('id', actor.usuarioId);
      } catch (e) {}
    }
  }

  iniciarVigilanteInactividad();
  return registro;
}

async function registrarSalidaSesion(evento = 'SALIDA', detalle = 'Cierre de sesión manual') {
  const sesion = sesionAuditoriaActiva || (() => {
    try { return JSON.parse(localStorage.getItem('mfd_sesion_auditoria_activa') || 'null'); } catch (e) { return null; }
  })();
  if (!sesion && !tenantActual?.id) return;

  const nowIso = new Date().toISOString();
  const entradaMs = sesion?.fecha_entrada ? new Date(sesion.fecha_entrada).getTime() : Date.now();
  const duracionSeg = Math.max(1, Math.round((Date.now() - (Number.isFinite(entradaMs) ? entradaMs : Date.now())) / 1000));
  const tenantId = sesion?.tenant_id || tenantActual?.id;
  const actor = obtenerActorActual();

  if (tenantId) {
    try {
      const key = `mfd_sesiones_aud_${tenantId}`;
      const prev = JSON.parse(localStorage.getItem(key) || '[]');
      const idx = prev.findIndex(x => String(x.id) === String(sesion?.id));
      if (idx >= 0) {
        prev[idx].fecha_salida = nowIso;
        prev[idx].duracion_segundos = duracionSeg;
        if (evento !== 'SALIDA') prev[idx].evento = evento;
      } else {
        prev.unshift({
          id: `aud-sal-${Date.now()}`,
          tenant_id: tenantId,
          usuario_id: actor.usuarioId,
          usuario_nombre: actor.usuarioNombre,
          usuario_email: actor.usuarioEmail,
          rol_interno: actor.rolInterno,
          evento,
          fecha_entrada: sesion?.fecha_entrada || nowIso,
          fecha_salida: nowIso,
          duracion_segundos: duracionSeg,
          detalle
        });
      }
      localStorage.setItem(key, JSON.stringify(prev.slice(0, 250)));
    } catch (e) {}

    if (supabaseClient) {
      try {
        if (sesion?.id) {
          await supabaseClient
            .from('sesiones_auditoria')
            .update({
              fecha_salida: nowIso,
              duracion_segundos: duracionSeg,
              ...(evento !== 'SALIDA' ? { evento, detalle } : {})
            })
            .eq('id', sesion.id);
        }
        await supabaseClient.from('audit_logs').insert([{
          tenant_id: tenantId,
          accion: 'SESION_SALIDA',
          detalle: JSON.stringify({
            id: sesion?.id || `aud-sal-${Date.now()}`,
            tenant_id: tenantId,
            usuario_id: actor.usuarioId,
            usuario_nombre: actor.usuarioNombre,
            usuario_email: actor.usuarioEmail,
            rol_interno: actor.rolInterno,
            evento,
            fecha_entrada: sesion?.fecha_entrada || nowIso,
            fecha_salida: nowIso,
            duracion_segundos: duracionSeg,
            detalle
          })
        }]);
        if (!actor.esPropietario && actor.usuarioId) {
          await supabaseClient
            .from('tenant_usuarios')
            .update({ ultimo_acceso: nowIso, ultimo_evento: evento })
            .eq('id', actor.usuarioId);
        }
      } catch (e) {}
    }
  }

  sesionAuditoriaActiva = null;
  localStorage.removeItem('mfd_sesion_auditoria_activa');
}

function reiniciarTemporizadorInactividad() {
  if (!tenantActual) return;
  if (timerInactividadId) clearTimeout(timerInactividadId);
  timerInactividadId = setTimeout(async () => {
    if (tenantActual) {
      await registrarSalidaSesion('CIERRE_INACTIVIDAD', 'Sesión cerrada automáticamente tras 30 min de inactividad');
      avisarAuth('Tu sesión se cerró automáticamente por 30 minutos de inactividad.', 'warning');
      await finalizarLimpiezaSesionUI();
    }
  }, INACTIVIDAD_MAX_MS);
}

function iniciarVigilanteInactividad() {
  if (typeof window === 'undefined') return;
  reiniciarTemporizadorInactividad();
  if (!window.__mfdInactividadRegistrada) {
    window.__mfdInactividadRegistrada = true;
    ['click', 'keydown'].forEach(ev => {
      window.addEventListener(ev, () => {
        if (tenantActual) reiniciarTemporizadorInactividad();
      }, { passive: true });
    });
    window.addEventListener('pagehide', () => {
      if (sesionAuditoriaActiva && tenantActual?.id) {
        try {
          const nowIso = new Date().toISOString();
          const entradaMs = new Date(sesionAuditoriaActiva.fecha_entrada).getTime();
          const dur = Math.max(1, Math.round((Date.now() - entradaMs) / 1000));
          const key = `mfd_sesiones_aud_${tenantActual.id}`;
          const prev = JSON.parse(localStorage.getItem(key) || '[]');
          const idx = prev.findIndex(x => String(x.id) === String(sesionAuditoriaActiva.id));
          if (idx >= 0) {
            prev[idx].fecha_salida = nowIso;
            prev[idx].duracion_segundos = dur;
            localStorage.setItem(key, JSON.stringify(prev));
          }
        } catch (e) {}
      }
    });
  }
}

async function iniciarSesionTenant() {
  const email = (document.getElementById('loginEmail')?.value || '').trim().toLowerCase();
  const pass = (document.getElementById('loginPassword')?.value || '').trim();

  if (!email || !pass) {
    avisarAuth('Por favor, ingrese correo y contraseña.', 'warning');
    return;
  }

  let authExitoso = false;
  let authUserId = null;
  let tenantRes = null;
  let subUsuarioRes = null;

  // 1. Verificar vía Supabase Auth estándar (emite JWT real para RLS)
  if (supabaseClient?.auth) {
    try {
      const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({ email, password: pass });
      if (!authError && authData?.user) {
        authExitoso = true;
        authUserId = authData.user.id;
      }
    } catch (e) {}
  }

  // 2. Verificar vía RPC criptográfica segura (bcrypt en PostgreSQL, soporta sub-usuarios y migración sin texto plano)
  if (supabaseClient) {
    try {
      const { data: rpcData, error: rpcErr } = await supabaseClient.rpc('autenticar_usuario_erp', {
        p_email: email,
        p_password: pass
      });

      if (!rpcErr && rpcData) {
        if (rpcData.ok === true && rpcData.tenant) {
          authExitoso = true;
          tenantRes = sanitizarTenantSeguro(rpcData.tenant);
          subUsuarioRes = sanitizarUsuarioSeguro(rpcData.usuario);

          // Vincular sesión Auth JWT si aún no la tiene para habilitar RLS estricto
          if (!authUserId && supabaseClient.auth) {
            try {
              const { data: suData } = await supabaseClient.auth.signUp({ email, password: pass });
              if (suData?.user?.id) {
                authUserId = suData.user.id;
                await supabaseClient.rpc('registrar_credencial_erp', {
                  p_tipo: rpcData.tipo === 'USUARIO' ? 'USUARIO' : 'TENANT',
                  p_entidad_id: rpcData.tipo === 'USUARIO' ? subUsuarioRes.id : tenantRes.id,
                  p_email: email,
                  p_password: pass,
                  p_auth_user_id: authUserId
                });
              }
            } catch (e) {}
          }
        } else if (rpcData.ok === false && rpcData.error && /suspendido/i.test(rpcData.error)) {
          await registrarIntentoFallidoSesion(email, rpcData.error);
          avisarAuth(rpcData.error, 'error');
          return;
        }
      } else if (rpcErr && (/42883|PGRST202|does not exist/i.test(`${rpcErr.code || ''} ${rpcErr.message || ''}`))) {
        // 3. Compatibilidad controlada SOLO mientras el Master ejecuta el script SQL v100 en Supabase
        // (sin claves maestras quemadas en código fuente; limpia la contraseña inmediatamente)
        try {
          const { data: subChk } = await supabaseClient
            .from('tenant_usuarios')
            .select('id, tenant_id, nombre_completo, email, rol_interno, sucursal_id, modulos_permitidos, activo')
            .eq('email', email)
            .maybeSingle();
          if (subChk) {
            if (subChk.activo === false) {
              await registrarIntentoFallidoSesion(email, 'Sub-usuario suspendido');
              avisarAuth('Usuario suspendido por el administrador de la empresa.', 'error');
              return;
            }
            const credLocal = JSON.parse(localStorage.getItem('mfd_credenciales_fallback') || '{}')[email];
            const hashOk = credLocal?.hash ? await verificarHashSha256Salted(pass, credLocal.hash) : false;
            if (hashOk) {
              authExitoso = true;
              subUsuarioRes = sanitizarUsuarioSeguro({ ...subChk, es_propietario: false });
              tenantRes = await consultarTenantSeguroPorColumna('id', subChk.tenant_id);
            }
          }
        } catch (e) {}

        if (!authExitoso) {
          // Verificar si existe registro en respaldo local SHA-256 pre-SQL (tenants o sub-usuarios creados antes de migrar)
          try {
            const credLocal = JSON.parse(localStorage.getItem('mfd_credenciales_fallback') || '{}')[email];
            if (credLocal?.hash && await verificarHashSha256Salted(pass, credLocal.hash)) {
              const localUsrs = JSON.parse(localStorage.getItem(`mfd_usuarios_${credLocal.tenant_id}`) || '[]');
              const matchU = localUsrs.find(u => String(u.email || '').toLowerCase() === email);
              if (matchU) {
                if (matchU.activo === false) {
                  await registrarIntentoFallidoSesion(email, 'Sub-usuario suspendido');
                  avisarAuth('Usuario suspendido por el administrador de la empresa.', 'error');
                  return;
                }
                authExitoso = true;
                subUsuarioRes = sanitizarUsuarioSeguro({ ...matchU, es_propietario: false });
                tenantRes = await consultarTenantSeguroPorColumna('id', credLocal.tenant_id);
              } else {
                authExitoso = true;
                tenantRes = await consultarTenantSeguroPorColumna('id', credLocal.tenant_id);
              }
            }
          } catch (e) {}
        }

        if (!authExitoso) {
          await registrarIntentoFallidoSesion(email, 'Falta ejecutar SQL v100 en Supabase o credenciales inválidas');
          avisarAuth('Ejecuta sql/migracion_seguridad_usuarios_v100.sql en el SQL Editor de Supabase para habilitar el acceso seguro con bóveda Bcrypt.', 'warning');
          return;
        }
      }
    } catch (e) {}
  }

  // Si Supabase Auth tuvo éxito pero faltan perfiles cargados
  if (authExitoso && !tenantRes && authUserId) {
    try {
      const { data: subRow } = await supabaseClient
        .from('tenant_usuarios')
        .select('id, tenant_id, nombre_completo, email, rol_interno, sucursal_id, modulos_permitidos, activo')
        .eq('email', email)
        .maybeSingle();
      if (subRow) {
        if (subRow.activo === false) {
          await registrarIntentoFallidoSesion(email, 'Usuario suspendido');
          avisarAuth('Usuario suspendido por el administrador de la empresa.', 'error');
          return;
        }
        subUsuarioRes = { ...subRow, es_propietario: false };
        tenantRes = await consultarTenantSeguroPorColumna('id', subRow.tenant_id);
      }
    } catch (e) {}

    if (!tenantRes) {
      tenantRes = (await consultarTenantSeguroPorColumna('auth_user_id', authUserId))
        || (await consultarTenantSeguroPorColumna('email', email));
    }
  }

  if (!authExitoso || !tenantRes) {
    await registrarIntentoFallidoSesion(email, 'Correo o contraseña incorrectos');
    avisarAuth('Error de autenticación: Correo o contraseña incorrectos.', 'error');
    return;
  }

  tenantActual = sanitizarTenantSeguro(tenantRes);
  if (!tenantActual.plan_activo) tenantActual.plan_activo = 'Freemium';

  usuarioActual = subUsuarioRes
    ? sanitizarUsuarioSeguro(subUsuarioRes)
    : {
        id: tenantActual.id,
        tenant_id: tenantActual.id,
        nombre_completo: tenantActual.razon_social || tenantActual.email,
        email: tenantActual.email,
        rol_interno: String(tenantActual.rol || '').toLowerCase() === 'master' ? 'MASTER_SAAS' : 'PROPIETARIO',
        sucursal_id: null,
        modulos_permitidos: null,
        es_propietario: true
      };

  localStorage.setItem('tenant_actual', JSON.stringify(tenantActual));
  localStorage.setItem('mfd_usuario_actual', JSON.stringify(usuarioActual));

  if (typeof sincronizarMetaSaasTenantActual === 'function') {
    await sincronizarMetaSaasTenantActual();
  }

  await registrarEntradaSesion();
  activarVistaPrincipal();
}

async function verificarSesionGuardada() {
  const guardado = localStorage.getItem('tenant_actual');
  const usrGuardado = localStorage.getItem('mfd_usuario_actual');
  const sesActiva = localStorage.getItem('mfd_sesion_auditoria_activa');

  if (guardado) {
    try {
      tenantActual = sanitizarTenantSeguro(JSON.parse(guardado));
      usuarioActual = usrGuardado ? sanitizarUsuarioSeguro(JSON.parse(usrGuardado)) : null;
      sesionAuditoriaActiva = sesActiva ? JSON.parse(sesActiva) : null;
    } catch (e) {
      tenantActual = null;
    }
    if (!tenantActual?.id) return;

    localStorage.setItem('tenant_actual', JSON.stringify(tenantActual));
    activarVistaPrincipal();
    iniciarVigilanteInactividad();

    if (typeof sincronizarMetaSaasTenantActual === 'function') {
      await sincronizarMetaSaasTenantActual();
      if (typeof aplicarPermisosMenuTenant === 'function') aplicarPermisosMenuTenant();
    }
  }
}

function activarVistaPrincipal() {
  const vistaLanding = document.getElementById('vistaLanding');
  const vistaLogin = document.getElementById('vistaLogin');
  const chatW = document.getElementById('chatFlotanteWhatsapp');
  const vistaPrin = document.getElementById('vistaPrincipal');

  if (vistaLanding) vistaLanding.classList.add('hidden');
  if (vistaLogin) vistaLogin.classList.add('hidden');
  if (chatW) chatW.classList.add('hidden');
  if (vistaPrin) vistaPrin.classList.remove('hidden');

  const actor = obtenerActorActual();
  const nombreEl = document.getElementById('headerTenantNombre');
  const rifEl = document.getElementById('headerTenantRif');
  const rolEl = document.getElementById('headerTenantRol');
  const planEl = document.getElementById('headerTenantPlan');

  if (nombreEl) {
    nombreEl.innerText = actor.esPropietario
      ? (tenantActual.razon_social || tenantActual.email)
      : `${tenantActual.razon_social} · ${actor.usuarioNombre}`;
  }
  if (rifEl) rifEl.innerText = tenantActual.rif || 'J-00000000-0';
  if (rolEl) rolEl.innerText = String(actor.rolInterno || tenantActual.rol || 'tenant').toUpperCase();
  if (planEl) planEl.innerText = (tenantActual.plan_activo || 'Freemium').toUpperCase();

  if (typeof aplicarPermisosMenuTenant === 'function') {
    aplicarPermisosMenuTenant();
  } else {
    const esMaster = String(tenantActual.rol || '').toLowerCase() === 'master' || String(tenantActual.email || '').toLowerCase() === 'ervec2000@gmail.com';
    document.querySelectorAll('.tab-master').forEach(el => {
      if (esMaster) el.classList.remove('hidden'); else el.classList.add('hidden');
    });
  }

  let pestanaInicial = 'pos';
  if (typeof esUsuarioMaster === 'function' && esUsuarioMaster(tenantActual)) {
    pestanaInicial = 'inquilinosMaster';
  } else if (typeof esPromotorExterno === 'function' && esPromotorExterno(tenantActual)) {
    pestanaInicial = 'referidos';
  } else if (typeof puedeAccederModuloErp === 'function' && !puedeAccederModuloErp('pos')) {
    const permitidos = typeof obtenerPermisosEfectivosTenant === 'function' ? obtenerPermisosEfectivosTenant(tenantActual) : ['suscripcion'];
    pestanaInicial = permitidos[0] || 'suscripcion';
  }
  cambiarPestana(pestanaInicial);
  if (pestanaInicial === 'inquilinosMaster' && typeof marcarBotonSidebarMaster === 'function') {
    marcarBotonSidebarMaster('tenants');
  }
}

async function finalizarLimpiezaSesionUI() {
  if (timerInactividadId) clearTimeout(timerInactividadId);
  localStorage.removeItem('tenant_actual');
  localStorage.removeItem('mfd_usuario_actual');
  localStorage.removeItem('mfd_sesion_auditoria_activa');
  tenantActual = null;
  usuarioActual = null;
  sesionAuditoriaActiva = null;

  if (supabaseClient?.auth) {
    try { await supabaseClient.auth.signOut(); } catch (e) {}
  }

  const vistaPrin = document.getElementById('vistaPrincipal');
  const vistaLanding = document.getElementById('vistaLanding');
  const vistaLogin = document.getElementById('vistaLogin');
  const chatW = document.getElementById('chatFlotanteWhatsapp');

  if (vistaPrin) vistaPrin.classList.add('hidden');
  if (vistaLogin) vistaLogin.classList.add('hidden');
  if (vistaLanding) vistaLanding.classList.remove('hidden');
  if (chatW) chatW.classList.remove('hidden');
}

async function cerrarSesion() {
  await registrarSalidaSesion('SALIDA', 'Cierre de sesión voluntario');
  await finalizarLimpiezaSesionUI();
}

let sidebarColapsado = false;

function toggleSidebarColapso() {
  sidebarColapsado = !sidebarColapsado;
  const sidebar = document.getElementById('sidebarErp');
  if (!sidebar) return;

  if (sidebarColapsado) {
    sidebar.classList.remove('lg:w-64');
    sidebar.classList.add('lg:w-16');
  } else {
    sidebar.classList.remove('lg:w-16');
    sidebar.classList.add('lg:w-64');
  }

  document.querySelectorAll('.sidebar-label').forEach(el => {
    if (sidebarColapsado) el.classList.add('lg:hidden'); else el.classList.remove('lg:hidden');
  });
  document.querySelectorAll('.sidebar-section-title').forEach(el => {
    if (sidebarColapsado) el.classList.add('lg:hidden'); else el.classList.remove('lg:hidden');
  });
}

function toggleSidebarMovil(forzarCerrar = false) {
  const sidebar = document.getElementById('sidebarErp');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (!sidebar) return;

  const estaAbierto = !sidebar.classList.contains('-translate-x-full');
  const abrir = forzarCerrar ? false : !estaAbierto;

  if (abrir) {
    sidebar.classList.remove('-translate-x-full');
    if (backdrop) backdrop.classList.remove('hidden');
  } else {
    sidebar.classList.add('-translate-x-full');
    if (backdrop) backdrop.classList.add('hidden');
  }
}

const TITULOS_MODULOS_ERP = {
  pos: 'POS y Facturación / Ventas POS (POS-001 · POS-009)',
  historial: 'Historial y Cierres / Comprobantes SENIAT (SEN-001 · SEN-006)',
  notasFiscales: 'Historial y Cierres / Notas de Crédito y Débito (SEN-004 · SEN-005)',
  cierrez: 'Historial y Cierres / Reporte Z y Libros Oficiales (CIE-001 · CIE-003)',
  cuentas: 'Historial y Cierres / Cuentas por Cobrar y Alertas (CIE-005 · CAT-007)',
  kardex: 'Inventario y Kardex / Trazabilidad Kardex PPM (INV-001)',
  fisico: 'Inventario y Kardex / Conteo Físico y Conciliación (INV-002 · INV-008)',
  transferencias: 'Inventario y Kardex / Transferencias entre Depósitos (INV-009)',
  lotes: 'Inventario y Kardex / Lotes y Vencimientos',
  etiquetas: 'Inventario y Kardex / Etiquetas QR Tamaño Carta (CAT-004)',
  compras: 'Compras y Tributos / Registro de Compras y PPM (COM-001 · COM-003)',
  retenciones: 'Compras y Tributos / Retenciones IVA SENIAT (IMP-001 · IMP-002)',
  contabilidad: 'Contabilidad y ERP / Plan de Cuentas, Libro Diario e Integración VEN-NIF',
  productos: 'Catálogos y Maestros / Gestión de Artículos (CAT-001 · CAT-003)',
  clientes: 'Catálogos y Maestros / Maestro de Clientes (CAT-006)',
  proveedores: 'Catálogos y Maestros / Maestro de Proveedores',
  sucursales: 'Catálogos y Maestros / Sucursales',
  almacenes: 'Catálogos y Maestros / Almacenes y Depósitos',
  unidades: 'Catálogos y Maestros / Unidades de Medida (CAT-005)',
  tiposIva: 'Catálogos y Maestros / Alícuotas e IVA',
  viasPago: 'Catálogos y Maestros / Vías y Métodos de Pago',
  usuarios: 'Catálogos y Maestros / Equipo, Permisos y Entradas/Salidas',
  referidos: 'Catálogos y Maestros / Programa de Afiliados',
  suscripcion: 'Cuenta y Suscripción / Mi Plan y Pagos SaaS',
  inquilinosMaster: 'Administración SaaS / Panel Master Multitenant (MAS-001)'
};

function cambiarPestana(pestana) {
  if (typeof puedeAccederModuloErp === 'function' && tenantActual && !puedeAccederModuloErp(pestana)) {
    avisarAuth('Este módulo no está habilitado para tu usuario o plan. Consulta tu plan o contacta al administrador.', 'warning');
    const permitidos = typeof obtenerPermisosEfectivosTenant === 'function' ? obtenerPermisosEfectivosTenant(tenantActual) : ['pos'];
    const destino = permitidos[0] || 'suscripcion';
    if (pestana !== destino) {
      pestana = destino;
    } else {
      return;
    }
  }

  const tabs = [
    'pos', 'historial', 'notasFiscales', 'cierrez', 'cuentas',
    'kardex', 'fisico', 'transferencias', 'lotes', 'etiquetas',
    'compras', 'retenciones', 'contabilidad',
    'productos', 'clientes', 'proveedores', 'sucursales', 'almacenes',
    'unidades', 'tiposIva', 'viasPago', 'usuarios', 'referidos', 'suscripcion', 'inquilinosMaster'
  ];

  tabs.forEach(t => {
    const btn = document.getElementById('btnTab' + t.charAt(0).toUpperCase() + t.slice(1));
    const sec = document.getElementById('seccion' + t.charAt(0).toUpperCase() + t.slice(1));
    if (sec) {
      if (t === pestana) sec.classList.remove('hidden');
      else sec.classList.add('hidden');
    }
    if (btn) {
      if (t === pestana) {
        btn.classList.add('bg-emerald-500/10', 'text-emerald-400', 'border-emerald-500/30');
        btn.classList.remove('text-slate-400', 'border-transparent', 'hover:bg-slate-900', 'hover:text-slate-200');
      } else {
        btn.classList.remove('bg-emerald-500/10', 'text-emerald-400', 'border-emerald-500/30');
        btn.classList.add('text-slate-400', 'border-transparent', 'hover:bg-slate-900', 'hover:text-slate-200');
      }
    }
  });

  const elTitulo = document.getElementById('headerSeccionActual');
  if (elTitulo) elTitulo.textContent = TITULOS_MODULOS_ERP[pestana] || 'Panel ERP';

  toggleSidebarMovil(true);

  if (pestana === 'historial') cargarHistorial();
  if (pestana === 'notasFiscales') {
    if (typeof inicializarModuloNotasFiscales === 'function') inicializarModuloNotasFiscales();
    else if (typeof cargarFacturasAfectadasSelect === 'function') cargarFacturasAfectadasSelect();
  }
  if (pestana === 'cierrez') {
    const hoy = new Date().toISOString().slice(0, 10);
    const dDesde = document.getElementById('filtroFechaDesde');
    const dHasta = document.getElementById('filtroFechaHasta');
    if (dDesde) dDesde.value = hoy;
    if (dHasta) dHasta.value = hoy;
    generarReporteZ();
  }
  if (pestana === 'compras') {
    if (typeof inicializarModuloCompras === 'function') inicializarModuloCompras();
    else {
      if (typeof cargarProductosSelectCompra === 'function') cargarProductosSelectCompra();
      if (typeof cargarProveedoresSelectCompra === 'function') cargarProveedoresSelectCompra();
    }
  }
  if (pestana === 'proveedores' && typeof cargarProveedoresGestion === 'function') cargarProveedoresGestion();
  if (pestana === 'retenciones') cargarRetenciones();
  if (pestana === 'contabilidad' && typeof cargarModuloContabilidad === 'function') cargarModuloContabilidad();
  if (pestana === 'kardex') cargarKardexMovimientos();
  if (pestana === 'fisico') {
    const fFisico = document.getElementById('fisicoFecha');
    if (fFisico) fFisico.value = new Date().toISOString().slice(0, 10);
    cargarInventarioFisico();
  }
  if (pestana === 'transferencias' && typeof inicializarTransferenciasDeposito === 'function') {
    inicializarTransferenciasDeposito();
  }
  if (pestana === 'sucursales' && typeof cargarSucursalesGestion === 'function') cargarSucursalesGestion();
  if (pestana === 'almacenes') {
    if (typeof cargarSucursalesSelectAlmacen === 'function') cargarSucursalesSelectAlmacen();
    if (typeof cargarAlmacenesGestion === 'function') cargarAlmacenesGestion();
  }
  if (pestana === 'lotes') {
    if (typeof cargarProductosSelectLote === 'function') cargarProductosSelectLote();
    if (typeof cargarAlmacenesSelectLote === 'function') cargarAlmacenesSelectLote();
    if (typeof cargarLotesGestion === 'function') cargarLotesGestion();
  }
  if (pestana === 'etiquetas' && typeof renderizarEtiquetasQr === 'function') renderizarEtiquetasQr();
  if (pestana === 'cuentas' && typeof cargarCuentasPorCobrar === 'function') cargarCuentasPorCobrar();
  if (pestana === 'unidades' && typeof cargarUnidadesMedidaGestion === 'function') cargarUnidadesMedidaGestion();
  if (pestana === 'tiposIva' && typeof cargarTiposIvaGestion === 'function') cargarTiposIvaGestion();
  if (pestana === 'viasPago' && typeof cargarViasPagoGestion === 'function') cargarViasPagoGestion();
  if (pestana === 'productos') {
    if (typeof cargarUnidadesSelectForm === 'function') cargarUnidadesSelectForm();
    if (typeof cargarTiposIvaSelectForm === 'function') cargarTiposIvaSelectForm();
    if (typeof cargarProductosGestion === 'function') cargarProductosGestion();
  }
  if (pestana === 'clientes' && typeof cargarClientesGestion === 'function') cargarClientesGestion();
  if (pestana === 'usuarios' && typeof cargarModuloUsuarios === 'function') cargarModuloUsuarios();
  if (pestana === 'referidos' && typeof cargarDatosReferidos === 'function') cargarDatosReferidos();
  if (pestana === 'suscripcion' && typeof cargarModuloSuscripcion === 'function') cargarModuloSuscripcion();
  if (pestana === 'inquilinosMaster') {
    if (typeof cargarPanelMasterCompleto === 'function') cargarPanelMasterCompleto();
    else if (typeof cargarInquilinosMaster === 'function') cargarInquilinosMaster();
  }
  if (pestana === 'pos') {
    if (typeof inicializarModuloPos === 'function') {
      inicializarModuloPos();
    } else {
      if (typeof cargarProductosSelect === 'function') cargarProductosSelect();
      if (typeof cargarClientesSelect === 'function') cargarClientesSelect();
      if (typeof cargarViasPagoSelectPos === 'function') cargarViasPagoSelectPos();
      if (typeof cargarSucursalesYAlmacenesPos === 'function') cargarSucursalesYAlmacenesPos();
    }
  }
}

function abrirModalPerfil() {
  if (!tenantActual) return;
  document.getElementById('perfilEmail').value = tenantActual.email || '';
  document.getElementById('perfilRazonSocial').value = tenantActual.razon_social || '';
  document.getElementById('perfilRif').value = tenantActual.rif || '';
  document.getElementById('perfilTelefono').value = tenantActual.telefono || '';
  document.getElementById('perfilDireccion').value = tenantActual.direccion || '';

  let imprentaLocal = {};
  try {
    imprentaLocal = JSON.parse(localStorage.getItem(`imprenta_seniat_${tenantActual.id}`) || '{}');
  } catch (e) {}

  const elImpNom = document.getElementById('perfilImprentaNombre');
  const elImpRif = document.getElementById('perfilImprentaRif');
  const elImpProv = document.getElementById('perfilImprentaProvidencia');
  const elImpRan = document.getElementById('perfilImprentaRango');
  if (elImpNom) elImpNom.value = tenantActual.imprenta_nombre || imprentaLocal.nombre || '';
  if (elImpRif) elImpRif.value = tenantActual.imprenta_rif || imprentaLocal.rif || '';
  if (elImpProv) elImpProv.value = tenantActual.imprenta_providencia || imprentaLocal.providencia || '';
  if (elImpRan) elImpRan.value = tenantActual.imprenta_rango || imprentaLocal.rango || '';

  document.getElementById('modalPerfilUsuario').classList.remove('hidden');
}

function cerrarModalPerfil() { document.getElementById('modalPerfilUsuario').classList.add('hidden'); }

async function guardarCambiosPerfil() {
  const rifVal = document.getElementById('perfilRif').value.trim();
  if (rifVal && !validarRifVzla(rifVal)) { avisarAuth('Formato de RIF inválido.', 'warning'); return; }

  const impNombre = (document.getElementById('perfilImprentaNombre')?.value || '').trim();
  const impRif = (document.getElementById('perfilImprentaRif')?.value || '').trim();
  const impProv = (document.getElementById('perfilImprentaProvidencia')?.value || '').trim();
  const impRango = (document.getElementById('perfilImprentaRango')?.value || '').trim();

  const payloadBase = {
    razon_social: document.getElementById('perfilRazonSocial').value.trim(),
    rif: rifVal,
    telefono: document.getElementById('perfilTelefono').value.trim(),
    direccion: document.getElementById('perfilDireccion').value.trim()
  };

  const payloadImprenta = {
    imprenta_nombre: impNombre || null,
    imprenta_rif: impRif || null,
    imprenta_providencia: impProv || null,
    imprenta_rango: impRango || null
  };

  let res = await supabaseClient.from('tenants').update({ ...payloadBase, ...payloadImprenta }).eq('id', tenantActual.id);
  if (res.error && typeof esErrorColumnaOTablaFaltante === 'function' && esErrorColumnaOTablaFaltante(res.error)) {
    res = await supabaseClient.from('tenants').update(payloadBase).eq('id', tenantActual.id);
  }
  if (res.error) { avisarAuth('Error al actualizar perfil: ' + res.error.message, 'error'); return; }

  if (impNombre || impRif || impProv || impRango) {
    localStorage.setItem(`imprenta_seniat_${tenantActual.id}`, JSON.stringify({
      nombre: impNombre || 'IMPRENTA DIGITAL AUTORIZADA',
      rif: impRif || 'J-00000000-0',
      providencia: impProv || 'SNAT/2024/000102',
      rango: impRango || '00-00000001 al 00-00099999'
    }));
  }

  if (typeof guardarMetaYEstadoTenantEnNube === 'function') {
    await guardarMetaYEstadoTenantEnNube(tenantActual.id, payloadBase, payloadImprenta);
  }

  tenantActual = sanitizarTenantSeguro({ ...tenantActual, ...payloadBase, ...payloadImprenta });
  localStorage.setItem('tenant_actual', JSON.stringify(tenantActual));
  avisarAuth('Perfil fiscal e Imprenta Digital guardados en Supabase con éxito.', 'success');
  cerrarModalPerfil();
  activarVistaPrincipal();
}

function enviarFormularioContactoLanding() {
  const nom = document.getElementById('contactoNombre')?.value || 'Interesado';
  const tel = document.getElementById('contactoTelefono')?.value || '';
  const urlW = `https://api.whatsapp.com/send?text=Hola,%20mi%20nombre%20es%20${encodeURIComponent(nom)}%20y%20mi%20teléfono%20es%20${encodeURIComponent(tel)}. Deseo solicitar más información y demo de MiFacturaDigital.`;
  window.open(urlW, '_blank');
}
