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
  if (tenantActual && String(tenantActual.id) === String(tenantId)) {
    if (tenantActual.imprenta_nombre || tenantActual.imprenta_rif || tenantActual.imprenta_providencia || tenantActual.imprenta_rango) {
      return {
        nombre: tenantActual.imprenta_nombre || 'IMPRENTA DIGITAL AUTORIZADA',
        rif: tenantActual.imprenta_rif || 'J-00000000-0',
        providencia: tenantActual.imprenta_providencia || 'SNAT/2024/000102',
        rango: tenantActual.imprenta_rango || '00-00000001 al 00-00099999'
      };
    }
  }
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
  const montoExentoBs = Number((montoExentoUsd * tasa).toFixed(2));
  const ivaBsFinal = Number((doc.iva_bs ?? (ivaTotalUsd * tasa)).toFixed(2));
  const baseGravadaBsFinal = Number((baseGravadaTotalUsd * tasa).toFixed(2));
  const igtfBs = Number(Number(doc.igtf_bs || 0).toFixed(2));
  const baseIgtfBs = igtfBs > 0 ? Number((igtfBs / 0.03).toFixed(2)) : 0;
  const totalBsCalculado = Number((baseGravadaBsFinal + montoExentoBs + ivaBsFinal + igtfBs).toFixed(2));
  const totalBs = Number((doc.total_bs ?? totalBsCalculado).toFixed(2));
  const subtotalGeneralBs = Number((totalBs - igtfBs).toFixed(2));

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
  if (typeof sincronizarMetaContableNube === 'function') {
    await sincronizarMetaContableNube(tenantId, 'productos');
  }
  const [resSuc, resAlm, resProd] = await Promise.all([
    supabaseClient.from('sucursales').select('*').eq('tenant_id', tenantId).order('nombre', { ascending: true }),
    supabaseClient.from('almacenes').select('*, sucursales(nombre)').eq('tenant_id', tenantId).order('nombre', { ascending: true }),
    supabaseClient.from('productos').select('*, tipos_iva(nombre, porcentaje)').eq('tenant_id', tenantId).order('descripcion', { ascending: true })
  ]);

  notaSucursalesCache = resSuc.data || [];
  notaAlmacenesCache = resAlm.data || [];
  notaProductosCatalogoCache = (resProd.data || []).map(p =>
    typeof obtenerMetaContableRegistro === 'function' ? obtenerMetaContableRegistro(tenantId, 'productos', p) : p
  );

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

function procesarCodigoBarrasNotaNd(rawInput) {
  const inputEl = document.getElementById('notaNdBarcodeInput');
  const valor = String(rawInput !== undefined ? rawInput : (inputEl?.value || '')).trim();
  if (!valor) return false;

  const { producto } = typeof buscarProductoPorCodigoEscaneado === 'function'
    ? buscarProductoPorCodigoEscaneado(notaProductosCatalogoCache, valor)
    : { producto: null };

  if (!producto) {
    if (typeof reproducirBeepEscaner === 'function') reproducirBeepEscaner('error');
    avisarReporte(`Código "${valor}" no encontrado en el catálogo de materiales.`, 'warning');
    if (inputEl) inputEl.select();
    return false;
  }

  const sel = document.getElementById('notaNdExtraProdSelect');
  if (sel) sel.value = String(producto.id);
  agregarProductoExtraNd();
  if (typeof reproducirBeepEscaner === 'function') reproducirBeepEscaner('ok');
  if (inputEl) {
    inputEl.value = '';
    inputEl.focus();
  }
  return true;
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

    const payloadNotaBase = {
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
    };

    const payloadNotaContable = {
      tipo_documento: tipoNota === 'NOTA CREDITO' ? 'NOTA_CREDITO' : 'NOTA_DEBITO',
      modalidad_nota: modalidad,
      documento_afectado_nro: notaFacturaSeleccionada.factura_nro,
      sucursal_id: sucId || null,
      almacen_id: almId || null,
      centro_costo: metaFac?.centroCosto || null,
      moneda: monedaFac,
      condicion_pago: metaFac?.condicionPago || 'CONTADO',
      fecha_emision: fechaEmision,
      fecha_vencimiento: fechaEmision,
      exento_bs: Number(calc.exentoBs.toFixed(2)),
      base_imponible_bs: Number(calc.baseGravadaBs.toFixed(2)),
      base_igtf_bs: 0,
      periodo_contable: fechaEmision.slice(0, 7)
    };

    let notaDoc = null;
    if (typeof guardarRegistroConCompatibilidadContable === 'function') {
      const resNota = await guardarRegistroConCompatibilidadContable('invoices', null, tenantId, payloadNotaBase, payloadNotaContable);
      if (!resNota.ok) {
        avisarReporte('Error al emitir nota fiscal: ' + resNota.message, 'error', 9000);
        return;
      }
      notaDoc = resNota.data;
    } else {
      const { data: invData, error: errNota } = await supabaseClient.from('invoices').insert([payloadNotaBase]).select();
      if (errNota || !invData || invData.length === 0) {
        avisarReporte('Error al emitir nota fiscal: ' + (errNota?.message || 'Error en servidor'), 'error', 9000);
        return;
      }
      notaDoc = invData[0];
    }

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

    if (typeof registrarAsientoAutomaticoNota === 'function') {
      await registrarAsientoAutomaticoNota(notaDoc, tipoNota, modalidad, itemsAProcesar, metaNotaCompleta);
    }

    avisarReporte(
      `¡${tipoNota === 'NOTA CREDITO' ? 'Nota de Crédito' : 'Nota de Débito'} ${nroNota} (${modalidad === 'DEVOLUCION' ? 'con impacto en Kardex' : 'Financiera'}) emitida y contabilizada con éxito!`,
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

let ultimoReporteZCache = null;

async function generarReporteZ() {
  if (!tenantActual) return;
  await sincronizarMetasNotasNube(tenantActual.id);
  const fDesde = document.getElementById('filtroFechaDesde')?.value || '';
  const fHasta = document.getElementById('filtroFechaHasta')?.value || '';

  const { data } = await supabaseClient.from('invoices').select('*').eq('tenant_id', tenantActual.id).order('created_at', { ascending: true });
  const filtradas = (data || []).filter(f => {
    const meta = obtenerMetaFacturaLocal(tenantActual.id, f);
    const fRaw = f.fecha_emision || meta?.fechaEmision || (f.created_at ? String(f.created_at).slice(0, 10) : '');
    const fIso = String(fRaw).slice(0, 10);
    if (fDesde && fIso && fIso < fDesde) return false;
    if (fHasta && fIso && fIso > fHasta) return false;
    return true;
  });

  let totalBs = 0;
  let totalUsd = 0;
  let baseBs = 0;
  let ivaBs = 0;
  let igtfBs = 0;
  let cantFacturas = 0;
  let cantNc = 0;
  let cantNd = 0;
  let cantAnuladas = 0;
  const porCanal = {};

  filtradas.forEach(f => {
    const estUpper = String(f.estado || 'EMITIDA').toUpperCase();
    if (estUpper === 'ANULADA') {
      cantAnuladas++;
      return;
    }
    const numUpper = String(f.factura_nro || '').toUpperCase();
    const esNc = numUpper.startsWith('NC') || numUpper.startsWith('REV-') || estUpper === 'REVERSO';
    const signo = esNc ? -1 : 1;

    if (numUpper.startsWith('NC')) cantNc++;
    else if (numUpper.startsWith('ND')) cantNd++;
    else if (!numUpper.startsWith('REV-')) cantFacturas++;

    const tasa = Math.max(0.0001, Number(f.tasa_bcv || 1));
    const valBs = Math.abs(Number(f.total_bs || 0));
    const valUsd = valBs / tasa;

    totalBs += signo * valBs;
    totalUsd += signo * valUsd;
    baseBs += signo * Math.abs(Number(f.subtotal_bs || 0));
    ivaBs += signo * Math.abs(Number(f.iva_bs || 0));
    igtfBs += signo * Math.abs(Number(f.igtf_bs || 0));

    const meta = obtenerMetaFacturaLocal(tenantActual.id, f);
    const pagos = Array.isArray(f.pago_mixto_json) && f.pago_mixto_json.length > 0
      ? f.pago_mixto_json
      : (Array.isArray(meta?.pagoMixto) && meta.pagoMixto.length > 0 ? meta.pagoMixto : null);

    if (pagos) {
      pagos.forEach(p => {
        const ch = String(p.metodo || 'OTROS').toUpperCase();
        if (!porCanal[ch]) porCanal[ch] = { usd: 0, bs: 0, count: 0 };
        porCanal[ch].usd += signo * Number(p.montoUsd || 0);
        porCanal[ch].bs += signo * Number(p.montoBs || 0);
        porCanal[ch].count += 1;
      });
    } else {
      const ch = String(f.metodo_pago || 'EFECTIVO').split('|')[0].trim().toUpperCase();
      if (!porCanal[ch]) porCanal[ch] = { usd: 0, bs: 0, count: 0 };
      porCanal[ch].usd += signo * valUsd;
      porCanal[ch].bs += signo * valBs;
      porCanal[ch].count += 1;
    }
  });

  ultimoReporteZCache = {
    fDesde, fHasta, filtradas, totalBs, totalUsd, baseBs, ivaBs, igtfBs,
    cantFacturas, cantNc, cantNd, cantAnuladas, porCanal
  };

  const elTotFac = document.getElementById('zTotalFacturas');
  const elTotGav = document.getElementById('totalGavetaEfectivo');
  const elDetalle = document.getElementById('zDesgloseCanales');
  if (elTotFac) elTotFac.innerText = `${cantFacturas} Fac · ${cantNc} NC · ${cantNd} ND${cantAnuladas > 0 ? ` (${cantAnuladas} Anul.)` : ''}`;
  if (elTotGav) elTotGav.innerText = `Bs. ${totalBs.toFixed(2)} | $ ${totalUsd.toFixed(2)}`;
  if (elDetalle) {
    const entries = Object.entries(porCanal);
    elDetalle.innerHTML = entries.length === 0
      ? `<p class="text-xs text-slate-500">Sin operaciones en este rango.</p>`
      : entries.map(([ch, v]) => `
          <div class="flex items-center justify-between text-xs py-1.5 border-b border-slate-800/60">
            <span class="text-slate-300 font-semibold">${esc(ch)} <span class="text-slate-500 font-normal">(${v.count})</span></span>
            <span class="font-mono text-emerald-400 font-bold">$ ${v.usd.toFixed(2)} <span class="text-slate-400 font-normal">/ Bs. ${v.bs.toFixed(2)}</span></span>
          </div>
        `).join('');
  }
}

function imprimirReporteZFiscalPdf() {
  if (!ultimoReporteZCache) {
    avisarReporte('Genera primero el Reporte Z antes de imprimir.', 'warning');
    return;
  }
  if (!window.jspdf || !window.jspdf.jsPDF) {
    avisarReporte('jsPDF no disponible.', 'error');
    return;
  }
  const z = ultimoReporteZCache;
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: [80, 190] });
  let y = 8;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9.5);
  pdf.text(String(tenantActual?.razon_social || 'EMPRESA').toUpperCase(), 40, y, { align: 'center', maxWidth: 72 });
  y += 5;
  pdf.setFontSize(7.5);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`RIF: ${tenantActual?.rif || ''}`, 40, y, { align: 'center' });
  y += 4;
  pdf.line(4, y, 76, y);
  y += 4.5;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.text('REPORTE Z FISCAL CONSOLIDADO', 40, y, { align: 'center' });
  y += 4.5;
  pdf.setFontSize(7.5);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`Desde: ${z.fDesde || 'Inicio'} | Hasta: ${z.fHasta || 'Hoy'}`, 4, y); y += 4;
  pdf.text(`Facturas: ${z.cantFacturas} | NC: ${z.cantNc} | ND: ${z.cantNd} | Anul: ${z.cantAnuladas}`, 4, y); y += 4;
  pdf.line(4, y, 76, y); y += 4;
  pdf.text(`Base + Exento:`, 4, y); pdf.text(`Bs. ${z.baseBs.toFixed(2)}`, 76, y, { align: 'right' }); y += 3.8;
  pdf.text(`IVA Cobrado:`, 4, y); pdf.text(`Bs. ${z.ivaBs.toFixed(2)}`, 76, y, { align: 'right' }); y += 3.8;
  pdf.text(`IGTF (3%):`, 4, y); pdf.text(`Bs. ${z.igtfBs.toFixed(2)}`, 76, y, { align: 'right' }); y += 4;
  pdf.setFont('helvetica', 'bold');
  pdf.text(`VENTA NETA Bs.:`, 4, y); pdf.text(`Bs. ${z.totalBs.toFixed(2)}`, 76, y, { align: 'right' }); y += 4;
  pdf.text(`REF. DIVISAS ($):`, 4, y); pdf.text(`$ ${z.totalUsd.toFixed(2)}`, 76, y, { align: 'right' }); y += 5;
  pdf.line(4, y, 76, y); y += 4;
  pdf.text('DESGLOSE POR VIA DE PAGO:', 4, y); y += 4;
  pdf.setFont('helvetica', 'normal');
  Object.entries(z.porCanal).forEach(([ch, v]) => {
    pdf.text(`${ch.slice(0, 18)} (${v.count})`, 4, y);
    pdf.text(`$ ${v.usd.toFixed(2)}`, 76, y, { align: 'right' });
    y += 3.6;
  });

  const fileName = `Reporte_Z_${z.fDesde || 'Todo'}_${z.fHasta || 'Hoy'}.pdf`;
  if (typeof abrirVisorImpresionPdf === 'function') abrirVisorImpresionPdf(pdf, fileName, 'Reporte Z Fiscal');
  else pdf.save(fileName);
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

function escapeXmlStr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

async function exportarResumenFiscalXml() {
  if (!tenantActual) return;
  if (!ultimoReporteZCache) {
    await generarReporteZ();
  }
  const z = ultimoReporteZCache;
  if (!z) {
    avisarReporte('No hay datos fiscales en el período para exportar XML.', 'warning');
    return;
  }

  const fDesde = z.fDesde || new Date().toISOString().slice(0, 10);
  const fHasta = z.fHasta || fDesde;
  const periodo = fDesde.slice(0, 7).replace('-', '');
  const rifAgente = String(tenantActual.rif || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');

  const docsXml = (z.filtradas || []).map(doc => {
    const nro = String(doc.factura_nro || '');
    const tipo = /^NC/i.test(nro) ? '02' : (/^ND/i.test(nro) ? '03' : (/^REV/i.test(nro) ? '04' : '01'));
    const fDoc = String(doc.fecha_emision || doc.created_at || '').slice(0, 10);
    return [
      '    <Documento>',
      `      <TipoDocumento>${tipo}</TipoDocumento>`,
      `      <NumeroDocumento>${escapeXmlStr(nro)}</NumeroDocumento>`,
      `      <NumeroControl>${escapeXmlStr(doc.nro_control || '00-00000000')}</NumeroControl>`,
      `      <FechaEmision>${escapeXmlStr(fDoc)}</FechaEmision>`,
      `      <ClienteRif>${escapeXmlStr(doc.cliente_rif || 'V-0')}</ClienteRif>`,
      `      <ClienteNombre>${escapeXmlStr(doc.cliente_nombre || 'CONSUMIDOR FINAL')}</ClienteNombre>`,
      `      <TasaBCV>${Number(doc.tasa_bcv || 1).toFixed(4)}</TasaBCV>`,
      `      <BaseImponibleBs>${Number(doc.subtotal_bs || 0).toFixed(2)}</BaseImponibleBs>`,
      `      <IvaBs>${Number(doc.iva_bs || 0).toFixed(2)}</IvaBs>`,
      `      <IgtfBs>${Number(doc.igtf_bs || 0).toFixed(2)}</IgtfBs>`,
      `      <TotalBs>${Number(doc.total_bs || 0).toFixed(2)}</TotalBs>`,
      `      <Estado>${escapeXmlStr(doc.estado || 'EMITIDA')}</Estado>`,
      '    </Documento>'
    ].join('\n');
  }).join('\n');

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<DeclaracionFiscalIVA RifContribuyente="${escapeXmlStr(rifAgente)}" PeriodoImpositivo="${escapeXmlStr(periodo)}">`,
    '  <Contribuyente>',
    `    <RazonSocial>${escapeXmlStr(tenantActual.razon_social || '')}</RazonSocial>`,
    `    <RIF>${escapeXmlStr(rifAgente)}</RIF>`,
    `    <Desde>${escapeXmlStr(fDesde)}</Desde>`,
    `    <Hasta>${escapeXmlStr(fHasta)}</Hasta>`,
    '  </Contribuyente>',
    '  <ResumenPeriodo>',
    `    <CantidadFacturas>${z.cantFacturas}</CantidadFacturas>`,
    `    <CantidadNotasCredito>${z.cantNc}</CantidadNotasCredito>`,
    `    <CantidadNotasDebito>${z.cantNd}</CantidadNotasDebito>`,
    `    <CantidadAnuladas>${z.cantAnuladas}</CantidadAnuladas>`,
    `    <TotalBaseGravadaYExentaBs>${z.baseBs.toFixed(2)}</TotalBaseGravadaYExentaBs>`,
    `    <TotalDebitoFiscalIvaBs>${z.ivaBs.toFixed(2)}</TotalDebitoFiscalIvaBs>`,
    `    <TotalIgtfPercibidoBs>${z.igtfBs.toFixed(2)}</TotalIgtfPercibidoBs>`,
    `    <TotalFacturacionNetaBs>${z.totalBs.toFixed(2)}</TotalFacturacionNetaBs>`,
    `    <ReferenciaDivisasUsd>${z.totalUsd.toFixed(2)}</ReferenciaDivisasUsd>`,
    '  </ResumenPeriodo>',
    '  <Documentos>',
    docsXml,
    '  </Documentos>',
    '</DeclaracionFiscalIVA>'
  ].join('\n');

  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Declaracion_IVA_${rifAgente || 'SENIAT'}_${periodo}.xml`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  avisarReporte(`Archivo XML fiscal SENIAT (${periodo}) descargado.`, 'success');
}

let retencionesProveedoresCache = [];
let retencionesCache = [];

async function cargarProveedoresSelectRetencion() {
  if (!tenantActual || !supabaseClient) return;
  const sel = document.getElementById('retProveedorSelect');
  if (!sel) return;
  try {
    const { data } = await supabaseClient
      .from('proveedores')
      .select('id, rif, razon_social, porcentaje_retencion_iva')
      .eq('tenant_id', tenantActual.id)
      .order('razon_social', { ascending: true });
    retencionesProveedoresCache = data || [];
    const prev = sel.value;
    sel.innerHTML = '<option value="">-- Seleccionar Proveedor (Opcional) --</option>';
    retencionesProveedoresCache.forEach(p => {
      sel.innerHTML += `<option value="${esc(p.id)}">${esc(p.razon_social)} (${esc(p.rif)})</option>`;
    });
    if (prev) sel.value = prev;
  } catch (e) {}
}

function onSeleccionarProveedorRetencion() {
  const id = document.getElementById('retProveedorSelect')?.value || '';
  const prov = retencionesProveedoresCache.find(p => String(p.id) === String(id));
  if (!prov) return;
  const inpRif = document.getElementById('retProveedorRif');
  const selPct = document.getElementById('retPorcentaje');
  if (inpRif) inpRif.value = prov.rif || '';
  if (selPct && Number(prov.porcentaje_retencion_iva) > 0) {
    selPct.value = String(prov.porcentaje_retencion_iva);
  }
}

async function generarComprobanteRetencion() {
  const facRef = (document.getElementById('retFacturaRef')?.value || 'FAC-0001').trim().toUpperCase();
  const nroControl = (document.getElementById('retNroControl')?.value || '00-00000001').trim().toUpperCase();
  const provId = document.getElementById('retProveedorSelect')?.value || '';
  const provObj = retencionesProveedoresCache.find(p => String(p.id) === String(provId));
  const provRif = (document.getElementById('retProveedorRif')?.value || provObj?.rif || 'J-00000000-0').trim().toUpperCase();
  const provNombre = provObj?.razon_social || 'PROVEEDOR CONTRIBUYENTE';
  const fechaFactura = document.getElementById('retFechaFactura')?.value || new Date().toISOString().slice(0, 10);
  const baseUsd = parseFloat(document.getElementById('retBaseUsd')?.value) || 0;
  const exentoUsd = Math.max(0, parseFloat(document.getElementById('retMontoExentoUsd')?.value) || 0);
  const porcentaje = parseFloat(document.getElementById('retPorcentaje')?.value) || 100;
  if (baseUsd <= 0) { avisarReporte('Ingresa una Base Imponible mayor a 0.', 'warning'); return; }

  const tasa = parseFloat(document.getElementById('tasaBcv')?.value) || 1;
  const baseBs = Number((baseUsd * tasa).toFixed(2));
  const exentoBs = Number((exentoUsd * tasa).toFixed(2));
  const ivaBs = Number((baseBs * 0.16).toFixed(2));
  const ivaRetenidoBs = Number((ivaBs * (porcentaje / 100)).toFixed(2));
  const hoyIso = new Date().toISOString().slice(0, 10);
  const periodoYm = hoyIso.slice(0, 7).replace('-', '');
  const seq = String(Math.floor(10000000 + Math.random() * 89999999));
  const nroComp = `${periodoYm}${seq}`;

  const payloadRetBase = {
    tenant_id: tenantActual.id,
    nro_comprobante: nroComp,
    factura_ref: facRef,
    base_imponible_bs: baseBs,
    iva_bs: ivaBs,
    porcentaje_retencion: porcentaje,
    iva_retenido_bs: ivaRetenidoBs
  };
  const payloadRetContable = {
    tipo_retencion: 'COMPRA',
    periodo_impositivo: hoyIso.slice(0, 7),
    fecha_comprobante: hoyIso,
    proveedor_rif: provRif,
    proveedor_nombre: provNombre,
    nro_control_factura: nroControl,
    monto_exento_bs: exentoBs
  };

  if (typeof guardarRegistroConCompatibilidadContable === 'function') {
    let resRet = await guardarRegistroConCompatibilidadContable('retenciones_iva', null, tenantActual.id, payloadRetBase, payloadRetContable);
    if (!resRet.ok) {
      avisarReporte(resRet.message, 'error', 9000);
      return;
    }
  } else {
    const { error } = await supabaseClient.from('retenciones_iva').insert([payloadRetBase]).select();
    if (error) {
      const code = String(error.code || '');
      if (code === '42501' || /row-level security/i.test(error.message || '')) {
        avisarReporte('Permiso denegado por Supabase (RLS 42501) en "retenciones_iva". Habilita la política RLS en Supabase para guardar retenciones.', 'error', 9000);
      } else {
        avisarReporte('Error al generar retención: ' + error.message, 'error', 8000);
      }
      return;
    }
  }

  // Guardar metadata extendida local por si aún no se corre SQL v120
  try {
    const key = `mfd_ret_meta_${tenantActual.id}`;
    const map = JSON.parse(localStorage.getItem(key) || '{}');
    map[nroComp] = {
      proveedor_rif: provRif,
      proveedor_nombre: provNombre,
      nro_control_factura: nroControl,
      monto_exento_bs: exentoBs,
      fecha_factura: fechaFactura
    };
    localStorage.setItem(key, JSON.stringify(map));
  } catch (e) {}

  if (typeof registrarAsientoAutomaticoRetencion === 'function') {
    await registrarAsientoAutomaticoRetencion({
      nroComprobante: nroComp,
      facturaRef: facRef,
      ivaRetenidoBs,
      tasaBcv: tasa,
      fecha: hoyIso
    });
  }

  avisarReporte(`¡Comprobante de Retención de IVA ${nroComp} generado y contabilizado (${porcentaje}%)!`, 'success');
  cargarRetenciones();
}

async function cargarRetenciones() {
  if (!tenantActual) return;
  await cargarProveedoresSelectRetencion();
  const { data, error } = await supabaseClient.from('retenciones_iva').select('*').eq('tenant_id', tenantActual.id).order('created_at', { ascending: false });
  const tbody = document.getElementById('tablaRetenciones');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (error) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-rose-400">Error al consultar retenciones: ${esc(error.message)}</td></tr>`;
    return;
  }

  let metaLocal = {};
  try { metaLocal = JSON.parse(localStorage.getItem(`mfd_ret_meta_${tenantActual.id}`) || '{}'); } catch (e) {}
  retencionesCache = (data || []).map(r => ({
    ...r,
    ...(metaLocal[r.nro_comprobante] || {}),
    proveedor_rif: r.proveedor_rif || metaLocal[r.nro_comprobante]?.proveedor_rif || 'J-00000000-0',
    proveedor_nombre: r.proveedor_nombre || metaLocal[r.nro_comprobante]?.proveedor_nombre || 'PROVEEDOR',
    nro_control_factura: r.nro_control_factura || metaLocal[r.nro_comprobante]?.nro_control_factura || '00-00000000',
    monto_exento_bs: Number(r.monto_exento_bs ?? metaLocal[r.nro_comprobante]?.monto_exento_bs ?? 0)
  }));

  if (!retencionesCache.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-500">Sin comprobantes de retención registrados.</td></tr>`;
    return;
  }

  retencionesCache.forEach(r => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/40">
        <td class="p-3 font-mono text-emerald-400 font-bold">${esc(r.nro_comprobante)}<div class="text-[10px] text-slate-400 font-normal">${esc(r.proveedor_rif)} · ${esc(r.proveedor_nombre)}</div></td>
        <td class="p-3 font-mono">${esc(r.factura_ref)}<div class="text-[10px] text-slate-500">Ctrl: ${esc(r.nro_control_factura)}</div></td>
        <td class="p-3 font-mono">Bs. ${Number(r.base_imponible_bs || 0).toFixed(2)}</td>
        <td class="p-3 font-mono">Bs. ${Number(r.iva_bs || 0).toFixed(2)}</td>
        <td class="p-3 font-mono text-emerald-300 font-bold">Bs. ${Number(r.iva_retenido_bs || 0).toFixed(2)} (${r.porcentaje_retencion}%)</td>
        <td class="p-3 text-center whitespace-nowrap space-x-1.5">
          <button type="button" onclick='imprimirComprobanteRetencionPdf("${esc(r.id)}")' class="bg-slate-800 hover:bg-slate-700 text-sky-300 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer">Comprobante PDF</button>
        </td>
      </tr>
    `;
  });
}

function construirSeniatTxtRetenciones(registros, agenteRif = '') {
  const rifAg = String(agenteRif || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (registros || []).map(r => {
    const fechaIso = String(r.fecha_comprobante || r.created_at || new Date().toISOString()).slice(0, 10);
    const periodo = String(r.periodo_impositivo || fechaIso.slice(0, 7)).replace('-', '');
    const rifSujeto = String(r.proveedor_rif || 'J000000000').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const base = Number(r.base_imponible_bs || 0);
    const iva = Number(r.iva_bs || 0);
    const exento = Number(r.monto_exento_bs || 0);
    const totalDoc = base + iva + exento;
    const retBs = Number(r.iva_retenido_bs || 0);
    const nroComp = String(r.nro_comprobante || '').replace(/[^0-9]/g, '').padStart(14, '0').slice(-14);
    const fac = String(r.factura_ref || '0').replace(/\s+/g, '');
    const ctrl = String(r.nro_control_factura || '0').replace(/\s+/g, '');

    return [
      rifAg,
      periodo,
      fechaIso,
      'C',
      '01',
      rifSujeto,
      fac,
      ctrl,
      totalDoc.toFixed(2),
      base.toFixed(2),
      retBs.toFixed(2),
      '0',
      nroComp,
      exento.toFixed(2),
      '16.00',
      '0'
    ].join('\t');
  }).join('\n');
}

function exportarRetencionesSeniatTxt() {
  if (!tenantActual || !retencionesCache.length) {
    avisarReporte('No hay comprobantes de retención para generar el archivo TXT SENIAT.', 'warning');
    return;
  }
  const contenido = construirSeniatTxtRetenciones(retencionesCache, tenantActual.rif || '');
  const periodo = new Date().toISOString().slice(0, 7).replace('-', '');
  const rifClean = String(tenantActual.rif || 'AGENTE').replace(/[^A-Za-z0-9]/g, '');
  const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Retenciones_IVA_SENIAT_${rifClean}_${periodo}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  avisarReporte(`Archivo TXT SENIAT generado con ${retencionesCache.length} comprobante(s) listos para declarar en portal.`, 'success');
}

function imprimirComprobanteRetencionPdf(retId) {
  const r = retencionesCache.find(x => String(x.id) === String(retId));
  if (!r || !window.jspdf?.jsPDF) {
    avisarReporte('No se pudo generar el comprobante PDF de retención.', 'warning');
    return;
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'landscape' });
  const pageW = pdf.internal.pageSize.getWidth();
  const margin = 14;
  let y = 16;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.text('COMPROBANTE DE RETENCIÓN DE IMPUESTO AL VALOR AGREGADO (IVA)', pageW / 2, y, { align: 'center' });
  y += 5;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.text('Providencia Administrativa N° SNAT/2015/0049 (Art. 16 - Ley IVA Art. 11)', pageW / 2, y, { align: 'center' });
  y += 8;

  pdf.setDrawColor(15, 23, 42);
  pdf.rect(margin, y, 165, 24);
  pdf.rect(margin + 170, y, pageW - margin * 2 - 170, 24);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.text(`AGENTE DE RETENCIÓN: ${String(tenantActual?.razon_social || '').toUpperCase()}`, margin + 3, y + 5.5);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`RIF Agente: ${tenantActual?.rif || ''}`, margin + 3, y + 11);
  pdf.text(`Domicilio: ${String(tenantActual?.direccion || 'VENEZUELA').slice(0, 70)}`, margin + 3, y + 16.5);

  pdf.setFont('helvetica', 'bold');
  pdf.text(`N° COMPROBANTE: ${r.nro_comprobante}`, margin + 173, y + 6);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`Fecha Emisión: ${String(r.fecha_comprobante || r.created_at || '').slice(0, 10)}`, margin + 173, y + 12);
  pdf.text(`Período Fiscal: ${String(r.periodo_impositivo || String(r.created_at || '').slice(0, 7))}`, margin + 173, y + 18);
  y += 29;

  pdf.rect(margin, y, pageW - margin * 2, 16);
  pdf.setFont('helvetica', 'bold');
  pdf.text(`SUJETO RETENIDO (PROVEEDOR): ${r.proveedor_nombre}`, margin + 3, y + 6);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`RIF Proveedor: ${r.proveedor_rif}`, margin + 3, y + 12);
  y += 22;

  pdf.setFillColor(15, 23, 42);
  pdf.rect(margin, y, pageW - margin * 2, 8, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.5);
  pdf.text('N° Factura', margin + 3, y + 5.2);
  pdf.text('N° Control', margin + 40, y + 5.2);
  pdf.text('Total Doc (Bs.)', margin + 100, y + 5.2, { align: 'right' });
  pdf.text('Exento (Bs.)', margin + 132, y + 5.2, { align: 'right' });
  pdf.text('Base Imp. (Bs.)', margin + 168, y + 5.2, { align: 'right' });
  pdf.text('IVA 16% (Bs.)', margin + 202, y + 5.2, { align: 'right' });
  pdf.text('% Ret.', margin + 220, y + 5.2, { align: 'right' });
  pdf.text('IVA Retenido (Bs.)', pageW - margin - 3, y + 5.2, { align: 'right' });
  y += 8;

  const base = Number(r.base_imponible_bs || 0);
  const iva = Number(r.iva_bs || 0);
  const exento = Number(r.monto_exento_bs || 0);
  const totDoc = base + iva + exento;
  const retBs = Number(r.iva_retenido_bs || 0);

  pdf.setTextColor(15, 23, 42);
  pdf.setFont('helvetica', 'normal');
  pdf.rect(margin, y, pageW - margin * 2, 9);
  pdf.text(String(r.factura_ref || ''), margin + 3, y + 6);
  pdf.text(String(r.nro_control_factura || 'N/A'), margin + 40, y + 6);
  pdf.text(totDoc.toFixed(2), margin + 100, y + 6, { align: 'right' });
  pdf.text(exento.toFixed(2), margin + 132, y + 6, { align: 'right' });
  pdf.text(base.toFixed(2), margin + 168, y + 6, { align: 'right' });
  pdf.text(iva.toFixed(2), margin + 202, y + 6, { align: 'right' });
  pdf.text(`${r.porcentaje_retencion}%`, margin + 220, y + 6, { align: 'right' });
  pdf.setFont('helvetica', 'bold');
  pdf.text(retBs.toFixed(2), pageW - margin - 3, y + 6, { align: 'right' });
  y += 28;

  pdf.setFont('helvetica', 'normal');
  pdf.line(margin + 15, y, margin + 85, y);
  pdf.line(pageW - margin - 85, y, pageW - margin - 15, y);
  pdf.text('Firma y Sello Agente de Retención', margin + 50, y + 5, { align: 'center' });
  pdf.text('Recibido Conforme (Proveedor)', pageW - margin - 50, y + 5, { align: 'center' });

  const fname = `Retencion_IVA_${r.nro_comprobante}.pdf`;
  if (typeof abrirVisorImpresionPdf === 'function') abrirVisorImpresionPdf(pdf, fname, `Comprobante Retención ${r.nro_comprobante}`);
  else pdf.save(fname);
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
// POS-011: ENVIAR COMPROBANTE POR WHATSAPP (+PDF) Y CORREO ELECTRÓNICO (PDF)
// ==========================================

function enviarWhatsApp(descargarPdf = false) {
  const d = comprobanteRenderCache;
  if (!d) {
    avisarReporte('Abre primero un comprobante fiscal para enviarlo por WhatsApp.', 'warning');
    return;
  }

  if (descargarPdf) {
    descargarComprobantePdf();
  }

  const totalUsd = Number(d.tasa) > 0 ? Number(d.totalBs || 0) / Number(d.tasa) : 0;
  const msg = [
    `*${String(d.emisorNombre || 'MiFacturaDigital').toUpperCase()}* (${d.emisorRif || ''})`,
    `${d.tituloDoc || 'FACTURA'}: *${d.numDoc || ''}*`,
    `Nro. Control: ${d.nroControl || 'N/A'}`,
    `Fecha: ${d.fechaFormateada || ''}`,
    `Cliente: ${d.cliNombre || ''} (${d.cliRif || ''})`,
    `Exento: Bs. ${Number(d.montoExentoBs || 0).toFixed(2)}`,
    `IGTF 3%: Bs. ${Number(d.igtfBs || 0).toFixed(2)}`,
    `*TOTAL: Bs. ${Number(d.totalBs || 0).toFixed(2)}* ($ ${totalUsd.toFixed(2)} @ Tasa BCV ${Number(d.tasa || 1).toFixed(2)})`
  ].join('\n');

  let tel = String(d.cliTel || document.getElementById('clienteTelefono')?.value || '').replace(/\D/g, '');
  if (tel.startsWith('0')) tel = `58${tel.slice(1)}`;
  const url = tel.length >= 10
    ? `https://api.whatsapp.com/send?phone=${encodeURIComponent(tel)}&text=${encodeURIComponent(msg)}`
    : `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;

  try {
    navigator.clipboard?.writeText(msg);
  } catch (e) {}

  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
  avisarReporte(
    descargarPdf
      ? `PDF ${d.numDoc}.pdf descargado y WhatsApp abierto. Adjunta el PDF recién descargado en el chat.`
      : `Resumen fiscal ${d.numDoc} preparado para WhatsApp (copiado también al portapapeles).`,
    'success',
    6500
  );
}

async function abrirModalEnviarCorreo() {
  const d = comprobanteRenderCache;
  if (!d) {
    avisarReporte('Abre primero un comprobante fiscal para enviarlo por correo.', 'warning');
    return;
  }

  const modal = document.getElementById('modalEnviarCorreoFactura');
  if (!modal) return;

  let emailCli = '';
  if (typeof clientesCache !== 'undefined' && Array.isArray(clientesCache)) {
    const cli = clientesCache.find(c => String(c.rif || '').toUpperCase() === String(d.cliRif || '').toUpperCase());
    if (cli?.email) emailCli = cli.email;
  }

  const totalUsd = Number(d.tasa) > 0 ? Number(d.totalBs || 0) / Number(d.tasa) : 0;
  document.getElementById('correoDestinoInput').value = emailCli;
  document.getElementById('correoAsuntoInput').value = `${d.tituloDoc || 'FACTURA'} ${d.numDoc} - ${d.emisorNombre}`;
  document.getElementById('correoMensajeInput').value = [
    `Estimado(a) ${d.cliNombre || 'Cliente'},`,
    '',
    `Adjuntamos su comprobante fiscal digital emitido por ${d.emisorNombre} (${d.emisorRif}):`,
    `• Documento: ${d.tituloDoc || 'FACTURA'} ${d.numDoc}`,
    `• Nro. Control: ${d.nroControl || 'N/A'}`,
    `• Fecha: ${d.fechaFormateada || ''}`,
    `• Total: Bs. ${Number(d.totalBs || 0).toFixed(2)} (Ref. $ ${totalUsd.toFixed(2)})`,
    '',
    'Gracias por su preferencia.'
  ].join('\n');

  const badge = document.getElementById('correoServidorEstadoBadge');
  if (badge) {
    badge.textContent = 'Verificando servidor de correo...';
    badge.className = 'text-[11px] font-mono px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300';
    try {
      const r = await fetch('/api/email/estado');
      const j = await r.json();
      if (j?.configurado) {
        badge.textContent = `Envío Directo con PDF Adjunto (${String(j.proveedor || 'SMTP').toUpperCase()})`;
        badge.className = 'text-[11px] font-mono px-2.5 py-1 rounded-lg bg-emerald-950 text-emerald-300 border border-emerald-500/40';
      } else {
        badge.textContent = 'Modo Cliente Local: descarga PDF + abre tu correo (configura RESEND_API_KEY o BREVO_API_KEY en .env para envío automático)';
        badge.className = 'text-[11px] font-mono px-2.5 py-1 rounded-lg bg-amber-950 text-amber-300 border border-amber-500/40';
      }
    } catch (e) {}
  }

  modal.classList.remove('hidden');
}

function cerrarModalEnviarCorreo() {
  document.getElementById('modalEnviarCorreoFactura')?.classList.add('hidden');
}

async function enviarComprobanteCorreoPdf(e) {
  if (e) e.preventDefault();
  const d = comprobanteRenderCache;
  if (!d) return;

  const para = (document.getElementById('correoDestinoInput')?.value || '').trim();
  const asunto = (document.getElementById('correoAsuntoInput')?.value || '').trim();
  const mensajeTexto = (document.getElementById('correoMensajeInput')?.value || '').trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(para)) {
    avisarReporte('Ingresa un correo electrónico destino válido.', 'warning');
    return;
  }

  const prevFmt = formatoComprobanteActual;
  formatoComprobanteActual = 'digital';
  const resPdf = construirComprobanteJsPdf();
  formatoComprobanteActual = prevFmt;

  if (!resPdf || !resPdf.pdf) {
    avisarReporte('No se pudo generar el PDF del comprobante.', 'error');
    return;
  }

  const dataUri = resPdf.pdf.output('datauristring');
  const pdfBase64 = String(dataUri || '').split(',')[1] || '';

  const btn = document.getElementById('btnConfirmarEnvioCorreo');
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }

  try {
    const resp = await fetch('/api/enviar-comprobante-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        para,
        asunto,
        mensajeTexto,
        emisorNombre: d.emisorNombre || tenantActual?.razon_social || 'MiFacturaDigital',
        nombreArchivo: resPdf.fileName || `${d.numDoc}.pdf`,
        pdfBase64
      })
    });
    const json = await resp.json().catch(() => ({}));
    if (resp.ok && json.ok) {
      cerrarModalEnviarCorreo();
      avisarReporte(`Comprobante ${resPdf.fileName} enviado por correo a ${para}.`, 'success', 6500);
      return;
    }

    if (json?.fallbackCliente || resp.status === 503) {
      resPdf.pdf.save(resPdf.fileName || `${d.numDoc}.pdf`);
      const mailto = `mailto:${encodeURIComponent(para)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(mensajeTexto)}`;
      const a = document.createElement('a');
      a.href = mailto;
      document.body.appendChild(a);
      a.click();
      a.remove();
      cerrarModalEnviarCorreo();
      avisarReporte(`PDF ${resPdf.fileName} descargado y cliente de correo abierto hacia ${para}.`, 'info', 7500);
      return;
    }

    avisarReporte(json?.error || 'Error enviando comprobante por correo.', 'error');
  } catch (err) {
    avisarReporte('No se pudo conectar con el servidor de correo.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar Comprobante PDF'; }
  }
}

// ==========================================
// CIE-004: IMPRESIÓN TÉRMICA BLUETOOTH ESC/POS REAL
// ==========================================

async function imprimirBluetoothReal() {
  const d = comprobanteRenderCache;
  if (!d) {
    avisarReporte('Abre primero un comprobante fiscal para enviarlo a impresora Bluetooth.', 'warning');
    return;
  }
  if (!navigator.bluetooth) {
    avisarReporte('Web Bluetooth no está habilitado en este navegador o visor embebido. Usa Chrome/Android en HTTPS o el visor de impresión térmica 80mm.', 'warning', 7000);
    return;
  }

  try {
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [
        '000018f0-0000-1000-8000-00805f9b34fb',
        'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
        '49535343-fe7d-4ae5-8fa9-9fafd205e455'
      ]
    });
    const server = await device.gatt.connect();
    const services = await server.getPrimaryServices();
    let writableChar = null;

    for (const svc of services) {
      const chars = await svc.getCharacteristics();
      writableChar = chars.find(c => c.properties.write || c.properties.writeWithoutResponse) || null;
      if (writableChar) break;
    }

    if (!writableChar) {
      avisarReporte('No se encontró un canal de escritura ESC/POS compatible en el dispositivo Bluetooth.', 'error');
      return;
    }

    const totalUsd = Number(d.tasa) > 0 ? Number(d.totalBs || 0) / Number(d.tasa) : 0;
    const texto = [
      '\x1B@',
      `${String(d.emisorNombre || '').toUpperCase()}\n`,
      `RIF: ${d.emisorRif || ''}\n`,
      `--------------------------------\n`,
      `${d.tituloDoc || 'FACTURA'}: ${d.numDoc || ''}\n`,
      `CTRL: ${d.nroControl || ''} | ${d.fechaMostrar || ''}\n`,
      `CLI: ${d.cliNombre || ''} (${d.cliRif || ''})\n`,
      `--------------------------------\n`,
      ...(d.items || []).map(it => `${Number(it.cant)} x ${String(it.desc).slice(0, 18)}  Bs.${Number(it.totBs).toFixed(2)}\n`),
      `--------------------------------\n`,
      `TOTAL: Bs. ${Number(d.totalBs || 0).toFixed(2)}\n`,
      `REF:   $ ${totalUsd.toFixed(2)}\n\n\n\x1DV\x00`
    ].join('');

    const bytes = new TextEncoder().encode(texto);
    const chunkSize = 20;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      await writableChar.writeValue(bytes.slice(i, i + chunkSize));
    }
    avisarReporte(`Ticket ${d.numDoc} impreso vía Bluetooth ESC/POS en ${device.name || 'Impresora Térmica'}.`, 'success');
  } catch (e) {
    if (e?.name !== 'NotFoundError') {
      avisarReporte(`Error de impresión Bluetooth: ${e?.message || e}`, 'error');
    }
  }
}

