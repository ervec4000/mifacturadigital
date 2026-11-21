/**
 * /js/caja.js
 * Módulo Completo de Caja, Turnos, Ingresos/Egresos de Gaveta,
 * Arqueo X / Cierre Z Imprimible en PDF/Excel y Control de Pagos Mixtos POS.
 */

let cajasTurnosCache = [];
let cajaMovimientosCache = [];
let cajaTurnoActivoCache = null;
let cajaResumenVivoCache = null;
let cajaSucursalesCache = [];
let cajaArqueoEsperadoLiveMap = {};

function esArqueoCiegoActivo() {
  const tenantId = obtenerTenantCajaId();
  if (tenantActual && typeof tenantActual.caja_arqueo_ciego === 'boolean') {
    return tenantActual.caja_arqueo_ciego;
  }
  if (!tenantId) return false;
  try {
    return localStorage.getItem(`mfd_caja_arqueo_ciego_${tenantId}`) === 'true';
  } catch (e) {
    return false;
  }
}

function sincronizarSwitchArqueoCiegoUI() {
  const activo = esArqueoCiegoActivo();
  const chk = document.getElementById('cajaSwitchArqueoCiego');
  if (chk) chk.checked = activo;
  const badge = document.getElementById('cajaArqueoCiegoBadge');
  if (badge) {
    badge.textContent = activo ? 'ARQUEO CIEGO ACTIVO' : 'ARQUEO VISIBLE';
    badge.className = activo
      ? 'px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold bg-amber-950 text-amber-300 border border-amber-500/40'
      : 'px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold bg-slate-800 text-slate-300 border border-slate-700';
  }
}

async function toggleArqueoCiegoCaja(forzarValor = null) {
  const tenantId = obtenerTenantCajaId();
  if (!tenantId) return;
  const chk = document.getElementById('cajaSwitchArqueoCiego');
  const nuevoValor = typeof forzarValor === 'boolean' ? forzarValor : Boolean(chk?.checked);

  try {
    localStorage.setItem(`mfd_caja_arqueo_ciego_${tenantId}`, nuevoValor ? 'true' : 'false');
  } catch (e) {}

  if (tenantActual) {
    tenantActual.caja_arqueo_ciego = nuevoValor;
    try { localStorage.setItem('tenant_actual', JSON.stringify(tenantActual)); } catch (e) {}
  }

  if (supabaseClient) {
    try {
      await supabaseClient.from('tenants').update({ caja_arqueo_ciego: nuevoValor }).eq('id', tenantId);
    } catch (e) {}
  }

  sincronizarSwitchArqueoCiegoUI();
  avisarCaja(
    nuevoValor
      ? 'Modo Arqueo Ciego activado: los montos esperados permanecerán ocultos al cajero hasta ejecutar el Cierre Z.'
      : 'Modo Arqueo Visible activado: los totales esperados del sistema son visibles durante el turno.',
    'info'
  );
  if (cajaTurnoActivoCache) {
    await recalcularArqueoCajaLive();
  }
}

function avisarCaja(mensaje, tipo = 'info', duracion = 5500) {
  if (typeof notificarSistema === 'function') notificarSistema(mensaje, tipo, duracion);
  else console.log(`[CAJA:${tipo}]`, mensaje);
}

function obtenerTenantCajaId() {
  return tenantActual ? (tenantActual.id || tenantActual.tenant_id || null) : null;
}

function esErrorTablaCajaFaltante(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || '');
  return code === '42P01' || code === 'PGRST205' || code === '42703' ||
    /does not exist|schema cache|Could not find the|column .* of relation/i.test(msg);
}

function getTasaCajaActual() {
  const el = document.getElementById('cajaTasaBcv') || document.getElementById('tasaBcv');
  const val = parseFloat(el?.value || '0');
  return Number.isFinite(val) && val > 0 ? val : 888.1183;
}

function generarUuidLocal() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function leerCajasTurnosLocal(tenantId) {
  try {
    const raw = JSON.parse(localStorage.getItem(`mfd_cajas_turnos_${tenantId}`) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch (e) { return []; }
}

function guardarCajasTurnosLocal(tenantId, lista) {
  try {
    localStorage.setItem(`mfd_cajas_turnos_${tenantId}`, JSON.stringify((lista || []).slice(0, 120)));
  } catch (e) {}
}

function leerCajasMovsLocal(tenantId) {
  try {
    const raw = JSON.parse(localStorage.getItem(`mfd_cajas_movs_${tenantId}`) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch (e) { return []; }
}

function guardarCajasMovsLocal(tenantId, lista) {
  try {
    localStorage.setItem(`mfd_cajas_movs_${tenantId}`, JSON.stringify((lista || []).slice(0, 400)));
  } catch (e) {}
}

function formatearFechaHoraCaja(iso) {
  if (!iso) return '--';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yy} ${hh}:${mi}`;
}

function clasificarViaPagoCaja(metodoRaw, monedaDoc = 'USD') {
  const m = String(metodoRaw || '').toUpperCase();
  if (m.includes('CREDITO') || m.includes('CRÉDITO')) return 'CREDITO';
  if (m.includes('PAGO MOVIL') || m.includes('PAGO MÓVIL') || m.includes('PAGOMOVIL')) return 'PAGO_MOVIL';
  if (m.includes('ZELLE')) return 'ZELLE';
  if (m.includes('BINANCE') || m.includes('USDT')) return 'BINANCE';
  if (m.includes('PUNTO') || m.includes('BIOPAGO') || m.includes('DEBITO') || m.includes('DÉBITO') || m.includes('TARJETA')) return 'PUNTO';
  if (m.includes('TRANSFER')) return 'TRANSFERENCIA';
  if (m.includes('EFECTIVO')) {
    if (m.includes('DIVISA') || m.includes('USD') || m.includes('$') || (!m.includes('BS') && !m.includes('VES') && String(monedaDoc).toUpperCase() === 'USD')) {
      return 'EFECTIVO_USD';
    }
    return 'EFECTIVO_BS';
  }
  return String(monedaDoc).toUpperCase() === 'VES' ? 'EFECTIVO_BS' : 'EFECTIVO_USD';
}

// ==========================================
// 1. CARGA DE TURNOS Y SINCRONIZACIÓN POS
// ==========================================

async function cargarTurnosCaja(tenantId = obtenerTenantCajaId()) {
  if (!tenantId) return [];
  const mapa = new Map();
  leerCajasTurnosLocal(tenantId).forEach(t => { if (t?.id) mapa.set(String(t.id), t); });

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('cajas_turnos')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('fecha_apertura', { ascending: false })
        .limit(120);

      if (!error && Array.isArray(data)) {
        data.forEach(t => mapa.set(String(t.id), t));
      } else if (esErrorTablaCajaFaltante(error)) {
        const resAud = await supabaseClient
          .from('audit_logs')
          .select('detalle, created_at')
          .eq('tenant_id', tenantId)
          .eq('accion', 'CAJA_TURNO')
          .order('created_at', { ascending: true })
          .limit(200);
        if (!resAud.error && Array.isArray(resAud.data)) {
          resAud.data.forEach(r => {
            try {
              const t = JSON.parse(r.detalle || '{}');
              if (t?.id) mapa.set(String(t.id), { ...(mapa.get(String(t.id)) || {}), ...t });
            } catch (e) {}
          });
        }
      }
    } catch (e) {}
  }

  cajasTurnosCache = Array.from(mapa.values()).sort((a, b) =>
    String(b.fecha_apertura || b.created_at || '').localeCompare(String(a.fecha_apertura || a.created_at || ''))
  );
  guardarCajasTurnosLocal(tenantId, cajasTurnosCache);
  return cajasTurnosCache;
}

async function cargarMovimientosCaja(turnoId, tenantId = obtenerTenantCajaId()) {
  if (!tenantId || !turnoId) return [];
  const mapa = new Map();
  leerCajasMovsLocal(tenantId)
    .filter(m => String(m.turno_id) === String(turnoId))
    .forEach(m => { if (m?.id) mapa.set(String(m.id), m); });

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('cajas_movimientos')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('turno_id', turnoId)
        .order('fecha', { ascending: false });

      if (!error && Array.isArray(data)) {
        data.forEach(m => mapa.set(String(m.id), m));
      } else if (esErrorTablaCajaFaltante(error)) {
        const resAud = await supabaseClient
          .from('audit_logs')
          .select('detalle, created_at')
          .eq('tenant_id', tenantId)
          .eq('accion', 'CAJA_MOV')
          .order('created_at', { ascending: false })
          .limit(300);
        if (!resAud.error && Array.isArray(resAud.data)) {
          resAud.data.forEach(r => {
            try {
              const m = JSON.parse(r.detalle || '{}');
              if (m?.id && String(m.turno_id) === String(turnoId)) {
                if (m._eliminado) mapa.delete(String(m.id));
                else mapa.set(String(m.id), m);
              }
            } catch (e) {}
          });
        }
      }
    } catch (e) {}
  }

  cajaMovimientosCache = Array.from(mapa.values())
    .filter(m => !m._eliminado)
    .sort((a, b) => String(b.fecha || b.created_at || '').localeCompare(String(a.fecha || a.created_at || '')));
  return cajaMovimientosCache;
}

async function obtenerTurnoCajaActivo(tenantId = obtenerTenantCajaId()) {
  if (!tenantId) return null;
  const turnos = await cargarTurnosCaja(tenantId);
  const actor = typeof obtenerActorActual === 'function' ? obtenerActorActual() : null;
  const abiertas = turnos.filter(t => String(t.estado || '').toUpperCase() === 'ABIERTA');

  let activo = null;
  if (actor?.usuarioEmail) {
    activo = abiertas.find(t => String(t.usuario_email || '').toLowerCase() === String(actor.usuarioEmail).toLowerCase()) || null;
  }
  if (!activo && abiertas.length > 0) {
    activo = abiertas[0];
  }
  cajaTurnoActivoCache = activo;
  pintarBadgeCajaEnPos();
  return activo;
}

function pintarBadgeCajaEnPos() {
  const badge = document.getElementById('posCajaEstadoBadge');
  if (!badge) return;
  if (cajaTurnoActivoCache) {
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span> <span>${esc(cajaTurnoActivoCache.codigo_turno)} · ${esc(cajaTurnoActivoCache.caja_nombre)}</span>`;
    badge.className = 'bg-emerald-950/70 hover:bg-emerald-900/70 border border-emerald-500/40 rounded-xl px-3 py-2 text-xs text-emerald-300 font-semibold cursor-pointer flex items-center gap-2 whitespace-nowrap';
    badge.title = `Caja abierta por ${cajaTurnoActivoCache.usuario_nombre} (${formatearFechaHoraCaja(cajaTurnoActivoCache.fecha_apertura)})`;
  } else {
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-400 inline-block"></span> <span>Caja Cerrada · Abrir Turno</span>`;
    badge.className = 'bg-amber-950/60 hover:bg-amber-900/60 border border-amber-500/40 rounded-xl px-3 py-2 text-xs text-amber-200 font-semibold cursor-pointer flex items-center gap-2 whitespace-nowrap';
    badge.title = 'Haz clic para abrir un turno de caja antes de facturar en efectivo';
  }
}

async function persistirTurnoCaja(turnoObj, esNuevo = false) {
  const tenantId = turnoObj.tenant_id;
  const lista = leerCajasTurnosLocal(tenantId);
  const idx = lista.findIndex(x => String(x.id) === String(turnoObj.id));
  if (idx >= 0) lista[idx] = { ...lista[idx], ...turnoObj };
  else lista.unshift(turnoObj);
  guardarCajasTurnosLocal(tenantId, lista);

  if (!supabaseClient) return { ok: true, localOnly: true };

  try {
    const res = esNuevo
      ? await supabaseClient.from('cajas_turnos').insert([turnoObj]).select().maybeSingle()
      : await supabaseClient.from('cajas_turnos').update(turnoObj).eq('id', turnoObj.id).eq('tenant_id', tenantId).select().maybeSingle();
    if (!res.error) return { ok: true, data: res.data || turnoObj };

    if (esErrorTablaCajaFaltante(res.error) || String(res.error.code || '') === '42501') {
      await supabaseClient.from('audit_logs').insert([{
        tenant_id: tenantId,
        accion: 'CAJA_TURNO',
        detalle: JSON.stringify(turnoObj)
      }]);
      return { ok: true, fallbackAudit: true };
    }
    return { ok: false, error: res.error.message };
  } catch (e) {
    return { ok: true, localOnly: true };
  }
}

async function persistirMovimientoCaja(movObj) {
  const tenantId = movObj.tenant_id;
  const lista = leerCajasMovsLocal(tenantId);
  lista.unshift(movObj);
  guardarCajasMovsLocal(tenantId, lista);

  if (!supabaseClient) return { ok: true };

  try {
    const res = await supabaseClient.from('cajas_movimientos').insert([movObj]).select().maybeSingle();
    if (!res.error) return { ok: true, data: res.data || movObj };
    if (esErrorTablaCajaFaltante(res.error) || String(res.error.code || '') === '42501') {
      await supabaseClient.from('audit_logs').insert([{
        tenant_id: tenantId,
        accion: 'CAJA_MOV',
        detalle: JSON.stringify(movObj)
      }]);
      return { ok: true, fallbackAudit: true };
    }
    return { ok: false, error: res.error.message };
  } catch (e) {
    return { ok: true };
  }
}

// ==========================================
// 2. MÓDULO PRINCIPAL DE CAJA (UI Y ARQUEO)
// ==========================================

async function cargarModuloCaja() {
  const tenantId = obtenerTenantCajaId();
  if (!tenantId) return;
  sincronizarSwitchArqueoCiegoUI();

  const tasaInput = document.getElementById('cajaTasaBcv');
  const tasaPos = parseFloat(document.getElementById('tasaBcv')?.value || '0');
  if (tasaInput && (!tasaInput.value || Number(tasaInput.value) <= 0)) {
    tasaInput.value = (tasaPos > 0 ? tasaPos : 888.1183).toFixed(4);
  }

  // Cargar sucursales para selector de apertura
  try {
    const { data: sucs } = await supabaseClient.from('sucursales').select('*').eq('tenant_id', tenantId).order('nombre', { ascending: true });
    cajaSucursalesCache = sucs || [];
    const selSuc = document.getElementById('cajaSucursalApertura');
    if (selSuc) {
      const prev = selSuc.value;
      selSuc.innerHTML = '<option value="">Sede Principal</option>';
      cajaSucursalesCache.forEach(s => {
        selSuc.innerHTML += `<option value="${esc(s.id)}">${esc(s.nombre)}</option>`;
      });
      if (prev) selSuc.value = prev;
    }
  } catch (e) {}

  await obtenerTurnoCajaActivo(tenantId);

  const panelApertura = document.getElementById('cajaPanelApertura');
  const panelOperacion = document.getElementById('cajaPanelOperacion');
  const badgeEstado = document.getElementById('cajaEstadoTurnoBadge');

  if (cajaTurnoActivoCache) {
    panelApertura?.classList.add('hidden');
    panelOperacion?.classList.remove('hidden');
    if (badgeEstado) {
      badgeEstado.textContent = `TURNO ACTIVO: ${cajaTurnoActivoCache.codigo_turno} · ${cajaTurnoActivoCache.caja_nombre}`;
      badgeEstado.className = 'px-3 py-1.5 rounded-xl text-xs font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/40';
    }
    await Promise.all([
      cargarMovimientosCaja(cajaTurnoActivoCache.id, tenantId),
      recalcularArqueoCajaLive()
    ]);
    renderizarMovimientosCajaTabla();
  } else {
    panelOperacion?.classList.add('hidden');
    panelApertura?.classList.remove('hidden');
    if (badgeEstado) {
      badgeEstado.textContent = 'SIN TURNO ABIERTO (CAJA CERRADA)';
      badgeEstado.className = 'px-3 py-1.5 rounded-xl text-xs font-mono font-bold bg-amber-950 text-amber-300 border border-amber-500/40';
    }
  }

  renderizarHistorialTurnosCaja();
}

async function abrirTurnoCaja(e) {
  if (e) e.preventDefault();
  const tenantId = obtenerTenantCajaId();
  if (!tenantId) return;

  if (cajaTurnoActivoCache) {
    avisarCaja(`Ya existe un turno abierto (${cajaTurnoActivoCache.codigo_turno}). Ciérralo antes de abrir uno nuevo.`, 'warning');
    return;
  }

  const cajaNombre = (document.getElementById('cajaNombreInput')?.value || 'Caja 1 - Principal').trim();
  const sucId = document.getElementById('cajaSucursalApertura')?.value || null;
  const sucObj = cajaSucursalesCache.find(s => String(s.id) === String(sucId));
  const fondoUsd = Math.max(0, parseFloat(document.getElementById('cajaFondoInicialUsd')?.value) || 0);
  const fondoBs = Math.max(0, parseFloat(document.getElementById('cajaFondoInicialBs')?.value) || 0);
  const tasa = getTasaCajaActual();
  const notas = (document.getElementById('cajaObsApertura')?.value || '').trim();

  const actor = typeof obtenerActorActual === 'function' ? obtenerActorActual() : null;
  const actorUuid = actor?.usuarioId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(actor.usuarioId))
    ? actor.usuarioId
    : null;

  const nextNum = cajasTurnosCache.length + 1;
  const codigoTurno = `CAJA-${String(nextNum).padStart(4, '0')}`;

  const nuevoTurno = {
    id: generarUuidLocal(),
    tenant_id: tenantId,
    codigo_turno: codigoTurno,
    caja_nombre: cajaNombre || 'Caja Principal',
    sucursal_id: sucId || null,
    sucursal_nombre: sucObj?.nombre || 'Sede Principal',
    usuario_id: actorUuid,
    usuario_nombre: actor?.usuarioNombre || tenantActual?.razon_social || 'Operador',
    usuario_email: actor?.usuarioEmail || tenantActual?.email || '',
    estado: 'ABIERTA',
    fecha_apertura: new Date().toISOString(),
    tasa_bcv: Number(tasa.toFixed(4)),
    fondo_inicial_usd: Number(fondoUsd.toFixed(2)),
    fondo_inicial_bs: Number(fondoBs.toFixed(2)),
    ingresos_extra_usd: 0,
    ingresos_extra_bs: 0,
    egresos_usd: 0,
    egresos_bs: 0,
    ventas_total_usd: 0,
    ventas_total_bs: 0,
    cantidad_facturas: 0,
    esperado_desglose_json: {},
    contado_desglose_json: {},
    observaciones: notas || null,
    created_at: new Date().toISOString()
  };

  const res = await persistirTurnoCaja(nuevoTurno, true);
  if (!res.ok) {
    avisarCaja(`No se pudo abrir la caja: ${res.error}`, 'error');
    return;
  }

  document.getElementById('formAbrirTurnoCaja')?.reset();
  if (document.getElementById('cajaNombreInput')) document.getElementById('cajaNombreInput').value = 'Caja 1 - Principal';
  avisarCaja(`Turno ${codigoTurno} (${nuevoTurno.caja_nombre}) abierto con fondo $ ${fondoUsd.toFixed(2)} | Bs. ${fondoBs.toFixed(2)}.`, 'success');
  await cargarModuloCaja();
}

async function registrarMovimientoCaja(e) {
  if (e) e.preventDefault();
  const tenantId = obtenerTenantCajaId();
  if (!tenantId || !cajaTurnoActivoCache) {
    avisarCaja('Debes tener un turno de caja abierto para registrar movimientos.', 'warning');
    return;
  }

  const tipo = document.getElementById('cajaMovTipo')?.value || 'EGRESO';
  const moneda = document.getElementById('cajaMovMoneda')?.value || 'USD';
  const monto = parseFloat(document.getElementById('cajaMovMonto')?.value) || 0;
  const concepto = (document.getElementById('cajaMovConcepto')?.value || '').trim();
  const categoria = document.getElementById('cajaMovCategoria')?.value || 'OPERATIVO';
  const referencia = (document.getElementById('cajaMovReferencia')?.value || '').trim();
  const tasa = getTasaCajaActual();

  if (monto <= 0 || !concepto) {
    avisarCaja('Ingresa un monto mayor a 0 y el concepto del movimiento.', 'warning');
    return;
  }

  const montoUsd = moneda === 'USD' ? monto : monto / tasa;
  const montoBs = moneda === 'VES' ? monto : monto * tasa;

  const actor = typeof obtenerActorActual === 'function' ? obtenerActorActual() : null;
  const actorUuid = actor?.usuarioId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(actor.usuarioId))
    ? actor.usuarioId
    : null;

  const mov = {
    id: generarUuidLocal(),
    tenant_id: tenantId,
    turno_id: cajaTurnoActivoCache.id,
    tipo,
    concepto,
    categoria,
    moneda,
    monto: Number(monto.toFixed(2)),
    monto_usd: Number(montoUsd.toFixed(2)),
    monto_bs: Number(montoBs.toFixed(2)),
    tasa_bcv: Number(tasa.toFixed(4)),
    referencia: referencia || null,
    usuario_id: actorUuid,
    usuario_nombre: actor?.usuarioNombre || 'Operador',
    fecha: new Date().toISOString(),
    created_at: new Date().toISOString()
  };

  const res = await persistirMovimientoCaja(mov);
  if (!res.ok) {
    avisarCaja(`Error al registrar movimiento: ${res.error}`, 'error');
    return;
  }

  document.getElementById('formMovimientoCaja')?.reset();
  avisarCaja(`${tipo === 'INGRESO' ? 'Ingreso' : (tipo === 'RETIRO_PARCIAL' ? 'Retiro parcial' : 'Egreso / Gasto')} registrado en caja.`, 'success');
  await cargarMovimientosCaja(cajaTurnoActivoCache.id, tenantId);
  renderizarMovimientosCajaTabla();
  await recalcularArqueoCajaLive();
}

async function calcularResumenTurnoVivo(turno) {
  const tenantId = obtenerTenantCajaId();
  if (!tenantId || !turno) return null;

  const tasaTurno = Number(turno.tasa_bcv || getTasaCajaActual() || 1);
  const movs = String(turno.id) === String(cajaTurnoActivoCache?.id)
    ? cajaMovimientosCache
    : await cargarMovimientosCaja(turno.id, tenantId);

  let ingExtraUsd = 0, ingExtraBs = 0;
  let egrUsd = 0, egrBs = 0;
  movs.forEach(m => {
    const isUsd = String(m.moneda || 'USD').toUpperCase() === 'USD';
    const val = Number(m.monto || 0);
    if (m.tipo === 'INGRESO') {
      if (isUsd) ingExtraUsd += val; else ingExtraBs += val;
    } else {
      if (isUsd) egrUsd += val; else egrBs += val;
    }
  });

  // Consultar facturas del tenant para asociar al turno
  const { data: allInvs } = await supabaseClient
    .from('invoices')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(500);

  // Cargar metas locales para pago mixto si no existe columna en BD
  let storeMeta = {};
  try {
    storeMeta = JSON.parse(localStorage.getItem(`facturas_seniat_meta_${tenantId}`) || '{}');
  } catch (e) {}

  const aperturaIso = turno.fecha_apertura || turno.created_at;
  const cierreIso = turno.fecha_cierre || new Date().toISOString();

  const docsTurno = (allInvs || []).filter(inv => {
    const est = String(inv.estado || 'EMITIDA').toUpperCase();
    const num = String(inv.factura_nro || '').toUpperCase();
    if (est === 'ANULADA') return false;
    if (inv.turno_caja_id) {
      return String(inv.turno_caja_id) === String(turno.id);
    }
    const meta = storeMeta[String(inv.id)] || storeMeta[String(inv.factura_nro)] || null;
    if (meta?.turnoCajaId) {
      return String(meta.turnoCajaId) === String(turno.id);
    }
    // Fallback por ventana temporal del turno si no tiene turno_caja_id explícito y no fue asignado a otro turno
    const ts = inv.created_at || '';
    if (!ts || !aperturaIso) return false;
    return ts >= aperturaIso && ts <= cierreIso && !num.startsWith('REV-');
  });

  const desglose = {
    EFECTIVO_USD: { label: 'Efectivo Divisas ($)', usd: 0, bs: 0, count: 0 },
    EFECTIVO_BS: { label: 'Efectivo Bolívares (Bs.)', usd: 0, bs: 0, count: 0 },
    PAGO_MOVIL: { label: 'Pago Móvil (Bs.)', usd: 0, bs: 0, count: 0 },
    PUNTO: { label: 'Punto / Biopago (Bs.)', usd: 0, bs: 0, count: 0 },
    ZELLE: { label: 'Zelle ($ USD)', usd: 0, bs: 0, count: 0 },
    TRANSFERENCIA: { label: 'Transferencia Bancaria', usd: 0, bs: 0, count: 0 },
    BINANCE: { label: 'Binance / USDT ($)', usd: 0, bs: 0, count: 0 },
    CREDITO: { label: 'Ventas a Crédito (CxC)', usd: 0, bs: 0, count: 0 }
  };

  let ventasNetasUsd = 0;
  let ventasNetasBs = 0;
  let vueltoTotalUsd = 0;
  let vueltoTotalBs = 0;
  let cantFacturas = 0;
  let cantNotasNc = 0;

  docsTurno.forEach(doc => {
    const num = String(doc.factura_nro || '').toUpperCase();
    const est = String(doc.estado || '').toUpperCase();
    const esNc = num.startsWith('NC') || num.startsWith('REV-') || est === 'REVERSO';
    const signo = esNc ? -1 : 1;
    if (esNc) cantNotasNc++;
    else cantFacturas++;

    const tasaDoc = Number(doc.tasa_bcv || tasaTurno || 1);
    const totalBs = Math.abs(Number(doc.total_bs || 0));
    const totalUsd = tasaDoc > 0 ? totalBs / tasaDoc : Math.abs(Number(doc.monto_usd || 0));

    ventasNetasBs += signo * totalBs;
    ventasNetasUsd += signo * totalUsd;

    const meta = storeMeta[String(doc.id)] || storeMeta[String(doc.factura_nro)] || null;
    const vueltoUsdDoc = Number(doc.vuelto_usd ?? meta?.vueltoUsd ?? 0);
    const vueltoBsDoc = Number(doc.vuelto_bs ?? meta?.vueltoBs ?? 0);
    if (!esNc) {
      vueltoTotalUsd += vueltoUsdDoc;
      vueltoTotalBs += vueltoBsDoc;
    }

    const pagosMixtos = Array.isArray(doc.pago_mixto_json) && doc.pago_mixto_json.length > 0
      ? doc.pago_mixto_json
      : (Array.isArray(meta?.pagoMixto) && meta.pagoMixto.length > 0 ? meta.pagoMixto : null);

    if (pagosMixtos) {
      pagosMixtos.forEach(p => {
        const key = clasificarViaPagoCaja(p.metodo, p.moneda);
        const slot = desglose[key] || desglose.EFECTIVO_USD;
        slot.usd += signo * Number(p.montoUsd || 0);
        slot.bs += signo * Number(p.montoBs || 0);
        slot.count += 1;
      });
    } else {
      const partes = String(doc.metodo_pago || 'EFECTIVO').split('|').map(s => s.trim());
      const metodoMain = partes[0] || 'EFECTIVO';
      const monPart = (partes.find(p => p.startsWith('MON:')) || '').replace('MON:', '').trim() || meta?.moneda || 'USD';
      const condPart = (partes.find(p => p === 'CRÉDITO' || p === 'CREDITO') || meta?.condicionPago || '').toUpperCase();
      const key = condPart.includes('CRÉDITO') || condPart.includes('CREDITO')
        ? 'CREDITO'
        : clasificarViaPagoCaja(metodoMain, monPart);
      const slot = desglose[key] || desglose.EFECTIVO_USD;
      slot.usd += signo * totalUsd;
      slot.bs += signo * totalBs;
      slot.count += 1;
    }
  });

  // Gaveta física esperada = Fondo inicial + Ventas Efectivo + Ingresos Extra - Egresos - Vueltos entregados
  const espEfectivoUsd = Number(turno.fondo_inicial_usd || 0) + desglose.EFECTIVO_USD.usd + ingExtraUsd - egrUsd - vueltoTotalUsd;
  const espEfectivoBs = Number(turno.fondo_inicial_bs || 0) + desglose.EFECTIVO_BS.bs + ingExtraBs - egrBs - vueltoTotalBs;

  const totalEsperadoUsd = espEfectivoUsd + desglose.ZELLE.usd + desglose.BINANCE.usd + (espEfectivoBs + desglose.PAGO_MOVIL.bs + desglose.PUNTO.bs + desglose.TRANSFERENCIA.bs) / tasaTurno;
  const totalEsperadoBs = espEfectivoBs + desglose.PAGO_MOVIL.bs + desglose.PUNTO.bs + desglose.TRANSFERENCIA.bs + ((espEfectivoUsd + desglose.ZELLE.usd + desglose.BINANCE.usd) * tasaTurno);

  return {
    turno,
    tasaTurno,
    docsTurno,
    movs,
    cantFacturas,
    cantNotasNc,
    ingExtraUsd,
    ingExtraBs,
    egrUsd,
    egrBs,
    vueltoTotalUsd,
    vueltoTotalBs,
    ventasNetasUsd,
    ventasNetasBs,
    desglose,
    espEfectivoUsd,
    espEfectivoBs,
    totalEsperadoUsd,
    totalEsperadoBs
  };
}

async function recalcularArqueoCajaLive() {
  if (!cajaTurnoActivoCache) return;
  const res = await calcularResumenTurnoVivo(cajaTurnoActivoCache);
  if (!res) return;
  cajaResumenVivoCache = res;
  const ciego = esArqueoCiegoActivo();
  sincronizarSwitchArqueoCiegoUI();

  const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setTxt('cajaKpiFondoInicial', `$ ${Number(cajaTurnoActivoCache.fondo_inicial_usd || 0).toFixed(2)} | Bs. ${Number(cajaTurnoActivoCache.fondo_inicial_bs || 0).toFixed(2)}`);
  setTxt('cajaKpiVentasTurno', ciego ? `${res.cantFacturas} docs (Oculto en Ciego)` : `$ ${res.ventasNetasUsd.toFixed(2)} (${res.cantFacturas} docs)`);
  setTxt('cajaKpiMovsNetos', ciego ? `Oculto (Arqueo Ciego)` : `+$${res.ingExtraUsd.toFixed(2)} / -$${res.egrUsd.toFixed(2)} | Bs. +${res.ingExtraBs.toFixed(2)}/-${res.egrBs.toFixed(2)}`);
  setTxt('cajaKpiGavetaEsperada', ciego ? 'OCULTO (Arqueo Ciego)' : `$ ${res.espEfectivoUsd.toFixed(2)} | Bs. ${res.espEfectivoBs.toFixed(2)}`);

  // Pintar tabla comparativa de arqueo por vía de pago
  const tbody = document.getElementById('tablaArqueoCanales');
  cajaArqueoEsperadoLiveMap = {};
  if (tbody) {
    const filas = [
      {
        key: 'EFECTIVO_USD',
        label: 'Efectivo Divisas ($ USD)',
        moneda: 'USD',
        esperado: res.espEfectivoUsd,
        detalle: ciego
          ? 'Declarar monto contado físicamente'
          : `Fondo $${Number(cajaTurnoActivoCache.fondo_inicial_usd || 0).toFixed(2)} + Ventas $${res.desglose.EFECTIVO_USD.usd.toFixed(2)} + Ing $${res.ingExtraUsd.toFixed(2)} - Egr $${res.egrUsd.toFixed(2)}${res.vueltoTotalUsd > 0 ? ` - Vuelto $${res.vueltoTotalUsd.toFixed(2)}` : ''}`
      },
      {
        key: 'EFECTIVO_BS',
        label: 'Efectivo Bolívares (Bs.)',
        moneda: 'VES',
        esperado: res.espEfectivoBs,
        detalle: ciego
          ? 'Declarar monto contado físicamente'
          : `Fondo Bs.${Number(cajaTurnoActivoCache.fondo_inicial_bs || 0).toFixed(2)} + Ventas Bs.${res.desglose.EFECTIVO_BS.bs.toFixed(2)} + Ing Bs.${res.ingExtraBs.toFixed(2)} - Egr Bs.${res.egrBs.toFixed(2)}${res.vueltoTotalBs > 0 ? ` - Vuelto Bs.${res.vueltoTotalBs.toFixed(2)}` : ''}`
      },
      { key: 'PAGO_MOVIL', label: 'Pago Móvil (Bs.)', moneda: 'VES', esperado: res.desglose.PAGO_MOVIL.bs, detalle: `${res.desglose.PAGO_MOVIL.count} transacción(es)` },
      { key: 'PUNTO', label: 'Punto de Venta / Biopago (Bs.)', moneda: 'VES', esperado: res.desglose.PUNTO.bs, detalle: `${res.desglose.PUNTO.count} lote(s)` },
      { key: 'TRANSFERENCIA', label: 'Transferencia Bancaria (Bs.)', moneda: 'VES', esperado: res.desglose.TRANSFERENCIA.bs, detalle: `${res.desglose.TRANSFERENCIA.count} operación(es)` },
      { key: 'ZELLE', label: 'Zelle ($ USD)', moneda: 'USD', esperado: res.desglose.ZELLE.usd, detalle: `${res.desglose.ZELLE.count} pago(s)` },
      { key: 'BINANCE', label: 'Binance / USDT ($ USD)', moneda: 'USD', esperado: res.desglose.BINANCE.usd, detalle: `${res.desglose.BINANCE.count} pago(s)` }
    ];

    const prevVals = {};
    const prevEdited = {};
    filas.forEach(f => {
      cajaArqueoEsperadoLiveMap[f.key] = Number(f.esperado || 0);
      const inp = document.getElementById(`arqueoInput_${f.key}`);
      if (inp && inp.value !== '') {
        prevVals[f.key] = inp.value;
        if (inp.dataset.userEdited === 'true') prevEdited[f.key] = inp.value;
      }
    });

    tbody.innerHTML = filas.map(f => {
      const valPrefill = ciego
        ? (prevEdited[f.key] !== undefined ? prevEdited[f.key] : '')
        : (prevVals[f.key] !== undefined ? prevVals[f.key] : f.esperado.toFixed(2));
      const pref = f.moneda === 'USD' ? '$ ' : 'Bs. ';
      const esperadoHtml = ciego
        ? `<span class="text-amber-300/80 text-[11px] font-mono">Oculto (Arqueo Ciego)</span>`
        : `${pref}${f.esperado.toFixed(2)}`;
      return `
        <tr class="border-b border-slate-800/50 hover:bg-slate-900/60">
          <td class="p-3">
            <div class="font-semibold text-white">${esc(f.label)}</div>
            <div class="text-[11px] text-slate-400">${esc(f.detalle)}</div>
          </td>
          <td class="p-3 text-right font-mono font-bold text-slate-200 tabular-nums">${esperadoHtml}</td>
          <td class="p-3 text-right">
            <input type="number" step="0.01" min="0" id="arqueoInput_${f.key}" data-key="${f.key}" data-moneda="${f.moneda}" data-user-edited="${prevEdited[f.key] !== undefined ? 'true' : 'false'}"
              value="${valPrefill}" placeholder="0.00" oninput="this.dataset.userEdited='true'; recalcularDiferenciaArqueo()"
              class="w-36 bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-lg px-2.5 py-1.5 text-right text-xs font-mono text-emerald-300 font-bold tabular-nums">
          </td>
          <td id="arqueoDiff_${f.key}" class="p-3 text-right font-mono font-bold tabular-nums ${ciego ? 'text-slate-500' : 'text-emerald-400'}">${ciego ? 'Al Cierre Z' : `${pref}0.00`}</td>
        </tr>
      `;
    }).join('');

    if (res.desglose.CREDITO.usd > 0) {
      tbody.innerHTML += `
        <tr class="bg-slate-950/60 border-b border-slate-800/50">
          <td class="p-3"><div class="font-semibold text-amber-300">Ventas a Crédito (No ingresa a Gaveta)</div><div class="text-[11px] text-slate-400">${res.desglose.CREDITO.count} factura(s) en Cuentas por Cobrar</div></td>
          <td class="p-3 text-right font-mono font-bold text-amber-300 tabular-nums">${ciego ? 'Oculto' : `$ ${res.desglose.CREDITO.usd.toFixed(2)}`}</td>
          <td class="p-3 text-right font-mono text-xs text-slate-500">CxC</td>
          <td class="p-3 text-right font-mono text-xs text-slate-400">${ciego ? '--' : `Bs. ${res.desglose.CREDITO.bs.toFixed(2)}`}</td>
        </tr>
      `;
    }
  }

  recalcularDiferenciaArqueo();
}

function recalcularDiferenciaArqueo() {
  const ciego = esArqueoCiegoActivo();
  const tasa = cajaResumenVivoCache?.tasaTurno || getTasaCajaActual() || 1;
  let diffTotalUsd = 0;

  document.querySelectorAll('[id^="arqueoInput_"]').forEach(inp => {
    const key = inp.dataset.key;
    const moneda = inp.dataset.moneda || 'USD';
    const esperado = Number(cajaArqueoEsperadoLiveMap[key] ?? 0);
    const contado = parseFloat(inp.value || '0') || 0;
    const diff = contado - esperado;
    const pref = moneda === 'USD' ? '$ ' : 'Bs. ';

    diffTotalUsd += moneda === 'USD' ? diff : (diff / tasa);

    const diffEl = document.getElementById(`arqueoDiff_${key}`);
    if (diffEl) {
      if (ciego) {
        diffEl.textContent = 'Al Cierre Z';
        diffEl.className = 'p-3 text-right font-mono font-bold tabular-nums text-slate-500';
      } else {
        const signo = diff > 0.009 ? '+' : '';
        diffEl.textContent = `${signo}${pref}${diff.toFixed(2)}`;
        if (Math.abs(diff) <= 0.05) {
          diffEl.className = 'p-3 text-right font-mono font-bold tabular-nums text-emerald-400';
        } else if (diff > 0) {
          diffEl.className = 'p-3 text-right font-mono font-bold tabular-nums text-sky-400';
        } else {
          diffEl.className = 'p-3 text-right font-mono font-bold tabular-nums text-rose-400';
        }
      }
    }
  });

  const badgeDiff = document.getElementById('cajaArqueoDiferenciaTotal');
  if (badgeDiff) {
    if (ciego) {
      badgeDiff.textContent = 'MODO ARQUEO CIEGO ACTIVO (Diferencia al Cierre Z)';
      badgeDiff.className = 'text-xs font-mono font-bold text-amber-300';
    } else if (Math.abs(diffTotalUsd) <= 0.05) {
      badgeDiff.textContent = 'CUADRE EXACTO ($ 0.00)';
      badgeDiff.className = 'text-xs font-mono font-bold text-emerald-400';
    } else if (diffTotalUsd > 0) {
      badgeDiff.textContent = `SOBRANTE: +$ ${diffTotalUsd.toFixed(2)} (+Bs. ${(diffTotalUsd * tasa).toFixed(2)})`;
      badgeDiff.className = 'text-xs font-mono font-bold text-sky-400';
    } else {
      badgeDiff.textContent = `FALTANTE: -$ ${Math.abs(diffTotalUsd).toFixed(2)} (-Bs. ${(Math.abs(diffTotalUsd) * tasa).toFixed(2)})`;
      badgeDiff.className = 'text-xs font-mono font-bold text-rose-400';
    }
  }
}

function renderizarMovimientosCajaTabla() {
  const tbody = document.getElementById('tablaMovimientosCaja');
  if (!tbody) return;
  if (!cajaMovimientosCache || cajaMovimientosCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-500">Sin ingresos ni egresos manuales en este turno.</td></tr>`;
    return;
  }

  tbody.innerHTML = cajaMovimientosCache.map(m => {
    const esIngreso = m.tipo === 'INGRESO';
    const badge = esIngreso
      ? '<span class="px-2 py-0.5 rounded text-[10px] bg-emerald-950 text-emerald-300 font-semibold">INGRESO</span>'
      : (m.tipo === 'RETIRO_PARCIAL'
          ? '<span class="px-2 py-0.5 rounded text-[10px] bg-sky-950 text-sky-300 font-semibold">RETIRO</span>'
          : '<span class="px-2 py-0.5 rounded text-[10px] bg-rose-950 text-rose-300 font-semibold">EGRESO</span>');
    const montoTxt = m.moneda === 'USD'
      ? `$ ${Number(m.monto || 0).toFixed(2)}`
      : `Bs. ${Number(m.monto || 0).toFixed(2)}`;
    return `
      <tr class="border-b border-slate-800/40 hover:bg-slate-900">
        <td class="p-3 font-mono text-slate-400">${formatearFechaHoraCaja(m.fecha)}</td>
        <td class="p-3">${badge}</td>
        <td class="p-3 text-white font-medium">${esc(m.concepto)}<div class="text-[11px] text-slate-400">${esc(m.categoria || '')}${m.referencia ? ' · Ref: ' + esc(m.referencia) : ''}</div></td>
        <td class="p-3 font-mono text-slate-300">${esc(m.usuario_nombre || '--')}</td>
        <td class="p-3 text-right font-mono font-bold ${esIngreso ? 'text-emerald-400' : 'text-rose-400'}">${esIngreso ? '+' : '-'}${montoTxt}</td>
      </tr>
    `;
  }).join('');
}

async function cerrarTurnoCaja() {
  const tenantId = obtenerTenantCajaId();
  if (!tenantId || !cajaTurnoActivoCache) return;

  await recalcularArqueoCajaLive();
  const res = cajaResumenVivoCache;
  if (!res) return;

  const contadoMap = {};
  const esperadoMap = {};
  let totalContadoUsdEq = 0;
  let totalEsperadoUsdEq = 0;
  const tasa = res.tasaTurno || 1;

  document.querySelectorAll('[id^="arqueoInput_"]').forEach(inp => {
    const key = inp.dataset.key;
    const moneda = inp.dataset.moneda || 'USD';
    const esp = Number(cajaArqueoEsperadoLiveMap[key] ?? 0);
    const cont = parseFloat(inp.value || '0') || 0;
    contadoMap[key] = { moneda, monto: Number(cont.toFixed(2)) };
    esperadoMap[key] = { moneda, monto: Number(esp.toFixed(2)) };
    totalContadoUsdEq += moneda === 'USD' ? cont : (cont / tasa);
    totalEsperadoUsdEq += moneda === 'USD' ? esp : (esp / tasa);
  });

  const ciego = esArqueoCiegoActivo();
  const difUsd = Number((totalContadoUsdEq - totalEsperadoUsdEq).toFixed(2));
  const difBs = Number((difUsd * tasa).toFixed(2));
  const ok = typeof pedirConfirmacion === 'function'
    ? await pedirConfirmacion(
        `Cerrar Turno ${cajaTurnoActivoCache.codigo_turno}`,
        ciego
          ? `¿Confirmas el Cierre Z (Arqueo Ciego)? Total declarado contado: $ ${totalContadoUsdEq.toFixed(2)}. Al confirmar se revelará la diferencia exacta en el acta Z.`
          : `¿Confirmas el Cierre Z de caja? Ventas netas: $ ${res.ventasNetasUsd.toFixed(2)} | Diferencia arqueo: ${difUsd >= 0 ? '+' : ''}$ ${difUsd.toFixed(2)}.`
      )
    : true;
  if (!ok) return;

  const obs = (document.getElementById('cajaObsCierre')?.value || '').trim();
  const actor = typeof obtenerActorActual === 'function' ? obtenerActorActual() : null;

  const turnoCerrado = {
    ...cajaTurnoActivoCache,
    estado: 'CERRADA',
    fecha_cierre: new Date().toISOString(),
    ingresos_extra_usd: Number(res.ingExtraUsd.toFixed(2)),
    ingresos_extra_bs: Number(res.ingExtraBs.toFixed(2)),
    egresos_usd: Number(res.egrUsd.toFixed(2)),
    egresos_bs: Number(res.egrBs.toFixed(2)),
    ventas_total_usd: Number(res.ventasNetasUsd.toFixed(2)),
    ventas_total_bs: Number(res.ventasNetasBs.toFixed(2)),
    cantidad_facturas: res.cantFacturas,
    esperado_desglose_json: esperadoMap,
    contado_desglose_json: contadoMap,
    total_esperado_usd: Number(totalEsperadoUsdEq.toFixed(2)),
    total_contado_usd: Number(totalContadoUsdEq.toFixed(2)),
    diferencia_usd: difUsd,
    total_esperado_bs: Number((totalEsperadoUsdEq * tasa).toFixed(2)),
    total_contado_bs: Number((totalContadoUsdEq * tasa).toFixed(2)),
    diferencia_bs: difBs,
    observaciones: obs || cajaTurnoActivoCache.observaciones || null,
    cerrado_por: actor?.usuarioNombre || tenantActual?.razon_social || 'Operador',
    updated_at: new Date().toISOString()
  };

  const saveRes = await persistirTurnoCaja(turnoCerrado, false);
  if (!saveRes.ok) {
    avisarCaja(`Error al cerrar el turno: ${saveRes.error}`, 'error');
    return;
  }

  const closedId = turnoCerrado.id;
  cajaTurnoActivoCache = null;
  cajaResumenVivoCache = null;
  if (document.getElementById('cajaObsCierre')) document.getElementById('cajaObsCierre').value = '';

  avisarCaja(`¡Turno ${turnoCerrado.codigo_turno} cerrado con éxito! Generando comprobante de Arqueo Z.`, 'success', 6500);
  await cargarModuloCaja();
  await imprimirArqueoCajaPdf(closedId);
}

function renderizarHistorialTurnosCaja() {
  const tbody = document.getElementById('tablaHistorialTurnosCaja');
  if (!tbody) return;
  if (!cajasTurnosCache || cajasTurnosCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-slate-500">Sin turnos de caja registrados aún.</td></tr>`;
    return;
  }

  tbody.innerHTML = cajasTurnosCache.map(t => {
    const abierta = String(t.estado || '').toUpperCase() === 'ABIERTA';
    const difUsd = Number(t.diferencia_usd || 0);
    const difColor = Math.abs(difUsd) <= 0.05 ? 'text-emerald-400' : (difUsd > 0 ? 'text-sky-400' : 'text-rose-400');
    return `
      <tr class="border-b border-slate-800/40 hover:bg-slate-900">
        <td class="p-3 font-mono font-bold text-white">${esc(t.codigo_turno)}<div class="text-[11px] font-sans text-slate-400 font-normal">${esc(t.caja_nombre)}</div></td>
        <td class="p-3 text-slate-200">${esc(t.usuario_nombre || '--')}<div class="text-[11px] text-slate-400">${esc(t.sucursal_nombre || 'Sede Principal')}</div></td>
        <td class="p-3 font-mono text-xs text-slate-300"><div>Ap: ${formatearFechaHoraCaja(t.fecha_apertura)}</div><div>${t.fecha_cierre ? 'Ci: ' + formatearFechaHoraCaja(t.fecha_cierre) : 'En curso...'}</div></td>
        <td class="p-3 text-right font-mono text-slate-300 tabular-nums">$ ${Number(t.fondo_inicial_usd || 0).toFixed(2)}<div class="text-[11px] text-slate-500">Bs. ${Number(t.fondo_inicial_bs || 0).toFixed(2)}</div></td>
        <td class="p-3 text-right font-mono font-bold text-emerald-400 tabular-nums">$ ${Number(t.ventas_total_usd || 0).toFixed(2)}<div class="text-[11px] text-slate-400">${Number(t.cantidad_facturas || 0)} docs</div></td>
        <td class="p-3 text-right font-mono font-bold ${difColor} tabular-nums">${abierta ? '--' : ((difUsd > 0 ? '+' : '') + '$ ' + difUsd.toFixed(2))}</td>
        <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${abierta ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-300'}">${esc(t.estado)}</span></td>
        <td class="p-3 text-center whitespace-nowrap">
          <button type="button" onclick='imprimirArqueoCajaPdf("${esc(t.id)}")' class="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer">Arqueo PDF</button>
        </td>
      </tr>
    `;
  }).join('');
}

// ==========================================
// 3. REPORTES PDF Y EXCEL DE ARQUEO X / Z
// ==========================================

async function imprimirArqueoCajaPdf(turnoId) {
  const turno = cajasTurnosCache.find(t => String(t.id) === String(turnoId)) || cajaTurnoActivoCache;
  if (!turno) {
    avisarCaja('Turno de caja no encontrado.', 'warning');
    return;
  }
  if (!window.jspdf || !window.jspdf.jsPDF) {
    avisarCaja('Librería jsPDF no cargada.', 'error');
    return;
  }

  const res = await calcularResumenTurnoVivo(turno);
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' });
  const margin = 14;
  const pageW = pdf.internal.pageSize.getWidth();
  const contentW = pageW - margin * 2;
  let y = 16;

  const esCerrada = String(turno.estado || '').toUpperCase() === 'CERRADA';
  const tituloCorte = esCerrada ? `CIERRE Z · ARQUEO DE CAJA (${turno.codigo_turno})` : `CORTE X EN VIVO · ARQUEO PARCIAL (${turno.codigo_turno})`;

  pdf.setFillColor(15, 23, 42);
  pdf.rect(margin, y - 4, contentW, 20, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text(String(tenantActual?.razon_social || 'MI EMPRESA').toUpperCase(), margin + 4, y + 3);
  pdf.setFontSize(8.5);
  pdf.setTextColor(16, 185, 129);
  pdf.text(tituloCorte, margin + 4, y + 9);
  pdf.setTextColor(203, 213, 225);
  pdf.text(`RIF: ${tenantActual?.rif || ''}`, pageW - margin - 4, y + 3, { align: 'right' });
  pdf.text(`Tasa BCV: Bs. ${Number(turno.tasa_bcv || 1).toFixed(4)}`, pageW - margin - 4, y + 9, { align: 'right' });
  y += 22;

  pdf.setTextColor(15, 23, 42);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.text(`Caja / Sucursal: ${turno.caja_nombre} · ${turno.sucursal_nombre || 'Sede Principal'}`, margin, y);
  pdf.text(`Operador: ${turno.usuario_nombre}`, pageW - margin, y, { align: 'right' });
  y += 4.5;
  pdf.text(`Apertura: ${formatearFechaHoraCaja(turno.fecha_apertura)}`, margin, y);
  pdf.text(`Cierre: ${turno.fecha_cierre ? formatearFechaHoraCaja(turno.fecha_cierre) : 'EN CURSO'}`, pageW - margin, y, { align: 'right' });
  y += 7;

  // Resumen de ventas y movimientos
  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(203, 213, 225);
  pdf.roundedRect(margin, y, contentW, 22, 2, 2, 'FD');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.text(`Documentos Emitidos: ${res.cantFacturas} factura(s) | ${res.cantNotasNc} NC/Rev`, margin + 4, y + 6);
  pdf.text(`Ventas Netas: $ ${res.ventasNetasUsd.toFixed(2)} | Bs. ${res.ventasNetasBs.toFixed(2)}`, margin + 4, y + 12);
  pdf.text(`Fondo Inicial: $ ${Number(turno.fondo_inicial_usd || 0).toFixed(2)} | Bs. ${Number(turno.fondo_inicial_bs || 0).toFixed(2)}`, pageW - margin - 4, y + 6, { align: 'right' });
  pdf.text(`Ing/Egr Extra: +$${res.ingExtraUsd.toFixed(2)} / -$${res.egrUsd.toFixed(2)} | Bs.+${res.ingExtraBs.toFixed(2)}/-${res.egrBs.toFixed(2)}`, pageW - margin - 4, y + 12, { align: 'right' });
  pdf.setFont('helvetica', 'normal');
  pdf.text(`Vueltos Entregados en POS: $ ${res.vueltoTotalUsd.toFixed(2)} | Bs. ${res.vueltoTotalBs.toFixed(2)}`, margin + 4, y + 18);
  y += 28;

  // Tabla Arqueo Esperado vs Contado
  pdf.setFillColor(15, 23, 42);
  pdf.rect(margin, y, contentW, 7, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.text('Medio / Canal de Cobro', margin + 3, y + 4.8);
  pdf.text('Esperado Sistema', margin + 108, y + 4.8, { align: 'right' });
  pdf.text('Contado Físico', margin + 145, y + 4.8, { align: 'right' });
  pdf.text('Diferencia', pageW - margin - 3, y + 4.8, { align: 'right' });
  y += 7;

  const canales = [
    ['Efectivo Divisas ($ USD)', 'EFECTIVO_USD', 'USD', res.espEfectivoUsd],
    ['Efectivo Bolívares (Bs.)', 'EFECTIVO_BS', 'VES', res.espEfectivoBs],
    ['Pago Móvil (Bs.)', 'PAGO_MOVIL', 'VES', res.desglose.PAGO_MOVIL.bs],
    ['Punto / Biopago (Bs.)', 'PUNTO', 'VES', res.desglose.PUNTO.bs],
    ['Transferencia Bancaria (Bs.)', 'TRANSFERENCIA', 'VES', res.desglose.TRANSFERENCIA.bs],
    ['Zelle ($ USD)', 'ZELLE', 'USD', res.desglose.ZELLE.usd],
    ['Binance / USDT ($ USD)', 'BINANCE', 'USD', res.desglose.BINANCE.usd]
  ];

  const ocultarCorteX = !esCerrada && esArqueoCiegoActivo();
  pdf.setTextColor(15, 23, 42);
  canales.forEach(([lbl, key, mon, espLive]) => {
    const espVal = esCerrada && turno.esperado_desglose_json?.[key]?.monto !== undefined
      ? Number(turno.esperado_desglose_json[key].monto)
      : Number(espLive || 0);
    const contVal = esCerrada && turno.contado_desglose_json?.[key]?.monto !== undefined
      ? Number(turno.contado_desglose_json[key].monto)
      : (ocultarCorteX ? Number(document.getElementById(`arqueoInput_${key}`)?.value || 0) : espVal);
    const diff = contVal - espVal;
    const p = mon === 'USD' ? '$ ' : 'Bs. ';

    pdf.setDrawColor(226, 232, 240);
    pdf.line(margin, y + 6.5, pageW - margin, y + 6.5);
    pdf.setFont('helvetica', 'bold');
    pdf.text(lbl, margin + 3, y + 4.5);
    pdf.setFont('courier', 'normal');
    pdf.text(ocultarCorteX ? 'OCULTO' : `${p}${espVal.toFixed(2)}`, margin + 108, y + 4.5, { align: 'right' });
    pdf.text(`${p}${contVal.toFixed(2)}`, margin + 145, y + 4.5, { align: 'right' });
    pdf.setFont('courier', 'bold');
    pdf.text(ocultarCorteX ? 'AL CIERRE Z' : `${diff > 0.009 ? '+' : ''}${p}${diff.toFixed(2)}`, pageW - margin - 3, y + 4.5, { align: 'right' });
    y += 6.5;
  });

  if (res.desglose.CREDITO.usd > 0) {
    y += 2;
    pdf.setFont('helvetica', 'bold');
    pdf.text(`Ventas a Crédito en Turno (CxC): $ ${res.desglose.CREDITO.usd.toFixed(2)} | Bs. ${res.desglose.CREDITO.bs.toFixed(2)}`, margin + 3, y + 4);
    y += 6;
  }

  y += 6;
  if (turno.observaciones) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    const obsL = pdf.splitTextToSize(`Observaciones: ${turno.observaciones}`, contentW);
    pdf.text(obsL, margin, y);
    y += obsL.length * 4 + 4;
  }

  y += 12;
  pdf.setDrawColor(100, 116, 139);
  pdf.line(margin + 10, y, margin + 75, y);
  pdf.line(pageW - margin - 75, y, pageW - margin - 10, y);
  pdf.setFontSize(7.5);
  pdf.text(`Cajero: ${turno.usuario_nombre}`, margin + 42.5, y + 4, { align: 'center' });
  pdf.text(`Supervisor / Recibido Conforme`, pageW - margin - 42.5, y + 4, { align: 'center' });

  const fileName = `Arqueo_${turno.codigo_turno}_${esCerrada ? 'CierreZ' : 'CorteX'}.pdf`;
  if (typeof abrirVisorImpresionPdf === 'function') {
    abrirVisorImpresionPdf(pdf, fileName, tituloCorte);
  } else {
    pdf.save(fileName);
  }
}

function exportarHistorialCajasExcel() {
  if (!cajasTurnosCache || cajasTurnosCache.length === 0) {
    avisarCaja('No hay turnos de caja para exportar.', 'warning');
    return;
  }
  const matriz = [
    ['EMPRESA:', tenantActual?.razon_social || '', 'REPORTE:', 'HISTORIAL DE TURNOS Y ARQUEOS DE CAJA'],
    [],
    ['Código Turno', 'Caja', 'Sucursal', 'Operador', 'Apertura', 'Cierre', 'Fondo USD', 'Fondo Bs.', 'Ventas Netas USD', 'Ventas Netas Bs.', 'Diferencia USD', 'Estado']
  ];
  cajasTurnosCache.forEach(t => {
    matriz.push([
      t.codigo_turno,
      t.caja_nombre,
      t.sucursal_nombre || 'Sede Principal',
      t.usuario_nombre || '',
      formatearFechaHoraCaja(t.fecha_apertura),
      t.fecha_cierre ? formatearFechaHoraCaja(t.fecha_cierre) : 'ABIERTA',
      Number(t.fondo_inicial_usd || 0),
      Number(t.fondo_inicial_bs || 0),
      Number(t.ventas_total_usd || 0),
      Number(t.ventas_total_bs || 0),
      Number(t.diferencia_usd || 0),
      t.estado
    ]);
  });
  if (typeof descargarExcelMatriz === 'function') {
    descargarExcelMatriz(matriz, 'Historial_Turnos_Caja', 'TurnosCaja');
    avisarCaja('Historial de turnos de caja exportado a Excel.', 'success');
  }
}

// ==========================================
// 4. UTILIDADES SQL v110 PARA PANEL MASTER
// ==========================================

async function verificarEstadoEsquemaV110() {
  const badge = document.getElementById('v110EstadoEsquemaBadge');
  if (!badge || !supabaseClient) return;

  try {
    const rpc = await supabaseClient.rpc('mfd_estado_esquema_v110');
    if (!rpc.error && rpc.data?.cajas_turnos && rpc.data?.cajas_movimientos && rpc.data?.invoice_pagos && rpc.data?.invoices_turno_caja_id) {
      badge.textContent = 'Esquema Caja & POS v110 Activo';
      badge.className = 'px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/40';
      return;
    }
  } catch (e) {}

  try {
    const r = await supabaseClient.from('cajas_turnos').select('id').limit(1);
    if (!r.error) {
      badge.textContent = 'Esquema Caja Activo en Supabase';
      badge.className = 'px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/40';
      return;
    }
  } catch (e) {}

  badge.textContent = 'Pendiente ejecutar .SQL v110 (Usando respaldo Nube)';
  badge.className = 'px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold bg-amber-950 text-amber-300 border border-amber-500/40';
}

async function copiarScriptSqlV110() {
  try {
    const res = await fetch('/sql/migracion_caja_dashboard_v110.sql');
    const txt = await res.text();
    await navigator.clipboard.writeText(txt);
    avisarCaja('Script migracion_caja_dashboard_v110.sql copiado al portapapeles.', 'success', 6000);
  } catch (e) {
    avisarCaja('No se pudo copiar automáticamente; usa Descargar .SQL v110.', 'warning');
  }
}

async function descargarScriptSqlV110() {
  try {
    const res = await fetch('/sql/migracion_caja_dashboard_v110.sql');
    const txt = await res.text();
    const blob = new Blob([txt], { type: 'text/sql;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'migracion_caja_dashboard_v110.sql';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    avisarCaja('Descargado migracion_caja_dashboard_v110.sql.', 'success');
  } catch (e) {
    avisarCaja('Error al descargar el script SQL v110.', 'error');
  }
}
