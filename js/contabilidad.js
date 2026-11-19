/**
 * /js/contabilidad.js
 * Módulo de Integración Contable VEN-NIF / SENIAT:
 * - Persistencia compatible (funciona antes y después de ejecutar la migración SQL en Supabase)
 * - Plan de Cuentas Base VEN-NIF y CRUD de cuentas
 * - Configuración de Cuentas Contables por Defecto de la Empresa (tenants)
 * - Motor Automático de Asientos Contables (Partida Doble en Bs. y $ USD)
 * - Libro Diario, Balance de Comprobación y Exportadores Excel / JSON ERP / SQL
 */

let planCuentasCache = [];
let asientosContablesCache = [];
let metaContableStoreCache = {};

const PLAN_CUENTAS_VEN_NIF_BASE = [
  { codigo: '1', nombre: 'ACTIVO', tipo: 'ACTIVO', naturaleza: 'DEUDORA', nivel: 1, cuenta_padre: null, acepta_movimiento: false },
  { codigo: '1.1', nombre: 'ACTIVO CORRIENTE', tipo: 'ACTIVO', naturaleza: 'DEUDORA', nivel: 2, cuenta_padre: '1', acepta_movimiento: false },
  { codigo: '1.1.01.01', nombre: 'CAJA PRINCIPAL / CAJA CHICA', tipo: 'ACTIVO', naturaleza: 'DEUDORA', nivel: 4, cuenta_padre: '1.1', acepta_movimiento: true },
  { codigo: '1.1.01.02', nombre: 'BANCOS NACIONALES (Bs.)', tipo: 'ACTIVO', naturaleza: 'DEUDORA', nivel: 4, cuenta_padre: '1.1', acepta_movimiento: true },
  { codigo: '1.1.01.03', nombre: 'CAJA Y BANCOS DIVISAS ($ USD)', tipo: 'ACTIVO', naturaleza: 'DEUDORA', nivel: 4, cuenta_padre: '1.1', acepta_movimiento: true },
  { codigo: '1.1.02.01', nombre: 'CUENTAS POR COBRAR CLIENTES', tipo: 'ACTIVO', naturaleza: 'DEUDORA', nivel: 4, cuenta_padre: '1.1', acepta_movimiento: true },
  { codigo: '1.1.04.01', nombre: 'INVENTARIO DE MERCANCÍAS', tipo: 'ACTIVO', naturaleza: 'DEUDORA', nivel: 4, cuenta_padre: '1.1', acepta_movimiento: true },
  { codigo: '1.1.05.01', nombre: 'IVA CRÉDITO FISCAL (COMPRAS)', tipo: 'ACTIVO', naturaleza: 'DEUDORA', nivel: 4, cuenta_padre: '1.1', acepta_movimiento: true },
  { codigo: '1.1.05.02', nombre: 'RETENCIONES IVA POR COMPENSAR', tipo: 'ACTIVO', naturaleza: 'DEUDORA', nivel: 4, cuenta_padre: '1.1', acepta_movimiento: true },
  { codigo: '1.1.06.01', nombre: 'ANTICIPOS A PROVEEDORES', tipo: 'ACTIVO', naturaleza: 'DEUDORA', nivel: 4, cuenta_padre: '1.1', acepta_movimiento: true },

  { codigo: '2', nombre: 'PASIVO', tipo: 'PASIVO', naturaleza: 'ACREEDORA', nivel: 1, cuenta_padre: null, acepta_movimiento: false },
  { codigo: '2.1', nombre: 'PASIVO CORRIENTE', tipo: 'PASIVO', naturaleza: 'ACREEDORA', nivel: 2, cuenta_padre: '2', acepta_movimiento: false },
  { codigo: '2.1.01.01', nombre: 'CUENTAS POR PAGAR PROVEEDORES', tipo: 'PASIVO', naturaleza: 'ACREEDORA', nivel: 4, cuenta_padre: '2.1', acepta_movimiento: true },
  { codigo: '2.1.03.01', nombre: 'ANTICIPOS RECIBIDOS DE CLIENTES', tipo: 'PASIVO', naturaleza: 'ACREEDORA', nivel: 4, cuenta_padre: '2.1', acepta_movimiento: true },
  { codigo: '2.1.04.01', nombre: 'IVA DÉBITO FISCAL (VENTAS)', tipo: 'PASIVO', naturaleza: 'ACREEDORA', nivel: 4, cuenta_padre: '2.1', acepta_movimiento: true },
  { codigo: '2.1.04.05', nombre: 'IGTF 3% PERCIBIDO POR ENTERAR', tipo: 'PASIVO', naturaleza: 'ACREEDORA', nivel: 4, cuenta_padre: '2.1', acepta_movimiento: true },
  { codigo: '2.1.04.06', nombre: 'RETENCIONES DE IVA POR ENTERAR (SENIAT)', tipo: 'PASIVO', naturaleza: 'ACREEDORA', nivel: 4, cuenta_padre: '2.1', acepta_movimiento: true },
  { codigo: '2.1.04.07', nombre: 'RETENCIONES DE ISLR POR ENTERAR', tipo: 'PASIVO', naturaleza: 'ACREEDORA', nivel: 4, cuenta_padre: '2.1', acepta_movimiento: true },

  { codigo: '3', nombre: 'PATRIMONIO', tipo: 'PATRIMONIO', naturaleza: 'ACREEDORA', nivel: 1, cuenta_padre: null, acepta_movimiento: false },
  { codigo: '3.1.01.01', nombre: 'CAPITAL SOCIAL', tipo: 'PATRIMONIO', naturaleza: 'ACREEDORA', nivel: 4, cuenta_padre: '3', acepta_movimiento: true },
  { codigo: '3.2.01.01', nombre: 'RESULTADOS ACUMULADOS', tipo: 'PATRIMONIO', naturaleza: 'ACREEDORA', nivel: 4, cuenta_padre: '3', acepta_movimiento: true },

  { codigo: '4', nombre: 'INGRESOS', tipo: 'INGRESO', naturaleza: 'ACREEDORA', nivel: 1, cuenta_padre: null, acepta_movimiento: false },
  { codigo: '4.1.01.01', nombre: 'VENTAS DE MERCANCÍAS GRAVADAS', tipo: 'INGRESO', naturaleza: 'ACREEDORA', nivel: 4, cuenta_padre: '4', acepta_movimiento: true },
  { codigo: '4.1.01.02', nombre: 'VENTAS DE MERCANCÍAS EXENTAS', tipo: 'INGRESO', naturaleza: 'ACREEDORA', nivel: 4, cuenta_padre: '4', acepta_movimiento: true },
  { codigo: '4.1.02.01', nombre: 'DEVOLUCIONES Y REBAJAS EN VENTAS', tipo: 'INGRESO', naturaleza: 'DEUDORA', nivel: 4, cuenta_padre: '4', acepta_movimiento: true },

  { codigo: '5', nombre: 'COSTOS DE VENTAS', tipo: 'COSTO', naturaleza: 'DEUDORA', nivel: 1, cuenta_padre: null, acepta_movimiento: false },
  { codigo: '5.1.01.01', nombre: 'COSTO DE MERCANCÍAS VENDIDAS', tipo: 'COSTO', naturaleza: 'DEUDORA', nivel: 4, cuenta_padre: '5', acepta_movimiento: true },

  { codigo: '6', nombre: 'GASTOS OPERATIVOS', tipo: 'GASTO', naturaleza: 'DEUDORA', nivel: 1, cuenta_padre: null, acepta_movimiento: false },
  { codigo: '6.1.01.01', nombre: 'MERMAS Y AJUSTES DE INVENTARIO', tipo: 'GASTO', naturaleza: 'DEUDORA', nivel: 4, cuenta_padre: '6', acepta_movimiento: true },

  { codigo: '7', nombre: 'OTROS INGRESOS Y EGRESOS', tipo: 'INGRESO', naturaleza: 'ACREEDORA', nivel: 1, cuenta_padre: null, acepta_movimiento: false },
  { codigo: '7.1.01.01', nombre: 'DIFERENCIAL CAMBIARIO (BCV)', tipo: 'INGRESO', naturaleza: 'ACREEDORA', nivel: 4, cuenta_padre: '7', acepta_movimiento: true }
];

const CONFIG_CONTABLE_DEFECTO = {
  moneda_funcional: 'VES',
  ejercicio_fiscal_inicio: '01-01',
  regimen_iva: 'ORDINARIO',
  agente_retencion_iva: false,
  porcentaje_retencion_iva: 75,
  cta_cxc_clientes: '1.1.02.01',
  cta_cxp_proveedores: '2.1.01.01',
  cta_iva_debito: '2.1.04.01',
  cta_iva_credito: '1.1.05.01',
  cta_igtf_percibido: '2.1.04.05',
  cta_retenciones_iva_por_pagar: '2.1.04.06',
  cta_ventas_gravadas: '4.1.01.01',
  cta_ventas_exentas: '4.1.01.02',
  cta_devoluciones_ventas: '4.1.02.01',
  cta_inventario: '1.1.04.01',
  cta_costo_ventas: '5.1.01.01',
  cta_diferencial_cambiario: '7.1.01.01',
  contabilidad_auto_asientos: true
};

function avisarContab(mensaje, tipo = 'info', duracion = 5000) {
  if (typeof notificarSistema === 'function') notificarSistema(mensaje, tipo, duracion);
  else console.log(`[CONTAB:${tipo}]`, mensaje);
}

function obtenerTenantContab() {
  return tenantActual ? (tenantActual.id || tenantActual.tenant_id || null) : null;
}

function esErrorColumnaOTablaFaltante(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = String(error.message || '');
  return (
    code === '42703' ||
    code === '42P01' ||
    code === 'PGRST204' ||
    code === 'PGRST205' ||
    /column .* does not exist|could not find the .* column|relation .* does not exist|schema cache/i.test(msg)
  );
}

// ==========================================
// 1. CAPA DE COMPATIBILIDAD DE METADATOS CONTABLES
// ==========================================

function claveMetaContableLocal(tenantId, tabla) {
  return `meta_contable_${tabla}_${tenantId}`;
}

function leerMetaContableTablaLocal(tenantId, tabla) {
  try {
    return JSON.parse(localStorage.getItem(claveMetaContableLocal(tenantId, tabla)) || '{}');
  } catch (e) {
    return {};
  }
}

function guardarMetaContableRegistroLocal(tenantId, tabla, recordId, metaObj) {
  if (!tenantId || !tabla || !recordId) return;
  try {
    const store = leerMetaContableTablaLocal(tenantId, tabla);
    store[String(recordId)] = { ...(store[String(recordId)] || {}), ...metaObj };
    localStorage.setItem(claveMetaContableLocal(tenantId, tabla), JSON.stringify(store));
    metaContableStoreCache[`${tenantId}_${tabla}`] = store;
  } catch (e) {}
}

function obtenerMetaContableRegistro(tenantId, tabla, registro) {
  if (!registro) return {};
  const id = String(registro.id || '');
  const store = metaContableStoreCache[`${tenantId}_${tabla}`] || leerMetaContableTablaLocal(tenantId, tabla);
  const metaLocal = id ? (store[id] || {}) : {};
  return { ...metaLocal, ...registro };
}

async function sincronizarMetaContableNube(tenantId, tabla) {
  if (!tenantId || !supabaseClient) return {};
  const store = leerMetaContableTablaLocal(tenantId, tabla);
  try {
    const { data, error } = await supabaseClient
      .from('audit_logs')
      .select('detalle')
      .eq('tenant_id', tenantId)
      .eq('accion', `META_CONTAB_${tabla.toUpperCase()}`)
      .order('created_at', { ascending: false })
      .limit(200);

    if (!error && Array.isArray(data)) {
      data.reverse().forEach(row => {
        try {
          const parsed = JSON.parse(row.detalle || '{}');
          if (parsed && parsed.recordId && parsed.meta) {
            store[String(parsed.recordId)] = { ...(store[String(parsed.recordId)] || {}), ...parsed.meta };
          }
        } catch (e) {}
      });
      localStorage.setItem(claveMetaContableLocal(tenantId, tabla), JSON.stringify(store));
    }
  } catch (e) {}
  metaContableStoreCache[`${tenantId}_${tabla}`] = store;
  return store;
}

/**
 * Intenta guardar en Supabase con campos base + contables extendidos.
 * Si las columnas nuevas aún no fueron migradas en PostgreSQL (42703 / PGRST204),
 * reintenta automáticamente con payloadBase y respalda los campos contables en audit_logs + localStorage.
 */
async function guardarRegistroConCompatibilidadContable(tabla, editId, tenantId, payloadBase, payloadContable = {}) {
  const payloadCompleto = { ...payloadBase, ...payloadContable };
  let res;

  if (editId) {
    res = await supabaseClient.from(tabla).update(payloadCompleto).eq('id', editId).eq('tenant_id', tenantId).select();
  } else {
    res = await supabaseClient.from(tabla).insert([payloadCompleto]).select();
  }

  let usadoRespaldo = false;
  if (res.error && esErrorColumnaOTablaFaltante(res.error)) {
    usadoRespaldo = true;
    if (editId) {
      res = await supabaseClient.from(tabla).update(payloadBase).eq('id', editId).eq('tenant_id', tenantId).select();
    } else {
      res = await supabaseClient.from(tabla).insert([payloadBase]).select();
    }
  }

  if (res.error) {
    const msg = typeof explicarErrorSupabase === 'function'
      ? explicarErrorSupabase(tabla, editId ? 'actualizar' : 'guardar', res.error)
      : res.error.message;
    return { ok: false, message: msg };
  }

  if (!res.data || res.data.length === 0) {
    return {
      ok: false,
      message: `Supabase no aplicó cambios en "${tabla}" (0 filas afectadas). Verifica políticas RLS.`
    };
  }

  const saved = res.data[0];
  if (payloadContable && Object.keys(payloadContable).length > 0) {
    guardarMetaContableRegistroLocal(tenantId, tabla, saved.id, payloadContable);
    if (usadoRespaldo) {
      try {
        await supabaseClient.from('audit_logs').insert([{
          tenant_id: tenantId,
          accion: `META_CONTAB_${tabla.toUpperCase()}`,
          detalle: JSON.stringify({ recordId: saved.id, meta: payloadContable })
        }]);
      } catch (e) {}
    }
  }

  return { ok: true, data: { ...payloadContable, ...saved }, usadoRespaldo };
}

// ==========================================
// 2. CONFIGURACIÓN CONTABLE DE LA EMPRESA
// ==========================================

function obtenerConfigContableTenant() {
  const tenantId = obtenerTenantContab();
  let localCfg = {};
  if (tenantId) {
    try {
      localCfg = JSON.parse(localStorage.getItem(`config_contable_tenant_${tenantId}`) || '{}');
    } catch (e) {}
  }
  const merged = { ...CONFIG_CONTABLE_DEFECTO, ...localCfg };
  if (tenantActual) {
    Object.keys(CONFIG_CONTABLE_DEFECTO).forEach(k => {
      if (tenantActual[k] !== undefined && tenantActual[k] !== null && tenantActual[k] !== '') {
        merged[k] = tenantActual[k];
      }
    });
  }
  return merged;
}

function pintarConfigContableEmpresaUI() {
  const cfg = obtenerConfigContableTenant();
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
  setVal('cfgContMoneda', cfg.moneda_funcional);
  setVal('cfgContRegimenIva', cfg.regimen_iva);
  setVal('cfgContEjercicioInicio', cfg.ejercicio_fiscal_inicio);
  setVal('cfgContAgenteRetencion', String(Boolean(cfg.agente_retencion_iva)));
  setVal('cfgContPctRetencion', cfg.porcentaje_retencion_iva);
  setVal('cfgContAutoAsientos', String(cfg.contabilidad_auto_asientos !== false));

  setVal('cfgCtaCxc', cfg.cta_cxc_clientes);
  setVal('cfgCtaCxp', cfg.cta_cxp_proveedores);
  setVal('cfgCtaIvaDebito', cfg.cta_iva_debito);
  setVal('cfgCtaIvaCredito', cfg.cta_iva_credito);
  setVal('cfgCtaIgtf', cfg.cta_igtf_percibido);
  setVal('cfgCtaRetIva', cfg.cta_retenciones_iva_por_pagar);
  setVal('cfgCtaVentasGravadas', cfg.cta_ventas_gravadas);
  setVal('cfgCtaVentasExentas', cfg.cta_ventas_exentas);
  setVal('cfgCtaDevoluciones', cfg.cta_devoluciones_ventas);
  setVal('cfgCtaInventario', cfg.cta_inventario);
  setVal('cfgCtaCostoVentas', cfg.cta_costo_ventas);
  setVal('cfgCtaDifCambiario', cfg.cta_diferencial_cambiario);
}

async function guardarConfigContableEmpresa() {
  const tenantId = obtenerTenantContab();
  if (!tenantId) return;

  const getVal = (id, def = '') => (document.getElementById(id)?.value ?? def).toString().trim();
  const cfg = {
    moneda_funcional: getVal('cfgContMoneda', 'VES'),
    regimen_iva: getVal('cfgContRegimenIva', 'ORDINARIO'),
    ejercicio_fiscal_inicio: getVal('cfgContEjercicioInicio', '01-01') || '01-01',
    agente_retencion_iva: getVal('cfgContAgenteRetencion', 'false') === 'true',
    porcentaje_retencion_iva: parseFloat(getVal('cfgContPctRetencion', '75')) || 75,
    contabilidad_auto_asientos: getVal('cfgContAutoAsientos', 'true') === 'true',
    cta_cxc_clientes: getVal('cfgCtaCxc', '1.1.02.01'),
    cta_cxp_proveedores: getVal('cfgCtaCxp', '2.1.01.01'),
    cta_iva_debito: getVal('cfgCtaIvaDebito', '2.1.04.01'),
    cta_iva_credito: getVal('cfgCtaIvaCredito', '1.1.05.01'),
    cta_igtf_percibido: getVal('cfgCtaIgtf', '2.1.04.05'),
    cta_retenciones_iva_por_pagar: getVal('cfgCtaRetIva', '2.1.04.06'),
    cta_ventas_gravadas: getVal('cfgCtaVentasGravadas', '4.1.01.01'),
    cta_ventas_exentas: getVal('cfgCtaVentasExentas', '4.1.01.02'),
    cta_devoluciones_ventas: getVal('cfgCtaDevoluciones', '4.1.02.01'),
    cta_inventario: getVal('cfgCtaInventario', '1.1.04.01'),
    cta_costo_ventas: getVal('cfgCtaCostoVentas', '5.1.01.01'),
    cta_diferencial_cambiario: getVal('cfgCtaDifCambiario', '7.1.01.01')
  };

  localStorage.setItem(`config_contable_tenant_${tenantId}`, JSON.stringify(cfg));
  tenantActual = { ...tenantActual, ...cfg };
  localStorage.setItem('tenant_actual', JSON.stringify(tenantActual));

  let guardadoNube = false;
  try {
    const { error } = await supabaseClient.from('tenants').update(cfg).eq('id', tenantId);
    if (!error) {
      guardadoNube = true;
    } else if (esErrorColumnaOTablaFaltante(error)) {
      await supabaseClient.from('audit_logs').insert([{
        tenant_id: tenantId,
        accion: 'CONFIG_CONTABLE_TENANT',
        detalle: JSON.stringify(cfg)
      }]);
    }
  } catch (e) {}

  avisarContab(
    guardadoNube
      ? 'Configuración contable guardada en Supabase y activa.'
      : 'Configuración contable guardada (respaldo en nube/local activo; ejecuta el SQL para columnas nativas).',
    'success',
    6000
  );
}

// ==========================================
// 3. PLAN DE CUENTAS (VEN-NIF)
// ==========================================

async function cargarPlanCuentas(forzarBaseSiVacio = true) {
  const tenantId = obtenerTenantContab();
  if (!tenantId) return [];

  let lista = [];
  let tablaNativaDisponible = false;

  try {
    const { data, error } = await supabaseClient
      .from('plan_cuentas')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('codigo', { ascending: true });

    if (!error) {
      tablaNativaDisponible = true;
      lista = data || [];
    }
  } catch (e) {}

  if (!tablaNativaDisponible) {
    try {
      const local = JSON.parse(localStorage.getItem(`plan_cuentas_${tenantId}`) || '[]');
      if (Array.isArray(local) && local.length > 0) lista = local;
    } catch (e) {}
  }

  if (lista.length === 0 && forzarBaseSiVacio) {
    lista = await inicializarPlanCuentasBase(tablaNativaDisponible);
  }

  planCuentasCache = lista.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)));
  renderizarTablaPlanCuentas();
  return planCuentasCache;
}

async function inicializarPlanCuentasBase(tablaNativaDisponible = null) {
  const tenantId = obtenerTenantContab();
  if (!tenantId) return [];

  if (tablaNativaDisponible === null) {
    try {
      const probe = await supabaseClient.from('plan_cuentas').select('id').eq('tenant_id', tenantId).limit(1);
      tablaNativaDisponible = !probe.error;
    } catch (e) {
      tablaNativaDisponible = false;
    }
  }

  const registros = PLAN_CUENTAS_VEN_NIF_BASE.map((c, idx) => ({
    id: `local-cta-${idx + 1}`,
    tenant_id: tenantId,
    codigo: c.codigo,
    nombre: c.nombre,
    tipo: c.tipo,
    naturaleza: c.naturaleza,
    nivel: c.nivel,
    cuenta_padre: c.cuenta_padre,
    acepta_movimiento: c.acepta_movimiento,
    activa: true
  }));

  if (tablaNativaDisponible) {
    const insertRows = registros.map(({ id, ...rest }) => rest);
    const { data, error } = await supabaseClient
      .from('plan_cuentas')
      .upsert(insertRows, { onConflict: 'tenant_id,codigo' })
      .select();

    if (!error && Array.isArray(data) && data.length > 0) {
      localStorage.setItem(`plan_cuentas_${tenantId}`, JSON.stringify(data));
      return data;
    }
  }

  localStorage.setItem(`plan_cuentas_${tenantId}`, JSON.stringify(registros));
  return registros;
}

function buscarNombreCuenta(codigo) {
  const cod = String(codigo || '').trim();
  if (!cod) return 'CUENTA CONTABLE';
  const match = planCuentasCache.find(c => String(c.codigo) === cod)
    || PLAN_CUENTAS_VEN_NIF_BASE.find(c => String(c.codigo) === cod);
  return match ? match.nombre : `CUENTA ${cod}`;
}

function renderizarTablaPlanCuentas() {
  const tbody = document.getElementById('tablaPlanCuentas');
  if (!tbody) return;
  const q = (document.getElementById('filtroPlanCuentas')?.value || '').trim().toUpperCase();

  const filtradas = q
    ? planCuentasCache.filter(c =>
        String(c.codigo || '').toUpperCase().includes(q) ||
        String(c.nombre || '').toUpperCase().includes(q) ||
        String(c.tipo || '').toUpperCase().includes(q)
      )
    : planCuentasCache;

  tbody.innerHTML = '';
  if (filtradas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-500">Sin cuentas contables que coincidan.</td></tr>`;
    return;
  }

  filtradas.forEach(c => {
    const movBadge = c.acepta_movimiento !== false
      ? '<span class="px-2 py-0.5 rounded text-[10px] bg-emerald-950 text-emerald-300 font-mono">AUXILIAR</span>'
      : '<span class="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400 font-mono">TÍTULO</span>';

    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/50">
        <td class="p-2.5 font-mono font-bold text-emerald-400">${esc(c.codigo)}</td>
        <td class="p-2.5 text-white ${c.acepta_movimiento === false ? 'font-bold uppercase' : ''}">${esc(c.nombre)}</td>
        <td class="p-2.5 font-mono text-xs text-slate-300">${esc(c.tipo)}</td>
        <td class="p-2.5 font-mono text-xs text-slate-400">${esc(c.naturaleza)}</td>
        <td class="p-2.5 text-center">${movBadge}</td>
        <td class="p-2.5 text-center space-x-2">
          <button type="button" onclick='editarCuentaContable("${esc(c.id || c.codigo)}")' class="text-sky-400 hover:underline font-semibold cursor-pointer">Editar</button>
          <button type="button" onclick='eliminarCuentaContable("${esc(c.id || c.codigo)}")' class="text-rose-400 hover:underline font-semibold cursor-pointer">Eliminar</button>
        </td>
      </tr>
    `;
  });
}

function editarCuentaContable(idOrCod) {
  const c = planCuentasCache.find(item => String(item.id) === String(idOrCod) || String(item.codigo) === String(idOrCod));
  if (!c) return;
  document.getElementById('editPlanCuentaId').value = c.id || '';
  document.getElementById('planCuentaCodigo').value = c.codigo || '';
  document.getElementById('planCuentaNombre').value = c.nombre || '';
  document.getElementById('planCuentaTipo').value = c.tipo || 'ACTIVO';
  document.getElementById('planCuentaNaturaleza').value = c.naturaleza || 'DEUDORA';
  document.getElementById('planCuentaMov').value = String(c.acepta_movimiento !== false);
  const btnCancel = document.getElementById('btnCancelarCuentaContab');
  if (btnCancel) btnCancel.classList.remove('hidden');
}

function limpiarFormCuentaContable() {
  document.getElementById('editPlanCuentaId').value = '';
  document.getElementById('planCuentaCodigo').value = '';
  document.getElementById('planCuentaNombre').value = '';
  document.getElementById('planCuentaTipo').value = 'ACTIVO';
  document.getElementById('planCuentaNaturaleza').value = 'DEUDORA';
  document.getElementById('planCuentaMov').value = 'true';
  const btnCancel = document.getElementById('btnCancelarCuentaContab');
  if (btnCancel) btnCancel.classList.add('hidden');
}

async function guardarCuentaContable() {
  const tenantId = obtenerTenantContab();
  if (!tenantId) return;

  const editId = document.getElementById('editPlanCuentaId')?.value || '';
  const codigo = (document.getElementById('planCuentaCodigo')?.value || '').trim().toUpperCase();
  const nombre = (document.getElementById('planCuentaNombre')?.value || '').trim().toUpperCase();
  const tipo = document.getElementById('planCuentaTipo')?.value || 'ACTIVO';
  const naturaleza = document.getElementById('planCuentaNaturaleza')?.value || 'DEUDORA';
  const acepta_movimiento = document.getElementById('planCuentaMov')?.value === 'true';

  if (!codigo || !nombre) {
    avisarContab('Ingresa Código y Nombre de la cuenta contable.', 'warning');
    return;
  }

  const partes = codigo.split('.');
  const nivel = Math.max(1, partes.length);
  const cuenta_padre = partes.length > 1 ? partes.slice(0, -1).join('.') : null;

  const payload = {
    tenant_id: tenantId,
    codigo,
    nombre,
    tipo,
    naturaleza,
    nivel,
    cuenta_padre,
    acepta_movimiento,
    activa: true
  };

  let guardadoNube = false;
  try {
    let res;
    if (editId && !String(editId).startsWith('local-')) {
      res = await supabaseClient.from('plan_cuentas').update(payload).eq('id', editId).eq('tenant_id', tenantId).select();
    } else {
      res = await supabaseClient.from('plan_cuentas').upsert([payload], { onConflict: 'tenant_id,codigo' }).select();
    }
    if (!res.error && res.data && res.data.length > 0) {
      guardadoNube = true;
    } else if (res.error && !esErrorColumnaOTablaFaltante(res.error)) {
      avisarContab(`Error al guardar cuenta: ${res.error.message}`, 'error');
      return;
    }
  } catch (e) {}

  if (!guardadoNube) {
    const idx = planCuentasCache.findIndex(c => String(c.id) === String(editId) || String(c.codigo) === codigo);
    const nuevoReg = { id: editId || `local-cta-${Date.now()}`, ...payload };
    if (idx >= 0) planCuentasCache[idx] = nuevoReg;
    else planCuentasCache.push(nuevoReg);
    localStorage.setItem(`plan_cuentas_${tenantId}`, JSON.stringify(planCuentasCache));
  }

  avisarContab(`Cuenta contable ${codigo} - ${nombre} guardada.`, 'success');
  limpiarFormCuentaContable();
  await cargarPlanCuentas(false);
}

async function eliminarCuentaContable(idOrCod) {
  const tenantId = obtenerTenantContab();
  if (!tenantId) return;
  const c = planCuentasCache.find(item => String(item.id) === String(idOrCod) || String(item.codigo) === String(idOrCod));
  if (!c) return;

  if (typeof pedirConfirmacion === 'function') {
    const ok = await pedirConfirmacion('Eliminar Cuenta Contable', `¿Eliminar la cuenta ${c.codigo} (${c.nombre}) del Plan de Cuentas?`);
    if (!ok) return;
  }

  try {
    if (c.id && !String(c.id).startsWith('local-')) {
      await supabaseClient.from('plan_cuentas').delete().eq('id', c.id).eq('tenant_id', tenantId);
    }
  } catch (e) {}

  planCuentasCache = planCuentasCache.filter(item => String(item.codigo) !== String(c.codigo));
  localStorage.setItem(`plan_cuentas_${tenantId}`, JSON.stringify(planCuentasCache));
  avisarContab(`Cuenta ${c.codigo} eliminada.`, 'success');
  renderizarTablaPlanCuentas();
}

// ==========================================
// 4. MOTOR DE ASIENTOS CONTABLES (PARTIDA DOBLE)
// ==========================================

function leerAsientosLocal(tenantId) {
  try {
    return JSON.parse(localStorage.getItem(`asientos_contables_${tenantId}`) || '[]');
  } catch (e) {
    return [];
  }
}

function guardarAsientoLocal(tenantId, asientoCompleto) {
  const lista = leerAsientosLocal(tenantId);
  const idx = lista.findIndex(a => String(a.documento_ref) === String(asientoCompleto.documento_ref) && a.origen_modulo === asientoCompleto.origen_modulo);
  if (idx >= 0) lista[idx] = asientoCompleto;
  else lista.unshift(asientoCompleto);
  localStorage.setItem(`asientos_contables_${tenantId}`, JSON.stringify(lista.slice(0, 500)));
}

function generarNumeroComprobanteContable(origenModulo = 'AS') {
  const pref = {
    VENTA_POS: 'AS-VTA',
    NOTA_CREDITO: 'AS-NC',
    NOTA_DEBITO: 'AS-ND',
    COMPRA: 'AS-COM',
    ABONO_CXC: 'AS-COB',
    RETENCION_IVA: 'AS-RET',
    AJUSTE_INV: 'AS-INV',
    MANUAL: 'AS-MAN'
  }[origenModulo] || 'AS-GEN';
  const suf = String(Date.now()).slice(-6);
  return `${pref}-${suf}`;
}

function redondear2(n) {
  return Number((Number(n) || 0).toFixed(2));
}

function cuadrarLineasPartidaDoble(lineas) {
  const limpias = (lineas || [])
    .map((l, idx) => ({
      linea: idx + 1,
      cuenta_codigo: String(l.cuenta_codigo || '').trim() || '1.1.01.01',
      cuenta_nombre: l.cuenta_nombre || buscarNombreCuenta(l.cuenta_codigo),
      centro_costo: l.centro_costo || null,
      tercero_rif: l.tercero_rif || null,
      tercero_nombre: l.tercero_nombre || null,
      descripcion: l.descripcion || '',
      debe_bs: redondear2(l.debe_bs),
      haber_bs: redondear2(l.haber_bs),
      debe_usd: Number((Number(l.debe_usd) || 0).toFixed(4)),
      haber_usd: Number((Number(l.haber_usd) || 0).toFixed(4))
    }))
    .filter(l => l.debe_bs > 0 || l.haber_bs > 0 || l.debe_usd > 0 || l.haber_usd > 0);

  if (limpias.length < 2) return { ok: false, lineas: limpias };

  const sumDebeBs = redondear2(limpias.reduce((s, l) => s + l.debe_bs, 0));
  const sumHaberBs = redondear2(limpias.reduce((s, l) => s + l.haber_bs, 0));
  const difBs = redondear2(sumDebeBs - sumHaberBs);

  // Ajuste automático de céntimo por redondeo cambiario BCV (<= 0.05 Bs)
  if (Math.abs(difBs) > 0 && Math.abs(difBs) <= 0.05) {
    const ultimaHaber = [...limpias].reverse().find(l => l.haber_bs > 0);
    if (ultimaHaber) ultimaHaber.haber_bs = redondear2(ultimaHaber.haber_bs + difBs);
  }

  const totalDebeBs = redondear2(limpias.reduce((s, l) => s + l.debe_bs, 0));
  const totalHaberBs = redondear2(limpias.reduce((s, l) => s + l.haber_bs, 0));
  const totalDebeUsd = Number(limpias.reduce((s, l) => s + l.debe_usd, 0).toFixed(2));
  const totalHaberUsd = Number(limpias.reduce((s, l) => s + l.haber_usd, 0).toFixed(2));

  return {
    ok: Math.abs(totalDebeBs - totalHaberBs) <= 0.05,
    lineas: limpias,
    totalDebeBs,
    totalHaberBs,
    totalDebeUsd,
    totalHaberUsd
  };
}

async function registrarAsientoContable({ origenModulo, documentoOrigenId = null, documentoRef, fecha, descripcion, moneda = 'VES', tasaBcv = 1, lineas = [] }) {
  const tenantId = obtenerTenantContab();
  if (!tenantId) return null;

  if (planCuentasCache.length === 0) {
    await cargarPlanCuentas(true);
  }

  const fechaIso = (fecha || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const periodo = fechaIso.slice(0, 7);
  const cuadre = cuadrarLineasPartidaDoble(lineas);
  if (!cuadre.ok) {
    console.warn('Asiento contable no cuadrado o vacío:', documentoRef, cuadre);
    return null;
  }

  const numeroComp = generarNumeroComprobanteContable(origenModulo);
  const cabPayload = {
    tenant_id: tenantId,
    numero_comprobante: numeroComp,
    fecha: fechaIso,
    periodo_contable: periodo,
    origen_modulo: origenModulo,
    documento_origen_id: documentoOrigenId ? String(documentoOrigenId) : null,
    documento_ref: documentoRef,
    descripcion,
    moneda,
    tasa_bcv: Number(tasaBcv || 1),
    total_debe_bs: cuadre.totalDebeBs,
    total_haber_bs: cuadre.totalHaberBs,
    total_debe_usd: cuadre.totalDebeUsd,
    total_haber_usd: cuadre.totalHaberUsd,
    estado: 'CONTABILIZADO',
    exportado_erp: false
  };

  let asientoGuardado = null;
  let tablaNativaOk = false;

  try {
    const resCab = await supabaseClient.from('asientos_contables').insert([cabPayload]).select();
    if (!resCab.error && resCab.data && resCab.data.length > 0) {
      tablaNativaOk = true;
      asientoGuardado = resCab.data[0];
      const detPayload = cuadre.lineas.map(l => ({
        asiento_id: asientoGuardado.id,
        tenant_id: tenantId,
        ...l
      }));
      await supabaseClient.from('asientos_detalle').insert(detPayload);
      if (documentoOrigenId && (origenModulo === 'VENTA_POS' || origenModulo === 'NOTA_CREDITO' || origenModulo === 'NOTA_DEBITO')) {
        try {
          await supabaseClient.from('invoices').update({ contabilizado: true, asiento_contable_id: asientoGuardado.id }).eq('id', documentoOrigenId).eq('tenant_id', tenantId);
        } catch (e) {}
      }
    }
  } catch (e) {}

  const registroCompleto = {
    id: asientoGuardado?.id || `local-as-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    ...cabPayload,
    created_at: asientoGuardado?.created_at || new Date().toISOString(),
    detalle: cuadre.lineas
  };

  guardarAsientoLocal(tenantId, registroCompleto);

  if (!tablaNativaOk) {
    try {
      await supabaseClient.from('audit_logs').insert([{
        tenant_id: tenantId,
        accion: 'CONTAB_ASIENTO',
        detalle: JSON.stringify(registroCompleto)
      }]);
    } catch (e) {}
  }

  return registroCompleto;
}

/**
 * Asiento automático de Factura de Venta POS (Ingresos + IVA Débito + IGTF + CxC/Caja + Costo de Ventas/Inventario)
 */
async function registrarAsientoAutomaticoVenta(invDoc, carritoItems = [], meta = {}) {
  const cfg = obtenerConfigContableTenant();
  if (cfg.contabilidad_auto_asientos === false) return null;

  const tasa = Number(invDoc.tasa_bcv || 1);
  const totalBs = redondear2(invDoc.total_bs);
  const ivaBs = redondear2(invDoc.iva_bs);
  const igtfBs = redondear2(invDoc.igtf_bs);
  const cc = meta.centroCosto || null;
  const esCredito = String(meta.condicionPago || invDoc.metodo_pago || '').toUpperCase().includes('CRÉDITO')
    || String(meta.condicionPago || invDoc.metodo_pago || '').toUpperCase().includes('CREDITO');

  const ctaTes = esCredito
    ? (meta.clienteCuentaContable || cfg.cta_cxc_clientes)
    : (meta.viaPagoCuentaContable || (String(meta.moneda || '').toUpperCase() === 'USD' ? '1.1.01.03' : '1.1.01.02'));

  const lineas = [
    {
      cuenta_codigo: ctaTes,
      cuenta_nombre: buscarNombreCuenta(ctaTes),
      centro_costo: cc,
      tercero_rif: invDoc.cliente_rif,
      tercero_nombre: invDoc.cliente_nombre,
      descripcion: `${esCredito ? 'CxC' : 'Cobro'} ${invDoc.factura_nro} (${meta.metodoPago || invDoc.metodo_pago || 'POS'})`,
      debe_bs: totalBs,
      haber_bs: 0,
      debe_usd: totalBs / tasa,
      haber_usd: 0
    }
  ];

  // Agrupar ingresos por cuenta (gravadas vs exentas o por producto)
  const ingresosPorCuenta = {};
  let costoTotalUsd = 0;

  (carritoItems || []).forEach(it => {
    const subUsd = Number(it.precio || 0) * Number(it.cantidad || 0);
    const subBs = redondear2(subUsd * tasa);
    const esEx = Boolean(it.esExento) || Number(it.ivaPorcentaje) === 0;
    const ctaIng = it.cuentaIngreso || (esEx ? cfg.cta_ventas_exentas : cfg.cta_ventas_gravadas);
    ingresosPorCuenta[ctaIng] = (ingresosPorCuenta[ctaIng] || 0) + subBs;
    if (it.manejaInventario !== false && Number(it.costoUnitarioUsd || 0) > 0) {
      costoTotalUsd += Number(it.costoUnitarioUsd) * Number(it.cantidad || 0);
    }
  });

  // Fallback si no hay detalle
  if (Object.keys(ingresosPorCuenta).length === 0) {
    const netoBs = redondear2(totalBs - ivaBs - igtfBs);
    ingresosPorCuenta[cfg.cta_ventas_gravadas] = netoBs;
  }

  Object.entries(ingresosPorCuenta).forEach(([cta, montoBs]) => {
    const mBs = redondear2(montoBs);
    if (mBs <= 0) return;
    lineas.push({
      cuenta_codigo: cta,
      cuenta_nombre: buscarNombreCuenta(cta),
      centro_costo: cc,
      tercero_rif: invDoc.cliente_rif,
      tercero_nombre: invDoc.cliente_nombre,
      descripcion: `Ingreso Factura ${invDoc.factura_nro}`,
      debe_bs: 0,
      haber_bs: mBs,
      debe_usd: 0,
      haber_usd: mBs / tasa
    });
  });

  if (ivaBs > 0) {
    lineas.push({
      cuenta_codigo: cfg.cta_iva_debito,
      cuenta_nombre: buscarNombreCuenta(cfg.cta_iva_debito),
      centro_costo: cc,
      tercero_rif: invDoc.cliente_rif,
      tercero_nombre: invDoc.cliente_nombre,
      descripcion: `IVA Débito Fiscal ${invDoc.factura_nro}`,
      debe_bs: 0,
      haber_bs: ivaBs,
      debe_usd: 0,
      haber_usd: ivaBs / tasa
    });
  }

  if (igtfBs > 0) {
    lineas.push({
      cuenta_codigo: cfg.cta_igtf_percibido,
      cuenta_nombre: buscarNombreCuenta(cfg.cta_igtf_percibido),
      centro_costo: cc,
      tercero_rif: invDoc.cliente_rif,
      tercero_nombre: invDoc.cliente_nombre,
      descripcion: `IGTF 3% Percibido ${invDoc.factura_nro}`,
      debe_bs: 0,
      haber_bs: igtfBs,
      debe_usd: 0,
      haber_usd: igtfBs / tasa
    });
  }

  // Costo de Ventas Perpetuo (Debe Costo / Haber Inventario)
  const costoBs = redondear2(costoTotalUsd * tasa);
  if (costoBs > 0) {
    lineas.push(
      {
        cuenta_codigo: cfg.cta_costo_ventas,
        cuenta_nombre: buscarNombreCuenta(cfg.cta_costo_ventas),
        centro_costo: cc,
        tercero_rif: invDoc.cliente_rif,
        tercero_nombre: invDoc.cliente_nombre,
        descripcion: `Costo de Venta ${invDoc.factura_nro}`,
        debe_bs: costoBs,
        haber_bs: 0,
        debe_usd: costoTotalUsd,
        haber_usd: 0
      },
      {
        cuenta_codigo: cfg.cta_inventario,
        cuenta_nombre: buscarNombreCuenta(cfg.cta_inventario),
        centro_costo: cc,
        tercero_rif: invDoc.cliente_rif,
        tercero_nombre: invDoc.cliente_nombre,
        descripcion: `Salida Inventario ${invDoc.factura_nro}`,
        debe_bs: 0,
        haber_bs: costoBs,
        debe_usd: 0,
        haber_usd: costoTotalUsd
      }
    );
  }

  return await registrarAsientoContable({
    origenModulo: 'VENTA_POS',
    documentoOrigenId: invDoc.id,
    documentoRef: invDoc.factura_nro,
    fecha: meta.fechaEmision || (invDoc.created_at ? invDoc.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10)),
    descripcion: `Venta Fiscal ${invDoc.factura_nro} - ${invDoc.cliente_nombre}`,
    moneda: meta.moneda || 'USD',
    tasaBcv: tasa,
    lineas
  });
}

/**
 * Asiento automático de Nota de Crédito / Débito (Financiera o por Devolución)
 */
async function registrarAsientoAutomaticoNota(notaDoc, tipoNota, modalidad, items = [], meta = {}) {
  const cfg = obtenerConfigContableTenant();
  if (cfg.contabilidad_auto_asientos === false) return null;

  const tasa = Number(notaDoc.tasa_bcv || 1);
  const totalBs = redondear2(notaDoc.total_bs);
  const ivaBs = redondear2(notaDoc.iva_bs);
  const netoBs = redondear2(totalBs - ivaBs);
  const esNC = tipoNota === 'NOTA CREDITO';
  const esCreditoCli = String(meta.condicionPago || '').toUpperCase().includes('CRÉDITO')
    || String(meta.condicionPago || '').toUpperCase().includes('CREDITO');
  const ctaCli = esCreditoCli ? cfg.cta_cxc_clientes : '1.1.01.02';

  const lineas = [];
  if (esNC) {
    // Nota de Crédito: Débito Devoluciones/Rebajas + Débito IVA Débito Fiscal -> Crédito CxC/Caja
    if (netoBs > 0) {
      lineas.push({
        cuenta_codigo: cfg.cta_devoluciones_ventas,
        cuenta_nombre: buscarNombreCuenta(cfg.cta_devoluciones_ventas),
        tercero_rif: notaDoc.cliente_rif,
        tercero_nombre: notaDoc.cliente_nombre,
        descripcion: `Devolución/Rebaja ${notaDoc.factura_nro} (Ref ${meta.facturaAfectadaNro || ''})`,
        debe_bs: netoBs,
        haber_bs: 0,
        debe_usd: netoBs / tasa,
        haber_usd: 0
      });
    }
    if (ivaBs > 0) {
      lineas.push({
        cuenta_codigo: cfg.cta_iva_debito,
        cuenta_nombre: buscarNombreCuenta(cfg.cta_iva_debito),
        tercero_rif: notaDoc.cliente_rif,
        tercero_nombre: notaDoc.cliente_nombre,
        descripcion: `Reverso IVA Débito ${notaDoc.factura_nro}`,
        debe_bs: ivaBs,
        haber_bs: 0,
        debe_usd: ivaBs / tasa,
        haber_usd: 0
      });
    }
    lineas.push({
      cuenta_codigo: ctaCli,
      cuenta_nombre: buscarNombreCuenta(ctaCli),
      tercero_rif: notaDoc.cliente_rif,
      tercero_nombre: notaDoc.cliente_nombre,
      descripcion: `Aplicación NC ${notaDoc.factura_nro}`,
      debe_bs: 0,
      haber_bs: totalBs,
      debe_usd: 0,
      haber_usd: totalBs / tasa
    });
  } else {
    // Nota de Débito: Débito CxC/Caja -> Crédito Ventas + IVA Débito Fiscal
    lineas.push({
      cuenta_codigo: ctaCli,
      cuenta_nombre: buscarNombreCuenta(ctaCli),
      tercero_rif: notaDoc.cliente_rif,
      tercero_nombre: notaDoc.cliente_nombre,
      descripcion: `Cargo ND ${notaDoc.factura_nro} (Ref ${meta.facturaAfectadaNro || ''})`,
      debe_bs: totalBs,
      haber_bs: 0,
      debe_usd: totalBs / tasa,
      haber_usd: 0
    });
    if (netoBs > 0) {
      lineas.push({
        cuenta_codigo: cfg.cta_ventas_gravadas,
        cuenta_nombre: buscarNombreCuenta(cfg.cta_ventas_gravadas),
        tercero_rif: notaDoc.cliente_rif,
        tercero_nombre: notaDoc.cliente_nombre,
        descripcion: `Nota de Débito ${notaDoc.factura_nro}`,
        debe_bs: 0,
        haber_bs: netoBs,
        debe_usd: 0,
        haber_usd: netoBs / tasa
      });
    }
    if (ivaBs > 0) {
      lineas.push({
        cuenta_codigo: cfg.cta_iva_debito,
        cuenta_nombre: buscarNombreCuenta(cfg.cta_iva_debito),
        tercero_rif: notaDoc.cliente_rif,
        tercero_nombre: notaDoc.cliente_nombre,
        descripcion: `IVA Débito ND ${notaDoc.factura_nro}`,
        debe_bs: 0,
        haber_bs: ivaBs,
        debe_usd: 0,
        haber_usd: ivaBs / tasa
      });
    }
  }

  return await registrarAsientoContable({
    origenModulo: esNC ? 'NOTA_CREDITO' : 'NOTA_DEBITO',
    documentoOrigenId: notaDoc.id,
    documentoRef: notaDoc.factura_nro,
    fecha: meta.fechaEmision || new Date().toISOString().slice(0, 10),
    descripcion: `${esNC ? 'Nota de Crédito' : 'Nota de Débito'} (${modalidad}) ${notaDoc.factura_nro} - ${notaDoc.cliente_nombre}`,
    moneda: meta.moneda || 'USD',
    tasaBcv: tasa,
    lineas
  });
}

/**
 * Asiento automático de Compra de Inventario
 */
async function registrarAsientoAutomaticoCompra({ docNro, nroFactura, fecha, tasaBcv, proveedorRif, proveedorNombre, proveedorCuenta, baseGravadaUsd, montoExentoUsd, ivaUsd }) {
  const cfg = obtenerConfigContableTenant();
  if (cfg.contabilidad_auto_asientos === false) return null;

  const tasa = Number(tasaBcv || 1);
  const invBs = redondear2((Number(baseGravadaUsd || 0) + Number(montoExentoUsd || 0)) * tasa);
  const ivaBs = redondear2(Number(ivaUsd || 0) * tasa);
  const totalBs = redondear2(invBs + ivaBs);
  const ctaProv = proveedorCuenta || cfg.cta_cxp_proveedores;

  const lineas = [
    {
      cuenta_codigo: cfg.cta_inventario,
      cuenta_nombre: buscarNombreCuenta(cfg.cta_inventario),
      tercero_rif: proveedorRif,
      tercero_nombre: proveedorNombre,
      descripcion: `Ingreso Inventario ${docNro} (FAC ${nroFactura})`,
      debe_bs: invBs,
      haber_bs: 0,
      debe_usd: Number(baseGravadaUsd || 0) + Number(montoExentoUsd || 0),
      haber_usd: 0
    }
  ];
  if (ivaBs > 0) {
    lineas.push({
      cuenta_codigo: cfg.cta_iva_credito,
      cuenta_nombre: buscarNombreCuenta(cfg.cta_iva_credito),
      tercero_rif: proveedorRif,
      tercero_nombre: proveedorNombre,
      descripcion: `IVA Crédito Fiscal FAC ${nroFactura}`,
      debe_bs: ivaBs,
      haber_bs: 0,
      debe_usd: Number(ivaUsd || 0),
      haber_usd: 0
    });
  }
  lineas.push({
    cuenta_codigo: ctaProv,
    cuenta_nombre: buscarNombreCuenta(ctaProv),
    tercero_rif: proveedorRif,
    tercero_nombre: proveedorNombre,
    descripcion: `CxP Proveedor FAC ${nroFactura}`,
    debe_bs: 0,
    haber_bs: totalBs,
    debe_usd: 0,
    haber_usd: totalBs / tasa
  });

  return await registrarAsientoContable({
    origenModulo: 'COMPRA',
    documentoRef: `${docNro} | FAC:${nroFactura}`,
    fecha,
    descripcion: `Compra ${docNro} - ${proveedorNombre} (FAC ${nroFactura})`,
    moneda: 'USD',
    tasaBcv: tasa,
    lineas
  });
}

/**
 * Asiento automático de Abono a Cuentas por Cobrar
 */
async function registrarAsientoAutomaticoAbonoCxc({ invoiceId, facturaNro, clienteRif, clienteNombre, montoUsd, tasaBcv, fecha }) {
  const cfg = obtenerConfigContableTenant();
  if (cfg.contabilidad_auto_asientos === false) return null;
  const tasa = Number(tasaBcv || 1);
  const montoBs = redondear2(Number(montoUsd || 0) * tasa);

  return await registrarAsientoContable({
    origenModulo: 'ABONO_CXC',
    documentoOrigenId: invoiceId,
    documentoRef: `ABONO-${facturaNro}`,
    fecha: (fecha || new Date().toISOString()).slice(0, 10),
    descripcion: `Cobro / Abono CxC Factura ${facturaNro} - ${clienteNombre}`,
    moneda: 'USD',
    tasaBcv: tasa,
    lineas: [
      {
        cuenta_codigo: '1.1.01.02',
        cuenta_nombre: buscarNombreCuenta('1.1.01.02'),
        tercero_rif: clienteRif,
        tercero_nombre: clienteNombre,
        descripcion: `Ingreso Cobranza ${facturaNro}`,
        debe_bs: montoBs,
        haber_bs: 0,
        debe_usd: Number(montoUsd || 0),
        haber_usd: 0
      },
      {
        cuenta_codigo: cfg.cta_cxc_clientes,
        cuenta_nombre: buscarNombreCuenta(cfg.cta_cxc_clientes),
        tercero_rif: clienteRif,
        tercero_nombre: clienteNombre,
        descripcion: `Cancelación Parcial/Total CxC ${facturaNro}`,
        debe_bs: 0,
        haber_bs: montoBs,
        debe_usd: 0,
        haber_usd: Number(montoUsd || 0)
      }
    ]
  });
}

/**
 * Asiento automático de Retención de IVA (SENIAT)
 */
async function registrarAsientoAutomaticoRetencion({ nroComprobante, facturaRef, sujetoRif, sujetoNombre, ivaRetenidoBs, tasaBcv, fecha }) {
  const cfg = obtenerConfigContableTenant();
  if (cfg.contabilidad_auto_asientos === false) return null;
  const tasa = Number(tasaBcv || 1);
  const retBs = redondear2(ivaRetenidoBs);

  return await registrarAsientoContable({
    origenModulo: 'RETENCION_IVA',
    documentoRef: nroComprobante,
    fecha: fecha || new Date().toISOString().slice(0, 10),
    descripcion: `Retención IVA ${nroComprobante} sobre FAC ${facturaRef}`,
    moneda: 'VES',
    tasaBcv: tasa,
    lineas: [
      {
        cuenta_codigo: cfg.cta_cxp_proveedores,
        cuenta_nombre: buscarNombreCuenta(cfg.cta_cxp_proveedores),
        tercero_rif: sujetoRif || 'N/A',
        tercero_nombre: sujetoNombre || 'PROVEEDOR',
        descripcion: `Aplicación Retención IVA ${nroComprobante}`,
        debe_bs: retBs,
        haber_bs: 0,
        debe_usd: retBs / tasa,
        haber_usd: 0
      },
      {
        cuenta_codigo: cfg.cta_retenciones_iva_por_pagar,
        cuenta_nombre: buscarNombreCuenta(cfg.cta_retenciones_iva_por_pagar),
        tercero_rif: sujetoRif || 'N/A',
        tercero_nombre: sujetoNombre || 'SENIAT',
        descripcion: `Retención IVA por Enterar ${nroComprobante}`,
        debe_bs: 0,
        haber_bs: retBs,
        debe_usd: 0,
        haber_usd: retBs / tasa
      }
    ]
  });
}

// ==========================================
// 5. CONSULTA DE LIBRO DIARIO, SINCRONIZACIÓN Y EXPORTACIÓN ERP
// ==========================================

async function cargarModuloContabilidad() {
  const tenantId = obtenerTenantContab();
  if (!tenantId) return;

  pintarConfigContableEmpresaUI();

  const elPer = document.getElementById('contabFiltroPeriodo');
  if (elPer && !elPer.value) {
    elPer.value = new Date().toISOString().slice(0, 7);
  }

  await Promise.all([
    cargarPlanCuentas(true),
    cargarAsientosContables(),
    verificarEstadoEsquemaContable()
  ]);
}

async function verificarEstadoEsquemaContable() {
  const elBadge = document.getElementById('contabEstadoEsquemaBadge');
  if (!elBadge || !supabaseClient) return;
  try {
    const [p1, p2] = await Promise.all([
      supabaseClient.from('plan_cuentas').select('id').limit(1),
      supabaseClient.from('asientos_contables').select('id').limit(1)
    ]);
    if (!p1.error && !p2.error) {
      elBadge.className = 'px-3 py-1 rounded-lg text-[11px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-700/50';
      elBadge.textContent = 'BD Contable Supabase: ACTIVA (Tablas Nativas)';
    } else {
      elBadge.className = 'px-3 py-1 rounded-lg text-[11px] font-mono font-bold bg-amber-950 text-amber-300 border border-amber-700/50';
      elBadge.textContent = 'Modo Respaldo Activo · Ejecuta el .SQL en Supabase';
    }
  } catch (e) {}
}

async function cargarAsientosContables() {
  const tenantId = obtenerTenantContab();
  if (!tenantId) return;

  const mapa = new Map();

  // 1. Leer de tabla nativa `asientos_contables` + `asientos_detalle` si existe
  try {
    const { data: cabs, error } = await supabaseClient
      .from('asientos_contables')
      .select('*, asientos_detalle(*)')
      .eq('tenant_id', tenantId)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200);

    if (!error && Array.isArray(cabs)) {
      cabs.forEach(c => {
        const det = Array.isArray(c.asientos_detalle) ? c.asientos_detalle.sort((a, b) => a.linea - b.linea) : [];
        mapa.set(`${c.origen_modulo}:${c.documento_ref}`, { ...c, detalle: det });
      });
    }
  } catch (e) {}

  // 2. Leer respaldo en `audit_logs`
  try {
    const { data: logs, error } = await supabaseClient
      .from('audit_logs')
      .select('detalle')
      .eq('tenant_id', tenantId)
      .eq('accion', 'CONTAB_ASIENTO')
      .order('created_at', { ascending: false })
      .limit(200);

    if (!error && Array.isArray(logs)) {
      logs.forEach(l => {
        try {
          const parsed = JSON.parse(l.detalle || '{}');
          const key = `${parsed.origen_modulo}:${parsed.documento_ref}`;
          if (parsed.documento_ref && !mapa.has(key)) mapa.set(key, parsed);
        } catch (e) {}
      });
    }
  } catch (e) {}

  // 3. Leer cache local
  leerAsientosLocal(tenantId).forEach(a => {
    const key = `${a.origen_modulo}:${a.documento_ref}`;
    if (a.documento_ref && !mapa.has(key)) mapa.set(key, a);
  });

  asientosContablesCache = Array.from(mapa.values()).sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
  renderizarLibroDiario();
}

function renderizarLibroDiario() {
  const tbody = document.getElementById('tablaAsientosContables');
  if (!tbody) return;

  const periodo = document.getElementById('contabFiltroPeriodo')?.value || '';
  const origen = document.getElementById('contabFiltroOrigen')?.value || '';

  const filtrados = asientosContablesCache.filter(a => {
    const mPer = !periodo || String(a.periodo_contable || a.fecha || '').startsWith(periodo);
    const mOri = !origen || String(a.origen_modulo) === origen;
    return mPer && mOri;
  });

  const totDebeBs = filtrados.reduce((s, a) => s + Number(a.total_debe_bs || 0), 0);
  const totHaberBs = filtrados.reduce((s, a) => s + Number(a.total_haber_bs || 0), 0);
  const totDebeUsd = filtrados.reduce((s, a) => s + Number(a.total_debe_usd || 0), 0);

  const elCount = document.getElementById('contabKpiAsientos');
  const elDebe = document.getElementById('contabKpiDebeBs');
  const elHaber = document.getElementById('contabKpiHaberBs');
  const elUsd = document.getElementById('contabKpiTotalUsd');
  if (elCount) elCount.textContent = String(filtrados.length);
  if (elDebe) elDebe.textContent = `Bs. ${totDebeBs.toFixed(2)}`;
  if (elHaber) elHaber.textContent = `Bs. ${totHaberBs.toFixed(2)}`;
  if (elUsd) elUsd.textContent = `$ ${totDebeUsd.toFixed(2)}`;

  tbody.innerHTML = '';
  if (filtrados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-5 text-center text-slate-500">Sin asientos contables para el período seleccionado. Pulsa "Sincronizar Documentos" para contabilizar ventas/compras previas.</td></tr>`;
    return;
  }

  filtrados.forEach((a, idx) => {
    const detRows = (a.detalle || []).map(d => `
      <tr class="bg-slate-950/70 text-[11px] border-b border-slate-800/40">
        <td class="py-1.5 px-3 font-mono text-emerald-400">${esc(d.cuenta_codigo)}</td>
        <td class="py-1.5 px-3 text-slate-300">${esc(d.cuenta_nombre)} <span class="text-slate-500">· ${esc(d.descripcion || '')}</span></td>
        <td class="py-1.5 px-3 font-mono text-slate-400">${esc(d.tercero_rif || '--')}</td>
        <td class="py-1.5 px-3 text-right font-mono tabular-nums text-slate-200">${Number(d.debe_bs) > 0 ? 'Bs. ' + Number(d.debe_bs).toFixed(2) : ''}</td>
        <td class="py-1.5 px-3 text-right font-mono tabular-nums text-slate-200">${Number(d.haber_bs) > 0 ? 'Bs. ' + Number(d.haber_bs).toFixed(2) : ''}</td>
        <td class="py-1.5 px-3 text-right font-mono tabular-nums text-slate-400">$ ${Number(d.debe_usd || d.haber_usd || 0).toFixed(2)}</td>
      </tr>
    `).join('');

    tbody.innerHTML += `
      <tr class="bg-slate-900/90 hover:bg-slate-900 border-b border-slate-800">
        <td class="p-3 font-mono font-bold text-white">${esc(a.numero_comprobante)}<div class="text-[10px] text-slate-400">${esc(a.fecha)}</div></td>
        <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950 text-emerald-300">${esc(a.origen_modulo)}</span><div class="text-[11px] text-slate-300 mt-0.5">${esc(a.descripcion)}</div></td>
        <td class="p-3 font-mono text-xs text-slate-300">${esc(a.documento_ref || 'N/A')}</td>
        <td class="p-3 text-right font-mono font-bold text-emerald-400 tabular-nums">Bs. ${Number(a.total_debe_bs || 0).toFixed(2)}</td>
        <td class="p-3 text-right font-mono font-bold text-emerald-400 tabular-nums">Bs. ${Number(a.total_haber_bs || 0).toFixed(2)}</td>
        <td class="p-3 text-center">
          <button type="button" onclick="document.getElementById('detAsiento_${idx}').classList.toggle('hidden')" class="text-sky-400 hover:underline text-xs font-semibold cursor-pointer">Ver Partidas (${(a.detalle || []).length})</button>
        </td>
      </tr>
      <tr id="detAsiento_${idx}" class="hidden">
        <td colspan="6" class="p-2 bg-slate-950">
          <table class="w-full text-left border border-slate-800 rounded-lg overflow-hidden">
            <thead class="bg-slate-900 text-[10px] font-mono text-slate-400 uppercase">
              <tr><th class="py-1 px-3">Cuenta</th><th class="py-1 px-3">Nombre / Concepto</th><th class="py-1 px-3">RIF Tercero</th><th class="py-1 px-3 text-right">Debe (Bs.)</th><th class="py-1 px-3 text-right">Haber (Bs.)</th><th class="py-1 px-3 text-right">Ref. ($)</th></tr>
            </thead>
            <tbody>${detRows}</tbody>
          </table>
        </td>
      </tr>
    `;
  });
}

async function sincronizarAsientosHistoricos() {
  const tenantId = obtenerTenantContab();
  if (!tenantId) return;

  await cargarPlanCuentas(true);
  await cargarAsientosContables();

  const { data: invoices } = await supabaseClient
    .from('invoices')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(100);

  let generados = 0;
  for (const inv of (invoices || [])) {
    const est = String(inv.estado || '').toUpperCase();
    const nro = String(inv.factura_nro || '');
    if (est === 'ANULADA' || est === 'REVERSO' || nro.startsWith('REV-')) continue;

    const modulo = nro.startsWith('NC') ? 'NOTA_CREDITO' : (nro.startsWith('ND') ? 'NOTA_DEBITO' : 'VENTA_POS');
    const yaExiste = asientosContablesCache.some(a => a.origen_modulo === modulo && String(a.documento_ref) === nro);
    if (yaExiste) continue;

    const meta = typeof obtenerMetaFacturaLocal === 'function' ? (obtenerMetaFacturaLocal(tenantId, inv) || {}) : {};
    if (modulo === 'VENTA_POS') {
      await registrarAsientoAutomaticoVenta(inv, meta.itemsMeta || [], meta);
    } else {
      await registrarAsientoAutomaticoNota(inv, modulo === 'NOTA_CREDITO' ? 'NOTA CREDITO' : 'NOTA DEBITO', meta.modalidad || 'FINANCIERA', meta.itemsMeta || [], meta);
    }
    generados += 1;
  }

  await cargarAsientosContables();
  avisarContab(
    generados > 0
      ? `Sincronización completada: ${generados} asiento(s) contable(s) generado(s) con partida doble.`
      : 'Todos los comprobantes fiscales recientes ya están contabilizados.',
    generados > 0 ? 'success' : 'info',
    6000
  );
}

function exportarLibroDiarioExcel() {
  if (typeof XLSX === 'undefined') { avisarContab('SheetJS no disponible.', 'error'); return; }
  if (!asientosContablesCache.length) { avisarContab('No hay asientos contables para exportar.', 'warning'); return; }

  const filas = [
    ['EMPRESA:', tenantActual?.razon_social || '', 'RIF:', tenantActual?.rif || ''],
    [],
    ['Comprobante', 'Fecha', 'Período', 'Origen', 'Documento Ref.', 'Línea', 'Cuenta Código', 'Cuenta Nombre', 'RIF Tercero', 'Tercero', 'Descripción', 'Debe (Bs.)', 'Haber (Bs.)', 'Debe ($)', 'Haber ($)', 'Tasa BCV']
  ];

  asientosContablesCache.forEach(a => {
    (a.detalle || []).forEach(d => {
      filas.push([
        a.numero_comprobante,
        a.fecha,
        a.periodo_contable,
        a.origen_modulo,
        a.documento_ref || '',
        d.linea,
        d.cuenta_codigo,
        d.cuenta_nombre,
        d.tercero_rif || '',
        d.tercero_nombre || '',
        d.descripcion || a.descripcion || '',
        Number(d.debe_bs || 0),
        Number(d.haber_bs || 0),
        Number(d.debe_usd || 0),
        Number(d.haber_usd || 0),
        Number(a.tasa_bcv || 1)
      ]);
    });
  });

  if (typeof descargarExcelMatriz === 'function') {
    descargarExcelMatriz(filas, 'Libro_Diario_Asientos_VEN_NIF', 'LibroDiario');
  }
  avisarContab('Libro Diario contable exportado en Excel.', 'success');
}

function exportarBalanceComprobacionExcel() {
  if (typeof XLSX === 'undefined') { avisarContab('SheetJS no disponible.', 'error'); return; }
  if (!asientosContablesCache.length) { avisarContab('No hay movimientos contabilizados.', 'warning'); return; }

  const sumas = {};
  asientosContablesCache.forEach(a => {
    (a.detalle || []).forEach(d => {
      const cod = String(d.cuenta_codigo || '');
      if (!sumas[cod]) {
        sumas[cod] = { codigo: cod, nombre: d.cuenta_nombre || buscarNombreCuenta(cod), debeBs: 0, haberBs: 0, debeUsd: 0, haberUsd: 0 };
      }
      sumas[cod].debeBs += Number(d.debe_bs || 0);
      sumas[cod].haberBs += Number(d.haber_bs || 0);
      sumas[cod].debeUsd += Number(d.debe_usd || 0);
      sumas[cod].haberUsd += Number(d.haber_usd || 0);
    });
  });

  const filas = [
    ['EMPRESA:', tenantActual?.razon_social || '', 'RIF:', tenantActual?.rif || ''],
    ['REPORTE:', 'BALANCE DE COMPROBACIÓN DE SUMAS Y SALDOS'],
    [],
    ['Código Cuenta', 'Nombre de Cuenta', 'Sumas Debe (Bs.)', 'Sumas Haber (Bs.)', 'Saldo Deudor (Bs.)', 'Saldo Acreedor (Bs.)', 'Saldo Neto ($ USD)']
  ];

  Object.values(sumas).sort((a, b) => a.codigo.localeCompare(b.codigo)).forEach(c => {
    const difBs = c.debeBs - c.haberBs;
    const difUsd = c.debeUsd - c.haberUsd;
    filas.push([
      c.codigo,
      c.nombre,
      redondear2(c.debeBs),
      redondear2(c.haberBs),
      difBs > 0 ? redondear2(difBs) : 0,
      difBs < 0 ? redondear2(Math.abs(difBs)) : 0,
      redondear2(difUsd)
    ]);
  });

  if (typeof descargarExcelMatriz === 'function') {
    descargarExcelMatriz(filas, 'Balance_Comprobacion_VEN_NIF', 'BalanceComprobacion');
  }
  avisarContab('Balance de Comprobación exportado a Excel.', 'success');
}

function exportarPaqueteIntegracionJson() {
  const payload = {
    schemaVersion: '1.0-VEN-NIF-SENIAT',
    generatedAt: new Date().toISOString(),
    empresa: {
      id: tenantActual?.id,
      razonSocial: tenantActual?.razon_social,
      rif: tenantActual?.rif,
      configContable: obtenerConfigContableTenant()
    },
    planCuentas: planCuentasCache,
    asientosContables: asientosContablesCache
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Integracion_Contable_${(tenantActual?.rif || 'ERP')}_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  avisarContab('Paquete JSON estándar para ERP contable descargado.', 'success');
}

async function descargarScriptSqlMigracion() {
  try {
    const res = await fetch('/sql/migracion_contabilidad_seniat.sql');
    const sqlText = await res.text();
    const blob = new Blob([sqlText], { type: 'text/sql;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'migracion_contabilidad_seniat.sql';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    avisarContab('Script migracion_contabilidad_seniat.sql descargado. Ejecútalo en Supabase SQL Editor.', 'success', 7000);
  } catch (e) {
    avisarContab('No se pudo descargar el script SQL.', 'error');
  }
}

async function copiarScriptSqlMigracion() {
  try {
    const res = await fetch('/sql/migracion_contabilidad_seniat.sql');
    const sqlText = await res.text();
    await navigator.clipboard.writeText(sqlText);
    avisarContab('Script SQL copiado al portapapeles. Pégalo en Supabase SQL Editor y pulsa Run.', 'success', 7000);
  } catch (e) {
    avisarContab('No se pudo copiar automáticamente; usa el botón Descargar .SQL.', 'warning');
  }
}
