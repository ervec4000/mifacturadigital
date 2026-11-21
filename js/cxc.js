/**
 * /js/cxc.js
 * Módulo Avanzado de Cuentas por Cobrar (CxC):
 * - Cartera de facturas a crédito y vencimientos (Aging 0-15 / 16-30 / 31-60 / +60d)
 * - Reporte consolidado por cliente
 * - Modal de abono detallado (moneda USD/VES, vía de pago, referencia, fecha, ingreso a caja)
 * - Historial cronológico de abonos por fechas con Conciliación Bancaria y Recibo PDF
 * - Estado de Cuenta por Cliente con Saldo Corrido Imprimible (PDF y Excel)
 */

let cxcSubtabActual = 'facturas';
let cxcFacturasCache = [];
let cxcAbonosCache = [];
let cxcClientesResumenCache = [];
let cxcEstadoCuentaCache = null;

function avisarCxc(msg, tipo = 'info', duracion = 5500) {
  if (typeof notificarSistema === 'function') notificarSistema(msg, tipo, duracion);
  else console.log(`[CXC:${tipo}]`, msg);
}

function leerAbonosCxcLocalMap(tenantId) {
  try {
    return JSON.parse(localStorage.getItem(`cxc_abonos_${tenantId}`) || '{}');
  } catch (e) { return {}; }
}

function guardarAbonoCxcLocalRegistro(tenantId, invoiceId, abonoObj) {
  try {
    const store = leerAbonosCxcLocalMap(tenantId);
    const k = String(invoiceId);
    if (!Array.isArray(store[k])) store[k] = [];
    const idx = store[k].findIndex(x => (abonoObj.id && x.id === abonoObj.id) || (abonoObj.reciboNro && x.reciboNro === abonoObj.reciboNro));
    if (idx >= 0) store[k][idx] = { ...store[k][idx], ...abonoObj };
    else store[k].push(abonoObj);
    localStorage.setItem(`cxc_abonos_${tenantId}`, JSON.stringify(store));
  } catch (e) {}
}

function formatearFechaCxc(iso) {
  if (!iso) return '--';
  const s = String(iso);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  }
  const dt = new Date(s);
  if (isNaN(dt)) return s.slice(0, 10);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatearFechaHoraCxc(iso) {
  if (!iso) return '--';
  const dt = new Date(iso);
  if (isNaN(dt)) return formatearFechaCxc(iso);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

function obtenerFechaIsoDocCxc(doc, meta) {
  const raw = doc?.fecha_emision || meta?.fechaEmision || doc?.created_at || '';
  const m = String(raw).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : new Date().toISOString().slice(0, 10);
}

function cambiarSubtabCxc(subtab = 'facturas') {
  cxcSubtabActual = subtab;
  ['facturas', 'clientes', 'historial', 'estadoCuenta'].forEach(t => {
    const panel = document.getElementById(`cxcSubPanel_${t}`);
    const btn = document.getElementById(`btnSubCxc_${t}`);
    if (panel) {
      if (t === subtab) panel.classList.remove('hidden');
      else panel.classList.add('hidden');
    }
    if (btn) {
      if (t === subtab) btn.className = 'px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 text-white cursor-pointer whitespace-nowrap';
      else btn.className = 'px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 cursor-pointer whitespace-nowrap';
    }
  });

  if (subtab === 'estadoCuenta') {
    generarEstadoCuentaClienteCxc();
  }
}

async function cargarCuentasPorCobrar() {
  if (!tenantActual || !supabaseClient) return;
  const tenantId = tenantActual.id;

  const [resInv, resAudit, resAbonos, resClientes] = await Promise.all([
    supabaseClient.from('invoices').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
    supabaseClient.from('audit_logs').select('*').eq('tenant_id', tenantId).in('accion', ['ABONO_CXC', 'CONCILIAR_ABONO_CXC']).order('created_at', { ascending: false }),
    supabaseClient.from('abonos_cxc').select('*').eq('tenant_id', tenantId).order('fecha', { ascending: false }),
    supabaseClient.from('clientes').select('id, rif, razon_social, direccion, telefono, email, condicion_credito_dias').eq('tenant_id', tenantId)
  ]);

  if (typeof sincronizarMetasNotasNube === 'function') {
    await sincronizarMetasNotasNube(tenantId);
  }

  const invAll = resInv.data || [];
  const invById = {};
  const invByNro = {};
  invAll.forEach(inv => {
    invById[String(inv.id)] = inv;
    if (inv.factura_nro) invByNro[String(inv.factura_nro)] = inv;
  });

  // Unificar historial de abonos (Tabla nativa abonos_cxc > audit_logs > localStorage)
  const mapaAbonos = new Map();
  const concilMap = new Map();

  const localMap = leerAbonosCxcLocalMap(tenantId);
  Object.entries(localMap).forEach(([invId, arr]) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((a, idx) => {
      const key = String(a.id || a.reciboNro || `${invId}_${String(a.fecha || '').slice(0, 19)}_${Number(a.montoUsd || 0).toFixed(2)}_${idx}`);
      const inv = invById[String(invId)] || invByNro[String(a.facturaNro || '')] || {};
      mapaAbonos.set(key, {
        id: a.id || key,
        reciboNro: a.reciboNro || `REC-${String(key).slice(0, 8).toUpperCase()}`,
        invoiceId: String(invId),
        facturaNro: a.facturaNro || inv.factura_nro || '--',
        clienteRif: String(a.clienteRif || inv.cliente_rif || 'S/R').toUpperCase(),
        clienteNombre: String(a.clienteNombre || inv.cliente_nombre || 'CLIENTE'),
        moneda: String(a.moneda || 'USD').toUpperCase(),
        montoUsd: Number(a.montoUsd || 0),
        montoBs: Number(a.montoBs || (Number(a.montoUsd || 0) * Number(a.tasaBcv || inv.tasa_bcv || 1))),
        tasaBcv: Number(a.tasaBcv || inv.tasa_bcv || 1),
        metodoPago: String(a.metodoPago || 'EFECTIVO DIVISAS').toUpperCase(),
        referencia: a.referencia || '',
        notas: a.notas || '',
        conciliado: Boolean(a.conciliado),
        fechaConciliacion: a.fechaConciliacion || null,
        conciliadoPor: a.conciliadoPor || null,
        bancoConciliacion: a.bancoConciliacion || null,
        usuarioNombre: a.usuarioNombre || 'Operador',
        fecha: a.fecha || new Date().toISOString(),
        origen: 'local'
      });
    });
  });

  if (!resAudit.error && Array.isArray(resAudit.data)) {
    resAudit.data.forEach(log => {
      try {
        const det = JSON.parse(log.detalle || '{}');
        if (log.accion === 'CONCILIAR_ABONO_CXC' && det.abonoKey) {
          concilMap.set(String(det.abonoKey), det);
          return;
        }
        if (log.accion === 'ABONO_CXC' && det.invoiceId && Number(det.montoUsd) > 0) {
          const key = String(det.id || det.reciboNro || `${det.invoiceId}_${String(det.fecha || log.created_at || '').slice(0, 19)}_${Number(det.montoUsd).toFixed(2)}`);
          const inv = invById[String(det.invoiceId)] || invByNro[String(det.facturaNro || '')] || {};
          mapaAbonos.set(key, {
            ...(mapaAbonos.get(key) || {}),
            id: det.id || key,
            reciboNro: det.reciboNro || `REC-${String(key).slice(0, 8).toUpperCase()}`,
            invoiceId: String(det.invoiceId),
            facturaNro: det.facturaNro || inv.factura_nro || '--',
            clienteRif: String(det.clienteRif || inv.cliente_rif || 'S/R').toUpperCase(),
            clienteNombre: String(det.clienteNombre || inv.cliente_nombre || 'CLIENTE'),
            moneda: String(det.moneda || 'USD').toUpperCase(),
            montoUsd: Number(det.montoUsd || 0),
            montoBs: Number(det.montoBs || (Number(det.montoUsd || 0) * Number(det.tasaBcv || inv.tasa_bcv || 1))),
            tasaBcv: Number(det.tasaBcv || inv.tasa_bcv || 1),
            metodoPago: String(det.metodoPago || 'ABONO').toUpperCase(),
            referencia: det.referencia || '',
            notas: det.notas || '',
            conciliado: Boolean(det.conciliado),
            fechaConciliacion: det.fechaConciliacion || null,
            conciliadoPor: det.conciliadoPor || null,
            bancoConciliacion: det.bancoConciliacion || null,
            usuarioNombre: det.usuarioNombre || 'Operador',
            fecha: det.fecha || log.created_at || new Date().toISOString(),
            origen: 'audit'
          });
        }
      } catch (e) {}
    });
  }

  if (!resAbonos.error && Array.isArray(resAbonos.data)) {
    // Si la tabla nativa tiene datos, damos prioridad a la tabla nativa evitando duplicar registros locales equivalentes
    const nativosKeys = new Set();
    resAbonos.data.forEach(a => {
      const inv = invById[String(a.invoice_id)] || {};
      const key = String(a.id || a.recibo_nro);
      const huella = `${a.invoice_id}_${String(a.fecha || '').slice(0, 16)}_${Number(a.monto_usd || 0).toFixed(2)}`;
      nativosKeys.add(huella);
      // Remover si había entrada sintética equivalente
      for (const [mk, mv] of mapaAbonos.entries()) {
        const mh = `${mv.invoiceId}_${String(mv.fecha || '').slice(0, 16)}_${Number(mv.montoUsd || 0).toFixed(2)}`;
        if (mv.origen !== 'supabase' && (mh === huella || (a.recibo_nro && mv.reciboNro === a.recibo_nro))) {
          mapaAbonos.delete(mk);
        }
      }
      mapaAbonos.set(key, {
        id: String(a.id),
        reciboNro: a.recibo_nro || `REC-${String(a.id).slice(0, 8).toUpperCase()}`,
        invoiceId: String(a.invoice_id),
        facturaNro: a.factura_nro || inv.factura_nro || '--',
        clienteRif: String(a.cliente_rif || inv.cliente_rif || 'S/R').toUpperCase(),
        clienteNombre: String(a.cliente_nombre || inv.cliente_nombre || 'CLIENTE'),
        moneda: String(a.moneda || 'USD').toUpperCase(),
        montoUsd: Number(a.monto_usd || 0),
        montoBs: Number(a.monto_bs || (Number(a.monto_usd || 0) * Number(a.tasa_bcv || 1))),
        tasaBcv: Number(a.tasa_bcv || inv.tasa_bcv || 1),
        metodoPago: String(a.metodo_pago || 'ABONO').toUpperCase(),
        referencia: a.referencia || '',
        notas: a.notas || '',
        conciliado: Boolean(a.conciliado),
        fechaConciliacion: a.fecha_conciliacion || null,
        conciliadoPor: a.conciliado_por || null,
        bancoConciliacion: a.banco_conciliacion || null,
        usuarioNombre: a.usuario_nombre || 'Operador',
        fecha: a.fecha || a.created_at || new Date().toISOString(),
        origen: 'supabase'
      });
    });
  }

  // Aplicar conciliaciones registradas en audit_logs si la columna nativa no existía
  for (const [k, ab] of mapaAbonos.entries()) {
    const ov = concilMap.get(String(ab.id)) || concilMap.get(String(ab.reciboNro));
    if (ov) {
      ab.conciliado = Boolean(ov.conciliado);
      ab.fechaConciliacion = ov.fechaConciliacion || ab.fechaConciliacion;
      ab.conciliadoPor = ov.conciliadoPor || ab.conciliadoPor;
      ab.bancoConciliacion = ov.bancoConciliacion || ab.bancoConciliacion;
    }
  }

  cxcAbonosCache = Array.from(mapaAbonos.values()).sort((a, b) =>
    String(b.fecha || '').localeCompare(String(a.fecha || ''))
  );

  // Sumar abonos por factura
  const abonosPorFactura = {};
  cxcAbonosCache.forEach(a => {
    const k = String(a.invoiceId);
    abonosPorFactura[k] = (abonosPorFactura[k] || 0) + Number(a.montoUsd || 0);
  });

  // Ajustes de NC y ND aplicadas a facturas de crédito
  const ajusteNotasPorFactura = {};
  const notasAsociadasPorFactura = {};
  invAll.forEach(doc => {
    const nro = String(doc.factura_nro || '').toUpperCase();
    if (!nro.startsWith('NC') && !nro.startsWith('ND')) return;
    const metaDoc = typeof obtenerMetaFacturaLocal === 'function' ? obtenerMetaFacturaLocal(tenantId, doc) : null;
    const facRef = metaDoc?.facturaAfectadaNro || '';
    if (!facRef) return;
    const tasaN = Math.max(0.0001, Number(doc.tasa_bcv || 1));
    const totUsdN = Number(doc.total_bs || 0) / tasaN;
    const delta = nro.startsWith('NC') ? -totUsdN : totUsdN;
    ajusteNotasPorFactura[facRef] = (ajusteNotasPorFactura[facRef] || 0) + delta;
    if (!notasAsociadasPorFactura[facRef]) notasAsociadasPorFactura[facRef] = [];
    notasAsociadasPorFactura[facRef].push({ doc, meta: metaDoc, totUsd: totUsdN, esNc: nro.startsWith('NC') });
  });

  const creditoList = invAll.filter(inv => {
    const nro = String(inv.factura_nro || '').toUpperCase();
    const est = String(inv.estado || '').toUpperCase();
    if (nro.startsWith('NC') || nro.startsWith('ND') || nro.startsWith('REV-') || est === 'ANULADA' || est === 'REVERSO') return false;
    const meta = typeof obtenerMetaFacturaLocal === 'function' ? obtenerMetaFacturaLocal(tenantId, inv) : null;
    const cond = String(inv.condicion_pago || meta?.condicionPago || '').toUpperCase();
    const met = String(inv.metodo_pago || '').toUpperCase();
    return cond.includes('CRÉDITO') || cond.includes('CREDITO') || met.includes('CRÉDITO') || met.includes('CREDITO');
  });

  const cliInfoMap = {};
  (resClientes.data || []).forEach(cl => {
    if (cl.rif) cliInfoMap[String(cl.rif).toUpperCase()] = cl;
  });

  const hoyMs = Date.now();
  cxcFacturasCache = creditoList.map(inv => {
    const meta = typeof obtenerMetaFacturaLocal === 'function' ? obtenerMetaFacturaLocal(tenantId, inv) : null;
    const fechaIso = obtenerFechaIsoDocCxc(inv, meta);
    const rif = String(inv.cliente_rif || 'S/R').toUpperCase();
    const cliObj = cliInfoMap[rif] || null;
    const diasPlazo = Number(cliObj?.condicion_credito_dias || 15) || 15;
    let fechaVenc = inv.fecha_vencimiento || meta?.fechaVencimiento || '';
    if (!fechaVenc) {
      const dV = new Date(`${fechaIso}T00:00:00`);
      dV.setDate(dV.getDate() + diasPlazo);
      fechaVenc = dV.toISOString().slice(0, 10);
    }

    const tasa = Math.max(0.0001, Number(inv.tasa_bcv || 1));
    const baseUsd = Number(inv.total_bs ? (Number(inv.total_bs) / tasa) : (inv.monto_usd || 0));
    const ajusteNotaUsd = ajusteNotasPorFactura[inv.factura_nro] || 0;
    const totalUsd = Math.max(0, baseUsd + ajusteNotaUsd);
    const abonadoUsd = Math.min(totalUsd, abonosPorFactura[String(inv.id)] || 0);
    const saldoUsd = Math.max(0, totalUsd - abonadoUsd);

    const diasTranscurridos = Math.max(0, Math.floor((hoyMs - new Date(`${fechaIso}T00:00:00`).getTime()) / 86400000));
    const diasMora = saldoUsd > 0.01 ? Math.max(0, Math.floor((hoyMs - new Date(`${fechaVenc}T00:00:00`).getTime()) / 86400000)) : 0;
    const vencida = saldoUsd > 0.01 && (diasMora > 0 || diasTranscurridos > diasPlazo);

    return {
      ...inv,
      meta,
      fechaIso,
      fechaVenc,
      diasPlazo,
      tasa,
      baseUsd,
      ajusteNotaUsd,
      totalUsd,
      abonadoUsd,
      saldoUsd,
      diasTranscurridos,
      diasMora,
      vencida,
      notasAsociadas: notasAsociadasPorFactura[inv.factura_nro] || []
    };
  });

  // Agrupación por Cliente + Aging
  const mapCli = new Map();
  cxcFacturasCache.forEach(f => {
    const rif = String(f.cliente_rif || 'S/R').toUpperCase();
    const nom = String(f.cliente_nombre || 'CLIENTE').trim();
    const key = `${rif}|${nom}`;
    if (!mapCli.has(key)) {
      const cliReg = cliInfoMap[rif] || {};
      mapCli.set(key, {
        key,
        rif,
        nombre: nom,
        telefono: cliReg.telefono || f.meta?.clienteTelefono || '',
        direccion: cliReg.direccion || f.meta?.clienteDireccion || '',
        email: cliReg.email || '',
        facturas: 0,
        facturasPendientes: 0,
        totalFacturadoUsd: 0,
        totalAbonadoUsd: 0,
        saldoPendienteUsd: 0,
        aging0_15: 0,
        aging16_30: 0,
        aging31_60: 0,
        aging60Plus: 0,
        ultimaFecha: f.fechaIso
      });
    }
    const c = mapCli.get(key);
    c.facturas += 1;
    if (f.saldoUsd > 0.01) c.facturasPendientes += 1;
    c.totalFacturadoUsd += f.totalUsd;
    c.totalAbonadoUsd += f.abonadoUsd;
    c.saldoPendienteUsd += f.saldoUsd;
    if (f.fechaIso > c.ultimaFecha) c.ultimaFecha = f.fechaIso;

    if (f.saldoUsd > 0.01) {
      if (f.diasTranscurridos <= 15) c.aging0_15 += f.saldoUsd;
      else if (f.diasTranscurridos <= 30) c.aging16_30 += f.saldoUsd;
      else if (f.diasTranscurridos <= 60) c.aging31_60 += f.saldoUsd;
      else c.aging60Plus += f.saldoUsd;
    }
  });

  cxcClientesResumenCache = Array.from(mapCli.values()).sort((a, b) => b.saldoPendienteUsd - a.saldoPendienteUsd);

  poblarSelectClientesCxc();
  renderizarModuloCxc();
}

function poblarSelectClientesCxc() {
  const selects = ['cxcFiltroCliente', 'cxcEdoCtaClienteSelect'];
  selects.forEach(selId => {
    const sel = document.getElementById(selId);
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = selId === 'cxcFiltroCliente'
      ? '<option value="">Todos los Clientes</option>'
      : '<option value="">-- Seleccionar Cliente --</option>';
    cxcClientesResumenCache.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.rif;
      opt.textContent = `${c.nombre} (${c.rif}) · Saldo: $ ${c.saldoPendienteUsd.toFixed(2)}`;
      sel.appendChild(opt);
    });
    if (prev && Array.from(sel.options).some(o => o.value === prev)) {
      sel.value = prev;
    } else if (selId === 'cxcEdoCtaClienteSelect' && cxcClientesResumenCache.length > 0) {
      sel.value = cxcClientesResumenCache[0].rif;
    }
  });
}

function obtenerFiltrosCxc() {
  return {
    texto: (document.getElementById('cxcFiltroTexto')?.value || '').trim().toLowerCase(),
    estado: document.getElementById('cxcFiltroEstado')?.value || 'TODOS',
    clienteRif: (document.getElementById('cxcFiltroCliente')?.value || '').trim().toUpperCase(),
    desde: document.getElementById('cxcFechaDesde')?.value || '',
    hasta: document.getElementById('cxcFechaHasta')?.value || ''
  };
}

function renderizarModuloCxc() {
  const f = obtenerFiltrosCxc();

  // KPIs globales (o filtrados por cliente/fecha)
  const facsFiltradas = cxcFacturasCache.filter(c => {
    if (f.clienteRif && String(c.cliente_rif || '').toUpperCase() !== f.clienteRif) return false;
    if (f.desde && c.fechaIso < f.desde) return false;
    if (f.hasta && c.fechaIso > f.hasta) return false;
    if (f.texto) {
      const blob = `${c.factura_nro} ${c.cliente_nombre} ${c.cliente_rif}`.toLowerCase();
      if (!blob.includes(f.texto)) return false;
    }
    if (f.estado === 'PENDIENTE' && c.saldoUsd <= 0.01) return false;
    if (f.estado === 'VENCIDA' && !c.vencida) return false;
    if (f.estado === 'SOLVENTE' && c.saldoUsd > 0.01) return false;
    return true;
  });

  const abonosFiltrados = cxcAbonosCache.filter(a => {
    const fAb = String(a.fecha || '').slice(0, 10);
    if (f.clienteRif && String(a.clienteRif || '').toUpperCase() !== f.clienteRif) return false;
    if (f.desde && fAb && fAb < f.desde) return false;
    if (f.hasta && fAb && fAb > f.hasta) return false;
    if (f.texto) {
      const blob = `${a.reciboNro} ${a.facturaNro} ${a.clienteNombre} ${a.clienteRif} ${a.referencia} ${a.metodoPago}`.toLowerCase();
      if (!blob.includes(f.texto)) return false;
    }
    return true;
  });

  const totCartera = facsFiltradas.reduce((s, c) => s + c.totalUsd, 0);
  const totPend = facsFiltradas.reduce((s, c) => s + c.saldoUsd, 0);
  const totVencUsd = facsFiltradas.filter(c => c.vencida).reduce((s, c) => s + c.saldoUsd, 0);
  const vencCount = facsFiltradas.filter(c => c.vencida).length;
  const totAbonos = abonosFiltrados.reduce((s, a) => s + a.montoUsd, 0);
  const concilCount = abonosFiltrados.filter(a => a.conciliado).length;

  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setTxt('cxcTotalCartera', `$ ${totCartera.toFixed(2)}`);
  setTxt('cxcPendienteCobro', `$ ${totPend.toFixed(2)}`);
  setTxt('cxcVencidasAlerta', `${vencCount} fac. ($ ${totVencUsd.toFixed(2)})`);
  setTxt('cxcTotalCobradoPeriodo', `$ ${totAbonos.toFixed(2)}`);
  setTxt('cxcCobradoSub', `${abonosFiltrados.length} abono(s) · ${concilCount} conciliado(s)`);

  // 1. Tabla Facturas Crédito
  const tbFac = document.getElementById('tablaCuentasPorCobrar');
  if (tbFac) {
    if (!facsFiltradas.length) {
      tbFac.innerHTML = `<tr><td colspan="7" class="p-5 text-center text-slate-500">No hay facturas a crédito que coincidan con el filtro.</td></tr>`;
    } else {
      tbFac.innerHTML = facsFiltradas.map(c => {
        const estatus = c.saldoUsd <= 0.01
          ? '<span class="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 text-[10px] font-bold">SOLVENTE</span>'
          : (c.vencida
              ? `<span class="px-2 py-0.5 rounded bg-rose-950 text-rose-300 text-[10px] font-bold">VENCIDA (${c.diasMora || c.diasTranscurridos}d)</span>`
              : `<span class="px-2 py-0.5 rounded bg-amber-950 text-amber-300 text-[10px] font-bold">VIGENTE (${c.diasTranscurridos}d)</span>`);

        const accionHtml = c.saldoUsd <= 0.01
          ? `<div class="flex items-center justify-center gap-1.5">
               <span class="text-xs text-slate-500 font-mono">Liquidada</span>
               <button type="button" onclick='verComprobantePorId("${esc(c.id)}")' class="bg-slate-800 hover:bg-slate-700 text-sky-300 px-2 py-1 rounded-lg text-[11px] font-semibold cursor-pointer">Ver Fac</button>
             </div>`
          : `<div class="flex flex-wrap items-center justify-center gap-1.5">
               <input type="number" step="0.01" min="0.01" max="${c.saldoUsd.toFixed(2)}" id="abonoInput_${esc(c.id)}" value="${c.saldoUsd.toFixed(2)}" class="w-20 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs font-mono text-white tabular-nums">
               <button type="button" onclick='abonarCuentaPorCobrar("${esc(c.id)}")' title="Abono rápido en USD" class="bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap">Abono Rápido</button>
               <button type="button" onclick='abrirModalAbonoCxc("${esc(c.id)}")' title="Registrar abono con fecha, vía, Bs/USD y referencia" class="bg-sky-700 hover:bg-sky-600 text-white px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap">+ Detallado</button>
             </div>`;

        return `
          <tr class="hover:bg-slate-900 border-b border-slate-800/40">
            <td class="p-3 font-mono font-bold text-white">${esc(c.factura_nro)}<div class="text-[11px] text-slate-400 font-normal">Em: ${formatearFechaCxc(c.fechaIso)} · Venc: ${formatearFechaCxc(c.fechaVenc)}</div></td>
            <td class="p-3 text-slate-200">${esc(c.cliente_nombre)}<div class="text-[11px] font-mono text-slate-500">${esc(c.cliente_rif)}</div></td>
            <td class="p-3 font-mono tabular-nums text-slate-300">$ ${c.totalUsd.toFixed(2)}</td>
            <td class="p-3 font-mono tabular-nums text-emerald-400">$ ${c.abonadoUsd.toFixed(2)}</td>
            <td class="p-3 font-mono tabular-nums font-bold ${c.saldoUsd > 0.01 ? 'text-amber-300' : 'text-emerald-400'}">$ ${c.saldoUsd.toFixed(2)}</td>
            <td class="p-3 text-xs">${estatus}</td>
            <td class="p-3 text-center">${accionHtml}</td>
          </tr>
        `;
      }).join('');
    }
  }

  // 2. Tabla Reporte Consolidado por Cliente & Antigüedad (Aging)
  const tbCli = document.getElementById('tablaCxcClientesAging');
  if (tbCli) {
    const cliList = cxcClientesResumenCache.filter(c => {
      if (f.clienteRif && c.rif !== f.clienteRif) return false;
      if (f.texto && !`${c.nombre} ${c.rif}`.toLowerCase().includes(f.texto)) return false;
      if (f.estado === 'PENDIENTE' && c.saldoPendienteUsd <= 0.01) return false;
      if (f.estado === 'SOLVENTE' && c.saldoPendienteUsd > 0.01) return false;
      if (f.estado === 'VENCIDA' && (c.aging16_30 + c.aging31_60 + c.aging60Plus) <= 0.01) return false;
      return true;
    });

    if (!cliList.length) {
      tbCli.innerHTML = `<tr><td colspan="9" class="p-5 text-center text-slate-500">Sin clientes con movimientos a crédito en este filtro.</td></tr>`;
    } else {
      tbCli.innerHTML = cliList.map(c => `
        <tr class="hover:bg-slate-900 border-b border-slate-800/40">
          <td class="p-3 text-white font-medium">${esc(c.nombre)}<div class="text-[11px] font-mono text-slate-400">${esc(c.rif)} · ${c.facturas} fac(s)</div></td>
          <td class="p-3 text-right font-mono text-slate-300">$ ${c.totalFacturadoUsd.toFixed(2)}</td>
          <td class="p-3 text-right font-mono text-emerald-400">$ ${c.totalAbonadoUsd.toFixed(2)}</td>
          <td class="p-3 text-right font-mono font-bold ${c.saldoPendienteUsd > 0.01 ? 'text-amber-300' : 'text-emerald-400'}">$ ${c.saldoPendienteUsd.toFixed(2)}</td>
          <td class="p-3 text-right font-mono text-slate-200">$ ${c.aging0_15.toFixed(2)}</td>
          <td class="p-3 text-right font-mono text-amber-300">$ ${c.aging16_30.toFixed(2)}</td>
          <td class="p-3 text-right font-mono text-orange-400">$ ${c.aging31_60.toFixed(2)}</td>
          <td class="p-3 text-right font-mono text-rose-400 font-bold">$ ${c.aging60Plus.toFixed(2)}</td>
          <td class="p-3 text-center whitespace-nowrap">
            <button type="button" onclick='abrirEstadoCuentaDeCliente("${esc(c.rif)}")' class="bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer">Estado de Cuenta</button>
          </td>
        </tr>
      `).join('');
    }
  }

  // 3. Tabla Historial de Abonos y Conciliación
  const tbAb = document.getElementById('tablaCxcHistorialAbonos');
  if (tbAb) {
    if (!abonosFiltrados.length) {
      tbAb.innerHTML = `<tr><td colspan="8" class="p-5 text-center text-slate-500">Sin abonos registrados en el período seleccionado.</td></tr>`;
    } else {
      tbAb.innerHTML = abonosFiltrados.map(a => {
        const concBadge = a.conciliado
          ? `<span class="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">CONCILIADO</span><div class="text-[10px] text-slate-400 mt-0.5">${esc(a.bancoConciliacion || a.conciliadoPor || '')}</div>`
          : `<span class="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-500/30 text-[10px] font-bold">POR CONCILIAR</span>`;
        return `
          <tr class="hover:bg-slate-900 border-b border-slate-800/40">
            <td class="p-3 font-mono text-xs text-slate-300">${formatearFechaHoraCxc(a.fecha)}<div class="text-[10px] text-emerald-400 font-bold">${esc(a.reciboNro)}</div></td>
            <td class="p-3 font-mono font-bold text-white">${esc(a.facturaNro)}</td>
            <td class="p-3 text-slate-200">${esc(a.clienteNombre)}<div class="text-[10px] font-mono text-slate-500">${esc(a.clienteRif)}</div></td>
            <td class="p-3 text-xs text-slate-300">${esc(a.metodoPago)}<div class="text-[10px] font-mono text-slate-400">${a.referencia ? 'Ref: ' + esc(a.referencia) : 'Sin ref.'}</div></td>
            <td class="p-3 text-right font-mono font-bold text-emerald-400">$ ${a.montoUsd.toFixed(2)}<div class="text-[10px] text-slate-400 font-normal">Bs. ${a.montoBs.toFixed(2)}</div></td>
            <td class="p-3 text-xs text-slate-400">${esc(a.usuarioNombre || '--')}</td>
            <td class="p-3 text-center">${concBadge}</td>
            <td class="p-3 text-center whitespace-nowrap space-x-1">
              <button type="button" onclick='toggleConciliacionAbonoCxc("${esc(a.id)}")' class="px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer ${a.conciliado ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-emerald-700 hover:bg-emerald-600 text-white'}">${a.conciliado ? 'Desconciliar' : 'Conciliar'}</button>
              <button type="button" onclick='imprimirReciboAbonoCxcPdf("${esc(a.id)}")' class="bg-slate-800 hover:bg-slate-700 text-sky-300 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer">Recibo PDF</button>
            </td>
          </tr>
        `;
      }).join('');
    }
  }

  if (cxcSubtabActual === 'estadoCuenta') {
    generarEstadoCuentaClienteCxc();
  }
}

function abrirEstadoCuentaDeCliente(rif) {
  const sel = document.getElementById('cxcEdoCtaClienteSelect');
  if (sel) sel.value = String(rif || '').toUpperCase();
  cambiarSubtabCxc('estadoCuenta');
}

// ==========================================
// MODAL ABONO DETALLADO + ABONO RÁPIDO
// ==========================================

function abrirModalAbonoCxc(invoiceId) {
  const item = cxcFacturasCache.find(c => String(c.id) === String(invoiceId));
  if (!item) return;

  const modal = document.getElementById('modalAbonoCxcDetallado');
  if (!modal) return;

  document.getElementById('cxcModalInvoiceId').value = item.id;
  document.getElementById('cxcModalInfoFactura').textContent = `${item.factura_nro} · ${item.cliente_nombre} (${item.cliente_rif}) · Saldo: $ ${item.saldoUsd.toFixed(2)}`;
  document.getElementById('cxcModalFecha').value = new Date().toISOString().slice(0, 10);
  document.getElementById('cxcModalMoneda').value = 'USD';
  const tasa = parseFloat(document.getElementById('tasaBcv')?.value || item.tasa || 1) || 1;
  document.getElementById('cxcModalTasaBcv').value = tasa.toFixed(4);
  document.getElementById('cxcModalMonto').value = item.saldoUsd.toFixed(2);
  document.getElementById('cxcModalReferencia').value = '';
  document.getElementById('cxcModalNotas').value = '';
  const chkCaja = document.getElementById('cxcModalIngresoCaja');
  if (chkCaja) chkCaja.checked = typeof cajaTurnoActivoCache !== 'undefined' && Boolean(cajaTurnoActivoCache);

  // Poblar vías de pago desde POS si existe
  const orig = document.getElementById('metodoPagoSelect');
  const dst = document.getElementById('cxcModalMetodo');
  if (orig && dst && orig.options.length > 0) {
    dst.innerHTML = orig.innerHTML;
  }

  recalcularEquivalenteModalAbonoCxc();
  modal.classList.remove('hidden');
}

function cerrarModalAbonoCxc() {
  document.getElementById('modalAbonoCxcDetallado')?.classList.add('hidden');
}

function recalcularEquivalenteModalAbonoCxc() {
  const mon = document.getElementById('cxcModalMoneda')?.value || 'USD';
  const monto = parseFloat(document.getElementById('cxcModalMonto')?.value || '0') || 0;
  const tasa = Math.max(0.0001, parseFloat(document.getElementById('cxcModalTasaBcv')?.value || '1') || 1);
  const el = document.getElementById('cxcModalEquivalenteTxt');
  if (!el) return;
  if (mon === 'USD') {
    el.textContent = `Equivalente: Bs. ${(monto * tasa).toFixed(2)} (@ ${tasa.toFixed(4)})`;
  } else {
    el.textContent = `Equivalente: $ ${(monto / tasa).toFixed(2)} (@ ${tasa.toFixed(4)})`;
  }
}

async function registrarAbonoCxcInterno(item, opts) {
  const tenantId = tenantActual.id;
  const actorCxc = typeof obtenerActorActual === 'function' ? obtenerActorActual() : null;
  const actorCxcUuid = actorCxc?.usuarioId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(actorCxc.usuarioId))
    ? actorCxc.usuarioId
    : null;

  const tasa = Math.max(0.0001, Number(opts.tasaBcv || item.tasa || 1));
  const moneda = String(opts.moneda || 'USD').toUpperCase();
  const montoOriginal = Number(opts.montoOriginal || opts.montoUsd || 0);
  const montoUsdRaw = moneda === 'USD' ? montoOriginal : (montoOriginal / tasa);
  const montoAplicadoUsd = Math.min(montoUsdRaw, item.saldoUsd);
  const montoAplicadoBs = montoAplicadoUsd * tasa;

  if (montoAplicadoUsd <= 0) {
    avisarCxc('Ingresa un monto de abono válido mayor a 0.', 'warning');
    return false;
  }

  const abonoId = typeof generarUuidLocal === 'function' ? generarUuidLocal() : `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const reciboNro = `REC-CXC-${String(cxcAbonosCache.length + 1).padStart(5, '0')}`;
  const fechaIso = opts.fecha ? (opts.fecha.length === 10 ? `${opts.fecha}T${new Date().toISOString().slice(11)}` : opts.fecha) : new Date().toISOString();
  const turnoId = opts.registrarEnCaja && typeof cajaTurnoActivoCache !== 'undefined' && cajaTurnoActivoCache?.id
    ? cajaTurnoActivoCache.id
    : null;

  const abonoObj = {
    id: abonoId,
    reciboNro,
    invoiceId: item.id,
    facturaNro: item.factura_nro,
    clienteRif: item.cliente_rif,
    clienteNombre: item.cliente_nombre,
    moneda,
    montoOriginal: Number(montoOriginal.toFixed(2)),
    montoUsd: Number(montoAplicadoUsd.toFixed(2)),
    montoBs: Number(montoAplicadoBs.toFixed(2)),
    tasaBcv: Number(tasa.toFixed(4)),
    metodoPago: String(opts.metodoPago || 'EFECTIVO DIVISAS').toUpperCase(),
    referencia: opts.referencia || '',
    notas: opts.notas || '',
    conciliado: Boolean(opts.conciliado),
    fechaConciliacion: opts.conciliado ? new Date().toISOString() : null,
    conciliadoPor: opts.conciliado ? (actorCxc?.usuarioNombre || 'Operador') : null,
    turnoCajaId: turnoId,
    fecha: fechaIso,
    usuarioNombre: actorCxc?.usuarioNombre || tenantActual?.razon_social || 'Operador'
  };

  guardarAbonoCxcLocalRegistro(tenantId, item.id, abonoObj);

  // Persistir en tabla nativa abonos_cxc (con fallback si v120 aún no se ejecuta)
  try {
    const baseRow = {
      tenant_id: tenantId,
      invoice_id: item.id,
      factura_nro: item.factura_nro,
      cliente_rif: item.cliente_rif,
      cliente_nombre: item.cliente_nombre,
      monto_usd: abonoObj.montoUsd,
      tasa_bcv: abonoObj.tasaBcv,
      metodo_pago: abonoObj.metodoPago,
      usuario_id: actorCxcUuid,
      usuario_nombre: abonoObj.usuarioNombre,
      fecha: fechaIso
    };
    const extRow = {
      ...baseRow,
      id: abonoId,
      recibo_nro: reciboNro,
      moneda,
      monto_bs: abonoObj.montoBs,
      referencia: abonoObj.referencia || null,
      notas: abonoObj.notas || null,
      conciliado: abonoObj.conciliado,
      fecha_conciliacion: abonoObj.fechaConciliacion,
      conciliado_por: abonoObj.conciliadoPor,
      turno_caja_id: turnoId
    };
    const rExt = await supabaseClient.from('abonos_cxc').insert([extRow]);
    if (rExt.error) {
      await supabaseClient.from('abonos_cxc').insert([baseRow]);
    }
  } catch (e) {}

  await supabaseClient.from('audit_logs').insert([{
    tenant_id: tenantId,
    accion: 'ABONO_CXC',
    detalle: JSON.stringify(abonoObj)
  }]);

  // Si hay turno de caja abierto y el operador marcó ingreso a caja
  if (turnoId && typeof persistirMovimientoCaja === 'function') {
    await persistirMovimientoCaja({
      id: typeof generarUuidLocal === 'function' ? generarUuidLocal() : `${Date.now()}`,
      tenant_id: tenantId,
      turno_id: turnoId,
      tipo: 'INGRESO',
      concepto: `Abono CxC ${reciboNro} · Fac ${item.factura_nro} (${item.cliente_nombre})`,
      categoria: 'COBRANZA_CXC',
      moneda,
      monto: moneda === 'USD' ? abonoObj.montoUsd : Number(abonoObj.montoBs.toFixed(2)),
      monto_usd: abonoObj.montoUsd,
      monto_bs: abonoObj.montoBs,
      tasa_bcv: abonoObj.tasaBcv,
      referencia: abonoObj.referencia || reciboNro,
      usuario_id: actorCxcUuid,
      usuario_nombre: abonoObj.usuarioNombre,
      fecha: fechaIso,
      created_at: new Date().toISOString()
    });
  }

  if (typeof registrarAsientoAutomaticoAbonoCxc === 'function') {
    await registrarAsientoAutomaticoAbonoCxc({
      invoiceId: item.id,
      facturaNro: item.factura_nro,
      clienteRif: item.cliente_rif,
      clienteNombre: item.cliente_nombre,
      montoUsd: abonoObj.montoUsd,
      tasaBcv: abonoObj.tasaBcv,
      fecha: fechaIso.slice(0, 10)
    });
  }

  avisarCxc(`Recibo ${reciboNro} ($ ${abonoObj.montoUsd.toFixed(2)}) aplicado a factura ${item.factura_nro}.`, 'success', 6000);
  await cargarCuentasPorCobrar();
  return abonoObj;
}

async function abonarCuentaPorCobrar(invoiceId) {
  if (!tenantActual) return;
  const item = cxcFacturasCache.find(c => String(c.id) === String(invoiceId));
  if (!item) return;

  const input = document.getElementById(`abonoInput_${invoiceId}`);
  const montoUsd = parseFloat(input?.value || item.saldoUsd) || 0;
  const tasaPos = parseFloat(document.getElementById('tasaBcv')?.value || item.tasa || 1) || 1;
  await registrarAbonoCxcInterno(item, {
    moneda: 'USD',
    montoOriginal: montoUsd,
    tasaBcv: tasaPos,
    metodoPago: 'EFECTIVO DIVISAS',
    fecha: new Date().toISOString().slice(0, 10),
    registrarEnCaja: false
  });
}

async function guardarAbonoCxcDetallado(e) {
  if (e) e.preventDefault();
  if (!tenantActual) return;

  const invoiceId = document.getElementById('cxcModalInvoiceId')?.value || '';
  const item = cxcFacturasCache.find(c => String(c.id) === String(invoiceId));
  if (!item) return;

  const res = await registrarAbonoCxcInterno(item, {
    fecha: document.getElementById('cxcModalFecha')?.value || new Date().toISOString().slice(0, 10),
    metodoPago: document.getElementById('cxcModalMetodo')?.value || 'EFECTIVO DIVISAS',
    moneda: document.getElementById('cxcModalMoneda')?.value || 'USD',
    montoOriginal: parseFloat(document.getElementById('cxcModalMonto')?.value || '0') || 0,
    tasaBcv: parseFloat(document.getElementById('cxcModalTasaBcv')?.value || '1') || 1,
    referencia: (document.getElementById('cxcModalReferencia')?.value || '').trim(),
    notas: (document.getElementById('cxcModalNotas')?.value || '').trim(),
    registrarEnCaja: Boolean(document.getElementById('cxcModalIngresoCaja')?.checked),
    conciliado: Boolean(document.getElementById('cxcModalConciliado')?.checked)
  });

  if (res) {
    cerrarModalAbonoCxc();
  }
}

// ==========================================
// CONCILIACIÓN DE ABONOS Y RECIBO PDF
// ==========================================

async function toggleConciliacionAbonoCxc(abonoId) {
  if (!tenantActual) return;
  const ab = cxcAbonosCache.find(x => String(x.id) === String(abonoId));
  if (!ab) return;

  const nuevoEst = !ab.conciliado;
  const actor = typeof obtenerActorActual === 'function' ? obtenerActorActual() : null;
  const fechaConc = nuevoEst ? new Date().toISOString() : null;
  const quien = nuevoEst ? (actor?.usuarioNombre || tenantActual.razon_social || 'Auditor') : null;

  ab.conciliado = nuevoEst;
  ab.fechaConciliacion = fechaConc;
  ab.conciliadoPor = quien;

  guardarAbonoCxcLocalRegistro(tenantActual.id, ab.invoiceId, ab);

  try {
    if (/^[0-9a-f-]{36}$/i.test(String(ab.id))) {
      await supabaseClient.from('abonos_cxc').update({
        conciliado: nuevoEst,
        fecha_conciliacion: fechaConc,
        conciliado_por: quien
      }).eq('id', ab.id).eq('tenant_id', tenantActual.id);
    }
  } catch (e) {}

  await supabaseClient.from('audit_logs').insert([{
    tenant_id: tenantActual.id,
    accion: 'CONCILIAR_ABONO_CXC',
    detalle: JSON.stringify({
      abonoKey: ab.id,
      reciboNro: ab.reciboNro,
      conciliado: nuevoEst,
      fechaConciliacion: fechaConc,
      conciliadoPor: quien
    })
  }]);

  avisarCxc(nuevoEst ? `Abono ${ab.reciboNro} marcado como CONCILIADO.` : `Abono ${ab.reciboNro} devuelto a PENDIENTE DE CONCILIACIÓN.`, 'success');
  renderizarModuloCxc();
}

function imprimirReciboAbonoCxcPdf(abonoId) {
  const ab = cxcAbonosCache.find(x => String(x.id) === String(abonoId));
  if (!ab || !window.jspdf?.jsPDF) {
    avisarCxc('No se pudo generar el recibo PDF.', 'warning');
    return;
  }

  const fac = cxcFacturasCache.find(f => String(f.id) === String(ab.invoiceId));
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: [80, 145] });
  let y = 9;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9.5);
  pdf.text(String(tenantActual?.razon_social || 'MI EMPRESA').toUpperCase(), 40, y, { align: 'center', maxWidth: 72 });
  y += 5;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.text(`RIF: ${tenantActual?.rif || ''}`, 40, y, { align: 'center' });
  y += 4;
  pdf.line(4, y, 76, y);
  y += 5;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.text('RECIBO DE ABONO A CUENTA', 40, y, { align: 'center' });
  y += 4.5;
  pdf.setFont('courier', 'bold');
  pdf.setFontSize(8);
  pdf.text(`Recibo: ${ab.reciboNro}`, 4, y); y += 3.8;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.text(`Fecha: ${formatearFechaHoraCxc(ab.fecha)}`, 4, y); y += 3.8;
  pdf.text(`Cliente: ${ab.clienteNombre}`, 4, y, { maxWidth: 72 }); y += 4.2;
  pdf.text(`RIF/CI: ${ab.clienteRif}`, 4, y); y += 3.8;
  pdf.text(`Factura Aplicada: ${ab.facturaNro}`, 4, y); y += 4.5;

  pdf.line(4, y, 76, y);
  y += 4.5;
  pdf.setFont('helvetica', 'bold');
  pdf.text(`Monto Abonado USD:`, 4, y);
  pdf.text(`$ ${ab.montoUsd.toFixed(2)}`, 76, y, { align: 'right' }); y += 4;
  pdf.setFont('helvetica', 'normal');
  pdf.text(`Equivalente Bs.:`, 4, y);
  pdf.text(`Bs. ${ab.montoBs.toFixed(2)}`, 76, y, { align: 'right' }); y += 4;
  pdf.text(`Vía de Pago:`, 4, y);
  pdf.text(String(ab.metodoPago).slice(0, 20), 76, y, { align: 'right' }); y += 4;
  if (ab.referencia) {
    pdf.text(`Referencia:`, 4, y);
    pdf.text(String(ab.referencia).slice(0, 22), 76, y, { align: 'right' }); y += 4;
  }
  if (fac) {
    pdf.text(`Saldo Restante Fac.:`, 4, y);
    pdf.text(`$ ${fac.saldoUsd.toFixed(2)}`, 76, y, { align: 'right' }); y += 4.5;
  }
  pdf.line(4, y, 76, y);
  y += 4.5;
  pdf.setFontSize(7);
  pdf.text(`Estado: ${ab.conciliado ? 'CONCILIADO' : 'REGISTRADO'}`, 4, y); y += 3.5;
  pdf.text(`Recibido por: ${ab.usuarioNombre || 'Operador'}`, 4, y);
  if (ab.notas) {
    y += 4;
    pdf.text(`Nota: ${ab.notas}`, 4, y, { maxWidth: 72 });
  }

  const fname = `${ab.reciboNro}.pdf`;
  if (typeof abrirVisorImpresionPdf === 'function') abrirVisorImpresionPdf(pdf, fname, `Recibo ${ab.reciboNro}`);
  else pdf.save(fname);
}

// ==========================================
// ESTADO DE CUENTA POR CLIENTE (SALDO CORRIDO)
// ==========================================

function generarEstadoCuentaClienteCxc() {
  const rifSel = (document.getElementById('cxcEdoCtaClienteSelect')?.value || '').trim().toUpperCase();
  const fDesde = document.getElementById('cxcEdoCtaDesde')?.value || '';
  const fHasta = document.getElementById('cxcEdoCtaHasta')?.value || '';
  const tbody = document.getElementById('tablaCxcEstadoCuenta');
  if (!tbody) return;

  if (!rifSel) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-5 text-center text-slate-500">Selecciona un cliente para consultar su Estado de Cuenta con saldo corrido.</td></tr>`;
    cxcEstadoCuentaCache = null;
    return;
  }

  const cliInfo = cxcClientesResumenCache.find(c => c.rif === rifSel) || { rif: rifSel, nombre: rifSel, telefono: '', direccion: '' };
  const movs = [];

  // Facturas a crédito y Notas NC/ND vinculadas del cliente
  cxcFacturasCache
    .filter(f => String(f.cliente_rif || '').toUpperCase() === rifSel)
    .forEach(f => {
      movs.push({
        fechaSort: f.created_at || `${f.fechaIso}T00:00:00Z`,
        fecha: f.fechaIso,
        documento: f.factura_nro,
        tipo: 'FACTURA CRÉDITO',
        detalle: `Vence: ${formatearFechaCxc(f.fechaVenc)} · Ctrl: ${f.nro_control || 'N/A'}`,
        cargoUsd: f.baseUsd,
        abonoUsd: 0
      });
      (f.notasAsociadas || []).forEach(n => {
        const fN = obtenerFechaIsoDocCxc(n.doc, n.meta);
        movs.push({
          fechaSort: n.doc.created_at || `${fN}T00:00:00Z`,
          fecha: fN,
          documento: n.doc.factura_nro,
          tipo: n.esNc ? 'NOTA DE CRÉDITO' : 'NOTA DE DÉBITO',
          detalle: `Afecta ${f.factura_nro}`,
          cargoUsd: n.esNc ? 0 : n.totUsd,
          abonoUsd: n.esNc ? n.totUsd : 0
        });
      });
    });

  // Abonos del cliente
  cxcAbonosCache
    .filter(a => String(a.clienteRif || '').toUpperCase() === rifSel)
    .forEach(a => {
      const fA = String(a.fecha || '').slice(0, 10);
      movs.push({
        fechaSort: a.fecha || `${fA}T12:00:00Z`,
        fecha: fA,
        documento: a.reciboNro,
        tipo: 'ABONO / RECIBO',
        detalle: `${a.metodoPago}${a.referencia ? ' · Ref: ' + a.referencia : ''} · Fac ${a.facturaNro} (${a.conciliado ? 'Conciliado' : 'Pend.'})`,
        cargoUsd: 0,
        abonoUsd: a.montoUsd
      });
    });

  movs.sort((a, b) => String(a.fechaSort).localeCompare(String(b.fechaSort)));

  let saldoAnterior = 0;
  let cargosPeriodo = 0;
  let abonosPeriodo = 0;
  const filasPeriodo = [];

  movs.forEach(m => {
    if (fDesde && m.fecha < fDesde) {
      saldoAnterior += (m.cargoUsd - m.abonoUsd);
      return;
    }
    if (fHasta && m.fecha > fHasta) return;
    cargosPeriodo += m.cargoUsd;
    abonosPeriodo += m.abonoUsd;
    filasPeriodo.push(m);
  });

  let corrido = saldoAnterior;
  filasPeriodo.forEach(m => {
    corrido += (m.cargoUsd - m.abonoUsd);
    m.saldoCorridoUsd = corrido;
  });

  const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  setTxt('edoCtaSaldoAnterior', `$ ${saldoAnterior.toFixed(2)}`);
  setTxt('edoCtaCargosPeriodo', `$ ${cargosPeriodo.toFixed(2)}`);
  setTxt('edoCtaAbonosPeriodo', `$ ${abonosPeriodo.toFixed(2)}`);
  setTxt('edoCtaSaldoFinal', `$ ${corrido.toFixed(2)}`);

  cxcEstadoCuentaCache = {
    cliente: cliInfo,
    fDesde,
    fHasta,
    saldoAnterior,
    cargosPeriodo,
    abonosPeriodo,
    saldoFinal: corrido,
    filas: filasPeriodo
  };

  if (!filasPeriodo.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-5 text-center text-slate-500">Sin movimientos en este rango. Saldo Anterior: $ ${saldoAnterior.toFixed(2)}</td></tr>`;
    return;
  }

  tbody.innerHTML = filasPeriodo.map(m => {
    const colTipo = m.cargoUsd > 0 ? 'text-amber-300' : 'text-emerald-400';
    return `
      <tr class="hover:bg-slate-900 border-b border-slate-800/40">
        <td class="p-3 font-mono text-xs text-slate-300">${formatearFechaCxc(m.fecha)}</td>
        <td class="p-3 font-mono font-bold text-white">${esc(m.documento)}</td>
        <td class="p-3 text-xs font-semibold ${colTipo}">${esc(m.tipo)}</td>
        <td class="p-3 text-xs text-slate-300">${esc(m.detalle)}</td>
        <td class="p-3 text-right font-mono text-amber-300">${m.cargoUsd > 0 ? '$ ' + m.cargoUsd.toFixed(2) : '--'}</td>
        <td class="p-3 text-right font-mono text-emerald-400">${m.abonoUsd > 0 ? '$ ' + m.abonoUsd.toFixed(2) : '--'}</td>
        <td class="p-3 text-right font-mono font-bold text-white">$ ${m.saldoCorridoUsd.toFixed(2)}</td>
      </tr>
    `;
  }).join('');
}

function imprimirEstadoCuentaClientePdf() {
  const ec = cxcEstadoCuentaCache;
  if (!ec || !window.jspdf?.jsPDF) {
    avisarCxc('Selecciona un cliente con movimientos antes de imprimir.', 'warning');
    return;
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' });
  const margin = 14;
  const pageW = pdf.internal.pageSize.getWidth();
  const contentW = pageW - margin * 2;
  let y = 16;

  pdf.setFillColor(15, 23, 42);
  pdf.rect(margin, y - 4, contentW, 20, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text(String(tenantActual?.razon_social || 'MI EMPRESA').toUpperCase(), margin + 4, y + 3);
  pdf.setFontSize(9);
  pdf.setTextColor(16, 185, 129);
  pdf.text('ESTADO DE CUENTA POR COBRAR (CXC)', margin + 4, y + 9.5);
  pdf.setTextColor(203, 213, 225);
  pdf.text(`RIF: ${tenantActual?.rif || ''}`, pageW - margin - 4, y + 3, { align: 'right' });
  pdf.text(`Emisión: ${formatearFechaCxc(new Date().toISOString())}`, pageW - margin - 4, y + 9.5, { align: 'right' });
  y += 22;

  pdf.setTextColor(15, 23, 42);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9.5);
  pdf.text(`Cliente: ${ec.cliente.nombre}`, margin, y);
  pdf.text(`RIF / C.I.: ${ec.cliente.rif}`, pageW - margin, y, { align: 'right' });
  y += 5;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.text(`Período: ${ec.fDesde ? formatearFechaCxc(ec.fDesde) : 'Inicio'} al ${ec.fHasta ? formatearFechaCxc(ec.fHasta) : 'Hoy'}`, margin, y);
  if (ec.cliente.telefono) pdf.text(`Tel: ${ec.cliente.telefono}`, pageW - margin, y, { align: 'right' });
  y += 6;

  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(203, 213, 225);
  pdf.roundedRect(margin, y, contentW, 14, 2, 2, 'FD');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.text(`Saldo Anterior: $ ${ec.saldoAnterior.toFixed(2)}`, margin + 4, y + 5.5);
  pdf.text(`Cargos (+): $ ${ec.cargosPeriodo.toFixed(2)}`, margin + 62, y + 5.5);
  pdf.text(`Abonos/NC (-): $ ${ec.abonosPeriodo.toFixed(2)}`, margin + 112, y + 5.5);
  pdf.setTextColor(4, 120, 87);
  pdf.text(`SALDO ACTUAL: $ ${ec.saldoFinal.toFixed(2)}`, pageW - margin - 4, y + 5.5, { align: 'right' });
  y += 19;

  const pintarCabecera = () => {
    pdf.setFillColor(15, 23, 42);
    pdf.rect(margin, y, contentW, 7, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.text('Fecha', margin + 2, y + 4.8);
    pdf.text('Documento', margin + 24, y + 4.8);
    pdf.text('Tipo / Concepto', margin + 54, y + 4.8);
    pdf.text('Cargo $', margin + 138, y + 4.8, { align: 'right' });
    pdf.text('Abono $', margin + 162, y + 4.8, { align: 'right' });
    pdf.text('Saldo $', pageW - margin - 2, y + 4.8, { align: 'right' });
    y += 7;
  };
  pintarCabecera();

  pdf.setTextColor(15, 23, 42);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);

  ec.filas.forEach(m => {
    if (y > 256) {
      pdf.addPage();
      y = 16;
      pintarCabecera();
      pdf.setTextColor(15, 23, 42);
      pdf.setFont('helvetica', 'normal');
    }
    pdf.setDrawColor(226, 232, 240);
    pdf.line(margin, y + 6, pageW - margin, y + 6);
    pdf.text(formatearFechaCxc(m.fecha), margin + 2, y + 4.2);
    pdf.text(String(m.documento).slice(0, 16), margin + 24, y + 4.2);
    pdf.text(`${m.tipo} · ${m.detalle}`.slice(0, 44), margin + 54, y + 4.2);
    pdf.text(m.cargoUsd > 0 ? `$ ${m.cargoUsd.toFixed(2)}` : '--', margin + 138, y + 4.2, { align: 'right' });
    pdf.text(m.abonoUsd > 0 ? `$ ${m.abonoUsd.toFixed(2)}` : '--', margin + 162, y + 4.2, { align: 'right' });
    pdf.setFont('helvetica', 'bold');
    pdf.text(`$ ${m.saldoCorridoUsd.toFixed(2)}`, pageW - margin - 2, y + 4.2, { align: 'right' });
    pdf.setFont('helvetica', 'normal');
    y += 6;
  });

  const fname = `Estado_Cuenta_CxC_${ec.cliente.rif}.pdf`;
  if (typeof abrirVisorImpresionPdf === 'function') abrirVisorImpresionPdf(pdf, fname, `Estado de Cuenta - ${ec.cliente.nombre}`);
  else pdf.save(fname);
}

function exportarEstadoCuentaClienteExcel() {
  const ec = cxcEstadoCuentaCache;
  if (!ec || typeof XLSX === 'undefined') {
    avisarCxc('Genera primero el estado de cuenta para exportar.', 'warning');
    return;
  }
  const matriz = [
    ['ESTADO DE CUENTA CLIENTE (CXC)', tenantActual?.razon_social || ''],
    ['Cliente:', ec.cliente.nombre, 'RIF:', ec.cliente.rif],
    ['Saldo Anterior USD:', Number(ec.saldoAnterior.toFixed(2)), 'Saldo Actual USD:', Number(ec.saldoFinal.toFixed(2))],
    [],
    ['Fecha', 'Documento', 'Tipo', 'Detalle', 'Cargo ($ USD)', 'Abono ($ USD)', 'Saldo Corrido ($ USD)'],
    ...ec.filas.map(m => [
      formatearFechaCxc(m.fecha), m.documento, m.tipo, m.detalle,
      Number(m.cargoUsd.toFixed(2)), Number(m.abonoUsd.toFixed(2)), Number(m.saldoCorridoUsd.toFixed(2))
    ])
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matriz), 'EstadoCuentaCxC');
  XLSX.writeFile(wb, `Estado_Cuenta_CxC_${ec.cliente.rif}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  avisarCxc('Estado de Cuenta exportado a Excel.', 'success');
}

function imprimirReporteGlobalCxcPdf() {
  if (!cxcClientesResumenCache.length || !window.jspdf?.jsPDF) {
    avisarCxc('Sin cartera de clientes a crédito para imprimir.', 'warning');
    return;
  }
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'landscape' });
  const margin = 14;
  const pageW = pdf.internal.pageSize.getWidth();
  let y = 16;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  pdf.text(`${String(tenantActual?.razon_social || 'MI EMPRESA').toUpperCase()} — REPORTE DE ANTIGÜEDAD DE SALDOS (CXC)`, margin, y);
  y += 6;
  pdf.setFontSize(8.5);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`RIF: ${tenantActual?.rif || ''} | Fecha de Corte: ${formatearFechaCxc(new Date().toISOString())}`, margin, y);
  y += 7;

  pdf.setFillColor(15, 23, 42);
  pdf.rect(margin, y, pageW - margin * 2, 7, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.text('Cliente / RIF', margin + 2, y + 4.8);
  pdf.text('Facturado $', margin + 115, y + 4.8, { align: 'right' });
  pdf.text('Abonado $', margin + 142, y + 4.8, { align: 'right' });
  pdf.text('Saldo Total $', margin + 170, y + 4.8, { align: 'right' });
  pdf.text('0-15d', margin + 193, y + 4.8, { align: 'right' });
  pdf.text('16-30d', margin + 215, y + 4.8, { align: 'right' });
  pdf.text('31-60d', margin + 235, y + 4.8, { align: 'right' });
  pdf.text('+60d', pageW - margin - 2, y + 4.8, { align: 'right' });
  y += 7;

  pdf.setTextColor(15, 23, 42);
  pdf.setFont('helvetica', 'normal');
  cxcClientesResumenCache.forEach(c => {
    if (y > 192) { pdf.addPage(); y = 16; }
    pdf.setDrawColor(226, 232, 240);
    pdf.line(margin, y + 6, pageW - margin, y + 6);
    pdf.text(`${c.nombre.slice(0, 36)} (${c.rif})`, margin + 2, y + 4.3);
    pdf.text(`$ ${c.totalFacturadoUsd.toFixed(2)}`, margin + 115, y + 4.3, { align: 'right' });
    pdf.text(`$ ${c.totalAbonadoUsd.toFixed(2)}`, margin + 142, y + 4.3, { align: 'right' });
    pdf.setFont('helvetica', 'bold');
    pdf.text(`$ ${c.saldoPendienteUsd.toFixed(2)}`, margin + 170, y + 4.3, { align: 'right' });
    pdf.setFont('helvetica', 'normal');
    pdf.text(`$ ${c.aging0_15.toFixed(2)}`, margin + 193, y + 4.3, { align: 'right' });
    pdf.text(`$ ${c.aging16_30.toFixed(2)}`, margin + 215, y + 4.3, { align: 'right' });
    pdf.text(`$ ${c.aging31_60.toFixed(2)}`, margin + 235, y + 4.3, { align: 'right' });
    pdf.text(`$ ${c.aging60Plus.toFixed(2)}`, pageW - margin - 2, y + 4.3, { align: 'right' });
    y += 6;
  });

  const fname = `Antiguedad_Cartera_CxC_${new Date().toISOString().slice(0, 10)}.pdf`;
  if (typeof abrirVisorImpresionPdf === 'function') abrirVisorImpresionPdf(pdf, fname, 'Antigüedad de Saldos CxC');
  else pdf.save(fname);
}

function exportarCuentasPorCobrarExcel() {
  if (!tenantActual || typeof XLSX === 'undefined') return;
  if (!cxcFacturasCache.length) {
    avisarCxc('No hay cuentas por cobrar para exportar.', 'warning');
    return;
  }

  const wb = XLSX.utils.book_new();

  const hojaFacs = [
    ['CARTERA DE FACTURAS A CRÉDITO (CXC)', tenantActual.razon_social || ''],
    [],
    ['Factura', 'Fecha Emisión', 'Fecha Venc.', 'Cliente', 'RIF', 'Total USD', 'Abonado USD', 'Saldo USD', 'Días', 'Estado'],
    ...cxcFacturasCache.map(c => [
      c.factura_nro, c.fechaIso, c.fechaVenc, c.cliente_nombre, c.cliente_rif,
      Number(c.totalUsd.toFixed(2)), Number(c.abonadoUsd.toFixed(2)), Number(c.saldoUsd.toFixed(2)),
      c.diasTranscurridos, c.saldoUsd <= 0.01 ? 'SOLVENTE' : (c.vencida ? 'VENCIDA' : 'VIGENTE')
    ])
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hojaFacs), 'FacturasCredito');

  const hojaCli = [
    ['REPORTE CONSOLIDADO POR CLIENTE Y ANTIGÜEDAD (AGING)'],
    [],
    ['RIF', 'Cliente', 'Facturas', 'Total Facturado USD', 'Total Abonado USD', 'Saldo Pendiente USD', '0-15 días', '16-30 días', '31-60 días', '+60 días'],
    ...cxcClientesResumenCache.map(c => [
      c.rif, c.nombre, c.facturas, Number(c.totalFacturadoUsd.toFixed(2)), Number(c.totalAbonadoUsd.toFixed(2)),
      Number(c.saldoPendienteUsd.toFixed(2)), Number(c.aging0_15.toFixed(2)), Number(c.aging16_30.toFixed(2)),
      Number(c.aging31_60.toFixed(2)), Number(c.aging60Plus.toFixed(2))
    ])
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hojaCli), 'ResumenClientesAging');

  const hojaAb = [
    ['HISTORIAL CRONOLÓGICO DE ABONOS Y CONCILIACIÓN CXC'],
    [],
    ['Fecha', 'Recibo Nro.', 'Factura', 'RIF', 'Cliente', 'Vía de Pago', 'Referencia', 'Monto USD', 'Monto Bs.', 'Conciliado', 'Usuario'],
    ...cxcAbonosCache.map(a => [
      formatearFechaHoraCxc(a.fecha), a.reciboNro, a.facturaNro, a.clienteRif, a.clienteNombre,
      a.metodoPago, a.referencia || '', Number(a.montoUsd.toFixed(2)), Number(a.montoBs.toFixed(2)),
      a.conciliado ? 'SI' : 'NO', a.usuarioNombre || ''
    ])
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hojaAb), 'HistorialAbonos');

  XLSX.writeFile(wb, `Cuentas_Por_Cobrar_Completo_${new Date().toISOString().slice(0, 10)}.xlsx`);
  avisarCxc('Libro Excel multi-hoja de CxC descargado.', 'success');
}
