/**
 * /js/reportes.js
 * Módulo de Reportes Z, Libros Oficiales de Ventas y Compras SENIAT, Notas Fiscales, Retenciones y QR (2026)
 */

let documentosHistorialCache = [];

async function cargarHistorial() {
  const { data } = await supabaseClient.from('invoices').select('*').eq('tenant_id', tenantActual.id).order('created_at', { ascending: false });
  documentosHistorialCache = (data || []).map(f => {
    const numUpper = (f.factura_nro || '').toUpperCase();
    let tDoc = 'FACTURA';
    if (numUpper.startsWith('NC')) tDoc = 'NOTA CREDITO';
    if (numUpper.startsWith('ND')) tDoc = 'NOTA DEBITO';
    return {...f, tipoDoc: tDoc, numero: f.factura_nro};
  });
  renderizarHistorial(documentosHistorialCache);
}

function filtrarHistorial() {
  const txt = document.getElementById('filtroTexto').value.toLowerCase().trim();
  const tipoSel = document.getElementById('filtroTipo').value;

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
    let badgeColor = 'bg-emerald-950 text-emerald-300';
    if (doc.tipoDoc === 'NOTA CREDITO') badgeColor = 'bg-sky-950 text-sky-300';
    if (doc.tipoDoc === 'NOTA DEBITO') badgeColor = 'bg-amber-950 text-amber-300';

    tbody.innerHTML += `
      <tr class="hover:bg-slate-900">
        <td class="p-3 font-mono font-bold text-white"><span class="px-2 py-0.5 rounded text-[10px] ${badgeColor} mr-1">${esc(doc.tipoDoc)}</span> ${esc(doc.numero)}</td>
        <td class="p-3 font-mono">${esc(doc.nro_control||'N/A')}</td>
        <td class="p-3">${esc(doc.cliente_nombre)}</td>
        <td class="p-3 text-slate-300">${esc(doc.metodo_pago)}</td>
        <td class="p-3 text-slate-400">${formatearFecha8Digitos(doc.created_at)}</td>
        <td class="p-3 font-mono text-emerald-400 font-bold">Bs. ${doc.total_bs.toFixed(2)}</td>
        <td class="p-3 text-center"><button onclick='verComprobante(${JSON.stringify(doc)})' class="bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded cursor-pointer text-xs text-slate-200">Ver</button></td>
      </tr>
    `;
  });
}

async function verComprobante(doc) {
  comprobanteActualCache = doc;
  document.getElementById('ticketComercioNombre').innerText = tenantActual.razon_social;
  document.getElementById('ticketComercioRif').innerText = `RIF: ${tenantActual.rif}`;
  document.getElementById('ticketComercioDir').innerText = tenantActual.direccion || 'VENEZUELA';
  
  const numUpper = (doc.numero || '').toUpperCase();
  let tituloDoc = 'FACTURA FISCAL DIGITAL';
  if (numUpper.startsWith('NC')) tituloDoc = 'NOTA DE CRÉDITO FISCAL';
  if (numUpper.startsWith('ND')) tituloDoc = 'NOTA DE DÉBITO FISCAL';
  document.getElementById('ticketTipoDoc').innerText = tituloDoc;

  document.getElementById('ticketNro').innerText = 'Documento: ' + doc.numero;
  document.getElementById('ticketControl').innerText = 'Control: ' + (doc.nro_control || '00-000000');
  document.getElementById('ticketFecha').innerText = 'Fecha: ' + formatearFecha8Digitos(doc.created_at);
  document.getElementById('ticketTasa').innerText = doc.tasa_bcv || 1;
  document.getElementById('ticketCliente').innerText = 'Cliente: ' + (doc.cliente_nombre || 'CONSUMIDOR FINAL');
  document.getElementById('ticketClienteRif').innerText = 'RIF/Cédula: ' + (doc.cliente_rif || 'V-0');
  document.getElementById('ticketMetodoPago').innerText = 'Detalle: ' + (doc.metodo_pago || 'EFECTIVO');
  
  const refExtra = document.getElementById('ticketReferenciaExtra');
  if (doc.metodo_pago && (doc.metodo_pago.includes('NOTA') || doc.metodo_pago.includes('AFECTA'))) {
    refExtra.innerText = doc.metodo_pago;
    refExtra.classList.remove('hidden');
  } else {
    refExtra.classList.add('hidden');
  }

  const tasa = doc.tasa_bcv || 1;
  const { data: items } = await supabaseClient.from('invoice_items').select('*').eq('invoice_id', doc.id);
  let baseGravadaUsd = 0;
  let montoExentoUsd = 0;

  const container = document.getElementById('ticketItemsContainer');
  container.innerHTML = '';

  if (items && items.length > 0) {
    items.forEach(it => {
      const subUsd = it.subtotal_usd || (it.cantidad * (it.precio_unitario_usd || 0));
      if (it.es_exento) montoExentoUsd += subUsd; else baseGravadaUsd += subUsd;
      container.innerHTML += `<div class="flex justify-between border-b border-dotted border-slate-300 py-0.5"><span>${it.cantidad}x ${esc(it.descripcion)}</span><span>$ ${subUsd.toFixed(2)} | Bs. ${(subUsd*tasa).toFixed(2)}</span></div>`;
    });
  } else {
    baseGravadaUsd = doc.monto_usd || 0;
    container.innerHTML = `<div class="py-1">1x Ajuste / Nota Fiscal | Total: Bs. ${(doc.total_bs||0).toFixed(2)}</div>`;
  }

  const baseGravadaBs = baseGravadaUsd * tasa;
  const montoExentoBs = montoExentoUsd * tasa;
  const ivaBs = doc.iva_bs || (baseGravadaBs * 0.16);
  const igtfBs = doc.igtf_bs || 0;
  const totalBs = doc.total_bs || (baseGravadaBs + montoExentoBs + ivaBs + igtfBs);

  document.getElementById('ticketBase').innerText = `$ ${baseGravadaUsd.toFixed(2)} | Bs. ${baseGravadaBs.toFixed(2)}`;
  document.getElementById('ticketExento').innerText = `$ ${montoExentoUsd.toFixed(2)} | Bs. ${montoExentoBs.toFixed(2)}`;
  document.getElementById('ticketIva').innerText = `$ ${(ivaBs/tasa).toFixed(2)} | Bs. ${ivaBs.toFixed(2)}`;
  document.getElementById('ticketIgtf').innerText = `$ ${(igtfBs/tasa).toFixed(2)} | Bs. ${igtfBs.toFixed(2)}`;
  document.getElementById('ticketTotal').innerText = `$ ${(totalBs/tasa).toFixed(2)} | Bs. ${totalBs.toFixed(2)}`;

  document.getElementById('modalTicket').classList.remove('hidden');
}

function cerrarTicket() { document.getElementById('modalTicket').classList.add('hidden'); }

async function cargarFacturasAfectadasSelect() {
  const { data } = await supabaseClient.from('invoices').select('*').eq('tenant_id', tenantActual.id).order('created_at', { ascending: false });
  const select = document.getElementById('facturaAfectadaSelect');
  if (!select) return;
  select.innerHTML = '';
  if (!data || data.length === 0) { select.innerHTML = '<option value="">Sin facturas emitidas</option>'; return; }
  data.forEach(f => {
    const numUpper = (f.factura_nro || '').toUpperCase();
    if (!numUpper.startsWith('NC') && !numUpper.startsWith('ND')) {
      select.innerHTML += `<option value="${esc(f.factura_nro)}">Factura: ${esc(f.factura_nro)} | ${esc(f.cliente_nombre)} | Bs. ${f.total_bs.toFixed(2)}</option>`;
    }
  });
}

async function emitirNotaFiscal() {
  const tipoNota = document.getElementById('tipoNotaSelect').value;
  const facturaAfectada = document.getElementById('facturaAfectadaSelect').value;
  const montoUsd = parseFloat(document.getElementById('montoNotaUsd').value) || 0;
  const motivo = document.getElementById('motivoNota').value.trim();
  if (!facturaAfectada || montoUsd <= 0 || !motivo) { alert('Complete todos los campos obligatorios.'); return; }

  const tasa = parseFloat(document.getElementById('tasaBcv').value) || 1;
  const nroNota = (tipoNota === 'NOTA CREDITO' ? 'NC-' : 'ND-') + Math.floor(1000 + Math.random() * 9000);
  const nroControl = '00-' + Math.floor(100000 + Math.random() * 900000);
  const montoBs = montoUsd * tasa;

  const { data: invOriginal } = await supabaseClient.from('invoices').select('*').eq('tenant_id', tenantActual.id).eq('factura_nro', facturaAfectada).single();

  await supabaseClient.from('invoices').insert([{
    tenant_id: tenantActual.id, 
    factura_nro: nroNota, 
    nro_control: nroControl, 
    tasa_bcv: tasa,
    monto_usd: montoUsd, 
    subtotal_bs: montoBs, 
    iva_bs: montoBs * 0.16, 
    total_bs: montoBs * 1.16,
    cliente_rif: invOriginal?.cliente_rif || 'V-0', 
    cliente_nombre: invOriginal?.cliente_nombre || 'CLIENTE',
    metodo_pago: `${tipoNota} | AFECTA FAC: ${facturaAfectada} | MOTIVO: ${motivo}`
  }]);

  alert(`¡${tipoNota} emitida con éxito (${nroNota}) conforme a Providencia SENIAT!`);
  cambiarPestana('historial');
}

async function generarReporteZ() {
  const { data } = await supabaseClient.from('invoices').select('*').eq('tenant_id', tenantActual.id);
  const filtradas = data || [];
  document.getElementById('zTotalFacturas').innerText = filtradas.length;
  let total = 0; filtradas.forEach(f => {
    const numUpper = (f.factura_nro || '').toUpperCase();
    if (numUpper.startsWith('NC')) total -= f.total_bs;
    else total += f.total_bs;
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
  const { data: invoices } = await supabaseClient.from('invoices').select('*, invoice_items(*)').eq('tenant_id', tenantActual.id).order('created_at', { ascending: true });
  if (!invoices || invoices.length === 0) { alert('Sin ventas.'); return; }
  const matriz = [[null, 'COMPAÑÍA:', tenantActual.razon_social], [], [null, null, null, null, 'LIBRO DE VENTAS SENIAT']];
  matriz.push([null, 'Oper', 'Fecha', 'RIF', 'Cliente', 'Documento', 'Nro Control', 'Total', 'IVA', 'Base Imponible']);
  invoices.forEach((inv, i) => {
    matriz.push([null, i+1, new Date(inv.created_at), inv.cliente_rif, inv.cliente_nombre, inv.factura_nro, inv.nro_control, inv.total_bs, inv.iva_bs, inv.subtotal_bs]);
  });
  descargarExcelMatriz(matriz, 'Libro_de_Ventas', 'LibroVentas');
}

async function descargarLibroComprasOficialExcel() {
  const { data: compras } = await supabaseClient.from('kardex_movimientos').select('*').eq('tenant_id', tenantActual.id).eq('tipo_movimiento', 'ENTRADA');
  const matriz = [[null, 'COMPAÑÍA:', tenantActual.razon_social], [], [null, null, null, null, 'LIBRO DE COMPRAS SENIAT']];
  matriz.push([null, 'Oper', 'Fecha', 'Proveedor / Ref', 'Total Compras', 'Base Imponible', 'IVA']);
  if (compras) {
    compras.forEach((c, i) => {
      const base = (c.costo_promedio_usd || 1) * (c.cantidad_in || 1) * (c.tasa_bcv || 1);
      matriz.push([null, i+1, new Date(c.created_at), c.documento_ref, base*1.16, base, base*0.16]);
    });
  }
  descargarExcelMatriz(matriz, 'Libro_de_Compras', 'LibroCompras');
}

async function generarComprobanteRetencion() {
  const facRef = document.getElementById('retFacturaRef').value.trim();
  const baseUsd = parseFloat(document.getElementById('retBaseUsd').value) || 0;
  const porcentaje = parseFloat(document.getElementById('retPorcentaje').value) || 100;
  if (!facRef || baseUsd <= 0) { alert('Complete los datos de la retención.'); return; }

  const tasa = parseFloat(document.getElementById('tasaBcv').value) || 1;
  const baseBs = baseUsd * tasa;
  const ivaBs = baseBs * 0.16;
  const ivaRetenidoBs = ivaBs * (porcentaje / 100);
  const nroComp = 'RET-' + new Date().getFullYear() + '-' + Math.floor(10000 + Math.random() * 90000);

  await supabaseClient.from('retenciones_iva').insert([{
    tenant_id: tenantActual.id, nro_comprobante: nroComp, factura_ref: facRef,
    base_imponible_bs: baseBs, iva_bs: ivaBs, porcentaje_retencion: porcentaje, iva_retenido_bs: ivaRetenidoBs
  }]);

  alert(`¡Comprobante de Retención de IVA ${nroComp} generado con éxito (${porcentaje}%)!`);
  cargarRetenciones();
}

async function cargarRetenciones() {
  const { data } = await supabaseClient.from('retenciones_iva').select('*').eq('tenant_id', tenantActual.id).order('created_at', { ascending: false });
  const tbody = document.getElementById('tablaRetenciones');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-500">Sin comprobantes de retención registrados.</td></tr>`;
    return;
  }
  data.forEach(r => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900">
        <td class="p-3 font-mono text-emerald-400 font-bold">${esc(r.nro_comprobante)}</td>
        <td class="p-3 font-mono">${esc(r.factura_ref)}</td>
        <td class="p-3 font-mono">Bs. ${(r.base_imponible_bs || 0).toFixed(2)}</td>
        <td class="p-3 font-mono">Bs. ${(r.iva_bs || 0).toFixed(2)}</td>
        <td class="p-3 font-mono text-emerald-300 font-bold">Bs. ${(r.iva_retenido_bs || 0).toFixed(2)} (${r.porcentaje_retencion}%)</td>
        <td class="p-3 text-center"><button onclick="alert('Comprobante ${esc(r.nro_comprobante)}')" class="text-sky-400 hover:underline">Ver</button></td>
      </tr>
    `;
  });
}

async function renderizarEtiquetasQr() {
  const { data } = await supabaseClient.from('productos').select('*').eq('tenant_id', tenantActual.id);
  const container = document.getElementById('contenedorGridEtiquetas');
  if (!container) return;
  container.innerHTML = '';
  if (!data || data.length === 0) { container.innerHTML = '<p class="text-slate-500">Sin artículos.</p>'; return; }
  
  data.forEach((p, idx) => {
    const qrId = `qr_div_${idx}`;
    const textoQr = `SKU:${p.codigo_sku||'N/A'}|DESC:${p.descripcion}|LOTE:${p.lote||'SIN-LOTE'}|UBI:${p.ubicacion||'DEP'}`;

    container.innerHTML += `
      <div class="bg-white text-slate-900 p-4 rounded-xl border border-slate-300 flex items-center justify-between font-mono text-xs shadow">
        <div>
          <p class="font-bold text-emerald-700">${esc(p.codigo_sku||'SKU')}</p>
          <p class="text-sm font-bold text-slate-900">${esc(p.descripcion)}</p>
          <p class="text-[10px] text-slate-600 mt-1">Ubicación: ${esc(p.ubicacion||'DEP')} | Lote: ${esc(p.lote||'N/A')}</p>
        </div>
        <div id="${qrId}" class="w-20 h-20 bg-slate-50 flex items-center justify-center border border-slate-200 rounded p-1"></div>
      </div>
    `;

    setTimeout(() => {
      const el = document.getElementById(qrId);
      if (el) {
        el.innerHTML = '';
        new QRCode(el, {
          text: textoQr,
          width: 72,
          height: 72,
          colorDark : "#000000",
          colorLight : "#ffffff",
          correctLevel : QRCode.CorrectLevel.M
        });
      }
    }, 50);
  });
}

function imprimirEtiquetasQr() { window.print(); }