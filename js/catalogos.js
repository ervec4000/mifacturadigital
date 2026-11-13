/**
 * /js/catalogos.js
 * Módulo de Gestión de Artículos, Clientes, Proveedores y Unidades
 */

async function cargarProductosGestion() {
  if (!tenantActual) return;
  const { data } = await supabaseClient.from('productos').select('*').eq('tenant_id', tenantActual.id);
  const tbody = document.getElementById('tablaProductosGestion');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!data || data.length === 0) { tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-500">Sin artículos.</td></tr>`; return; }
  data.forEach(prod => {
    const pv = prod.precio_venta_usd || prod.precio_unitario_usd || 0;
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/40">
        <td class="p-3 font-mono text-emerald-400 font-bold">${esc(prod.codigo_sku||'S/N')}</td>
        <td class="p-3">${esc(prod.descripcion)}</td>
        <td class="p-3 font-mono">${prod.stock||0}</td>
        <td class="p-3 font-mono text-emerald-300 font-bold">$ ${pv.toFixed(2)}</td>
      </tr>
    `;
  });
}

async function guardarProducto() {
  const sku = document.getElementById('prodSku').value.trim();
  const descripcion = document.getElementById('prodDescripcion').value.trim().toUpperCase();
  const precioVenta = parseFloat(document.getElementById('prodPrecioVenta').value) || 0;
  const stock = parseFloat(document.getElementById('prodStock').value) || 0;
  if (!descripcion || precioVenta <= 0) { alert('Ingrese descripción y precio.'); return; }

  await supabaseClient.from('productos').insert([{
    tenant_id: tenantActual.id, codigo_sku: sku || ('SKU-' + Math.floor(Math.random()*90000+10000)),
    descripcion, precio_venta_usd: precioVenta, stock, es_exento: false, maneja_inventario: true
  }]);
  alert('¡Artículo guardado!');
  document.getElementById('prodSku').value = '';
  document.getElementById('prodDescripcion').value = '';
  document.getElementById('prodPrecioVenta').value = '';
  document.getElementById('prodStock').value = '';
  cargarProductosGestion();
}

async function cargarClientesGestion() {
  if (!tenantActual) return;
  const { data } = await supabaseClient.from('clientes').select('*').eq('tenant_id', tenantActual.id);
  const tbody = document.getElementById('tablaClientes');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!data || data.length === 0) { tbody.innerHTML = `<tr><td colspan="3" class="p-4 text-center text-slate-500">Sin clientes.</td></tr>`; return; }
  data.forEach(c => {
    tbody.innerHTML += `<tr class="hover:bg-slate-900 border-b border-slate-800/40"><td class="p-3 font-mono text-emerald-400">${esc(c.rif)}</td><td class="p-3">${esc(c.nombre)}</td><td class="p-3 font-mono">${esc(c.telefono||'N/A')}</td></tr>`;
  });
}

async function cargarProveedoresGestion() {
  if (!tenantActual) return;
  const { data } = await supabaseClient.from('proveedores').select('*').eq('tenant_id', tenantActual.id);
  const tbody = document.getElementById('tablaProveedores');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!data || data.length === 0) { tbody.innerHTML = `<tr><td colspan="3" class="p-4 text-center text-slate-500">Sin proveedores registrados.</td></tr>`; return; }
  data.forEach(p => {
    tbody.innerHTML += `<tr class="hover:bg-slate-900 border-b border-slate-800/40"><td class="p-3 font-mono text-emerald-400">${esc(p.rif)}</td><td class="p-3">${esc(p.razon_social)}</td><td class="p-3 font-mono">${esc(p.telefono||'N/A')}</td></tr>`;
  });
}

async function cargarUnidadesMedidaGestion() {
  const tbody = document.getElementById('tablaUnidadesMedida');
  if (!tbody) return;
  tbody.innerHTML = `
    <tr class="hover:bg-slate-900 border-b border-slate-800/40"><td class="p-3 font-mono text-emerald-400">UND</td><td class="p-3">Unidad</td></tr>
    <tr class="hover:bg-slate-900 border-b border-slate-800/40"><td class="p-3 font-mono text-emerald-400">KG</td><td class="p-3">Kilogramos</td></tr>
    <tr class="hover:bg-slate-900 border-b border-slate-800/40"><td class="p-3 font-mono text-emerald-400">LTS</td><td class="p-3">Litros</td></tr>
  `;
}

function cargarDatosReferidos() {
  if (!tenantActual) return;
  const linkInput = document.getElementById('linkReferidoInput');
  if (linkInput) linkInput.value = `https://mifacturadigital.com.ve/register?ref=${tenantActual.id}`;
}

async function cargarInquilinosMaster() {
  if (!tenantActual || (tenantActual.rol !== 'master' && tenantActual.email !== 'ervec2000@gmail.com')) return;
  const { data } = await supabaseClient.from('tenants').select('*');
  const tbody = document.getElementById('tablaInquilinosMaster');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!data || data.length === 0) { tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-500">Sin inquilinos.</td></tr>`; return; }
  data.forEach(t => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/40">
        <td class="p-3 text-white font-bold">${esc(t.razon_social||'S/N')}</td>
        <td class="p-3 font-mono text-slate-300">${esc(t.email)}</td>
        <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] bg-emerald-950 text-emerald-300">${esc(t.plan_activo||'Freemium')}</span></td>
        <td class="p-3 uppercase font-mono text-amber-400">${esc(t.rol||'tenant')}</td>
      </tr>
    `;
  });
}
