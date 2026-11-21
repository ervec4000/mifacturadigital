/**
 * /js/usuarios.js
 * Gestión Multi-Usuario por Cliente (RBAC Interno), Límites por Plan,
 * Bitácora Cronológica de Entradas y Salidas (Cliente y Panel Master Global),
 * Exportación Excel / PDF Imprimible y Auditoría de Sesiones.
 */

const ROLES_INTERNOS_DEF = {
  ADMIN_EMPRESA: {
    nombre: 'Administrador de Empresa',
    badge: 'bg-emerald-950 text-emerald-300 border-emerald-700/50',
    modulos: [
      'pos', 'historial', 'notasFiscales', 'cierrez', 'cuentas',
      'kardex', 'fisico', 'transferencias', 'lotes', 'etiquetas',
      'compras', 'retenciones', 'contabilidad', 'productos', 'clientes',
      'proveedores', 'sucursales', 'almacenes', 'unidades', 'tiposIva',
      'viasPago', 'usuarios', 'referidos', 'suscripcion'
    ]
  },
  SUPERVISOR: {
    nombre: 'Supervisor Operativo',
    badge: 'bg-sky-950 text-sky-300 border-sky-700/50',
    modulos: ['pos', 'historial', 'notasFiscales', 'cierrez', 'cuentas', 'kardex', 'fisico', 'etiquetas', 'compras', 'productos', 'clientes', 'proveedores']
  },
  CAJERO_POS: {
    nombre: 'Cajero / Facturador POS',
    badge: 'bg-amber-950 text-amber-300 border-amber-700/50',
    modulos: ['pos', 'historial', 'clientes', 'etiquetas']
  },
  ALMACENISTA: {
    nombre: 'Almacenista / Inventario',
    badge: 'bg-indigo-950 text-indigo-300 border-indigo-700/50',
    modulos: ['kardex', 'fisico', 'transferencias', 'lotes', 'etiquetas', 'compras', 'productos', 'almacenes']
  },
  CONTADOR: {
    nombre: 'Contador / Auditor Fiscal',
    badge: 'bg-purple-950 text-purple-300 border-purple-700/50',
    modulos: ['historial', 'notasFiscales', 'cierrez', 'cuentas', 'compras', 'retenciones', 'contabilidad']
  }
};

const LIMITES_USUARIOS_PLAN = {
  Freemium: 2,
  Pyme: 5,
  Enterprise: 25,
  'Administración': 50,
  Promotor: 1
};

let tenantUsuariosCache = [];
let tenantSesionesCache = [];
let masterUsuariosCache = [];
let masterSesionesCache = [];
let tenantSucursalesUsuariosCache = [];

function avisarUsuarios(msg, tipo = 'info', duracion = 5500) {
  if (typeof notificarSistema === 'function') notificarSistema(msg, tipo, duracion);
  else console.log(`[USUARIOS:${tipo}]`, msg);
}

function obtenerCupoUsuariosTenant(tenant = tenantActual) {
  if (!tenant) return 2;
  if (typeof esUsuarioMaster === 'function' && esUsuarioMaster(tenant)) return 999;
  const custom = Number(tenant.max_usuarios || 0);
  if (Number.isFinite(custom) && custom > 0) return custom;
  const plan = typeof normalizarNombrePlan === 'function' ? normalizarNombrePlan(tenant.plan_activo) : (tenant.plan_activo || 'Freemium');
  return LIMITES_USUARIOS_PLAN[plan] || 2;
}

function obtenerModulosAutorizadosEmpresa(tenant = tenantActual) {
  if (!tenant) return ['pos', 'historial', 'suscripcion'];
  if (typeof esUsuarioMaster === 'function' && esUsuarioMaster(tenant)) {
    return (typeof MODULOS_ERP_SAAS !== 'undefined' ? MODULOS_ERP_SAAS : []).map(m => m.id);
  }
  const enriched = typeof fusionarTenantConMetaSaas === 'function' ? fusionarTenantConMetaSaas(tenant) : tenant;
  if (Array.isArray(enriched.modulos_permitidos) && enriched.modulos_permitidos.length > 0) {
    return enriched.modulos_permitidos;
  }
  if (typeof obtenerPresetModulosPorPlan === 'function') {
    return obtenerPresetModulosPorPlan(enriched.plan_activo || 'Freemium');
  }
  return ['pos', 'historial', 'productos', 'clientes', 'usuarios', 'suscripcion'];
}

function formatearFechaHoraAud(iso) {
  if (!iso) return '--';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}:${ss}`;
}

function formatearDuracionSeg(seg) {
  const s = Math.max(0, Math.round(Number(seg || 0)));
  if (!s) return '--';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(r).padStart(2, '0')}s`;
  return `${r}s`;
}

// ==========================================
// 1. CARGA DE MÓDULO CLIENTE: EQUIPO Y BITÁCORA
// ==========================================

async function cargarModuloUsuarios() {
  if (!tenantActual?.id) return;
  const tenantId = tenantActual.id;

  pintarChecklistModulosUsuario(obtenerModulosAutorizadosEmpresa(tenantActual));

  await Promise.all([
    cargarSucursalesParaUsuarios(tenantId),
    cargarListaUsuariosTenant(tenantId),
    cargarBitacoraSesionesTenant(tenantId)
  ]);

  pintarKpisUsuariosTenant();
  renderizarTablaUsuariosTenant();
  poblarFiltroUsuariosAuditoria();
  renderizarTablaBitacoraTenant();
}

async function cargarSucursalesParaUsuarios(tenantId) {
  if (!supabaseClient) return;
  try {
    const { data } = await supabaseClient
      .from('sucursales')
      .select('id, nombre')
      .eq('tenant_id', tenantId)
      .order('nombre', { ascending: true });
    tenantSucursalesUsuariosCache = data || [];
  } catch (e) {
    tenantSucursalesUsuariosCache = [];
  }
  const sel = document.getElementById('usrSucursalId');
  if (sel) {
    sel.innerHTML = '<option value="">Todas las Sucursales</option>';
    tenantSucursalesUsuariosCache.forEach(s => {
      sel.innerHTML += `<option value="${esc(s.id)}">${esc(s.nombre)}</option>`;
    });
  }
}

function pintarChecklistModulosUsuario(modulosEmpresa = [], seleccionados = null) {
  const cont = document.getElementById('usrChecksModulos');
  if (!cont || typeof MODULOS_ERP_SAAS === 'undefined') return;

  const setEmp = new Set(modulosEmpresa);
  const rol = document.getElementById('usrRolInterno')?.value || 'CAJERO_POS';
  const preset = seleccionados
    ? new Set(seleccionados)
    : new Set((ROLES_INTERNOS_DEF[rol]?.modulos || ['pos', 'historial']).filter(m => setEmp.has(m)));

  const disponibles = MODULOS_ERP_SAAS.filter(m => setEmp.has(m.id) && m.id !== 'suscripcion');
  cont.innerHTML = disponibles.map(m => `
    <label class="flex items-center gap-2 text-xs text-slate-200 cursor-pointer bg-slate-950/70 border border-slate-800 rounded-lg px-2.5 py-1.5 hover:border-emerald-500/40">
      <input type="checkbox" class="chk-usr-modulo accent-emerald-500 rounded" value="${esc(m.id)}" ${preset.has(m.id) ? 'checked' : ''}>
      <span class="truncate">${esc(m.nombre)}</span>
    </label>
  `).join('');
}

function aplicarPresetRolUsuarioForm() {
  const rol = document.getElementById('usrRolInterno')?.value || 'CAJERO_POS';
  const preset = new Set(ROLES_INTERNOS_DEF[rol]?.modulos || ['pos', 'historial']);
  document.querySelectorAll('.chk-usr-modulo').forEach(chk => {
    chk.checked = preset.has(chk.value);
  });
}

async function cargarListaUsuariosTenant(tenantId) {
  const mapa = new Map();

  try {
    const local = JSON.parse(localStorage.getItem(`mfd_usuarios_${tenantId}`) || '[]');
    if (Array.isArray(local)) local.forEach(u => { if (u?.id) mapa.set(String(u.id), u); });
  } catch (e) {}

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('tenant_usuarios')
        .select('id, tenant_id, auth_user_id, nombre_completo, email, rol_interno, sucursal_id, modulos_permitidos, activo, ultimo_acceso, ultimo_evento, creado_por, created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        data.forEach(u => {
          const prev = mapa.get(String(u.id)) || {};
          mapa.set(String(u.id), { ...prev, ...u });
        });
      }
    } catch (e) {}

    // Fallback desde audit_logs si la tabla aún no ha sido migrada
    try {
      const { data: logs } = await supabaseClient
        .from('audit_logs')
        .select('detalle, created_at')
        .eq('tenant_id', tenantId)
        .eq('accion', 'TENANT_USUARIO_SYNC')
        .order('created_at', { ascending: true })
        .limit(200);
      if (Array.isArray(logs)) {
        logs.forEach(l => {
          try {
            const parsed = JSON.parse(l.detalle || '{}');
            if (parsed.eliminado && parsed.id) {
              mapa.delete(String(parsed.id));
            } else if (parsed.id && !mapa.has(String(parsed.id))) {
              const { password_hash, password, ...safe } = parsed;
              mapa.set(String(parsed.id), safe);
            }
          } catch (e) {}
        });
      }
    } catch (e) {}
  }

  tenantUsuariosCache = Array.from(mapa.values()).sort((a, b) =>
    String(b.created_at || '').localeCompare(String(a.created_at || ''))
  );
  try {
    const sinHashes = tenantUsuariosCache.map(({ password_hash, password, ...rest }) => rest);
    localStorage.setItem(`mfd_usuarios_${tenantId}`, JSON.stringify(sinHashes));
  } catch (e) {}
  return tenantUsuariosCache;
}

async function cargarBitacoraSesionesTenant(tenantId) {
  const mapa = new Map();

  try {
    const local = JSON.parse(localStorage.getItem(`mfd_sesiones_aud_${tenantId}`) || '[]');
    if (Array.isArray(local)) local.forEach(s => { if (s?.id) mapa.set(String(s.id), s); });
  } catch (e) {}

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('sesiones_auditoria')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(400);
      if (!error && Array.isArray(data)) {
        data.forEach(s => mapa.set(String(s.id), s));
      }
    } catch (e) {}

    try {
      const { data: logs } = await supabaseClient
        .from('audit_logs')
        .select('id, detalle, created_at')
        .eq('tenant_id', tenantId)
        .in('accion', ['SESION_ENTRADA', 'SESION_SALIDA', 'SESION_INTENTO_FALLIDO'])
        .order('created_at', { ascending: false })
        .limit(250);
      if (Array.isArray(logs)) {
        logs.forEach(l => {
          try {
            const p = JSON.parse(l.detalle || '{}');
            const id = String(p.id || l.id);
            if (!mapa.has(id)) {
              mapa.set(id, { id, created_at: l.created_at, ...p });
            } else if (p.fecha_salida && !mapa.get(id).fecha_salida) {
              mapa.set(id, { ...mapa.get(id), ...p });
            }
          } catch (e) {}
        });
      }
    } catch (e) {}
  }

  tenantSesionesCache = Array.from(mapa.values()).sort((a, b) =>
    String(b.fecha_entrada || b.created_at || '').localeCompare(String(a.fecha_entrada || a.created_at || ''))
  );
  return tenantSesionesCache;
}

function pintarKpisUsuariosTenant() {
  const activos = tenantUsuariosCache.filter(u => u.activo !== false).length;
  const cupo = obtenerCupoUsuariosTenant(tenantActual);
  const hoyIso = new Date().toISOString().slice(0, 10);
  const entradasHoy = tenantSesionesCache.filter(s =>
    s.evento === 'ENTRADA' && String(s.fecha_entrada || s.created_at || '').slice(0, 10) === hoyIso
  ).length;
  const abiertas = tenantSesionesCache.filter(s => s.evento === 'ENTRADA' && !s.fecha_salida).length;

  const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  setTxt('usrKpiActivosCupo', `${activos} / ${cupo}`);
  setTxt('usrKpiTotalEquipo', String(tenantUsuariosCache.length));
  setTxt('usrKpiEntradasHoy', String(entradasHoy));
  setTxt('usrKpiSesionesAbiertas', String(abiertas));
}

function limpiarFormUsuarioTenant() {
  const setVal = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
  setVal('editUsuarioId', '');
  setVal('usrNombreCompleto', '');
  setVal('usrEmail', '');
  setVal('usrPassword', '');
  setVal('usrRolInterno', 'CAJERO_POS');
  setVal('usrSucursalId', '');
  setVal('usrActivo', 'true');
  const tit = document.getElementById('tituloFormUsuario');
  if (tit) tit.textContent = 'Registrar Nuevo Usuario del Comercio';
  document.getElementById('btnCancelarUsuario')?.classList.add('hidden');
  aplicarPresetRolUsuarioForm();
}

function editarUsuarioTenant(usuarioId) {
  const u = tenantUsuariosCache.find(x => String(x.id) === String(usuarioId));
  if (!u) return;

  const setVal = (id, v) => { const e = document.getElementById(id); if (e) e.value = v ?? ''; };
  setVal('editUsuarioId', u.id);
  setVal('usrNombreCompleto', u.nombre_completo);
  setVal('usrEmail', u.email);
  setVal('usrPassword', '');
  setVal('usrRolInterno', u.rol_interno || 'CAJERO_POS');
  setVal('usrSucursalId', u.sucursal_id || '');
  setVal('usrActivo', u.activo === false ? 'false' : 'true');

  pintarChecklistModulosUsuario(obtenerModulosAutorizadosEmpresa(tenantActual), Array.isArray(u.modulos_permitidos) ? u.modulos_permitidos : []);
  const tit = document.getElementById('tituloFormUsuario');
  if (tit) tit.textContent = `Editar Usuario: ${u.nombre_completo}`;
  document.getElementById('btnCancelarUsuario')?.classList.remove('hidden');
  document.getElementById('usrNombreCompleto')?.focus();
}

async function guardarUsuarioTenant(event) {
  if (event) event.preventDefault();
  if (!tenantActual?.id) return;
  const tenantId = tenantActual.id;

  const actor = typeof obtenerActorActual === 'function' ? obtenerActorActual() : { esPropietario: true, rolInterno: 'PROPIETARIO', usuarioEmail: tenantActual.email };
  if (!actor.esPropietario && actor.rolInterno !== 'ADMIN_EMPRESA' && !(typeof esUsuarioMaster === 'function' && esUsuarioMaster())) {
    avisarUsuarios('Solo el propietario o Administrador de la Empresa puede crear o modificar usuarios.', 'error');
    return;
  }

  const editId = (document.getElementById('editUsuarioId')?.value || '').trim();
  const nombre_completo = (document.getElementById('usrNombreCompleto')?.value || '').trim();
  const email = (document.getElementById('usrEmail')?.value || '').trim().toLowerCase();
  const password = (document.getElementById('usrPassword')?.value || '').trim();
  const rol_interno = document.getElementById('usrRolInterno')?.value || 'CAJERO_POS';
  const sucursal_id = document.getElementById('usrSucursalId')?.value || null;
  const activo = document.getElementById('usrActivo')?.value !== 'false';
  const modulos_permitidos = Array.from(document.querySelectorAll('.chk-usr-modulo:checked')).map(c => c.value);

  if (!nombre_completo || !email) {
    avisarUsuarios('Nombre completo y correo electrónico son obligatorios.', 'warning');
    return;
  }
  if (!editId && password.length < 6) {
    avisarUsuarios('La contraseña inicial del usuario debe tener al menos 6 caracteres.', 'warning');
    return;
  }
  if (editId && password && password.length < 6) {
    avisarUsuarios('Si deseas cambiar la contraseña, debe tener al menos 6 caracteres.', 'warning');
    return;
  }
  if (modulos_permitidos.length === 0) {
    avisarUsuarios('Selecciona al menos un módulo permitido para este usuario.', 'warning');
    return;
  }

  // Validar cupo del plan al crear o reactivar
  const cupoMax = obtenerCupoUsuariosTenant(tenantActual);
  const activosActuales = tenantUsuariosCache.filter(u => u.activo !== false && String(u.id) !== String(editId)).length;
  if (activo && activosActuales >= cupoMax) {
    avisarUsuarios(`Has alcanzado el límite de ${cupoMax} usuario(s) de tu plan ${tenantActual.plan_activo || 'Freemium'}. Mejora tu plan para ampliar el equipo.`, 'warning', 7500);
    return;
  }

  const res = await persistirUsuarioEnNube({
    tenantId,
    editId,
    nombre_completo,
    email,
    password,
    rol_interno,
    sucursal_id,
    modulos_permitidos,
    activo,
    creado_por: actor.usuarioEmail || tenantActual.email
  });

  if (!res.ok) {
    avisarUsuarios(res.error || 'No se pudo guardar el usuario.', 'error', 7500);
    return;
  }

  avisarUsuarios(
    editId ? `Usuario "${nombre_completo}" actualizado.` : `Usuario "${nombre_completo}" creado con acceso inmediato.`,
    'success'
  );
  limpiarFormUsuarioTenant();
  await cargarListaUsuariosTenant(tenantId);
  pintarKpisUsuariosTenant();
  renderizarTablaUsuariosTenant();
  poblarFiltroUsuariosAuditoria();
}

async function persistirUsuarioEnNube({
  tenantId, editId = '', nombre_completo, email, password = '',
  rol_interno = 'CAJERO_POS', sucursal_id = null, modulos_permitidos = [],
  activo = true, creado_por = ''
}) {
  const nowIso = new Date().toISOString();
  const payloadBase = {
    tenant_id: tenantId,
    nombre_completo,
    email: email.toLowerCase(),
    rol_interno,
    sucursal_id: sucursal_id || null,
    modulos_permitidos,
    activo,
    updated_at: nowIso
  };
  if (!editId) payloadBase.creado_por = creado_por;

  let userIdFinal = editId || null;
  let nativoOk = false;

  if (supabaseClient) {
    try {
      if (editId) {
        const { data, error } = await supabaseClient
          .from('tenant_usuarios')
          .update(payloadBase)
          .eq('id', editId)
          .select('id, tenant_id, nombre_completo, email, rol_interno, sucursal_id, modulos_permitidos, activo, ultimo_acceso, ultimo_evento, creado_por, created_at')
          .single();
        if (!error && data) {
          userIdFinal = data.id;
          nativoOk = true;
        }
      } else {
        const { data, error } = await supabaseClient
          .from('tenant_usuarios')
          .insert([payloadBase])
          .select('id, tenant_id, nombre_completo, email, rol_interno, sucursal_id, modulos_permitidos, activo, ultimo_acceso, ultimo_evento, creado_por, created_at')
          .single();
        if (!error && data) {
          userIdFinal = data.id;
          nativoOk = true;
        } else if (error && /duplicate key|unique/i.test(error.message || '')) {
          return { ok: false, error: 'Ya existe otro usuario registrado con ese correo electrónico.' };
        }
      }

      if (nativoOk && password && userIdFinal) {
        await supabaseClient.rpc('registrar_credencial_erp', {
          p_tipo: 'USUARIO',
          p_entidad_id: userIdFinal,
          p_email: email.toLowerCase(),
          p_password: password,
          p_auth_user_id: null
        });
      }
    } catch (e) {}
  }

  if (!userIdFinal) {
    userIdFinal = editId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `usr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  }

  // Respaldo seguro para operación pre-SQL (hash SHA-256 salted en WebCrypto, nunca clave en texto plano)
  let hashPreSql = null;
  if (password && typeof generarHashSha256Salted === 'function') {
    hashPreSql = await generarHashSha256Salted(password);
  }

  const localList = JSON.parse(localStorage.getItem(`mfd_usuarios_${tenantId}`) || '[]');
  const idx = localList.findIndex(u => String(u.id) === String(userIdFinal));
  const recordSinHash = {
    id: userIdFinal,
    ...payloadBase,
    created_at: idx >= 0 ? localList[idx].created_at : nowIso
  };
  if (idx >= 0) localList[idx] = { ...localList[idx], ...recordSinHash };
  else localList.unshift(recordSinHash);
  localStorage.setItem(`mfd_usuarios_${tenantId}`, JSON.stringify(localList));

  if (hashPreSql) {
    try {
      const credLocal = JSON.parse(localStorage.getItem('mfd_credenciales_fallback') || '{}');
      credLocal[email.toLowerCase()] = { id: userIdFinal, tenant_id: tenantId, hash: hashPreSql };
      localStorage.setItem('mfd_credenciales_fallback', JSON.stringify(credLocal));
    } catch (e) {}
  }

  if (!nativoOk && supabaseClient) {
    try {
      await supabaseClient.from('audit_logs').insert([{
        tenant_id: tenantId,
        accion: 'TENANT_USUARIO_SYNC',
        detalle: JSON.stringify({ ...recordSinHash, ...(hashPreSql ? { sha256_hash: hashPreSql } : {}) })
      }]);
    } catch (e) {}
  }

  return { ok: true, id: userIdFinal, nativoOk };
}

async function toggleEstadoUsuarioTenant(usuarioId, estaActivo) {
  if (!tenantActual?.id) return;
  const u = tenantUsuariosCache.find(x => String(x.id) === String(usuarioId));
  if (!u) return;
  const nuevoEstado = !estaActivo;
  await persistirUsuarioEnNube({
    tenantId: tenantActual.id,
    editId: u.id,
    nombre_completo: u.nombre_completo,
    email: u.email,
    rol_interno: u.rol_interno,
    sucursal_id: u.sucursal_id,
    modulos_permitidos: u.modulos_permitidos || [],
    activo: nuevoEstado
  });
  avisarUsuarios(`Usuario ${u.nombre_completo} ${nuevoEstado ? 'reactivado' : 'suspendido'}.`, 'success');
  await cargarListaUsuariosTenant(tenantActual.id);
  pintarKpisUsuariosTenant();
  renderizarTablaUsuariosTenant();
}

async function eliminarUsuarioTenant(usuarioId) {
  if (!tenantActual?.id) return;
  const u = tenantUsuariosCache.find(x => String(x.id) === String(usuarioId));
  if (!u) return;
  const ok = typeof pedirConfirmacion === 'function'
    ? await pedirConfirmacion('Eliminar Usuario', `¿Seguro que deseas eliminar el acceso de "${u.nombre_completo}" (${u.email})? Su historial de entradas/salidas se conservará para auditoría.`)
    : true;
  if (!ok) return;

  if (supabaseClient) {
    try {
      await supabaseClient.from('tenant_usuarios').delete().eq('id', u.id).eq('tenant_id', tenantActual.id);
      await supabaseClient.from('audit_logs').insert([{
        tenant_id: tenantActual.id,
        accion: 'TENANT_USUARIO_SYNC',
        detalle: JSON.stringify({ id: u.id, eliminado: true })
      }]);
    } catch (e) {}
  }

  const localList = JSON.parse(localStorage.getItem(`mfd_usuarios_${tenantActual.id}`) || '[]')
    .filter(x => String(x.id) !== String(u.id));
  localStorage.setItem(`mfd_usuarios_${tenantActual.id}`, JSON.stringify(localList));

  avisarUsuarios(`Usuario "${u.nombre_completo}" eliminado.`, 'success');
  await cargarListaUsuariosTenant(tenantActual.id);
  pintarKpisUsuariosTenant();
  renderizarTablaUsuariosTenant();
}

function renderizarTablaUsuariosTenant() {
  const tbody = document.getElementById('tablaUsuariosComercio');
  if (!tbody) return;

  if (tenantUsuariosCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-5 text-center text-slate-500">Aún no has creado sub-usuarios para tu comercio. El propietario actual tiene acceso completo.</td></tr>`;
    return;
  }

  tbody.innerHTML = tenantUsuariosCache.map(u => {
    const rolCfg = ROLES_INTERNOS_DEF[u.rol_interno] || { nombre: u.rol_interno, badge: 'bg-slate-800 text-slate-300 border-slate-700' };
    const suc = tenantSucursalesUsuariosCache.find(s => String(s.id) === String(u.sucursal_id));
    const modsCount = Array.isArray(u.modulos_permitidos) ? u.modulos_permitidos.length : 0;
    const activo = u.activo !== false;
    return `
      <tr class="hover:bg-slate-900/80 border-b border-slate-800/50">
        <td class="p-3">
          <p class="font-semibold text-white">${esc(u.nombre_completo)}</p>
          <p class="text-[11px] font-mono text-slate-400">${esc(u.email)}</p>
        </td>
        <td class="p-3"><span class="px-2 py-0.5 rounded-lg border text-[11px] font-semibold ${rolCfg.badge}">${esc(rolCfg.nombre)}</span></td>
        <td class="p-3 text-xs text-slate-300">${esc(suc ? suc.nombre : 'Todas')}</td>
        <td class="p-3 font-mono text-xs text-slate-300 text-center">${modsCount} mód.</td>
        <td class="p-3 font-mono text-[11px] text-slate-400">${u.ultimo_acceso ? `${formatearFechaHoraAud(u.ultimo_acceso)} (${esc(u.ultimo_evento || 'ENTRADA')})` : 'Sin ingresos'}</td>
        <td class="p-3 text-xs font-semibold ${activo ? 'text-emerald-400' : 'text-rose-400'}">${activo ? 'Activo' : 'Suspendido'}</td>
        <td class="p-3 text-center whitespace-nowrap space-x-1.5">
          <button type="button" onclick='editarUsuarioTenant("${esc(u.id)}")' class="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer">Editar</button>
          <button type="button" onclick='toggleEstadoUsuarioTenant("${esc(u.id)}", ${activo ? 'true' : 'false'})' class="bg-slate-800 hover:bg-slate-700 ${activo ? 'text-amber-300' : 'text-emerald-400'} border border-slate-700 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer">${activo ? 'Suspender' : 'Activar'}</button>
          <button type="button" onclick='eliminarUsuarioTenant("${esc(u.id)}")' class="bg-rose-950 hover:bg-rose-900 text-rose-200 border border-rose-700/40 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer">Eliminar</button>
        </td>
      </tr>
    `;
  }).join('');
}

function poblarFiltroUsuariosAuditoria() {
  const sel = document.getElementById('usrAudFiltroUsuario');
  if (!sel) return;
  const prev = sel.value;
  const emails = new Set();
  if (tenantActual?.email) emails.add(tenantActual.email.toLowerCase());
  tenantUsuariosCache.forEach(u => { if (u.email) emails.add(u.email.toLowerCase()); });
  tenantSesionesCache.forEach(s => { if (s.usuario_email) emails.add(String(s.usuario_email).toLowerCase()); });

  sel.innerHTML = '<option value="">Todos los usuarios</option>';
  Array.from(emails).sort().forEach(em => {
    sel.innerHTML += `<option value="${esc(em)}">${esc(em)}</option>`;
  });
  if (prev) sel.value = prev;
}

function obtenerSesionesTenantFiltradas() {
  const fUser = (document.getElementById('usrAudFiltroUsuario')?.value || '').trim().toLowerCase();
  const fEv = (document.getElementById('usrAudFiltroEvento')?.value || 'TODOS').toUpperCase();
  const fDesde = document.getElementById('usrAudFiltroDesde')?.value || '';
  const fHasta = document.getElementById('usrAudFiltroHasta')?.value || '';

  return tenantSesionesCache.filter(s => {
    const email = String(s.usuario_email || '').toLowerCase();
    const fechaIso = String(s.fecha_entrada || s.created_at || '').slice(0, 10);
    if (fUser && email !== fUser) return false;
    if (fEv !== 'TODOS' && String(s.evento || '').toUpperCase() !== fEv) return false;
    if (fDesde && fechaIso && fechaIso < fDesde) return false;
    if (fHasta && fechaIso && fechaIso > fHasta) return false;
    return true;
  });
}

function badgeEventoHtml(evento) {
  const ev = String(evento || 'ENTRADA').toUpperCase();
  const map = {
    ENTRADA: 'bg-emerald-950 text-emerald-300 border-emerald-700/50',
    SALIDA: 'bg-sky-950 text-sky-300 border-sky-700/50',
    CIERRE_INACTIVIDAD: 'bg-amber-950 text-amber-300 border-amber-700/50',
    CIERRE_FORZADO: 'bg-rose-950 text-rose-300 border-rose-700/50',
    INTENTO_FALLIDO: 'bg-rose-950 text-rose-400 border-rose-600/60'
  };
  return `<span class="px-2 py-0.5 rounded-lg border text-[10px] font-mono font-bold ${map[ev] || 'bg-slate-800 text-slate-300 border-slate-700'}">${esc(ev)}</span>`;
}

function renderizarTablaBitacoraTenant() {
  const tbody = document.getElementById('tablaBitacoraSesionesComercio');
  if (!tbody) return;
  const lista = obtenerSesionesTenantFiltradas();

  if (lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-5 text-center text-slate-500">Sin registros de entradas o salidas para el filtro seleccionado.</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map(s => `
    <tr class="hover:bg-slate-900/80 border-b border-slate-800/50">
      <td class="p-3 font-mono text-[11px] text-white">${esc(formatearFechaHoraAud(s.fecha_entrada || s.created_at))}</td>
      <td class="p-3 font-mono text-[11px] text-slate-300">${s.fecha_salida ? esc(formatearFechaHoraAud(s.fecha_salida)) : '<span class="text-emerald-400">En línea / Sin cierre</span>'}</td>
      <td class="p-3 font-mono text-xs text-slate-300">${esc(formatearDuracionSeg(s.duracion_segundos))}</td>
      <td class="p-3">
        <p class="text-xs font-semibold text-white">${esc(s.usuario_nombre || 'Usuario')}</p>
        <p class="text-[11px] font-mono text-slate-400">${esc(s.usuario_email || '')} · ${esc(s.rol_interno || '')}</p>
      </td>
      <td class="p-3">${badgeEventoHtml(s.evento)}</td>
      <td class="p-3 text-[11px] text-slate-400 max-w-[180px] truncate" title="${esc(s.user_agent || s.detalle || '')}">${esc(s.detalle || s.user_agent || 'Web')}</td>
    </tr>
  `).join('');
}

function exportarBitacoraSesionesExcel(listaCustom = null, nombreArchivo = 'Bitacora_Entradas_Salidas') {
  const lista = listaCustom || obtenerSesionesTenantFiltradas();
  if (!lista.length) { avisarUsuarios('No hay registros para exportar.', 'warning'); return; }
  if (typeof XLSX === 'undefined') { avisarUsuarios('Librería Excel no disponible.', 'error'); return; }

  const rows = lista.map(s => ({
    Empresa: s.tenant_nombre || tenantActual?.razon_social || '',
    'Fecha Entrada': formatearFechaHoraAud(s.fecha_entrada || s.created_at),
    'Fecha Salida': s.fecha_salida ? formatearFechaHoraAud(s.fecha_salida) : 'Abierta',
    Duración: formatearDuracionSeg(s.duracion_segundos),
    Usuario: s.usuario_nombre || '',
    Correo: s.usuario_email || '',
    Rol: s.rol_interno || '',
    Evento: s.evento || '',
    Detalle: s.detalle || s.user_agent || ''
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'EntradasSalidas');
  XLSX.writeFile(wb, `${nombreArchivo}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  avisarUsuarios('Bitácora de entradas y salidas exportada a Excel.', 'success');
}

function imprimirBitacoraSesionesPdf(listaCustom = null, titulo = 'BITÁCORA DE ENTRADAS Y SALIDAS DE USUARIOS') {
  const lista = listaCustom || obtenerSesionesTenantFiltradas();
  if (!lista.length) { avisarUsuarios('No hay registros para imprimir.', 'warning'); return; }
  if (!window.jspdf?.jsPDF) { avisarUsuarios('Librería PDF no disponible.', 'error'); return; }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'landscape' });
  const margin = 12;
  let y = 15;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text(`${(tenantActual?.razon_social || 'MIFACTURADIGITAL').toUpperCase()} — ${titulo}`, margin, y);
  y += 5;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.text(`Generado: ${formatearFechaHoraAud(new Date().toISOString())} · Registros: ${lista.length}`, margin, y);
  y += 6;

  const drawHead = (yy) => {
    pdf.setFillColor(15, 23, 42);
    pdf.rect(margin, yy, 255, 6.5, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.text('Entrada', margin + 2, yy + 4.3);
    pdf.text('Salida', margin + 40, yy + 4.3);
    pdf.text('Duración', margin + 78, yy + 4.3);
    pdf.text('Empresa / Usuario', margin + 100, yy + 4.3);
    pdf.text('Rol', margin + 185, yy + 4.3);
    pdf.text('Evento', margin + 220, yy + 4.3);
    return yy + 6.5;
  };

  y = drawHead(y);
  pdf.setTextColor(15, 23, 42);

  lista.slice(0, 200).forEach(s => {
    if (y > 195) {
      pdf.addPage();
      y = 14;
      y = drawHead(y);
      pdf.setTextColor(15, 23, 42);
    }
    pdf.setDrawColor(226, 232, 240);
    pdf.line(margin, y + 6, margin + 255, y + 6);
    pdf.setFont('courier', 'normal');
    pdf.setFontSize(7);
    pdf.text(formatearFechaHoraAud(s.fecha_entrada || s.created_at), margin + 2, y + 4);
    pdf.text(s.fecha_salida ? formatearFechaHoraAud(s.fecha_salida) : 'Activa', margin + 40, y + 4);
    pdf.text(formatearDuracionSeg(s.duracion_segundos), margin + 78, y + 4);
    pdf.setFont('helvetica', 'normal');
    const lblUsr = `${s.tenant_nombre ? s.tenant_nombre + ' | ' : ''}${s.usuario_nombre || ''} (${s.usuario_email || ''})`;
    pdf.text(lblUsr.slice(0, 48), margin + 100, y + 4);
    pdf.text(String(s.rol_interno || '').slice(0, 18), margin + 185, y + 4);
    pdf.setFont('courier', 'bold');
    pdf.text(String(s.evento || '').slice(0, 18), margin + 220, y + 4);
    y += 6;
  });

  if (typeof abrirVisorImpresionPdf === 'function') {
    abrirVisorImpresionPdf(pdf, `Bitacora_Accesos_${new Date().toISOString().slice(0, 10)}.pdf`, titulo);
  } else {
    pdf.save(`Bitacora_Accesos_${new Date().toISOString().slice(0, 10)}.pdf`);
  }
}

// ==========================================
// 2. PANEL MASTER GLOBAL: TODOS LOS USUARIOS Y ENTRADAS/SALIDAS
// ==========================================

async function cargarUsuariosYSesionesMaster() {
  if (typeof esUsuarioMaster === 'function' && !esUsuarioMaster()) {
    avisarUsuarios('Acceso restringido al administrador Master.', 'error');
    return;
  }

  const tenantsMap = {};
  (typeof saasTenantsCache !== 'undefined' ? saasTenantsCache : []).forEach(t => {
    tenantsMap[String(t.id)] = t;
  });

  // Poblar selects de filtro y creación rápida Master
  const selFilter = document.getElementById('masterUsrFiltroTenant');
  const selCreate = document.getElementById('masterNewUsrTenantId');
  const tenantsOrdenados = Object.values(tenantsMap).sort((a, b) =>
    String(a.razon_social || '').localeCompare(String(b.razon_social || ''))
  );

  if (selFilter) {
    const prev = selFilter.value;
    selFilter.innerHTML = '<option value="">Todas las Empresas</option>';
    tenantsOrdenados.forEach(t => {
      selFilter.innerHTML += `<option value="${esc(t.id)}">${esc(t.razon_social)} (${esc(t.rif || '')})</option>`;
    });
    if (prev) selFilter.value = prev;
  }
  if (selCreate) {
    const prevC = selCreate.value;
    selCreate.innerHTML = '<option value="">-- Seleccionar Empresa --</option>';
    tenantsOrdenados.forEach(t => {
      selCreate.innerHTML += `<option value="${esc(t.id)}">${esc(t.razon_social)} (${esc(t.plan_activo || 'Freemium')})</option>`;
    });
    if (prevC) selCreate.value = prevC;
  }

  const uMapa = new Map();
  const sMapa = new Map();

  if (supabaseClient) {
    try {
      const [{ data: uData }, { data: sData }] = await Promise.all([
        supabaseClient
          .from('tenant_usuarios')
          .select('id, tenant_id, auth_user_id, nombre_completo, email, rol_interno, sucursal_id, modulos_permitidos, activo, ultimo_acceso, ultimo_evento, created_at')
          .order('created_at', { ascending: false })
          .limit(500),
        supabaseClient
          .from('sesiones_auditoria')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(600)
      ]);
      (uData || []).forEach(u => uMapa.set(String(u.id), u));
      (sData || []).forEach(s => sMapa.set(String(s.id), s));
    } catch (e) {}

    try {
      const [{ data: uLogs }, { data: sLogs }] = await Promise.all([
        supabaseClient.from('audit_logs').select('tenant_id, detalle, created_at').eq('accion', 'TENANT_USUARIO_SYNC').order('created_at', { ascending: true }).limit(400),
        supabaseClient.from('audit_logs').select('id, tenant_id, detalle, created_at').in('accion', ['SESION_ENTRADA', 'SESION_SALIDA', 'SESION_INTENTO_FALLIDO']).order('created_at', { ascending: false }).limit(400)
      ]);
      (uLogs || []).forEach(l => {
        try {
          const p = JSON.parse(l.detalle || '{}');
          if (p.eliminado && p.id) uMapa.delete(String(p.id));
          else if (p.id && !uMapa.has(String(p.id))) {
            const { password_hash, password, ...safe } = p;
            uMapa.set(String(p.id), safe);
          }
        } catch (e) {}
      });
      (sLogs || []).forEach(l => {
        try {
          const p = JSON.parse(l.detalle || '{}');
          const id = String(p.id || l.id);
          if (!sMapa.has(id)) sMapa.set(id, { id, tenant_id: l.tenant_id, created_at: l.created_at, ...p });
          else if (p.fecha_salida && !sMapa.get(id).fecha_salida) sMapa.set(id, { ...sMapa.get(id), ...p });
        } catch (e) {}
      });
    } catch (e) {}
  }

  masterUsuariosCache = Array.from(uMapa.values()).map(u => ({
    ...u,
    tenant_nombre: tenantsMap[String(u.tenant_id)]?.razon_social || 'Comercio'
  }));
  masterSesionesCache = Array.from(sMapa.values()).map(s => ({
    ...s,
    tenant_nombre: tenantsMap[String(s.tenant_id)]?.razon_social || s.tenant_nombre || 'Comercio'
  })).sort((a, b) =>
    String(b.fecha_entrada || b.created_at || '').localeCompare(String(a.fecha_entrada || a.created_at || ''))
  );

  const hoyIso = new Date().toISOString().slice(0, 10);
  const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = String(v); };
  setTxt('masterUsrKpiTotal', masterUsuariosCache.length);
  setTxt('masterUsrKpiActivos', masterUsuariosCache.filter(u => u.activo !== false).length);
  setTxt('masterUsrKpiEntradasHoy', masterSesionesCache.filter(s => s.evento === 'ENTRADA' && String(s.fecha_entrada || s.created_at || '').slice(0, 10) === hoyIso).length);
  setTxt('masterUsrKpiFallidos', masterSesionesCache.filter(s => s.evento === 'INTENTO_FALLIDO').length);

  renderizarTablaUsuariosMaster();
  renderizarTablaBitacoraMaster();
}

function obtenerSesionesMasterFiltradas() {
  const fTen = document.getElementById('masterUsrFiltroTenant')?.value || '';
  const fTxt = (document.getElementById('masterUsrFiltroTexto')?.value || '').trim().toLowerCase();
  const fEv = (document.getElementById('masterAudFiltroEvento')?.value || 'TODOS').toUpperCase();
  const fDesde = document.getElementById('masterAudFiltroDesde')?.value || '';
  const fHasta = document.getElementById('masterAudFiltroHasta')?.value || '';

  return masterSesionesCache.filter(s => {
    const fechaIso = String(s.fecha_entrada || s.created_at || '').slice(0, 10);
    if (fTen && String(s.tenant_id) !== String(fTen)) return false;
    if (fEv !== 'TODOS' && String(s.evento || '').toUpperCase() !== fEv) return false;
    if (fDesde && fechaIso && fechaIso < fDesde) return false;
    if (fHasta && fechaIso && fechaIso > fHasta) return false;
    if (fTxt) {
      const hay = `${s.usuario_nombre || ''} ${s.usuario_email || ''} ${s.tenant_nombre || ''}`.toLowerCase();
      if (!hay.includes(fTxt)) return false;
    }
    return true;
  });
}

function renderizarTablaUsuariosMaster() {
  const tbody = document.getElementById('tablaMasterUsuariosGlobal');
  if (!tbody) return;
  const fTen = document.getElementById('masterUsrFiltroTenant')?.value || '';
  const fTxt = (document.getElementById('masterUsrFiltroTexto')?.value || '').trim().toLowerCase();

  const lista = masterUsuariosCache.filter(u => {
    if (fTen && String(u.tenant_id) !== String(fTen)) return false;
    if (fTxt) {
      const hay = `${u.nombre_completo || ''} ${u.email || ''} ${u.tenant_nombre || ''}`.toLowerCase();
      if (!hay.includes(fTxt)) return false;
    }
    return true;
  });

  if (lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-5 text-center text-slate-500">No hay sub-usuarios registrados para el filtro seleccionado.</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map(u => {
    const activo = u.activo !== false;
    const rolCfg = ROLES_INTERNOS_DEF[u.rol_interno] || { nombre: u.rol_interno };
    return `
      <tr class="hover:bg-slate-900/80 border-b border-slate-800/50">
        <td class="p-3 text-xs font-semibold text-emerald-300">${esc(u.tenant_nombre)}</td>
        <td class="p-3">
          <p class="font-semibold text-white">${esc(u.nombre_completo)}</p>
          <p class="text-[11px] font-mono text-slate-400">${esc(u.email)}</p>
        </td>
        <td class="p-3 text-xs text-slate-300">${esc(rolCfg.nombre)}</td>
        <td class="p-3 font-mono text-[11px] text-slate-400">${u.ultimo_acceso ? formatearFechaHoraAud(u.ultimo_acceso) : 'Sin ingresos'}</td>
        <td class="p-3 text-xs font-semibold ${activo ? 'text-emerald-400' : 'text-rose-400'}">${activo ? 'Activo' : 'Suspendido'}</td>
        <td class="p-3 text-center whitespace-nowrap space-x-1.5">
          <button type="button" onclick='toggleUsuarioMaster("${esc(u.id)}", ${activo ? 'true' : 'false'})' class="bg-slate-800 hover:bg-slate-700 ${activo ? 'text-amber-300' : 'text-emerald-400'} border border-slate-700 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer">${activo ? 'Suspender' : 'Activar'}</button>
          <button type="button" onclick='forzarCierreSesionMaster("${esc(u.tenant_id)}", "${esc(u.email)}", "${esc(u.nombre_completo)}")' class="bg-slate-800 hover:bg-slate-700 text-rose-300 border border-rose-700/40 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer">Forzar Salida</button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderizarTablaBitacoraMaster() {
  const tbody = document.getElementById('tablaMasterBitacoraGlobal');
  if (!tbody) return;
  const lista = obtenerSesionesMasterFiltradas();

  if (lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-5 text-center text-slate-500">Sin movimientos de entrada/salida globales para el filtro aplicado.</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.slice(0, 250).map(s => `
    <tr class="hover:bg-slate-900/80 border-b border-slate-800/50">
      <td class="p-3 font-mono text-[11px] text-white">${esc(formatearFechaHoraAud(s.fecha_entrada || s.created_at))}</td>
      <td class="p-3 font-mono text-[11px] text-slate-300">${s.fecha_salida ? esc(formatearFechaHoraAud(s.fecha_salida)) : '<span class="text-emerald-400">Activa</span>'}</td>
      <td class="p-3 font-mono text-xs text-slate-300">${esc(formatearDuracionSeg(s.duracion_segundos))}</td>
      <td class="p-3 text-xs font-semibold text-emerald-300">${esc(s.tenant_nombre || 'Comercio')}</td>
      <td class="p-3">
        <p class="text-xs font-semibold text-white">${esc(s.usuario_nombre || '')}</p>
        <p class="text-[11px] font-mono text-slate-400">${esc(s.usuario_email || '')} · ${esc(s.rol_interno || '')}</p>
      </td>
      <td class="p-3">${badgeEventoHtml(s.evento)}</td>
    </tr>
  `).join('');
}

async function crearUsuarioDesdeMaster(event) {
  if (event) event.preventDefault();
  if (typeof esUsuarioMaster === 'function' && !esUsuarioMaster()) return;

  const tenantId = document.getElementById('masterNewUsrTenantId')?.value || '';
  const nombre_completo = (document.getElementById('masterNewUsrNombre')?.value || '').trim();
  const email = (document.getElementById('masterNewUsrEmail')?.value || '').trim().toLowerCase();
  const password = (document.getElementById('masterNewUsrPassword')?.value || '').trim();
  const rol_interno = document.getElementById('masterNewUsrRol')?.value || 'CAJERO_POS';

  if (!tenantId || !nombre_completo || !email || password.length < 6) {
    avisarUsuarios('Selecciona empresa, nombre, correo y contraseña (mín. 6 caracteres).', 'warning');
    return;
  }

  const tenantObj = (typeof saasTenantsCache !== 'undefined' ? saasTenantsCache : []).find(t => String(t.id) === String(tenantId));
  const modsEmpresa = new Set(obtenerModulosAutorizadosEmpresa(tenantObj || { plan_activo: 'Enterprise' }));
  const modsRol = (ROLES_INTERNOS_DEF[rol_interno]?.modulos || ['pos', 'historial']).filter(m => modsEmpresa.has(m));

  const res = await persistirUsuarioEnNube({
    tenantId,
    nombre_completo,
    email,
    password,
    rol_interno,
    modulos_permitidos: modsRol,
    activo: true,
    creado_por: tenantActual?.email || 'master'
  });

  if (!res.ok) {
    avisarUsuarios(res.error || 'No se pudo crear el sub-usuario.', 'error');
    return;
  }

  document.getElementById('formMasterCrearUsuario')?.reset();
  avisarUsuarios(`Sub-usuario "${nombre_completo}" asignado al comercio correctamente.`, 'success');
  await cargarUsuariosYSesionesMaster();
}

async function toggleUsuarioMaster(usuarioId, estaActivo) {
  const u = masterUsuariosCache.find(x => String(x.id) === String(usuarioId));
  if (!u) return;
  const nuevo = !estaActivo;
  await persistirUsuarioEnNube({
    tenantId: u.tenant_id,
    editId: u.id,
    nombre_completo: u.nombre_completo,
    email: u.email,
    rol_interno: u.rol_interno,
    sucursal_id: u.sucursal_id,
    modulos_permitidos: u.modulos_permitidos || [],
    activo: nuevo
  });
  avisarUsuarios(`Usuario ${u.nombre_completo} ${nuevo ? 'activado' : 'suspendido'} por Master.`, 'success');
  await cargarUsuariosYSesionesMaster();
}

async function forzarCierreSesionMaster(tenantId, email, nombre) {
  const nowIso = new Date().toISOString();
  const payload = {
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `aud-frc-${Date.now()}`,
    tenant_id: tenantId,
    usuario_nombre: nombre,
    usuario_email: email,
    rol_interno: 'FORZADO',
    evento: 'CIERRE_FORZADO',
    fecha_entrada: nowIso,
    fecha_salida: nowIso,
    duracion_segundos: 0,
    detalle: `Cierre forzado por Master (${tenantActual?.email || 'master'})`
  };
  if (supabaseClient) {
    try {
      await supabaseClient.from('sesiones_auditoria').insert([payload]);
      await supabaseClient.from('audit_logs').insert([{ tenant_id: tenantId, accion: 'SESION_SALIDA', detalle: JSON.stringify(payload) }]);
    } catch (e) {}
  }
  avisarUsuarios(`Cierre forzado registrado para ${nombre}.`, 'info');
  await cargarUsuariosYSesionesMaster();
}

function exportarBitacoraMasterExcel() {
  exportarBitacoraSesionesExcel(obtenerSesionesMasterFiltradas(), 'Bitacora_Global_Entradas_Salidas_Master');
}

function imprimirBitacoraMasterPdf() {
  imprimirBitacoraSesionesPdf(obtenerSesionesMasterFiltradas(), 'BITÁCORA GLOBAL DE ENTRADAS Y SALIDAS (TODAS LAS EMPRESAS)');
}

async function copiarScriptSqlV100() {
  try {
    const res = await fetch('/sql/migracion_seguridad_usuarios_v100.sql');
    const txt = await res.text();
    await navigator.clipboard.writeText(txt);
    avisarUsuarios('Script SQL v100 (Seguridad, Usuarios y Auditoría) copiado al portapapeles.', 'success', 6000);
  } catch (e) {
    avisarUsuarios('No se pudo copiar; usa Descargar .SQL v100.', 'warning');
  }
}

async function descargarScriptSqlV100() {
  try {
    const res = await fetch('/sql/migracion_seguridad_usuarios_v100.sql');
    const txt = await res.text();
    const blob = new Blob([txt], { type: 'text/sql;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'migracion_seguridad_usuarios_v100.sql';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    avisarUsuarios('Descargado migracion_seguridad_usuarios_v100.sql.', 'success');
  } catch (e) {
    avisarUsuarios('Error descargando el script SQL v100.', 'error');
  }
}

async function verificarEstadoEsquemaSeguridadV100() {
  const el = document.getElementById('v100EstadoEsquemaBadge');
  if (!el || !supabaseClient) return;
  try {
    const [r1, r2, r3] = await Promise.all([
      supabaseClient.from('tenant_usuarios').select('id').limit(1),
      supabaseClient.from('sesiones_auditoria').select('id').limit(1),
      supabaseClient.from('compras_documentos').select('id').limit(1)
    ]);
    if (!r1.error && !r2.error && !r3.error) {
      el.className = 'px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-700/50';
      el.textContent = 'BD v100 Segura: ACTIVA';
    } else {
      el.className = 'px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold bg-amber-950 text-amber-300 border border-amber-700/50';
      el.textContent = 'Pendiente ejecutar .SQL v100';
    }
  } catch (e) {}
}
