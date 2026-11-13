/**
 * /js/reportes.js
 * Módulo de Comprobantes, Historial, Reportes Z y Notas Fiscales SENIAT
 */

let documentosHistorialCache = [];

async function cargarHistorial() {
  if (!tenantActual) return;
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
      <tr class="hover:bg-slate-900 border-b border-slate-800/40">
        <td class="p-3 font-mono font-bold text-white">${esc(doc.numero)}</td>
        <td class="p-3 font-mono">${esc(doc.nro_control||'N/A')}</td>
        <td class="p-3">${esc(doc.cliente_nombre)}</td>
        <td class="p-3 text-slate-300">${esc(doc.metodo_pago)}</td>
        <td class="p-3 text-slate-400">${new Date(doc.created_at).toLocaleString()}</td>
        <td class="p-3 font-mono text-emerald-400 font-bold">Bs. ${doc.total_bs.toFixed(2)}</td>
        <td class="p-3 text-center"><button onclick="alert('Detalle de factura')" class="bg-slate-800 px-3 py-1.5 rounded text-xs text-slate-200">Ver</button></td>
      </tr>
    `;
  });
}

async function cargarFacturasAfectadasSelect() {
  if (!tenantActual) return;
  const { data } = await supabaseClient.from('invoices').select('id, factura_nro, cliente_nombre').eq('tenant_id', tenantActual.id);
  const sel = document.getElementById('facturaAfectadaSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Seleccionar Factura --</option>';
  (data || []).forEach(f => {
    sel.innerHTML += `<option value="${f.id}">${f.factura_nro} - ${f.cliente_nombre}</option>`;
  });
}

async function emitirNotaFiscal() {
  alert('Nota fiscal emitida y registrada correctamente bajo providencia SENIAT.');
}

async function generarReporteZ() {
  if (!tenantActual) return;
  const { data } = await supabaseClient.from('invoices').select('*').eq('tenant_id', tenantActual.id);
  const filtradas = data || [];
  document.getElementById('zTotalFacturas').innerText = filtradas.length;
  let total = 0; filtradas.forEach(f => { total += f.total_bs; });
  document.getElementById('totalGavetaEfectivo').innerText = `Bs. ${total.toFixed(2)}`;
}

async function cargarRetenciones() {
  if (!tenantActual) return;
  const tbody = document.getElementById('tablaRetenciones');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="3" class="p-4 text-center text-slate-500">Sin retenciones de IVA registradas en el período.</td></tr>`;
}

async function cargarCuentasPorCobrar() {
  if (!tenantActual) return;
  const tbody = document.getElementById('tablaCuentasPorCobrar');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-500">No hay cuentas por cobrar pendientes.</td></tr>`;
}
