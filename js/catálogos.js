/**
 * /js/catalogos.js
 * Módulo de Catálogos, CRUD de Artículos y Clientes, Márgenes, Unidades y Panel Multi-Tenant (2026)
 */

function calcularPrecioPorcentaje() {
  const costo = parseFloat(document.getElementById('prodCostoUsd').value) || 0;
  const margen = parseFloat(document.getElementById('prodMargen').value) || 0;
  const precioVenta = costo * (1 + (margen / 100));
  const inputVenta = document.getElementById('prodPrecioVentaUsd');
  if (inputVenta) inputVenta.value = precioVenta.toFixed(2);
}

async function guardarProducto() {
  const sku = document.getElementById('prodSku').value.trim().toUpperCase();
  const descripcion = document.getElementById('prodDescripcion').value.trim();
  const costo = parseFloat(document.getElementById('prodCostoUsd').value) || 0;
  const margen = parseFloat(document.getElementById('prodMargen').value) || 30;
  const precioVenta = parseFloat(document.getElementById('prodPrecioVentaUsd').value) || (costo * (1 + (margen/100)));
  const stock = parseFloat(document.getElementById('prodStock').value) || 0;
  const esExento = document.getElementById('prodExento').checked;
  const unidad = document.getElementById('prodUnidad').value.trim() || 'UND';
  const categoria = document.getElementById('prodCategoria').value.trim() || 'GENERAL';
  const ubicacion = document.getElementById('prodUbicacion').value.trim() || 'DEP-01';
  const lote = document.getElementById('prodLote').value.trim() || 'LOTE-01';

  if (!sku || !descripcion || costo <= 0) {
    alert('⚠️ Complete los campos obligatorios: SKU, Descripción y Costo Unitario.');
    return;
  }

  const payload = {
    tenant_id: tenantActual.id,
    codigo_sku: sku,
    descripcion: descripcion,
    costo_unitario_usd: costo,
    margen_utilidad_porcentaje: margen,
    precio_venta_usd: precioVenta,
    stock: stock,
    es_exento: esExento,
    unidad_medida: unidad,
    categoria: categoria,
    ubicacion: ubicacion,
    lote: lote,
    maneja_inventario: true
  };

  const prodId = document.getElementById('prodIdEditando')?.value;
  if (prodId) {
    await supabaseClient.from('productos').update(payload).eq('id', prodId);
    alert('¡Artículo actualizado con éxito!');
  } else {
    await supabaseClient.from('productos').insert([payload]);
    alert('¡Artículo registrado con éxito en el catálogo!');
  }

  limpiarFormProducto();
  if (typeof cargarProductosSelect === 'function') cargarProductosSelect();
}

function limpiarFormProducto() {
  const editId = document.getElementById('prodIdEditando');
  if (editId) editId.value = '';
  document.getElementById('prodSku').value = '';
  document.getElementById('prodDescripcion').value = '';
  document.getElementById('prodCostoUsd').value = '';
  document.getElementById('prodMargen').value = '30';
  document.getElementById('prodPrecioVentaUsd').value = '';
  document.getElementById('prodStock').value = '0';
  document.getElementById('prodExento').checked = false;
  document.getElementById('prodLote').value = '';
}

async function cargarClientesGestion() {
  const { data } = await supabaseClient.from('clientes').select('*').eq('tenant_id', tenantActual.id);
  const tbody = document.getElementById('tablaClientesGestion');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-500">Sin clientes registrados.</td></tr>`;
    return;
  }
  data.forEach(c => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900">
        <td class="p-3 font-mono font-bold text-emerald-400">${esc(c.rif)}</td>
        <td class="p-3">${esc(c.razon_social)}</td>
        <td class="p-3 text-slate-300">${esc(c.telefono||'N/A')}</td>
        <td class="p-3 text-slate-400">${esc(c.direccion||'N/A')}</td>
        <td class="p-3 text-center"><button onclick="alert('Cliente: ${esc(c.razon_social)}')" class="text-sky-400 hover:underline">Ver</button></td>
      </tr>
    `;
  });
}

async function cargarInquilinosMaster() {
  const esMaster = tenantActual.rol === 'master' || tenantActual.email === 'ervec2000@gmail.com';
  if (!esMaster) { alert('Acceso denegado. Solo el usuario Master puede gestionar inquilinos.'); return; }

  const { data } = await supabaseClient.from('tenants').select('*');
  const tbody = document.getElementById('tablaInquilinosMaster');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-500">Sin inquilinos registrados.</td></tr>`;
    return;
  }
  data.forEach(t => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900">
        <td class="p-3 font-mono font-bold text-white">${esc(t.razon_social)}</td>
        <td class="p-3 font-mono text-emerald-400">${esc(t.rif)}</td>
        <td class="p-3 text-slate-300">${esc(t.email)}</td>
        <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] bg-sky-950 text-sky-300">${esc(t.plan_activo||'Freemium')}</span></td>
        <td class="p-3 text-center"><span class="px-2 py-0.5 rounded text-[10px] ${t.activo?'bg-emerald-950 text-emerald-300':'bg-rose-950 text-rose-300'}">${t.activo?'Activo':'Inactivo'}</span></td>
        <td class="p-3 text-center"><button onclick="alert('Inquilino ID: ${t.id}')" class="text-sky-400 hover:underline">Gestionar</button></td>
      </tr>
    `;
  });
}