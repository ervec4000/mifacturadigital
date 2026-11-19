/**
 * /js/reportes.js
 * Módulo de Comprobantes, Historial, Reportes Z, Notas Fiscales, Retenciones de IVA y Libros Oficiales
 */

let documentosHistorialCache = [];
let comprobanteActualCache = null;
let comprobanteRenderCache = null;
let formatoComprobanteActual = 'digital';

function avisarReporte(mensaje, tipo = 'info', duracion = 6000) {
  if (typeof notificarSistema === 'function') {
    notificarSistema(mensaje, tipo, duracion);
  } else {
    console.log(`[${tipo}]`, mensaje);
  }
}

async function sincronizarMetasNotasNube(tenantId) {
  if (!tenantId) return;
  try {
    const { data, error } = await supabaseClient
      .from('audit_logs')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('accion', 'NOTA_FISCAL_META')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error || !Array.isArray(data)) return;
    const raw = localStorage.getItem(`facturas_seniat_meta_${tenantId}`);
    const store = raw ? JSON.parse(raw) : {};
    data.forEach(log => {
      try {
        const meta = JSON.parse(log.detalle || '{}');
        if (meta.invoiceId) store[String(meta.invoiceId)] = { ...(store[String(meta.invoiceId)] || {}), ...meta };
        if (meta.notaNro) store[String(meta.notaNro)] = { ...(store[String(meta.notaNro)] || {}), ...meta };
      } catch (e) {}
    });
    localStorage.setItem(`facturas_seniat_meta_${tenantId}`, JSON.stringify(store));
  } catch (e) {}
}

function guardarMetaFacturaLocalYNota(tenantId, invoiceId, facturaNro, metaObj) {
  try {
    const key = `facturas_seniat_meta_${tenantId}`;
    const raw = localStorage.getItem(key);
    const store = raw ? JSON.parse(raw) : {};
    if (invoiceId) store[String(invoiceId)] = metaObj;
    if (facturaNro) store[String(facturaNro)] = metaObj;
    localStorage.setItem(key, JSON.stringify(store));
  } catch (e) {}
}

async function cargarHistorial() {
  if (!tenantActual) return;
  await sincronizarMetasNotasNube(tenantActual.id);
  const { data } = await supabaseClient.from('invoices').select('*').eq('tenant_id', tenantActual.id).order('created_at', { ascending: false });
  documentosHistorialCache = (data || []).map(f => {
    const numUpper = (f.factura_nro || '').toUpperCase();
    const estUpper = (f.estado || '').toUpperCase();
    let tDoc = 'FACTURA';
    if (numUpper.startsWith('NC')) tDoc = 'NOTA CREDITO';
    else if (numUpper.startsWith('ND')) tDoc = 'NOTA DEBITO';
    else if (numUpper.startsWith('REV-') || estUpper === 'REVERSO') tDoc = 'REVERSO';
    return {...f, tipoDoc: tDoc, numero: f.factura_nro};
  });
  renderizarHistorial(documentosHistorialCache);
}

function filtrarHistorial() {
  const txt = document.getElementById('filtroTexto')?.value.toLowerCase().trim() || '';
  const tipoSel = document.getElementById('filtroTipo')?.value || 'TODOS';

  const filtrados = documentosHistorialCache.filter(d => {
    const matchTexto = (d.numero||'').toLowerCase().includes(txt) || (d.cliente_nombre||'').toLowerCase().includes(txt) || (d.metodo_pago||'').toLowerCase().includes(txt);
    const matchTipo = (tipoSel === 'TODOS') || (d.tipoDoc === tipoSel);
    return matchTexto && matchTipo;
  });
  renderizarHistorial(filtrados);
}

function renderizarHistorial(lista) {
  const tbody = document.getElementById('tablaHistorial');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-500">Sin comprobantes registrados.</td></tr>`;
    return;
  }
  lista.forEach(doc => {
    const estadoUpper = String(doc.estado || 'EMITIDA').toUpperCase();
    const esAnulada = estadoUpper === 'ANULADA';
    const esReverso = estadoUpper === 'REVERSO' || doc.tipoDoc === 'REVERSO';
    const esNota = doc.tipoDoc === 'NOTA CREDITO' || doc.tipoDoc === 'NOTA DEBITO';

    let badgeColor = 'bg-emerald-950 text-emerald-300';
    if (doc.tipoDoc === 'NOTA CREDITO') badgeColor = 'bg-sky-950 text-sky-300';
    if (doc.tipoDoc === 'NOTA DEBITO') badgeColor = 'bg-amber-950 text-amber-300';
    if (esReverso) badgeColor = 'bg-amber-950 text-amber-300';
    if (esAnulada) badgeColor = 'bg-rose-950 text-rose-300';

    let labelBadge = doc.tipoDoc;
    if (doc.tipoDoc === 'NOTA CREDITO') labelBadge = 'NOTA DE CRÉDITO';
    if (doc.tipoDoc === 'NOTA DEBITO') labelBadge = 'NOTA DE DÉBITO';
    if (esAnulada) labelBadge = 'ANULADA';

    const accionesExtra = (!esAnulada && !esReverso && !esNota)
      ? `<button type="button" onclick='editarFacturaPorId("${esc(doc.id)}")' class="text-sky-400 hover:underline font-semibold cursor-pointer">Editar</button>
         <button type="button" onclick='eliminarFacturaPorId("${esc(doc.id)}")' class="text-rose-400 hover:underline font-semibold cursor-pointer">Eliminar</button>`
      : '';

    const montoDisplay = doc.tipoDoc === 'NOTA CREDITO'
      ? `-Bs. ${Math.abs(Number(doc.total_bs) || 0).toFixed(2)}`
      : `Bs. ${(Number(doc.total_bs) || 0).toFixed(2)}`;
    const colorMonto = doc.tipoDoc === 'NOTA CREDITO'
      ? 'text-sky-400'
      : (Number(doc.total_bs) < 0 ? 'text-amber-400' : 'text-emerald-400');

    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/40 ${esAnulada ? 'opacity-65' : ''}">
        <td class="p-3 font-mono font-bold text-white"><span class="px-2 py-0.5 rounded text-[10px] ${badgeColor} mr-1">${esc(labelBadge)}</span> ${esc(doc.numero)}</td>
        <td class="p-3 font-mono">${esc(doc.nro_control || 'N/A')}</td>
        <td class="p-3">${esc(doc.cliente_nombre)}</td>
        <td class="p-3 text-slate-300">${esc(doc.metodo_pago)}</td>
        <td class="p-3 text-slate-400 font-mono">${formatearDdMmYyyyNota(doc.created_at)}</td>
        <td class="p-3 font-mono ${colorMonto} font-bold">${montoDisplay}</td>
        <td class="p-3 text-center space-x-2 whitespace-nowrap">
          <button type="button" onclick='verComprobantePorId("${esc(doc.id)}")' class="bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded cursor-pointer text-xs text-slate-200">Ver / PDF</button>
          ${accionesExtra}
        </td>
      </tr>
    `;
  });
}

async function verComprobantePorId(id) {
  let doc = documentosHistorialCache.find(d => String(d.id) === String(id));
  if (!doc && tenantActual) {
    const { data } = await supabaseClient
      .from('invoices')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantActual.id)
      .maybeSingle();
    if (data) {
      const numUpper = String(data.factura_nro || '').toUpperCase();
      let tDoc = 'FACTURA';
      if (numUpper.startsWith('NC')) tDoc = 'NOTA CREDITO';
      else if (numUpper.startsWith('ND')) tDoc = 'NOTA DEBITO';
      else if (numUpper.startsWith('REV-')) tDoc = 'REVERSO';
      doc = { ...data, tipoDoc: tDoc, numero: data.factura_nro };
    }
  }
  if (doc) verComprobante(doc);
}

function obtenerConfigImprentaTenant(tenantId) {
  try {
    const raw = localStorage.getItem(`imprenta_seniat_${tenantId}`);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {
    nombre: 'IMPRENTA DIGITAL AUTORIZADA (CONFIGURAR EN PERFIL)',
    rif: 'J-00000000-0',
    providencia: 'SNAT/2024/000102 (Pendiente)',
    rango: '00-00000001 al 00-00099999'
  };
}

function obtenerMetaFacturaLocal(tenantId, doc) {
  try {
    const raw = localStorage.getItem(`facturas_seniat_meta_${tenantId}`);
    if (!raw) return null;
    const store = JSON.parse(raw);
    return store[String(doc.id)] || store[String(doc.factura_nro || doc.numero)] || null;
  } catch (e) {
    return null;
  }
}

function cambiarFormatoComprobante(modo) {
  formatoComprobanteActual = modo === 'ticket' ? 'ticket' : 'digital';
  const cont = document.getElementById('ticketContenedor');
  const cabGrid = document.getElementById('ticketCabeceraGrid');
  const btnDig = document.getElementById('btnFormatoDigital');
  const btnTic = document.getElementById('btnFormatoTicket');
  if (!cont) return;

  if (modo === 'ticket') {
    cont.classList.remove('max-w-3xl');
    cont.classList.add('max-w-sm');
    if (cabGrid) cabGrid.classList.remove('md:grid-cols-12');
    if (btnTic) btnTic.className = 'bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer';
    if (btnDig) btnDig.className = 'bg-slate-200 text-slate-800 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer';
  } else {
    cont.classList.remove('max-w-sm');
    cont.classList.add('max-w-3xl');
    if (cabGrid) cabGrid.classList.add('md:grid-cols-12');
    if (btnDig) btnDig.className = 'bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer';
    if (btnTic) btnTic.className = 'bg-slate-200 text-slate-800 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer';
  }
}

async function verComprobante(doc) {
  if (!tenantActual || !doc) return;
  comprobanteActualCache = doc;
  const tenantId = tenantActual.id;
  const metaLocal = obtenerMetaFacturaLocal(tenantId, doc);
  const imprenta = obtenerConfigImprentaTenant(tenantId);

  const numDoc = doc.numero || doc.factura_nro || 'S/N';
  const numUpper = String(numDoc).toUpperCase();
  const estUpper = String(doc.estado || '').toUpperCase();
  let tituloDoc = 'FACTURA';
  if (numUpper.startsWith('NC')) tituloDoc = 'NOTA DE CRÉDITO';
  else if (numUpper.startsWith('ND')) tituloDoc = 'NOTA DE DÉBITO';
  else if (numUpper.startsWith('REV-') || estUpper === 'REVERSO') tituloDoc = 'COMPROBANTE DE REVERSO';
  else if (estUpper === 'ANULADA') tituloDoc = 'FACTURA (ANULADA)';

  // Consultar items y datos fiscales completos del cliente en Supabase
  const [resItems, resCli] = await Promise.all([
    supabaseClient
      .from('invoice_items')
      .select('*, productos(codigo_sku, descripcion, unidad_medida, tipos_iva(nombre, porcentaje))')
      .eq('invoice_id', doc.id),
    doc.client_id
      ? supabaseClient.from('clientes').select('*').eq('id', doc.client_id).maybeSingle()
      : supabaseClient.from('clientes').select('*').eq('tenant_id', tenantId).eq('rif', doc.cliente_rif || '').maybeSingle()
  ]);

  const items = resItems.data || [];
  const cliDb = resCli.data || null;

  // Emisor
  document.getElementById('ticketComercioNombre').innerText = tenantActual.razon_social || 'CONTRIBUYENTE';
  document.getElementById('ticketComercioRif').innerText = `RIF: ${tenantActual.rif || 'J-00000000-0'}`;
  document.getElementById('ticketComercioDir').innerText = `Domicilio Fiscal: ${tenantActual.direccion || 'VENEZUELA'}`;
  document.getElementById('ticketComercioTelEmail').innerText = `Tel: ${tenantActual.telefono || 'N/A'} | Email: ${tenantActual.email || ''}`;
  document.getElementById('ticketSucursalEmisora').innerText = metaLocal?.sucursalNombre
    ? `Sucursal Emisora: ${metaLocal.sucursalNombre}`
    : 'Sucursal Emisora: Sede Principal';

  // Cuadro Fiscal Derecho
  const formatearDdMmYyyy = (val) => {
    if (!val) return 'S/F';
    const mIso = String(val).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (mIso) return `${mIso[3]}-${mIso[2]}-${mIso[1]}`;
    const d = new Date(val);
    if (isNaN(d)) return String(val);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  };
  const fechaFormateada = formatearDdMmYyyy(metaLocal?.fechaEmision || doc.created_at);
  const fechaAsig = formatearFecha8Digitos(metaLocal?.fechaAsignacionControl || doc.created_at);
  const tasa = Number(doc.tasa_bcv || 1);

  const metodoStr = String(doc.metodo_pago || 'EFECTIVO');
  const partesMetodo = metodoStr.split('|').map(s => s.trim());
  const getMetodoCampo = (pref) => {
    const f = partesMetodo.find(p => p.startsWith(pref));
    return f ? f.slice(pref.length).trim() : '';
  };
  const condFromParts = partesMetodo.find(p => p === 'CONTADO' || p === 'CRÉDITO' || p === 'CREDITO') || '';
  const condPago = metaLocal?.condicionPago || getMetodoCampo('COND:') || (condFromParts === 'CREDITO' ? 'CRÉDITO' : condFromParts) || 'CONTADO';
  const monedaDoc = (metaLocal?.moneda || getMetodoCampo('MON:') || 'USD').toUpperCase();

  document.getElementById('ticketTipoDoc').innerText = tituloDoc;
  document.getElementById('ticketNro').innerText = `N° Documento: ${numDoc}`;
  document.getElementById('ticketControl').innerText = `N° de Control: ${doc.nro_control || '00-00000000'}`;
  document.getElementById('ticketFecha').innerText = `Fecha Emisión: ${fechaFormateada}`;
  document.getElementById('ticketFechaAsignacionControl').innerText = `Asignación Control: ${fechaAsig}`;
  const elMoneda = document.getElementById('ticketMoneda');
  if (elMoneda) elMoneda.innerText = `Moneda: ${monedaDoc}`;
  document.getElementById('ticketTasa').innerText = tasa.toFixed(4);
  document.getElementById('ticketCondicionPago').innerText = `Condición de Pago: ${condPago}`;

  // Datos del Adquirente
  const cliDir = metaLocal?.clienteDireccion || cliDb?.direccion || 'Dirección no especificada en registro';
  const cliTel = metaLocal?.clienteTelefono || cliDb?.telefono || 'N/A';

  document.getElementById('ticketCliente').innerText = `Nombre / Razón Social: ${doc.cliente_nombre || 'CONSUMIDOR FINAL'}`;
  document.getElementById('ticketClienteRif').innerText = `RIF / C.I.: ${doc.cliente_rif || 'V-0'}`;
  document.getElementById('ticketClienteDir').innerText = `Domicilio Fiscal: ${cliDir}`;
  document.getElementById('ticketClienteTel').innerText = `Teléfono: ${cliTel}`;

  const refNotaCompleta = (() => {
    if (metaLocal?.facturaAfectadaNro) {
      const modTxt = metaLocal.modalidad === 'DEVOLUCION'
        ? 'POR DEVOLUCIÓN / REPOSICIÓN (Afecta Stock/Kardex)'
        : 'FINANCIERA (No afecta Inventario)';
      return [
        `Modalidad: ${modTxt}`,
        `Factura Afectada: ${metaLocal.facturaAfectadaNro}`,
        `Control Fac.: ${metaLocal.facturaAfectadaControl || 'N/A'}`,
        `Fecha Fac.: ${metaLocal.facturaAfectadaFecha || 'S/F'}`,
        `Monto Fac.: Bs. ${Number(metaLocal.facturaAfectadaTotalBs || 0).toFixed(2)}`,
        metaLocal.sucursalNombre ? `Depósito: ${metaLocal.sucursalNombre} / ${metaLocal.almacenNombre || ''}` : null,
        metaLocal.motivoCompleto ? `Motivo: ${metaLocal.motivoCompleto}` : null
      ].filter(Boolean).join(' | ');
    }
    return metodoStr;
  })();

  const notaBox = document.getElementById('ticketReferenciaNotaBox');
  if (notaBox) {
    if (numUpper.startsWith('NC') || numUpper.startsWith('ND') || numUpper.startsWith('REV-')) {
      notaBox.classList.remove('hidden');
      notaBox.innerText = `REFERENCIA FISCAL SENIAT: ${refNotaCompleta}`;
    } else {
      notaBox.classList.add('hidden');
      notaBox.innerText = '';
    }
  }

  // Detalle de Bienes / Servicios y Cálculo Impositivo Multi-Alícuota
  const container = document.getElementById('ticketItemsContainer');
  container.innerHTML = '';

  let montoExentoUsd = 0;
  let baseGravadaTotalUsd = 0;
  let ivaTotalUsd = 0;
  const alicuotasMap = {};

  if (items.length > 0) {
    items.forEach((it, idx) => {
      const metaItem = metaLocal?.itemsMeta?.[idx] || null;
      const prod = it.productos || null;
      const sku = metaItem?.sku || prod?.codigo_sku || 'S/N';
      const unidad = metaItem?.unidad || prod?.unidad_medida || 'UND';
      const cant = Number(it.cantidad || 1);
      const pUnitUsd = Number(it.precio_unitario_usd ?? (it.subtotal_usd ? it.subtotal_usd / cant : 0));
      const subUsd = Number(it.subtotal_usd ?? (cant * pUnitUsd));

      // Determinar alícuota real
      let pct = 16;
      if (metaItem && metaItem.ivaPorcentaje !== undefined) {
        pct = Number(metaItem.ivaPorcentaje);
      } else if (prod?.tipos_iva && prod.tipos_iva.porcentaje !== undefined) {
        pct = Number(prod.tipos_iva.porcentaje);
      } else if (it.es_exento) {
        pct = 0;
      }

      if (pct === 0) {
        montoExentoUsd += subUsd;
      } else {
        baseGravadaTotalUsd += subUsd;
        const itemIvaUsd = subUsd * (pct / 100);
        ivaTotalUsd += itemIvaUsd;
        const k = String(pct);
        if (!alicuotasMap[k]) alicuotasMap[k] = { porcentaje: pct, baseUsd: 0, ivaUsd: 0 };
        alicuotasMap[k].baseUsd += subUsd;
        alicuotasMap[k].ivaUsd += itemIvaUsd;
      }

      const descLimpia = metaItem?.descripcion || prod?.descripcion || it.descripcion || 'Artículo';
      const marcaExento = pct === 0 ? ' (E)' : '';
      const badgeAlic = pct === 0 ? 'E (0%)' : `${pct}%`;

      container.innerHTML += `
        <tr class="hover:bg-slate-50">
          <td class="p-2 text-slate-700">${esc(sku)}</td>
          <td class="p-2 text-slate-900 font-semibold">${esc(descLimpia)}${marcaExento}</td>
          <td class="p-2 text-center">${cant} ${esc(unidad)}</td>
          <td class="p-2 text-right">Bs. ${(pUnitUsd * tasa).toFixed(2)}<div class="text-[9px] text-slate-500">$ ${pUnitUsd.toFixed(2)}</div></td>
          <td class="p-2 text-center font-bold">${esc(badgeAlic)}</td>
          <td class="p-2 text-right font-bold">Bs. ${(subUsd * tasa).toFixed(2)}<div class="text-[9px] text-slate-500 font-normal">$ ${subUsd.toFixed(2)}</div></td>
        </tr>
      `;
    });
  } else {
    // Notas fiscales sin items individuales
    const baseNotaUsd = Number(doc.monto_usd || 0);
    baseGravadaTotalUsd = baseNotaUsd;
    const ivaDocBs = Number(doc.iva_bs || (baseNotaUsd * tasa * 0.16));
    ivaTotalUsd = ivaDocBs / tasa;
    alicuotasMap['16'] = { porcentaje: 16, baseUsd: baseNotaUsd, ivaUsd: ivaTotalUsd };
    container.innerHTML = `
      <tr>
        <td class="p-2">AJUSTE</td>
        <td class="p-2 font-semibold">${esc(tituloDoc)} - ${esc(metodoStr)}</td>
        <td class="p-2 text-center">1 UND</td>
        <td class="p-2 text-right">Bs. ${(baseNotaUsd * tasa).toFixed(2)}</td>
        <td class="p-2 text-center">16%</td>
        <td class="p-2 text-right font-bold">Bs. ${(baseNotaUsd * tasa).toFixed(2)}</td>
      </tr>
    `;
  }

  // Totales fiscales en Bs. (moneda principal) + Ref. $ USD
  const montoExentoBs = montoExentoUsd * tasa;
  const ivaBsFinal = Number(doc.iva_bs ?? (ivaTotalUsd * tasa));
  const baseGravadaBsFinal = baseGravadaTotalUsd * tasa;
  const subtotalGeneralBs = baseGravadaBsFinal + montoExentoBs + ivaBsFinal;
  const igtfBs = Number(doc.igtf_bs || 0);
  const baseIgtfBs = igtfBs > 0 ? (igtfBs / 0.03) : 0;
  const totalBs = Number(doc.total_bs ?? (subtotalGeneralBs + igtfBs));

  document.getElementById('ticketExento').innerText = `Bs. ${montoExentoBs.toFixed(2)} ($ ${montoExentoUsd.toFixed(2)})`;

  const desgloseEl = document.getElementById('ticketDesgloseAlicuotas');
  if (desgloseEl) {
    const listaAlic = Object.values(alicuotasMap);
    if (listaAlic.length === 0) {
      desgloseEl.innerHTML = `
        <div class="flex justify-between text-slate-700"><span>Base Imponible IVA (16%):</span><span>Bs. 0.00 ($ 0.00)</span></div>
        <div class="flex justify-between text-slate-700"><span>IVA (16%):</span><span>Bs. 0.00 ($ 0.00)</span></div>
      `;
    } else {
      desgloseEl.innerHTML = listaAlic.map(a => {
        const bBs = a.baseUsd * tasa;
        const iBs = a.ivaUsd * tasa;
        return `
          <div class="flex justify-between text-slate-700"><span>Base Imponible IVA (${a.porcentaje}%):</span><span>Bs. ${bBs.toFixed(2)} ($ ${a.baseUsd.toFixed(2)})</span></div>
          <div class="flex justify-between text-slate-700"><span>IVA (${a.porcentaje}%):</span><span>Bs. ${iBs.toFixed(2)} ($ ${a.ivaUsd.toFixed(2)})</span></div>
        `;
      }).join('');
    }
  }

  const subEl = document.getElementById('ticketSubtotalGeneral');
  if (subEl) subEl.innerText = `Bs. ${subtotalGeneralBs.toFixed(2)} ($ ${(subtotalGeneralBs / tasa).toFixed(2)})`;

  const filaBaseIgtf = document.getElementById('ticketFilaBaseIgtf');
  const elBaseIgtf = document.getElementById('ticketBaseIgtf');
  if (filaBaseIgtf && elBaseIgtf) {
    if (igtfBs > 0) {
      filaBaseIgtf.classList.remove('hidden');
      elBaseIgtf.innerText = `Bs. ${baseIgtfBs.toFixed(2)} ($ ${(baseIgtfBs / tasa).toFixed(2)})`;
    } else {
      filaBaseIgtf.classList.add('hidden');
    }
  }

  document.getElementById('ticketIgtf').innerText = `Bs. ${igtfBs.toFixed(2)} ($ ${(igtfBs / tasa).toFixed(2)})`;
  document.getElementById('ticketTotal').innerText = `Bs. ${totalBs.toFixed(2)} | $ ${(totalBs / tasa).toFixed(2)}`;

  // Imprenta Digital + QR Verificación Fiscal SENIAT
  document.getElementById('ticketImprentaNombre').innerText = `Imprenta Digital: ${imprenta.nombre}`;
  document.getElementById('ticketImprentaRif').innerText = `RIF Imprenta: ${imprenta.rif}`;
  document.getElementById('ticketImprentaProv').innerText = `Autorización: ${imprenta.providencia}`;
  document.getElementById('ticketImprentaRango').innerText = `Control Asignado: ${imprenta.rango}`;

  const qrContainer = document.getElementById('ticketQrCode');
  if (qrContainer) {
    qrContainer.innerHTML = '';
    const qrPayload = [
      `EMISOR:${tenantActual.rif || ''}`,
      `DOC:${numDoc}`,
      `CTRL:${doc.nro_control || ''}`,
      `FECHA:${fechaFormateada}`,
      `CLI:${doc.cliente_rif || ''}`,
      `IVA_BS:${ivaBsFinal.toFixed(2)}`,
      `TOTAL_BS:${totalBs.toFixed(2)}`,
      `BCV:${tasa.toFixed(4)}`
    ].join('|');
    if (typeof QRCode === 'function') {
      new QRCode(qrContainer, {
        text: qrPayload,
        width: 84,
        height: 84,
        colorDark: '#0f172a',
        colorLight: '#ffffff'
      });
    } else {
      qrContainer.innerHTML = `<span class="text-[9px] font-mono text-slate-500">QR FISCAL</span>`;
    }
  }

  const itemsPdf = [];
  if (items.length > 0) {
    items.forEach((it, idx) => {
      const metaItem = metaLocal?.itemsMeta?.[idx] || null;
      const prod = it.productos || null;
      const sku = metaItem?.sku || prod?.codigo_sku || 'S/N';
      const unidad = metaItem?.unidad || prod?.unidad_medida || 'UND';
      const cant = Number(it.cantidad || 1);
      const pUnitUsd = Number(it.precio_unitario_usd ?? (it.subtotal_usd ? it.subtotal_usd / cant : 0));
      const subUsd = Number(it.subtotal_usd ?? (cant * pUnitUsd));

      let pct = 16;
      if (metaItem && metaItem.ivaPorcentaje !== undefined) pct = Number(metaItem.ivaPorcentaje);
      else if (prod?.tipos_iva && prod.tipos_iva.porcentaje !== undefined) pct = Number(prod.tipos_iva.porcentaje);
      else if (it.es_exento) pct = 0;

      const descLimpia = metaItem?.descripcion || prod?.descripcion || it.descripcion || 'Artículo';
      itemsPdf.push({
        sku,
        descripcion: descLimpia + (pct === 0 ? ' (E)' : ''),
        cantUnidad: `${cant} ${unidad}`,
        pUnitBs: pUnitUsd * tasa,
        pUnitUsd,
        alicuota: pct === 0 ? 'E (0%)' : `${pct}%`,
        subBs: subUsd * tasa,
        subUsd
      });
    });
  } else {
    const baseNotaUsd = Number(doc.monto_usd || 0);
    itemsPdf.push({
      sku: 'AJUSTE',
      descripcion: `${tituloDoc} - ${metodoStr}`,
      cantUnidad: '1 UND',
      pUnitBs: baseNotaUsd * tasa,
      pUnitUsd: baseNotaUsd,
      alicuota: '16%',
      subBs: baseNotaUsd * tasa,
      subUsd: baseNotaUsd
    });
  }

  comprobanteRenderCache = {
    tituloDoc,
    numDoc,
    nroControl: doc.nro_control || '00-00000000',
    fechaFormateada,
    fechaAsig,
    moneda: monedaDoc,
    tasa,
    condPago,
    sucursalEmisora: metaLocal?.sucursalNombre || 'Sede Principal',
    emisorNombre: tenantActual.razon_social || 'CONTRIBUYENTE',
    emisorRif: tenantActual.rif || 'J-00000000-0',
    emisorDir: tenantActual.direccion || 'VENEZUELA',
    emisorTel: tenantActual.telefono || 'N/A',
    emisorEmail: tenantActual.email || '',
    cliNombre: doc.cliente_nombre || 'CONSUMIDOR FINAL',
    cliRif: doc.cliente_rif || 'V-0',
    cliDir,
    cliTel,
    esNota: numUpper.startsWith('NC') || numUpper.startsWith('ND') || numUpper.startsWith('REV-'),
    notaRef: refNotaCompleta,
    items: itemsPdf,
    montoExentoBs,
    montoExentoUsd,
    alicuotas: Object.values(alicuotasMap),
    subtotalGeneralBs,
    igtfBs,
    baseIgtfBs,
    totalBs,
    imprenta
  };

  cambiarFormatoComprobante('digital');
  document.getElementById('modalTicket').classList.remove('hidden');
}

function cerrarTicket() { document.getElementById('modalTicket').classList.add('hidden'); }

function imprimirComprobante() {
  const d = comprobanteRenderCache;
  if (!d) {
    avisarReporte('Abre primero un comprobante para imprimirlo.', 'warning');
    return;
  }
  const esTicket = formatoComprobanteActual === 'ticket';
  const nombreArch = esTicket ? `${d.numDoc}_Ticket.pdf` : `${d.numDoc}.pdf`;

  if (typeof ejecutarImpresionConRespaldo === 'function') {
    ejecutarImpresionConRespaldo({
      claseBody: 'imprimiendo-comprobante',
      esTicket80mm: esTicket,
      construirPdfFn: () => {
        const res = construirComprobanteJsPdf();
        return res ? res.pdf : null;
      },
      nombreArchivo: nombreArch,
      tituloVisor: `Imprimir ${d.tituloDoc} · ${d.numDoc}`
    });
    return;
  }

  try {
    window.print();
  } catch (e) {
    console.warn('window.print falló:', e);
  }
}

function obtenerQrDataUrl() {
  const qrBox = document.getElementById('ticketQrCode');
  if (!qrBox) return null;
  const canvas = qrBox.querySelector('canvas');
  if (canvas) {
    try { return canvas.toDataURL('image/png'); } catch (e) {}
  }
  const img = qrBox.querySelector('img');
  if (img && img.src && img.src.startsWith('data:image')) return img.src;
  return null;
}

function construirComprobanteJsPdf() {
  const d = comprobanteRenderCache;
  if (!d) {
    avisarReporte('Abre primero un comprobante para descargarlo o imprimirlo en PDF.', 'warning');
    return null;
  }
  if (!window.jspdf || !window.jspdf.jsPDF) {
    avisarReporte('La librería jsPDF no está cargada. Recarga la página e intenta de nuevo.', 'error');
    return null;
  }

  const { jsPDF } = window.jspdf;
  const qrDataUrl = obtenerQrDataUrl();

  if (formatoComprobanteActual === 'ticket') {
    const alturaEst = Math.max(185, 130 + (d.items.length * 14) + (d.alicuotas.length * 10));
    const pdf = new jsPDF({ unit: 'mm', format: [80, alturaEst] });
    let y = 7;
    const xL = 4;
    const xR = 76;

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    const nomLines = pdf.splitTextToSize(d.emisorNombre.toUpperCase(), 72);
    pdf.text(nomLines, 40, y, { align: 'center' });
    y += nomLines.length * 4;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.text(`RIF: ${d.emisorRif}`, 40, y, { align: 'center' }); y += 3.5;
    const dirLines = pdf.splitTextToSize(d.emisorDir, 72);
    pdf.text(dirLines, 40, y, { align: 'center' }); y += dirLines.length * 3.2;
    pdf.text(`Tel: ${d.emisorTel} | Suc: ${d.sucursalEmisora}`, 40, y, { align: 'center' }); y += 4;

    pdf.line(xL, y, xR, y); y += 4;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.text(`${d.tituloDoc} - ORIGINAL`, 40, y, { align: 'center' }); y += 4.5;

    pdf.setFont('courier', 'bold');
    pdf.setFontSize(7.5);
    pdf.text(`Nro. Doc: ${d.numDoc}`, xL, y); y += 3.5;
    pdf.text(`Nro. Control: ${d.nroControl}`, xL, y); y += 3.5;
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Fecha: ${d.fechaFormateada}`, xL, y); y += 3.5;
    pdf.setFont('helvetica', 'bold');
    pdf.text(`Moneda: ${d.moneda} | Tasa BCV: Bs. ${d.tasa.toFixed(4)}`, xL, y); y += 3.5;
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Condición: ${d.condPago}`, xL, y); y += 4;

    pdf.line(xL, y, xR, y); y += 3.5;
    pdf.setFont('helvetica', 'bold');
    pdf.text(`Cliente: ${d.cliNombre}`, xL, y, { maxWidth: 72 }); y += 3.8;
    pdf.setFont('helvetica', 'normal');
    pdf.text(`RIF/C.I.: ${d.cliRif}`, xL, y); y += 3.5;
    const cliDirL = pdf.splitTextToSize(`Dir: ${d.cliDir}`, 72);
    pdf.text(cliDirL, xL, y); y += cliDirL.length * 3.2;
    pdf.text(`Tel: ${d.cliTel}`, xL, y); y += 4;
    if (d.esNota) {
      pdf.setFont('courier', 'bold');
      pdf.setFontSize(6.5);
      const refTicketL = pdf.splitTextToSize(`REF. FISCAL: ${d.notaRef}`, 72);
      pdf.text(refTicketL, xL, y);
      y += refTicketL.length * 3 + 1;
    }

    pdf.line(xL, y, xR, y); y += 3.5;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    pdf.text('DESCRIPCION / CANT', xL, y);
    pdf.text('TOTAL Bs.', xR, y, { align: 'right' });
    y += 3.5;

    pdf.setFont('helvetica', 'normal');
    d.items.forEach(it => {
      const descL = pdf.splitTextToSize(`${it.descripcion} [${it.alicuota}]`, 48);
      pdf.text(descL, xL, y);
      pdf.text(`Bs. ${it.subBs.toFixed(2)}`, xR, y, { align: 'right' });
      y += descL.length * 3.2;
      pdf.setFontSize(6.5);
      pdf.text(`${it.cantUnidad} x Bs. ${it.pUnitBs.toFixed(2)} ($${it.pUnitUsd.toFixed(2)})`, xL, y);
      pdf.setFontSize(7);
      y += 3.5;
    });

    pdf.line(xL, y, xR, y); y += 3.5;
    pdf.text('Exento (E):', xL, y); pdf.text(`Bs. ${d.montoExentoBs.toFixed(2)}`, xR, y, { align: 'right' }); y += 3.5;
    d.alicuotas.forEach(a => {
      pdf.text(`Base IVA (${a.porcentaje}%):`, xL, y);
      pdf.text(`Bs. ${(a.baseUsd * d.tasa).toFixed(2)}`, xR, y, { align: 'right' }); y += 3.5;
      pdf.text(`IVA (${a.porcentaje}%):`, xL, y);
      pdf.text(`Bs. ${(a.ivaUsd * d.tasa).toFixed(2)}`, xR, y, { align: 'right' }); y += 3.5;
    });
    if (d.igtfBs > 0) {
      pdf.text('IGTF (3%):', xL, y); pdf.text(`Bs. ${d.igtfBs.toFixed(2)}`, xR, y, { align: 'right' }); y += 3.5;
    }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.text('TOTAL:', xL, y);
    pdf.text(`Bs. ${d.totalBs.toFixed(2)} ($${(d.totalBs / d.tasa).toFixed(2)})`, xR, y, { align: 'right' });
    y += 5;

    if (qrDataUrl) {
      pdf.addImage(qrDataUrl, 'PNG', 28, y, 24, 24);
      y += 26;
    }
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6);
    const impL = pdf.splitTextToSize(`${d.imprenta.nombre} | RIF: ${d.imprenta.rif} | ${d.imprenta.providencia} | Ctrl: ${d.imprenta.rango}`, 72);
    pdf.text(impL, 40, y, { align: 'center' });

    return { pdf, fileName: `${d.numDoc}_Ticket.pdf`, esTicket: true };
  }

  // Formato Carta / Digital SENIAT (A4 / Letter)
  const pdf = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' });
  const pageW = pdf.internal.pageSize.getWidth();
  const margin = 14;
  const contentW = pageW - margin * 2;
  let y = 14;

  // Emisor (izquierda) y Cuadro Fiscal (derecha)
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.5);
  pdf.setTextColor(4, 120, 87);
  pdf.text('CONTRIBUYENTE EMISOR', margin, y);

  pdf.setTextColor(15, 23, 42);
  pdf.setFontSize(12);
  const emisorNomL = pdf.splitTextToSize(d.emisorNombre.toUpperCase(), 102);
  pdf.text(emisorNomL, margin, y + 5);

  let yEmisor = y + 5 + emisorNomL.length * 5;
  pdf.setFont('courier', 'bold');
  pdf.setFontSize(9);
  pdf.text(`RIF: ${d.emisorRif}`, margin, yEmisor); yEmisor += 4.5;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  const emisorDirL = pdf.splitTextToSize(`Domicilio Fiscal: ${d.emisorDir}`, 102);
  pdf.text(emisorDirL, margin, yEmisor); yEmisor += emisorDirL.length * 4;
  pdf.text(`Tel: ${d.emisorTel} | Email: ${d.emisorEmail}`, margin, yEmisor); yEmisor += 4;
  pdf.setFont('helvetica', 'bold');
  pdf.text(`Sucursal Emisora: ${d.sucursalEmisora}`, margin, yEmisor); yEmisor += 4;

  // Cuadro Fiscal Derecho
  const boxX = margin + 108;
  const boxW = contentW - 108;
  pdf.setDrawColor(30, 41, 59);
  pdf.setFillColor(248, 250, 252);
  pdf.roundedRect(boxX, y - 2, boxW, 41, 2, 2, 'FD');

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10.5);
  pdf.setTextColor(4, 120, 87);
  pdf.text(d.tituloDoc, boxX + 3, y + 4);
  pdf.setFontSize(7);
  pdf.setTextColor(15, 23, 42);
  pdf.text('ORIGINAL', boxX + boxW - 3, y + 4, { align: 'right' });
  pdf.line(boxX + 2, y + 6, boxX + boxW - 2, y + 6);

  pdf.setFont('courier', 'bold');
  pdf.setFontSize(8.5);
  pdf.text(`N° Documento: ${d.numDoc}`, boxX + 3, y + 10.5);
  pdf.setTextColor(185, 28, 28);
  pdf.text(`N° de Control: ${d.nroControl}`, boxX + 3, y + 15);
  pdf.setTextColor(30, 41, 59);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.text(`Fecha Emisión: ${d.fechaFormateada}`, boxX + 3, y + 19.5);
  pdf.text(`Asig. Control: ${d.fechaAsig}`, boxX + 3, y + 23.5);
  pdf.setFont('helvetica', 'bold');
  pdf.text(`Moneda: ${d.moneda}`, boxX + 3, y + 27.5);
  pdf.text(`Tasa BCV: ${d.tasa.toFixed(4)} Bs./$`, boxX + 3, y + 31.5);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`Condición Pago: ${d.condPago}`, boxX + 3, y + 35.5);

  y = Math.max(yEmisor, y + 41) + 3;
  pdf.setDrawColor(15, 23, 42);
  pdf.setLineWidth(0.6);
  pdf.line(margin, y, pageW - margin, y);
  y += 4;

  // Bloque Adquirente / Cliente
  pdf.setLineWidth(0.2);
  pdf.setDrawColor(203, 213, 225);
  pdf.setFillColor(248, 250, 252);
  const cliDirLines = pdf.splitTextToSize(`Domicilio Fiscal: ${d.cliDir}`, 88);
  pdf.setFont('courier', 'bold');
  pdf.setFontSize(7);
  const notaRefLines = d.esNota ? pdf.splitTextToSize(`REF. FISCAL SENIAT: ${d.notaRef}`, contentW - 6) : [];
  const baseCliH = Math.max(20, 12 + cliDirLines.length * 4);
  const cliBoxH = baseCliH + (d.esNota ? notaRefLines.length * 3.5 + 3 : 0);
  pdf.roundedRect(margin, y, contentW, cliBoxH, 2, 2, 'FD');

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7);
  pdf.setTextColor(100, 116, 139);
  pdf.text('DATOS DEL ADQUIRENTE / CLIENTE', margin + 3, y + 4.5);

  pdf.setTextColor(15, 23, 42);
  pdf.setFontSize(8.5);
  pdf.text(`Razón Social / Nombre: ${d.cliNombre}`, margin + 3, y + 9.5, { maxWidth: 92 });
  pdf.setFont('courier', 'bold');
  pdf.text(`RIF / C.I.: ${d.cliRif}`, margin + 3, y + 14.5);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);

  const col2X = margin + 96;
  pdf.text(cliDirLines, col2X, y + 9.5);
  const yCol2 = y + 9.5 + cliDirLines.length * 3.8;
  pdf.text(`Teléfono: ${d.cliTel}`, col2X, yCol2);

  if (d.esNota && notaRefLines.length > 0) {
    pdf.setFont('courier', 'bold');
    pdf.setFontSize(7);
    pdf.setTextColor(146, 64, 14);
    pdf.text(notaRefLines, margin + 3, y + baseCliH + 1.5);
  }

  y += cliBoxH + 5;

  // Tabla de Items
  const drawTableHeader = (yPos) => {
    pdf.setFillColor(15, 23, 42);
    pdf.rect(margin, yPos, contentW, 7, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.text('Código', margin + 2, yPos + 4.7);
    pdf.text('Descripción', margin + 26, yPos + 4.7);
    pdf.text('Cant/Und', margin + 104, yPos + 4.7, { align: 'center' });
    pdf.text('P. Unit (Bs.)', margin + 135, yPos + 4.7, { align: 'right' });
    pdf.text('Alíc.', margin + 149, yPos + 4.7, { align: 'center' });
    pdf.text('Total (Bs.)', pageW - margin - 2, yPos + 4.7, { align: 'right' });
    return yPos + 7;
  };

  y = drawTableHeader(y);
  pdf.setTextColor(15, 23, 42);

  d.items.forEach((it) => {
    const descL = pdf.splitTextToSize(it.descripcion, 66);
    const rowH = Math.max(8, descL.length * 3.8 + 4);
    if (y + rowH > 235) {
      pdf.addPage();
      y = 16;
      y = drawTableHeader(y);
      pdf.setTextColor(15, 23, 42);
    }

    pdf.setDrawColor(226, 232, 240);
    pdf.line(margin, y + rowH, pageW - margin, y + rowH);

    pdf.setFont('courier', 'normal');
    pdf.setFontSize(7.5);
    pdf.text(String(it.sku).slice(0, 14), margin + 2, y + 4.5);

    pdf.setFont('helvetica', 'bold');
    pdf.text(descL, margin + 26, y + 4.5);

    pdf.setFont('courier', 'normal');
    pdf.text(it.cantUnidad, margin + 104, y + 4.5, { align: 'center' });

    pdf.text(`Bs. ${it.pUnitBs.toFixed(2)}`, margin + 135, y + 4.2, { align: 'right' });
    pdf.setFontSize(6.5);
    pdf.setTextColor(100, 116, 139);
    pdf.text(`$${it.pUnitUsd.toFixed(2)}`, margin + 135, y + 7.2, { align: 'right' });

    pdf.setTextColor(15, 23, 42);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.text(it.alicuota, margin + 149, y + 4.5, { align: 'center' });

    pdf.setFont('courier', 'bold');
    pdf.text(`Bs. ${it.subBs.toFixed(2)}`, pageW - margin - 2, y + 4.2, { align: 'right' });
    pdf.setFont('courier', 'normal');
    pdf.setFontSize(6.5);
    pdf.setTextColor(100, 116, 139);
    pdf.text(`$${it.subUsd.toFixed(2)}`, pageW - margin - 2, y + 7.2, { align: 'right' });
    pdf.setTextColor(15, 23, 42);

    y += rowH;
  });

  y += 5;
  if (y > 215) {
    pdf.addPage();
    y = 18;
  }

  // Bloque inferior: QR + Imprenta Digital (izquierda) y Totales SENIAT (derecha)
  const leftW = 80;
  const rightX = margin + leftW + 4;
  const rightW = contentW - leftW - 4;
  const alicRows = d.alicuotas.length > 0 ? d.alicuotas.length * 2 : 2;
  const totBoxH = 26 + alicRows * 4.5 + (d.igtfBs > 0 ? 5 : 0);

  // Imprenta + QR
  pdf.setDrawColor(203, 213, 225);
  pdf.setFillColor(248, 250, 252);
  pdf.roundedRect(margin, y, leftW, Math.max(34, totBoxH), 2, 2, 'FD');

  if (qrDataUrl) {
    pdf.addImage(qrDataUrl, 'PNG', margin + 3, y + 3, 24, 24);
  }
  const impX = margin + (qrDataUrl ? 29 : 3);
  const impW = leftW - (qrDataUrl ? 31 : 6);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7);
  pdf.setTextColor(15, 23, 42);
  pdf.text('VERIFICACIÓN DIGITAL SENIAT', impX, y + 5.5);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(6.5);
  const impText = pdf.splitTextToSize(
    `Imprenta: ${d.imprenta.nombre}\nRIF: ${d.imprenta.rif}\nAut.: ${d.imprenta.providencia}\nControl: ${d.imprenta.rango}`,
    impW
  );
  pdf.text(impText, impX, y + 9.5);

  // Totales Fiscales
  pdf.setFillColor(255, 255, 255);
  pdf.roundedRect(rightX, y, rightW, Math.max(34, totBoxH), 2, 2, 'FD');

  let ty = y + 5.5;
  pdf.setFont('courier', 'normal');
  pdf.setFontSize(7.5);
  const addTotRow = (label, val, bold = false, size = 7.5) => {
    pdf.setFont('courier', bold ? 'bold' : 'normal');
    pdf.setFontSize(size);
    pdf.text(label, rightX + 3, ty);
    pdf.text(val, rightX + rightW - 3, ty, { align: 'right' });
    ty += 4.6;
  };

  addTotRow('Exento / Exonerado (E):', `Bs. ${d.montoExentoBs.toFixed(2)} ($${d.montoExentoUsd.toFixed(2)})`);
  if (d.alicuotas.length === 0) {
    addTotRow('Base Imponible IVA (16%):', 'Bs. 0.00 ($0.00)');
    addTotRow('IVA (16%):', 'Bs. 0.00 ($0.00)');
  } else {
    d.alicuotas.forEach(a => {
      addTotRow(`Base Imponible IVA (${a.porcentaje}%):`, `Bs. ${(a.baseUsd * d.tasa).toFixed(2)} ($${a.baseUsd.toFixed(2)})`);
      addTotRow(`IVA (${a.porcentaje}%):`, `Bs. ${(a.ivaUsd * d.tasa).toFixed(2)} ($${a.ivaUsd.toFixed(2)})`);
    });
  }
  pdf.setDrawColor(226, 232, 240);
  pdf.line(rightX + 2, ty - 2, rightX + rightW - 2, ty - 2);
  addTotRow('Subtotal Factura:', `Bs. ${d.subtotalGeneralBs.toFixed(2)} ($${(d.subtotalGeneralBs / d.tasa).toFixed(2)})`);
  if (d.igtfBs > 0) {
    addTotRow('Base Imponible IGTF (3%):', `Bs. ${d.baseIgtfBs.toFixed(2)} ($${(d.baseIgtfBs / d.tasa).toFixed(2)})`);
  }
  addTotRow('IGTF (3%):', `Bs. ${d.igtfBs.toFixed(2)} ($${(d.igtfBs / d.tasa).toFixed(2)})`);
  pdf.setDrawColor(15, 23, 42);
  pdf.line(rightX + 2, ty - 1.5, rightX + rightW - 2, ty - 1.5);
  ty += 1.5;
  addTotRow('TOTAL A PAGAR:', `Bs. ${d.totalBs.toFixed(2)} | $${(d.totalBs / d.tasa).toFixed(2)}`, true, 9);

  // Pie de página legal
  const fy = Math.max(y + Math.max(34, totBoxH) + 6, ty + 4);
  pdf.setDrawColor(203, 213, 225);
  pdf.line(margin, fy, pageW - margin, fy);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7);
  pdf.setTextColor(51, 65, 85);
  pdf.text('Artículo 25 Ley del IVA / Normativa BCV: Operación facturada en Bolívares y referenciada en divisas al tipo de cambio oficial BCV vigente.', margin, fy + 4.5);
  pdf.setFont('helvetica', 'normal');
  pdf.text('Documento emitido digitalmente conforme a las Providencias Administrativas SNAT/2011/00071 y SNAT/2024/000102.', margin, fy + 8.5);

  return { pdf, fileName: `${d.numDoc}.pdf`, esTicket: false };
}

function descargarComprobantePdf() {
  const res = construirComprobanteJsPdf();
  if (!res) return;
  res.pdf.save(res.fileName);
  avisarReporte(`${res.esTicket ? 'PDF' : 'Factura Digital'} ${res.fileName} descargado con éxito.`, 'success');
}

let notasFacturasCache = [];
let notaFacturaSeleccionada = null;
let notaItemsDevolucion = [];
let notaProductosCatalogoCache = [];
let notaSucursalesCache = [];
let notaAlmacenesCache = [];

function formatearDdMmYyyyNota(val) {
  if (!val) return 'S/F';
  const mIso = String(val).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (mIso) return `${mIso[3]}-${mIso[2]}-${mIso[1]}`;
  const d = new Date(val);
  if (isNaN(d)) return String(val);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}

async function inicializarModuloNotasFiscales() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id;

  const elFecha = document.getElementById('notaFechaEmision');
  if (elFecha && !elFecha.value) elFecha.value = new Date().toISOString().slice(0, 10);

  await Promise.all([
    sincronizarMetasNotasNube(tenantId),
    cargarCatalogosParaNotas(tenantId),
    cargarFacturasAfectadasSelect(),
    cargarTablaNotasFiscalesRecientes()
  ]);

  onCambioTipoOModalidadNota();
  await sincronizarTasaNotaBcv(true);
  await cargarDetalleFacturaAfectadaNota();
}

async function cargarCatalogosParaNotas(tenantId) {
  const [resSuc, resAlm, resProd] = await Promise.all([
    supabaseClient.from('sucursales').select('*').eq('tenant_id', tenantId).order('nombre', { ascending: true }),
    supabaseClient.from('almacenes').select('*, sucursales(nombre)').eq('tenant_id', tenantId).order('nombre', { ascending: true }),
    supabaseClient.from('productos').select('*, tipos_iva(nombre, porcentaje)').eq('tenant_id', tenantId).order('descripcion', { ascending: true })
  ]);

  notaSucursalesCache = resSuc.data || [];
  notaAlmacenesCache = resAlm.data || [];
  notaProductosCatalogoCache = resProd.data || [];

  const selSuc = document.getElementById('notaSucursalSelect');
  if (selSuc) {
    selSuc.innerHTML = '<option value="">-- Seleccionar Sucursal --</option>';
    notaSucursalesCache.forEach(s => {
      selSuc.innerHTML += `<option value="${esc(s.id)}">${esc(s.nombre)}</option>`;
    });
    if (notaSucursalesCache.length === 1) selSuc.value = notaSucursalesCache[0].id;
  }
  filtrarAlmacenesNota();

  const selExtra = document.getElementById('notaNdExtraProdSelect');
  if (selExtra) {
    selExtra.innerHTML = '<option value="">-- Seleccionar Material --</option>';
    notaProductosCatalogoCache.forEach(p => {
      const precio = Number(p.precio_venta_usd || 0).toFixed(2);
      selExtra.innerHTML += `<option value="${esc(p.id)}">[${esc(p.codigo_sku || 'S/N')}] ${esc(p.descripcion)} ($ ${precio})</option>`;
    });
  }
}

function filtrarAlmacenesNota(almacenPreferidoId = '') {
  const sucId = document.getElementById('notaSucursalSelect')?.value || '';
  const selAlm = document.getElementById('notaAlmacenSelect');
  if (!selAlm) return;

  const prev = almacenPreferidoId || selAlm.value;
  const lista = sucId
    ? notaAlmacenesCache.filter(a => String(a.sucursal_id || '') === String(sucId))
    : notaAlmacenesCache;

  selAlm.innerHTML = '<option value="">-- Seleccionar Almacén --</option>';
  lista.forEach(a => {
    const tag = !sucId && a.sucursales?.nombre ? `[${a.sucursales.nombre}] ` : '';
    selAlm.innerHTML += `<option value="${esc(a.id)}">${esc(tag)}${esc(a.nombre)}</option>`;
  });

  if (prev && lista.some(a => String(a.id) === String(prev))) {
    selAlm.value = prev;
  } else if (lista.length === 1) {
    selAlm.value = lista[0].id;
  }
}

async function sincronizarTasaNotaBcv(silencioso = false) {
  const modo = document.getElementById('notaTasaModoSelect')?.value || 'DIA';
  if (modo === 'ORIGINAL' && notaFacturaSeleccionada) {
    const el = document.getElementById('notaTasaBcv');
    if (el) el.value = Number(notaFacturaSeleccionada.tasa_bcv || 1).toFixed(4);
    recalcularResumenNotaFiscal();
    return;
  }

  let tasa = parseFloat(document.getElementById('tasaBcv')?.value) || 0;
  try {
    const res = await fetch(silencioso ? '/api/tasa-bcv' : '/api/tasa-bcv?force=1');
    const json = await res.json();
    if (json?.ok && Number(json.usd) > 0) {
      tasa = Number(json.usd);
      const inputPos = document.getElementById('tasaBcv');
      if (inputPos) inputPos.value = tasa.toFixed(4);
    }
  } catch (e) {}

  const elNotaTasa = document.getElementById('notaTasaBcv');
  if (elNotaTasa && tasa > 0) elNotaTasa.value = tasa.toFixed(4);
  recalcularResumenNotaFiscal();
  if (!silencioso && tasa > 0) {
    avisarReporte(`Tasa BCV en Nota actualizada a Bs. ${tasa.toFixed(4)}.`, 'success', 4000);
  }
}

function onCambioModoTasaNota() {
  const modo = document.getElementById('notaTasaModoSelect')?.value || 'DIA';
  const el = document.getElementById('notaTasaBcv');
  if (modo === 'ORIGINAL' && notaFacturaSeleccionada) {
    if (el) el.value = Number(notaFacturaSeleccionada.tasa_bcv || 1).toFixed(4);
  } else {
    const tasaDia = parseFloat(document.getElementById('tasaBcv')?.value) || 0;
    if (el && tasaDia > 0) el.value = tasaDia.toFixed(4);
  }
  recalcularResumenNotaFiscal();
}

function obtenerMotivoPorDefectoNota(tipo, modalidad) {
  if (modalidad === 'DEVOLUCION') {
    return tipo === 'NOTA CREDITO'
      ? 'Devolución de mercancía'
      : 'Reposición / entrega adicional de mercancía';
  }
  return tipo === 'NOTA CREDITO'
    ? 'Descuento / ajuste financiero'
    : 'Cargo financiero / diferencia de precio';
}

function onCambioTipoOModalidadNota() {
  const tipo = document.getElementById('tipoNotaSelect')?.value || 'NOTA CREDITO';
  const modalidad = document.getElementById('modalidadNotaSelect')?.value || 'FINANCIERA';
  const esDev = modalidad === 'DEVOLUCION';

  const panelFin = document.getElementById('notaModoFinancieroPanel');
  const panelDev = document.getElementById('notaModoDevolucionPanel');
  const depWrap = document.getElementById('notaDepositoWrap');
  const ndExtraWrap = document.getElementById('notaNdAgregarWrap');
  const hint = document.getElementById('notaEfectoKardexHint');

  if (panelFin) panelFin.classList.toggle('hidden', esDev);
  if (panelDev) panelDev.classList.toggle('hidden', !esDev);
  if (depWrap) depWrap.classList.toggle('hidden', !esDev);
  if (ndExtraWrap) ndExtraWrap.classList.toggle('hidden', !(esDev && tipo === 'NOTA DEBITO'));

  if (hint) {
    if (tipo === 'NOTA CREDITO') {
      hint.textContent = 'Movimiento Kardex: ENTRADA (Devolución reingresa unidades al stock)';
      hint.className = 'text-xs text-emerald-400 font-medium py-2.5';
    } else {
      hint.textContent = 'Movimiento Kardex: SALIDA (Reposición o entrega adicional descuenta stock)';
      hint.className = 'text-xs text-amber-400 font-medium py-2.5';
    }
  }

  const motivoEl = document.getElementById('motivoNota');
  if (motivoEl) {
    const val = (motivoEl.value || '').trim();
    if (!val || motivoEl.dataset.autoMotivo === '1') {
      motivoEl.value = obtenerMotivoPorDefectoNota(tipo, modalidad);
      motivoEl.dataset.autoMotivo = '1';
      if (!motivoEl.dataset.listenerBound) {
        motivoEl.addEventListener('input', () => { motivoEl.dataset.autoMotivo = '0'; });
        motivoEl.dataset.listenerBound = '1';
      }
    }
  }

  renderizarTablaItemsNotaDevolucion();
  recalcularResumenNotaFiscal();
}

async function cargarFacturasAfectadasSelect() {
  if (!tenantActual) return;
  const { data } = await supabaseClient.from('invoices').select('*').eq('tenant_id', tenantActual.id).order('created_at', { ascending: false });
  notasFacturasCache = data || [];
  const select = document.getElementById('facturaAfectadaSelect');
  if (!select) return;
  const prev = select.value;
  select.innerHTML = '';

  const validas = notasFacturasCache.filter(f => {
    const numUpper = (f.factura_nro || '').toUpperCase();
    const estUpper = (f.estado || '').toUpperCase();
    return !numUpper.startsWith('NC') && !numUpper.startsWith('ND') && !numUpper.startsWith('REV-') && estUpper !== 'ANULADA' && estUpper !== 'REVERSO';
  });

  if (validas.length === 0) {
    select.innerHTML = '<option value="">Sin facturas emitidas disponibles</option>';
    notaFacturaSeleccionada = null;
    return;
  }

  validas.forEach(f => {
    const fechaF = formatearDdMmYyyyNota(f.created_at);
    select.innerHTML += `<option value="${esc(f.factura_nro)}">${esc(f.factura_nro)} | Ctrl: ${esc(f.nro_control || 'N/A')} | ${fechaF} | ${esc(f.cliente_nombre)} | Bs. ${Number(f.total_bs || 0).toFixed(2)}</option>`;
  });

  if (prev && validas.some(v => v.factura_nro === prev)) {
    select.value = prev;
  }
}

async function cargarDetalleFacturaAfectadaNota() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id;
  const facNro = document.getElementById('facturaAfectadaSelect')?.value || '';
  notaFacturaSeleccionada = notasFacturasCache.find(f => f.factura_nro === facNro) || null;
  notaItemsDevolucion = [];

  const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  if (!notaFacturaSeleccionada) {
    setText('notaResFacCtrl', 'Sin seleccionar');
    setText('notaResFacFecha', '-');
    setText('notaResFacCliente', '-');
    setText('notaResFacTasa', '-');
    setText('notaResFacTotal', 'Bs. 0.00');
    renderizarTablaItemsNotaDevolucion();
    recalcularResumenNotaFiscal();
    return;
  }

  const metaFac = obtenerMetaFacturaLocal(tenantId, notaFacturaSeleccionada);
  const fechaFac = formatearDdMmYyyyNota(metaFac?.fechaEmision || notaFacturaSeleccionada.created_at);

  setText('notaResFacCtrl', `${notaFacturaSeleccionada.factura_nro} / ${notaFacturaSeleccionada.nro_control || 'N/A'}`);
  setText('notaResFacFecha', fechaFac);
  setText('notaResFacCliente', `${notaFacturaSeleccionada.cliente_nombre} (${notaFacturaSeleccionada.cliente_rif})`);
  setText('notaResFacTasa', `Bs. ${Number(notaFacturaSeleccionada.tasa_bcv || 1).toFixed(4)}`);
  setText('notaResFacTotal', `Bs. ${Number(notaFacturaSeleccionada.total_bs || 0).toFixed(2)}`);

  if (metaFac?.sucursalId && document.getElementById('notaSucursalSelect')) {
    document.getElementById('notaSucursalSelect').value = metaFac.sucursalId;
    filtrarAlmacenesNota(metaFac.almacenId || '');
  }

  if (document.getElementById('notaTasaModoSelect')?.value === 'ORIGINAL') {
    onCambioModoTasaNota();
  }

  // Consultar renglones de la factura y notas de crédito previas vinculadas a esta factura
  const { data: itemsFac } = await supabaseClient
    .from('invoice_items')
    .select('*, productos(codigo_sku, descripcion, unidad_medida, maneja_inventario, tipos_iva(porcentaje))')
    .eq('invoice_id', notaFacturaSeleccionada.id);

  const yaDevueltoPorProd = {};
  try {
    const storeRaw = localStorage.getItem(`facturas_seniat_meta_${tenantId}`);
    const store = storeRaw ? JSON.parse(storeRaw) : {};
    const ncsPrevias = notasFacturasCache.filter(inv => {
      if (!String(inv.factura_nro || '').toUpperCase().startsWith('NC')) return false;
      const mInv = store[String(inv.id)] || store[String(inv.factura_nro)] || null;
      return mInv && mInv.facturaAfectadaNro === facNro && mInv.modalidad === 'DEVOLUCION';
    });
    if (ncsPrevias.length > 0) {
      const idsNc = ncsPrevias.map(n => n.id);
      const { data: itemsNcPrev } = await supabaseClient.from('invoice_items').select('producto_id, cantidad').in('invoice_id', idsNc);
      (itemsNcPrev || []).forEach(ni => {
        if (!ni.producto_id) return;
        yaDevueltoPorProd[String(ni.producto_id)] = (yaDevueltoPorProd[String(ni.producto_id)] || 0) + Number(ni.cantidad || 0);
      });
    }
  } catch (e) {}

  notaItemsDevolucion = (itemsFac || []).map((it, idx) => {
    const metaIt = metaFac?.itemsMeta?.[idx] || null;
    const prod = it.productos || null;
    const cantFacturada = Number(it.cantidad || 0);
    const yaDevuelta = Number(yaDevueltoPorProd[String(it.producto_id)] || 0);
    const ivaPct = metaIt?.ivaPorcentaje !== undefined
      ? Number(metaIt.ivaPorcentaje)
      : (prod?.tipos_iva?.porcentaje !== undefined ? Number(prod.tipos_iva.porcentaje) : (it.es_exento ? 0 : 16));

    return {
      productoId: it.producto_id,
      sku: metaIt?.sku || prod?.codigo_sku || 'S/N',
      descripcion: metaIt?.descripcion || prod?.descripcion || it.descripcion || 'Artículo',
      unidad: metaIt?.unidad || prod?.unidad_medida || 'UND',
      cantFacturada,
      yaDevuelta,
      cantNota: 0,
      precioUnitUsd: Number(it.precio_unitario_usd || 0),
      ivaPorcentaje: ivaPct,
      manejaInventario: prod ? Boolean(prod.maneja_inventario) : true,
      esExtraNd: false
    };
  });

  renderizarTablaItemsNotaDevolucion();
  recalcularResumenNotaFiscal();
}

function renderizarTablaItemsNotaDevolucion() {
  const tbody = document.getElementById('tablaItemsNotaDevolucion');
  if (!tbody) return;
  tbody.innerHTML = '';

  const tipo = document.getElementById('tipoNotaSelect')?.value || 'NOTA CREDITO';
  if (notaItemsDevolucion.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-500">La factura seleccionada no contiene renglones de artículos.</td></tr>`;
    return;
  }

  notaItemsDevolucion.forEach((it, idx) => {
    const maxNc = Math.max(0, Number((it.cantFacturada - it.yaDevuelta).toFixed(4)));
    const maxAttr = tipo === 'NOTA CREDITO' && !it.esExtraNd ? `max="${maxNc}"` : '';
    const subUsd = Number(it.cantNota || 0) * Number(it.precioUnitUsd || 0);

    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/40">
        <td class="p-2.5">
          <div class="font-semibold text-white">[${esc(it.sku)}] ${esc(it.descripcion)}</div>
          <div class="text-[10px] text-slate-400">Unidad: ${esc(it.unidad)}${it.esExtraNd ? ' · Adicional ND' : ''}</div>
        </td>
        <td class="p-2.5 text-center font-mono">${it.cantFacturada}</td>
        <td class="p-2.5 text-center font-mono text-amber-300">${it.yaDevuelta}</td>
        <td class="p-2.5 text-center">
          <input id="notaItemInput_${idx}" type="number" step="0.01" min="0" ${maxAttr} value="${it.cantNota}" onchange="actualizarCantidadItemNota(${idx}, this.value)" oninput="actualizarCantidadItemNota(${idx}, this.value)" class="w-24 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-center font-mono text-white tabular-nums">
        </td>
        <td class="p-2.5 text-right font-mono">$ ${it.precioUnitUsd.toFixed(2)}</td>
        <td class="p-2.5 text-center font-mono">${it.ivaPorcentaje === 0 ? 'E (0%)' : it.ivaPorcentaje + '%'}</td>
        <td id="notaItemSub_${idx}" class="p-2.5 text-right font-mono font-bold text-emerald-400">$ ${subUsd.toFixed(2)}</td>
      </tr>
    `;
  });
}

function actualizarCantidadItemNota(idx, val) {
  const it = notaItemsDevolucion[idx];
  if (!it) return;
  const tipo = document.getElementById('tipoNotaSelect')?.value || 'NOTA CREDITO';
  let q = parseFloat(val) || 0;
  if (q < 0) q = 0;
  if (tipo === 'NOTA CREDITO' && !it.esExtraNd) {
    const maxDisp = Math.max(0, it.cantFacturada - it.yaDevuelta);
    if (q > maxDisp) {
      q = maxDisp;
      const inpEl = document.getElementById(`notaItemInput_${idx}`);
      if (inpEl) inpEl.value = q;
      avisarReporte(`Máximo devolvible para ${it.descripcion}: ${maxDisp} uds (Facturado: ${it.cantFacturada}, Ya devuelto: ${it.yaDevuelta}).`, 'warning', 5000);
    }
  }
  it.cantNota = q;
  const subUsd = q * Number(it.precioUnitUsd || 0);
  const subEl = document.getElementById(`notaItemSub_${idx}`);
  if (subEl) subEl.textContent = `$ ${subUsd.toFixed(2)}`;
  recalcularResumenNotaFiscal();
}

function seleccionarTodoDevolucionNota() {
  const tipo = document.getElementById('tipoNotaSelect')?.value || 'NOTA CREDITO';
  notaItemsDevolucion.forEach(it => {
    if (tipo === 'NOTA CREDITO') {
      it.cantNota = Math.max(0, Number((it.cantFacturada - it.yaDevuelta).toFixed(4)));
    } else {
      it.cantNota = it.cantFacturada;
    }
  });
  renderizarTablaItemsNotaDevolucion();
  recalcularResumenNotaFiscal();
}

function agregarProductoExtraNd() {
  const prodId = document.getElementById('notaNdExtraProdSelect')?.value || '';
  const cant = parseFloat(document.getElementById('notaNdExtraCant')?.value) || 0;
  if (!prodId || cant <= 0) {
    avisarReporte('Selecciona un material y una cantidad válida mayor a 0.', 'warning');
    return;
  }
  const prod = notaProductosCatalogoCache.find(p => String(p.id) === String(prodId));
  if (!prod) return;

  const existente = notaItemsDevolucion.find(i => String(i.productoId) === String(prodId) && i.esExtraNd);
  if (existente) {
    existente.cantNota += cant;
  } else {
    notaItemsDevolucion.push({
      productoId: prod.id,
      sku: prod.codigo_sku || 'S/N',
      descripcion: prod.descripcion,
      unidad: prod.unidad_medida || 'UND',
      cantFacturada: 0,
      yaDevuelta: 0,
      cantNota: cant,
      precioUnitUsd: Number(prod.precio_venta_usd || 0),
      ivaPorcentaje: Number(prod.tipos_iva?.porcentaje ?? 16),
      manejaInventario: Boolean(prod.maneja_inventario),
      esExtraNd: true
    });
  }

  renderizarTablaItemsNotaDevolucion();
  recalcularResumenNotaFiscal();
}

function calcularTotalesNotaEnVivo() {
  const modalidad = document.getElementById('modalidadNotaSelect')?.value || 'FINANCIERA';
  const tasa = parseFloat(document.getElementById('notaTasaBcv')?.value) || parseFloat(document.getElementById('tasaBcv')?.value) || 1;
  let exentoUsd = 0;
  let baseGravadaUsd = 0;
  let ivaUsd = 0;

  if (modalidad === 'FINANCIERA') {
    const montoUsd = parseFloat(document.getElementById('montoNotaUsd')?.value) || 0;
    const alic = Number(document.getElementById('notaAlicuotaFinancieraSelect')?.value ?? 16);
    if (alic === 0) exentoUsd = montoUsd;
    else {
      baseGravadaUsd = montoUsd;
      ivaUsd = montoUsd * (alic / 100);
    }
  } else {
    notaItemsDevolucion.forEach(it => {
      const q = Number(it.cantNota || 0);
      if (q <= 0) return;
      const sub = q * Number(it.precioUnitUsd || 0);
      const pct = Number(it.ivaPorcentaje ?? 16);
      if (pct === 0) exentoUsd += sub;
      else {
        baseGravadaUsd += sub;
        ivaUsd += sub * (pct / 100);
      }
    });
  }

  const totalUsd = exentoUsd + baseGravadaUsd + ivaUsd;
  return {
    tasa,
    exentoUsd,
    baseGravadaUsd,
    ivaUsd,
    totalUsd,
    exentoBs: exentoUsd * tasa,
    baseGravadaBs: baseGravadaUsd * tasa,
    subtotalBs: (exentoUsd + baseGravadaUsd) * tasa,
    ivaBs: ivaUsd * tasa,
    totalBs: totalUsd * tasa
  };
}

function recalcularResumenNotaFiscal() {
  const t = calcularTotalesNotaEnVivo();
  const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  setTxt('notaPrevExento', `Bs. ${t.exentoBs.toFixed(2)}`);
  setTxt('notaPrevBase', `Bs. ${t.baseGravadaBs.toFixed(2)}`);
  setTxt('notaPrevIva', `Bs. ${t.ivaBs.toFixed(2)}`);
  setTxt('notaPrevTotal', `Bs. ${t.totalBs.toFixed(2)} ($ ${t.totalUsd.toFixed(2)})`);
}

async function emitirNotaFiscal() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id;

  const tipoNota = document.getElementById('tipoNotaSelect')?.value || 'NOTA CREDITO';
  const modalidad = document.getElementById('modalidadNotaSelect')?.value || 'FINANCIERA';
  const facturaAfectada = document.getElementById('facturaAfectadaSelect')?.value || '';
  const fechaEmision = document.getElementById('notaFechaEmision')?.value || new Date().toISOString().slice(0, 10);
  const motivoInput = document.getElementById('motivoNota');
  let motivo = (motivoInput?.value || '').trim();

  if (!facturaAfectada || !notaFacturaSeleccionada) {
    avisarReporte('Selecciona la Factura de Venta afectada.', 'warning');
    return;
  }
  if (!motivo) {
    motivo = `${obtenerMotivoPorDefectoNota(tipoNota, modalidad)} (${facturaAfectada})`;
    if (motivoInput) motivoInput.value = motivo;
  }

  const calc = calcularTotalesNotaEnVivo();
  if (calc.tasa <= 0) {
    avisarReporte('Ingresa una Tasa BCV válida mayor a 0.', 'warning');
    return;
  }

  let itemsAProcesar = [];
  let sucId = '';
  let almId = '';
  let sucNombre = '';
  let almNombre = '';

  if (modalidad === 'FINANCIERA') {
    if (calc.exentoUsd + calc.baseGravadaUsd <= 0) {
      avisarReporte('Ingresa un Monto Base ($ USD) mayor a 0 para la Nota Financiera.', 'warning');
      return;
    }
    const alic = Number(document.getElementById('notaAlicuotaFinancieraSelect')?.value ?? 16);
    const concepto = (document.getElementById('notaConceptoFinanciero')?.value || '').trim() || motivo;
    itemsAProcesar = [{
      productoId: null,
      sku: tipoNota === 'NOTA CREDITO' ? 'NC-FIN' : 'ND-FIN',
      descripcion: concepto,
      unidad: 'SER',
      cantNota: 1,
      precioUnitUsd: calc.exentoUsd + calc.baseGravadaUsd,
      ivaPorcentaje: alic,
      manejaInventario: false
    }];
  } else {
    itemsAProcesar = notaItemsDevolucion.filter(it => Number(it.cantNota || 0) > 0);
    if (itemsAProcesar.length === 0) {
      avisarReporte('Indica al menos un artículo con cantidad mayor a 0 para la Nota por Devolución/Reposición.', 'warning');
      return;
    }
    if (tipoNota === 'NOTA CREDITO') {
      const exceso = itemsAProcesar.find(it => !it.esExtraNd && Number(it.cantNota) > (it.cantFacturada - it.yaDevuelta + 0.0001));
      if (exceso) {
        avisarReporte(`Cantidad a devolver de ${exceso.descripcion} excede lo pendiente de la factura.`, 'warning');
        return;
      }
    }
    sucId = document.getElementById('notaSucursalSelect')?.value || '';
    almId = document.getElementById('notaAlmacenSelect')?.value || '';
    if (!sucId || !almId) {
      avisarReporte('Selecciona la Sucursal y Almacén para registrar el movimiento de inventario.', 'warning');
      return;
    }
    sucNombre = notaSucursalesCache.find(s => String(s.id) === String(sucId))?.nombre || 'Sede Principal';
    almNombre = notaAlmacenesCache.find(a => String(a.id) === String(almId))?.nombre || 'Almacén';
  }

  const btn = document.getElementById('btnEmitirNotaFiscal');
  if (btn) { btn.disabled = true; btn.classList.add('opacity-60', 'cursor-not-allowed'); }

  try {
    const nroNota = (tipoNota === 'NOTA CREDITO' ? 'NC-' : 'ND-') + String(Math.floor(100000 + Math.random() * 900000));
    const nroControl = '00-' + String(Math.floor(10000000 + Math.random() * 89999999));

    const metaFac = obtenerMetaFacturaLocal(tenantId, notaFacturaSeleccionada);
    const monedaFac = metaFac?.moneda || 'USD';
    const fechaFacForm = formatearDdMmYyyyNota(metaFac?.fechaEmision || notaFacturaSeleccionada.created_at);

    const tagTipo = `${tipoNota === 'NOTA CREDITO' ? 'NC' : 'ND'}-${modalidad === 'DEVOLUCION' ? 'DEV' : 'FIN'}`;
    const metodoCompacto = `${tagTipo} | ${facturaAfectada} | MON:${monedaFac}`.slice(0, 50);

    const { data: invData, error: errNota } = await supabaseClient.from('invoices').insert([{
      tenant_id: tenantId,
      client_id: notaFacturaSeleccionada.client_id || null,
      factura_nro: nroNota,
      nro_control: nroControl,
      tasa_bcv: calc.tasa,
      monto_usd: Number((calc.exentoUsd + calc.baseGravadaUsd).toFixed(4)),
      subtotal_bs: Number(calc.subtotalBs.toFixed(2)),
      iva_bs: Number(calc.ivaBs.toFixed(2)),
      igtf_bs: 0,
      total_bs: Number(calc.totalBs.toFixed(2)),
      cliente_rif: notaFacturaSeleccionada.cliente_rif || 'V-0',
      cliente_nombre: notaFacturaSeleccionada.cliente_nombre || 'CLIENTE',
      metodo_pago: metodoCompacto,
      estado: 'EMITIDA'
    }]).select();

    if (errNota || !invData || invData.length === 0) {
      avisarReporte('Error al emitir nota fiscal: ' + (errNota?.message || 'Error en servidor'), 'error', 9000);
      return;
    }

    const notaDoc = invData[0];

    const metaNotaCompleta = {
      invoiceId: notaDoc.id,
      notaNro: nroNota,
      tipoNota,
      modalidad,
      moneda: monedaFac,
      fechaEmision,
      fechaAsignacionControl: notaDoc.created_at || new Date().toISOString(),
      condicionPago: metaFac?.condicionPago || 'CONTADO',
      clienteDireccion: metaFac?.clienteDireccion || '',
      clienteTelefono: metaFac?.clienteTelefono || '',
      facturaAfectadaNro: notaFacturaSeleccionada.factura_nro,
      facturaAfectadaControl: notaFacturaSeleccionada.nro_control || 'N/A',
      facturaAfectadaFecha: fechaFacForm,
      facturaAfectadaTotalBs: Number(notaFacturaSeleccionada.total_bs || 0),
      motivoCompleto: motivo,
      sucursalId: sucId,
      almacenId: almId,
      sucursalNombre: sucNombre,
      almacenNombre: almNombre,
      itemsMeta: itemsAProcesar.map(it => ({
        productoId: it.productoId,
        sku: it.sku,
        descripcion: it.descripcion,
        unidad: it.unidad,
        cantidad: Number(it.cantNota),
        precio: Number(it.precioUnitUsd),
        ivaPorcentaje: Number(it.ivaPorcentaje),
        esExento: Number(it.ivaPorcentaje) === 0
      }))
    };

    guardarMetaFacturaLocalYNota(tenantId, notaDoc.id, nroNota, metaNotaCompleta);
    await supabaseClient.from('audit_logs').insert([{
      tenant_id: tenantId,
      accion: 'NOTA_FISCAL_META',
      detalle: JSON.stringify(metaNotaCompleta)
    }]);

    let kardexBloqueadoRls = false;

    for (const it of itemsAProcesar) {
      await supabaseClient.from('invoice_items').insert([{
        invoice_id: notaDoc.id,
        producto_id: it.productoId || null,
        cantidad: Number(it.cantNota),
        precio_unitario_usd: Number(it.precioUnitUsd),
        es_exento: Number(it.ivaPorcentaje) === 0,
        subtotal_usd: Number((it.cantNota * it.precioUnitUsd).toFixed(4)),
        descripcion: `[${it.sku}] ${it.descripcion}`
      }]);

      // Solo modalidad DEVOLUCION afecta stock y Kardex PPM
      if (modalidad === 'DEVOLUCION' && it.productoId && typeof ajustarStockProductoYLotes === 'function') {
        const delta = tipoNota === 'NOTA CREDITO' ? Number(it.cantNota) : -Number(it.cantNota);
        const adj = await ajustarStockProductoYLotes(tenantId, it.productoId, almId, delta);

        if (adj.manejaInventario) {
          const esEntrada = tipoNota === 'NOTA CREDITO';
          const tagDoc = esEntrada ? 'NC DEVOLUCION' : 'ND REPOSICION';
          const docRefKardex = `${nroNota} | ${tagDoc} | FAC:${notaFacturaSeleccionada.factura_nro} | SUC:${sucNombre} | ALM:${almNombre} | CTRL:${nroControl}`;

          const resK = await supabaseClient.from('kardex_movimientos').insert([{
            tenant_id: tenantId,
            producto_id: it.productoId,
            tipo_movimiento: esEntrada ? 'ENTRADA' : 'SALIDA',
            documento_ref: docRefKardex,
            cantidad_in: esEntrada ? Number(it.cantNota) : 0,
            cantidad_out: esEntrada ? 0 : Number(it.cantNota),
            saldo_cantidad: adj.stock,
            costo_promedio_usd: adj.costo,
            precio_venta_usd: Number(it.precioUnitUsd || 0),
            tasa_bcv: calc.tasa,
            fecha: fechaEmision
          }]);

          if (resK.error && String(resK.error.code || '') === '42501') {
            kardexBloqueadoRls = true;
          }
        }
      }
    }

    avisarReporte(
      `¡${tipoNota === 'NOTA CREDITO' ? 'Nota de Crédito' : 'Nota de Débito'} ${nroNota} (${modalidad === 'DEVOLUCION' ? 'con impacto en Kardex' : 'Financiera'}) emitida con éxito!`,
      'success',
      7000
    );
    if (kardexBloqueadoRls) {
      avisarReporte('Nota emitida, pero Supabase RLS (42501) bloqueó el asiento en Kardex.', 'warning', 8000);
    }

    if (document.getElementById('montoNotaUsd')) document.getElementById('montoNotaUsd').value = '';
    if (document.getElementById('motivoNota')) document.getElementById('motivoNota').value = '';
    if (document.getElementById('notaConceptoFinanciero')) document.getElementById('notaConceptoFinanciero').value = '';

    await Promise.all([
      cargarFacturasAfectadasSelect(),
      cargarDetalleFacturaAfectadaNota(),
      cargarTablaNotasFiscalesRecientes(),
      cargarHistorial(),
      typeof cargarKardexMovimientos === 'function' ? cargarKardexMovimientos() : Promise.resolve(),
      typeof cargarProductosSelect === 'function' ? cargarProductosSelect() : Promise.resolve()
    ]);

    verComprobante({ ...notaDoc, tipoDoc: tipoNota, numero: notaDoc.factura_nro });
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('opacity-60', 'cursor-not-allowed'); }
  }
}

async function cargarTablaNotasFiscalesRecientes() {
  if (!tenantActual) return;
  const tbody = document.getElementById('tablaNotasFiscalesRecientes');
  if (!tbody) return;

  const { data } = await supabaseClient
    .from('invoices')
    .select('*')
    .eq('tenant_id', tenantActual.id)
    .order('created_at', { ascending: false })
    .limit(120);

  const notas = (data || []).filter(f => {
    const n = String(f.factura_nro || '').toUpperCase();
    return n.startsWith('NC') || n.startsWith('ND');
  });

  tbody.innerHTML = '';
  if (notas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-500">Sin Notas de Crédito o Débito emitidas aún.</td></tr>`;
    return;
  }

  notas.forEach(n => {
    const meta = obtenerMetaFacturaLocal(tenantActual.id, n);
    const esNc = String(n.factura_nro || '').toUpperCase().startsWith('NC');
    const tipoLabel = esNc ? 'NOTA DE CRÉDITO' : 'NOTA DE DÉBITO';
    const badgeCls = esNc ? 'bg-sky-950 text-sky-300' : 'bg-amber-950 text-amber-300';
    const modalidadTxt = meta?.modalidad === 'DEVOLUCION'
      ? '<span class="text-emerald-400 font-semibold">Devolución / Kardex</span>'
      : '<span class="text-slate-300">Financiera</span>';
    const facRef = meta?.facturaAfectadaNro || String(n.metodo_pago || '').split('|')[1]?.trim() || 'N/A';

    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/40">
        <td class="p-3 font-mono font-bold text-white"><span class="px-2 py-0.5 rounded text-[10px] ${badgeCls} mr-1">${tipoLabel}</span> ${esc(n.factura_nro)}</td>
        <td class="p-3 text-xs">${modalidadTxt}</td>
        <td class="p-3 font-mono text-slate-300">${esc(facRef)}</td>
        <td class="p-3 text-slate-200">${esc(n.cliente_nombre)}</td>
        <td class="p-3 font-mono text-slate-400">${formatearDdMmYyyyNota(meta?.fechaEmision || n.created_at)}</td>
        <td class="p-3 text-right font-mono font-bold ${esNc ? 'text-sky-300' : 'text-amber-300'}">${esNc ? '-' : '+'}Bs. ${Math.abs(Number(n.total_bs || 0)).toFixed(2)}</td>
        <td class="p-3 text-center"><button type="button" onclick='verComprobantePorId("${esc(n.id)}")' class="bg-slate-800 hover:bg-slate-700 px-3 py-1 rounded text-xs text-slate-200 cursor-pointer">Ver / PDF</button></td>
      </tr>
    `;
  });
}

async function generarReporteZ() {
  if (!tenantActual) return;
  const fDesde = document.getElementById('filtroFechaDesde')?.value || '';
  const fHasta = document.getElementById('filtroFechaHasta')?.value || '';

  const { data } = await supabaseClient.from('invoices').select('*').eq('tenant_id', tenantActual.id);
  const filtradas = (data || []).filter(f => {
    const fIso = f.created_at ? String(f.created_at).slice(0, 10) : '';
    if (fDesde && fIso && fIso < fDesde) return false;
    if (fHasta && fIso && fIso > fHasta) return false;
    return true;
  });

  document.getElementById('zTotalFacturas').innerText = filtradas.length;
  let total = 0;
  filtradas.forEach(f => {
    const numUpper = (f.factura_nro || '').toUpperCase();
    const val = Number(f.total_bs || 0);
    if (numUpper.startsWith('NC')) total -= Math.abs(val);
    else total += val;
  });
  document.getElementById('totalGavetaEfectivo').innerText = `Bs. ${total.toFixed(2)}`;
}

function descargarExcelMatriz(matrizDatos, nombreArchivo, nombreHoja) {
  const worksheet = XLSX.utils.aoa_to_sheet(matrizDatos);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, nombreHoja);
  XLSX.writeFile(workbook, `${nombreArchivo}_${new Date().toISOString().slice(0,10)}.xlsx`);
}

async function descargarLibroVentasOficialExcel() {
  if (!tenantActual) return;
  await sincronizarMetasNotasNube(tenantActual.id);

  const fDesde = document.getElementById('filtroFechaDesde')?.value || '';
  const fHasta = document.getElementById('filtroFechaHasta')?.value || '';

  const { data: invoices } = await supabaseClient
    .from('invoices')
    .select('*, invoice_items(*)')
    .eq('tenant_id', tenantActual.id)
    .order('created_at', { ascending: true });

  const filtradas = (invoices || []).filter(inv => {
    const fIso = inv.created_at ? String(inv.created_at).slice(0, 10) : '';
    if (fDesde && fIso && fIso < fDesde) return false;
    if (fHasta && fIso && fIso > fHasta) return false;
    return true;
  });

  if (filtradas.length === 0) { avisarReporte('Sin ventas o notas en el rango seleccionado.', 'warning'); return; }

  const matriz = [
    [null, 'CONTRIBUYENTE:', tenantActual.razon_social, 'RIF:', tenantActual.rif || ''],
    [null, 'LIBRO DE VENTAS SENIAT', fDesde && fHasta ? `Período: ${formatearDdMmYyyyNota(fDesde)} al ${formatearDdMmYyyyNota(fHasta)}` : 'Todos los registros'],
    [],
    [null, 'Oper', 'Fecha', 'Tipo Doc.', 'Modalidad', 'RIF / C.I.', 'Nombre / Razón Social', 'N° Documento', 'N° Control', 'Factura Afectada', 'Total Ventas (Bs.)', 'Base Imponible (Bs.)', 'IVA (Bs.)', 'IGTF (Bs.)', 'Estado']
  ];

  filtradas.forEach((inv, i) => {
    const numUpper = String(inv.factura_nro || '').toUpperCase();
    const estUpper = String(inv.estado || 'EMITIDA').toUpperCase();
    const meta = obtenerMetaFacturaLocal(tenantActual.id, inv);

    let tipoDoc = 'FACTURA';
    let signo = 1;
    if (numUpper.startsWith('NC')) { tipoDoc = 'NOTA DE CRÉDITO'; signo = -1; }
    else if (numUpper.startsWith('ND')) { tipoDoc = 'NOTA DE DÉBITO'; signo = 1; }
    else if (numUpper.startsWith('REV-') || estUpper === 'REVERSO') { tipoDoc = 'REVERSO'; signo = -1; }

    const modalidad = meta?.modalidad || (tipoDoc === 'FACTURA' ? 'VENTA' : '-');
    const facAfectada = meta?.facturaAfectadaNro || meta?.documentoOrigen || '-';

    const totalBs = signo * Math.abs(Number(inv.total_bs || 0));
    const baseBs = signo * Math.abs(Number(inv.subtotal_bs || 0));
    const ivaBs = signo * Math.abs(Number(inv.iva_bs || 0));
    const igtfBs = signo * Math.abs(Number(inv.igtf_bs || 0));

    matriz.push([
      null,
      i + 1,
      formatearDdMmYyyyNota(meta?.fechaEmision || inv.created_at),
      tipoDoc,
      modalidad,
      inv.cliente_rif || '',
      inv.cliente_nombre || '',
      inv.factura_nro || '',
      inv.nro_control || 'N/A',
      facAfectada,
      Number(totalBs.toFixed(2)),
      Number(baseBs.toFixed(2)),
      Number(ivaBs.toFixed(2)),
      Number(igtfBs.toFixed(2)),
      estUpper
    ]);
  });

  descargarExcelMatriz(matriz, 'Libro_de_Ventas_SENIAT', 'LibroVentas');
  avisarReporte('Libro de Ventas oficial SENIAT descargado.', 'success');
}

async function descargarLibroComprasOficialExcel() {
  if (!tenantActual) return;
  const { data: movimientosIn, error } = await supabaseClient
    .from('kardex_movimientos')
    .select('*')
    .eq('tenant_id', tenantActual.id)
    .eq('tipo_movimiento', 'ENTRADA')
    .order('created_at', { ascending: true });

  if (error) {
    avisarReporte('Error al consultar Libro de Compras (Kardex): ' + error.message, 'error', 8000);
    return;
  }
  const compras = (movimientosIn || []).filter(m => !/^REV-/i.test(String(m.documento_ref || '').trim()));
  if (compras.length === 0) {
    avisarReporte('Sin compras registradas en Kardex para generar el Libro de Compras.', 'warning');
    return;
  }

  const matriz = [[null, 'COMPAÑÍA:', tenantActual.razon_social], [], [null, null, null, null, 'LIBRO DE COMPRAS SENIAT']];
  matriz.push([null, 'Oper', 'Fecha', 'Documento', 'Nro. Factura', 'Nro. Control', 'Proveedor', 'Tasa BCV', 'Total Compras (Bs.)', 'Base Imponible (Bs.)', 'IVA 16% (Bs.)']);
  compras.forEach((c, i) => {
    const ref = String(c.documento_ref || '');
    const partes = ref.split('|').map(s => s.trim());
    const docNro = partes[0]?.match(/^COMP-\d+/i) ? partes[0] : (ref || 'COMP');
    const getCampo = (pref) => {
      const encontrado = partes.find(p => p.startsWith(pref));
      return encontrado ? encontrado.slice(pref.length).trim() : '';
    };
    const fac = getCampo('FAC:') || 'S/N';
    const ctrl = getCampo('CTRL:') || 'S/N';
    const prov = getCampo('PROV:') || ref || 'General';
    const tasa = Number(c.tasa_bcv || 1);
    const base = Number(c.costo_promedio_usd || 0) * Number(c.cantidad_in || 0) * tasa;
    const iva = base * 0.16;
    const fechaDoc = c.fecha || (c.created_at ? c.created_at.slice(0, 10) : '');
    matriz.push([null, i + 1, fechaDoc, docNro, fac, ctrl, prov, tasa, base + iva, base, iva]);
  });
  descargarExcelMatriz(matriz, 'Libro_de_Compras', 'LibroCompras');
}

async function generarComprobanteRetencion() {
  const facRef = document.getElementById('retFacturaRef')?.value.trim() || 'FAC-0001';
  const baseUsd = parseFloat(document.getElementById('retBaseUsd')?.value) || 0;
  const porcentaje = parseFloat(document.getElementById('retPorcentaje')?.value) || 100;
  if (baseUsd <= 0) { avisarReporte('Complete los datos de la retención.', 'warning'); return; }

  const tasa = parseFloat(document.getElementById('tasaBcv').value) || 1;
  const baseBs = baseUsd * tasa;
  const ivaBs = baseBs * 0.16;
  const ivaRetenidoBs = ivaBs * (porcentaje / 100);
  const nroComp = 'RET-' + new Date().getFullYear() + '-' + Math.floor(10000 + Math.random() * 90000);

  const { error } = await supabaseClient.from('retenciones_iva').insert([{
    tenant_id: tenantActual.id, nro_comprobante: nroComp, factura_ref: facRef,
    base_imponible_bs: baseBs, iva_bs: ivaBs, porcentaje_retencion: porcentaje, iva_retenido_bs: ivaRetenidoBs
  }]).select();

  if (error) {
    const code = String(error.code || '');
    if (code === '42501' || /row-level security/i.test(error.message || '')) {
      avisarReporte('Permiso denegado por Supabase (RLS 42501) en "retenciones_iva". Habilita la política RLS en Supabase para guardar retenciones.', 'error', 9000);
    } else {
      avisarReporte('Error al generar retención: ' + error.message, 'error', 8000);
    }
    return;
  }

  avisarReporte(`¡Comprobante de Retención de IVA ${nroComp} generado con éxito (${porcentaje}%)!`, 'success');
  cargarRetenciones();
}

async function cargarRetenciones() {
  if (!tenantActual) return;
  const { data, error } = await supabaseClient.from('retenciones_iva').select('*').eq('tenant_id', tenantActual.id).order('created_at', { ascending: false });
  const tbody = document.getElementById('tablaRetenciones');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (error) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-rose-400">Error al consultar retenciones: ${esc(error.message)}</td></tr>`;
    return;
  }
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-500">Sin comprobantes de retención registrados.</td></tr>`;
    return;
  }
  data.forEach(r => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/40">
        <td class="p-3 font-mono text-emerald-400 font-bold">${esc(r.nro_comprobante)}</td>
        <td class="p-3 font-mono">${esc(r.factura_ref)}</td>
        <td class="p-3 font-mono">Bs. ${(r.base_imponible_bs || 0).toFixed(2)}</td>
        <td class="p-3 font-mono">Bs. ${(r.iva_bs || 0).toFixed(2)}</td>
        <td class="p-3 font-mono text-emerald-300 font-bold">Bs. ${(r.iva_retenido_bs || 0).toFixed(2)} (${r.porcentaje_retencion}%)</td>
        <td class="p-3 text-center"><button onclick="avisarReporte('Comprobante ${esc(r.nro_comprobante)} | Factura: ${esc(r.factura_ref)} | IVA Retenido: Bs. ${(r.iva_retenido_bs || 0).toFixed(2)}', 'info', 7000)" class="text-sky-400 hover:underline cursor-pointer">Ver</button></td>
      </tr>
    `;
  });
}

// ==========================================
// SEN-006 / COM-003: EXPORTACIONES EXCEL
// ==========================================

async function exportarHistorialExcel() {
  if (!tenantActual) return;
  if (!documentosHistorialCache || documentosHistorialCache.length === 0) {
    await cargarHistorial();
  }
  if (!documentosHistorialCache || documentosHistorialCache.length === 0) {
    avisarReporte('No hay comprobantes fiscales para exportar.', 'warning');
    return;
  }

  const matriz = [
    ['EMISOR:', tenantActual.razon_social || '', 'RIF:', tenantActual.rif || ''],
    [],
    ['Tipo', 'Documento', 'Nro. Control', 'Fecha', 'Cliente', 'RIF Cliente', 'Método / Moneda', 'Tasa BCV', 'Subtotal Bs.', 'IVA Bs.', 'IGTF Bs.', 'Total Bs.', 'Estado']
  ];

  documentosHistorialCache.forEach(d => {
    matriz.push([
      d.tipoDoc || 'FACTURA',
      d.numero || d.factura_nro || '',
      d.nro_control || 'N/A',
      formatearFecha8Digitos(d.created_at),
      d.cliente_nombre || '',
      d.cliente_rif || '',
      d.metodo_pago || '',
      Number(d.tasa_bcv || 1),
      Number(d.subtotal_bs || 0),
      Number(d.iva_bs || 0),
      Number(d.igtf_bs || 0),
      Number(d.total_bs || 0),
      d.estado || 'EMITIDA'
    ]);
  });

  descargarExcelMatriz(matriz, 'Historial_Comprobantes_SENIAT', 'Comprobantes');
  avisarReporte('Historial de comprobantes exportado a Excel.', 'success');
}

async function exportarComprasExcel() {
  if (!tenantActual) return;
  const { data, error } = await supabaseClient
    .from('kardex_movimientos')
    .select('*, productos(codigo_sku, descripcion, unidad_medida)')
    .eq('tenant_id', tenantActual.id)
    .eq('tipo_movimiento', 'ENTRADA')
    .order('created_at', { ascending: false });

  if (error) {
    avisarReporte('Error al consultar compras para exportar: ' + error.message, 'error');
    return;
  }

  const compras = (data || []).filter(m => !/^REV-/i.test(String(m.documento_ref || '').trim()));
  if (compras.length === 0) {
    avisarReporte('No hay compras registradas para exportar.', 'warning');
    return;
  }

  const matriz = [
    ['EMPRESA:', tenantActual.razon_social || '', 'RIF:', tenantActual.rif || ''],
    [],
    ['Fecha', 'Referencia Documento', 'SKU', 'Material', 'Unidad', 'Cantidad', 'Costo Unit. (USD)', 'Tasa BCV', 'Total Est. (USD)', 'Total Est. (Bs.)']
  ];

  compras.forEach(m => {
    const cant = Number(m.cantidad_in || 0);
    const costo = Number(m.costo_promedio_usd || 0);
    const tasa = Number(m.tasa_bcv || 1);
    const totUsd = cant * costo;
    matriz.push([
      m.fecha || (m.created_at ? m.created_at.slice(0, 10) : ''),
      m.documento_ref || '',
      m.productos?.codigo_sku || 'S/N',
      m.productos?.descripcion || 'Material',
      m.productos?.unidad_medida || 'UND',
      cant,
      costo,
      tasa,
      Number(totUsd.toFixed(2)),
      Number((totUsd * tasa).toFixed(2))
    ]);
  });

  descargarExcelMatriz(matriz, 'Reporte_Compras_Detallado', 'Compras');
  avisarReporte('Reporte detallado de compras exportado a Excel.', 'success');
}

// ==========================================
// CIE-005 / CAT-007: CUENTAS POR COBRAR Y ALERTAS
// ==========================================

let cuentasPorCobrarCache = [];

function leerAbonosCxcLocal(tenantId) {
  try {
    return JSON.parse(localStorage.getItem(`cxc_abonos_${tenantId}`) || '{}');
  } catch (e) {
    return {};
  }
}

function guardarAbonoCxcLocal(tenantId, invoiceId, abonoObj) {
  try {
    const store = leerAbonosCxcLocal(tenantId);
    if (!store[String(invoiceId)]) store[String(invoiceId)] = [];
    store[String(invoiceId)].push(abonoObj);
    localStorage.setItem(`cxc_abonos_${tenantId}`, JSON.stringify(store));
  } catch (e) {}
}

async function cargarCuentasPorCobrar() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id;

  const [resInv, resAudit] = await Promise.all([
    supabaseClient.from('invoices').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
    supabaseClient.from('audit_logs').select('*').eq('tenant_id', tenantId).eq('accion', 'ABONO_CXC')
  ]);

  const abonosPorFactura = {};
  const localStore = leerAbonosCxcLocal(tenantId);
  Object.keys(localStore).forEach(invId => {
    abonosPorFactura[invId] = (localStore[invId] || []).reduce((acc, a) => acc + Number(a.montoUsd || 0), 0);
  });

  if (!resAudit.error && Array.isArray(resAudit.data)) {
    const nubeSum = {};
    resAudit.data.forEach(log => {
      try {
        const det = JSON.parse(log.detalle || '{}');
        if (det.invoiceId && Number(det.montoUsd) > 0) {
          nubeSum[String(det.invoiceId)] = (nubeSum[String(det.invoiceId)] || 0) + Number(det.montoUsd);
        }
      } catch (e) {}
    });
    Object.keys(nubeSum).forEach(invId => {
      abonosPorFactura[invId] = Math.max(abonosPorFactura[invId] || 0, nubeSum[invId]);
    });
  }

  await sincronizarMetasNotasNube(tenantId);

  const ajusteNotasPorFactura = {};
  (resInv.data || []).forEach(doc => {
    const nro = String(doc.factura_nro || '').toUpperCase();
    if (!nro.startsWith('NC') && !nro.startsWith('ND')) return;
    const metaDoc = obtenerMetaFacturaLocal(tenantId, doc);
    const facRef = metaDoc?.facturaAfectadaNro || '';
    if (!facRef) return;
    const tasaN = Number(doc.tasa_bcv || 1);
    const totUsdN = Number(doc.total_bs || 0) / tasaN;
    ajusteNotasPorFactura[facRef] = (ajusteNotasPorFactura[facRef] || 0) + (nro.startsWith('NC') ? -totUsdN : totUsdN);
  });

  const creditoList = (resInv.data || []).filter(inv => {
    const nro = String(inv.factura_nro || '').toUpperCase();
    const est = String(inv.estado || '').toUpperCase();
    if (nro.startsWith('NC') || nro.startsWith('ND') || nro.startsWith('REV-') || est === 'ANULADA' || est === 'REVERSO') return false;
    const meta = obtenerMetaFacturaLocal(tenantId, inv);
    const cond = String(meta?.condicionPago || '').toUpperCase();
    const met = String(inv.metodo_pago || '').toUpperCase();
    return cond.includes('CRÉDITO') || cond.includes('CREDITO') || met.includes('CRÉDITO') || met.includes('CREDITO');
  });

  const hoyMs = Date.now();
  let totalCarteraUsd = 0;
  let pendienteTotalUsd = 0;
  let vencidasCount = 0;

  cuentasPorCobrarCache = creditoList.map(inv => {
    const tasa = Number(inv.tasa_bcv || 1);
    const baseUsd = Number(inv.total_bs ? (Number(inv.total_bs) / tasa) : (inv.monto_usd || 0));
    const ajusteNotaUsd = ajusteNotasPorFactura[inv.factura_nro] || 0;
    const totalUsd = Math.max(0, baseUsd + ajusteNotaUsd);
    const abonadoUsd = Math.min(totalUsd, abonosPorFactura[String(inv.id)] || 0);
    const saldoUsd = Math.max(0, totalUsd - abonadoUsd);
    const diasTranscurridos = Math.max(0, Math.floor((hoyMs - new Date(inv.created_at).getTime()) / 86400000));
    const vencida = saldoUsd > 0.01 && diasTranscurridos > 15;
    if (vencida) vencidasCount += 1;
    totalCarteraUsd += totalUsd;
    pendienteTotalUsd += saldoUsd;

    return {
      ...inv,
      tasa,
      totalUsd,
      abonadoUsd,
      saldoUsd,
      diasTranscurridos,
      vencida
    };
  });

  const elTot = document.getElementById('cxcTotalCartera');
  const elPen = document.getElementById('cxcPendienteCobro');
  const elVen = document.getElementById('cxcVencidasAlerta');
  if (elTot) elTot.textContent = `$ ${totalCarteraUsd.toFixed(2)}`;
  if (elPen) elPen.textContent = `$ ${pendienteTotalUsd.toFixed(2)}`;
  if (elVen) elVen.textContent = `${vencidasCount} factura(s) > 15 días`;

  const tbody = document.getElementById('tablaCuentasPorCobrar');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (cuentasPorCobrarCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-5 text-center text-slate-500">No existen facturas emitidas a CRÉDITO pendientes de cobro.</td></tr>`;
    return;
  }

  cuentasPorCobrarCache.forEach(c => {
    const estatus = c.saldoUsd <= 0.01
      ? '<span class="text-emerald-400 font-semibold">SOLVENTE</span>'
      : (c.vencida
          ? `<span class="text-rose-400 font-semibold">VENCIDA (${c.diasTranscurridos}d)</span>`
          : `<span class="text-amber-300 font-semibold">VIGENTE (${c.diasTranscurridos}d)</span>`);

    const accionHtml = c.saldoUsd <= 0.01
      ? `<span class="text-xs text-slate-500 font-mono">Liquidada</span>`
      : `<div class="flex items-center justify-center gap-1.5">
           <input type="number" step="0.01" min="0.01" max="${c.saldoUsd.toFixed(2)}" id="abonoInput_${esc(c.id)}" value="${c.saldoUsd.toFixed(2)}" class="w-24 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs font-mono text-white tabular-nums">
           <button type="button" onclick='abonarCuentaPorCobrar("${esc(c.id)}")' class="bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap">Registrar Abono</button>
         </div>`;

    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/40">
        <td class="p-3 font-mono font-bold text-white">${esc(c.factura_nro)}<div class="text-[11px] text-slate-500">${formatearFecha8Digitos(c.created_at)}</div></td>
        <td class="p-3 text-slate-200">${esc(c.cliente_nombre)}<div class="text-[11px] font-mono text-slate-500">${esc(c.cliente_rif)}</div></td>
        <td class="p-3 font-mono tabular-nums text-slate-300">$ ${c.totalUsd.toFixed(2)}</td>
        <td class="p-3 font-mono tabular-nums text-emerald-400">$ ${c.abonadoUsd.toFixed(2)}</td>
        <td class="p-3 font-mono tabular-nums font-bold ${c.saldoUsd > 0.01 ? 'text-amber-300' : 'text-emerald-400'}">$ ${c.saldoUsd.toFixed(2)}</td>
        <td class="p-3 text-xs">${estatus}</td>
        <td class="p-3 text-center">${accionHtml}</td>
      </tr>
    `;
  });
}

async function abonarCuentaPorCobrar(invoiceId) {
  if (!tenantActual) return;
  const tenantId = tenantActual.id;
  const item = cuentasPorCobrarCache.find(c => String(c.id) === String(invoiceId));
  if (!item) return;

  const input = document.getElementById(`abonoInput_${invoiceId}`);
  const montoUsd = parseFloat(input?.value || item.saldoUsd) || 0;
  if (montoUsd <= 0) {
    avisarReporte('Ingresa un monto de abono mayor a 0.', 'warning');
    return;
  }
  const montoAplicado = Math.min(montoUsd, item.saldoUsd);
  const abonoObj = {
    invoiceId,
    facturaNro: item.factura_nro,
    montoUsd: Number(montoAplicado.toFixed(2)),
    fecha: new Date().toISOString()
  };

  guardarAbonoCxcLocal(tenantId, invoiceId, abonoObj);
  await supabaseClient.from('audit_logs').insert([{
    tenant_id: tenantId,
    accion: 'ABONO_CXC',
    detalle: JSON.stringify(abonoObj)
  }]);

  avisarReporte(`Abono de $ ${montoAplicado.toFixed(2)} registrado en factura ${item.factura_nro}.`, 'success');
  await cargarCuentasPorCobrar();
}

function exportarCuentasPorCobrarExcel() {
  if (!tenantActual) return;
  if (!cuentasPorCobrarCache || cuentasPorCobrarCache.length === 0) {
    avisarReporte('No hay cuentas por cobrar para exportar.', 'warning');
    return;
  }
  const matriz = [
    ['EMPRESA:', tenantActual.razon_social || '', 'REPORTE:', 'CUENTAS POR COBRAR (CXC)'],
    [],
    ['Factura', 'Fecha Emisión', 'Cliente', 'RIF', 'Total USD', 'Abonado USD', 'Saldo Pendiente USD', 'Días', 'Estado']
  ];
  cuentasPorCobrarCache.forEach(c => {
    matriz.push([
      c.factura_nro,
      formatearFecha8Digitos(c.created_at),
      c.cliente_nombre,
      c.cliente_rif,
      Number(c.totalUsd.toFixed(2)),
      Number(c.abonadoUsd.toFixed(2)),
      Number(c.saldoUsd.toFixed(2)),
      c.diasTranscurridos,
      c.saldoUsd <= 0.01 ? 'SOLVENTE' : (c.vencida ? 'VENCIDA' : 'VIGENTE')
    ]);
  });
  descargarExcelMatriz(matriz, 'Cuentas_Por_Cobrar', 'CxC');
}

