/**
 * /js/catalogos.js
 * Módulo de Gestión de Catálogos (Artículos, Clientes y Proveedores)
 */

async function cargarProductosGestion() {
  const { data } = await supabaseClient.from('productos').select('*').eq('tenant_id', tenantActual.id);
  const tbody = document.getElementById('tablaProductosGestion');
  if (!tbody) return;
  tbody.innerHTML = '';
  (data || []).forEach(prod => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900">
        <td class="p-3 font-mono text-emerald-400">${esc(prod.codigo_sku||'S/N')}</td>
        <td class="p-3">${esc(prod.descripcion)}</td>
        <td class="p-3">${prod.stock||0}</td>
        <td class="p-3 font-mono text-emerald-400 font-bold">$ ${(prod.precio_venta_usd||0).toFixed(2)}</td>
      </tr>
    `;
  });
}

async function guardarProducto() {
  const payload = {
    codigo_sku: document.getElementById('prodSku').value.trim(),
    descripcion: document.getElementById('prodDescripcion').value.trim().toUpperCase(),
    precio_venta_usd: parseFloat(document.getElementById('prodPrecioVenta').value) || 0,
    stock: parseFloat(document.getElementById('prodStock').value) || 0,
    tenant_id: tenantActual.id
  };
  await supabaseClient.from('productos').insert([payload]);
  alert('¡Artículo guardado con éxito!');
  cargarProductosGestion();
}
