/**
 * /js/kardex.js
 * Módulo de Control de Inventario y Kardex PPM
 */

document.addEventListener("DOMContentLoaded", () => {
  const secKardex = document.getElementById('seccionKardex');
  if (secKardex) {
    secKardex.innerHTML = `
      <div class="space-y-6">
        <h3 class="text-sm font-bold text-emerald-400 uppercase">📦 Kardex de Movimientos y Precio Promedio Ponderado (PPM)</h3>
        <div class="bg-slate-950/40 p-5 rounded-2xl border border-slate-800 space-y-4">
          <div class="flex gap-3">
            <input type="text" id="kardexFiltroSku" placeholder="Filtrar por SKU..." class="bg-slate-900 border border-slate-800 rounded-xl p-3 text-white text-sm font-mono w-72">
            <button onclick="cargarKardex()" class="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-4 py-2 rounded-xl font-semibold cursor-pointer">🔍 Consultar Kardex</button>
          </div>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs text-slate-300">
            <thead class="bg-slate-950 text-slate-400 uppercase font-mono">
              <tr><th class="p-3">Fecha</th><th class="p-3">SKU</th><th class="p-3">Operación</th><th class="p-3">Cantidad</th><th class="p-3">Costo Unit.</th><th class="p-3">PPM Actual</th></tr>
            </thead>
            <tbody id="tablaKardex" class="divide-y divide-slate-800/60"></tbody>
          </table>
        </div>
      </div>
    `;
  }
});

async function cargarKardex() {
  const tbody = document.getElementById('tablaKardex');
  if (!tbody) return;

  const { data, error } = await supabaseClient.from('kardex').select('*').eq('tenant_id', tenantActual.id).order('created_at', { ascending: false }).limit(50);
  if (error) { console.error(error); return; }

  tbody.innerHTML = '';
  (data || []).forEach(k => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900/50">
        <td class="p-3 font-mono">${new Date(k.created_at).toLocaleString()}</td>
        <td class="p-3 font-mono text-emerald-400">${esc(k.sku)}</td>
        <td class="p-3">${esc(k.tipo_operacion)}</td>
        <td class="p-3 font-mono">${esc(k.cantidad)}</td>
        <td class="p-3 font-mono">$ ${Number(k.costo_unitario || 0).toFixed(2)}</td>
        <td class="p-3 font-mono font-bold">$ ${Number(k.ppm || 0).toFixed(2)}</td>
      </tr>
    `;
  });
}
