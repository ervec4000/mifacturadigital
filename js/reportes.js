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

async function cargarHistorial() {
  if (!tenantActual) return;
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

    const labelBadge = esAnulada ? 'ANULADA' : doc.tipoDoc;
    const accionesExtra = (!esAnulada && !esReverso && !esNota)
      ? `<button type="button" onclick='editarFacturaPorId("${esc(doc.id)}")' class="text-sky-400 hover:underline font-semibold cursor-pointer">Editar</button>
         <button type="button" onclick='eliminarFacturaPorId("${esc(doc.id)}")' class="text-rose-400 hover:underline font-semibold cursor-pointer">Eliminar</button>`
      : '';

    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/40 ${esAnulada ? 'opacity-65' : ''}">
        <td class="p-3 font-mono font-bold text-white"><span class="px-2 py-0.5 rounded text-[10px] ${badgeColor} mr-1">${esc(labelBadge)}</span> ${esc(doc.numero)}</td>
        <td class="p-3 font-mono">${esc(doc.nro_control || 'N/A')}</td>
        <td class="p-3">${esc(doc.cliente_nombre)}</td>
        <td class="p-3 text-slate-300">${esc(doc.metodo_pago)}</td>
        <td class="p-3 text-slate-400">${formatearFecha8Digitos(doc.created_at)}</td>
        <td class="p-3 font-mono ${Number(doc.total_bs) < 0 ? 'text-amber-400' : 'text-emerald-400'} font-bold">Bs. ${(Number(doc.total_bs) || 0).toFixed(2)}</td>
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

  const notaBox = document.getElementById('ticketReferenciaNotaBox');
  if (notaBox) {
    if (numUpper.startsWith('NC') || numUpper.startsWith('ND') || numUpper.startsWith('REV-')) {
      notaBox.classList.remove('hidden');
      notaBox.innerText = `REFERENCIA FISCAL: ${metodoStr}`;
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
    notaRef: metodoStr,
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
  try {
    window.print();
  } catch (e) {
    console.warn('window.print falló:', e);
  }
  if (window.self !== window.top) {
    avisarReporte('Si el visor embebido bloqueó el diálogo de impresión, pulsa "📥 Descargar PDF" para abrir e imprimir el documento.', 'info', 7000);
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

function descargarComprobantePdf() {
  const d = comprobanteRenderCache;
  if (!d) {
    avisarReporte('Abre primero un comprobante para descargarlo en PDF.', 'warning');
    return;
  }
  if (!window.jspdf || !window.jspdf.jsPDF) {
    avisarReporte('La librería jsPDF no está cargada. Recarga la página e intenta de nuevo.', 'error');
    return;
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

    pdf.save(`${d.numDoc}_Ticket.pdf`);
    avisarReporte(`PDF ${d.numDoc}_Ticket.pdf descargado con éxito.`, 'success');
    return;
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
  const cliBoxH = Math.max(20, 12 + cliDirLines.length * 4 + (d.esNota ? 7 : 0));
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

  if (d.esNota) {
    pdf.setFont('courier', 'bold');
    pdf.setFontSize(7);
    pdf.setTextColor(146, 64, 14);
    pdf.text(`REF. FISCAL: ${d.notaRef}`, margin + 3, y + cliBoxH - 2.5, { maxWidth: contentW - 6 });
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

  pdf.save(`${d.numDoc}.pdf`);
  avisarReporte(`Factura Digital ${d.numDoc}.pdf descargada con éxito.`, 'success');
}

async function cargarFacturasAfectadasSelect() {
  if (!tenantActual) return;
  const { data } = await supabaseClient.from('invoices').select('*').eq('tenant_id', tenantActual.id).order('created_at', { ascending: false });
  const select = document.getElementById('facturaAfectadaSelect');
  if (!select) return;
  select.innerHTML = '';
  if (!data || data.length === 0) { select.innerHTML = '<option value="">Sin facturas emitidas</option>'; return; }
  data.forEach(f => {
    const numUpper = (f.factura_nro || '').toUpperCase();
    const estUpper = (f.estado || '').toUpperCase();
    if (!numUpper.startsWith('NC') && !numUpper.startsWith('ND') && !numUpper.startsWith('REV-') && estUpper !== 'ANULADA' && estUpper !== 'REVERSO') {
      select.innerHTML += `<option value="${esc(f.factura_nro)}">Factura: ${esc(f.factura_nro)} | Ctrl: ${esc(f.nro_control || 'N/A')} | ${esc(f.cliente_nombre)} | Bs. ${Number(f.total_bs || 0).toFixed(2)}</option>`;
    }
  });
}

async function emitirNotaFiscal() {
  const tipoNota = document.getElementById('tipoNotaSelect').value;
  const facturaAfectada = document.getElementById('facturaAfectadaSelect').value;
  const montoUsd = parseFloat(document.getElementById('montoNotaUsd')?.value) || 0;
  const motivo = document.getElementById('motivoNota')?.value.trim() || 'Ajuste fiscal';
  if (!facturaAfectada) { avisarReporte('Seleccione la factura afectada.', 'warning'); return; }
  if (montoUsd <= 0) { avisarReporte('Ingresa el monto base de la nota mayor a 0.', 'warning'); return; }

  const tasa = parseFloat(document.getElementById('tasaBcv').value) || 1;
  const nroNota = (tipoNota === 'NOTA CREDITO' ? 'NC-' : 'ND-') + String(Math.floor(100000 + Math.random() * 900000));
  const nroControl = '00-' + String(Math.floor(10000000 + Math.random() * 89999999));
  const montoBs = montoUsd * tasa;

  const { data: invOriginal } = await supabaseClient.from('invoices').select('*').eq('tenant_id', tenantActual.id).eq('factura_nro', facturaAfectada).maybeSingle();

  const refAfectada = `AFECTA FAC: ${facturaAfectada} | CTRL: ${invOriginal?.nro_control || 'N/A'} | FECHA: ${formatearFecha8Digitos(invOriginal?.created_at)} | MOTIVO: ${motivo}`;

  const { error: errNota } = await supabaseClient.from('invoices').insert([{
    tenant_id: tenantActual.id,
    client_id: invOriginal?.client_id || null,
    factura_nro: nroNota,
    nro_control: nroControl,
    tasa_bcv: tasa,
    monto_usd: montoUsd,
    subtotal_bs: montoBs,
    iva_bs: montoBs * 0.16,
    total_bs: montoBs * 1.16,
    cliente_rif: invOriginal?.cliente_rif || 'V-0',
    cliente_nombre: invOriginal?.cliente_nombre || 'CLIENTE',
    metodo_pago: `${tipoNota} | ${refAfectada}`.slice(0, 50)
  }]).select();
  if (errNota) { avisarReporte('Error al emitir nota fiscal: ' + errNota.message, 'error'); return; }

  avisarReporte(`¡${tipoNota} emitida con éxito (${nroNota}) conforme a Providencia SENIAT!`, 'success');
  cambiarPestana('historial');
}

async function generarReporteZ() {
  if (!tenantActual) return;
  const { data } = await supabaseClient.from('invoices').select('*').eq('tenant_id', tenantActual.id);
  const filtradas = data || [];
  document.getElementById('zTotalFacturas').innerText = filtradas.length;
  let total = 0; filtradas.forEach(f => {
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
  const { data: invoices } = await supabaseClient.from('invoices').select('*, invoice_items(*)').eq('tenant_id', tenantActual.id).order('created_at', { ascending: true });
  if (!invoices || invoices.length === 0) { avisarReporte('Sin ventas registradas.', 'warning'); return; }
  const matriz = [[null, 'COMPAÑÍA:', tenantActual.razon_social], [], [null, null, null, null, 'LIBRO DE VENTAS SENIAT']];
  matriz.push([null, 'Oper', 'Fecha', 'RIF', 'Cliente', 'Documento', 'Nro Control', 'Total', 'IVA', 'Base Imponible']);
  invoices.forEach((inv, i) => {
    matriz.push([null, i+1, new Date(inv.created_at), inv.cliente_rif, inv.cliente_nombre, inv.factura_nro, inv.nro_control, inv.total_bs, inv.iva_bs, inv.subtotal_bs]);
  });
  descargarExcelMatriz(matriz, 'Libro_de_Ventas', 'LibroVentas');
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
