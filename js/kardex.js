/**
 * /js/kardex.js
 * Módulo de Control de Inventario, Entradas y Kardex PPM
 */

async function cargarKardexMovimientos() {
  const { data } = await supabaseClient.from('kardex_movimientos').select('*').eq('tenant_id', tenantActual.id).order('created_at', { ascending: false });
  const tbody = document.getElementById('tablaKardexMovimientos');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-slate-500">Sin movimientos en el Kardex.</td></tr>`;
    return;
  }
  data.forEach(m => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900">
        <td class="p-3 text-slate-400">${new Date(m.created_at).toLocaleString()}</td>
        <td class="p-3 font-mono text-emerald-400">${esc(m.documento_ref)}</td>
        <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] ${m.tipo_movimiento==='ENTRADA'?'bg-emerald-950 text-emerald-300':'bg-rose-950 text-rose-300'}">${esc(m.tipo_movimiento)}</span></td>
        <td class="p-3 text-center text-emerald-400 font-bold">+${m.cantidad_in || 0}</td>
        <td class="p-3 text-center text-rose-400 font-bold">-${m.cantidad_out || 0}</td>
        <td class="p-3 text-center font-bold text-white">${m.saldo_cantidad}</td>
        <td class="p-3 font-mono text-emerald-300">$ ${(m.costo_promedio_usd || 0).toFixed(2)}</td>
      </tr>
    `;
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
