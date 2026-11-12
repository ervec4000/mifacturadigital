/**
 * /js/inventarioFisico.js
 * Módulo de Inventario Físico, Conciliación de Stock, Auditoría y Histórico en Supabase (SENIAT 2026)
 */

let inventarioFisicoCache = [];

async function cargarInventarioFisico() {
  const { data } = await supabaseClient.from('productos').select('*').eq('tenant_id', tenantActual.id);
  inventarioFisicoCache = data || [];
  const tbody = document.getElementById('tablaInventarioFisico');
  tbody.innerHTML = '';
  if (!inventarioFisicoCache.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-slate-500">Sin artículos registrados para inventario físico.</td></tr>`;
    return;
  }
  inventarioFisicoCache.forEach(p => {
    const stockTeorico = p.stock || 0;
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900" id="fila_fisica_${p.id}">
        <td class="p-3 font-mono">${esc(p.codigo_sku||'S/N')}</td>
        <td class="p-3">${esc(p.descripcion)}</td>
        <td class="p-3">${esc(p.categoria||'N/A')}</td>
        <td class="p-3 font-mono">${esc(p.ubicacion||'DEP')}</td>
        <td class="p-3 text-center font-bold text-sky-400" id="teorico_${p.id}">${stockTeorico}</td>
        <td class="p-3 text-center">
          <input type="number" step="0.001" id="conteo_${p.id}" value="${stockTeorico}" oninput="calcularDiferenciaFisica('${p.id}', ${stockTeorico})" class="w-24 bg-slate-900 border border-slate-800 rounded p-1.5 text-center font-mono text-white">
        </td>
        <td class="p-3 text-center font-bold text-emerald-400" id="diff_${p.id}">0</td>
        <td class="p-3 text-center no-print"><button onclick="aplicarConteoUnico('${p.id}', ${stockTeorico})" class="text-emerald-400 hover:underline">Aplicar</button></td>
      </tr>
    `;
  });
}

function calcularDiferenciaFisica(prodId, teorico) {
  const real = parseFloat(document.getElementById(`conteo_${prodId}`).value) || 0;
  const diff = real - teorico;
  const diffEl = document.getElementById(`diff_${prodId}`);
  diffEl.innerText = diff > 0 ? `+${diff.toFixed(3)}` : diff.toFixed(3);
  diffEl.className = `p-3 text-center font-bold ${diff === 0 ? 'text-slate-400' : (diff > 0 ? 'text-emerald-400' : 'text-rose-400')}`;
}

async function aplicarConteoUnico(prodId, stockTeorico) {
  const real = parseFloat(document.getElementById(`conteo_${prodId}`).value) || 0;
  const diff = real - stockTeorico;
  const fechaConteo = document.getElementById('fisicoFecha').value || new Date().toISOString().slice(0,10);
  const prod = inventarioFisicoCache.find(x => x.id === prodId);

  await supabaseClient.from('productos').update({ stock: real }).eq('id', prodId);

  await supabaseClient.from('inventario_fisico_historico').insert([{
    tenant_id: tenantActual.id, fecha_conteo: fechaConteo, producto_id: prodId,
    sku: prod?.codigo_sku || 'S/N', descripcion: prod?.descripcion || 'Artículo',
    stock_teorico: stockTeorico, stock_real: real, diferencia: diff
  }]);

  alert(`¡Stock actualizado a ${real} y registrado en el histórico de Supabase!`);
  cargarInventarioFisico();
}

async function guardarTodoInventarioFisico() {
  const fechaConteo = document.getElementById('fisicoFecha').value || new Date().toISOString().slice(0,10);
  for (const p of inventarioFisicoCache) {
    const real = parseFloat(document.getElementById(`conteo_${p.id}`).value);
    if (!isNaN(real)) {
      const teorico = p.stock || 0;
      const diff = real - teorico;
      await supabaseClient.from('productos').update({ stock: real }).eq('id', p.id);
      await supabaseClient.from('inventario_fisico_historico').insert([{
        tenant_id: tenantActual.id, fecha_conteo: fechaConteo, producto_id: p.id,
        sku: p.codigo_sku || 'S/N', descripcion: p.descripcion || 'Artículo',
        stock_teorico: teorico, stock_real: real, diferencia: diff
      }]);
    }
  }
  alert('¡Conciliación grabada y registrada en Supabase con éxito!');
  cargarInventarioFisico();
}

async function cargarHistoricoInventarioFisico() {
  const { data } = await supabaseClient.from('inventario_fisico_historico').select('*').eq('tenant_id', tenantActual.id).order('creado_en', { ascending: false });
  const container = document.getElementById('contenedorHistoricoFisico');
  const tbody = document.getElementById('tablaHistoricoFisico');
  if (container) container.classList.remove('hidden');
  if (tbody) {
    tbody.innerHTML = '';
    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-500">Sin registros en el histórico de Supabase.</td></tr>`;
      return;
    }
    data.forEach(h => {
      tbody.innerHTML += `
        <tr class="hover:bg-slate-900">
          <td class="p-2.5 font-mono text-slate-400">${esc(h.fecha_conteo)}</td>
          <td class="p-2.5 font-mono text-emerald-400">${esc(h.sku)}</td>
          <td class="p-2.5">${esc(h.descripcion)}</td>
          <td class="p-2.5 text-center font-bold text-sky-400">${h.stock_teorico}</td>
          <td class="p-2.5 text-center font-bold text-white">${h.stock_real}</td>
          <td class="p-2.5 text-center font-bold ${h.diferencia===0?'text-slate-400':(h.diferencia>0?'text-emerald-400':'text-rose-400')}">${h.diferencia>0?'+'+h.diferencia:h.diferencia}</td>
        </tr>
      `;
    });
  }
}

function exportarInventarioFisicoExcel() {
  if (!inventarioFisicoCache.length) { alert('No hay datos cargados.'); return; }
  const excelData = inventarioFisicoCache.map(p => {
    const real = parseFloat(document.getElementById(`conteo_${p.id}`)?.value) || p.stock || 0;
    const teorico = p.stock || 0;
    return { SKU: p.codigo_sku, Descripción: p.descripcion, Categoría: p.categoria, Ubicación: p.ubicacion, StockTeórico: teorico, StockFísicoReal: real, Diferencia: real - teorico };
  });
  const worksheet = XLSX.utils.json_to_sheet(excelData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "InventarioFisico");
  XLSX.writeFile(workbook, `Inventario_Fisico_${new Date().toISOString().slice(0,10)}.xlsx`);
}

function importarInventarioFisicoExcel(e) { document.getElementById('inputImportExcel').click(); }

function procesarArchivoImportado(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(evt) {
    const data = new Uint8Array(evt.target.result);
    const workbook = XLSX.read(data, {type: 'array'});
    const firstSheet = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet]);
    
    rows.forEach(r => {
      const sku = r.SKU || r.sku;
      const real = parseFloat(r.StockFísicoReal || r.StockFisicoReal || r.stock_real);
      if (sku && !isNaN(real)) {
        const prod = inventarioFisicoCache.find(x => x.codigo_sku === sku);
        if (prod) {
          const inputEl = document.getElementById(`conteo_${prod.id}`);
          if (inputEl) {
            inputEl.value = real;
            calcularDiferenciaFisica(prod.id, prod.stock || 0);
          }
        }
      }
    });
    alert('¡Datos importados desde Excel!');
  };
  reader.readAsArrayBuffer(file);
}