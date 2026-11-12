/**
 * /js/pos.js
 * Módulo de Facturación POS, Carrito y Emisión de Comprobantes Fiscales SENIAT
 */

let carritoItems = [];

async function consultarTasaBcvApi() {
  try {
    const res = await fetch('https://pydolarvenezuela-api.valtx.workers.dev/api/v1/dollar/bcv');
    const json = await res.json();
    if (json?.monitors?.usd?.price) {
      document.getElementById('tasaBcv').value = parseFloat(json.monitors.usd.price).toFixed(4);
      recalcularTodo();
      alert('¡Tasa BCV oficial actualizada con éxito!');
      return;
    }
  } catch (e) { console.warn('Falla de red en API:', e); }
  alert('⚠️ Ingrese la tasa BCV manualmente.');
}

async function cargarProductosSelect() {
  const { data } = await supabaseClient.from('productos').select('*').eq('tenant_id', tenantActual.id);
  productosCache = data || [];
  const select = document.getElementById('productoSelect');
  if (!select) return;
  select.innerHTML = '<option value="">-- Seleccionar Artículo --</option>';
  productosCache.forEach(prod => {
    const pv = prod.precio_venta_usd || prod.precio_unitario_usd || 0;
    select.innerHTML += `<option value="${prod.id}" data-precio="${pv}" data-exento="${prod.es_exento}" data-unidad="${esc(prod.unidad_medida||'UND')}" data-stock="${prod.stock||0}" data-maneja="${prod.maneja_inventario}">[${esc(prod.codigo_sku||'S/N')}] ${esc(prod.descripcion)} - P.V: $${pv.toFixed(2)}</option>`;
  });
}

function agregarItem() {
  const select = document.getElementById('productoSelect');
  const prodId = select.value;
  if (!prodId) { alert('Seleccione un producto.'); return; }
  const opt = select.options[select.selectedIndex];
  const desc = opt.text;
  const precio = parseFloat(opt.dataset.precio) || 0;
  const esExento = opt.dataset.exento === 'true';
  const unidad = opt.dataset.unidad || 'UND';
  const manejaInventario = opt.dataset.maneja === 'true';
  const cantidad = parseFloat(document.getElementById('cantidadItem').value) || 1;

  const itemExistente = carritoItems.find(i => i.productoId === prodId);
  if (itemExistente) {
    itemExistente.cantidad += cantidad;
  } else {
    carritoItems.push({ productoId: prodId, sku: 'S/N', descripcion: desc, precio, cantidad, esExento, unidad, manejaInventario });
  }
  actualizarTablaYCalculos();
}

function eliminarItemCarrito(index) {
  carritoItems.splice(index, 1);
  actualizarTablaYCalculos();
}

function actualizarTablaYCalculos() {
  const tbody = document.getElementById('tablaItems');
  if (!tbody) return;
  tbody.innerHTML = '';
  let baseGravada = 0, montoExento = 0;

  carritoItems.forEach((item, idx) => {
    const sub = item.precio * item.cantidad;
    if (item.esExento) montoExento += sub; else baseGravada += sub;
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900">
        <td class="p-3 font-mono text-emerald-400">${esc(item.sku)}</td>
        <td class="p-3">${esc(item.descripcion)}</td>
        <td class="p-3 font-mono">${item.cantidad}</td>
        <td class="p-3">${esc(item.unidad)}</td>
        <td class="p-3 font-mono">$ ${item.precio.toFixed(2)}</td>
        <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] ${item.esExento?'bg-sky-950 text-sky-300':'bg-emerald-950 text-emerald-300'}">${item.esExento?'Exento':'Gravado'}</span></td>
        <td class="p-3 font-mono font-bold">$ ${sub.toFixed(2)}</td>
        <td class="p-3 text-center"><button onclick="eliminarItemCarrito(${idx})" class="text-rose-400 hover:underline">Quitar</button></td>
      </tr>
    `;
  });

  const tasa = parseFloat(document.getElementById('tasaBcv').value) || 1;
  const iva = baseGravada * 0.16;
  const aplicaIgtf = document.getElementById('aplicaIgtfSelect').value === 'SI';
  const igtf = aplicaIgtf ? (baseGravada + montoExento + iva) * 0.03 : 0;
  const totalUsd = baseGravada + montoExento + iva + igtf;

  document.getElementById('baseGravadaBs').innerText = `$ ${baseGravada.toFixed(2)} | Bs. ${(baseGravada*tasa).toFixed(2)}`;
  document.getElementById('montoExentoBs').innerText = `$ ${montoExento.toFixed(2)} | Bs. ${(montoExento*tasa).toFixed(2)}`;
  document.getElementById('ivaBs').innerText = `$ ${iva.toFixed(2)} | Bs. ${(iva*tasa).toFixed(2)}`;
  document.getElementById('igtfBs').innerText = `$ ${igtf.toFixed(2)} | Bs. ${(igtf*tasa).toFixed(2)}`;
  document.getElementById('totalBs').innerText = `$ ${totalUsd.toFixed(2)} | Bs. ${(totalUsd*tasa).toFixed(2)}`;
  calcularVuelto();
}

function recalcularTodo() { actualizarTablaYCalculos(); }

function verificarAplicacionIgtf() {
  const metodo = document.getElementById('metodoPagoSelect').value;
  const selectIgtf = document.getElementById('aplicaIgtfSelect');
  if (metodo === 'EFECTIVO DIVISAS' || metodo === 'ZELLE') selectIgtf.value = 'SI';
  else selectIgtf.value = 'NO';
  recalcularTodo();
}

function calcularVuelto() {
  const tasa = parseFloat(document.getElementById('tasaBcv').value) || 1;
  const totalUsdText = document.getElementById('totalBs').innerText;
  const totalUsd = parseFloat(totalUsdText.split('|')[0].replace('$', '').trim()) || 0;
  const totalBs = totalUsd * tasa;

  const recUsd = parseFloat(document.getElementById('pagoRecibidoUsd').value) || 0;
  const recBs = parseFloat(document.getElementById('pagoRecibidoBs').value) || 0;
  const totalRecibidoBs = (recUsd * tasa) + recBs;

  const diffBs = totalRecibidoBs - totalBs;
  if (diffBs >= 0) {
    document.getElementById('vueltoBs').innerText = `Bs. ${diffBs.toFixed(2)}`;
    document.getElementById('vueltoUsd').innerText = `$ ${(diffBs / tasa).toFixed(2)}`;
  } else {
    document.getElementById('vueltoBs').innerText = `Bs. 0.00`;
    document.getElementById('vueltoUsd').innerText = `$ 0.00`;
  }
}

async function emitirFactura() {
  if (carritoItems.length === 0) { alert('Carrito vacío.'); return; }
  const rif = document.getElementById('clienteRif').value.trim();
  const nombre = document.getElementById('clienteNombre').value.trim();
  if (!rif || !nombre) { alert('Ingrese datos del cliente.'); return; }

  const tasa = parseFloat(document.getElementById('tasaBcv').value) || 1;
  const { count } = await supabaseClient.from('invoices').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantActual.id);
  const correlativoNum = (count || 0) + 1;
  const facturaNro = 'FAC-' + String(correlativoNum).padStart(4, '0');
  const nroControl = '00-' + String(75000 + correlativoNum).padStart(8, '0');

  let baseUsd = 0, exentoUsd = 0;
  carritoItems.forEach(i => { if(i.esExento) exentoUsd += i.precio*i.cantidad; else baseUsd += i.precio*i.cantidad; });
  const subtotalBs = baseUsd * tasa;
  const exentoBs = exentoUsd * tasa;
  const ivaBs = baseUsd * tasa * 0.16;
  const aplicaIgtf = document.getElementById('aplicaIgtfSelect').value === 'SI';
  const igtfBs = aplicaIgtf ? (subtotalBs + exentoBs + ivaBs) * 0.03 : 0;
  const totalBs = subtotalBs + exentoBs + ivaBs + igtfBs;

  const { data: invData } = await supabaseClient.from('invoices').insert([{
    tenant_id: tenantActual.id, factura_nro: facturaNro, nro_control: nroControl,
    tasa_bcv: tasa, monto_usd: baseUsd + exentoUsd, subtotal_bs: subtotalBs + exentoBs,
    iva_bs: ivaBs, igtf_bs: igtfBs, total_bs: totalBs, cliente_rif: rif,
    cliente_nombre: nombre, metodo_pago: document.getElementById('metodoPagoSelect').value
  }]).select();

  const invoiceId = invData[0].id;
  for (const item of carritoItems) {
    await supabaseClient.from('invoice_items').insert([{
      invoice_id: invoiceId, producto_id: item.productoId, cantidad: item.cantidad,
      precio_unitario_usd: item.precio, es_exento: item.esExento, subtotal_usd: item.precio * item.cantidad,
      descripcion: item.descripcion
    }]);

    if (item.manejaInventario) {
      const { data: pData } = await supabaseClient.from('productos').select('*').eq('id', item.productoId).single();
      const nuevoStock = Math.max(0, (pData?.stock || 0) - item.cantidad);
      await supabaseClient.from('productos').update({ stock: nuevoStock }).eq('id', item.productoId);
      await supabaseClient.from('kardex_movimientos').insert([{
        tenant_id: tenantActual.id, producto_id: item.productoId, tipo_movimiento: 'SALIDA',
        documento_ref: facturaNro, cantidad_in: 0, cantidad_out: item.cantidad,
        saldo_cantidad: nuevoStock, costo_promedio_usd: pData?.costo_unitario_usd || 1, tasa_bcv: tasa
      }]);
    }
  }

  alert(`¡Factura ${facturaNro} emitida con éxito!`);
  carritoItems = [];
  actualizarTablaYCalculos();
  cambiarPestana('historial');
}
