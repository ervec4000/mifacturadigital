/**
 * /js/suscripciones.js
 * Control Master SaaS, Suscripciones (Mensual/Anual), Permisos Dinámicos de Menú por Tenant
 * y Gestión de Pagos (Transferencia Bancaria, Pago Móvil y Pasarela de Tarjetas).
 */

const PLANES_SAAS_DEFECTO = {
  Freemium: {
    nombre: 'Freemium',
    etiqueta: 'Inicial / Emprendedor',
    precioMensual: 0,
    precioAnual: 0,
    descripcion: 'Facturación POS básica, historial de comprobantes y maestros esenciales.'
  },
  Pyme: {
    nombre: 'Pyme',
    etiqueta: 'Comercio en Crecimiento',
    precioMensual: 19,
    precioAnual: 182,
    descripcion: 'Notas SENIAT NC/ND, Cierres Z, Libros Excel, CxC, Kardex PPM, Físico y Compras.'
  },
  Enterprise: {
    nombre: 'Enterprise',
    etiqueta: 'Operación Fiscal + Contable',
    precioMensual: 49,
    precioAnual: 470,
    descripcion: 'Todos los módulos ERP, Contabilidad VEN-NIF, Retenciones IVA, Transferencias, Lotes y QR.'
  },
  'Administración': {
    nombre: 'Administración',
    etiqueta: 'Administración Completa',
    precioMensual: 49,
    precioAnual: 470,
    descripcion: 'Acceso operativo completo al ERP fiscal, inventarios y contabilidad VEN-NIF.'
  }
};

function clonarCatalogoPlanes(base) {
  const res = {};
  Object.entries(base || {}).forEach(([k, v]) => {
    res[k] = { ...v };
  });
  return res;
}

let PLANES_SAAS_CATALOGO = clonarCatalogoPlanes(PLANES_SAAS_DEFECTO);

const MODULOS_ERP_SAAS = [
  { id: 'pos', grupo: 'POS y Facturación', nombre: 'Facturación POS', btnId: 'btnTabPos', defaultPlans: ['Freemium', 'Pyme', 'Enterprise', 'Administración'] },
  { id: 'historial', grupo: 'Historial y Cierres', nombre: 'Historial Comprobantes', btnId: 'btnTabHistorial', defaultPlans: ['Freemium', 'Pyme', 'Enterprise', 'Administración'] },
  { id: 'notasFiscales', grupo: 'Historial y Cierres', nombre: 'Notas SENIAT (NC/ND)', btnId: 'btnTabNotasFiscales', defaultPlans: ['Pyme', 'Enterprise', 'Administración'] },
  { id: 'cierrez', grupo: 'Historial y Cierres', nombre: 'Cierres Z y Libros', btnId: 'btnTabCierrez', defaultPlans: ['Pyme', 'Enterprise', 'Administración'] },
  { id: 'cuentas', grupo: 'Historial y Cierres', nombre: 'Cuentas por Cobrar', btnId: 'btnTabCuentas', defaultPlans: ['Pyme', 'Enterprise', 'Administración'] },
  { id: 'kardex', grupo: 'Inventario y Kardex', nombre: 'Trazabilidad Kardex', btnId: 'btnTabKardex', defaultPlans: ['Pyme', 'Enterprise', 'Administración'] },
  { id: 'fisico', grupo: 'Inventario y Kardex', nombre: 'Conteo Físico', btnId: 'btnTabFisico', defaultPlans: ['Pyme', 'Enterprise', 'Administración'] },
  { id: 'transferencias', grupo: 'Inventario y Kardex', nombre: 'Transferencias Depósito', btnId: 'btnTabTransferencias', defaultPlans: ['Enterprise', 'Administración'] },
  { id: 'lotes', grupo: 'Inventario y Kardex', nombre: 'Lotes y Vencimientos', btnId: 'btnTabLotes', defaultPlans: ['Enterprise', 'Administración'] },
  { id: 'etiquetas', grupo: 'Inventario y Kardex', nombre: 'Etiquetas QR (Carta)', btnId: 'btnTabEtiquetas', defaultPlans: ['Freemium', 'Pyme', 'Enterprise', 'Administración'] },
  { id: 'compras', grupo: 'Compras y Tributos', nombre: 'Registro de Compras', btnId: 'btnTabCompras', defaultPlans: ['Pyme', 'Enterprise', 'Administración'] },
  { id: 'retenciones', grupo: 'Compras y Tributos', nombre: 'Retenciones IVA', btnId: 'btnTabRetenciones', defaultPlans: ['Enterprise', 'Administración'] },
  { id: 'contabilidad', grupo: 'Compras y Tributos', nombre: 'Contabilidad y ERP', btnId: 'btnTabContabilidad', defaultPlans: ['Enterprise', 'Administración'] },
  { id: 'productos', grupo: 'Catálogos y Maestros', nombre: 'Gestión de Artículos', btnId: 'btnTabProductos', defaultPlans: ['Freemium', 'Pyme', 'Enterprise', 'Administración'] },
  { id: 'clientes', grupo: 'Catálogos y Maestros', nombre: 'Maestro de Clientes', btnId: 'btnTabClientes', defaultPlans: ['Freemium', 'Pyme', 'Enterprise', 'Administración'] },
  { id: 'proveedores', grupo: 'Catálogos y Maestros', nombre: 'Proveedores', btnId: 'btnTabProveedores', defaultPlans: ['Pyme', 'Enterprise', 'Administración'] },
  { id: 'sucursales', grupo: 'Catálogos y Maestros', nombre: 'Sucursales', btnId: 'btnTabSucursales', defaultPlans: ['Pyme', 'Enterprise', 'Administración'] },
  { id: 'almacenes', grupo: 'Catálogos y Maestros', nombre: 'Almacenes', btnId: 'btnTabAlmacenes', defaultPlans: ['Pyme', 'Enterprise', 'Administración'] },
  { id: 'unidades', grupo: 'Catálogos y Maestros', nombre: 'Unidades de Medida', btnId: 'btnTabUnidades', defaultPlans: ['Freemium', 'Pyme', 'Enterprise', 'Administración'] },
  { id: 'tiposIva', grupo: 'Catálogos y Maestros', nombre: 'Tipos de IVA', btnId: 'btnTabTiposIva', defaultPlans: ['Freemium', 'Pyme', 'Enterprise', 'Administración'] },
  { id: 'viasPago', grupo: 'Catálogos y Maestros', nombre: 'Vías de Pago', btnId: 'btnTabViasPago', defaultPlans: ['Freemium', 'Pyme', 'Enterprise', 'Administración'] },
  { id: 'referidos', grupo: 'Catálogos y Maestros', nombre: 'Afiliados', btnId: 'btnTabReferidos', defaultPlans: ['Freemium', 'Pyme', 'Enterprise', 'Administración', 'Promotor'] },
  { id: 'suscripcion', grupo: 'Cuenta y Suscripción', nombre: 'Mi Plan y Pagos', btnId: 'btnTabSuscripcion', defaultPlans: ['Freemium', 'Pyme', 'Enterprise', 'Administración'] }
];

const CONFIG_BANCOS_MASTER_DEFECTO = {
  banco_nombre: 'Banesco / Mercantil',
  banco_cuenta: '0134-0000-00-0000000000',
  banco_titular: 'MIFACTURADIGITAL C.A.',
  banco_rif: 'J-00000000-0',
  pagomovil_banco: '0134 Banesco',
  pagomovil_telefono: '0424-5378331',
  pagomovil_rif: 'V-12080468',
  zelle_correo: 'pagos@mifacturadigital.com.ve',
  binance_id: 'ervec2000@gmail.com'
};

let saasTenantsMetaMap = {};
let saasTenantsCache = [];
let saasPagosCache = [];
let saasConfigBancosCache = { ...CONFIG_BANCOS_MASTER_DEFECTO };
let saasCicloSeleccionadoUI = 'MENSUAL';
let saasPasarelaEstadoCache = null;
let masterMostrarModulosCliente = false;

function marcarBotonSidebarMaster(subtab = 'tenants') {
  const mapa = {
    tenants: 'btnTabMasterTenants',
    pagos: 'btnTabMasterPagos',
    referidosMaster: 'btnTabMasterReferidos',
    infraestructura: 'btnTabMasterSql'
  };
  Object.entries(mapa).forEach(([k, btnId]) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    if (k === subtab) {
      btn.classList.add('bg-emerald-500/10', 'text-emerald-400', 'border-emerald-500/30');
      btn.classList.remove('text-slate-400', 'border-transparent', 'hover:bg-slate-900', 'hover:text-slate-200');
    } else {
      btn.classList.remove('bg-emerald-500/10', 'text-emerald-400', 'border-emerald-500/30');
      btn.classList.add('text-slate-400', 'border-transparent', 'hover:bg-slate-900', 'hover:text-slate-200');
    }
  });
}

function abrirSubModuloMaster(subtab = 'tenants') {
  if (typeof cambiarPestana === 'function') {
    cambiarPestana('inquilinosMaster');
  }
  cambiarSubtabMaster(subtab);
  marcarBotonSidebarMaster(subtab);
}

function toggleVistaErpEnMaster() {
  masterMostrarModulosCliente = !masterMostrarModulosCliente;
  aplicarPermisosMenuTenant();
}

function avisarSaas(msg, tipo = 'info', duracion = 5500) {
  if (typeof notificarSistema === 'function') notificarSistema(msg, tipo, duracion);
  else console.log(`[SAAS:${tipo}]`, msg);
}

function esUsuarioMaster(tenant = tenantActual) {
  if (!tenant) return false;
  const rol = String(tenant.rol || '').trim().toLowerCase();
  const email = String(tenant.email || '').trim().toLowerCase();
  return rol === 'master' || email === 'ervec2000@gmail.com';
}

function normalizarNombrePlan(planRaw) {
  const val = String(planRaw || 'Freemium').trim();
  if (/^freemium$/i.test(val)) return 'Freemium';
  if (/^pyme$/i.test(val)) return 'Pyme';
  if (/^enterprise$/i.test(val)) return 'Enterprise';
  if (/^administraci[oó]n$/i.test(val)) return 'Administración';
  return val || 'Freemium';
}

function obtenerPresetModulosPorPlan(planRaw) {
  const plan = normalizarNombrePlan(planRaw);
  const mods = MODULOS_ERP_SAAS
    .filter(m => m.defaultPlans.includes(plan))
    .map(m => m.id);
  return mods.length > 0 ? mods : MODULOS_ERP_SAAS.map(m => m.id);
}

function obtenerTasaBcvVigenteSaas() {
  const raw = parseFloat(document.getElementById('tasaBcv')?.value || '0');
  return Number.isFinite(raw) && raw > 0 ? raw : 888.1183;
}

function leerMetaSaasLocal() {
  try {
    return JSON.parse(localStorage.getItem('saas_tenants_meta_map') || '{}');
  } catch (e) {
    return {};
  }
}

function guardarMetaSaasLocal(tenantId, meta) {
  if (!tenantId) return;
  try {
    const map = leerMetaSaasLocal();
    map[String(tenantId)] = { ...(map[String(tenantId)] || {}), ...meta };
    localStorage.setItem('saas_tenants_meta_map', JSON.stringify(map));
    saasTenantsMetaMap = map;
  } catch (e) {}
}

function fusionarTenantConMetaSaas(tenant) {
  if (!tenant) return null;
  const id = String(tenant.id || '');
  const localMap = leerMetaSaasLocal();
  const meta = { ...(localMap[id] || {}), ...(saasTenantsMetaMap[id] || {}) };
  const merged = { ...meta, ...tenant };
  if (Array.isArray(tenant.modulos_permitidos)) merged.modulos_permitidos = tenant.modulos_permitidos;
  else if (Array.isArray(meta.modulos_permitidos)) merged.modulos_permitidos = meta.modulos_permitidos;
  ['ciclo_facturacion', 'fecha_vencimiento_plan', 'estado_suscripcion', 'codigo_referido', 'referido_por_id', 'referido_nivel2_id', 'referido_nivel3_id', 'datos_cobro_comision'].forEach(k => {
    if (tenant[k] !== undefined && tenant[k] !== null && tenant[k] !== '') merged[k] = tenant[k];
    else if (meta[k] !== undefined && meta[k] !== null && meta[k] !== '') merged[k] = meta[k];
  });
  if (tenant.es_promotor_externo === true || meta.es_promotor_externo === true || String(tenant.rol || '').toLowerCase() === 'promotor') {
    merged.es_promotor_externo = true;
  }
  return merged;
}

async function sincronizarMetaSaasNube(tenantIdUnico = null) {
  const map = leerMetaSaasLocal();
  if (!supabaseClient) {
    saasTenantsMetaMap = map;
    return map;
  }
  try {
    let q = supabaseClient
      .from('audit_logs')
      .select('tenant_id, detalle, created_at')
      .eq('accion', 'SAAS_TENANT_META')
      .order('created_at', { ascending: true })
      .limit(400);
    if (tenantIdUnico) q = q.eq('tenant_id', tenantIdUnico);
    const { data, error } = await q;
    if (!error && Array.isArray(data)) {
      data.forEach(row => {
        try {
          const parsed = JSON.parse(row.detalle || '{}');
          const tid = String(parsed.tenant_id || row.tenant_id || '');
          if (tid) {
            map[tid] = { ...(map[tid] || {}), ...parsed };
          }
        } catch (e) {}
      });
      localStorage.setItem('saas_tenants_meta_map', JSON.stringify(map));
    }
  } catch (e) {}
  saasTenantsMetaMap = map;
  return map;
}

async function sincronizarMetaSaasTenantActual() {
  if (!tenantActual?.id || !supabaseClient) return tenantActual;
  try {
    const [{ data: freshTenant }] = await Promise.all([
      supabaseClient.from('tenants').select('*').eq('id', tenantActual.id).single(),
      sincronizarMetaSaasNube(tenantActual.id)
    ]);
    if (freshTenant) {
      tenantActual = fusionarTenantConMetaSaas(freshTenant);
      localStorage.setItem('tenant_actual', JSON.stringify(tenantActual));
    } else {
      tenantActual = fusionarTenantConMetaSaas(tenantActual);
    }
  } catch (e) {}
  return tenantActual;
}

function obtenerPermisosEfectivosTenant(tenant = tenantActual) {
  if (!tenant) return ['pos', 'suscripcion'];
  if (esUsuarioMaster(tenant)) {
    return MODULOS_ERP_SAAS.map(m => m.id);
  }
  const enriched = fusionarTenantConMetaSaas(tenant);
  if (String(enriched.rol || '').toLowerCase() === 'promotor' || enriched.es_promotor_externo === true) {
    return ['referidos'];
  }
  if (enriched.activo === false) {
    return ['suscripcion'];
  }
  if (Array.isArray(enriched.modulos_permitidos) && enriched.modulos_permitidos.length > 0) {
    const set = new Set(enriched.modulos_permitidos);
    set.add('suscripcion');
    if (enriched.permisos_manuales !== true && set.has('productos')) {
      set.add('etiquetas');
    }
    return Array.from(set);
  }
  return obtenerPresetModulosPorPlan(enriched.plan_activo || 'Freemium');
}

function puedeAccederModuloErp(moduloId, tenant = tenantActual) {
  if (!tenant) return false;
  if (esUsuarioMaster(tenant)) return true;
  if (moduloId === 'inquilinosMaster') return false;
  const permitidos = obtenerPermisosEfectivosTenant(tenant);
  return permitidos.includes(moduloId);
}

function aplicarPermisosMenuTenant() {
  if (!tenantActual) return;
  const esMaster = esUsuarioMaster(tenantActual);
  const permitidos = new Set(obtenerPermisosEfectivosTenant(tenantActual));
  const estaActivo = tenantActual.activo !== false;

  document.querySelectorAll('.tab-master').forEach(el => {
    if (esMaster) el.classList.remove('hidden');
    else el.classList.add('hidden');
  });

  if (esMaster) {
    MODULOS_ERP_SAAS.forEach(mod => {
      const btn = document.getElementById(mod.btnId);
      if (!btn) return;
      if (mod.id === 'suscripcion') {
        btn.classList.add('hidden');
      } else if (masterMostrarModulosCliente) {
        btn.classList.remove('hidden');
      } else {
        btn.classList.add('hidden');
      }
    });

    document.querySelectorAll('.cliente-erp-group').forEach(grp => {
      const visibles = grp.querySelectorAll('button:not(.hidden)');
      if (masterMostrarModulosCliente && visibles.length > 0) grp.classList.remove('hidden');
      else grp.classList.add('hidden');
    });

    const lblToggle = document.getElementById('btnToggleModulosErpMasterLabel');
    if (lblToggle) {
      lblToggle.textContent = masterMostrarModulosCliente ? 'Ocultar Módulos Comercio' : 'Ver Módulos Comercio';
    }
  } else {
    MODULOS_ERP_SAAS.forEach(mod => {
      const btn = document.getElementById(mod.btnId);
      if (!btn) return;
      if (permitidos.has(mod.id)) btn.classList.remove('hidden');
      else btn.classList.add('hidden');
    });

    document.querySelectorAll('.sidebar-section-group').forEach(grp => {
      const botonesVisibles = grp.querySelectorAll('button:not(.hidden)');
      if (botonesVisibles.length === 0) grp.classList.add('hidden');
      else grp.classList.remove('hidden');
    });
  }

  const elEstado = document.getElementById('headerTenantEstado');
  if (elEstado) {
    if (estaActivo) {
      elEstado.textContent = 'Activo';
      elEstado.className = 'text-emerald-400 font-semibold';
    } else {
      elEstado.textContent = 'Suspendido';
      elEstado.className = 'text-rose-400 font-semibold';
    }
  }

  const planEl = document.getElementById('headerTenantPlan');
  const rolEl = document.getElementById('headerTenantRol');
  if (planEl) {
    const esPromotor = String(tenantActual.rol || '').toLowerCase() === 'promotor' || tenantActual.es_promotor_externo === true;
    planEl.textContent = esMaster
      ? 'MASTER SAAS'
      : (esPromotor ? 'PROMOTOR ALIADO' : normalizarNombrePlan(tenantActual.plan_activo || 'Freemium').toUpperCase());
  }
  if (rolEl) rolEl.textContent = (tenantActual.rol || 'tenant').toUpperCase();
}

// ==========================================
// 2. PERSISTENCIA DE PAGOS Y CONFIG BANCARIA
// ==========================================

async function cargarConfigBancosMaster() {
  let cfg = null;
  try {
    const local = JSON.parse(localStorage.getItem('saas_config_bancos_master') || 'null');
    if (local && typeof local === 'object') cfg = local;
  } catch (e) {}

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('saas_config_pagos')
        .select('valor_json')
        .eq('clave', 'cuentas_receptoras')
        .maybeSingle();
      if (!error && data?.valor_json) {
        cfg = data.valor_json;
      }
    } catch (e) {}

    if (!cfg) {
      try {
        const { data, error } = await supabaseClient
          .from('audit_logs')
          .select('detalle')
          .eq('accion', 'SAAS_CONFIG_PAGOS')
          .order('created_at', { ascending: false })
          .limit(1);
        if (!error && data && data[0]?.detalle) {
          cfg = JSON.parse(data[0].detalle);
        }
      } catch (e) {}
    }
  }

  saasConfigBancosCache = { ...CONFIG_BANCOS_MASTER_DEFECTO, ...(cfg || {}) };
  localStorage.setItem('saas_config_bancos_master', JSON.stringify(saasConfigBancosCache));
  return saasConfigBancosCache;
}

async function guardarConfigBancosMaster() {
  if (!esUsuarioMaster()) { avisarSaas('Solo el usuario Master puede editar cuentas receptoras.', 'error'); return; }

  const getVal = id => (document.getElementById(id)?.value || '').trim();
  const cfg = {
    banco_nombre: getVal('masterCfgBancoNombre') || CONFIG_BANCOS_MASTER_DEFECTO.banco_nombre,
    banco_cuenta: getVal('masterCfgBancoCuenta') || CONFIG_BANCOS_MASTER_DEFECTO.banco_cuenta,
    banco_titular: getVal('masterCfgBancoTitular') || CONFIG_BANCOS_MASTER_DEFECTO.banco_titular,
    banco_rif: getVal('masterCfgBancoRif') || CONFIG_BANCOS_MASTER_DEFECTO.banco_rif,
    pagomovil_banco: getVal('masterCfgPmBanco') || CONFIG_BANCOS_MASTER_DEFECTO.pagomovil_banco,
    pagomovil_telefono: getVal('masterCfgPmTelefono') || CONFIG_BANCOS_MASTER_DEFECTO.pagomovil_telefono,
    pagomovil_rif: getVal('masterCfgPmRif') || CONFIG_BANCOS_MASTER_DEFECTO.pagomovil_rif,
    zelle_correo: getVal('masterCfgZelle') || '',
    binance_id: getVal('masterCfgBinance') || ''
  };

  saasConfigBancosCache = cfg;
  localStorage.setItem('saas_config_bancos_master', JSON.stringify(cfg));

  let guardadoNativo = false;
  if (supabaseClient) {
    try {
      const { error } = await supabaseClient
        .from('saas_config_pagos')
        .upsert([{ clave: 'cuentas_receptoras', valor_json: cfg, updated_at: new Date().toISOString() }], { onConflict: 'clave' });
      if (!error) guardadoNativo = true;
    } catch (e) {}

    if (!guardadoNativo && tenantActual?.id) {
      try {
        await supabaseClient.from('audit_logs').insert([{
          tenant_id: tenantActual.id,
          accion: 'SAAS_CONFIG_PAGOS',
          detalle: JSON.stringify(cfg)
        }]);
      } catch (e) {}
    }
  }

  avisarSaas('Datos bancarios receptores del Master actualizados para todos los clientes.', 'success');
}

function fusionarCatalogoPlanes(raw) {
  const base = clonarCatalogoPlanes(PLANES_SAAS_DEFECTO);
  if (!raw || typeof raw !== 'object') return base;
  ['Freemium', 'Pyme', 'Enterprise', 'Administración'].forEach(key => {
    if (raw[key] && typeof raw[key] === 'object') {
      const pm = Number(raw[key].precioMensual);
      const pa = Number(raw[key].precioAnual);
      base[key] = {
        ...base[key],
        etiqueta: String(raw[key].etiqueta ?? base[key].etiqueta).trim() || base[key].etiqueta,
        precioMensual: Number.isFinite(pm) && pm >= 0 ? pm : base[key].precioMensual,
        precioAnual: Number.isFinite(pa) && pa >= 0 ? pa : base[key].precioAnual,
        descripcion: String(raw[key].descripcion ?? base[key].descripcion).trim() || base[key].descripcion
      };
    }
  });
  if (!raw['Administración'] && raw.Enterprise) {
    base['Administración'].precioMensual = base.Enterprise.precioMensual;
    base['Administración'].precioAnual = base.Enterprise.precioAnual;
  }
  return base;
}

async function cargarConfigPlanesMaster() {
  let cfg = null;
  try {
    const local = JSON.parse(localStorage.getItem('saas_config_planes_master') || 'null');
    if (local && typeof local === 'object') cfg = local;
  } catch (e) {}

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('saas_config_pagos')
        .select('valor_json')
        .eq('clave', 'catalogo_planes')
        .maybeSingle();
      if (!error && data?.valor_json) {
        cfg = data.valor_json;
      }
    } catch (e) {}

    if (!cfg) {
      try {
        const { data, error } = await supabaseClient
          .from('audit_logs')
          .select('detalle')
          .eq('accion', 'SAAS_CONFIG_PLANES')
          .order('created_at', { ascending: false })
          .limit(1);
        if (!error && data && data[0]?.detalle) {
          cfg = JSON.parse(data[0].detalle);
        }
      } catch (e) {}
    }
  }

  PLANES_SAAS_CATALOGO = fusionarCatalogoPlanes(cfg);
  try {
    localStorage.setItem('saas_config_planes_master', JSON.stringify(PLANES_SAAS_CATALOGO));
  } catch (e) {}
  return PLANES_SAAS_CATALOGO;
}

async function guardarConfigPlanesMaster() {
  if (!esUsuarioMaster()) {
    avisarSaas('Solo el usuario Master puede modificar los precios de los planes.', 'error');
    return;
  }

  const leerNumero = (id, fallback) => {
    const raw = document.getElementById(id)?.value;
    const n = parseFloat(raw);
    return Number.isFinite(n) && n >= 0 ? Number(n.toFixed(2)) : fallback;
  };
  const leerTexto = (id, fallback) => {
    const txt = (document.getElementById(id)?.value || '').trim();
    return txt || fallback;
  };

  const freeM = leerNumero('masterPlanFreeMensual', 0);
  const freeA = leerNumero('masterPlanFreeAnual', 0);
  const pymeM = leerNumero('masterPlanPymeMensual', PLANES_SAAS_CATALOGO.Pyme.precioMensual);
  const pymeA = leerNumero('masterPlanPymeAnual', PLANES_SAAS_CATALOGO.Pyme.precioAnual);
  const entM = leerNumero('masterPlanEntMensual', PLANES_SAAS_CATALOGO.Enterprise.precioMensual);
  const entA = leerNumero('masterPlanEntAnual', PLANES_SAAS_CATALOGO.Enterprise.precioAnual);

  const nuevoCatalogo = {
    Freemium: {
      nombre: 'Freemium',
      etiqueta: leerTexto('masterPlanFreeEtiqueta', PLANES_SAAS_DEFECTO.Freemium.etiqueta),
      precioMensual: freeM,
      precioAnual: freeA,
      descripcion: leerTexto('masterPlanFreeDesc', PLANES_SAAS_DEFECTO.Freemium.descripcion)
    },
    Pyme: {
      nombre: 'Pyme',
      etiqueta: leerTexto('masterPlanPymeEtiqueta', PLANES_SAAS_DEFECTO.Pyme.etiqueta),
      precioMensual: pymeM,
      precioAnual: pymeA,
      descripcion: leerTexto('masterPlanPymeDesc', PLANES_SAAS_DEFECTO.Pyme.descripcion)
    },
    Enterprise: {
      nombre: 'Enterprise',
      etiqueta: leerTexto('masterPlanEntEtiqueta', PLANES_SAAS_DEFECTO.Enterprise.etiqueta),
      precioMensual: entM,
      precioAnual: entA,
      descripcion: leerTexto('masterPlanEntDesc', PLANES_SAAS_DEFECTO.Enterprise.descripcion)
    },
    'Administración': {
      ...PLANES_SAAS_CATALOGO['Administración'],
      precioMensual: entM,
      precioAnual: entA
    }
  };

  PLANES_SAAS_CATALOGO = fusionarCatalogoPlanes(nuevoCatalogo);
  localStorage.setItem('saas_config_planes_master', JSON.stringify(PLANES_SAAS_CATALOGO));

  let guardadoNativo = false;
  if (supabaseClient) {
    try {
      const { error } = await supabaseClient
        .from('saas_config_pagos')
        .upsert([{ clave: 'catalogo_planes', valor_json: PLANES_SAAS_CATALOGO, updated_at: new Date().toISOString() }], { onConflict: 'clave' });
      if (!error) guardadoNativo = true;
    } catch (e) {}

    if (!guardadoNativo && tenantActual?.id) {
      try {
        await supabaseClient.from('audit_logs').insert([{
          tenant_id: tenantActual.id,
          accion: 'SAAS_CONFIG_PLANES',
          detalle: JSON.stringify(PLANES_SAAS_CATALOGO)
        }]);
      } catch (e) {}
    }
  }

  recalcularResumenPreciosMasterUI();
  renderizarTablaSuscripcionesMaster();
  renderizarTarjetasPlanesCliente();
  actualizarSelectPlanesClienteUI();
  actualizarCalculoPagoSuscripcion();

  avisarSaas(
    `Precios actualizados · Pyme ($${pymeM.toFixed(2)}/mes · $${pymeA.toFixed(2)}/año) y Enterprise ($${entM.toFixed(2)}/mes · $${entA.toFixed(2)}/año).`,
    'success',
    6500
  );
}

async function cargarPagosSuscripcion(soloTenantId = null) {
  const mapa = new Map();

  try {
    const local = JSON.parse(localStorage.getItem('saas_pagos_cache') || '[]');
    if (Array.isArray(local)) {
      local.forEach(p => { if (p?.id) mapa.set(String(p.id), p); });
    }
  } catch (e) {}

  if (supabaseClient) {
    try {
      let q = supabaseClient.from('saas_pagos_suscripcion').select('*').order('created_at', { ascending: false }).limit(200);
      if (soloTenantId) q = q.eq('tenant_id', soloTenantId);
      const { data, error } = await q;
      if (!error && Array.isArray(data)) {
        data.forEach(p => mapa.set(String(p.id), p));
      }
    } catch (e) {}

    try {
      let q2 = supabaseClient
        .from('audit_logs')
        .select('tenant_id, detalle, created_at')
        .eq('accion', 'SAAS_PAGO_REPORTE')
        .order('created_at', { ascending: true })
        .limit(300);
      if (soloTenantId) q2 = q2.eq('tenant_id', soloTenantId);
      const { data: logs, error: errLog } = await q2;
      if (!errLog && Array.isArray(logs)) {
        logs.forEach(l => {
          try {
            const p = JSON.parse(l.detalle || '{}');
            if (p?.id) {
              const prev = mapa.get(String(p.id)) || {};
              mapa.set(String(p.id), { ...prev, ...p });
            }
          } catch (e) {}
        });
      }
    } catch (e) {}
  }

  let lista = Array.from(mapa.values());
  if (soloTenantId) {
    lista = lista.filter(p => String(p.tenant_id) === String(soloTenantId));
  }
  lista.sort((a, b) => String(b.created_at || b.fecha_pago || '').localeCompare(String(a.created_at || a.fecha_pago || '')));
  saasPagosCache = lista;
  return lista;
}

async function registrarPagoEnNube(pagoObj) {
  const local = JSON.parse(localStorage.getItem('saas_pagos_cache') || '[]');
  const idx = local.findIndex(x => String(x.id) === String(pagoObj.id));
  if (idx >= 0) local[idx] = pagoObj;
  else local.unshift(pagoObj);
  localStorage.setItem('saas_pagos_cache', JSON.stringify(local.slice(0, 200)));

  let nativoOk = false;
  if (supabaseClient) {
    try {
      const { id, ...sinId } = pagoObj;
      const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''));
      const res = esUuid
        ? await supabaseClient.from('saas_pagos_suscripcion').upsert([pagoObj], { onConflict: 'id' }).select()
        : await supabaseClient.from('saas_pagos_suscripcion').insert([sinId]).select();
      if (!res.error && res.data?.[0]) {
        nativoOk = true;
        pagoObj.id = res.data[0].id;
      }
    } catch (e) {}

    try {
      await supabaseClient.from('audit_logs').insert([{
        tenant_id: pagoObj.tenant_id,
        accion: 'SAAS_PAGO_REPORTE',
        detalle: JSON.stringify(pagoObj)
      }]);
    } catch (e) {}
  }

  return { ok: true, nativoOk, pago: pagoObj };
}

// ==========================================
// 3. PANEL MASTER SAAS (TENANTS, PERMISOS, PAGOS, SQL)
// ==========================================

function cambiarSubtabMaster(subtab) {
  ['tenants', 'pagos', 'referidosMaster', 'infraestructura'].forEach(st => {
    const panel = document.getElementById(`masterSubPanel_${st}`);
    const btn = document.getElementById(`btnMasterSub_${st}`);
    if (panel) {
      if (st === subtab) panel.classList.remove('hidden');
      else panel.classList.add('hidden');
    }
    if (btn) {
      if (st === subtab) {
        btn.classList.add('bg-emerald-600', 'text-white', 'border-emerald-500');
        btn.classList.remove('bg-slate-900', 'text-slate-300', 'border-slate-800');
      } else {
        btn.classList.remove('bg-emerald-600', 'text-white', 'border-emerald-500');
        btn.classList.add('bg-slate-900', 'text-slate-300', 'border-slate-800');
      }
    }
  });
  marcarBotonSidebarMaster(subtab);
  if (subtab === 'referidosMaster' && typeof cargarPanelReferidosMaster === 'function') {
    cargarPanelReferidosMaster();
  }
  if (subtab === 'infraestructura') {
    if (typeof verificarEstadoEsquemaContable === 'function') verificarEstadoEsquemaContable();
    verificarEstadoEsquemaSaas();
  }
}

async function verificarEstadoEsquemaSaas() {
  const el = document.getElementById('saasEstadoEsquemaBadge');
  if (!el || !supabaseClient) return;
  try {
    const [r1, r2, r3, r4] = await Promise.all([
      supabaseClient.from('saas_pagos_suscripcion').select('id').limit(1),
      supabaseClient.from('saas_config_pagos').select('clave').limit(1),
      supabaseClient.from('saas_comisiones_referidos').select('id').limit(1),
      supabaseClient.from('saas_retiros_referidos').select('id').limit(1)
    ]);
    if (!r1.error && !r2.error && !r3.error && !r4.error) {
      el.className = 'px-3 py-1 rounded-lg text-[11px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-700/50';
      el.textContent = 'BD SaaS Suscripciones & Referidos: ACTIVA (Tablas Nativas)';
    } else {
      el.className = 'px-3 py-1 rounded-lg text-[11px] font-mono font-bold bg-amber-950 text-amber-300 border border-amber-700/50';
      el.textContent = 'Modo Respaldo Activo · Ejecuta migracion_saas_suscripciones.sql';
    }
  } catch (e) {}
}

async function cargarPanelMasterCompleto() {
  if (!esUsuarioMaster()) {
    avisarSaas('Acceso restringido al usuario Master.', 'error');
    return;
  }

  const tbody = document.getElementById('tablaInquilinosMaster');
  if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">Cargando directorio multitenant...</td></tr>`;

  await Promise.all([
    sincronizarMetaSaasNube(null),
    cargarConfigBancosMaster(),
    cargarConfigPlanesMaster(),
    cargarPagosSuscripcion(null)
  ]);

  const { data, error } = await supabaseClient
    .from('tenants')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-rose-400">${esc(error.message)}</td></tr>`;
    return;
  }

  saasTenantsCache = (data || []).map(fusionarTenantConMetaSaas);

  const activos = saasTenantsCache.filter(t => t.activo !== false).length;
  const planesPagos = saasTenantsCache.filter(t => normalizarNombrePlan(t.plan_activo) !== 'Freemium').length;
  const pagosPendientes = saasPagosCache.filter(p => p.estado === 'PENDIENTE').length;

  const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = String(v); };
  setTxt('masterTotalInquilinos', saasTenantsCache.length);
  setTxt('masterKpiActivos', activos);
  setTxt('masterKpiPagosPlan', planesPagos);
  setTxt('masterKpiPagosPendientes', pagosPendientes);

  pintarConfigBancosEnMasterUI();
  pintarConfigPlanesEnMasterUI();
  renderizarTablaInquilinosMaster();
  renderizarTablaSuscripcionesMaster();
  renderizarBandejaPagosMaster();
  if (typeof cargarPanelReferidosMaster === 'function') {
    cargarPanelReferidosMaster();
  }
}

function pintarConfigBancosEnMasterUI() {
  const c = saasConfigBancosCache;
  const setVal = (id, v) => { const e = document.getElementById(id); if (e) e.value = v || ''; };
  setVal('masterCfgBancoNombre', c.banco_nombre);
  setVal('masterCfgBancoCuenta', c.banco_cuenta);
  setVal('masterCfgBancoTitular', c.banco_titular);
  setVal('masterCfgBancoRif', c.banco_rif);
  setVal('masterCfgPmBanco', c.pagomovil_banco);
  setVal('masterCfgPmTelefono', c.pagomovil_telefono);
  setVal('masterCfgPmRif', c.pagomovil_rif);
  setVal('masterCfgZelle', c.zelle_correo);
  setVal('masterCfgBinance', c.binance_id);
}

function calcularPorcentajeAhorroAnual(mensual, anual) {
  const m = Number(mensual || 0);
  const a = Number(anual || 0);
  if (m <= 0 || a <= 0 || a >= m * 12) return 0;
  return Math.round((1 - a / (m * 12)) * 100);
}

function pintarConfigPlanesEnMasterUI() {
  const setVal = (id, v) => { const e = document.getElementById(id); if (e) e.value = v ?? ''; };
  const f = PLANES_SAAS_CATALOGO.Freemium;
  const p = PLANES_SAAS_CATALOGO.Pyme;
  const e = PLANES_SAAS_CATALOGO.Enterprise;

  setVal('masterPlanFreeMensual', Number(f.precioMensual).toFixed(2));
  setVal('masterPlanFreeAnual', Number(f.precioAnual).toFixed(2));
  setVal('masterPlanFreeEtiqueta', f.etiqueta);
  setVal('masterPlanFreeDesc', f.descripcion);

  setVal('masterPlanPymeMensual', Number(p.precioMensual).toFixed(2));
  setVal('masterPlanPymeAnual', Number(p.precioAnual).toFixed(2));
  setVal('masterPlanPymeEtiqueta', p.etiqueta);
  setVal('masterPlanPymeDesc', p.descripcion);

  setVal('masterPlanEntMensual', Number(e.precioMensual).toFixed(2));
  setVal('masterPlanEntAnual', Number(e.precioAnual).toFixed(2));
  setVal('masterPlanEntEtiqueta', e.etiqueta);
  setVal('masterPlanEntDesc', e.descripcion);

  recalcularResumenPreciosMasterUI();
}

function recalcularResumenPreciosMasterUI() {
  const tasa = obtenerTasaBcvVigenteSaas();
  const leer = id => {
    const n = parseFloat(document.getElementById(id)?.value || '0');
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const actualizarInfo = (idInfo, mensual, anual) => {
    const el = document.getElementById(idInfo);
    if (!el) return;
    const dto = calcularPorcentajeAhorroAnual(mensual, anual);
    const bsMes = (mensual * tasa).toFixed(2);
    const bsAno = (anual * tasa).toFixed(2);
    el.textContent = dto > 0
      ? `Bs. ${bsMes}/mes · Bs. ${bsAno}/año (Ahorro anual -${dto}%)`
      : `Ref. BCV: Bs. ${bsMes}/mes · Bs. ${bsAno}/año`;
  };
  actualizarInfo('masterPlanFreeAhorroInfo', leer('masterPlanFreeMensual'), leer('masterPlanFreeAnual'));
  actualizarInfo('masterPlanPymeAhorroInfo', leer('masterPlanPymeMensual'), leer('masterPlanPymeAnual'));
  actualizarInfo('masterPlanEntAhorroInfo', leer('masterPlanEntMensual'), leer('masterPlanEntAnual'));
}

function aplicarDescuentoAnual20Master(prefijo) {
  const elM = document.getElementById(`masterPlan${prefijo}Mensual`);
  const elA = document.getElementById(`masterPlan${prefijo}Anual`);
  if (!elM || !elA) return;
  const mensual = parseFloat(elM.value || '0');
  if (!Number.isFinite(mensual) || mensual < 0) return;
  elA.value = (mensual * 12 * 0.8).toFixed(2);
  recalcularResumenPreciosMasterUI();
}

function calcularEstadoVigenciaPlan(tenant) {
  if (esUsuarioMaster(tenant)) return { texto: 'ILIMITADO (MASTER)', clase: 'text-emerald-400' };
  const venc = tenant.fecha_vencimiento_plan;
  if (!venc) return { texto: 'Sin vencimiento', clase: 'text-slate-400' };
  const hoy = new Date().toISOString().slice(0, 10);
  if (venc < hoy) return { texto: `Vencido (${venc})`, clase: 'text-rose-400' };
  return { texto: `Vigente hasta ${venc}`, clase: 'text-emerald-400' };
}

function renderizarTablaInquilinosMaster() {
  const tbody = document.getElementById('tablaInquilinosMaster');
  if (!tbody) return;

  const filtroTexto = (document.getElementById('masterFiltroTexto')?.value || '').trim().toLowerCase();
  const filtroPlan = document.getElementById('masterFiltroPlan')?.value || '';
  const filtroEstado = document.getElementById('masterFiltroEstado')?.value || '';

  const lista = saasTenantsCache.filter(t => {
    const matchTxt = !filtroTexto ||
      String(t.razon_social || '').toLowerCase().includes(filtroTexto) ||
      String(t.rif || '').toLowerCase().includes(filtroTexto) ||
      String(t.email || '').toLowerCase().includes(filtroTexto);
    const planNorm = normalizarNombrePlan(t.plan_activo);
    const matchPlan = !filtroPlan || planNorm === filtroPlan;
    const estaActivo = t.activo !== false;
    const matchEstado = !filtroEstado || (filtroEstado === 'ACTIVO' ? estaActivo : !estaActivo);
    return matchTxt && matchPlan && matchEstado;
  });

  tbody.innerHTML = '';
  if (lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-5 text-center text-slate-500">No hay inquilinos que coincidan con el filtro.</td></tr>`;
    return;
  }

  lista.forEach(t => {
    const plan = normalizarNombrePlan(t.plan_activo);
    const ciclo = String(t.ciclo_facturacion || 'MENSUAL').toUpperCase();
    const rol = String(t.rol || 'tenant').toUpperCase();
    const estaActivo = t.activo !== false;
    const vigencia = calcularEstadoVigenciaPlan(t);
    const mods = obtenerPermisosEfectivosTenant(t);
    const esPersonalizado = Array.isArray(t.modulos_permitidos) && t.modulos_permitidos.length > 0;
    const esSelfMaster = esUsuarioMaster(t);

    const estadoTxt = estaActivo
      ? '<span class="text-emerald-400 font-semibold">Activo</span>'
      : '<span class="text-rose-400 font-semibold">Suspendido</span>';

    tbody.innerHTML += `
      <tr class="hover:bg-slate-900/90 border-b border-slate-800/40">
        <td class="p-3">
          <p class="font-semibold text-white">${esc(t.razon_social || 'Sin Razón Social')}</p>
          <p class="text-[11px] font-mono text-slate-400">${esc(t.rif || 'N/A')} · ${esc(rol)}</p>
        </td>
        <td class="p-3">
          <p class="font-mono text-xs text-slate-200">${esc(t.email || '')}</p>
          <p class="text-[11px] text-slate-500">${esc(t.telefono || '--')}</p>
        </td>
        <td class="p-3">
          <p class="font-mono text-xs font-bold text-emerald-400">${esc(plan.toUpperCase())}</p>
          <p class="text-[11px] font-mono text-slate-400">${esc(ciclo)}</p>
        </td>
        <td class="p-3 font-mono text-[11px] ${vigencia.clase}">${esc(vigencia.texto)}</td>
        <td class="p-3 text-xs">${estadoTxt}</td>
        <td class="p-3 font-mono text-xs text-slate-300 tabular-nums">
          ${esSelfMaster ? 'Todos (Master)' : `${mods.length}/${MODULOS_ERP_SAAS.length} (${esPersonalizado ? 'Custom' : 'Plan'})`}
        </td>
        <td class="p-3 text-center">
          <div class="flex flex-wrap items-center justify-center gap-1.5">
            <button type="button" onclick='abrirModalInquilinoMaster("${esc(t.id)}")' class="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer">Editar</button>
            <button type="button" onclick='abrirModalPermisosMaster("${esc(t.id)}")' class="bg-slate-800 hover:bg-emerald-950 text-emerald-300 border border-emerald-700/40 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer">Menús</button>
            ${!esSelfMaster ? `<button type="button" onclick='toggleEstadoInquilinoMaster("${esc(t.id)}", ${estaActivo ? 'true' : 'false'})' class="bg-slate-800 hover:bg-slate-700 ${estaActivo ? 'text-amber-300' : 'text-emerald-400'} border border-slate-700 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer">${estaActivo ? 'Suspender' : 'Activar'}</button>` : ''}
          </div>
        </td>
      </tr>
    `;
  });
}

function renderizarTablaSuscripcionesMaster() {
  const tbody = document.getElementById('tablaSuscripcionesMaster');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (saasTenantsCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-500">Sin inquilinos registrados.</td></tr>`;
    return;
  }

  saasTenantsCache.forEach(t => {
    const plan = normalizarNombrePlan(t.plan_activo);
    const cfgPlan = PLANES_SAAS_CATALOGO[plan] || PLANES_SAAS_CATALOGO.Freemium;
    const ciclo = String(t.ciclo_facturacion || 'MENSUAL').toUpperCase();
    const montoUsd = ciclo === 'ANUAL' ? cfgPlan.precioAnual : cfgPlan.precioMensual;
    const ultimoPago = saasPagosCache.find(p => String(p.tenant_id) === String(t.id) && p.estado === 'APROBADO');
    const vigencia = calcularEstadoVigenciaPlan(t);

    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/40">
        <td class="p-3"><p class="font-semibold text-white">${esc(t.razon_social)}</p><p class="text-[11px] font-mono text-slate-400">${esc(t.email)}</p></td>
        <td class="p-3 font-mono text-xs font-bold text-emerald-400">${esc(plan.toUpperCase())}</td>
        <td class="p-3 font-mono text-xs text-slate-300">${esc(ciclo)}</td>
        <td class="p-3 text-right font-mono text-xs text-white tabular-nums">$ ${Number(montoUsd).toFixed(2)}</td>
        <td class="p-3 font-mono text-[11px] ${vigencia.clase}">${esc(vigencia.texto)}</td>
        <td class="p-3 font-mono text-[11px] text-slate-400">${ultimoPago ? `${esc(ultimoPago.fecha_pago)} (${esc(ultimoPago.metodo_pago)} Ref: ${esc(ultimoPago.referencia)})` : 'Sin pagos registrados'}</td>
      </tr>
    `;
  });
}

function renderizarBandejaPagosMaster() {
  const tbody = document.getElementById('tablaBandejaPagosMaster');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (saasPagosCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-5 text-center text-slate-500">No hay reportes de pago de suscripción todavía.</td></tr>`;
    return;
  }

  saasPagosCache.forEach(p => {
    const est = String(p.estado || 'PENDIENTE').toUpperCase();
    const estColor = est === 'APROBADO' ? 'text-emerald-400' : (est === 'RECHAZADO' ? 'text-rose-400' : 'text-amber-300');
    const acciones = est === 'PENDIENTE'
      ? `
        <button type="button" onclick='aprobarPagoSuscripcionMaster("${esc(p.id)}")' class="bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer">Aprobar y Activar</button>
        <button type="button" onclick='rechazarPagoSuscripcionMaster("${esc(p.id)}")' class="bg-rose-950 hover:bg-rose-900 text-rose-200 border border-rose-700/50 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer">Rechazar</button>
      `
      : `<span class="text-[11px] font-mono text-slate-500">${esc(p.revisado_en ? String(p.revisado_en).slice(0, 10) : 'Procesado')}</span>`;

    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/40">
        <td class="p-3">
          <p class="font-semibold text-white">${esc(p.tenant_nombre || 'Comercio')}</p>
          <p class="text-[11px] font-mono text-slate-400">${esc(p.tenant_rif || '')} · ${esc(p.fecha_pago || '')}</p>
        </td>
        <td class="p-3 font-mono text-xs text-emerald-400 font-bold">${esc(p.plan_solicitado)} <span class="text-slate-400 font-normal">(${esc(p.ciclo)})</span></td>
        <td class="p-3 text-xs text-slate-300">${esc(p.metodo_pago)}<div class="text-[11px] text-slate-500">${esc(p.banco_origen || '')}</div></td>
        <td class="p-3 font-mono text-xs text-white">${esc(p.referencia)}</td>
        <td class="p-3 text-right font-mono text-xs tabular-nums">
          <span class="text-emerald-400 font-bold">$ ${Number(p.monto_usd || 0).toFixed(2)}</span>
          <div class="text-[11px] text-slate-400">Bs. ${Number(p.monto_bs || 0).toFixed(2)}</div>
        </td>
        <td class="p-3 font-mono text-xs font-bold ${estColor}">${esc(est)}</td>
        <td class="p-3 text-center space-x-1.5">${acciones}</td>
      </tr>
    `;
  });
}

async function guardarMetaYEstadoTenantEnNube(tenantId, camposBaseTenant, metaSaas) {
  let okBase = true;
  let errorMsg = '';

  const payloadCompleto = { ...camposBaseTenant, ...metaSaas };
  let res = await supabaseClient.from('tenants').update(payloadCompleto).eq('id', tenantId).select();

  if (res.error && typeof esErrorColumnaOTablaFaltante === 'function' && esErrorColumnaOTablaFaltante(res.error)) {
    res = await supabaseClient.from('tenants').update(camposBaseTenant).eq('id', tenantId).select();
  }

  if (res.error) {
    okBase = false;
    errorMsg = res.error.message;
  } else if (!res.data || res.data.length === 0) {
    okBase = false;
    errorMsg = 'Supabase devolvió 0 filas actualizadas en "tenants". Verifica la política RLS ejecutando migracion_saas_suscripciones.sql desde Infraestructura.';
  }

  guardarMetaSaasLocal(tenantId, metaSaas);
  try {
    await supabaseClient.from('audit_logs').insert([{
      tenant_id: tenantId,
      accion: 'SAAS_TENANT_META',
      detalle: JSON.stringify({ tenant_id: tenantId, ...metaSaas })
    }]);
  } catch (e) {}

  if (tenantActual && String(tenantActual.id) === String(tenantId)) {
    tenantActual = fusionarTenantConMetaSaas({ ...tenantActual, ...camposBaseTenant, ...metaSaas });
    localStorage.setItem('tenant_actual', JSON.stringify(tenantActual));
    aplicarPermisosMenuTenant();
  }

  return { ok: okBase, error: errorMsg };
}

function abrirModalInquilinoMaster(tenantId = null) {
  const modal = document.getElementById('modalInquilinoMaster');
  if (!modal) return;
  const t = tenantId ? saasTenantsCache.find(x => String(x.id) === String(tenantId)) : null;

  const setVal = (id, v) => { const e = document.getElementById(id); if (e) e.value = v ?? ''; };
  setVal('masterEditTenantId', t ? t.id : '');
  setVal('masterTenantRazonSocial', t ? t.razon_social : '');
  setVal('masterTenantRif', t ? t.rif : '');
  setVal('masterTenantEmail', t ? t.email : '');
  setVal('masterTenantPassword', t ? (t.password || '') : '');
  setVal('masterTenantTelefono', t ? t.telefono : '');
  setVal('masterTenantDireccion', t ? t.direccion : '');
  setVal('masterTenantRol', t ? String(t.rol || 'tenant').toLowerCase() : 'tenant');
  setVal('masterTenantPlan', t ? normalizarNombrePlan(t.plan_activo) : 'Freemium');
  setVal('masterTenantCiclo', t ? String(t.ciclo_facturacion || 'MENSUAL').toUpperCase() : 'MENSUAL');
  setVal('masterTenantActivo', t ? (t.activo === false ? 'false' : 'true') : 'true');
  setVal('masterTenantVencimiento', t?.fecha_vencimiento_plan || '');

  const titulo = document.getElementById('tituloModalInquilinoMaster');
  if (titulo) titulo.textContent = t ? `Administrar Inquilino: ${t.razon_social}` : 'Registrar Nuevo Inquilino SaaS';

  modal.classList.remove('hidden');
}

function cerrarModalInquilinoMaster() {
  document.getElementById('modalInquilinoMaster')?.classList.add('hidden');
}

async function guardarInquilinoMaster() {
  if (!esUsuarioMaster()) return;
  const editId = document.getElementById('masterEditTenantId')?.value || '';
  const getVal = id => (document.getElementById(id)?.value || '').trim();

  const razon_social = getVal('masterTenantRazonSocial');
  const rif = getVal('masterTenantRif').toUpperCase();
  const email = getVal('masterTenantEmail').toLowerCase();
  const password = getVal('masterTenantPassword');
  const telefono = getVal('masterTenantTelefono');
  const direccion = getVal('masterTenantDireccion');
  const rol = getVal('masterTenantRol') || 'tenant';
  const plan_activo = normalizarNombrePlan(getVal('masterTenantPlan'));
  const ciclo_facturacion = getVal('masterTenantCiclo') || 'MENSUAL';
  const activo = getVal('masterTenantActivo') !== 'false';
  const fecha_vencimiento_plan = getVal('masterTenantVencimiento') || null;

  if (!razon_social || !rif || !email) {
    avisarSaas('Razón Social, RIF y Correo son obligatorios.', 'warning');
    return;
  }

  const camposBase = {
    razon_social,
    rif,
    email,
    telefono,
    direccion,
    rol,
    plan_activo,
    activo
  };
  if (password) camposBase.password = password;

  const metaSaas = {
    ciclo_facturacion,
    fecha_vencimiento_plan,
    estado_suscripcion: activo ? 'ACTIVA' : 'SUSPENDIDA'
  };

  if (editId) {
    const res = await guardarMetaYEstadoTenantEnNube(editId, camposBase, metaSaas);
    if (!res.ok) {
      avisarSaas(res.error, 'warning', 7500);
    } else {
      avisarSaas(`Inquilino "${razon_social}" actualizado correctamente.`, 'success');
    }
  } else {
    if (!password) {
      avisarSaas('Ingresa una contraseña inicial para el nuevo inquilino.', 'warning');
      return;
    }
    const payload = { ...camposBase, password, ...metaSaas, modulos_permitidos: obtenerPresetModulosPorPlan(plan_activo) };
    let res = await supabaseClient.from('tenants').insert([payload]).select();
    if (res.error && typeof esErrorColumnaOTablaFaltante === 'function' && esErrorColumnaOTablaFaltante(res.error)) {
      res = await supabaseClient.from('tenants').insert([{ ...camposBase, password }]).select();
    }
    if (res.error || !res.data?.[0]) {
      avisarSaas(`No se pudo crear el inquilino: ${res.error?.message || 'Política RLS en tenants'}`, 'error', 7500);
      return;
    }
    const nuevoId = res.data[0].id;
    await guardarMetaYEstadoTenantEnNube(nuevoId, camposBase, { ...metaSaas, modulos_permitidos: obtenerPresetModulosPorPlan(plan_activo) });
    avisarSaas(`Inquilino "${razon_social}" creado y habilitado.`, 'success');
  }

  cerrarModalInquilinoMaster();
  await cargarPanelMasterCompleto();
}

async function toggleEstadoInquilinoMaster(tenantId, estaActivo) {
  const t = saasTenantsCache.find(x => String(x.id) === String(tenantId));
  if (!t || esUsuarioMaster(t)) return;
  const nuevoActivo = !estaActivo;
  const res = await guardarMetaYEstadoTenantEnNube(
    tenantId,
    { activo: nuevoActivo },
    { estado_suscripcion: nuevoActivo ? 'ACTIVA' : 'SUSPENDIDA' }
  );
  if (!res.ok) avisarSaas(res.error, 'warning', 7000);
  else avisarSaas(`Inquilino ${t.razon_social} ${nuevoActivo ? 'activado' : 'suspendido'}.`, 'success');
  await cargarPanelMasterCompleto();
}

function abrirModalPermisosMaster(tenantId) {
  const t = saasTenantsCache.find(x => String(x.id) === String(tenantId));
  if (!t) return;
  const modal = document.getElementById('modalPermisosMaster');
  if (!modal) return;

  document.getElementById('permisosMasterTenantId').value = t.id;
  document.getElementById('permisosMasterSubtitulo').textContent = `${t.razon_social} (${t.rif}) · Plan actual: ${normalizarNombrePlan(t.plan_activo)}`;

  const permitidos = new Set(obtenerPermisosEfectivosTenant(t));
  const cont = document.getElementById('listaChecksPermisosMaster');
  if (cont) {
    const grupos = {};
    MODULOS_ERP_SAAS.forEach(m => {
      if (!grupos[m.grupo]) grupos[m.grupo] = [];
      grupos[m.grupo].push(m);
    });

    cont.innerHTML = Object.entries(grupos).map(([grupo, mods]) => `
      <div class="bg-slate-950/70 border border-slate-800 rounded-xl p-3 space-y-2">
        <p class="text-[11px] font-bold uppercase tracking-wider text-emerald-400">${esc(grupo)}</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          ${mods.map(m => `
            <label class="flex items-center gap-2 text-xs text-slate-200 cursor-pointer hover:text-white py-0.5">
              <input type="checkbox" class="chk-modulo-tenant accent-emerald-500 rounded" value="${esc(m.id)}" ${permitidos.has(m.id) ? 'checked' : ''}>
              <span>${esc(m.nombre)}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `).join('');
  }

  modal.classList.remove('hidden');
}

function cerrarModalPermisosMaster() {
  document.getElementById('modalPermisosMaster')?.classList.add('hidden');
}

function aplicarPresetPermisosModal(presetPlan) {
  const set = presetPlan === 'TODOS'
    ? new Set(MODULOS_ERP_SAAS.map(m => m.id))
    : new Set(obtenerPresetModulosPorPlan(presetPlan));
  document.querySelectorAll('.chk-modulo-tenant').forEach(chk => {
    chk.checked = set.has(chk.value);
  });
}

async function guardarPermisosMaster() {
  const tenantId = document.getElementById('permisosMasterTenantId')?.value;
  if (!tenantId) return;
  const seleccionados = Array.from(document.querySelectorAll('.chk-modulo-tenant:checked')).map(el => el.value);
  if (seleccionados.length === 0) {
    avisarSaas('Selecciona al menos un módulo para el cliente.', 'warning');
    return;
  }

  const res = await guardarMetaYEstadoTenantEnNube(tenantId, {}, { modulos_permitidos: seleccionados, permisos_manuales: true });
  if (!res.ok && res.error) {
    avisarSaas(`Permisos guardados en respaldo nube/local (${seleccionados.length} módulos). ${res.error}`, 'info', 6500);
  } else {
    avisarSaas(`Menús del cliente actualizados (${seleccionados.length} módulos habilitados).`, 'success');
  }
  cerrarModalPermisosMaster();
  await cargarPanelMasterCompleto();
}

function calcularNuevaFechaVencimiento(ciclo, fechaBase = null) {
  const base = fechaBase && fechaBase >= new Date().toISOString().slice(0, 10)
    ? new Date(`${fechaBase}T00:00:00`)
    : new Date();
  const dias = String(ciclo).toUpperCase() === 'ANUAL' ? 365 : 30;
  base.setDate(base.getDate() + dias);
  return base.toISOString().slice(0, 10);
}

async function aprobarPagoSuscripcionMaster(pagoId) {
  const pago = saasPagosCache.find(p => String(p.id) === String(pagoId));
  if (!pago) return;

  const tenant = saasTenantsCache.find(t => String(t.id) === String(pago.tenant_id));
  const nuevaFechaVenc = calcularNuevaFechaVencimiento(pago.ciclo, tenant?.fecha_vencimiento_plan);
  const nuevoPlan = normalizarNombrePlan(pago.plan_solicitado);

  const pagoActualizado = {
    ...pago,
    estado: 'APROBADO',
    revisado_por: tenantActual?.email || 'master',
    revisado_en: new Date().toISOString()
  };

  await registrarPagoEnNube(pagoActualizado);

  const metaAct = {
    ciclo_facturacion: pago.ciclo,
    fecha_vencimiento_plan: nuevaFechaVenc,
    estado_suscripcion: 'ACTIVA'
  };
  if (!tenant?.modulos_permitidos || tenant.modulos_permitidos.length === 0) {
    metaAct.modulos_permitidos = obtenerPresetModulosPorPlan(nuevoPlan);
  }

  await guardarMetaYEstadoTenantEnNube(
    pago.tenant_id,
    { plan_activo: nuevoPlan, activo: true },
    metaAct
  );

  let comisionesGeneradas = [];
  if (typeof procesarComisionesPorPagoAprobado === 'function') {
    comisionesGeneradas = await procesarComisionesPorPagoAprobado(pagoActualizado, tenant || { id: pago.tenant_id, razon_social: pago.tenant_nombre });
  }

  const msgExtra = comisionesGeneradas.length > 0 ? ` · ${comisionesGeneradas.length} comisión(es) acreditadas en red de referidos.` : '';
  avisarSaas(`Pago aprobado. Plan ${nuevoPlan} (${pago.ciclo}) activado hasta ${nuevaFechaVenc}.${msgExtra}`, 'success', 7000);
  await cargarPanelMasterCompleto();
}

async function rechazarPagoSuscripcionMaster(pagoId) {
  const pago = saasPagosCache.find(p => String(p.id) === String(pagoId));
  if (!pago) return;
  const ok = typeof pedirConfirmacion === 'function'
    ? await pedirConfirmacion('Rechazar Reporte de Pago', `¿Deseas marcar como RECHAZADO el pago Ref. ${pago.referencia} de ${pago.tenant_nombre}?`)
    : true;
  if (!ok) return;

  await registrarPagoEnNube({
    ...pago,
    estado: 'RECHAZADO',
    motivo_rechazo: 'Referencia no verificada en cuenta receptora',
    revisado_por: tenantActual?.email || 'master',
    revisado_en: new Date().toISOString()
  });

  avisarSaas(`Pago Ref. ${pago.referencia} marcado como RECHAZADO.`, 'warning');
  await cargarPanelMasterCompleto();
}

async function copiarScriptSqlSaas() {
  try {
    const res = await fetch('/sql/migracion_saas_suscripciones.sql');
    const txt = await res.text();
    await navigator.clipboard.writeText(txt);
    avisarSaas('Script SQL de Suscripciones/Master copiado al portapapeles.', 'success', 6000);
  } catch (e) {
    avisarSaas('No se pudo copiar; usa Descargar .SQL SaaS.', 'warning');
  }
}

async function descargarScriptSqlSaas() {
  try {
    const res = await fetch('/sql/migracion_saas_suscripciones.sql');
    const txt = await res.text();
    const blob = new Blob([txt], { type: 'text/sql;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'migracion_saas_suscripciones.sql';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    avisarSaas('Descargado migracion_saas_suscripciones.sql.', 'success');
  } catch (e) {
    avisarSaas('Error descargando el script SQL SaaS.', 'error');
  }
}

// ==========================================
// 4. VISTA CLIENTE: MI SUSCRIPCIÓN, MENÚS HABILITADOS Y PAGOS
// ==========================================

async function cargarModuloSuscripcion() {
  if (!tenantActual) return;
  await Promise.all([
    sincronizarMetaSaasTenantActual(),
    cargarConfigBancosMaster(),
    cargarConfigPlanesMaster(),
    typeof cargarConfigReferidosMaster === 'function' ? cargarConfigReferidosMaster() : Promise.resolve(),
    cargarPagosSuscripcion(tenantActual.id),
    consultarEstadoPasarelaServidor()
  ]);

  pintarResumenSuscripcionCliente();
  actualizarSelectPlanesClienteUI();
  renderizarTarjetasPlanesCliente();
  pintarDatosBancosEnClienteUI();
  renderizarHistorialPagosCliente();
  actualizarCalculoPagoSuscripcion();
}

function actualizarSelectPlanesClienteUI() {
  const sel = document.getElementById('pagoSuscPlan');
  if (!sel) return;
  const valorActual = sel.value || 'Pyme';
  const pyme = PLANES_SAAS_CATALOGO.Pyme;
  const ent = PLANES_SAAS_CATALOGO.Enterprise;
  sel.innerHTML = `
    <option value="Pyme">Plan Pyme ($${Number(pyme.precioMensual).toFixed(2)}/mes · $${Number(pyme.precioAnual).toFixed(2)}/año)</option>
    <option value="Enterprise">Plan Enterprise ($${Number(ent.precioMensual).toFixed(2)}/mes · $${Number(ent.precioAnual).toFixed(2)}/año)</option>
  `;
  sel.value = (valorActual === 'Enterprise' || valorActual === 'Pyme') ? valorActual : 'Pyme';
}

function pintarResumenSuscripcionCliente() {
  const t = fusionarTenantConMetaSaas(tenantActual);
  const plan = normalizarNombrePlan(t.plan_activo || 'Freemium');
  const ciclo = String(t.ciclo_facturacion || 'MENSUAL').toUpperCase();
  const vigencia = calcularEstadoVigenciaPlan(t);
  const permitidos = obtenerPermisosEfectivosTenant(t);

  const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  setTxt('suscPlanActual', plan.toUpperCase());
  setTxt('suscCicloActual', ciclo);
  setTxt('suscVigenciaActual', vigencia.texto);
  setTxt('suscEstadoCuenta', t.activo === false ? 'SUSPENDIDO (Regulariza tu pago)' : 'ACTIVO');

  const bannerSusp = document.getElementById('suscBannerSuspendido');
  if (bannerSusp) {
    if (t.activo === false) bannerSusp.classList.remove('hidden');
    else bannerSusp.classList.add('hidden');
  }

  const contMods = document.getElementById('suscListaModulosHabilitados');
  if (contMods) {
    const mapaNom = {};
    MODULOS_ERP_SAAS.forEach(m => { mapaNom[m.id] = m.nombre; });
    contMods.innerHTML = permitidos.map(id => `
      <span class="text-xs text-slate-200 bg-slate-950 border border-slate-800 px-2.5 py-1 rounded-lg">${esc(mapaNom[id] || id)}</span>
    `).join('');
  }
}

function setCicloSuscripcionUI(ciclo) {
  saasCicloSeleccionadoUI = ciclo === 'ANUAL' ? 'ANUAL' : 'MENSUAL';
  const btnM = document.getElementById('btnCicloMensualUI');
  const btnA = document.getElementById('btnCicloAnualUI');
  if (btnM && btnA) {
    if (saasCicloSeleccionadoUI === 'MENSUAL') {
      btnM.className = 'px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white cursor-pointer';
      btnA.className = 'px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white cursor-pointer';
    } else {
      btnA.className = 'px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white cursor-pointer';
      btnM.className = 'px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white cursor-pointer';
    }
  }
  const selCiclo = document.getElementById('pagoSuscCiclo');
  if (selCiclo) selCiclo.value = saasCicloSeleccionadoUI;
  renderizarTarjetasPlanesCliente();
  actualizarCalculoPagoSuscripcion();
}

function renderizarTarjetasPlanesCliente() {
  const cont = document.getElementById('suscGridPlanes');
  if (!cont) return;
  const planActual = normalizarNombrePlan(tenantActual?.plan_activo || 'Freemium');
  const tasa = obtenerTasaBcvVigenteSaas();

  const planesMostrar = ['Freemium', 'Pyme', 'Enterprise'];
  cont.innerHTML = planesMostrar.map(key => {
    const p = PLANES_SAAS_CATALOGO[key];
    const esActual = planActual === key;
    const precioUsd = saasCicloSeleccionadoUI === 'ANUAL' ? p.precioAnual : p.precioMensual;
    const precioBs = precioUsd * tasa;
    const dtoAnual = calcularPorcentajeAhorroAnual(p.precioMensual, p.precioAnual);
    const periodoTxt = saasCicloSeleccionadoUI === 'ANUAL'
      ? (dtoAnual > 0 ? `/ año (-${dtoAnual}%)` : '/ año')
      : '/ mes';

    return `
      <div class="bg-slate-900 border ${esActual ? 'border-emerald-500/70' : 'border-slate-800'} rounded-2xl p-5 flex flex-col justify-between space-y-4">
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-2">
            <h4 class="text-base font-bold text-white">${esc(p.nombre)}</h4>
            <span class="text-[11px] font-mono ${esActual ? 'text-emerald-400 font-bold' : 'text-slate-400'}">${esActual ? 'PLAN ACTUAL' : esc(p.etiqueta)}</span>
          </div>
          <div class="pt-1">
            <span class="text-2xl font-extrabold font-mono text-emerald-400 tabular-nums">$ ${precioUsd.toFixed(2)}</span>
            <span class="text-xs text-slate-400 ml-1">${periodoTxt}</span>
            <p class="text-[11px] font-mono text-slate-400 tabular-nums mt-0.5">Ref. Bs. ${precioBs.toFixed(2)} (Tasa BCV ${tasa.toFixed(2)})</p>
          </div>
          <p class="text-xs text-slate-300 leading-relaxed pt-1">${esc(p.descripcion)}</p>
        </div>
        <button type="button" onclick='seleccionarPlanParaPagar("${esc(p.nombre)}")'
          class="w-full py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition ${p.precioMensual === 0 ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}">
          ${p.precioMensual === 0 ? 'Plan Gratuito Base' : `Seleccionar ${p.nombre} (${saasCicloSeleccionadoUI})`}
        </button>
      </div>
    `;
  }).join('');
}

function seleccionarPlanParaPagar(planNombre) {
  const selPlan = document.getElementById('pagoSuscPlan');
  const selCiclo = document.getElementById('pagoSuscCiclo');
  if (selPlan && (planNombre === 'Pyme' || planNombre === 'Enterprise')) {
    selPlan.value = planNombre;
  }
  if (selCiclo) selCiclo.value = saasCicloSeleccionadoUI;
  actualizarCalculoPagoSuscripcion();
  document.getElementById('panelReportarPagoSusc')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function pintarDatosBancosEnClienteUI() {
  const c = saasConfigBancosCache;
  const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v || '--'; };
  setTxt('cliBancoNombre', c.banco_nombre);
  setTxt('cliBancoCuenta', c.banco_cuenta);
  setTxt('cliBancoTitular', c.banco_titular);
  setTxt('cliBancoRif', c.banco_rif);
  setTxt('cliPmBanco', c.pagomovil_banco);
  setTxt('cliPmTelefono', c.pagomovil_telefono);
  setTxt('cliPmRif', c.pagomovil_rif);
  setTxt('cliZelleCorreo', c.zelle_correo || 'No habilitado');
  setTxt('cliBinanceId', c.binance_id || 'No habilitado');
}

function actualizarCalculoPagoSuscripcion() {
  const plan = document.getElementById('pagoSuscPlan')?.value || 'Pyme';
  const ciclo = document.getElementById('pagoSuscCiclo')?.value || 'MENSUAL';
  const p = PLANES_SAAS_CATALOGO[plan] || PLANES_SAAS_CATALOGO.Pyme;
  const tasa = obtenerTasaBcvVigenteSaas();
  const baseUsd = ciclo === 'ANUAL' ? p.precioAnual : p.precioMensual;
  const dtoPct = typeof obtenerDescuentoBienvenidaParaTenant === 'function' ? obtenerDescuentoBienvenidaParaTenant(tenantActual) : 0;
  const dtoUsd = Number(((baseUsd * dtoPct) / 100).toFixed(2));
  const usd = Number(Math.max(0, baseUsd - dtoUsd).toFixed(2));
  const bs = usd * tasa;

  const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  setTxt('pagoSuscTotalUsd', `$ ${usd.toFixed(2)}`);
  setTxt('pagoSuscTotalBs', `Bs. ${bs.toFixed(2)}`);
  setTxt(
    'pagoSuscTasaInfo',
    dtoPct > 0
      ? `Tasa BCV: ${tasa.toFixed(4)} Bs./$ · Dto. Bienvenida Referido (-${dtoPct}% = -$${dtoUsd.toFixed(2)}) aplicado`
      : `Tasa BCV: ${tasa.toFixed(4)} Bs./$`
  );
}

function cambiarMetodoPagoSuscTab(tab) {
  const panelTransf = document.getElementById('panelPagoTransferencia');
  const panelTarj = document.getElementById('panelPagoTarjeta');
  const btnT = document.getElementById('btnTabPagoTransf');
  const btnC = document.getElementById('btnTabPagoTarj');
  if (tab === 'tarjeta') {
    panelTransf?.classList.add('hidden');
    panelTarj?.classList.remove('hidden');
    btnC?.classList.add('bg-emerald-600', 'text-white');
    btnC?.classList.remove('bg-slate-950', 'text-slate-300');
    btnT?.classList.remove('bg-emerald-600', 'text-white');
    btnT?.classList.add('bg-slate-950', 'text-slate-300');
  } else {
    panelTarj?.classList.add('hidden');
    panelTransf?.classList.remove('hidden');
    btnT?.classList.add('bg-emerald-600', 'text-white');
    btnT?.classList.remove('bg-slate-950', 'text-slate-300');
    btnC?.classList.remove('bg-emerald-600', 'text-white');
    btnC?.classList.add('bg-slate-950', 'text-slate-300');
  }
}

async function enviarReportePagoSuscripcion(e) {
  if (e) e.preventDefault();
  if (!tenantActual?.id) return;

  const plan = document.getElementById('pagoSuscPlan')?.value || 'Pyme';
  const ciclo = document.getElementById('pagoSuscCiclo')?.value || 'MENSUAL';
  const metodo = document.getElementById('pagoSuscMetodo')?.value || 'TRANSFERENCIA';
  const banco = (document.getElementById('pagoSuscBanco')?.value || '').trim();
  const referencia = (document.getElementById('pagoSuscReferencia')?.value || '').trim();
  const fecha = document.getElementById('pagoSuscFecha')?.value || new Date().toISOString().slice(0, 10);
  const nota = (document.getElementById('pagoSuscNota')?.value || '').trim();

  if (!referencia || referencia.length < 4) {
    avisarSaas('Ingresa el número de referencia o confirmación bancaria (mín. 4 caracteres).', 'warning');
    return;
  }

  const p = PLANES_SAAS_CATALOGO[plan] || PLANES_SAAS_CATALOGO.Pyme;
  const tasa = obtenerTasaBcvVigenteSaas();
  const baseUsd = ciclo === 'ANUAL' ? p.precioAnual : p.precioMensual;
  const dtoPct = typeof obtenerDescuentoBienvenidaParaTenant === 'function' ? obtenerDescuentoBienvenidaParaTenant(tenantActual) : 0;
  const montoUsd = Number(Math.max(0, baseUsd - (baseUsd * dtoPct) / 100).toFixed(2));
  const montoBs = Number((montoUsd * tasa).toFixed(2));

  const pagoObj = {
    id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    tenant_id: tenantActual.id,
    tenant_nombre: tenantActual.razon_social || tenantActual.email,
    tenant_rif: tenantActual.rif || '',
    plan_solicitado: plan,
    ciclo,
    metodo_pago: metodo,
    banco_origen: banco || metodo,
    referencia,
    monto_usd: montoUsd,
    monto_bs: montoBs,
    tasa_bcv: tasa,
    fecha_pago: fecha,
    nota,
    estado: 'PENDIENTE',
    created_at: new Date().toISOString()
  };

  await registrarPagoEnNube(pagoObj);
  document.getElementById('formReportarPagoSusc')?.reset();
  const fEl = document.getElementById('pagoSuscFecha');
  if (fEl) fEl.value = new Date().toISOString().slice(0, 10);
  actualizarCalculoPagoSuscripcion();

  avisarSaas(`Reporte de pago Ref. ${referencia} enviado. El administrador Master verificará y activará tu plan ${plan}.`, 'success', 7000);
  await cargarPagosSuscripcion(tenantActual.id);
  renderizarHistorialPagosCliente();
}

function renderizarHistorialPagosCliente() {
  const tbody = document.getElementById('tablaHistorialPagosCliente');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (saasPagosCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-500">Aún no has reportado pagos de suscripción.</td></tr>`;
    return;
  }

  saasPagosCache.forEach(p => {
    const est = String(p.estado || 'PENDIENTE').toUpperCase();
    const estClase = est === 'APROBADO' ? 'text-emerald-400' : (est === 'RECHAZADO' ? 'text-rose-400' : 'text-amber-300');
    tbody.innerHTML += `
      <tr class="border-b border-slate-800/40">
        <td class="p-3 font-mono text-xs text-slate-300">${esc(p.fecha_pago || '')}</td>
        <td class="p-3 font-mono text-xs font-bold text-white">${esc(p.plan_solicitado)} (${esc(p.ciclo)})</td>
        <td class="p-3 text-xs text-slate-300">${esc(p.metodo_pago)}</td>
        <td class="p-3 font-mono text-xs text-slate-200">${esc(p.referencia)}</td>
        <td class="p-3 text-right font-mono text-xs tabular-nums text-emerald-400">$ ${Number(p.monto_usd || 0).toFixed(2)} <span class="text-slate-400">/ Bs. ${Number(p.monto_bs || 0).toFixed(2)}</span></td>
        <td class="p-3 font-mono text-xs font-bold ${estClase}">${esc(est)}</td>
      </tr>
    `;
  });
}

async function consultarEstadoPasarelaServidor() {
  try {
    const res = await fetch('/api/saas/pasarela-estado');
    if (res.ok) {
      saasPasarelaEstadoCache = await res.json();
      const el = document.getElementById('estadoPasarelaTarjetasBadge');
      if (el) {
        if (saasPasarelaEstadoCache.algunProveedorActivo) {
          el.textContent = 'Pasarela de Tarjetas: CONECTADA EN SERVIDOR';
          el.className = 'text-xs font-mono font-bold text-emerald-400';
        } else {
          el.textContent = 'Pasarela de Tarjetas: LISTA PARA CREDENCIALES COMERCIALES (.env)';
          el.className = 'text-xs font-mono font-bold text-amber-300';
        }
      }
    }
  } catch (e) {}
}
