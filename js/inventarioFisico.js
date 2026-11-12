/**
 * /js/inventarioFisico.js
 * Módulo de Toma de Inventario Físico y Conciliación (SENIAT / Danac)
 */

document.addEventListener("DOMContentLoaded", () => {
  const secFisico = document.getElementById('seccionFisico');
  if (secFisico) {
    secFisico.innerHTML = `
      <div class="space-y-6">
        <div class="flex justify-between items-center">
          <h3 class="text-sm font-bold text-emerald-400 uppercase">🔍 Toma y Conciliación de Inventario Físico</h3>
          <button onclick="generarReporteFisicoPdf()" class="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-4 py-2 rounded-xl font-semibold cursor-pointer">📄 Generar Reporte PDF</button>
        </div>
        <div class="bg-slate-950/40 p-5 rounded-2xl border border-slate-800 space-y-4">
          <p class="text-xs text-slate-400">Escanee o seleccione el depósito para iniciar el levantamiento físico de mercancía en almacén.</p>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <select id="fisicoDeposito" class="bg-slate-900 border border-slate-800 rounded-xl p-3 text-white text-sm">
              <option value="PRINCIPAL">Depósito Principal</option>
              <option value="SECUNDARIO">Depósito Auxiliar</option>
            </select>
            <input type="text" id="fisicoSku" placeholder="SKU o Código de Barras" class="bg-slate-900 border border-slate-800 rounded-xl p-3 text-white text-sm font-mono">
            <input type="number" id="fisicoConteo" placeholder="Cantidad Contada" class="bg-slate-900 border border-slate-800 rounded-xl p-3 text-white text-sm font-mono">
          </div>
          <button onclick="registrarConteoFisico()" class="w-full bg-slate-800 hover:bg-slate-700 text-emerald-300 font-semibold py-3 rounded-xl text-sm border border-slate-700 cursor-pointer">Registrar Línea de Conteo</button>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs text-slate-300">
            <thead class="bg-slate-950 text-slate-400 uppercase font-mono">
              <tr><th class="p-3">SKU</th><th class="p-3">Descripción</th><th class="p-3">Stock Sistema</th><th class="p-3">Stock Físico</th><th class="p-3">Diferencia</th><th class="p-3">Estado</th></tr>
            </thead>
            <tbody id="tablaInventarioFisico" class="divide-y divide-slate-800/60"></tbody>
          </table>
        </div>
      </div>
    `;
  }
});

async function registrarConteoFisico() {
  const sku = document.getElementById('fisicoSku').value.trim();
  const conteo = parseFloat(document.getElementById('fisicoConteo').value);
  if (!sku || isNaN(conteo)) { alert('Ingrese un SKU y una cantidad válida.'); return; }

  const { error } = await supabaseClient.from('inventario_fisico').insert([{
    tenant_id: tenantActual.id,
    sku,
    cantidad_fisica: conteo,
    fecha: new Date().toISOString()
  }]);

  if (error) { alert('Error al registrar conteo: ' + error.message); return; }
  alert('¡Conteo físico registrado con éxito!');
  document.getElementById('fisicoSku').value = '';
  document.getElementById('fisicoConteo').value = '';
}

function generarReporteFisicoPdf() {
  window.print();
}
