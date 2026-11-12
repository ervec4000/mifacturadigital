/**
 * /js/inventarioFisico.js
 * Módulo de Inventario Físico y Generación de Etiquetas QR
 */

async function cargarInventarioFisico() {
  const { data } = await supabaseClient.from('productos').select('*').eq('tenant_id', tenantActual.id);
  inventarioFisicoCache = data || [];
  const tbody = document.getElementById('tablaInventarioFisico');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!inventarioFisicoCache.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-slate-500">Sin artículos registrados.</td></tr>`;
    return;
  }
  inventarioFisicoCache.forEach(p => {
    const stockTeorico = p.stock || 0;
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900">
        <td class="p-3 font-mono">${esc(p.codigo_sku||'S/N')}</td>
        <td class="p-3">${esc(p.descripcion)}</td>
        <td class="p-3 text-center font-bold text-sky-400">${stockTeorico}</td>
        <td class="p-3 text-center"><input type="number" id="conteo_${p.id}" value="${stockTeorico}" class="w-24 bg-slate-900 border border-slate-800 rounded p-1.5 text-center text-white font-mono"></td>
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
    const textoQr = `SKU:${p.codigo_sku||'N/A'}|DESC:${p.descripcion}`;
    container.innerHTML += `
      <div class="bg-white text-slate-900 p-4 rounded-xl border flex items-center justify-between font-mono text-xs">
        <div>
          <p class="font-bold text-emerald-700">${esc(p.codigo_sku||'SKU')}</p>
          <p class="text-sm font-bold">${esc(p.descripcion)}</p>
        </div>
        <div id="${qrId}" class="w-20 h-20 bg-slate-50 flex items-center justify-center"></div>
      </div>
    `;
    setTimeout(() => {
      const el = document.getElementById(qrId);
      if (el) {
        el.innerHTML = '';
        new QRCode(el, { text: textoQr, width: 72, height: 72, colorDark: "#000000", colorLight: "#ffffff" });
      }
    }, 50);
  });
}
