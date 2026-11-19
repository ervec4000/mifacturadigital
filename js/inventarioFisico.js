/**
 * /js/inventarioFisico.js
 * Módulos:
 * - Toma de Inventario Físico, Mermas, Conciliación Global, Histórico, Acta PDF e Import/Export Excel (INV-002 al INV-008)
 * - Etiquetas QR Tamaño Carta Imprimibles en PDF y Exportables a Excel (CAT-004)
 */

let inventarioFisicoCache = [];
let inventarioFisicoHistCache = [];
let etiquetasQrCache = [];

function avisarInvFisico(mensaje, tipo = 'info', duracion = 5500) {
  if (typeof notificarSistema === 'function') {
    notificarSistema(mensaje, tipo, duracion);
  } else {
    console.log(`[${tipo}]`, mensaje);
  }
}

function obtenerTenantInv() {
  return tenantActual ? (tenantActual.id || tenantActual.tenant_id || null) : null;
}

// ==========================================
// 1. INVENTARIO FÍSICO Y CONCILIACIÓN (INV-002..008)
// ==========================================

async function cargarInventarioFisico() {
  const tenantId = obtenerTenantInv();
  if (!tenantId) return;

  const { data, error } = await supabaseClient
    .from('productos')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('descripcion', { ascending: true });

  const tbody = document.getElementById('tablaInventarioFisico');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (error) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-rose-400">Error al consultar artículos: ${esc(error.message)}</td></tr>`;
    return;
  }

  inventarioFisicoCache = (data || []).filter(p => p.maneja_inventario !== false);
  if (!inventarioFisicoCache.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-500">Sin artículos con control de inventario registrados.</td></tr>`;
    await cargarHistoricoInventarioFisico();
    return;
  }

  inventarioFisicoCache.forEach(p => {
    const stockTeorico = Number(p.stock || 0);
    const costo = Number(p.costo_unitario_usd || 0);
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900/80 border-b border-slate-800/60">
        <td class="p-3 font-mono text-slate-300 tabular-nums">${esc(p.codigo_sku || 'S/N')}</td>
        <td class="p-3">
          <div class="font-medium text-white">${esc(p.descripcion)}</div>
          <div class="text-[11px] text-slate-400 font-mono">${esc(p.unidad_medida || 'UND')} · Costo: $ ${costo.toFixed(2)}</div>
        </td>
        <td class="p-3 text-right font-mono font-bold text-sky-400 tabular-nums">${stockTeorico}</td>
        <td class="p-3 text-center">
          <input
            type="number"
            step="0.001"
            id="conteo_${esc(p.id)}"
            value="${stockTeorico}"
            oninput='calcularDiferenciaFisica("${esc(p.id)}")'
            class="w-28 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-right text-white font-mono text-xs tabular-nums focus:border-emerald-500 focus:outline-none"
          >
        </td>
        <td id="dif_${esc(p.id)}" class="p-3 text-right font-mono font-bold text-slate-400 tabular-nums">0</td>
        <td class="p-3 text-center">
          <button type="button" onclick='aplicarConteoUnico("${esc(p.id)}")' class="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer whitespace-nowrap">Aplicar Ajuste</button>
        </td>
      </tr>
    `;
  });

  recalcularResumenFisico();
  await cargarHistoricoInventarioFisico();
}

function calcularDiferenciaFisica(prodId) {
  const prod = inventarioFisicoCache.find(p => String(p.id) === String(prodId));
  if (!prod) return 0;

  const teorico = Number(prod.stock || 0);
  const input = document.getElementById(`conteo_${prodId}`);
  const fisico = parseFloat(input?.value);
  const valFisico = Number.isFinite(fisico) ? fisico : teorico;
  const dif = Number((valFisico - teorico).toFixed(3));

  const cell = document.getElementById(`dif_${prodId}`);
  if (cell) {
    if (dif > 0) {
      cell.className = 'p-3 text-right font-mono font-bold text-emerald-400 tabular-nums';
      cell.textContent = `+${dif} (Sobrante)`;
    } else if (dif < 0) {
      cell.className = 'p-3 text-right font-mono font-bold text-rose-400 tabular-nums';
      cell.textContent = `${dif} (Merma)`;
    } else {
      cell.className = 'p-3 text-right font-mono font-bold text-slate-400 tabular-nums';
      cell.textContent = '0 (Cuadrado)';
    }
  }
  recalcularResumenFisico();
  return dif;
}

function recalcularResumenFisico() {
  let conDiferencia = 0;
  let valorDifUsd = 0;
  inventarioFisicoCache.forEach(p => {
    const teorico = Number(p.stock || 0);
    const input = document.getElementById(`conteo_${p.id}`);
    const fisico = parseFloat(input?.value);
    const valFisico = Number.isFinite(fisico) ? fisico : teorico;
    const dif = valFisico - teorico;
    if (Math.abs(dif) > 0.0001) {
      conDiferencia += 1;
      valorDifUsd += dif * Number(p.costo_unitario_usd || 0);
    }
  });
  const elSkus = document.getElementById('fisicoTotalSkus');
  const elDif = document.getElementById('fisicoConDiferencia');
  const elVal = document.getElementById('fisicoValorDiferencia');
  if (elSkus) elSkus.textContent = String(inventarioFisicoCache.length);
  if (elDif) elDif.textContent = String(conDiferencia);
  if (elVal) {
    elVal.textContent = `${valorDifUsd >= 0 ? '+' : ''}$ ${valorDifUsd.toFixed(2)}`;
    elVal.className = `font-mono font-bold text-lg tabular-nums mt-1 ${valorDifUsd > 0 ? 'text-emerald-400' : (valorDifUsd < 0 ? 'text-rose-400' : 'text-slate-200')}`;
  }
}

async function aplicarConteoUnico(prodId) {
  const tenantId = obtenerTenantInv();
  if (!tenantId) return;
  const prod = inventarioFisicoCache.find(p => String(p.id) === String(prodId));
  if (!prod) return;

  const teorico = Number(prod.stock || 0);
  const fisico = parseFloat(document.getElementById(`conteo_${prodId}`)?.value);
  if (!Number.isFinite(fisico) || fisico < 0) {
    avisarInvFisico('Ingresa una cantidad física válida (>= 0).', 'warning');
    return;
  }

  const dif = Number((fisico - teorico).toFixed(3));
  const fechaHoy = document.getElementById('fisicoFecha')?.value || new Date().toISOString().slice(0, 10);
  const refDoc = `AJUSTE-FIS-${Date.now().toString().slice(-6)}`;

  const { error: updErr } = await supabaseClient
    .from('productos')
    .update({ stock: fisico })
    .eq('id', prod.id)
    .eq('tenant_id', tenantId);

  if (updErr) {
    avisarInvFisico(`Error al actualizar stock de ${prod.descripcion}: ${updErr.message}`, 'error', 8000);
    return;
  }

  if (Math.abs(dif) > 0.0001) {
    await supabaseClient.from('kardex_movimientos').insert([{
      tenant_id: tenantId,
      producto_id: prod.id,
      tipo_movimiento: dif > 0 ? 'ENTRADA' : 'SALIDA',
      documento_ref: `${refDoc} | CONTEO FISICO (${dif > 0 ? 'SOBRANTE' : 'MERMA'})`,
      cantidad_in: dif > 0 ? dif : 0,
      cantidad_out: dif < 0 ? Math.abs(dif) : 0,
      cantidad_ajuste: dif,
      saldo_cantidad: fisico,
      costo_promedio_usd: Number(prod.costo_unitario_usd || 1),
      tasa_bcv: parseFloat(document.getElementById('tasaBcv')?.value) || 1,
      fecha: fechaHoy
    }]);
  }

  await guardarSesionInventarioFisico({
    id: refDoc,
    fecha: fechaHoy,
    responsable: tenantActual?.razon_social || tenantActual?.email || 'Usuario',
    observacion: `Ajuste individual: ${prod.codigo_sku || ''} ${prod.descripcion}`,
    items: [{
      sku: prod.codigo_sku || 'S/N',
      descripcion: prod.descripcion,
      unidad: prod.unidad_medida || 'UND',
      teorico,
      fisico,
      diferencia: dif,
      costoUsd: Number(prod.costo_unitario_usd || 0)
    }]
  });

  avisarInvFisico(`Stock de "${prod.descripcion}" conciliado a ${fisico} (Dif: ${dif > 0 ? '+' : ''}${dif}).`, 'success');
  await cargarInventarioFisico();
}

async function guardarTodoInventarioFisico() {
  const tenantId = obtenerTenantInv();
  if (!tenantId) return;
  if (inventarioFisicoCache.length === 0) {
    avisarInvFisico('No hay artículos en la tabla de conteo físico.', 'warning');
    return;
  }

  const fechaHoy = document.getElementById('fisicoFecha')?.value || new Date().toISOString().slice(0, 10);
  const obs = (document.getElementById('fisicoObservacion')?.value || '').trim() || 'Toma Física General';
  const tasa = parseFloat(document.getElementById('tasaBcv')?.value) || 1;
  const actaId = `ACTA-INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(Math.floor(100 + Math.random() * 900))}`;

  const confirmado = typeof pedirConfirmacion === 'function'
    ? await pedirConfirmacion(
        '📋 Conciliar Inventario Físico Global',
        `Se actualizarán los saldos teóricos de ${inventarioFisicoCache.length} artículo(s) según tu conteo físico, generando los ajustes en Kardex y el Acta ${actaId}. ¿Continuar?`
      )
    : true;
  if (!confirmado) return;

  const itemsActa = [];
  let ajustesCount = 0;

  for (const p of inventarioFisicoCache) {
    const teorico = Number(p.stock || 0);
    const rawVal = parseFloat(document.getElementById(`conteo_${p.id}`)?.value);
    const fisico = Number.isFinite(rawVal) && rawVal >= 0 ? rawVal : teorico;
    const dif = Number((fisico - teorico).toFixed(3));

    itemsActa.push({
      sku: p.codigo_sku || 'S/N',
      descripcion: p.descripcion,
      unidad: p.unidad_medida || 'UND',
      teorico,
      fisico,
      diferencia: dif,
      costoUsd: Number(p.costo_unitario_usd || 0)
    });

    if (Math.abs(dif) > 0.0001) {
      ajustesCount += 1;
      await supabaseClient
        .from('productos')
        .update({ stock: fisico })
        .eq('id', p.id)
        .eq('tenant_id', tenantId);

      await supabaseClient.from('kardex_movimientos').insert([{
        tenant_id: tenantId,
        producto_id: p.id,
        tipo_movimiento: dif > 0 ? 'ENTRADA' : 'SALIDA',
        documento_ref: `${actaId} | CONCILIACION (${dif > 0 ? 'SOBRANTE' : 'MERMA'})`,
        cantidad_in: dif > 0 ? dif : 0,
        cantidad_out: dif < 0 ? Math.abs(dif) : 0,
        cantidad_ajuste: dif,
        saldo_cantidad: fisico,
        costo_promedio_usd: Number(p.costo_unitario_usd || 1),
        tasa_bcv: tasa,
        fecha: fechaHoy
      }]);
    }
  }

  await guardarSesionInventarioFisico({
    id: actaId,
    fecha: fechaHoy,
    responsable: tenantActual?.razon_social || tenantActual?.email || 'Usuario',
    observacion: obs,
    items: itemsActa
  });

  if (document.getElementById('fisicoObservacion')) document.getElementById('fisicoObservacion').value = '';
  avisarInvFisico(`¡Conciliación global ${actaId} registrada (${ajustesCount} ajustes aplicados en Kardex)!`, 'success', 7000);
  await cargarInventarioFisico();
}

async function guardarSesionInventarioFisico(sesion) {
  const tenantId = obtenerTenantInv();
  if (!tenantId) return;

  const registro = {
    ...sesion,
    created_at: new Date().toISOString()
  };

  try {
    const key = `inv_fisico_hist_${tenantId}`;
    const prev = JSON.parse(localStorage.getItem(key) || '[]');
    prev.unshift(registro);
    localStorage.setItem(key, JSON.stringify(prev.slice(0, 50)));
  } catch (e) {}

  try {
    await supabaseClient.from('audit_logs').insert([{
      tenant_id: tenantId,
      accion: 'INV_FISICO',
      detalle: JSON.stringify(registro)
    }]);
  } catch (e) {
    console.warn('No se pudo persistir acta en audit_logs:', e);
  }
}

async function cargarHistoricoInventarioFisico() {
  const tenantId = obtenerTenantInv();
  if (!tenantId) return;

  const sesionesMap = new Map();

  try {
    const { data } = await supabaseClient
      .from('audit_logs')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('accion', 'INV_FISICO')
      .order('created_at', { ascending: false })
      .limit(30);

    (data || []).forEach(row => {
      try {
        const parsed = typeof row.detalle === 'string' ? JSON.parse(row.detalle) : row.detalle;
        if (parsed && parsed.id) {
          sesionesMap.set(parsed.id, { ...parsed, origen: 'Nube' });
        }
      } catch (e) {}
    });
  } catch (e) {}

  try {
    const local = JSON.parse(localStorage.getItem(`inv_fisico_hist_${tenantId}`) || '[]');
    local.forEach(s => {
      if (s && s.id && !sesionesMap.has(s.id)) {
        sesionesMap.set(s.id, { ...s, origen: 'Local' });
      }
    });
  } catch (e) {}

  inventarioFisicoHistCache = Array.from(sesionesMap.values());
  const tbody = document.getElementById('tablaHistoricoInventarioFisico');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (inventarioFisicoHistCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-500">Sin actas de inventario físico registradas aún.</td></tr>`;
    return;
  }

  inventarioFisicoHistCache.forEach(s => {
    const items = s.items || [];
    const conDif = items.filter(it => Math.abs(Number(it.diferencia || 0)) > 0.0001).length;
    const netDifUsd = items.reduce((acc, it) => acc + (Number(it.diferencia || 0) * Number(it.costoUsd || 0)), 0);

    tbody.innerHTML += `
      <tr class="hover:bg-slate-900/80 border-b border-slate-800/60">
        <td class="p-3 font-mono font-bold text-slate-100">${esc(s.id)}</td>
        <td class="p-3 font-mono text-slate-300 tabular-nums">${esc(s.fecha || '--')}</td>
        <td class="p-3 text-slate-300">${esc(s.observacion || 'Toma Física')}</td>
        <td class="p-3 text-center font-mono tabular-nums">${items.length} / <span class="${conDif > 0 ? 'text-amber-400 font-bold' : 'text-emerald-400'}">${conDif} dif.</span></td>
        <td class="p-3 text-right font-mono font-bold tabular-nums ${netDifUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${netDifUsd >= 0 ? '+' : ''}$ ${netDifUsd.toFixed(2)}</td>
        <td class="p-3 text-center space-x-2 whitespace-nowrap">
          <button type="button" onclick='imprimirActaInventarioFisicoPdf("${esc(s.id)}")' class="text-emerald-400 hover:underline font-semibold cursor-pointer">Acta PDF</button>
          <button type="button" onclick='exportarActaInventarioExcel("${esc(s.id)}")' class="text-sky-400 hover:underline font-semibold cursor-pointer">Excel</button>
        </td>
      </tr>
    `;
  });
}

function imprimirActaInventarioFisicoPdf(actaId = null) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    avisarInvFisico('La librería jsPDF no está cargada.', 'error');
    return;
  }

  let sesion = actaId ? inventarioFisicoHistCache.find(s => String(s.id) === String(actaId)) : null;
  if (!sesion) {
    // Generar acta con el estado actual en pantalla
    const fechaHoy = document.getElementById('fisicoFecha')?.value || new Date().toISOString().slice(0, 10);
    const obs = (document.getElementById('fisicoObservacion')?.value || '').trim() || 'Conciliación Actual en Pantalla';
    sesion = {
      id: `ACTA-BORRADOR-${fechaHoy.replace(/-/g, '')}`,
      fecha: fechaHoy,
      responsable: tenantActual?.razon_social || 'Empresa Activa',
      observacion: obs,
      items: inventarioFisicoCache.map(p => {
        const teorico = Number(p.stock || 0);
        const raw = parseFloat(document.getElementById(`conteo_${p.id}`)?.value);
        const fisico = Number.isFinite(raw) ? raw : teorico;
        return {
          sku: p.codigo_sku || 'S/N',
          descripcion: p.descripcion,
          unidad: p.unidad_medida || 'UND',
          teorico,
          fisico,
          diferencia: Number((fisico - teorico).toFixed(3)),
          costoUsd: Number(p.costo_unitario_usd || 0)
        };
      })
    };
  }

  if (!sesion.items || sesion.items.length === 0) {
    avisarInvFisico('No hay artículos para generar el Acta de Inventario Físico.', 'warning');
    return;
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' });
  const pageW = pdf.internal.pageSize.getWidth();
  const margin = 14;
  const contentW = pageW - margin * 2;
  let y = 16;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  pdf.setTextColor(15, 23, 42);
  pdf.text((tenantActual?.razon_social || 'COMERCIO ACTIVO').toUpperCase(), margin, y);
  pdf.setFontSize(9);
  pdf.setTextColor(4, 120, 87);
  pdf.text(`ACTA DE CONCILIACIÓN DE INVENTARIO FÍSICO · ${sesion.id}`, pageW - margin, y, { align: 'right' });

  y += 6;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(71, 85, 105);
  pdf.text(`RIF: ${tenantActual?.rif || 'J-00000000-0'} | Fecha: ${sesion.fecha} | Responsable: ${sesion.responsable}`, margin, y);
  y += 4.5;
  pdf.text(`Observación: ${sesion.observacion}`, margin, y);
  y += 5;

  const drawHeader = (yy) => {
    pdf.setFillColor(15, 23, 42);
    pdf.rect(margin, yy, contentW, 7, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.text('SKU', margin + 2, yy + 4.7);
    pdf.text('Descripción', margin + 26, yy + 4.7);
    pdf.text('Teórico', margin + 114, yy + 4.7, { align: 'right' });
    pdf.text('Físico', margin + 134, yy + 4.7, { align: 'right' });
    pdf.text('Diferencia', margin + 158, yy + 4.7, { align: 'right' });
    pdf.text('Impacto ($)', pageW - margin - 2, yy + 4.7, { align: 'right' });
    return yy + 7;
  };

  y = drawHeader(y);
  pdf.setTextColor(15, 23, 42);

  let totalImpacto = 0;
  sesion.items.forEach(it => {
    if (y > 250) {
      pdf.addPage();
      y = 16;
      y = drawHeader(y);
      pdf.setTextColor(15, 23, 42);
    }
    const dif = Number(it.diferencia || 0);
    const imp = dif * Number(it.costoUsd || 0);
    totalImpacto += imp;

    pdf.setDrawColor(226, 232, 240);
    pdf.line(margin, y + 6.5, pageW - margin, y + 6.5);
    pdf.setFont('courier', 'normal');
    pdf.setFontSize(7.5);
    pdf.text(String(it.sku || 'S/N').slice(0, 12), margin + 2, y + 4.5);
    pdf.setFont('helvetica', 'normal');
    pdf.text(String(it.descripcion || '').slice(0, 44), margin + 26, y + 4.5);
    pdf.setFont('courier', 'normal');
    pdf.text(String(it.teorico), margin + 114, y + 4.5, { align: 'right' });
    pdf.text(String(it.fisico), margin + 134, y + 4.5, { align: 'right' });
    pdf.setFont('courier', 'bold');
    pdf.text(`${dif > 0 ? '+' : ''}${dif}`, margin + 158, y + 4.5, { align: 'right' });
    pdf.text(`${imp >= 0 ? '+' : ''}$${imp.toFixed(2)}`, pageW - margin - 2, y + 4.5, { align: 'right' });
    y += 6.5;
  });

  y += 6;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9.5);
  pdf.text(`TOTAL ÍTEMS AUDITADOS: ${sesion.items.length}    |    IMPACTO NETO EN COSTO: ${totalImpacto >= 0 ? '+' : ''}$ ${totalImpacto.toFixed(2)} USD`, margin, y);

  pdf.save(`${sesion.id}.pdf`);
  avisarInvFisico(`Acta ${sesion.id}.pdf descargada con éxito.`, 'success');
}

function exportarActaInventarioExcel(actaId) {
  const sesion = inventarioFisicoHistCache.find(s => String(s.id) === String(actaId));
  if (!sesion || !sesion.items?.length) return;
  if (typeof XLSX === 'undefined') { avisarInvFisico('SheetJS no disponible.', 'error'); return; }

  const rows = sesion.items.map(it => ({
    Acta: sesion.id,
    Fecha: sesion.fecha,
    SKU: it.sku,
    Descripción: it.descripcion,
    Unidad: it.unidad,
    'Stock Teórico': it.teorico,
    'Conteo Físico': it.fisico,
    Diferencia: it.diferencia,
    'Costo Unit. ($)': it.costoUsd,
    'Impacto ($)': Number((it.diferencia * it.costoUsd).toFixed(2))
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ActaConciliacion');
  XLSX.writeFile(wb, `${sesion.id}.xlsx`);
}

function exportarInventarioFisicoExcel() {
  if (!inventarioFisicoCache.length) {
    avisarInvFisico('Sin artículos para exportar.', 'warning');
    return;
  }
  if (typeof XLSX === 'undefined') { avisarInvFisico('SheetJS no disponible.', 'error'); return; }

  const rows = inventarioFisicoCache.map(p => {
    const teorico = Number(p.stock || 0);
    const raw = parseFloat(document.getElementById(`conteo_${p.id}`)?.value);
    const fisico = Number.isFinite(raw) ? raw : teorico;
    return {
      ID: p.id,
      SKU: p.codigo_sku || 'S/N',
      Descripción: p.descripcion,
      Unidad: p.unidad_medida || 'UND',
      'Stock Teórico': teorico,
      'Conteo Físico': fisico,
      Diferencia: Number((fisico - teorico).toFixed(3)),
      'Costo Unit. ($)': Number(p.costo_unitario_usd || 0)
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'InventarioFisico');
  XLSX.writeFile(wb, `Plantilla_Inventario_Fisico_${new Date().toISOString().slice(0, 10)}.xlsx`);
  avisarInvFisico('Plantilla Excel exportada. Puedes editar "Conteo Físico" e importarla de vuelta.', 'success');
}

function importarInventarioFisicoExcel(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;
  if (typeof XLSX === 'undefined') { avisarInvFisico('SheetJS no disponible.', 'error'); return; }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws);
      let actualizados = 0;

      rows.forEach(r => {
        const sku = String(r.SKU || r.sku || '').trim().toUpperCase();
        const idRow = String(r.ID || r.id || '').trim();
        const fisico = parseFloat(r['Conteo Físico'] ?? r['Conteo Fisico'] ?? r.fisico ?? r.conteo);
        if (!Number.isFinite(fisico)) return;

        const match = inventarioFisicoCache.find(p =>
          (idRow && String(p.id) === idRow) ||
          (sku && String(p.codigo_sku || '').toUpperCase() === sku)
        );
        if (match) {
          const inp = document.getElementById(`conteo_${match.id}`);
          if (inp) {
            inp.value = fisico;
            calcularDiferenciaFisica(match.id);
            actualizados += 1;
          }
        }
      });

      avisarInvFisico(`Conteo importado desde Excel (${actualizados} artículos actualizados en pantalla). Pulsa "Conciliar Todo" para guardar.`, 'success', 7000);
    } catch (err) {
      avisarInvFisico(`Error leyendo Excel: ${err.message}`, 'error');
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}

// ==========================================
// 2. ETIQUETAS QR TAMAÑO CARTA (CAT-004)
// ==========================================

async function renderizarEtiquetasQr() {
  const tenantId = obtenerTenantInv();
  if (!tenantId) return;

  const { data, error } = await supabaseClient
    .from('productos')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('descripcion', { ascending: true });

  if (error) {
    avisarInvFisico('Error al cargar productos para etiquetas QR: ' + error.message, 'error');
    return;
  }

  etiquetasQrCache = data || [];
  pintarGridEtiquetasQr();
}

function filtrarEtiquetasQr() {
  pintarGridEtiquetasQr();
}

function pintarGridEtiquetasQr() {
  const container = document.getElementById('contenedorGridEtiquetas');
  if (!container) return;

  const q = (document.getElementById('filtroEtiquetasQr')?.value || '').trim().toUpperCase();
  const cols = document.getElementById('formatoHojaEtiquetas')?.value || '3';
  const filtrados = q
    ? etiquetasQrCache.filter(p =>
        String(p.codigo_sku || '').toUpperCase().includes(q) ||
        String(p.descripcion || '').toUpperCase().includes(q) ||
        String(p.lote || '').toUpperCase().includes(q)
      )
    : etiquetasQrCache;

  container.className = cols === '2'
    ? 'etiquetas-cols-2 grid grid-cols-1 md:grid-cols-2 gap-4 bg-white p-6 rounded-xl border border-slate-300 shadow-xl'
    : 'etiquetas-cols-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 bg-white p-6 rounded-xl border border-slate-300 shadow-xl';

  container.innerHTML = '';
  if (filtrados.length === 0) {
    container.innerHTML = '<div class="col-span-full py-10 text-center text-slate-500 text-sm">Sin artículos que coincidan para generar etiquetas QR.</div>';
    return;
  }

  filtrados.forEach((p, idx) => {
    const qrId = `qr_div_${idx}`;
    const pv = Number(p.precio_venta_usd ?? p.precio_unitario_usd ?? 0);
    const textoQr = `SKU:${p.codigo_sku || 'S/N'}|DESC:${p.descripcion}|LOTE:${p.lote || 'SIN-LOTE'}|UBI:${p.ubicacion || 'DEP'}|PV:$${pv.toFixed(2)}`;

    container.innerHTML += `
      <div class="border border-dashed border-slate-400 rounded-lg p-3 bg-white text-slate-900 flex items-center justify-between gap-3">
        <div class="min-w-0 flex-1 space-y-1">
          <div class="flex items-center justify-between gap-2">
            <span class="font-mono font-bold text-xs text-slate-900 truncate">${esc(p.codigo_sku || 'SIN-SKU')}</span>
            <span class="font-mono font-bold text-xs text-emerald-700 shrink-0">$ ${pv.toFixed(2)}</span>
          </div>
          <p class="text-xs font-bold text-slate-900 leading-snug line-clamp-2">${esc(p.descripcion)}</p>
          <p class="text-[10px] font-mono text-slate-600 truncate">Lote: ${esc(p.lote || 'N/A')} · Ubi: ${esc(p.ubicacion || 'DEP')}</p>
        </div>
        <div id="${qrId}" data-qr-text="${esc(textoQr)}" class="w-20 h-20 bg-white p-0.5 border border-slate-200 rounded shrink-0 flex items-center justify-center"></div>
      </div>
    `;

    setTimeout(() => {
      const el = document.getElementById(qrId);
      if (el && typeof QRCode === 'function') {
        el.innerHTML = '';
        new QRCode(el, {
          text: textoQr,
          width: 72,
          height: 72,
          colorDark: '#000000',
          colorLight: '#ffffff'
        });
      }
    }, 30);
  });
}

function construirEtiquetasQrJsPdf() {
  const q = (document.getElementById('filtroEtiquetasQr')?.value || '').trim().toUpperCase();
  const colsMode = document.getElementById('formatoHojaEtiquetas')?.value || '3';
  const copias = Math.max(1, Math.min(20, parseInt(document.getElementById('copiasPorEtiquetaQr')?.value || '1', 10) || 1));

  const baseList = q
    ? etiquetasQrCache.filter(p =>
        String(p.codigo_sku || '').toUpperCase().includes(q) ||
        String(p.descripcion || '').toUpperCase().includes(q) ||
        String(p.lote || '').toUpperCase().includes(q)
      )
    : etiquetasQrCache;

  if (baseList.length === 0) {
    avisarInvFisico('No hay etiquetas para imprimir o exportar en PDF.', 'warning');
    return null;
  }
  if (!window.jspdf || !window.jspdf.jsPDF) {
    avisarInvFisico('La librería jsPDF no está cargada.', 'error');
    return null;
  }

  // Expandir copias
  const listaExpandida = [];
  baseList.forEach(p => {
    for (let c = 0; c < copias; c++) listaExpandida.push(p);
  });

  // Mapa rápido de imágenes QR ya renderizadas en DOM
  const qrDomMap = {};
  document.querySelectorAll('[id^="qr_div_"]').forEach(box => {
    const txt = box.getAttribute('data-qr-text') || '';
    const canvas = box.querySelector('canvas');
    if (canvas && txt) {
      try { qrDomMap[txt] = canvas.toDataURL('image/png'); } catch (e) {}
    } else {
      const img = box.querySelector('img');
      if (img && img.src && img.src.startsWith('data:image') && txt) {
        qrDomMap[txt] = img.src;
      }
    }
  });

  const { jsPDF } = window.jspdf;
  // Tamaño Carta US Letter: 215.9 x 279.4 mm
  const pdf = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const marginX = 10;
  const marginTop = 16;
  const marginBottom = 10;
  const cols = colsMode === '2' ? 2 : 3;
  const rows = colsMode === '2' ? 5 : 6;
  const gapX = 4;
  const gapY = 4;
  const cellW = (pageW - marginX * 2 - gapX * (cols - 1)) / cols;
  const cellH = (pageH - marginTop - marginBottom - gapY * (rows - 1)) / rows;
  const perPage = cols * rows;

  const drawPageHeader = (pageNum) => {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(15, 23, 42);
    pdf.text(`${(tenantActual?.razon_social || 'MIFACTURADIGITAL').toUpperCase()} — ETIQUETAS QR DE INVENTARIO (HOJA CARTA)`, marginX, 10);
    pdf.setFont('courier', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(100, 116, 139);
    pdf.text(`Pág. ${pageNum} · ${new Date().toLocaleDateString('es-VE')}`, pageW - marginX, 10, { align: 'right' });
    pdf.setDrawColor(203, 213, 225);
    pdf.line(marginX, 12.2, pageW - marginX, 12.2);
  };

  drawPageHeader(1);

  listaExpandida.forEach((p, i) => {
    const indexInPage = i % perPage;
    if (i > 0 && indexInPage === 0) {
      pdf.addPage();
      drawPageHeader(Math.floor(i / perPage) + 1);
    }

    const col = indexInPage % cols;
    const row = Math.floor(indexInPage / cols);
    const x = marginX + col * (cellW + gapX);
    const y = marginTop + row * (cellH + gapY);

    // Borde punteado de corte
    pdf.setDrawColor(148, 163, 184);
    pdf.setLineDashPattern([1.5, 1.5], 0);
    pdf.roundedRect(x, y, cellW, cellH, 1.5, 1.5, 'S');
    pdf.setLineDashPattern([], 0);

    const pv = Number(p.precio_venta_usd ?? p.precio_unitario_usd ?? 0);
    const textoQr = `SKU:${p.codigo_sku || 'S/N'}|DESC:${p.descripcion}|LOTE:${p.lote || 'SIN-LOTE'}|UBI:${p.ubicacion || 'DEP'}|PV:$${pv.toFixed(2)}`;
    const qrDataUrl = qrDomMap[textoQr];
    const qrSize = cols === 2 ? 26 : 21;
    const qrX = x + cellW - qrSize - 2.5;
    const qrY = y + (cellH - qrSize) / 2;

    if (qrDataUrl) {
      pdf.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
    }

    const textW = cellW - qrSize - 6.5;
    pdf.setFont('courier', 'bold');
    pdf.setFontSize(cols === 2 ? 8.5 : 7.5);
    pdf.setTextColor(15, 23, 42);
    pdf.text(String(p.codigo_sku || 'SIN-SKU').slice(0, 16), x + 2.5, y + 5.5);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(cols === 2 ? 8.5 : 7.5);
    const descLines = pdf.splitTextToSize(String(p.descripcion || ''), textW).slice(0, 3);
    pdf.text(descLines, x + 2.5, y + 10.5);

    pdf.setFont('courier', 'bold');
    pdf.setFontSize(cols === 2 ? 10.5 : 9);
    pdf.setTextColor(4, 120, 87);
    pdf.text(`$ ${pv.toFixed(2)}`, x + 2.5, y + cellH - 6.8);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(cols === 2 ? 7 : 6.2);
    pdf.setTextColor(71, 85, 105);
    pdf.text(`Lote: ${String(p.lote || 'N/A').slice(0, 12)} | Ubi: ${String(p.ubicacion || 'DEP').slice(0, 10)}`, x + 2.5, y + cellH - 2.5);
  });

  const fileName = `Etiquetas_QR_Carta_${new Date().toISOString().slice(0, 10)}.pdf`;
  return { pdf, fileName, totalEtiquetas: listaExpandida.length };
}

function imprimirEtiquetasQrPdf() {
  const res = construirEtiquetasQrJsPdf();
  if (!res) return;
  res.pdf.save(res.fileName);
  avisarInvFisico(`PDF tamaño Carta generado con ${res.totalEtiquetas} etiqueta(s) QR.`, 'success');
}

function imprimirEtiquetasQrNavegador() {
  const fechaTag = new Date().toISOString().slice(0, 10);
  if (typeof ejecutarImpresionConRespaldo === 'function') {
    ejecutarImpresionConRespaldo({
      claseBody: 'imprimiendo-etiquetas',
      esTicket80mm: false,
      construirPdfFn: () => {
        const res = construirEtiquetasQrJsPdf();
        return res ? res.pdf : null;
      },
      nombreArchivo: `Etiquetas_QR_Carta_${fechaTag}.pdf`,
      tituloVisor: 'Imprimir Etiquetas QR (Tamaño Carta)'
    });
    return;
  }
  try {
    window.print();
  } catch (e) {}
}

function exportarEtiquetasQrExcel() {
  if (!etiquetasQrCache.length) {
    avisarInvFisico('Sin artículos para exportar etiquetas.', 'warning');
    return;
  }
  if (typeof XLSX === 'undefined') { avisarInvFisico('SheetJS no disponible.', 'error'); return; }

  const q = (document.getElementById('filtroEtiquetasQr')?.value || '').trim().toUpperCase();
  const filtrados = q
    ? etiquetasQrCache.filter(p =>
        String(p.codigo_sku || '').toUpperCase().includes(q) ||
        String(p.descripcion || '').toUpperCase().includes(q)
      )
    : etiquetasQrCache;

  const rows = filtrados.map(p => {
    const pv = Number(p.precio_venta_usd ?? p.precio_unitario_usd ?? 0);
    return {
      SKU: p.codigo_sku || 'S/N',
      Descripción: p.descripcion,
      Categoría: p.categoria || '',
      Unidad: p.unidad_medida || 'UND',
      Lote: p.lote || 'SIN-LOTE',
      Ubicación: p.ubicacion || 'DEP',
      'Precio Venta ($)': pv,
      Stock: p.stock ?? 0,
      'Código QR (Payload)': `SKU:${p.codigo_sku || 'S/N'}|DESC:${p.descripcion}|LOTE:${p.lote || 'SIN-LOTE'}|UBI:${p.ubicacion || 'DEP'}|PV:$${pv.toFixed(2)}`
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'EtiquetasQR');
  XLSX.writeFile(wb, `Etiquetas_QR_Inventario_${new Date().toISOString().slice(0, 10)}.xlsx`);
  avisarInvFisico('Catálogo de Etiquetas QR exportado a Excel.', 'success');
}
