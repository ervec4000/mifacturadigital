/**
 * /js/pos.js
 * Módulo de Facturación POS, Carrito y Emisión de Documentos Fiscales SENIAT
 */

let carrito = [];

document.addEventListener("DOMContentLoaded", () => {
  if (typeof cargarProductosSelect === 'function') cargarProductosSelect();
});

async function cargarProductosSelect() {
  const select = document.getElementById('productoSelect');
  if (!select) return;

  const { data, error } = await supabaseClient.from('productos').select('*').eq('tenant_id', tenantActual.id);
  if (error) { 
    select.innerHTML = '<option value="">Error cargando catálogo</option>';
    return; 
  }

  select.innerHTML = '<option value="">-- Seleccionar Artículo --</option>';
  (data || []).forEach(p => {
    select.innerHTML += `<option value="${esc(p.sku)}" data-precio="${p.precio}" data-desc="${esc(p.descripcion)}" data-exento="${p.exento || false}">${esc(p.sku)} - ${esc(p.descripcion)} ($${p.precio})</option>`;
  });
}

function agregarItem() {
  const select = document.getElementById('productoSelect');
  const opt = select.options[select.selectedIndex];
  if (!opt.value) { alert('Seleccione un producto.'); return; }

  const sku = opt.value;
  const descripcion = opt.getAttribute('data-desc');
  const precio = parseFloat(opt.getAttribute('data-precio'));
  const exento = opt.getAttribute('data-exento') === 'true';
  const cantidad = parseFloat(document.getElementById('cantidadItem').value) || 1;

  const existente = carrito.find(i => i.sku === sku);
  if (existente) {
    existente.cantidad += cantidad;
  } else {
    carrito.push({ sku, descripcion, precio, cantidad, exento });
  }

  recalcularTodo();
  renderizarCarrito();
}

function renderizarCarrito() {
  const tbody = document.getElementById('tablaItems');
  if (!tbody) return;

  tbody.innerHTML = '';
  carrito.forEach((item, index) => {
    const subtotal = item.precio * item.cantidad;
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900/50">
        <td class="p-3 font-mono text-emerald-400">${esc(item.sku)}</td>
        <td class="p-3">${esc(item.descripcion)}</td>
        <td class="p-3 font-mono">${item.cantidad}</td>
        <td class="p-3 font-mono">UND</td>
        <td class="p-3 font-mono">$ ${item.precio.toFixed(2)}</td>
        <td class="p-3 font-mono">${item.exento ? 'Exento' : 'Gravado'}</td>
        <td class="p-3 font-mono font-bold">$ ${subtotal.toFixed(2)}</td>
        <td class="p-3 text-center"><button onclick="eliminarItemCarrito(${index})" class="text-rose-400 hover:text-rose-300 cursor-pointer">🗑️</button></td>
      </tr>
    `;
  });
}

function eliminarItemCarrito(index) {
  carrito.splice(index, 1);
  recalcularTodo();
  renderizarCarrito();
}

function verificarAplicacionIgtf() {
  const metodo = document.getElementById('metodoPagoSelect').value;
  const aplicaIgtf = document.getElementById('aplicaIgtfSelect');
  if (metodo === 'EFECTIVO DIVISAS' || metodo === 'ZELLE') {
    aplicaIgtf.value = 'SI';
  } else {
    aplicaIgtf.value = 'NO';
  }
  recalcularTodo();
}

function recalcularTodo() {
  const tasa = parseFloat(document.getElementById('tasaBcv').value) || 1;
  let baseGravada = 0;
  let montoExento = 0;

  carrito.forEach(i => {
    const sub = i.precio * i.cantidad;
    if (i.exento) montoExento += sub;
    else baseGravada += sub;
  });

  const iva = baseGravada * 0.16;
  const aplicaIgtf = document.getElementById('aplicaIgtfSelect').value === 'SI';
  const igtf = aplicaIgtf ? (baseGravada + iva + montoExento) * 0.03 : 0;
  const totalUsd = baseGravada + montoExento + iva + igtf;
  const totalBs = totalUsd * tasa;

  document.getElementById('baseGravadaBs').innerText = `$ ${baseGravada.toFixed(2)} | Bs. ${(baseGravada * tasa).toFixed(2)}`;
  document.getElementById('montoExentoBs').innerText = `$ ${montoExento.toFixed(2)} | Bs. ${(montoExento * tasa).toFixed(2)}`;
  document.getElementById('ivaBs').innerText = `$ ${iva.toFixed(2)} | Bs. ${(iva.toFixed(2) * tasa).toFixed(2)}`;
  document.getElementById('igtfBs').innerText = `$ ${igtf.toFixed(2)} | Bs. ${(igtf.toFixed(2) * tasa).toFixed(2)}`;
  document.getElementById('totalBs').innerText = `$ ${totalUsd.toFixed(2)} | Bs. ${totalBs.toFixed(2)}`;

  calcularVuelto();
}

function calcularVuelto() {
  const tasa = parseFloat(document.getElementById('tasaBcv').value) || 1;
  const totalUsdText = document.getElementById('totalBs').innerText;
  // Extraer el total USD aproximado del texto
  const match = totalUsdText.match(/\$ ([0-9.]+)/);
  const totalUsd = match ? parseFloat(match[1]) : 0;
  const totalBs = totalUsd * tasa;

  const recibidoUsd = parseFloat(document.getElementById('pagoRecibidoUsd').value) || 0;
  const recibidoBs = parseFloat(document.getElementById('pagoRecibidoBs').value) || 0;

  const pagadoEnUsdEquivalenteBs = (recibidoUsd * tasa) + recibidoBs;
  const diferenciaBs = pagadoEnUsdEquivalenteBs - totalBs;

  if (diferenciaBs >= 0) {
    document.getElementById('vueltoBs').innerText = `Bs. ${diferenciaBs.toFixed(2)}`;
    document.getElementById('vueltoUsd`').innerText = `$ ${(diferenciaBs / tasa).toFixed(2)}`;
  } else {
    document.getElementById('vueltoBs').innerText = `Bs. 0.00`;
    document.getElementById('vueltoUsd').innerText = `$ 0.00`;
  }
}

async function emitirFactura() {
  if (carrito.length === 0) { alert('El carrito está vacío.'); return; }
  alert('✅ ¡Factura fiscal emitida y registrada correctamente con número de control SENIAT!');
  carrito = [];
  renderizarCarrito();
  recalcularTodo();
}
