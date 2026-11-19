/**
 * /js/kardex.js
 * Módulo completo de Compras Multi-Artículo (con Fecha, Tasa BCV, Factura, Nro. Control,
 * Documento Auto-generado y Enlace Sucursal -> Almacén -> Material -> Lote y Vencimiento)
 * y Kardex PPM.
 */

let carritoCompraItems = [];
let compraProductosCache = [];
let compraProveedoresCache = [];
let compraSucursalesCache = [];
let compraAlmacenesCache = [];
let compraLotesCache = [];
let compraProximoNroDoc = 'COMP-0001';

function avisarKardex(mensaje, tipo = 'info', duracion = 5000) {
  if (typeof notificarSistema === 'function') {
    notificarSistema(mensaje, tipo, duracion);
  } else {
    console.log(`[${tipo}]`, mensaje);
  }
}

function obtenerTenantKardex() {
  return tenantActual ? (tenantActual.id || tenantActual.tenant_id || null) : null;
}

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

async function inicializarModuloCompras() {
  const tenantId = obtenerTenantKardex();
  if (!tenantId) return;

  const inputFecha = document.getElementById('compraFecha');
  if (inputFecha && !inputFecha.value) {
    inputFecha.value = new Date().toISOString().slice(0, 10);
  }

  const tasaPos = parseFloat(document.getElementById('tasaBcv')?.value) || 0;
  const inputTasa = document.getElementById('compraTasaBcv');
  if (inputTasa && tasaPos > 0) {
    inputTasa.value = tasaPos.toFixed(4);
  }

  await Promise.all([
    cargarProductosSelectCompra(),
    cargarProveedoresSelectCompra(),
    cargarSucursalesYAlmacenesCompra(),
    cargarLotesExistentesCompra(),
    calcularProximoDocumentoCompra(),
    cargarHistorialCompras(),
    consultarTasaBcvCompra(true)
  ]);

  renderizarTablaItemsCompra();
}

async function consultarTasaBcvCompra(silencioso = false) {
  try {
    const url = silencioso ? '/api/tasa-bcv' : '/api/tasa-bcv?force=1';
    const res = await fetch(url);
    const json = await res.json();
    if (json?.ok && Number(json.usd) > 0) {
      const tasa = Number(json.usd).toFixed(4);
      const inputCompra = document.getElementById('compraTasaBcv');
      const inputPos = document.getElementById('tasaBcv');
      if (inputCompra) inputCompra.value = tasa;
      if (inputPos) inputPos.value = tasa;
      recalcularTotalesCompra();
      if (!silencioso) {
        avisarKardex(`Tasa BCV actualizada a Bs. ${tasa} (${json.fuente}${json.fechaValor ? ' - ' + json.fechaValor : ''})`, 'success', 6500);
      }
      return true;
    }
  } catch (e) {
    console.warn('Falla de red al consultar /api/tasa-bcv:', e);
  }
  if (!silencioso) {
    avisarKardex('No se pudo consultar la página del BCV. Ingresa la tasa manualmente.', 'warning');
  }
  return false;
}

async function calcularProximoDocumentoCompra() {
  const tenantId = obtenerTenantKardex();
  if (!tenantId) return 'COMP-0001';

  const { data } = await supabaseClient
    .from('kardex_movimientos')
    .select('documento_ref')
    .eq('tenant_id', tenantId)
    .eq('tipo_movimiento', 'ENTRADA');

  let maxNum = 0;
  (data || []).forEach(row => {
    const match = String(row.documento_ref || '').match(/COMP-(\d+)/i);
    if (match) {
      const n = parseInt(match[1], 10);
      if (Number.isFinite(n) && n > maxNum) maxNum = n;
    }
  });

  compraProximoNroDoc = 'COMP-' + String(maxNum + 1).padStart(4, '0');
  const badge = document.getElementById('compraProximoDoc');
  if (badge) badge.textContent = compraProximoNroDoc;
  return compraProximoNroDoc;
}

async function cargarProductosSelectCompra() {
  const tenantId = obtenerTenantKardex();
  if (!tenantId) return;
  const { data } = await supabaseClient
    .from('productos')
    .select('*, tipos_iva(id, nombre, porcentaje)')
    .eq('tenant_id', tenantId)
    .order('descripcion', { ascending: true });

  compraProductosCache = data || [];
  const sel = document.getElementById('compraProductoSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Seleccionar Material --</option>';
  compraProductosCache.forEach(p => {
    const uni = p.unidad_medida ? ` ${p.unidad_medida}` : '';
    sel.innerHTML += `<option value="${esc(p.id)}">[${esc(p.codigo_sku || 'S/N')}] ${esc(p.descripcion)} (Stock: ${p.stock ?? 0}${esc(uni)})</option>`;
  });
}

async function cargarProveedoresSelectCompra() {
  const tenantId = obtenerTenantKardex();
  if (!tenantId) return;
  const { data } = await supabaseClient
    .from('proveedores')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('razon_social', { ascending: true });

  compraProveedoresCache = data || [];
  const sel = document.getElementById('compraProveedorSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Seleccionar Proveedor --</option>';
  compraProveedoresCache.forEach(p => {
    sel.innerHTML += `<option value="${esc(p.id)}">${esc(p.razon_social)} (${esc(p.rif)})</option>`;
  });
}

async function cargarSucursalesYAlmacenesCompra() {
  const tenantId = obtenerTenantKardex();
  if (!tenantId) return;

  const [resSuc, resAlm] = await Promise.all([
    supabaseClient.from('sucursales').select('*').eq('tenant_id', tenantId).order('nombre', { ascending: true }),
    supabaseClient.from('almacenes').select('*, sucursales(nombre)').eq('tenant_id', tenantId).order('nombre', { ascending: true })
  ]);

  compraSucursalesCache = resSuc.data || [];
  compraAlmacenesCache = resAlm.data || [];

  const selSuc = document.getElementById('compraSucursalSelect');
  if (selSuc) {
    const prevSuc = selSuc.value;
    selSuc.innerHTML = '<option value="">-- Seleccionar Sucursal --</option>';
    compraSucursalesCache.forEach(s => {
      selSuc.innerHTML += `<option value="${esc(s.id)}">${esc(s.nombre)}</option>`;
    });
    if (prevSuc && compraSucursalesCache.some(s => String(s.id) === String(prevSuc))) {
      selSuc.value = prevSuc;
    } else if (compraSucursalesCache.length === 1) {
      selSuc.value = compraSucursalesCache[0].id;
    }
  }

  filtrarAlmacenesPorSucursalCompra();
}

function filtrarAlmacenesPorSucursalCompra() {
  const selSuc = document.getElementById('compraSucursalSelect');
  const selAlm = document.getElementById('compraAlmacenSelect');
  if (!selAlm) return;

  const sucursalId = selSuc ? selSuc.value : '';
  const prevAlm = selAlm.value;

  const filtrados = sucursalId
    ? compraAlmacenesCache.filter(a => String(a.sucursal_id || '') === String(sucursalId))
    : compraAlmacenesCache;

  selAlm.innerHTML = '<option value="">-- Seleccionar Almacén --</option>';
  filtrados.forEach(a => {
    const sucTag = !sucursalId && a.sucursales?.nombre ? `[${a.sucursales.nombre}] ` : '';
    selAlm.innerHTML += `<option value="${esc(a.id)}">${esc(sucTag)}${esc(a.nombre)} (${esc(a.tipo || 'PRINCIPAL')})</option>`;
  });

  if (prevAlm && filtrados.some(a => String(a.id) === String(prevAlm))) {
    selAlm.value = prevAlm;
  } else if (filtrados.length === 1) {
    selAlm.value = filtrados[0].id;
  }

  cargarLotesSugeridosCompra();
}

async function cargarLotesExistentesCompra() {
  const tenantId = obtenerTenantKardex();
  if (!tenantId) return;
  const { data } = await supabaseClient
    .from('inventario_lotes')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  compraLotesCache = data || [];
  cargarLotesSugeridosCompra();
}

function onSeleccionarProductoCompra() {
  const prodId = document.getElementById('compraProductoSelect')?.value;
  const prod = compraProductosCache.find(p => String(p.id) === String(prodId));
  if (prod) {
    const inputCosto = document.getElementById('compraCostoUsd');
    const inputUbi = document.getElementById('compraUbicacion');
    if (inputCosto) inputCosto.value = Number(prod.costo_unitario_usd ?? 1).toFixed(2);
    if (inputUbi && !inputUbi.value) inputUbi.value = prod.ubicacion || '';
  }
  cargarLotesSugeridosCompra();
}

function cargarLotesSugeridosCompra() {
  const datalist = document.getElementById('datalistLotesCompra');
  if (!datalist) return;
  const prodId = document.getElementById('compraProductoSelect')?.value;
  const almId = document.getElementById('compraAlmacenSelect')?.value;

  const filtrados = compraLotesCache.filter(l => {
    const matchProd = !prodId || String(l.producto_id) === String(prodId);
    const matchAlm = !almId || !l.almacen_id || String(l.almacen_id) === String(almId);
    return matchProd && matchAlm;
  });

  datalist.innerHTML = '';
  filtrados.forEach(l => {
    const labelVenc = l.fecha_vencimiento ? `Vence: ${l.fecha_vencimiento}` : 'Sin vencimiento';
    datalist.innerHTML += `<option value="${esc(l.numero_lote)}">${esc(labelVenc)} (Stock: ${l.stock ?? 0})</option>`;
  });
}

function autocompletarVencimientoLoteCompra() {
  const loteTxt = (document.getElementById('compraLote')?.value || '').trim().toUpperCase();
  const prodId = document.getElementById('compraProductoSelect')?.value;
  const almId = document.getElementById('compraAlmacenSelect')?.value;
  if (!loteTxt) return;

  const match = compraLotesCache.find(l =>
    String(l.numero_lote || '').toUpperCase() === loteTxt &&
    (!prodId || String(l.producto_id) === String(prodId)) &&
    (!almId || !l.almacen_id || String(l.almacen_id) === String(almId))
  );

  if (match) {
    const inputVenc = document.getElementById('compraFechaVencimiento');
    const inputUbi = document.getElementById('compraUbicacion');
    if (inputVenc && match.fecha_vencimiento) inputVenc.value = match.fecha_vencimiento;
    if (inputUbi && match.ubicacion) inputUbi.value = match.ubicacion;
  }
}

function agregarItemCompra() {
  const sucursalId = document.getElementById('compraSucursalSelect')?.value || '';
  const almacenId = document.getElementById('compraAlmacenSelect')?.value || '';
  const productoId = document.getElementById('compraProductoSelect')?.value || '';
  const cantidad = parseFloat(document.getElementById('compraCantidad')?.value) || 0;
  const costoUsd = parseFloat(document.getElementById('compraCostoUsd')?.value) || 0;
  const lote = (document.getElementById('compraLote')?.value || '').trim().toUpperCase();
  const fechaVencimiento = document.getElementById('compraFechaVencimiento')?.value || null;
  const ubicacion = (document.getElementById('compraUbicacion')?.value || '').trim().toUpperCase();

  if (!sucursalId) { avisarKardex('Selecciona la Sucursal destino de la compra.', 'warning'); return; }
  if (!almacenId) { avisarKardex('Selecciona el Almacén destino de la compra.', 'warning'); return; }
  if (!productoId) { avisarKardex('Selecciona un Material / Producto.', 'warning'); return; }
  if (cantidad <= 0 || costoUsd <= 0) { avisarKardex('Cantidad y Costo Unitario deben ser mayores a 0.', 'warning'); return; }
  if (!lote) { avisarKardex('Ingresa o selecciona el Número de Lote del material.', 'warning'); return; }

  const prod = compraProductosCache.find(p => String(p.id) === String(productoId));
  const suc = compraSucursalesCache.find(s => String(s.id) === String(sucursalId));
  const alm = compraAlmacenesCache.find(a => String(a.id) === String(almacenId));
  if (!prod) { avisarKardex('Producto no encontrado en caché.', 'error'); return; }

  const ivaPorcentaje = prod.tipos_iva ? Number(prod.tipos_iva.porcentaje ?? 16) : 16;
  const ivaNombre = prod.tipos_iva ? `${prod.tipos_iva.nombre} (${ivaPorcentaje}%)` : `IVA (${ivaPorcentaje}%)`;

  const existente = carritoCompraItems.find(i =>
    String(i.productoId) === String(productoId) &&
    String(i.almacenId) === String(almacenId) &&
    i.lote === lote &&
    Number(i.costoUsd) === Number(costoUsd)
  );

  if (existente) {
    existente.cantidad += cantidad;
    if (fechaVencimiento) existente.fechaVencimiento = fechaVencimiento;
    if (ubicacion) existente.ubicacion = ubicacion;
  } else {
    carritoCompraItems.push({
      productoId,
      sku: prod.codigo_sku || 'S/N',
      descripcion: prod.descripcion,
      unidad: prod.unidad_medida || 'UND',
      sucursalId,
      sucursalNombre: suc?.nombre || 'Sucursal',
      almacenId,
      almacenNombre: alm?.nombre || 'Almacén',
      lote,
      fechaVencimiento,
      ubicacion,
      cantidad,
      costoUsd,
      ivaPorcentaje,
      ivaNombre
    });
  }

  document.getElementById('compraCantidad').value = '1';
  document.getElementById('compraLote').value = '';
  document.getElementById('compraFechaVencimiento').value = '';
  document.getElementById('compraUbicacion').value = '';

  renderizarTablaItemsCompra();
}

function quitarItemCompra(index) {
  carritoCompraItems.splice(index, 1);
  renderizarTablaItemsCompra();
}

function renderizarTablaItemsCompra() {
  const tbody = document.getElementById('tablaItemsCompra');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (carritoCompraItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-slate-500">Agrega uno o más materiales arriba para armar el documento de compra.</td></tr>`;
    recalcularTotalesCompra();
    return;
  }

  const tasa = parseFloat(document.getElementById('compraTasaBcv')?.value) || 1;

  carritoCompraItems.forEach((item, idx) => {
    const subUsd = item.cantidad * item.costoUsd;
    const badgeIva = item.ivaPorcentaje === 0
      ? `<span class="px-2 py-0.5 rounded text-[10px] bg-sky-950 text-sky-300">${esc(item.ivaNombre)}</span>`
      : `<span class="px-2 py-0.5 rounded text-[10px] bg-emerald-950 text-emerald-300">${esc(item.ivaNombre)}</span>`;

    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/40">
        <td class="p-3">
          <div class="font-bold text-white">[${esc(item.sku)}] ${esc(item.descripcion)}</div>
          <div class="text-[11px] text-slate-400">Unidad: ${esc(item.unidad)}${item.ubicacion ? ' | Ubic: ' + esc(item.ubicacion) : ''}</div>
        </td>
        <td class="p-3 text-slate-300">${esc(item.sucursalNombre)} → <span class="text-sky-300 font-semibold">${esc(item.almacenNombre)}</span></td>
        <td class="p-3 font-mono">
          <div class="text-emerald-400 font-bold">${esc(item.lote)}</div>
          <div class="text-[11px] text-slate-400">${item.fechaVencimiento ? 'Venc: ' + esc(item.fechaVencimiento) : 'Sin venc.'}</div>
        </td>
        <td class="p-3 text-center font-mono font-bold text-white">${item.cantidad}</td>
        <td class="p-3 font-mono">$ ${item.costoUsd.toFixed(2)}</td>
        <td class="p-3">${badgeIva}</td>
        <td class="p-3 font-mono font-bold text-emerald-400">$ ${subUsd.toFixed(2)}<div class="text-[11px] text-slate-400">Bs. ${(subUsd * tasa).toFixed(2)}</div></td>
        <td class="p-3 text-center"><button type="button" onclick="quitarItemCompra(${idx})" class="text-rose-400 hover:underline font-semibold cursor-pointer">Quitar</button></td>
      </tr>
    `;
  });

  recalcularTotalesCompra();
}

function recalcularTotalesCompra() {
  const tasa = parseFloat(document.getElementById('compraTasaBcv')?.value) || 1;
  let baseGravadaUsd = 0;
  let montoExentoUsd = 0;
  let ivaUsd = 0;

  carritoCompraItems.forEach(item => {
    const sub = item.cantidad * item.costoUsd;
    if (Number(item.ivaPorcentaje) === 0) {
      montoExentoUsd += sub;
    } else {
      baseGravadaUsd += sub;
      ivaUsd += sub * (Number(item.ivaPorcentaje) / 100);
    }
  });

  const totalUsd = baseGravadaUsd + montoExentoUsd + ivaUsd;

  const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.innerText = txt; };
  setText('compraBaseGravada', `$ ${baseGravadaUsd.toFixed(2)} | Bs. ${(baseGravadaUsd * tasa).toFixed(2)}`);
  setText('compraMontoExento', `$ ${montoExentoUsd.toFixed(2)} | Bs. ${(montoExentoUsd * tasa).toFixed(2)}`);
  setText('compraIvaTotal', `$ ${ivaUsd.toFixed(2)} | Bs. ${(ivaUsd * tasa).toFixed(2)}`);
  setText('compraTotalFinal', `$ ${totalUsd.toFixed(2)} | Bs. ${(totalUsd * tasa).toFixed(2)}`);
}

async function registrarCompraInventario() {
  const tenantId = obtenerTenantKardex();
  if (!tenantId) return;

  const fechaCompra = document.getElementById('compraFecha')?.value || '';
  const tasaBcv = parseFloat(document.getElementById('compraTasaBcv')?.value) || 0;
  const nroFactura = (document.getElementById('compraNumeroFactura')?.value || '').trim().toUpperCase();
  const nroControl = (document.getElementById('compraNumeroControl')?.value || '').trim().toUpperCase();
  const proveedorId = document.getElementById('compraProveedorSelect')?.value || '';

  if (!fechaCompra) { avisarKardex('Ingresa la Fecha de Compra.', 'warning'); return; }
  if (tasaBcv <= 0) { avisarKardex('Ingresa una Tasa BCV válida mayor a 0.', 'warning'); return; }
  if (!nroFactura) { avisarKardex('Ingresa el Número de Factura del proveedor.', 'warning'); return; }
  if (!nroControl) { avisarKardex('Ingresa el Número de Control de la factura.', 'warning'); return; }
  if (!proveedorId) { avisarKardex('Selecciona el Proveedor.', 'warning'); return; }
  if (carritoCompraItems.length === 0) {
    avisarKardex('Agrega al menos un material al detalle antes de guardar la compra.', 'warning');
    return;
  }

  const prov = compraProveedoresCache.find(p => String(p.id) === String(proveedorId));
  const provLabel = prov ? `${prov.razon_social} (${prov.rif})` : 'PROVEEDOR';

  const btn = document.getElementById('btnGuardarCompraDoc');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Guardando Documento...';
    btn.classList.add('opacity-60', 'cursor-not-allowed');
  }

  try {
    const docNro = await calcularProximoDocumentoCompra();

    for (const item of carritoCompraItems) {
      // 1. Consultar material actual en `productos` para calcular saldo PPM
      const { data: prodData, error: prodErr } = await supabaseClient
        .from('productos')
        .select('*')
        .eq('id', item.productoId)
        .eq('tenant_id', tenantId)
        .single();

      if (prodErr || !prodData) {
        avisarKardex(`Error al consultar material "${item.descripcion}": ${prodErr?.message || 'No encontrado'}`, 'error', 9000);
        return;
      }

      const stockActual = Number(prodData.stock || 0);
      const nuevoStock = stockActual + item.cantidad;

      // 2. Registrar entrada en `kardex_movimientos` primero para no alterar stock si RLS bloquea Kardex
      const refCompuesta = [
        docNro,
        `FAC:${nroFactura}`,
        `CTRL:${nroControl}`,
        `PROV:${provLabel}`,
        `SUC:${item.sucursalNombre}`,
        `ALM:${item.almacenNombre}`,
        `LOTE:${item.lote}`,
        item.fechaVencimiento ? `VENC:${item.fechaVencimiento}` : null
      ].filter(Boolean).join(' | ');

      const resKardex = await supabaseClient
        .from('kardex_movimientos')
        .insert([{
          tenant_id: tenantId,
          producto_id: item.productoId,
          tipo_movimiento: 'ENTRADA',
          documento_ref: refCompuesta,
          cantidad_in: item.cantidad,
          cantidad_out: 0,
          saldo_cantidad: nuevoStock,
          costo_promedio_usd: item.costoUsd,
          tasa_bcv: tasaBcv,
          fecha: fechaCompra
        }])
        .select();

      if (resKardex.error) {
        const code = String(resKardex.error.code || '');
        if (code === '42501' || /row-level security/i.test(resKardex.error.message || '')) {
          avisarKardex('Permiso denegado por Supabase (RLS 42501) en "kardex_movimientos". Habilita la política RLS para poder guardar el documento de compra en el Kardex.', 'error', 10000);
        } else {
          avisarKardex(`Error al guardar en Kardex: ${resKardex.error.message}`, 'error', 9000);
        }
        return;
      }

      // 3. Actualizar stock y costo del material en `productos`
      const updateProd = {
        stock: nuevoStock,
        costo_unitario_usd: item.costoUsd,
        lote: item.lote
      };
      if (item.ubicacion) updateProd.ubicacion = item.ubicacion;

      const resUpdProd = await supabaseClient
        .from('productos')
        .update(updateProd)
        .eq('id', item.productoId)
        .eq('tenant_id', tenantId)
        .select();

      if (resUpdProd.error) {
        avisarKardex(`Error al actualizar stock de "${item.descripcion}": ${resUpdProd.error.message}`, 'error', 9000);
        return;
      }

      // 4. Actualizar o crear Lote y Vencimiento en `inventario_lotes` enlazado a Almacén y Material
      const { data: lotesMatch } = await supabaseClient
        .from('inventario_lotes')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('producto_id', item.productoId)
        .eq('almacen_id', item.almacenId)
        .eq('numero_lote', item.lote);

      if (lotesMatch && lotesMatch.length > 0) {
        const loteExist = lotesMatch[0];
        const nuevoStockLote = Number(loteExist.stock || 0) + item.cantidad;
        const resLote = await supabaseClient
          .from('inventario_lotes')
          .update({
            stock: nuevoStockLote,
            fecha_vencimiento: item.fechaVencimiento || loteExist.fecha_vencimiento || null,
            ubicacion: item.ubicacion || loteExist.ubicacion || '',
            updated_at: new Date().toISOString()
          })
          .eq('id', loteExist.id)
          .eq('tenant_id', tenantId)
          .select();

        if (resLote.error) {
          avisarKardex(`Error al actualizar lote "${item.lote}": ${resLote.error.message}`, 'error', 9000);
          return;
        }
      } else {
        const resInsLote = await supabaseClient
          .from('inventario_lotes')
          .insert([{
            tenant_id: tenantId,
            producto_id: item.productoId,
            almacen_id: item.almacenId,
            numero_lote: item.lote,
            stock: item.cantidad,
            ubicacion: item.ubicacion || '',
            fecha_vencimiento: item.fechaVencimiento || null,
            updated_at: new Date().toISOString()
          }])
          .select();

        if (resInsLote.error) {
          avisarKardex(`Error al registrar lote "${item.lote}": ${resInsLote.error.message}`, 'error', 9000);
          return;
        }
      }
    }

    avisarKardex(`¡Documento de Compra ${docNro} registrado con éxito (${carritoCompraItems.length} renglón/es)!`, 'success', 7000);
    carritoCompraItems = [];
    document.getElementById('compraNumeroFactura').value = '';
    document.getElementById('compraNumeroControl').value = '';
    renderizarTablaItemsCompra();

    await Promise.all([
      calcularProximoDocumentoCompra(),
      cargarHistorialCompras(),
      cargarKardexMovimientos(),
      cargarProductosSelectCompra(),
      cargarLotesExistentesCompra()
    ]);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '💾 Guardar Compra y Generar Documento';
      btn.classList.remove('opacity-60', 'cursor-not-allowed');
    }
  }
}

async function cargarHistorialCompras() {
  const tenantId = obtenerTenantKardex();
  if (!tenantId) return;

  const { data, error } = await supabaseClient
    .from('kardex_movimientos')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('tipo_movimiento', 'ENTRADA')
    .order('created_at', { ascending: false });

  const tbody = document.getElementById('tablaHistorialCompras');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-rose-400">Error al consultar compras: ${esc(error.message)}</td></tr>`;
    return;
  }

  const entradas = (data || []).filter(m => !/^REV-/i.test(String(m.documento_ref || '').trim()));
  if (entradas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-500">Sin documentos de compra registrados.</td></tr>`;
    return;
  }

  const agrupados = {};
  entradas.forEach(m => {
    const ref = String(m.documento_ref || '');
    const partes = ref.split('|').map(s => s.trim());
    const docMatch = partes[0]?.match(/^COMP-\d+/i) ? partes[0] : (ref || 'SIN-DOC');
    const getCampo = (pref) => {
      const encontrado = partes.find(p => p.startsWith(pref));
      return encontrado ? encontrado.slice(pref.length).trim() : '';
    };

    if (!agrupados[docMatch]) {
      agrupados[docMatch] = {
        docNro: docMatch,
        fecha: m.fecha || (m.created_at ? m.created_at.slice(0, 10) : ''),
        factura: getCampo('FAC:') || 'N/A',
        control: getCampo('CTRL:') || 'N/A',
        proveedor: getCampo('PROV:') || 'General',
        sucursal: getCampo('SUC:') || '',
        almacen: getCampo('ALM:') || '',
        tasaBcv: Number(m.tasa_bcv || 1),
        itemsCount: 0,
        subtotalUsd: 0
      };
    }

    agrupados[docMatch].itemsCount += 1;
    agrupados[docMatch].subtotalUsd += Number(m.cantidad_in || 0) * Number(m.costo_promedio_usd || 0);
  });

  Object.values(agrupados).forEach(doc => {
    const totalBs = doc.subtotalUsd * doc.tasaBcv;
    const almInfo = doc.sucursal || doc.almacen
      ? `${doc.sucursal ? doc.sucursal + ' → ' : ''}${doc.almacen}`
      : 'Almacén General';

    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/40">
        <td class="p-3 font-mono font-bold text-emerald-400">${esc(doc.docNro)}</td>
        <td class="p-3 font-mono text-slate-300">${esc(doc.fecha)}</td>
        <td class="p-3 font-mono">
          <div class="text-white">Fac: ${esc(doc.factura)}</div>
          <div class="text-[11px] text-slate-400">Ctrl: ${esc(doc.control)}</div>
        </td>
        <td class="p-3">
          <div class="text-white font-medium">${esc(doc.proveedor)}</div>
          <div class="text-[11px] text-sky-300">${esc(almInfo)}</div>
        </td>
        <td class="p-3 text-center font-mono font-bold text-amber-300">${doc.itemsCount}</td>
        <td class="p-3 font-mono text-slate-300">Bs. ${doc.tasaBcv.toFixed(4)}</td>
        <td class="p-3 font-mono font-bold text-emerald-400">$ ${doc.subtotalUsd.toFixed(2)}<div class="text-[11px] text-slate-400">Bs. ${totalBs.toFixed(2)}</div></td>
      </tr>
    `;
  });
}

async function cargarKardexMovimientos() {
  const tenantId = obtenerTenantKardex();
  if (!tenantId) return;

  const [resMovs, resProds] = await Promise.all([
    supabaseClient.from('kardex_movimientos').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
    supabaseClient.from('productos').select('id, codigo_sku, descripcion').eq('tenant_id', tenantId)
  ]);

  const tbody = document.getElementById('tablaKardexMovimientos');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (resMovs.error) {
    tbody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-rose-400">Error al consultar Kardex: ${esc(resMovs.error.message)}</td></tr>`;
    return;
  }

  const movimientos = resMovs.data || [];
  if (movimientos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-slate-500">Sin movimientos en el Kardex.</td></tr>`;
    return;
  }

  const productosMap = {};
  if (resProds.data) { resProds.data.forEach(p => { productosMap[p.id] = p; }); }

  movimientos.forEach(m => {
    const prod = productosMap[m.producto_id];
    const nombreArticulo = prod ? `${esc(prod.codigo_sku || 'S/N')} - ${esc(prod.descripcion)}` : 'Artículo no encontrado';
    const refStr = String(m.documento_ref || '');
    const esReverso = /^REV-/i.test(refStr) || /REVERSO/i.test(refStr);
    let badgeHtml = `<span class="px-2 py-0.5 rounded text-[10px] bg-rose-950 text-rose-300">${esc(m.tipo_movimiento)}</span>`;
    if (esReverso) {
      badgeHtml = `<span class="px-2 py-0.5 rounded text-[10px] bg-amber-950 text-amber-300 font-bold">REVERSO (ENTRADA)</span>`;
    } else if (m.tipo_movimiento === 'ENTRADA') {
      badgeHtml = `<span class="px-2 py-0.5 rounded text-[10px] bg-emerald-950 text-emerald-300">ENTRADA</span>`;
    }

    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/40">
        <td class="p-3 text-slate-400">${esc(m.fecha || formatearFecha8Digitos(m.created_at))}</td>
        <td class="p-3 font-mono text-emerald-400">${nombreArticulo}</td>
        <td class="p-3">${badgeHtml}</td>
        <td class="p-3 font-mono text-[11px]">${esc(m.documento_ref || 'S/REF')}</td>
        <td class="p-3 text-center text-emerald-400 font-bold">+${m.cantidad_in || 0}</td>
        <td class="p-3 text-center text-rose-400 font-bold">-${m.cantidad_out || 0}</td>
        <td class="p-3 text-center font-bold text-white">${m.saldo_cantidad}</td>
        <td class="p-3 font-mono text-emerald-300">$ ${(m.costo_promedio_usd || 0).toFixed(2)}</td>
      </tr>
    `;
  });
}

// ==========================================
// INV-009: TRANSFERENCIAS ENTRE DEPÓSITOS
// ==========================================

async function inicializarTransferenciasDeposito() {
  const tenantId = obtenerTenantKardex();
  if (!tenantId) return;

  const [resProd, resAlm, resLotes] = await Promise.all([
    supabaseClient.from('productos').select('*').eq('tenant_id', tenantId).order('descripcion', { ascending: true }),
    supabaseClient.from('almacenes').select('*, sucursales(nombre)').eq('tenant_id', tenantId).order('nombre', { ascending: true }),
    supabaseClient.from('inventario_lotes').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false })
  ]);

  compraProductosCache = resProd.data || [];
  compraAlmacenesCache = resAlm.data || [];
  compraLotesCache = resLotes.data || [];

  const selProd = document.getElementById('transfProductoSelect');
  if (selProd) {
    selProd.innerHTML = '<option value="">-- Seleccionar Artículo --</option>';
    compraProductosCache.forEach(p => {
      selProd.innerHTML += `<option value="${esc(p.id)}">[${esc(p.codigo_sku || 'S/N')}] ${esc(p.descripcion)} (Stock Global: ${p.stock ?? 0})</option>`;
    });
  }

  const llenarSelectAlm = (selId) => {
    const sel = document.getElementById(selId);
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Seleccionar Depósito / Almacén --</option>';
    compraAlmacenesCache.forEach(a => {
      const suc = a.sucursales?.nombre ? `${a.sucursales.nombre} → ` : '';
      sel.innerHTML += `<option value="${esc(a.id)}">${esc(suc)}${esc(a.nombre)} (${esc(a.tipo || 'PRINCIPAL')})</option>`;
    });
  };
  llenarSelectAlm('transfOrigenAlmacenSelect');
  llenarSelectAlm('transfDestinoAlmacenSelect');

  cargarLotesOrigenTransferencia();
  await cargarHistorialTransferencias();
}

function cargarLotesOrigenTransferencia() {
  const prodId = document.getElementById('transfProductoSelect')?.value || '';
  const origenId = document.getElementById('transfOrigenAlmacenSelect')?.value || '';
  const selLote = document.getElementById('transfLoteSelect');
  if (!selLote) return;

  const disponibles = compraLotesCache.filter(l => {
    const matchProd = !prodId || String(l.producto_id) === String(prodId);
    const matchAlm = !origenId || String(l.almacen_id || '') === String(origenId);
    return matchProd && matchAlm && Number(l.stock || 0) > 0;
  });

  selLote.innerHTML = '<option value="">-- Lote Disponible (Opcional / General) --</option>';
  disponibles.forEach(l => {
    const alm = compraAlmacenesCache.find(a => String(a.id) === String(l.almacen_id));
    const almTxt = alm ? `${alm.nombre} | ` : '';
    selLote.innerHTML += `<option value="${esc(l.id)}">${esc(almTxt)}Lote: ${esc(l.numero_lote)} (Disp: ${l.stock ?? 0})</option>`;
  });
}

async function registrarTransferenciaDeposito() {
  const tenantId = obtenerTenantKardex();
  if (!tenantId) return;

  const prodId = document.getElementById('transfProductoSelect')?.value || '';
  const origenId = document.getElementById('transfOrigenAlmacenSelect')?.value || '';
  const destinoId = document.getElementById('transfDestinoAlmacenSelect')?.value || '';
  const loteId = document.getElementById('transfLoteSelect')?.value || '';
  const cantidad = parseFloat(document.getElementById('transfCantidad')?.value) || 0;
  const nota = (document.getElementById('transfNota')?.value || '').trim();

  if (!prodId) { avisarKardex('Selecciona el artículo a transferir.', 'warning'); return; }
  if (!origenId || !destinoId) { avisarKardex('Selecciona el depósito de origen y el de destino.', 'warning'); return; }
  if (String(origenId) === String(destinoId)) { avisarKardex('El depósito de origen y destino deben ser diferentes.', 'warning'); return; }
  if (cantidad <= 0) { avisarKardex('La cantidad a transferir debe ser mayor a 0.', 'warning'); return; }

  const prod = compraProductosCache.find(p => String(p.id) === String(prodId));
  const almOrig = compraAlmacenesCache.find(a => String(a.id) === String(origenId));
  const almDest = compraAlmacenesCache.find(a => String(a.id) === String(destinoId));
  const loteOrig = loteId ? compraLotesCache.find(l => String(l.id) === String(loteId)) : null;

  if (loteOrig && Number(loteOrig.stock || 0) < cantidad) {
    avisarKardex(`Stock insuficiente en el lote "${loteOrig.numero_lote}" (Disponible: ${loteOrig.stock}).`, 'warning');
    return;
  }

  const btn = document.getElementById('btnEjecutarTransferencia');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Procesando...';
  }

  try {
    const nroTransf = 'TRANSF-' + String(Math.floor(1000 + Math.random() * 9000));
    const nroLoteTxt = loteOrig?.numero_lote || prod?.lote || 'GENERAL';
    const origNombre = almOrig ? `${almOrig.sucursales?.nombre ? almOrig.sucursales.nombre + '/' : ''}${almOrig.nombre}` : 'ORIGEN';
    const destNombre = almDest ? `${almDest.sucursales?.nombre ? almDest.sucursales.nombre + '/' : ''}${almDest.nombre}` : 'DESTINO';

    // 1. Mover lote si existe o crear lote en destino
    if (loteOrig) {
      await supabaseClient
        .from('inventario_lotes')
        .update({ stock: Math.max(0, Number(loteOrig.stock || 0) - cantidad), updated_at: new Date().toISOString() })
        .eq('id', loteOrig.id)
        .eq('tenant_id', tenantId);
    }

    const { data: loteDestMatch } = await supabaseClient
      .from('inventario_lotes')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('producto_id', prodId)
      .eq('almacen_id', destinoId)
      .eq('numero_lote', nroLoteTxt);

    if (loteDestMatch && loteDestMatch.length > 0) {
      const ld = loteDestMatch[0];
      await supabaseClient
        .from('inventario_lotes')
        .update({ stock: Number(ld.stock || 0) + cantidad, updated_at: new Date().toISOString() })
        .eq('id', ld.id)
        .eq('tenant_id', tenantId);
    } else {
      await supabaseClient
        .from('inventario_lotes')
        .insert([{
          tenant_id: tenantId,
          producto_id: prodId,
          almacen_id: destinoId,
          numero_lote: nroLoteTxt,
          stock: cantidad,
          ubicacion: loteOrig?.ubicacion || prod?.ubicacion || '',
          fecha_vencimiento: loteOrig?.fecha_vencimiento || null,
          updated_at: new Date().toISOString()
        }]);
    }

    // 2. Registrar trazabilidad en kardex_movimientos (Saldo global no cambia, queda registrado origen -> destino)
    const stockGlobal = Number(prod?.stock || 0);
    const costo = Number(prod?.costo_unitario_usd || 0);
    const tasa = parseFloat(document.getElementById('tasaBcv')?.value) || 1;
    const fechaHoy = new Date().toISOString().slice(0, 10);
    const refStr = `${nroTransf} | ${origNombre} -> ${destNombre} | LOTE:${nroLoteTxt}${nota ? ' | ' + nota : ''}`;

    const { error: errK } = await supabaseClient.from('kardex_movimientos').insert([
      {
        tenant_id: tenantId,
        producto_id: prodId,
        tipo_movimiento: 'SALIDA',
        documento_ref: refStr,
        cantidad_in: 0,
        cantidad_out: cantidad,
        saldo_cantidad: Math.max(0, stockGlobal - cantidad),
        costo_promedio_usd: costo,
        tasa_bcv: tasa,
        fecha: fechaHoy
      },
      {
        tenant_id: tenantId,
        producto_id: prodId,
        tipo_movimiento: 'ENTRADA',
        documento_ref: refStr,
        cantidad_in: cantidad,
        cantidad_out: 0,
        saldo_cantidad: stockGlobal,
        costo_promedio_usd: costo,
        tasa_bcv: tasa,
        fecha: fechaHoy
      }
    ]);

    if (errK) {
      avisarKardex(`Transferencia de lotes aplicada, pero Kardex reportó: ${errK.message}`, 'warning', 8000);
    } else {
      avisarKardex(`Transferencia ${nroTransf} ejecutada (${cantidad} uds de ${origNombre} a ${destNombre}).`, 'success', 6500);
    }

    const elNota = document.getElementById('transfNota');
    if (elNota) elNota.value = '';
    await inicializarTransferenciasDeposito();
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Registrar Transferencia';
    }
  }
}

async function cargarHistorialTransferencias() {
  const tenantId = obtenerTenantKardex();
  if (!tenantId) return;
  const tbody = document.getElementById('tablaTransferencias');
  if (!tbody) return;

  const { data, error } = await supabaseClient
    .from('kardex_movimientos')
    .select('*')
    .eq('tenant_id', tenantId)
    .ilike('documento_ref', 'TRANSF-%')
    .order('created_at', { ascending: false })
    .limit(40);

  tbody.innerHTML = '';
  if (error) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-rose-400">${esc(error.message)}</td></tr>`;
    return;
  }

  const soloSalidas = (data || []).filter(m => m.tipo_movimiento === 'SALIDA');
  if (soloSalidas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-500">Sin transferencias entre depósitos registradas.</td></tr>`;
    return;
  }

  soloSalidas.forEach(m => {
    const prod = compraProductosCache.find(p => String(p.id) === String(m.producto_id));
    const nom = prod ? `[${prod.codigo_sku || 'S/N'}] ${prod.descripcion}` : 'Artículo';
    const partes = String(m.documento_ref || '').split('|').map(s => s.trim());
    const docNro = partes[0] || 'TRANSF';
    const ruta = partes[1] || 'Origen -> Destino';
    const detalle = partes.slice(2).join(' · ') || '-';

    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/40">
        <td class="p-3 font-mono font-bold text-emerald-400 tabular-nums">${esc(docNro)}</td>
        <td class="p-3 font-mono text-slate-400 tabular-nums">${esc(m.fecha || formatearFecha8Digitos(m.created_at))}</td>
        <td class="p-3 text-white font-medium">${esc(nom)}</td>
        <td class="p-3 text-slate-300">${esc(ruta)} <span class="text-slate-500 text-[11px]">${esc(detalle)}</span></td>
        <td class="p-3 text-center font-mono font-bold text-emerald-400 tabular-nums">${m.cantidad_out || 0}</td>
      </tr>
    `;
  });
}

