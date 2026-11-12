/**
 * /js/reportes.js
 * Módulo de Cierres Z, Historial y Libros Fiscales SENIAT
 */

async function cargarHistorial() {
  const { data } = await supabaseClient.from('invoices').select('*').eq('tenant_id', tenantActual.id).order('created_at', { ascending: false });
  documentosHistorialCache = (data || []).map(f => ({...f, tipoDoc: 'FACTURA', numero: f.factura_nro}));
  renderizarHistorial(documentosHistorialCache);
}

function renderizarHistorial(lista) {
  const tbody = document.getElementById('tablaHistorial');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!lista.length) { tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-500">Sin comprobantes.</td></tr>`; return; }
  lista.forEach(doc => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900">
        <td class="p-3 font-mono font-bold text-white">${esc(doc.numero)}</td>
        <td class="p-3 font-mono">${esc(doc.nro_control||'N/A')}</td>
        <td class="p-3">${esc(doc.cliente_nombre)}</td>
        <td class="p-3 text-slate-300">${esc(doc.metodo_pago)}</td>
        <td class="p-3 text-slate-400">${new Date(doc.created_at).toLocaleString()}</td>
        <td class="p-3 font-mono text-emerald-400 font-bold">Bs. ${doc.total_bs.toFixed(2)}</td>
        <td class="p-3 text-center"><button onclick='verComprobante(${JSON.stringify(doc)})' class="bg-slate-800 px-3 py-1.5 rounded text-xs text-slate-200">Ver</button></td>
      </tr>
    `;
  });
}

async function generarReporteZ() {
  const { data } = await supabaseClient.from('invoices').select('*').eq('tenant_id', tenantActual.id);
  const filtradas = data || [];
  document.getElementById('zTotalFacturas').innerText = filtradas.length;
  let total = 0; filtradas.forEach(f => { total += f.total_bs; });
  document.getElementById('totalGavetaEfectivo').innerText = `Bs. ${total.toFixed(2)}`;
}
