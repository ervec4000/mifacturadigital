/**
 * /js/catalogos.js
 * Módulo de Gestión de Catálogos (Proveedores, Clientes, Artículos y Unidades)
 */

async function cargarClientesSelect() {
  const select = document.getElementById('clienteSelect');
  if (!select) return;
  
  const { data, error } = await supabaseClient.from('clientes').select('*').eq('tenant_id', tenantActual.id);
  if (error) { console.error(error); return; }

  select.innerHTML = '<option value="">-- Seleccionar --</option>';
  (data || []).forEach(c => {
    select.innerHTML += `<option value="${esc(c.id)}" data-rif="${esc(c.rif)}" data-nombre="${esc(c.nombre)}">${esc(c.nombre)} (${esc(c.rif)})</option>`;
  });
}

function seleccionarClientePredefinido() {
  const select = document.getElementById('clienteSelect');
  const opt = select.options[select.selectedIndex];
  if (!opt.value) return;

  document.getElementById('clienteRif').value = opt.getAttribute('data-rif') || '';
  document.getElementById('clienteNombre').value = opt.getAttribute('data-nombre') || '';
}

// Renderizado de las secciones vacías en el DOM principal al cargar
document.addEventListener("DOMContentLoaded", () => {
  const secProveedores = document.getElementById('seccionProveedores');
  if (secProveedores) {
    secProveedores.innerHTML = `
      <div class="space-y-6">
        <h3 class="text-sm font-bold text-emerald-400 uppercase">🏭 Gestión de Proveedores y RIF</h3>
        <div class="bg-slate-950/40 p-5 rounded-2xl border border-slate-800 space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input type="text" id="provRif" placeholder="J-12345678-0" class="bg-slate-900 border border-slate-800 rounded-xl p-3 text-white text-sm font-mono">
            <input type="text" id="provNombre" placeholder="Razón Social del Proveedor" class="bg-slate-900 border border-slate-800 rounded-xl p-3 text-white text-sm">
            <button onclick="guardarProveedor()" class="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-sm cursor-pointer">Registrar Proveedor</button>
          </div>
        </div>
      </div>
    `;
  }

  const secRetenciones = document.getElementById('seccionRetenciones');
  if (secRetenciones) {
    secRetenciones.innerHTML = `
      <div class="space-y-6">
        <h3 class="text-sm font-bold text-emerald-400 uppercase">🧾 Retenciones de IVA (SENIAT)</h3>
        <div class="bg-slate-950/40 p-5 rounded-2xl border border-slate-800 text-xs text-slate-400">
          Módulo de control de comprobantes de retención de IVA a proveedores conforme al Decreto SENIAT vigente.
        </div>
      </div>
    `;
  }
});

async function guardarProveedor() {
  const rif = document.getElementById('provRif').value.trim();
  const nombre = document.getElementById('provNombre').value.trim();
  if (!rif || !nombre) { alert('Complete los campos del proveedor.'); return; }

  const { error } = await supabaseClient.from('proveedores').insert([{ tenant_id: tenantActual.id, rif, nombre }]);
  if (error) { alert('Error al guardar proveedor: ' + error.message); return; }
  alert('¡Proveedor registrado con éxito!');
  document.getElementById('provRif').value = '';
  document.getElementById('provNombre').value = '';
}
