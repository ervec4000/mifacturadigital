/**
 * /js/kardex.js
 * Módulo de Inventario PPM, Entradas por Compras, Kardex y Transferencias Multi-Depósito (SENIAT 2026)
 */

async function cargarProductosSelectCompra() {
  const { data } = await supabaseClient.from('productos').select('*').eq('tenant_id', tenantActual.id);
  const select = document.getElementById('compraProductoSelect');
  if (!select) return;
  select.innerHTML = '';
  if (!data) return;
  data.forEach(p => { 
    select.innerHTML += `<option value="${p.id}">${esc(p.descripcion)} [SKU: ${esc(p.codigo_sku||'S/N')} | Stock: ${p.stock||0}]</option>`; 
  });
}

async function cargarProveedoresSelectCompra() {
  const { data } = await supabaseClient.from('proveedores').select('*').eq('tenant_id', tenantActual.id);
  proveedoresCache = data || [];
  const select = document.getElementById('compraProveedorSelect');
  if (!select) return;
  select.innerHTML = '<option value="">-- Seleccionar Proveedor --</option>';
  proveedoresCache.forEach(p => {
    select.innerHTML += `<option value="${p.id}">${esc(p.razon_social)} (${esc(p.rif)})</option>`;
  });
}

function seleccionarProveedorCompra() {
  const provId = document.getElementById('compraProveedorSelect').value;
  const prov = proveedoresCache.find(x => x.id === provId);
  if (prov) {
    document.getElementById('compraProvRif').value = prov.rif || '';
    document.getElementById('compraProvNombre').value = prov.razon_social || '';
  }
}

async function registrarCompraInventario() {
  const productoId = document.getElementById('compraProductoSelect').value;
  const cantidad = parseFloat(document.getElementById('compraCantidad').value) || 0;
  const costo = parseFloat(document.getElementById('compraCostoUsd').value) || 0;
  const loteIngresado = document.getElementById('compraLote').value.trim();
  const docRef = document.getElementById('compraDocRef').value.trim() || 'FACT-001';
  const provRif = document.getElementById('compraProvRif').value.trim() || 'J-12345678-0';
  const provNombre = document.getElementById('compraProvNombre').value.trim() || 'PROVEEDOR C.A.';

  if (!productoId || cantidad <= 0 || costo <= 0) { alert('Complete los datos correctamente.'); return; }
  if (provRif && !validarRifVzla(provRif)) { alert('Formato de RIF de proveedor inválido.'); return; }
  
  try {
    const { data: prodData } = await supabaseClient.from('productos').select('*').eq('id', productoId).single();
    const stockActual = prodData ? (prodData.stock || 0) : 0;
    const costoActual = prodData ? (prodData.costo_unitario_usd || costo) : costo;
    const nuevoStock = stockActual + cantidad;
    const nuevoCostoProm = ((stockActual * costoActual) + (cantidad * costo)) / nuevoStock;
    const margen = prodData?.margen_utilidad_porcentaje || 30;
    const nuevoPrecioVenta = nuevoCostoProm * (1 + (margen / 100));

    await supabaseClient.from('productos').update({ 
      stock: nuevoStock, costo_unitario_usd: nuevoCostoProm, precio_venta_usd: nuevoPrecioVenta, lote: loteIngresado || prodData?.lote 
    }).eq('id', productoId);

    await supabaseClient.from('kardex_movimientos').insert([{
      tenant_id: tenantActual.id,
      producto_id: productoId,
      tipo_movimiento: 'ENTRADA',
      documento_ref: `${docRef} | ${provNombre} (${provRif})`,
      cantidad_in: cantidad,
      cantidad_out: 0,
      saldo_cantidad: nuevoStock,
      costo_promedio_usd: nuevoCostoProm,
      tasa_bcv: parseFloat(document.getElementById('tasaBcv').value) || 1
    }]);

    alert('¡Compra registrada e incluida en el Kardex y Libro de Compras!');
    cargarKardexMovimientos();
  } catch (err) { alert('Error: ' + err.message); }
}

async function cargarKardexMovimientos() {
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
      <tr class="hover:bg-slate-900">
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

async function cargarProductosSelectTransf() {
  const { data } = await supabaseClient.from('productos').select('*').eq('tenant_id', tenantActual.id);
  const select = document.getElementById('transfProductoSelect');
  if (!select) return;
  select.innerHTML = '';
  if (!data) return;
  data.forEach(p => { select.innerHTML += `<option value="${p.id}">${esc(p.descripcion)} [Stock: ${p.stock||0}]</option>`; });
}

async function registrarTransferenciaDeposito() {
  const prodId = document.getElementById('transfProductoSelect').value;
  const origen = document.getElementById('depOrigen').value.trim();
  const destino = document.getElementById('depDestino').value.trim();
  const cant = parseFloat(document.getElementById('transfCantidad').value) || 0;
  if (!prodId || cant <= 0) { alert('Seleccione artículo y cantidad válida.'); return; }

  const { data: prodData } = await supabaseClient.from('productos').select('*').eq('id', prodId).single();
  const stockActual = prodData?.stock || 0;
  if (cant > stockActual) { alert('Stock insuficiente en el depósito de origen.'); return; }

  await supabaseClient.from('kardex_movimientos').insert([{
    tenant_id: tenantActual.id, producto_id: prodId, tipo_movimiento: 'TRANSFERENCIA',
    documento_ref: `TRANSF: ${origen} ➡️ ${destino}`, cantidad_in: cant, cantidad_out: cant,
    saldo_cantidad: stockActual, costo_promedio_usd: prodData?.costo_unitario_usd || 1,
    tasa_bcv: parseFloat(document.getElementById('tasaBcv').value) || 1
  }]);

  alert(`¡Transferencia de ${cant} unidades desde "${origen}" hacia "${destino}" registrada con éxito!`);
  cargarKardexMovimientos();
}