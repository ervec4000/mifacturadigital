/**
 * /js/kardex.js
 * Módulo completo de Kardex PPM, Compras y Entradas al Almacén
 */

function formatearFecha8Digitos(fechaStr) {
  if (!fechaStr) return 'S/F';
  const d = new Date(fechaStr);
  if (isNaN(d)) return fechaStr;
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const anio = d.getFullYear();
  const hora = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dia}/${mes}/${anio} ${hora}:${min}`;
}

async function cargarKardexMovimientos() {
  if (!tenantActual) return;
  const [resMovs, resProds] = await Promise.all([
    supabaseClient.from('kardex_movimientos').select('*').eq('tenant_id', tenantActual.id).order('created_at', { ascending: false }),
    supabaseClient.from('productos').select('id, codigo_sku, descripcion').eq('tenant_id', tenantActual.id)
  ]);

  const tbody = document.getElementById('tablaKardexMovimientos');
  if (!tbody) return;
  tbody.innerHTML = '';

  const movimientos = resMovs.data || [];
  if (resMovs.error || movimientos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-slate-500">Sin movimientos en el Kardex.</td></tr>`;
    return;
  }

  const productosMap = {};
  if (resProds.data) { resProds.data.forEach(p => { productosMap[p.id] = p; }); }

  movimientos.forEach(m => {
    const prod = productosMap[m.producto_id];
    const nombreArticulo = prod ? `${esc(prod.codigo_sku || 'S/N')} - ${esc(prod.descripcion)}` : 'Artículo no encontrado';

    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/40">
        <td class="p-3 text-slate-400">${formatearFecha8Digitos(m.created_at)}</td>
        <td class="p-3 font-mono text-emerald-400">${nombreArticulo}</td>
        <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] ${m.tipo_movimiento==='ENTRADA'?'bg-emerald-950 text-emerald-300':'bg-rose-950 text-rose-300'}">${esc(m.tipo_movimiento)}</span></td>
        <td class="p-3 font-mono">${esc(m.documento_ref || 'S/REF')}</td>
        <td class="p-3 text-center text-emerald-400 font-bold">+${m.cantidad_in || 0}</td>
        <td class="p-3 text-center text-rose-400 font-bold">-${m.cantidad_out || 0}</td>
        <td class="p-3 text-center font-bold text-white">${m.saldo_cantidad}</td>
        <td class="p-3 font-mono text-emerald-300">$ ${(m.costo_promedio_usd || 0).toFixed(2)}</td>
      </tr>
    `;
  });
}

async function cargarProductosSelectCompra() {
  if (!tenantActual) return;
  const { data } = await supabaseClient.from('productos').select('*').eq('tenant_id', tenantActual.id);
  const sel = document.getElementById('compraProductoSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Seleccionar Producto --</option>';
  (data || []).forEach(p => {
    sel.innerHTML += `<option value="${p.id}">[${esc(p.codigo_sku||'S/N')}] ${esc(p.descripcion)}</option>`;
  });
}

async function cargarProveedoresSelectCompra() {
  if (!tenantActual) return;
  const { data } = await supabaseClient.from('proveedores').select('*').eq('tenant_id', tenantActual.id);
  const sel = document.getElementById('compraProveedorSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Seleccionar Proveedor --</option>';
  (data || []).forEach(p => {
    sel.innerHTML += `<option value="${p.id}">${esc(p.razon_social)} (${esc(p.rif)})</option>`;
  });
}

async function registrarCompraInventario() {
  const productoId = document.getElementById('compraProductoSelect').value;
  const cantidad = parseFloat(document.getElementById('compraCantidad').value) || 0;
  const costo = parseFloat(document.getElementById('compraCostoUsd').value) || 0;
  if (!productoId || cantidad <= 0 || costo <= 0) { alert('Complete los datos de la compra.'); return; }

  const { data: prodData } = await supabaseClient.from('productos').select('*').eq('id', productoId).single();
  const stockActual = prodData?.stock || 0;
  const nuevoStock = stockActual + cantidad;
  await supabaseClient.from('productos').update({ stock: nuevoStock, costo_unitario_usd: costo }).eq('id', productoId);

  await supabaseClient.from('kardex_movimientos').insert([{
    tenant_id: tenantActual.id, producto_id: productoId, tipo_movimiento: 'ENTRADA',
    documento_ref: 'COMPRA / ENTRADA ALMACÉN', cantidad_in: cantidad, cantidad_out: 0,
    saldo_cantidad: nuevoStock, costo_promedio_usd: costo, tasa_bcv: parseFloat(document.getElementById('tasaBcv').value) || 1
  }]);

  alert('¡Compra registrada e incluida en el Kardex con éxito!');
  cargarKardexMovimientos();
}
