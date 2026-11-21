/**
 * /js/cxp_bancos.js
 * Módulo de Cuentas por Pagar (CxP a Proveedores) y Conciliación Bancaria / Lotes POS.
 * Incluye utilidades de verificación e implantación SQL v120 en Panel Master.
 */

let cxpSubtabActual = 'cxp';
let cxpDocumentosCache = [];
let cxpAbonosCache = [];
let conciliacionItemsCache = [];

function avisarCxp(msg, tipo = 'info', duracion = 5500) {
  if (typeof notificarSistema === 'function') notificarSistema(msg, tipo, duracion);
  else console.log(`[CXP:${tipo}]`, msg);
}

function leerCxpLocalMeta(tenantId) {
  try {
    return JSON.parse(localStorage.getItem(`mfd_cxp_meta_${tenantId}`) || '{}');
  } catch (e) { return {}; }
}

function guardarCxpLocalMeta(tenantId, docKey, metaObj) {
  try {
    const s = leerCxpLocalMeta(tenantId);
    s[String(docKey)] = { ...(s[String(docKey)] || {}), ...metaObj };
    localStorage.setItem(`mfd_cxp_meta_${tenantId}`, JSON.stringify(s));
  } catch (e) {}
}

function leerAbonosCxpLocal(tenantId) {
  try {
    return JSON.parse(localStorage.getItem(`mfd_cxp_abonos_${tenantId}`) || '[]');
  } catch (e) { return []; }
}

function guardarAbonoCxpLocal(tenantId, ab) {
  try {
    const arr = leerAbonosCxpLocal(tenantId);
    arr.unshift(ab);
    localStorage.setItem(`mfd_cxp_abonos_${tenantId}`, JSON.stringify(arr.slice(0, 400)));
  } catch (e) {}
}

function leerConciliacionesLocal(tenantId) {
  try {
    return JSON.parse(localStorage.getItem(`mfd_conciliaciones_${tenantId}`) || '{}');
  } catch (e) { return {}; }
}

function guardarConciliacionLocal(tenantId, key, obj) {
  try {
    const s = leerConciliacionesLocal(tenantId);
    s[String(key)] = obj;
    localStorage.setItem(`mfd_conciliaciones_${tenantId}`, JSON.stringify(s));
  } catch (e) {}
}

function cambiarSubtabCxpBancos(tab = 'cxp') {
  cxpSubtabActual = tab;
  ['cxp', 'pagosCxp', 'conciliacion'].forEach(t => {
    const panel = document.getElementById(`cxpSubPanel_${t}`);
    const btn = document.getElementById(`btnSubCxp_${t}`);
    if (panel) {
      if (t === tab) panel.classList.remove('hidden');
      else panel.classList.add('hidden');
    }
    if (btn) {
      if (t === tab) btn.className = 'px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 text-white cursor-pointer whitespace-nowrap';
      else btn.className = 'px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 cursor-pointer whitespace-nowrap';
    }
  });
}

async function cargarModuloCxpYBancos() {
  if (!tenantActual || !supabaseClient) return;
  const tenantId = tenantActual.id;

  const [resCompras, resAbonosCxp, resAuditCxp, resProvs] = await Promise.all([
    supabaseClient.from('compras_documentos').select('*').eq('tenant_id', tenantId).order('fecha', { ascending: false }).limit(300),
    supabaseClient.from('abonos_cxp').select('*').eq('tenant_id', tenantId).order('fecha', { ascending: false }),
    supabaseClient.from('audit_logs').select('*').eq('tenant_id', tenantId).in('accion', ['COMPRA_CXP_META', 'ABONO_CXP', 'CONCILIAR_BANCO']).order('created_at', { ascending: false }).limit(400),
    supabaseClient.from('proveedores').select('id, rif, razon_social, dias_credito, cuenta_contable').eq('tenant_id', tenantId)
  ]);

  const metaLocal = leerCxpLocalMeta(tenantId);
  const concilLocal = leerConciliacionesLocal(tenantId);
  const provMap = {};
  (resProvs.data || []).forEach(p => { provMap[String(p.id)] = p; });

  const metaAuditMap = {};
  const abonosAudit = [];
  if (!resAuditCxp.error && Array.isArray(resAuditCxp.data)) {
    resAuditCxp.data.forEach(log => {
      try {
        const d = JSON.parse(log.detalle || '{}');
        if (log.accion === 'COMPRA_CXP_META' && d.docKey) {
          metaAuditMap[String(d.docKey)] = { ...(metaAuditMap[String(d.docKey)] || {}), ...d };
        } else if (log.accion === 'ABONO_CXP' && d.compraId) {
          abonosAudit.push(d);
        } else if (log.accion === 'CONCILIAR_BANCO' && d.key) {
          concilLocal[String(d.key)] = { ...(concilLocal[String(d.key)] || {}), ...d };
        }
      } catch (e) {}
    });
  }

  // Unificar pagos a proveedores (abonos_cxp > audit_logs > localStorage)
  const mapAbCxp = new Map();
  leerAbonosCxpLocal(tenantId).forEach((a, i) => {
    const k = String(a.id || a.reciboNro || `L_${i}`);
    mapAbCxp.set(k, a);
  });
  abonosAudit.forEach((a, i) => {
    const k = String(a.id || a.reciboNro || `A_${i}`);
    mapAbCxp.set(k, { ...(mapAbCxp.get(k) || {}), ...a });
  });
  if (!resAbonosCxp.error && Array.isArray(resAbonosCxp.data)) {
    resAbonosCxp.data.forEach(a => {
      mapAbCxp.set(String(a.id), {
        id: a.id,
        compraId: String(a.compra_id),
        docNro: a.doc_nro,
        nroFactura: a.nro_factura,
        proveedorId: a.proveedor_id,
        proveedorNombre: a.proveedor_nombre,
        reciboNro: a.recibo_nro || `PAG-${String(a.id).slice(0, 6).toUpperCase()}`,
        moneda: a.moneda || 'USD',
        montoUsd: Number(a.monto_usd || 0),
        montoBs: Number(a.monto_bs || 0),
        tasaBcv: Number(a.tasa_bcv || 1),
        metodoPago: a.metodo_pago || 'TRANSFERENCIA',
        referencia: a.referencia || '',
        notas: a.notas || '',
        usuarioNombre: a.usuario_nombre || 'Operador',
        fecha: a.fecha || a.created_at
      });
    });
  }
  cxpAbonosCache = Array.from(mapAbCxp.values()).sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));

  const abonadoPorCompra = {};
  cxpAbonosCache.forEach(a => {
    const k = String(a.compraId || a.docNro || '');
    abonadoPorCompra[k] = (abonadoPorCompra[k] || 0) + Number(a.montoUsd || 0);
  });

  const hoyMs = Date.now();
  const docsRaw = resCompras.data || [];
  cxpDocumentosCache = docsRaw
    .map(doc => {
      const mExt = metaAuditMap[String(doc.id)] || metaAuditMap[String(doc.doc_nro)] || metaLocal[String(doc.id)] || metaLocal[String(doc.doc_nro)] || {};
      const cond = String(doc.condicion_pago || mExt.condicionPago || 'CONTADO').toUpperCase();
      if (!cond.includes('CRÉDITO') && !cond.includes('CREDITO')) return null;

      const totalUsd = Number(doc.total_usd || 0);
      const abonadoUsd = Math.min(totalUsd, abonadoPorCompra[String(doc.id)] || abonadoPorCompra[String(doc.doc_nro)] || 0);
      const saldoUsd = Math.max(0, totalUsd - abonadoUsd);
      const fechaEm = doc.fecha || (doc.created_at ? String(doc.created_at).slice(0, 10) : new Date().toISOString().slice(0, 10));
      const prov = provMap[String(doc.proveedor_id)] || {};
      const diasCred = Number(doc.dias_credito ?? mExt.diasCredito ?? prov.dias_credito ?? 15) || 15;
      let fechaVenc = doc.fecha_vencimiento || mExt.fechaVencimiento || '';
      if (!fechaVenc) {
        const dt = new Date(`${fechaEm}T00:00:00`);
        dt.setDate(dt.getDate() + diasCred);
        fechaVenc = dt.toISOString().slice(0, 10);
      }
      const diasMora = saldoUsd > 0.01 ? Math.max(0, Math.floor((hoyMs - new Date(`${fechaVenc}T00:00:00`).getTime()) / 86400000)) : 0;

      return {
        ...doc,
        condicionPago: cond,
        fechaEmision: fechaEm,
        fechaVencimiento: fechaVenc,
        diasCredito: diasCred,
        diasMora,
        vencida: saldoUsd > 0.01 && diasMora > 0,
        totalUsd,
        abonadoUsd,
        saldoUsd,
        proveedorCuenta: prov.cuenta_contable || null
      };
    })
    .filter(Boolean);

  renderizarTablaCxp(concilLocal);
  await cargarConciliacionBancaria(concilLocal);
}

function renderizarTablaCxp() {
  const filtroTxt = (document.getElementById('cxpFiltroTexto')?.value || '').trim().toLowerCase();
  const filtroEst = document.getElementById('cxpFiltroEstado')?.value || 'TODOS';

  const filtrados = cxpDocumentosCache.filter(c => {
    if (filtroTxt && !`${c.doc_nro} ${c.nro_factura} ${c.proveedor_nombre}`.toLowerCase().includes(filtroTxt)) return false;
    if (filtroEst === 'PENDIENTE' && c.saldoUsd <= 0.01) return false;
    if (filtroEst === 'VENCIDA' && !c.vencida) return false;
    if (filtroEst === 'PAGADA' && c.saldoUsd > 0.01) return false;
    return true;
  });

  const totCxp = filtrados.reduce((s, c) => s + c.totalUsd, 0);
  const totSaldo = filtrados.reduce((s, c) => s + c.saldoUsd, 0);
  const totVenc = filtrados.filter(c => c.vencida).reduce((s, c) => s + c.saldoUsd, 0);
  const vencCount = filtrados.filter(c => c.vencida).length;

  const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  setTxt('cxpKpiTotalCompras', `$ ${totCxp.toFixed(2)}`);
  setTxt('cxpKpiSaldoPendiente', `$ ${totSaldo.toFixed(2)}`);
  setTxt('cxpKpiVencidas', `${vencCount} fac. ($ ${totVenc.toFixed(2)})`);

  const tbody = document.getElementById('tablaCuentasPorPagar');
  if (tbody) {
    if (!filtrados.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="p-5 text-center text-slate-500">Sin compras a crédito registradas. Al registrar una compra en "Registro de Compras", selecciona Condición: CRÉDITO.</td></tr>`;
    } else {
      tbody.innerHTML = filtrados.map(c => {
        const badge = c.saldoUsd <= 0.01
          ? '<span class="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 text-[10px] font-bold">PAGADA</span>'
          : (c.vencida
              ? `<span class="px-2 py-0.5 rounded bg-rose-950 text-rose-300 text-[10px] font-bold">VENCIDA (${c.diasMora}d)</span>`
              : `<span class="px-2 py-0.5 rounded bg-amber-950 text-amber-300 text-[10px] font-bold">VIGENTE</span>`);
        return `
          <tr class="hover:bg-slate-900 border-b border-slate-800/40">
            <td class="p-3 font-mono font-bold text-white">${esc(c.doc_nro)}<div class="text-[10px] text-slate-400 font-normal">Fac: ${esc(c.nro_factura)}</div></td>
            <td class="p-3 text-slate-200">${esc(c.proveedor_nombre)}<div class="text-[10px] font-mono text-slate-400">Em: ${esc(c.fechaEmision)} · Venc: ${esc(c.fechaVencimiento)}</div></td>
            <td class="p-3 text-right font-mono text-slate-300">$ ${c.totalUsd.toFixed(2)}</td>
            <td class="p-3 text-right font-mono text-emerald-400">$ ${c.abonadoUsd.toFixed(2)}</td>
            <td class="p-3 text-right font-mono font-bold ${c.saldoUsd > 0.01 ? 'text-rose-300' : 'text-emerald-400'}">$ ${c.saldoUsd.toFixed(2)}</td>
            <td class="p-3 text-center">${badge}</td>
            <td class="p-3 text-center">
              ${c.saldoUsd <= 0.01
                ? '<span class="text-xs font-mono text-slate-500">Saldada</span>'
                : `<button type="button" onclick='abrirModalPagoCxp("${esc(c.id)}")' class="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap">Registrar Pago</button>`}
            </td>
          </tr>
        `;
      }).join('');
    }
  }

  // Tabla historial de pagos a proveedores
  const tbPag = document.getElementById('tablaHistorialPagosCxp');
  if (tbPag) {
    if (!cxpAbonosCache.length) {
      tbPag.innerHTML = `<tr><td colspan="6" class="p-5 text-center text-slate-500">Sin pagos a proveedores registrados aún.</td></tr>`;
    } else {
      tbPag.innerHTML = cxpAbonosCache.map(a => `
        <tr class="hover:bg-slate-900 border-b border-slate-800/40">
          <td class="p-3 font-mono text-xs text-slate-300">${esc(String(a.fecha || '').slice(0, 16).replace('T', ' '))}<div class="text-[10px] text-emerald-400 font-bold">${esc(a.reciboNro)}</div></td>
          <td class="p-3 font-mono text-white">${esc(a.docNro || a.nroFactura)}</td>
          <td class="p-3 text-slate-200">${esc(a.proveedorNombre)}</td>
          <td class="p-3 text-xs text-slate-300">${esc(a.metodoPago)}${a.referencia ? ` <span class="text-slate-400 font-mono">(${esc(a.referencia)})</span>` : ''}</td>
          <td class="p-3 text-right font-mono font-bold text-rose-300">$ ${Number(a.montoUsd || 0).toFixed(2)}<div class="text-[10px] text-slate-400 font-normal">Bs. ${Number(a.montoBs || 0).toFixed(2)}</div></td>
          <td class="p-3 text-center"><button type="button" onclick='imprimirComprobantePagoCxpPdf("${esc(a.id)}")' class="bg-slate-800 hover:bg-slate-700 text-sky-300 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer">PDF</button></td>
        </tr>
      `).join('');
    }
  }
}

function abrirModalPagoCxp(compraId) {
  const c = cxpDocumentosCache.find(x => String(x.id) === String(compraId));
  if (!c) return;
  const modal = document.getElementById('modalPagoCxp');
  if (!modal) return;
  document.getElementById('cxpModalCompraId').value = c.id;
  document.getElementById('cxpModalInfo').textContent = `${c.doc_nro} (Fac. ${c.nro_factura}) · ${c.proveedor_nombre} · Saldo: $ ${c.saldoUsd.toFixed(2)}`;
  document.getElementById('cxpModalFecha').value = new Date().toISOString().slice(0, 10);
  document.getElementById('cxpModalMoneda').value = 'USD';
  const tasa = parseFloat(document.getElementById('tasaBcv')?.value || c.tasa_bcv || 1) || 1;
  document.getElementById('cxpModalTasaBcv').value = tasa.toFixed(4);
  document.getElementById('cxpModalMonto').value = c.saldoUsd.toFixed(2);
  document.getElementById('cxpModalReferencia').value = '';
  document.getElementById('cxpModalNotas').value = '';
  const chkCaja = document.getElementById('cxpModalEgresoCaja');
  if (chkCaja) chkCaja.checked = false;
  modal.classList.remove('hidden');
}

function cerrarModalPagoCxp() {
  document.getElementById('modalPagoCxp')?.classList.add('hidden');
}

async function guardarPagoCxp(e) {
  if (e) e.preventDefault();
  if (!tenantActual) return;
  const tenantId = tenantActual.id;
  const compraId = document.getElementById('cxpModalCompraId')?.value || '';
  const c = cxpDocumentosCache.find(x => String(x.id) === String(compraId));
  if (!c) return;

  const fecha = document.getElementById('cxpModalFecha')?.value || new Date().toISOString().slice(0, 10);
  const moneda = (document.getElementById('cxpModalMoneda')?.value || 'USD').toUpperCase();
  const tasa = Math.max(0.0001, parseFloat(document.getElementById('cxpModalTasaBcv')?.value || '1') || 1);
  const montoOrig = parseFloat(document.getElementById('cxpModalMonto')?.value || '0') || 0;
  const montoUsdRaw = moneda === 'USD' ? montoOrig : (montoOrig / tasa);
  const montoAplicadoUsd = Math.min(montoUsdRaw, c.saldoUsd);
  const montoAplicadoBs = montoAplicadoUsd * tasa;

  if (montoAplicadoUsd <= 0) {
    avisarCxp('Ingresa un monto válido mayor a 0.', 'warning');
    return;
  }

  const metodo = document.getElementById('cxpModalMetodo')?.value || 'TRANSFERENCIA';
  const ref = (document.getElementById('cxpModalReferencia')?.value || '').trim();
  const notas = (document.getElementById('cxpModalNotas')?.value || '').trim();
  const registrarEgresoCaja = Boolean(document.getElementById('cxpModalEgresoCaja')?.checked);
  const actor = typeof obtenerActorActual === 'function' ? obtenerActorActual() : null;
  const actorUuid = actor?.usuarioId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(actor.usuarioId)) ? actor.usuarioId : null;

  const id = typeof generarUuidLocal === 'function' ? generarUuidLocal() : `${Date.now()}`;
  const reciboNro = `PAG-CXP-${String(cxpAbonosCache.length + 1).padStart(5, '0')}`;
  const fechaIso = `${fecha}T${new Date().toISOString().slice(11)}`;

  const abonoObj = {
    id,
    compraId: c.id,
    docNro: c.doc_nro,
    nroFactura: c.nro_factura,
    proveedorId: c.proveedor_id,
    proveedorNombre: c.proveedor_nombre,
    reciboNro,
    moneda,
    montoUsd: Number(montoAplicadoUsd.toFixed(2)),
    montoBs: Number(montoAplicadoBs.toFixed(2)),
    tasaBcv: Number(tasa.toFixed(4)),
    metodoPago: metodo,
    referencia: ref,
    notas,
    usuarioNombre: actor?.usuarioNombre || tenantActual.razon_social || 'Operador',
    fecha: fechaIso
  };

  guardarAbonoCxpLocal(tenantId, abonoObj);

  try {
    await supabaseClient.from('abonos_cxp').insert([{
      id,
      tenant_id: tenantId,
      compra_id: c.id,
      doc_nro: c.doc_nro,
      nro_factura: c.nro_factura,
      proveedor_id: c.proveedor_id || null,
      proveedor_nombre: c.proveedor_nombre,
      recibo_nro: reciboNro,
      moneda,
      monto_usd: abonoObj.montoUsd,
      monto_bs: abonoObj.montoBs,
      tasa_bcv: abonoObj.tasaBcv,
      metodo_pago: metodo,
      referencia: ref || null,
      notas: notas || null,
      usuario_id: actorUuid,
      usuario_nombre: abonoObj.usuarioNombre,
      fecha: fechaIso
    }]);
    const nuevoSaldo = Math.max(0, Number((c.saldoUsd - abonoObj.montoUsd).toFixed(2)));
    await supabaseClient.from('compras_documentos').update({
      saldo_pendiente_usd: nuevoSaldo,
      estado_pago: nuevoSaldo <= 0.01 ? 'PAGADA' : 'PARCIAL'
    }).eq('id', c.id).eq('tenant_id', tenantId);
  } catch (e) {}

  await supabaseClient.from('audit_logs').insert([{
    tenant_id: tenantId,
    accion: 'ABONO_CXP',
    detalle: JSON.stringify(abonoObj)
  }]);

  if (registrarEgresoCaja && typeof cajaTurnoActivoCache !== 'undefined' && cajaTurnoActivoCache?.id && typeof persistirMovimientoCaja === 'function') {
    await persistirMovimientoCaja({
      id: typeof generarUuidLocal === 'function' ? generarUuidLocal() : `${Date.now()}`,
      tenant_id: tenantId,
      turno_id: cajaTurnoActivoCache.id,
      tipo: 'EGRESO',
      concepto: `Pago CxP ${reciboNro} · ${c.proveedor_nombre} (Fac ${c.nro_factura})`,
      categoria: 'PROVEEDOR',
      moneda,
      monto: moneda === 'USD' ? abonoObj.montoUsd : Number(abonoObj.montoBs.toFixed(2)),
      monto_usd: abonoObj.montoUsd,
      monto_bs: abonoObj.montoBs,
      tasa_bcv: abonoObj.tasaBcv,
      referencia: ref || reciboNro,
      usuario_id: actorUuid,
      usuario_nombre: abonoObj.usuarioNombre,
      fecha: fechaIso,
      created_at: new Date().toISOString()
    });
  }

  // Asiento contable automático pago a proveedor (Debe 2.1.01 CxP / Haber 1.1.01 Bancos/Caja)
  if (typeof registrarAsientoContable === 'function') {
    await registrarAsientoContable({
      fecha,
      referencia: reciboNro,
      moduloOrigen: 'CXP_PAGO',
      documentoId: c.id,
      concepto: `Pago a proveedor ${c.proveedor_nombre} (Fac. ${c.nro_factura})`,
      tasaBcv: abonoObj.tasaBcv,
      lineas: [
        { cuentaCodigo: c.proveedorCuenta || '2.1.01', debeBs: abonoObj.montoBs, haberBs: 0, descripcion: `Cancelación CxP ${c.nro_factura}` },
        { cuentaCodigo: '1.1.01', debeBs: 0, haberBs: abonoObj.montoBs, descripcion: `Salida por ${metodo} ${ref}` }
      ]
    });
  }

  cerrarModalPagoCxp();
  avisarCxp(`Pago ${reciboNro} ($ ${abonoObj.montoUsd.toFixed(2)}) registrado en CxP.`, 'success');
  await cargarModuloCxpYBancos();
}

function imprimirComprobantePagoCxpPdf(abonoId) {
  const ab = cxpAbonosCache.find(x => String(x.id) === String(abonoId));
  if (!ab || !window.jspdf?.jsPDF) return;
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: [80, 140] });
  let y = 9;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9.5);
  pdf.text(String(tenantActual?.razon_social || 'EMPRESA').toUpperCase(), 40, y, { align: 'center', maxWidth: 72 });
  y += 5;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.text(`RIF: ${tenantActual?.rif || ''}`, 40, y, { align: 'center' });
  y += 4;
  pdf.line(4, y, 76, y); y += 5;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.text('COMPROBANTE PAGO A PROVEEDOR (CXP)', 40, y, { align: 'center' });
  y += 5;
  pdf.setFont('courier', 'bold');
  pdf.text(`Comprobante: ${ab.reciboNro}`, 4, y); y += 4;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.text(`Fecha: ${String(ab.fecha || '').slice(0, 16).replace('T', ' ')}`, 4, y); y += 4;
  pdf.text(`Proveedor: ${ab.proveedorNombre}`, 4, y, { maxWidth: 72 }); y += 4.5;
  pdf.text(`Doc / Fac: ${ab.docNro} / ${ab.nroFactura}`, 4, y); y += 4.5;
  pdf.line(4, y, 76, y); y += 4.5;
  pdf.setFont('helvetica', 'bold');
  pdf.text(`Monto Pagado USD:`, 4, y); pdf.text(`$ ${Number(ab.montoUsd).toFixed(2)}`, 76, y, { align: 'right' }); y += 4;
  pdf.setFont('helvetica', 'normal');
  pdf.text(`Equivalente Bs.:`, 4, y); pdf.text(`Bs. ${Number(ab.montoBs).toFixed(2)}`, 76, y, { align: 'right' }); y += 4;
  pdf.text(`Vía / Ref:`, 4, y); pdf.text(`${ab.metodoPago} ${ab.referencia || ''}`, 76, y, { align: 'right' });
  const fname = `${ab.reciboNro}.pdf`;
  if (typeof abrirVisorImpresionPdf === 'function') abrirVisorImpresionPdf(pdf, fname, `Pago CxP ${ab.reciboNro}`);
  else pdf.save(fname);
}

function exportarCxpExcel() {
  if (!cxpDocumentosCache.length || typeof XLSX === 'undefined') {
    avisarCxp('Sin facturas por pagar para exportar.', 'warning');
    return;
  }
  const wb = XLSX.utils.book_new();
  const hoja1 = [
    ['CUENTAS POR PAGAR A PROVEEDORES (CXP)', tenantActual?.razon_social || ''],
    [],
    ['Doc. Compra', 'Factura Proveedor', 'Proveedor', 'Fecha Emisión', 'Fecha Venc.', 'Total USD', 'Abonado USD', 'Saldo USD', 'Días Mora', 'Estado'],
    ...cxpDocumentosCache.map(c => [
      c.doc_nro, c.nro_factura, c.proveedor_nombre, c.fechaEmision, c.fechaVencimiento,
      Number(c.totalUsd.toFixed(2)), Number(c.abonadoUsd.toFixed(2)), Number(c.saldoUsd.toFixed(2)),
      c.diasMora, c.saldoUsd <= 0.01 ? 'PAGADA' : (c.vencida ? 'VENCIDA' : 'VIGENTE')
    ])
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hoja1), 'CuentasPorPagar');
  const hoja2 = [
    ['HISTORIAL DE PAGOS A PROVEEDORES'],
    [],
    ['Fecha', 'Comprobante', 'Doc. Compra', 'Proveedor', 'Método', 'Referencia', 'Monto USD', 'Monto Bs.'],
    ...cxpAbonosCache.map(a => [
      String(a.fecha || '').slice(0, 10), a.reciboNro, a.docNro, a.proveedorNombre,
      a.metodoPago, a.referencia || '', Number(a.montoUsd || 0), Number(a.montoBs || 0)
    ])
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hoja2), 'PagosProveedores');
  XLSX.writeFile(wb, `Cuentas_Por_Pagar_${new Date().toISOString().slice(0, 10)}.xlsx`);
  avisarCxp('Reporte Excel de Cuentas por Pagar descargado.', 'success');
}

// ==========================================
// CONCILIACIÓN BANCARIA Y LOTES POS
// ==========================================

async function cargarConciliacionBancaria(concilMapOverride = null) {
  if (!tenantActual || !supabaseClient) return;
  const tenantId = tenantActual.id;

  const [resInvs, resConcil] = await Promise.all([
    supabaseClient.from('invoices').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(300),
    supabaseClient.from('conciliaciones_bancarias').select('*').eq('tenant_id', tenantId)
  ]);

  const concMap = { ...(concilMapOverride || leerConciliacionesLocal(tenantId)) };
  if (!resConcil.error && Array.isArray(resConcil.data)) {
    resConcil.data.forEach(r => {
      concMap[`${r.origen_tipo}|${r.origen_id}`] = {
        estado: r.estado,
        bancoDestino: r.banco_destino,
        fechaConciliacion: r.fecha_conciliacion,
        conciliadoPor: r.conciliado_por
      };
    });
  }

  let storeMeta = {};
  try { storeMeta = JSON.parse(localStorage.getItem(`facturas_seniat_meta_${tenantId}`) || '{}'); } catch (e) {}

  const items = [];
  (resInvs.data || []).forEach(inv => {
    const est = String(inv.estado || 'EMITIDA').toUpperCase();
    const nro = String(inv.factura_nro || '').toUpperCase();
    if (est === 'ANULADA' || nro.startsWith('REV-') || nro.startsWith('NC')) return;

    const meta = storeMeta[String(inv.id)] || storeMeta[String(inv.factura_nro)] || {};
    const fecha = String(inv.fecha_emision || meta.fechaEmision || inv.created_at || '').slice(0, 10);
    const tasa = Math.max(0.0001, Number(inv.tasa_bcv || 1));
    const pagos = Array.isArray(inv.pago_mixto_json) && inv.pago_mixto_json.length > 0
      ? inv.pago_mixto_json
      : (Array.isArray(meta.pagoMixto) && meta.pagoMixto.length > 0 ? meta.pagoMixto : null);

    if (pagos) {
      pagos.forEach((p, idx) => {
        const met = String(p.metodo || '').toUpperCase();
        if (/EFECTIVO|CR[EÉ]DITO/.test(met)) return;
        const oid = `${inv.id}_M${idx}`;
        const cState = concMap[`VENTA_POS|${oid}`] || {};
        items.push({
          key: `VENTA_POS|${oid}`,
          origenTipo: 'VENTA_POS',
          origenId: oid,
          fecha,
          documento: inv.factura_nro,
          tercero: inv.cliente_nombre || 'CONSUMIDOR FINAL',
          canal: met,
          referencia: p.referencia || meta.referenciaPago || '',
          moneda: p.moneda || 'VES',
          montoUsd: Number(p.montoUsd || 0),
          montoBs: Number(p.montoBs || 0),
          estado: cState.estado || 'PENDIENTE',
          bancoDestino: cState.bancoDestino || '',
          conciliadoPor: cState.conciliadoPor || ''
        });
      });
    } else {
      const metMain = String(inv.metodo_pago || '').split('|')[0].trim().toUpperCase();
      const cond = String(inv.condicion_pago || meta.condicionPago || '').toUpperCase();
      if (/EFECTIVO/.test(metMain) || cond.includes('CRÉDITO') || cond.includes('CREDITO')) return;
      const totBs = Number(inv.total_bs || 0);
      const totUsd = totBs / tasa;
      const cState = concMap[`VENTA_POS|${inv.id}`] || {};
      items.push({
        key: `VENTA_POS|${inv.id}`,
        origenTipo: 'VENTA_POS',
        origenId: String(inv.id),
        fecha,
        documento: inv.factura_nro,
        tercero: inv.cliente_nombre || 'CONSUMIDOR FINAL',
        canal: metMain,
        referencia: meta.referenciaPago || '',
        moneda: meta.moneda || 'VES',
        montoUsd: Number(totUsd.toFixed(2)),
        montoBs: Number(totBs.toFixed(2)),
        estado: cState.estado || 'PENDIENTE',
        bancoDestino: cState.bancoDestino || '',
        conciliadoPor: cState.conciliadoPor || ''
      });
    }
  });

  // Agregar Abonos CxC electrónicos/bancos
  if (typeof cxcAbonosCache !== 'undefined' && Array.isArray(cxcAbonosCache)) {
    cxcAbonosCache.forEach(ab => {
      if (/EFECTIVO/.test(ab.metodoPago)) return;
      const cState = concMap[`ABONO_CXC|${ab.id}`] || {};
      items.push({
        key: `ABONO_CXC|${ab.id}`,
        origenTipo: 'ABONO_CXC',
        origenId: String(ab.id),
        fecha: String(ab.fecha || '').slice(0, 10),
        documento: `${ab.reciboNro} (${ab.facturaNro})`,
        tercero: ab.clienteNombre,
        canal: ab.metodoPago,
        referencia: ab.referencia || '',
        moneda: ab.moneda || 'USD',
        montoUsd: Number(ab.montoUsd || 0),
        montoBs: Number(ab.montoBs || 0),
        estado: ab.conciliado ? 'CONCILIADO' : (cState.estado || 'PENDIENTE'),
        bancoDestino: cState.bancoDestino || ab.bancoConciliacion || '',
        conciliadoPor: cState.conciliadoPor || ab.conciliadoPor || ''
      });
    });
  }

  conciliacionItemsCache = items.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  renderizarTablaConciliacionBancaria();
}

function renderizarTablaConciliacionBancaria() {
  const canalFilt = (document.getElementById('concilFiltroCanal')?.value || 'TODOS').toUpperCase();
  const estFilt = (document.getElementById('concilFiltroEstado')?.value || 'TODOS').toUpperCase();
  const txtFilt = (document.getElementById('concilFiltroTexto')?.value || '').trim().toLowerCase();

  const lista = conciliacionItemsCache.filter(it => {
    if (canalFilt !== 'TODOS' && !it.canal.includes(canalFilt)) return false;
    if (estFilt !== 'TODOS' && it.estado !== estFilt) return false;
    if (txtFilt && !`${it.documento} ${it.tercero} ${it.referencia} ${it.canal}`.toLowerCase().includes(txtFilt)) return false;
    return true;
  });

  const totConcUsd = lista.filter(x => x.estado === 'CONCILIADO').reduce((s, x) => s + x.montoUsd, 0);
  const totPendUsd = lista.filter(x => x.estado !== 'CONCILIADO').reduce((s, x) => s + x.montoUsd, 0);
  const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  setTxt('concilKpiConciliado', `$ ${totConcUsd.toFixed(2)}`);
  setTxt('concilKpiPendiente', `$ ${totPendUsd.toFixed(2)}`);

  const tbody = document.getElementById('tablaConciliacionBancaria');
  if (!tbody) return;
  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-5 text-center text-slate-500">Sin operaciones electrónicas/bancarias para conciliar en este filtro.</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map(it => {
    const isOk = it.estado === 'CONCILIADO';
    const badge = isOk
      ? `<span class="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 text-[10px] font-bold">CONCILIADO</span>`
      : `<span class="px-2 py-0.5 rounded bg-amber-950 text-amber-300 text-[10px] font-bold">PENDIENTE</span>`;
    return `
      <tr class="hover:bg-slate-900 border-b border-slate-800/40">
        <td class="p-3 font-mono text-xs text-slate-300">${esc(it.fecha)}<div class="text-[10px] text-slate-500">${esc(it.origenTipo)}</div></td>
        <td class="p-3 font-mono font-bold text-white">${esc(it.documento)}<div class="text-[10px] text-slate-400 font-sans font-normal">${esc(it.tercero)}</div></td>
        <td class="p-3 text-xs text-sky-300 font-semibold">${esc(it.canal)}</td>
        <td class="p-3 font-mono text-xs text-slate-300">${esc(it.referencia || '--')}</td>
        <td class="p-3 text-right font-mono font-bold text-emerald-400">$ ${it.montoUsd.toFixed(2)}<div class="text-[10px] text-slate-400 font-normal">Bs. ${it.montoBs.toFixed(2)}</div></td>
        <td class="p-3 text-center">${badge}</td>
        <td class="p-3 text-center">
          <button type="button" onclick='toggleConciliacionBancoItem("${esc(it.key)}")' class="px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer ${isOk ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-emerald-700 hover:bg-emerald-600 text-white'}">${isOk ? 'Revertir' : 'Conciliar'}</button>
        </td>
      </tr>
    `;
  }).join('');
}

async function toggleConciliacionBancoItem(itemKey) {
  if (!tenantActual) return;
  const it = conciliacionItemsCache.find(x => x.key === itemKey);
  if (!it) return;

  const nuevoEst = it.estado === 'CONCILIADO' ? 'PENDIENTE' : 'CONCILIADO';
  const banco = (document.getElementById('concilBancoNombreInput')?.value || '').trim() || 'Banco Principal';
  const actor = typeof obtenerActorActual === 'function' ? obtenerActorActual() : null;
  const quien = actor?.usuarioNombre || tenantActual.razon_social || 'Auditor';
  const ahoraIso = new Date().toISOString();

  it.estado = nuevoEst;
  it.bancoDestino = banco;
  it.conciliadoPor = quien;

  guardarConciliacionLocal(tenantActual.id, it.key, {
    key: it.key,
    estado: nuevoEst,
    bancoDestino: banco,
    fechaConciliacion: ahoraIso,
    conciliadoPor: quien
  });

  try {
    await supabaseClient.from('conciliaciones_bancarias').upsert([{
      tenant_id: tenantActual.id,
      origen_tipo: it.origenTipo,
      origen_id: it.origenId,
      documento_ref: it.documento,
      canal_pago: it.canal,
      referencia_banco: it.referencia || null,
      banco_destino: banco,
      moneda: it.moneda,
      monto_usd: it.montoUsd,
      monto_bs: it.montoBs,
      estado: nuevoEst,
      fecha_operacion: it.fecha,
      fecha_conciliacion: ahoraIso,
      conciliado_por: quien
    }], { onConflict: 'tenant_id,origen_tipo,origen_id' });
  } catch (e) {}

  await supabaseClient.from('audit_logs').insert([{
    tenant_id: tenantActual.id,
    accion: 'CONCILIAR_BANCO',
    detalle: JSON.stringify({ key: it.key, estado: nuevoEst, bancoDestino: banco, conciliadoPor: quien, fechaConciliacion: ahoraIso })
  }]);

  renderizarTablaConciliacionBancaria();
  avisarCxp(`${it.documento} (${it.canal}) marcado como ${nuevoEst}.`, 'success');
}

function exportarConciliacionBancariaExcel() {
  if (!conciliacionItemsCache.length || typeof XLSX === 'undefined') {
    avisarCxp('Sin movimientos bancarios para exportar.', 'warning');
    return;
  }
  const matriz = [
    ['REPORTE DE CONCILIACIÓN BANCARIA Y PUNTOS DE VENTA', tenantActual?.razon_social || ''],
    [],
    ['Fecha', 'Origen', 'Documento', 'Cliente', 'Canal de Cobro', 'Referencia', 'Monto USD', 'Monto Bs.', 'Estado', 'Banco / Auditor'],
    ...conciliacionItemsCache.map(it => [
      it.fecha, it.origenTipo, it.documento, it.tercero, it.canal, it.referencia || '',
      it.montoUsd, it.montoBs, it.estado, `${it.bancoDestino || ''} ${it.conciliadoPor || ''}`.trim()
    ])
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matriz), 'ConciliacionBancaria');
  XLSX.writeFile(wb, `Conciliacion_Bancaria_${new Date().toISOString().slice(0, 10)}.xlsx`);
  avisarCxp('Excel de Conciliación Bancaria descargado.', 'success');
}

// ==========================================
// UTILIDADES SQL v120 PARA PANEL MASTER
// ==========================================

async function verificarEstadoEsquemaV120() {
  const badge = document.getElementById('v120EstadoEsquemaBadge');
  if (!badge || !supabaseClient) return;

  try {
    const rpc = await supabaseClient.rpc('mfd_estado_esquema_v120');
    if (!rpc.error && rpc.data?.abonos_cxp && rpc.data?.conciliaciones_bancarias && rpc.data?.abonos_cxc_conciliado && rpc.data?.compras_condicion_pago && rpc.data?.tenants_arqueo_ciego) {
      badge.textContent = 'Esquema Enterprise v120 Activo';
      badge.className = 'px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/40';
      return;
    }
  } catch (e) {}

  try {
    const r = await supabaseClient.from('abonos_cxp').select('id').limit(1);
    if (!r.error) {
      badge.textContent = 'Esquema v120 Activo en Supabase';
      badge.className = 'px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/40';
      return;
    }
  } catch (e) {}

  badge.textContent = 'Pendiente ejecutar .SQL v120 (Usando respaldo Nube)';
  badge.className = 'px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold bg-amber-950 text-amber-300 border border-amber-500/40';
}

async function copiarScriptSqlV120() {
  try {
    const res = await fetch('/sql/migracion_enterprise_v120.sql');
    const txt = await res.text();
    await navigator.clipboard.writeText(txt);
    avisarCxp('Script migracion_enterprise_v120.sql copiado al portapapeles.', 'success', 6000);
  } catch (e) {
    avisarCxp('No se pudo copiar automáticamente; usa Descargar .SQL v120.', 'warning');
  }
}

async function descargarScriptSqlV120() {
  try {
    const res = await fetch('/sql/migracion_enterprise_v120.sql');
    const txt = await res.text();
    const blob = new Blob([txt], { type: 'text/sql;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'migracion_enterprise_v120.sql';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    avisarCxp('Descargado migracion_enterprise_v120.sql.', 'success');
  } catch (e) {
    avisarCxp('Error al descargar el script SQL v120.', 'error');
  }
}
