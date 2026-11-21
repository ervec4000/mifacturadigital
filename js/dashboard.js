/**
 * /js/dashboard.js
 * Dashboard Ejecutivo Gerencial (KPIs, Gráficos Chart.js, Rentabilidad PPM, Alertas)
 * y Suite de Reportes de Ventas (por Producto, Cajero, Cliente, Método de Pago y Horario).
 */

let dashChartVentas = null;
let dashChartPagos = null;
let dashChartTopProds = null;
let reportesVentasDataCache = null;
let reportesVentasTabActual = 'productos';

function avisarDash(msg, tipo = 'info', duracion = 5500) {
  if (typeof notificarSistema === 'function') notificarSistema(msg, tipo, duracion);
  else console.log(`[DASHBOARD:${tipo}]`, msg);
}

function obtenerTenantDashId() {
  return tenantActual ? (tenantActual.id || tenantActual.tenant_id || null) : null;
}

function leerStoreMetaInvoicesDash(tenantId) {
  try {
    return JSON.parse(localStorage.getItem(`facturas_seniat_meta_${tenantId}`) || '{}');
  } catch (e) { return {}; }
}

function obtenerFechaDocumentoDash(doc, meta) {
  const raw = doc.fecha_emision || meta?.fechaEmision || doc.created_at || '';
  const m = String(raw).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : new Date().toISOString().slice(0, 10);
}

function obtenerRangoPresetDash(preset) {
  const hoy = new Date();
  const hoyIso = hoy.toISOString().slice(0, 10);
  if (preset === 'HOY') return { desde: hoyIso, hasta: hoyIso };
  if (preset === '7D') {
    const d = new Date(hoy);
    d.setDate(d.getDate() - 6);
    return { desde: d.toISOString().slice(0, 10), hasta: hoyIso };
  }
  if (preset === 'MES') {
    return { desde: `${hoyIso.slice(0, 7)}-01`, hasta: hoyIso };
  }
  const d30 = new Date(hoy);
  d30.setDate(d30.getDate() - 29);
  return { desde: d30.toISOString().slice(0, 10), hasta: hoyIso };
}

function aplicarPresetDashboard(preset) {
  const sel = document.getElementById('dashPeriodoPreset');
  if (sel) sel.value = preset;
  if (preset !== 'PERSONALIZADO') {
    const r = obtenerRangoPresetDash(preset);
    if (document.getElementById('dashFechaDesde')) document.getElementById('dashFechaDesde').value = r.desde;
    if (document.getElementById('dashFechaHasta')) document.getElementById('dashFechaHasta').value = r.hasta;
  }
  cargarDashboardEjecutivo();
}

async function recopilarDatasetVentasAnalitico(tenantId, fDesde, fHasta, sucursalIdFiltro = '') {
  const storeMeta = leerStoreMetaInvoicesDash(tenantId);

  const [resInvs, resItems, resProds, resLotes, resSucs, resAbonos] = await Promise.all([
    supabaseClient.from('invoices').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(800),
    supabaseClient.from('invoice_items').select('*, productos(id, codigo_sku, descripcion, costo_unitario_usd, unidad_medida)'),
    supabaseClient.from('productos').select('*').eq('tenant_id', tenantId),
    supabaseClient.from('inventario_lotes').select('*, productos(descripcion, codigo_sku)').eq('tenant_id', tenantId),
    supabaseClient.from('sucursales').select('*').eq('tenant_id', tenantId).order('nombre', { ascending: true }),
    supabaseClient.from('abonos_cxc').select('invoice_id, monto_usd').eq('tenant_id', tenantId)
  ]);

  const invoices = resInvs.data || [];
  const prods = resProds.data || [];
  const lotes = resLotes.data || [];
  const sucursales = resSucs.data || [];

  const invIdsSet = new Set(invoices.map(i => String(i.id)));
  const itemsPorFactura = {};
  (resItems.data || []).forEach(it => {
    const k = String(it.invoice_id || '');
    if (!invIdsSet.has(k)) return;
    if (!itemsPorFactura[k]) itemsPorFactura[k] = [];
    itemsPorFactura[k].push(it);
  });

  const prodMap = {};
  prods.forEach(p => { prodMap[String(p.id)] = p; });

  const sucMap = {};
  sucursales.forEach(s => { sucMap[String(s.id)] = s.nombre; });

  const abonosMap = {};
  (resAbonos.data || []).forEach(a => {
    const k = String(a.invoice_id || '');
    abonosMap[k] = (abonosMap[k] || 0) + Number(a.monto_usd || 0);
  });

  // Fallback local para abonos si tabla aún no existe
  if (resAbonos.error) {
    try {
      const localAb = JSON.parse(localStorage.getItem(`abonos_cxc_${tenantId}`) || '{}');
      Object.entries(localAb).forEach(([invId, arr]) => {
        if (Array.isArray(arr)) {
          abonosMap[invId] = arr.reduce((s, x) => s + Number(x.montoUsd || 0), 0);
        }
      });
    } catch (e) {}
  }

  const hoyIso = new Date().toISOString().slice(0, 10);
  let ventasHoyUsd = 0;
  let ventasHoyBs = 0;
  let docsHoyCount = 0;

  let cxcPendienteUsd = 0;
  let cxcVencidasCount = 0;

  // Agregadores del período seleccionado
  let ventasPeriodoUsd = 0;
  let ventasPeriodoBs = 0;
  let costoPeriodoUsd = 0;
  let igtfPeriodoUsd = 0;
  let facturasPeriodoCount = 0;
  let notasCreditoCount = 0;
  let totalUnidadesVendidas = 0;
  let ventasContadoUsd = 0;
  let ventasCreditoUsd = 0;

  const porDia = {};
  const porMetodo = {};
  const porProducto = {};
  const porCajero = {};
  const porCliente = {};
  const porHora = {};

  const docsEnPeriodo = [];

  invoices.forEach(doc => {
    const estUpper = String(doc.estado || 'EMITIDA').toUpperCase();
    if (estUpper === 'ANULADA') return;

    const meta = storeMeta[String(doc.id)] || storeMeta[String(doc.factura_nro)] || null;
    const numUpper = String(doc.factura_nro || '').toUpperCase();
    const esNc = numUpper.startsWith('NC') || numUpper.startsWith('REV-') || estUpper === 'REVERSO';
    const esNota = numUpper.startsWith('NC') || numUpper.startsWith('ND') || numUpper.startsWith('REV-');
    const signo = esNc ? -1 : 1;

    const fechaDoc = obtenerFechaDocumentoDash(doc, meta);
    const sucIdDoc = String(doc.sucursal_id || meta?.sucursalId || '');
    const sucNombreDoc = (sucIdDoc && sucMap[sucIdDoc]) || meta?.sucursalNombre || 'Sede Principal';

    const tasa = Math.max(0.0001, Number(doc.tasa_bcv || 1));
    const totalBs = Math.abs(Number(doc.total_bs || 0));
    const totalUsd = totalBs / tasa;
    const baseNetoUsd = Math.abs(Number(doc.monto_usd || (Number(doc.subtotal_bs || 0) / tasa) || totalUsd));
    const igtfUsd = Math.abs(Number(doc.igtf_bs || 0)) / tasa;

    const partesMet = String(doc.metodo_pago || 'EFECTIVO').split('|').map(s => s.trim());
    const condRaw = doc.condicion_pago || meta?.condicionPago || (partesMet.find(p => /CR[EÉ]DITO/i.test(p)) ? 'CRÉDITO' : 'CONTADO');
    const esCredito = /CR[EÉ]DITO|CREDITO/i.test(String(condRaw));

    // CxC global viva
    if (!esNota && esCredito) {
      const abonado = Number(abonosMap[String(doc.id)] || 0);
      const saldo = Math.max(0, totalUsd - abonado);
      if (saldo > 0.01) {
        cxcPendienteUsd += saldo;
        const fRef = new Date(`${fechaDoc}T00:00:00`);
        const dias = Math.floor((Date.now() - fRef.getTime()) / (1000 * 60 * 60 * 24));
        if (dias > 15) cxcVencidasCount++;
      }
    }

    // Filtro sucursal
    if (sucursalIdFiltro && sucIdDoc !== String(sucursalIdFiltro)) return;

    // Ventas HOY (independiente del filtro de período)
    if (fechaDoc === hoyIso) {
      ventasHoyUsd += signo * totalUsd;
      ventasHoyBs += signo * totalBs;
      if (!esNc) docsHoyCount++;
    }

    // Filtro de rango de fechas del análisis
    if (fDesde && fechaDoc < fDesde) return;
    if (fHasta && fechaDoc > fHasta) return;

    docsEnPeriodo.push({ doc, meta, fechaDoc, sucNombreDoc, totalUsd, totalBs, esNc, esNota, signo, esCredito });

    ventasPeriodoUsd += signo * totalUsd;
    ventasPeriodoBs += signo * totalBs;
    igtfPeriodoUsd += signo * igtfUsd;

    if (esNc) notasCreditoCount++;
    else if (!numUpper.startsWith('ND')) facturasPeriodoCount++;

    if (esCredito) ventasCreditoUsd += signo * totalUsd;
    else ventasContadoUsd += signo * totalUsd;

    // Costo PPM de la venta
    const docItems = itemsPorFactura[String(doc.id)] || [];
    let costoDocUsd = Number(doc.costo_total_usd || 0);
    if (costoDocUsd <= 0 && docItems.length > 0) {
      docItems.forEach(it => {
        const p = prodMap[String(it.producto_id)] || it.productos || null;
        const cu = Number(it.costo_unitario_usd ?? p?.costo_unitario_usd ?? 0);
        costoDocUsd += cu * Math.abs(Number(it.cantidad || 0));
      });
    }
    // Solo si es nota de devolución o factura sumamos/restamos costo real
    const afectaCosto = !esNota || meta?.modalidad === 'DEVOLUCION';
    if (afectaCosto) {
      costoPeriodoUsd += signo * costoDocUsd;
    }

    // Por día
    if (!porDia[fechaDoc]) porDia[fechaDoc] = { fecha: fechaDoc, ventasUsd: 0, ventasBs: 0, costoUsd: 0, docs: 0 };
    porDia[fechaDoc].ventasUsd += signo * totalUsd;
    porDia[fechaDoc].ventasBs += signo * totalBs;
    if (afectaCosto) porDia[fechaDoc].costoUsd += signo * costoDocUsd;
    if (!esNc) porDia[fechaDoc].docs += 1;

    // Por método de pago (soporta pago mixto)
    const pagosMixtos = Array.isArray(doc.pago_mixto_json) && doc.pago_mixto_json.length > 0
      ? doc.pago_mixto_json
      : (Array.isArray(meta?.pagoMixto) && meta.pagoMixto.length > 0 ? meta.pagoMixto : null);

    if (pagosMixtos) {
      pagosMixtos.forEach(pm => {
        const keyMet = String(pm.metodo || 'OTROS').toUpperCase();
        if (!porMetodo[keyMet]) porMetodo[keyMet] = { metodo: keyMet, usd: 0, bs: 0, tx: 0 };
        porMetodo[keyMet].usd += signo * Number(pm.montoUsd || 0);
        porMetodo[keyMet].bs += signo * Number(pm.montoBs || 0);
        porMetodo[keyMet].tx += 1;
      });
    } else {
      const metodoLabel = esCredito ? 'CRÉDITO (CXC)' : String(partesMet[0] || 'EFECTIVO').toUpperCase();
      if (!porMetodo[metodoLabel]) porMetodo[metodoLabel] = { metodo: metodoLabel, usd: 0, bs: 0, tx: 0 };
      porMetodo[metodoLabel].usd += signo * totalUsd;
      porMetodo[metodoLabel].bs += signo * totalBs;
      porMetodo[metodoLabel].tx += 1;
    }

    // Por Cajero / Operador
    const cajeroKey = String(doc.usuario_nombre || meta?.usuarioNombre || 'Propietario / POS').trim();
    if (!porCajero[cajeroKey]) {
      porCajero[cajeroKey] = { cajero: cajeroKey, sucursal: sucNombreDoc, facturas: 0, notasNc: 0, ventaNetaUsd: 0, ventaNetaBs: 0, igtfUsd: 0 };
    }
    if (esNc) porCajero[cajeroKey].notasNc += 1;
    else porCajero[cajeroKey].facturas += 1;
    porCajero[cajeroKey].ventaNetaUsd += signo * totalUsd;
    porCajero[cajeroKey].ventaNetaBs += signo * totalBs;
    porCajero[cajeroKey].igtfUsd += signo * igtfUsd;

    // Por Cliente
    const cliRif = String(doc.cliente_rif || 'S/R').toUpperCase();
    const cliNom = String(doc.cliente_nombre || 'CONSUMIDOR FINAL');
    const cliKey = `${cliRif}|${cliNom}`;
    if (!porCliente[cliKey]) {
      porCliente[cliKey] = { rif: cliRif, nombre: cliNom, compras: 0, totalUsd: 0, totalBs: 0, ultimaFecha: fechaDoc, creditos: 0 };
    }
    if (!esNc) porCliente[cliKey].compras += 1;
    porCliente[cliKey].totalUsd += signo * totalUsd;
    porCliente[cliKey].totalBs += signo * totalBs;
    if (fechaDoc > porCliente[cliKey].ultimaFecha) porCliente[cliKey].ultimaFecha = fechaDoc;
    if (esCredito && !esNc) porCliente[cliKey].creditos += 1;

    // Por Hora del día (desde created_at)
    const dtCreated = doc.created_at ? new Date(doc.created_at) : null;
    const horaNum = dtCreated && !isNaN(dtCreated) ? dtCreated.getHours() : 12;
    const franja = `${String(horaNum).padStart(2, '0')}:00 - ${String(horaNum).padStart(2, '0')}:59`;
    if (!porHora[franja]) porHora[franja] = { horaNum, franja, docs: 0, totalUsd: 0, totalBs: 0 };
    if (!esNc) porHora[franja].docs += 1;
    porHora[franja].totalUsd += signo * totalUsd;
    porHora[franja].totalBs += signo * totalBs;

    // Por Producto
    if (docItems.length > 0 && (!esNota || meta?.modalidad === 'DEVOLUCION')) {
      docItems.forEach((it, idx) => {
        const metaIt = meta?.itemsMeta?.[idx] || null;
        const p = prodMap[String(it.producto_id)] || it.productos || null;
        const pIdKey = String(it.producto_id || metaIt?.sku || it.descripcion || idx);
        const sku = metaIt?.sku || p?.codigo_sku || 'S/N';
        const desc = metaIt?.descripcion || p?.descripcion || it.descripcion || 'Artículo';
        const cant = Math.abs(Number(it.cantidad || 0));
        const subUsd = Math.abs(Number(it.subtotal_usd ?? (cant * Number(it.precio_unitario_usd || 0))));
        const costoU = Number(it.costo_unitario_usd ?? metaIt?.costoUnitarioUsd ?? p?.costo_unitario_usd ?? 0);
        const costoTot = cant * costoU;

        if (!porProducto[pIdKey]) {
          porProducto[pIdKey] = { sku, descripcion: desc, unidad: metaIt?.unidad || p?.unidad_medida || 'UND', cantidad: 0, ventaUsd: 0, costoUsd: 0 };
        }
        porProducto[pIdKey].cantidad += signo * cant;
        porProducto[pIdKey].ventaUsd += signo * subUsd;
        porProducto[pIdKey].costoUsd += signo * costoTot;
        if (!esNc) totalUnidadesVendidas += cant;
      });
    } else if (!esNota) {
      void baseNetoUsd;
    }
  });

  // Alertas Stock Mínimo & Lotes próximos a vencer (30 días)
  const stockBajo = prods.filter(p => p.maneja_inventario !== false && Number(p.stock || 0) <= Math.max(3, Number(p.stock_minimo || 3)))
    .sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0));

  const limite30d = new Date();
  limite30d.setDate(limite30d.getDate() + 30);
  const limiteIso = limite30d.toISOString().slice(0, 10);
  const lotesPorVencer = lotes.filter(l => Number(l.stock || 0) > 0 && l.fecha_vencimiento && l.fecha_vencimiento <= limiteIso)
    .sort((a, b) => String(a.fecha_vencimiento).localeCompare(String(b.fecha_vencimiento)));

  const utilidadPeriodoUsd = ventasPeriodoUsd - igtfPeriodoUsd - costoPeriodoUsd;
  const margenPct = (ventasPeriodoUsd - igtfPeriodoUsd) > 0 ? (utilidadPeriodoUsd / (ventasPeriodoUsd - igtfPeriodoUsd)) * 100 : 0;
  const ticketPromedioUsd = facturasPeriodoCount > 0 ? (ventasPeriodoUsd / facturasPeriodoCount) : 0;

  return {
    fDesde,
    fHasta,
    sucursales,
    docsEnPeriodo,
    ventasHoyUsd,
    ventasHoyBs,
    docsHoyCount,
    ventasPeriodoUsd,
    ventasPeriodoBs,
    costoPeriodoUsd,
    utilidadPeriodoUsd,
    margenPct,
    ticketPromedioUsd,
    facturasPeriodoCount,
    notasCreditoCount,
    totalUnidadesVendidas,
    ventasContadoUsd,
    ventasCreditoUsd,
    cxcPendienteUsd,
    cxcVencidasCount,
    stockBajo,
    lotesPorVencer,
    porDia: Object.values(porDia).sort((a, b) => a.fecha.localeCompare(b.fecha)),
    porMetodo: Object.values(porMetodo).sort((a, b) => b.usd - a.usd),
    porProducto: Object.values(porProducto).sort((a, b) => b.ventaUsd - a.ventaUsd),
    porCajero: Object.values(porCajero).sort((a, b) => b.ventaNetaUsd - a.ventaNetaUsd),
    porCliente: Object.values(porCliente).sort((a, b) => b.totalUsd - a.totalUsd),
    porHora: Object.values(porHora).sort((a, b) => a.horaNum - b.horaNum)
  };
}

// ==========================================
// 1. DASHBOARD EJECUTIVO & GRÁFICOS
// ==========================================

async function cargarDashboardEjecutivo() {
  const tenantId = obtenerTenantDashId();
  if (!tenantId || !supabaseClient) return;

  const presetEl = document.getElementById('dashPeriodoPreset');
  const dDesdeEl = document.getElementById('dashFechaDesde');
  const dHastaEl = document.getElementById('dashFechaHasta');
  if (dDesdeEl && !dDesdeEl.value) {
    const r = obtenerRangoPresetDash(presetEl?.value || '30D');
    dDesdeEl.value = r.desde;
    if (dHastaEl) dHastaEl.value = r.hasta;
  }

  const fDesde = dDesdeEl?.value || '';
  const fHasta = dHastaEl?.value || '';
  const sucId = document.getElementById('dashSucursalSelect')?.value || '';

  const data = await recopilarDatasetVentasAnalitico(tenantId, fDesde, fHasta, sucId);

  // Poblar selector sucursales
  const selSuc = document.getElementById('dashSucursalSelect');
  if (selSuc) {
    const prev = selSuc.value;
    selSuc.innerHTML = '<option value="">Todas las Sucursales</option>';
    data.sucursales.forEach(s => {
      selSuc.innerHTML += `<option value="${esc(s.id)}">${esc(s.nombre)}</option>`;
    });
    if (prev) selSuc.value = prev;
  }

  // Turno caja activo
  let cajaActiva = typeof cajaTurnoActivoCache !== 'undefined' ? cajaTurnoActivoCache : null;
  if (typeof obtenerTurnoCajaActivo === 'function') {
    cajaActiva = await obtenerTurnoCajaActivo(tenantId);
  }
  let cajaUsd = 0, cajaBs = 0;
  if (cajaActiva && typeof calcularResumenTurnoVivo === 'function') {
    const resCaja = await calcularResumenTurnoVivo(cajaActiva);
    if (resCaja) {
      cajaUsd = resCaja.espEfectivoUsd;
      cajaBs = resCaja.espEfectivoBs;
    }
  }

  const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  setTxt('dashKpiVentasPeriodoUsd', `$ ${data.ventasPeriodoUsd.toFixed(2)}`);
  setTxt('dashKpiVentasPeriodoSub', `Bs. ${data.ventasPeriodoBs.toFixed(2)} · ${data.facturasPeriodoCount} facs`);
  setTxt('dashKpiVentasHoyUsd', `$ ${data.ventasHoyUsd.toFixed(2)}`);
  setTxt('dashKpiVentasHoySub', `Bs. ${data.ventasHoyBs.toFixed(2)} · ${data.docsHoyCount} doc(s) hoy`);
  setTxt('dashKpiTicketUsd', `$ ${data.ticketPromedioUsd.toFixed(2)}`);
  setTxt('dashKpiTicketSub', `${data.totalUnidadesVendidas.toFixed(0)} und. vendidas`);
  setTxt('dashKpiUtilidadUsd', `$ ${data.utilidadPeriodoUsd.toFixed(2)}`);
  setTxt('dashKpiMargenSub', `Margen bruto: ${data.margenPct.toFixed(1)}%`);

  setTxt('dashKpiContadoVsCred', `$ ${data.ventasContadoUsd.toFixed(2)}`);
  setTxt('dashKpiCreditoSub', `Crédito emitido: $ ${data.ventasCreditoUsd.toFixed(2)}`);
  setTxt('dashKpiCxcUsd', `$ ${data.cxcPendienteUsd.toFixed(2)}`);
  setTxt('dashKpiCxcSub', `${data.cxcVencidasCount} vencida(s) > 15d`);
  setTxt('dashKpiCajaUsd', cajaActiva ? `$ ${cajaUsd.toFixed(2)}` : 'Cerrada');
  setTxt('dashKpiCajaSub', cajaActiva ? `${cajaActiva.codigo_turno} · Bs. ${cajaBs.toFixed(2)}` : 'Sin turno abierto');
  setTxt('dashKpiAlertasInv', `${data.stockBajo.length + data.lotesPorVencer.length} alerta(s)`);
  setTxt('dashKpiAlertasSub', `${data.stockBajo.length} stock bajo · ${data.lotesPorVencer.length} lotes por vencer`);

  renderizarGraficosDashboard(data);
  renderizarTablasAlertasDashboard(data);
}

function renderizarGraficosDashboard(data) {
  if (typeof Chart !== 'function') return;

  // 1. Ventas diarias
  const ctxVentas = document.getElementById('chartVentasDiarias')?.getContext('2d');
  if (ctxVentas) {
    if (dashChartVentas) dashChartVentas.destroy();
    const labels = data.porDia.map(d => d.fecha.slice(5));
    const ventasVals = data.porDia.map(d => Number(d.ventasUsd.toFixed(2)));
    const utilVals = data.porDia.map(d => Number((d.ventasUsd - d.costoUsd).toFixed(2)));

    dashChartVentas = new Chart(ctxVentas, {
      type: 'bar',
      data: {
        labels: labels.length ? labels : ['Sin datos'],
        datasets: [
          { label: 'Ventas ($ USD)', data: ventasVals.length ? ventasVals : [0], backgroundColor: 'rgba(16, 185, 129, 0.75)', borderRadius: 6 },
          { label: 'Utilidad Est. ($ USD)', data: utilVals.length ? utilVals : [0], backgroundColor: 'rgba(56, 189, 248, 0.75)', borderRadius: 6 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#cbd5e1', font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(148,163,184,0.08)' } },
          y: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(148,163,184,0.1)' } }
        }
      }
    });
  }

  // 2. Métodos de pago
  const ctxPagos = document.getElementById('chartMetodosPago')?.getContext('2d');
  if (ctxPagos) {
    if (dashChartPagos) dashChartPagos.destroy();
    const canales = data.porMetodo.filter(m => m.usd > 0).slice(0, 7);
    const paleta = ['#10b981', '#0ea5e9', '#f59e0b', '#a855f7', '#ec4899', '#64748b', '#14b8a6'];
    dashChartPagos = new Chart(ctxPagos, {
      type: 'doughnut',
      data: {
        labels: canales.length ? canales.map(c => c.metodo) : ['Sin ventas'],
        datasets: [{
          data: canales.length ? canales.map(c => Number(c.usd.toFixed(2))) : [1],
          backgroundColor: canales.length ? paleta.slice(0, canales.length) : ['#334155'],
          borderColor: '#0f172a',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#cbd5e1', font: { size: 10 }, boxWidth: 12 } }
        }
      }
    });
  }

  // 3. Top 8 Productos
  const ctxProds = document.getElementById('chartTopProductos')?.getContext('2d');
  if (ctxProds) {
    if (dashChartTopProds) dashChartTopProds.destroy();
    const top8 = data.porProducto.filter(p => p.ventaUsd > 0).slice(0, 8);
    dashChartTopProds = new Chart(ctxProds, {
      type: 'bar',
      data: {
        labels: top8.length ? top8.map(p => String(p.descripcion).slice(0, 26)) : ['Sin datos'],
        datasets: [{
          label: 'Facturado ($ USD)',
          data: top8.length ? top8.map(p => Number(p.ventaUsd.toFixed(2))) : [0],
          backgroundColor: 'rgba(16, 185, 129, 0.8)',
          borderRadius: 6
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(148,163,184,0.08)' } },
          y: { ticks: { color: '#e2e8f0', font: { size: 10 } }, grid: { display: false } }
        }
      }
    });
  }
}

function renderizarTablasAlertasDashboard(data) {
  const tbStock = document.getElementById('dashAlertasStock');
  if (tbStock) {
    const filas = [];
    data.stockBajo.slice(0, 8).forEach(p => {
      const st = Number(p.stock || 0);
      const badge = st <= 0 ? '<span class="px-2 py-0.5 rounded text-[10px] bg-rose-950 text-rose-300 font-bold">AGOTADO</span>'
        : '<span class="px-2 py-0.5 rounded text-[10px] bg-amber-950 text-amber-300 font-bold">STOCK BAJO</span>';
      filas.push(`
        <tr class="border-b border-slate-800/40">
          <td class="p-2.5 text-white font-medium">${esc(p.descripcion)}<div class="text-[10px] font-mono text-slate-400">${esc(p.codigo_sku || '')}</div></td>
          <td class="p-2.5 text-right font-mono font-bold ${st <= 0 ? 'text-rose-400' : 'text-amber-300'}">${st}</td>
          <td class="p-2.5 text-right">${badge}</td>
        </tr>
      `);
    });
    data.lotesPorVencer.slice(0, 5).forEach(l => {
      filas.push(`
        <tr class="border-b border-slate-800/40">
          <td class="p-2.5 text-white font-medium">${esc(l.productos?.descripcion || 'Lote')}<div class="text-[10px] font-mono text-sky-300">Lote: ${esc(l.codigo_lote)} · Vence: ${esc(l.fecha_vencimiento)}</div></td>
          <td class="p-2.5 text-right font-mono text-slate-200">${Number(l.stock || 0)}</td>
          <td class="p-2.5 text-right"><span class="px-2 py-0.5 rounded text-[10px] bg-sky-950 text-sky-300 font-bold">POR VENCER</span></td>
        </tr>
      `);
    });
    tbStock.innerHTML = filas.length ? filas.join('') : `<tr><td colspan="3" class="p-4 text-center text-emerald-400 text-xs">Todo el inventario y lotes se encuentran en niveles óptimos.</td></tr>`;
  }

  const tbVentas = document.getElementById('dashUltimasVentas');
  if (tbVentas) {
    const ult = data.docsEnPeriodo.slice(0, 8);
    if (!ult.length) {
      tbVentas.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-500 text-xs">Sin documentos en el período seleccionado.</td></tr>`;
    } else {
      tbVentas.innerHTML = ult.map(u => `
        <tr class="border-b border-slate-800/40 hover:bg-slate-900/60">
          <td class="p-2.5 font-mono font-bold text-white">${esc(u.doc.factura_nro)}<div class="text-[10px] text-slate-400 font-normal">${esc(u.fechaDoc)}</div></td>
          <td class="p-2.5 text-slate-200">${esc(u.doc.cliente_nombre || 'CONSUMIDOR FINAL')}</td>
          <td class="p-2.5 text-right font-mono font-bold ${u.esNc ? 'text-sky-400' : 'text-emerald-400'}">${u.esNc ? '-' : ''}$ ${u.totalUsd.toFixed(2)}</td>
          <td class="p-2.5 text-center"><button type="button" onclick='verComprobantePorId("${esc(u.doc.id)}")' class="text-sky-400 hover:underline text-xs font-semibold cursor-pointer">Ver</button></td>
        </tr>
      `).join('');
    }
  }
}

// ==========================================
// 2. REPORTES GERENCIALES DE VENTAS
// ==========================================

async function cargarReportesVentasGerenciales() {
  const tenantId = obtenerTenantDashId();
  if (!tenantId || !supabaseClient) return;

  const dDesdeEl = document.getElementById('repVentasDesde');
  const dHastaEl = document.getElementById('repVentasHasta');
  if (dDesdeEl && !dDesdeEl.value) {
    const r = obtenerRangoPresetDash('MES');
    dDesdeEl.value = r.desde;
    if (dHastaEl) dHastaEl.value = r.hasta;
  }

  const fDesde = dDesdeEl?.value || '';
  const fHasta = dHastaEl?.value || '';
  const sucId = document.getElementById('repVentasSucursal')?.value || '';

  const data = await recopilarDatasetVentasAnalitico(tenantId, fDesde, fHasta, sucId);
  reportesVentasDataCache = data;

  const selSuc = document.getElementById('repVentasSucursal');
  if (selSuc) {
    const prev = selSuc.value;
    selSuc.innerHTML = '<option value="">Todas las Sucursales</option>';
    data.sucursales.forEach(s => { selSuc.innerHTML += `<option value="${esc(s.id)}">${esc(s.nombre)}</option>`; });
    if (prev) selSuc.value = prev;
  }

  const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  setTxt('repKpiVentasNetas', `$ ${data.ventasPeriodoUsd.toFixed(2)}`);
  setTxt('repKpiCostoTotal', `$ ${data.costoPeriodoUsd.toFixed(2)}`);
  setTxt('repKpiUtilidadBruta', `$ ${data.utilidadPeriodoUsd.toFixed(2)} (${data.margenPct.toFixed(1)}%)`);
  setTxt('repKpiDocsTotal', `${data.facturasPeriodoCount} facs / ${data.notasCreditoCount} NC`);

  cambiarSubtabReporteVentas(reportesVentasTabActual);
}

function cambiarSubtabReporteVentas(tab = 'productos') {
  reportesVentasTabActual = tab;
  ['productos', 'cajeros', 'clientes', 'pagos', 'horario'].forEach(t => {
    const btn = document.getElementById(`btnSubRep_${t}`);
    if (btn) {
      if (t === tab) btn.className = 'px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 text-white cursor-pointer whitespace-nowrap';
      else btn.className = 'px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 cursor-pointer whitespace-nowrap';
    }
  });

  renderizarTablaReporteVentasActivo();
}

function renderizarTablaReporteVentasActivo() {
  const thead = document.getElementById('theadReporteVentas');
  const tbody = document.getElementById('tbodyReporteVentas');
  const d = reportesVentasDataCache;
  if (!thead || !tbody || !d) return;

  if (reportesVentasTabActual === 'productos') {
    thead.innerHTML = `<tr><th class="p-3">SKU</th><th class="p-3">Artículo / Servicio</th><th class="p-3 text-right">Cant.</th><th class="p-3 text-right">Venta ($ USD)</th><th class="p-3 text-right">Costo PPM ($)</th><th class="p-3 text-right">Utilidad ($)</th><th class="p-3 text-right">Margen %</th></tr>`;
    tbody.innerHTML = d.porProducto.length === 0
      ? `<tr><td colspan="7" class="p-5 text-center text-slate-500">Sin ventas de artículos en este período.</td></tr>`
      : d.porProducto.map(p => {
          const util = p.ventaUsd - p.costoUsd;
          const m = p.ventaUsd > 0 ? (util / p.ventaUsd) * 100 : 0;
          return `
            <tr class="border-b border-slate-800/40 hover:bg-slate-900/60">
              <td class="p-3 font-mono text-emerald-400">${esc(p.sku)}</td>
              <td class="p-3 text-white font-medium">${esc(p.descripcion)}</td>
              <td class="p-3 text-right font-mono">${p.cantidad.toFixed(2)} ${esc(p.unidad)}</td>
              <td class="p-3 text-right font-mono font-bold text-emerald-400">$ ${p.ventaUsd.toFixed(2)}</td>
              <td class="p-3 text-right font-mono text-slate-300">$ ${p.costoUsd.toFixed(2)}</td>
              <td class="p-3 text-right font-mono font-bold ${util >= 0 ? 'text-sky-400' : 'text-rose-400'}">$ ${util.toFixed(2)}</td>
              <td class="p-3 text-right font-mono font-bold">${m.toFixed(1)}%</td>
            </tr>
          `;
        }).join('');
  } else if (reportesVentasTabActual === 'cajeros') {
    thead.innerHTML = `<tr><th class="p-3">Cajero / Vendedor</th><th class="p-3">Sucursal</th><th class="p-3 text-right">Facturas</th><th class="p-3 text-right">NC/Rev</th><th class="p-3 text-right">Venta Neta ($)</th><th class="p-3 text-right">Venta Neta (Bs.)</th><th class="p-3 text-right">Ticket Prom. ($)</th></tr>`;
    tbody.innerHTML = d.porCajero.length === 0
      ? `<tr><td colspan="7" class="p-5 text-center text-slate-500">Sin datos por cajero.</td></tr>`
      : d.porCajero.map(c => {
          const tkt = c.facturas > 0 ? c.ventaNetaUsd / c.facturas : 0;
          return `
            <tr class="border-b border-slate-800/40 hover:bg-slate-900/60">
              <td class="p-3 font-bold text-white">${esc(c.cajero)}</td>
              <td class="p-3 text-slate-300">${esc(c.sucursal)}</td>
              <td class="p-3 text-right font-mono">${c.facturas}</td>
              <td class="p-3 text-right font-mono text-sky-300">${c.notasNc}</td>
              <td class="p-3 text-right font-mono font-bold text-emerald-400">$ ${c.ventaNetaUsd.toFixed(2)}</td>
              <td class="p-3 text-right font-mono text-slate-300">Bs. ${c.ventaNetaBs.toFixed(2)}</td>
              <td class="p-3 text-right font-mono text-amber-300">$ ${tkt.toFixed(2)}</td>
            </tr>
          `;
        }).join('');
  } else if (reportesVentasTabActual === 'clientes') {
    thead.innerHTML = `<tr><th class="p-3">RIF / C.I.</th><th class="p-3">Cliente / Razón Social</th><th class="p-3 text-right">Compras</th><th class="p-3 text-right">Total ($ USD)</th><th class="p-3 text-right">Total (Bs.)</th><th class="p-3">Última Compra</th></tr>`;
    tbody.innerHTML = d.porCliente.length === 0
      ? `<tr><td colspan="6" class="p-5 text-center text-slate-500">Sin compras de clientes en este período.</td></tr>`
      : d.porCliente.map(c => `
          <tr class="border-b border-slate-800/40 hover:bg-slate-900/60">
            <td class="p-3 font-mono text-emerald-400">${esc(c.rif)}</td>
            <td class="p-3 text-white font-medium">${esc(c.nombre)}</td>
            <td class="p-3 text-right font-mono">${c.compras}</td>
            <td class="p-3 text-right font-mono font-bold text-emerald-400">$ ${c.totalUsd.toFixed(2)}</td>
            <td class="p-3 text-right font-mono text-slate-300">Bs. ${c.totalBs.toFixed(2)}</td>
            <td class="p-3 font-mono text-slate-400">${esc(c.ultimaFecha)}</td>
          </tr>
        `).join('');
  } else if (reportesVentasTabActual === 'pagos') {
    thead.innerHTML = `<tr><th class="p-3">Vía / Forma de Pago</th><th class="p-3 text-right">Transacciones</th><th class="p-3 text-right">Monto ($ USD)</th><th class="p-3 text-right">Monto (Bs.)</th><th class="p-3 text-right">% Participación</th></tr>`;
    const tot = Math.max(0.01, d.porMetodo.reduce((s, m) => s + Math.max(0, m.usd), 0));
    tbody.innerHTML = d.porMetodo.length === 0
      ? `<tr><td colspan="5" class="p-5 text-center text-slate-500">Sin cobros registrados.</td></tr>`
      : d.porMetodo.map(m => `
          <tr class="border-b border-slate-800/40 hover:bg-slate-900/60">
            <td class="p-3 font-bold text-white">${esc(m.metodo)}</td>
            <td class="p-3 text-right font-mono">${m.tx}</td>
            <td class="p-3 text-right font-mono font-bold text-emerald-400">$ ${m.usd.toFixed(2)}</td>
            <td class="p-3 text-right font-mono text-slate-300">Bs. ${m.bs.toFixed(2)}</td>
            <td class="p-3 text-right font-mono text-sky-300">${((Math.max(0, m.usd) / tot) * 100).toFixed(1)}%</td>
          </tr>
        `).join('');
  } else {
    thead.innerHTML = `<tr><th class="p-3">Franja Horaria</th><th class="p-3 text-right">Documentos Emitidos</th><th class="p-3 text-right">Facturado ($ USD)</th><th class="p-3 text-right">Facturado (Bs.)</th><th class="p-3 text-right">% del Total</th></tr>`;
    const totH = Math.max(0.01, d.porHora.reduce((s, h) => s + Math.max(0, h.totalUsd), 0));
    tbody.innerHTML = d.porHora.length === 0
      ? `<tr><td colspan="5" class="p-5 text-center text-slate-500">Sin datos horarios.</td></tr>`
      : d.porHora.map(h => `
          <tr class="border-b border-slate-800/40 hover:bg-slate-900/60">
            <td class="p-3 font-mono font-bold text-white">${esc(h.franja)}</td>
            <td class="p-3 text-right font-mono">${h.docs}</td>
            <td class="p-3 text-right font-mono font-bold text-emerald-400">$ ${h.totalUsd.toFixed(2)}</td>
            <td class="p-3 text-right font-mono text-slate-300">Bs. ${h.totalBs.toFixed(2)}</td>
            <td class="p-3 text-right font-mono text-amber-300">${((Math.max(0, h.totalUsd) / totH) * 100).toFixed(1)}%</td>
          </tr>
        `).join('');
  }
}

function exportarReportesVentasExcel() {
  const d = reportesVentasDataCache;
  if (!d) { avisarDash('Carga primero el reporte de ventas.', 'warning'); return; }
  if (typeof XLSX === 'undefined') { avisarDash('Librería Excel no disponible.', 'error'); return; }

  const wb = XLSX.utils.book_new();

  const hojaProds = [
    ['VENTAS Y RENTABILIDAD POR ARTÍCULO', `Período: ${d.fDesde} al ${d.fHasta}`],
    [],
    ['SKU', 'Descripción', 'Unidad', 'Cantidad', 'Venta USD', 'Costo PPM USD', 'Utilidad USD', 'Margen %'],
    ...d.porProducto.map(p => {
      const util = p.ventaUsd - p.costoUsd;
      const m = p.ventaUsd > 0 ? (util / p.ventaUsd) * 100 : 0;
      return [p.sku, p.descripcion, p.unidad, Number(p.cantidad.toFixed(2)), Number(p.ventaUsd.toFixed(2)), Number(p.costoUsd.toFixed(2)), Number(util.toFixed(2)), Number(m.toFixed(1))];
    })
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hojaProds), 'PorProducto');

  const hojaCaj = [
    ['VENTAS POR CAJERO Y SUCURSAL'],
    [],
    ['Cajero', 'Sucursal', 'Facturas', 'Notas Crédito', 'Venta Neta USD', 'Venta Neta Bs.', 'IGTF USD'],
    ...d.porCajero.map(c => [c.cajero, c.sucursal, c.facturas, c.notasNc, Number(c.ventaNetaUsd.toFixed(2)), Number(c.ventaNetaBs.toFixed(2)), Number(c.igtfUsd.toFixed(2))])
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hojaCaj), 'PorCajero');

  const hojaCli = [
    ['RANKING DE CLIENTES'],
    [],
    ['RIF', 'Cliente', 'Compras', 'Total USD', 'Total Bs.', 'Última Compra'],
    ...d.porCliente.map(c => [c.rif, c.nombre, c.compras, Number(c.totalUsd.toFixed(2)), Number(c.totalBs.toFixed(2)), c.ultimaFecha])
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hojaCli), 'PorCliente');

  const hojaPag = [
    ['VENTAS POR FORMA DE PAGO'],
    [],
    ['Vía de Pago', 'Transacciones', 'Monto USD', 'Monto Bs.'],
    ...d.porMetodo.map(m => [m.metodo, m.tx, Number(m.usd.toFixed(2)), Number(m.bs.toFixed(2))])
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hojaPag), 'PorFormaPago');

  XLSX.writeFile(wb, `Reporte_Gerencial_Ventas_${new Date().toISOString().slice(0, 10)}.xlsx`);
  avisarDash('Libro Excel multi-hoja de Reportes de Ventas descargado.', 'success');
}

function imprimirReporteVentasPdf() {
  const d = reportesVentasDataCache;
  if (!d) { avisarDash('Carga primero el reporte para imprimirlo.', 'warning'); return; }
  if (!window.jspdf || !window.jspdf.jsPDF) { avisarDash('jsPDF no disponible.', 'error'); return; }

  const titulos = {
    productos: 'Ventas y Rentabilidad por Artículo',
    cajeros: 'Ventas por Cajero / Operador',
    clientes: 'Ranking de Clientes Compradores',
    pagos: 'Desglose por Forma de Pago',
    horario: 'Comportamiento de Ventas por Hora'
  };

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'landscape' });
  const margin = 14;
  const pageW = pdf.internal.pageSize.getWidth();
  let y = 16;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  pdf.text(String(tenantActual?.razon_social || 'MI EMPRESA').toUpperCase(), margin, y);
  pdf.setFontSize(9);
  pdf.text(`RIF: ${tenantActual?.rif || ''}`, pageW - margin, y, { align: 'right' });
  y += 6;
  pdf.setFontSize(10.5);
  pdf.setTextColor(4, 120, 87);
  pdf.text(`REPORTE GERENCIAL: ${titulos[reportesVentasTabActual] || 'Ventas'} (${d.fDesde} al ${d.fHasta})`, margin, y);
  y += 7;
  pdf.setTextColor(15, 23, 42);
  pdf.setFontSize(8.5);
  pdf.text(`Ventas Netas: $ ${d.ventasPeriodoUsd.toFixed(2)} | Costo PPM: $ ${d.costoPeriodoUsd.toFixed(2)} | Utilidad Bruta: $ ${d.utilidadPeriodoUsd.toFixed(2)} (${d.margenPct.toFixed(1)}%)`, margin, y);
  y += 7;

  // Cabecera tabla PDF
  pdf.setFillColor(15, 23, 42);
  pdf.rect(margin, y, pageW - margin * 2, 7, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(8);

  let filas = [];
  if (reportesVentasTabActual === 'productos') {
    pdf.text('SKU', margin + 2, y + 4.8);
    pdf.text('Descripción', margin + 32, y + 4.8);
    pdf.text('Cant.', margin + 145, y + 4.8, { align: 'right' });
    pdf.text('Venta $', margin + 175, y + 4.8, { align: 'right' });
    pdf.text('Costo $', margin + 205, y + 4.8, { align: 'right' });
    pdf.text('Utilidad $', margin + 235, y + 4.8, { align: 'right' });
    pdf.text('Margen', pageW - margin - 2, y + 4.8, { align: 'right' });
    filas = d.porProducto.map(p => {
      const u = p.ventaUsd - p.costoUsd;
      const m = p.ventaUsd > 0 ? (u / p.ventaUsd) * 100 : 0;
      return [p.sku, String(p.descripcion).slice(0, 46), p.cantidad.toFixed(2), `$ ${p.ventaUsd.toFixed(2)}`, `$ ${p.costoUsd.toFixed(2)}`, `$ ${u.toFixed(2)}`, `${m.toFixed(1)}%`];
    });
  } else if (reportesVentasTabActual === 'cajeros') {
    pdf.text('Cajero', margin + 2, y + 4.8);
    pdf.text('Sucursal', margin + 75, y + 4.8);
    pdf.text('Facturas', margin + 145, y + 4.8, { align: 'right' });
    pdf.text('NC', margin + 170, y + 4.8, { align: 'right' });
    pdf.text('Venta $', margin + 205, y + 4.8, { align: 'right' });
    pdf.text('Ticket Prom.', pageW - margin - 2, y + 4.8, { align: 'right' });
    filas = d.porCajero.map(c => [c.cajero, c.sucursal, String(c.facturas), String(c.notasNc), `$ ${c.ventaNetaUsd.toFixed(2)}`, `$ ${(c.facturas > 0 ? c.ventaNetaUsd / c.facturas : 0).toFixed(2)}`]);
  } else if (reportesVentasTabActual === 'clientes') {
    pdf.text('RIF / CI', margin + 2, y + 4.8);
    pdf.text('Razón Social', margin + 40, y + 4.8);
    pdf.text('Compras', margin + 150, y + 4.8, { align: 'right' });
    pdf.text('Total $', margin + 190, y + 4.8, { align: 'right' });
    pdf.text('Total Bs.', pageW - margin - 2, y + 4.8, { align: 'right' });
    filas = d.porCliente.map(c => [c.rif, String(c.nombre).slice(0, 48), String(c.compras), `$ ${c.totalUsd.toFixed(2)}`, `Bs. ${c.totalBs.toFixed(2)}`]);
  } else if (reportesVentasTabActual === 'pagos') {
    pdf.text('Forma de Pago', margin + 2, y + 4.8);
    pdf.text('Transacciones', margin + 120, y + 4.8, { align: 'right' });
    pdf.text('Monto $ USD', margin + 180, y + 4.8, { align: 'right' });
    pdf.text('Monto Bs.', pageW - margin - 2, y + 4.8, { align: 'right' });
    filas = d.porMetodo.map(m => [m.metodo, String(m.tx), `$ ${m.usd.toFixed(2)}`, `Bs. ${m.bs.toFixed(2)}`]);
  } else {
    pdf.text('Franja Horaria', margin + 2, y + 4.8);
    pdf.text('Documentos', margin + 120, y + 4.8, { align: 'right' });
    pdf.text('Facturado $ USD', margin + 180, y + 4.8, { align: 'right' });
    pdf.text('Facturado Bs.', pageW - margin - 2, y + 4.8, { align: 'right' });
    filas = d.porHora.map(h => [h.franja, String(h.docs), `$ ${h.totalUsd.toFixed(2)}`, `Bs. ${h.totalBs.toFixed(2)}`]);
  }

  y += 7;
  pdf.setTextColor(15, 23, 42);
  pdf.setFont('helvetica', 'normal');
  filas.forEach(cols => {
    if (y > 192) {
      pdf.addPage();
      y = 16;
    }
    pdf.setDrawColor(226, 232, 240);
    pdf.line(margin, y + 6, pageW - margin, y + 6);
    if (reportesVentasTabActual === 'productos') {
      pdf.text(cols[0], margin + 2, y + 4.3);
      pdf.text(cols[1], margin + 32, y + 4.3);
      pdf.text(cols[2], margin + 145, y + 4.3, { align: 'right' });
      pdf.text(cols[3], margin + 175, y + 4.3, { align: 'right' });
      pdf.text(cols[4], margin + 205, y + 4.3, { align: 'right' });
      pdf.text(cols[5], margin + 235, y + 4.3, { align: 'right' });
      pdf.text(cols[6], pageW - margin - 2, y + 4.3, { align: 'right' });
    } else if (reportesVentasTabActual === 'cajeros') {
      pdf.text(cols[0], margin + 2, y + 4.3);
      pdf.text(cols[1], margin + 75, y + 4.3);
      pdf.text(cols[2], margin + 145, y + 4.3, { align: 'right' });
      pdf.text(cols[3], margin + 170, y + 4.3, { align: 'right' });
      pdf.text(cols[4], margin + 205, y + 4.3, { align: 'right' });
      pdf.text(cols[5], pageW - margin - 2, y + 4.3, { align: 'right' });
    } else if (reportesVentasTabActual === 'clientes') {
      pdf.text(cols[0], margin + 2, y + 4.3);
      pdf.text(cols[1], margin + 40, y + 4.3);
      pdf.text(cols[2], margin + 150, y + 4.3, { align: 'right' });
      pdf.text(cols[3], margin + 190, y + 4.3, { align: 'right' });
      pdf.text(cols[4], pageW - margin - 2, y + 4.3, { align: 'right' });
    } else {
      pdf.text(cols[0], margin + 2, y + 4.3);
      pdf.text(cols[1], margin + 120, y + 4.3, { align: 'right' });
      pdf.text(cols[2], margin + 180, y + 4.3, { align: 'right' });
      pdf.text(cols[3], pageW - margin - 2, y + 4.3, { align: 'right' });
    }
    y += 6;
  });

  const nombreArch = `Reporte_Ventas_${reportesVentasTabActual}_${new Date().toISOString().slice(0, 10)}.pdf`;
  if (typeof abrirVisorImpresionPdf === 'function') {
    abrirVisorImpresionPdf(pdf, nombreArch, titulos[reportesVentasTabActual] || 'Reporte de Ventas');
  } else {
    pdf.save(nombreArch);
  }
}
