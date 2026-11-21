/**
 * /js/pos.js
 * Módulo de Punto de Venta, Carrito Multi-Alícuota IVA, IGTF,
 * Registro/Edición/Eliminación-Reverso de Facturas con Kardex PPM
 * y Facturación Fiscal Digital SENIAT (Providencias SNAT/2011/00071 y SNAT/2024/000102)
 */

let carritoItems = [];
let productosCache = [];
let clientesCache = [];
let posSucursalesCache = [];
let posAlmacenesCache = [];
let posDocumentosCache = [];
let posViasPagoCache = [];
let posPagosMixtos = [];
let posPagoMixtoActivo = false;
let clienteIdSeleccionado = null;

async function insertarFilaCompatible(tabla, baseRow, extRow = {}) {
  let res = await supabaseClient.from(tabla).insert([{ ...baseRow, ...extRow }]);
  if (res.error && typeof esErrorColumnaOTablaFaltante === 'function' && esErrorColumnaOTablaFaltante(res.error)) {
    res = await supabaseClient.from(tabla).insert([baseRow]);
  }
  return res;
}

function sumarDiasFechaIso(fechaIso, dias = 0) {
  const d = new Date((fechaIso || new Date().toISOString().slice(0, 10)) + 'T00:00:00');
  if (isNaN(d)) return fechaIso;
  d.setDate(d.getDate() + (Number(dias) || 0));
  return d.toISOString().slice(0, 10);
}

function avisarPos(mensaje, tipo = 'info', duracion = 5500) {
  if (typeof notificarSistema === 'function') {
    notificarSistema(mensaje, tipo, duracion);
  } else {
    console.log(`[${tipo}]`, mensaje);
  }
}

function obtenerTenantPos() {
  return tenantActual ? (tenantActual.id || tenantActual.tenant_id || null) : null;
}

async function inicializarModuloPos() {
  const tenantId = obtenerTenantPos();
  if (!tenantId) return;

  const editId = document.getElementById('editFacturaId')?.value || '';
  const inputFecha = document.getElementById('posFecha');
  if (inputFecha && !inputFecha.value && !editId) {
    inputFecha.value = new Date().toISOString().slice(0, 10);
  }

  await Promise.all([
    cargarProductosSelect(),
    cargarClientesSelect(),
    typeof cargarViasPagoSelectPos === 'function' ? cargarViasPagoSelectPos() : Promise.resolve(),
    cargarViasPagoContabPos(),
    cargarSucursalesYAlmacenesPos(),
    calcularProximoDocumentoVenta(),
    cargarDocumentosPos(),
    typeof obtenerTurnoCajaActivo === 'function' ? obtenerTurnoCajaActivo(tenantId) : Promise.resolve(),
    !editId ? consultarTasaBcvApi(true) : Promise.resolve()
  ]);

  poblarSelectViasPagoMixto();
  if (typeof sincronizarSelectorProtocoloFiscalPos === 'function') {
    sincronizarSelectorProtocoloFiscalPos();
  }

  setTimeout(() => {
    if (typeof enfocarEscanerPos === 'function') enfocarEscanerPos();
  }, 150);
}

async function cargarViasPagoContabPos() {
  const tenantId = obtenerTenantPos();
  if (!tenantId) return;
  try {
    const { data } = await supabaseClient.from('vias_pago').select('*').eq('tenant_id', tenantId);
    if (typeof sincronizarMetaContableNube === 'function') await sincronizarMetaContableNube(tenantId, 'vias_pago');
    posViasPagoCache = (data || []).map(v => typeof obtenerMetaContableRegistro === 'function' ? obtenerMetaContableRegistro(tenantId, 'vias_pago', v) : v);
  } catch (e) {}
}

async function consultarTasaBcvApi(silencioso = false) {
  try {
    const url = silencioso ? '/api/tasa-bcv' : '/api/tasa-bcv?force=1';
    const res = await fetch(url);
    const json = await res.json();
    if (json?.ok && Number(json.usd) > 0) {
      const tasa = Number(json.usd).toFixed(4);
      const inputTasa = document.getElementById('tasaBcv');
      const inputCompra = document.getElementById('compraTasaBcv');
      if (inputTasa) inputTasa.value = tasa;
      if (inputCompra) inputCompra.value = tasa;
      recalcularTodo();
      if (!silencioso) {
        avisarPos(`¡Tasa BCV actualizada a Bs. ${tasa} (${json.fuente}${json.fechaValor ? ' - ' + json.fechaValor : ''})!`, 'success', 6500);
      }
      return true;
    }
  } catch (e) {
    console.warn('Falla de red en /api/tasa-bcv:', e);
  }
  if (!silencioso) {
    avisarPos('No se pudo consultar la página del BCV. Puedes ingresar la tasa manualmente.', 'warning');
  }
  return false;
}

async function calcularProximoDocumentoVenta() {
  const tenantId = obtenerTenantPos();
  if (!tenantId) return 'FAC-00000001';

  const { data } = await supabaseClient
    .from('invoices')
    .select('factura_nro, nro_control')
    .eq('tenant_id', tenantId);

  let maxFac = 0;
  let maxCtrl = 0;
  let maxRev = 0;
  (data || []).forEach(d => {
    const mFac = String(d.factura_nro || '').match(/^FAC-(\d+)/i);
    if (mFac) {
      const n = parseInt(mFac[1], 10);
      if (Number.isFinite(n) && n > maxFac) maxFac = n;
    }
    const mRev = String(d.factura_nro || '').match(/^REV-(\d+)/i);
    if (mRev) {
      const r = parseInt(mRev[1], 10);
      if (Number.isFinite(r) && r > maxRev) maxRev = r;
    }
    const mCtrl = String(d.nro_control || '').match(/^00-(\d+)/);
    if (mCtrl) {
      const c = parseInt(mCtrl[1], 10);
      if (Number.isFinite(c) && c > maxCtrl) maxCtrl = c;
    }
  });

  const nextFac = 'FAC-' + String(maxFac + 1).padStart(8, '0');
  const nextCtrl = '00-' + String(maxCtrl + 1).padStart(8, '0');
  const nextRev = 'REV-' + String(maxRev + 1).padStart(8, '0');

  const editId = document.getElementById('editFacturaId')?.value || '';
  const badge = document.getElementById('posProximoDoc');
  if (badge && !editId) {
    badge.textContent = nextFac;
  }

  return { nextFac, nextCtrl, nextRev };
}

async function cargarSucursalesYAlmacenesPos() {
  const tenantId = obtenerTenantPos();
  if (!tenantId) return;

  const [resSuc, resAlm] = await Promise.all([
    supabaseClient.from('sucursales').select('*').eq('tenant_id', tenantId).order('nombre', { ascending: true }),
    supabaseClient.from('almacenes').select('*, sucursales(nombre)').eq('tenant_id', tenantId).order('nombre', { ascending: true })
  ]);

  posSucursalesCache = (resSuc.data || []).map(s => typeof obtenerMetaContableRegistro === 'function' ? obtenerMetaContableRegistro(tenantId, 'sucursales', s) : s);
  posAlmacenesCache = (resAlm.data || []).map(a => typeof obtenerMetaContableRegistro === 'function' ? obtenerMetaContableRegistro(tenantId, 'almacenes', a) : a);

  const selSuc = document.getElementById('posSucursalSelect');
  if (selSuc) {
    const prev = selSuc.value;
    selSuc.innerHTML = '<option value="">-- Sede Principal --</option>';
    posSucursalesCache.forEach(s => {
      selSuc.innerHTML += `<option value="${esc(s.id)}">${esc(s.nombre)}</option>`;
    });
    if (prev && posSucursalesCache.some(s => String(s.id) === String(prev))) {
      selSuc.value = prev;
    } else if (posSucursalesCache.length === 1) {
      selSuc.value = posSucursalesCache[0].id;
    }
  }

  filtrarAlmacenesPosPorSucursal();
}

function filtrarAlmacenesPosPorSucursal() {
  const selSuc = document.getElementById('posSucursalSelect');
  const selAlm = document.getElementById('posAlmacenSelect');
  if (!selAlm) return;

  const sucId = selSuc ? selSuc.value : '';
  const prevAlm = selAlm.value;

  const filtrados = sucId
    ? posAlmacenesCache.filter(a => String(a.sucursal_id || '') === String(sucId))
    : posAlmacenesCache;

  selAlm.innerHTML = '<option value="">-- Almacén General --</option>';
  filtrados.forEach(a => {
    const sucTag = !sucId && a.sucursales?.nombre ? `[${a.sucursales.nombre}] ` : '';
    selAlm.innerHTML += `<option value="${esc(a.id)}">${esc(sucTag)}${esc(a.nombre)} (${esc(a.tipo || 'PRINCIPAL')})</option>`;
  });

  if (prevAlm && filtrados.some(a => String(a.id) === String(prevAlm))) {
    selAlm.value = prevAlm;
  } else if (filtrados.length === 1) {
    selAlm.value = filtrados[0].id;
  }
}

async function cargarProductosSelect() {
  const tenantId = obtenerTenantPos();
  if (!tenantId) return;

  if (typeof sincronizarMetaContableNube === 'function') {
    await sincronizarMetaContableNube(tenantId, 'productos');
  }

  const [resProds, resIvas] = await Promise.all([
    supabaseClient.from('productos').select('*, tipos_iva(id, nombre, porcentaje)').eq('tenant_id', tenantId).order('descripcion', { ascending: true }),
    supabaseClient.from('tipos_iva').select('*').eq('tenant_id', tenantId)
  ]);

  const ivaMap = {};
  (resIvas.data || []).forEach(t => { ivaMap[String(t.id)] = t; });

  productosCache = (resProds.data || []).map(pRaw => {
    const p = typeof obtenerMetaContableRegistro === 'function' ? obtenerMetaContableRegistro(tenantId, 'productos', pRaw) : pRaw;
    const ivaInfo = p.tipos_iva || (p.tipo_iva_id ? ivaMap[String(p.tipo_iva_id)] : null);
    const ivaPct = ivaInfo ? Number(ivaInfo.porcentaje ?? 0) : (p.es_exento ? 0 : 16);
    const ivaNombre = ivaInfo ? ivaInfo.nombre : (ivaPct === 0 ? 'EXENTO' : 'GENERAL');
    return {
      ...p,
      _ivaPorcentaje: ivaPct,
      _ivaNombre: ivaNombre
    };
  });

  const select = document.getElementById('productoSelect');
  if (!select) return;
  select.innerHTML = '<option value="">-- Seleccionar Artículo / Servicio --</option>';
  productosCache.forEach(prod => {
    const pv = Number(prod.precio_venta_usd ?? prod.precio_unitario_usd ?? 0);
    const tagIva = prod._ivaPorcentaje === 0 ? 'EXENTO' : `IVA ${prod._ivaPorcentaje}%`;
    const avisoSinPrecio = pv <= 0 ? ' [SIN PRECIO]' : '';
    const barTag = prod.codigo_barras ? ` | ${prod.codigo_barras}` : '';
    select.innerHTML += `<option value="${esc(prod.id)}">[${esc(prod.codigo_sku || 'S/N')}${esc(barTag)}] ${esc(prod.descripcion)} - $${pv.toFixed(2)} (${esc(tagIva)})${avisoSinPrecio}</option>`;
  });
}

async function cargarClientesSelect() {
  const tenantId = obtenerTenantPos();
  if (!tenantId) return;
  const { data } = await supabaseClient.from('clientes').select('*').eq('tenant_id', tenantId).order('razon_social', { ascending: true });
  clientesCache = (data || []).map(c => typeof obtenerMetaContableRegistro === 'function' ? obtenerMetaContableRegistro(tenantId, 'clientes', c) : c);
  const select = document.getElementById('clienteSelect');
  if (!select) return;
  select.innerHTML = '<option value="">-- Seleccionar Cliente --</option>';
  clientesCache.forEach(c => {
    const nombreCli = c.razon_social || c.nombre || 'Sin nombre';
    select.innerHTML += `<option value="${esc(c.id)}">${esc(nombreCli)} (${esc(c.rif)})</option>`;
  });
}

function seleccionarClientePredefinido() {
  const select = document.getElementById('clienteSelect');
  const cliId = select?.value || '';
  if (!cliId) {
    clienteIdSeleccionado = null;
    return;
  }
  const cli = clientesCache.find(c => String(c.id) === String(cliId));
  if (!cli) return;

  clienteIdSeleccionado = cli.id;
  document.getElementById('clienteRif').value = cli.rif || '';
  document.getElementById('clienteNombre').value = cli.razon_social || cli.nombre || '';
  const dirEl = document.getElementById('clienteDireccion');
  const telEl = document.getElementById('clienteTelefono');
  if (dirEl) dirEl.value = cli.direccion || '';
  if (telEl) telEl.value = cli.telefono || '';
}

function agregarItem() {
  const select = document.getElementById('productoSelect');
  const prodId = select?.value;
  if (!prodId) { avisarPos('Seleccione un producto o servicio.', 'warning'); return; }

  const prod = productosCache.find(p => String(p.id) === String(prodId));
  if (!prod) { avisarPos('Producto no encontrado en el catálogo.', 'error'); return; }

  const precio = Number(prod.precio_venta_usd ?? prod.precio_unitario_usd ?? 0);
  if (precio <= 0) {
    avisarPos(`El material "${prod.descripcion}" no tiene Precio de Venta (> 0). Configura su precio en el Maestro de Artículos antes de facturar.`, 'warning', 7500);
    return;
  }

  const ivaPorcentaje = Number(prod._ivaPorcentaje ?? 16);
  const ivaNombre = prod._ivaNombre || (ivaPorcentaje === 0 ? 'EXENTO' : 'GENERAL');
  const esExento = ivaPorcentaje === 0;
  const unidad = prod.unidad_medida || 'UND';
  const sku = prod.codigo_sku || 'S/N';
  const manejaInventario = Boolean(prod.maneja_inventario);
  const cantidad = parseFloat(document.getElementById('cantidadItem')?.value) || 0;

  if (cantidad <= 0) { avisarPos('La cantidad debe ser mayor a 0.', 'warning'); return; }

  const itemExistente = carritoItems.find(i => String(i.productoId) === String(prodId));
  if (itemExistente) {
    itemExistente.cantidad += cantidad;
    itemExistente.precio = precio;
  } else {
    carritoItems.push({
      productoId: prodId,
      sku,
      descripcion: prod.descripcion,
      precio,
      costoUnitarioUsd: Number(prod.costo_unitario_usd ?? 0),
      cantidad,
      esExento,
      ivaPorcentaje,
      ivaNombre,
      unidad,
      manejaInventario,
      cuentaIngreso: prod.cuenta_ingreso || null,
      cuentaCosto: prod.cuenta_costo || null,
      centroCosto: prod.centro_costo_default || null
    });
  }
  document.getElementById('cantidadItem').value = '1';
  actualizarTablaYCalculos();
}

function procesarCodigoBarrasPos(rawInput) {
  const inputEl = document.getElementById('posBarcodeInput');
  const valor = String(rawInput !== undefined ? rawInput : (inputEl?.value || '')).trim();
  if (!valor) return false;

  const { producto } = typeof buscarProductoPorCodigoEscaneado === 'function'
    ? buscarProductoPorCodigoEscaneado(productosCache, valor)
    : { producto: null };

  const statusEl = document.getElementById('posBarcodeFeedback');

  if (!producto) {
    if (typeof reproducirBeepEscaner === 'function') reproducirBeepEscaner('error');
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-rose-300">Código <strong>${esc(valor)}</strong> no encontrado.</span> <button type="button" onclick='irACrearMaterialConCodigo("${esc(valor)}")' class="text-emerald-400 hover:underline font-semibold ml-1 cursor-pointer">+ Crear Material con este código</button>`;
      statusEl.classList.remove('hidden');
    }
    avisarPos(`Código "${valor}" no encontrado en el catálogo de artículos.`, 'warning', 4500);
    if (inputEl) inputEl.select();
    return false;
  }

  const selProd = document.getElementById('productoSelect');
  if (selProd) selProd.value = String(producto.id);

  const modo = document.getElementById('posBarcodeModo')?.value || 'AUTO';
  if (modo === 'AUTO') {
    const pv = Number(producto.precio_venta_usd ?? producto.precio_unitario_usd ?? 0);
    if (pv <= 0) {
      if (typeof reproducirBeepEscaner === 'function') reproducirBeepEscaner('error');
      avisarPos(`El material "${producto.descripcion}" no tiene Precio de Venta configurado (> 0).`, 'warning', 6500);
      return false;
    }
    agregarItem();
    if (typeof reproducirBeepEscaner === 'function') reproducirBeepEscaner('ok');
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-emerald-300">Capturado: <strong>${esc(producto.descripcion)}</strong> ($ ${pv.toFixed(2)})</span>`;
      statusEl.classList.remove('hidden');
    }
    if (inputEl) {
      inputEl.value = '';
      inputEl.focus();
    }
  } else {
    if (typeof reproducirBeepEscaner === 'function') reproducirBeepEscaner('ok');
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-sky-300">Ubicado: <strong>${esc(producto.descripcion)}</strong> — ajusta cantidad y pulsa "+ Añadir al Carrito".</span>`;
      statusEl.classList.remove('hidden');
    }
    if (inputEl) inputEl.value = '';
    const cantEl = document.getElementById('cantidadItem');
    if (cantEl) {
      cantEl.focus();
      cantEl.select();
    }
  }
  return true;
}

function eliminarItemCarrito(index) {
  carritoItems.splice(index, 1);
  renderizarYRecalcularPos();
}

function cambiarCantidadItemCarrito(index, delta) {
  const it = carritoItems[index];
  if (!it) return;
  const nueva = Number((Number(it.cantidad || 0) + Number(delta || 0)).toFixed(3));
  if (nueva <= 0) {
    carritoItems.splice(index, 1);
  } else {
    it.cantidad = nueva;
  }
  renderizarYRecalcularPos();
}

function actualizarCantidadItemInput(index, valorRaw) {
  const it = carritoItems[index];
  if (!it) return;
  const cant = parseFloat(valorRaw);
  if (!Number.isFinite(cant) || cant <= 0) {
    avisarPos('La cantidad debe ser mayor a 0.', 'warning', 3000);
    renderizarYRecalcularPos();
    return;
  }
  it.cantidad = Number(cant.toFixed(3));
  renderizarYRecalcularPos();
}

function renderizarYRecalcularPos() {
  actualizarTablaYCalculos();
}

function actualizarTablaYCalculos() {
  const tbody = document.getElementById('tablaItems');
  if (!tbody) return;
  tbody.innerHTML = '';

  const tasa = parseFloat(document.getElementById('tasaBcv')?.value) || 1;
  let baseGravada = 0;
  let montoExento = 0;
  let ivaUsd = 0;

  if (carritoItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-slate-500">Agrega artículos o servicios al carrito para facturar.</td></tr>`;
  } else {
    carritoItems.forEach((item, idx) => {
      const sub = item.precio * item.cantidad;
      const pct = Number(item.ivaPorcentaje ?? (item.esExento ? 0 : 16));
      if (pct === 0) {
        montoExento += sub;
      } else {
        baseGravada += sub;
        ivaUsd += sub * (pct / 100);
      }

      const badge = pct === 0
        ? `<span class="px-2 py-0.5 rounded text-[10px] bg-sky-950 text-sky-300 font-semibold">Exento (E)</span>`
        : `<span class="px-2 py-0.5 rounded text-[10px] bg-emerald-950 text-emerald-300 font-semibold">${esc(item.ivaNombre || 'IVA')} ${pct}%</span>`;

      tbody.innerHTML += `
        <tr class="hover:bg-slate-900 border-b border-slate-800/40">
          <td class="p-3 font-mono text-emerald-400">${esc(item.sku)}</td>
          <td class="p-3 font-medium text-white">${esc(item.descripcion)}${pct === 0 ? ' <span class="text-sky-400 font-bold">(E)</span>' : ''}</td>
          <td class="p-3 font-mono">
            <div class="inline-flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg px-1 py-0.5">
              <button type="button" onclick="cambiarCantidadItemCarrito(${idx}, -1)" class="w-5 h-5 rounded hover:bg-slate-800 text-slate-300 font-bold cursor-pointer">-</button>
              <input type="number" step="0.001" min="0.001" value="${item.cantidad}" onchange="actualizarCantidadItemInput(${idx}, this.value)" class="w-12 bg-transparent text-center text-white text-xs font-mono focus:outline-none">
              <button type="button" onclick="cambiarCantidadItemCarrito(${idx}, 1)" class="w-5 h-5 rounded hover:bg-slate-800 text-emerald-400 font-bold cursor-pointer">+</button>
            </div>
          </td>
          <td class="p-3">${esc(item.unidad)}</td>
          <td class="p-3 font-mono">$ ${item.precio.toFixed(2)}</td>
          <td class="p-3">${badge}</td>
          <td class="p-3 font-mono font-bold text-emerald-300">$ ${sub.toFixed(2)}<div class="text-[11px] text-slate-400">Bs. ${(sub * tasa).toFixed(2)}</div></td>
          <td class="p-3 text-center"><button type="button" onclick="eliminarItemCarrito(${idx})" class="text-rose-400 hover:underline cursor-pointer">Quitar</button></td>
        </tr>
      `;
    });
  }

  const aplicaIgtf = document.getElementById('aplicaIgtfSelect')?.value === 'SI';
  const igtf = aplicaIgtf ? (baseGravada + montoExento + ivaUsd) * 0.03 : 0;
  const totalUsd = baseGravada + montoExento + ivaUsd + igtf;

  document.getElementById('baseGravadaBs').innerText = `$ ${baseGravada.toFixed(2)} | Bs. ${(baseGravada * tasa).toFixed(2)}`;
  document.getElementById('montoExentoBs').innerText = `$ ${montoExento.toFixed(2)} | Bs. ${(montoExento * tasa).toFixed(2)}`;
  document.getElementById('ivaBs').innerText = `$ ${ivaUsd.toFixed(2)} | Bs. ${(ivaUsd * tasa).toFixed(2)}`;
  document.getElementById('igtfBs').innerText = `$ ${igtf.toFixed(2)} | Bs. ${(igtf * tasa).toFixed(2)}`;
  document.getElementById('totalBs').innerText = `$ ${totalUsd.toFixed(2)} | Bs. ${(totalUsd * tasa).toFixed(2)}`;
  calcularVuelto();
  if (posPagoMixtoActivo) renderizarPagosMixtosPos();
}

function recalcularTodo() { actualizarTablaYCalculos(); }

function verificarAplicacionIgtf() {
  const metodo = (document.getElementById('metodoPagoSelect')?.value || '').toUpperCase();
  const selectIgtf = document.getElementById('aplicaIgtfSelect');
  if (!selectIgtf) return;
  const viaObj = posViasPagoCache.find(v => String(v.nombre || '').toUpperCase() === metodo);
  if (viaObj && viaObj.es_divisa_igtf !== undefined) {
    selectIgtf.value = viaObj.es_divisa_igtf ? 'SI' : 'NO';
  } else if (/DIVISA|USD|ZELLE|BINANCE|USDT|EFECTIVO\s*\$/.test(metodo)) {
    selectIgtf.value = 'SI';
  } else {
    selectIgtf.value = 'NO';
  }
  recalcularTodo();
}

function calcularVuelto() {
  const tasa = parseFloat(document.getElementById('tasaBcv')?.value) || 1;
  const totalUsdText = document.getElementById('totalBs')?.innerText || '$ 0.00';
  const totalUsd = parseFloat(totalUsdText.split('|')[0].replace('$', '').trim()) || 0;
  const totalBs = totalUsd * tasa;

  const recUsd = parseFloat(document.getElementById('pagoRecibidoUsd')?.value) || 0;
  const recBs = parseFloat(document.getElementById('pagoRecibidoBs')?.value) || 0;
  const totalRecibidoBs = (recUsd * tasa) + recBs;

  const diffBs = totalRecibidoBs - totalBs;
  if (diffBs >= 0) {
    document.getElementById('vueltoBs').innerText = `Bs. ${diffBs.toFixed(2)}`;
    document.getElementById('vueltoUsd').innerText = `$ ${(diffBs / tasa).toFixed(2)}`;
    return { vueltoBs: Number(diffBs.toFixed(2)), vueltoUsd: Number((diffBs / tasa).toFixed(2)), faltaBs: 0 };
  }
  document.getElementById('vueltoBs').innerText = `Bs. 0.00`;
  document.getElementById('vueltoUsd').innerText = `$ 0.00`;
  return { vueltoBs: 0, vueltoUsd: 0, faltaBs: Number(Math.abs(diffBs).toFixed(2)) };
}

function poblarSelectViasPagoMixto() {
  const orig = document.getElementById('metodoPagoSelect');
  const dst = document.getElementById('mixtoViaSelect');
  if (!orig || !dst) return;
  dst.innerHTML = orig.innerHTML;
}

function togglePagoMixtoPos() {
  posPagoMixtoActivo = !posPagoMixtoActivo;
  const panel = document.getElementById('panelPagoMixtoPos');
  const btn = document.getElementById('btnTogglePagoMixtoPos');
  if (panel) {
    if (posPagoMixtoActivo) panel.classList.remove('hidden');
    else panel.classList.add('hidden');
  }
  if (btn) {
    btn.textContent = posPagoMixtoActivo ? 'Ocultar Pago Mixto' : '+ Pago Mixto (Multi-Vía)';
    btn.className = posPagoMixtoActivo
      ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer whitespace-nowrap'
      : 'bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer whitespace-nowrap';
  }
  poblarSelectViasPagoMixto();
  renderizarPagosMixtosPos();
}

function esMetodoDivisaIgtf(metodoRaw) {
  const m = String(metodoRaw || '').toUpperCase();
  const viaObj = posViasPagoCache.find(v => String(v.nombre || '').toUpperCase() === m);
  if (viaObj && viaObj.es_divisa_igtf !== undefined) return Boolean(viaObj.es_divisa_igtf);
  return /DIVISA|USD|ZELLE|BINANCE|USDT|EFECTIVO\s*\$/.test(m);
}

function agregarLineaPagoMixto() {
  const metodo = document.getElementById('mixtoViaSelect')?.value || 'EFECTIVO DIVISAS';
  const moneda = document.getElementById('mixtoMonedaSelect')?.value || 'USD';
  const monto = parseFloat(document.getElementById('mixtoMontoInput')?.value) || 0;
  const referencia = (document.getElementById('mixtoRefInput')?.value || '').trim();
  const tasa = parseFloat(document.getElementById('tasaBcv')?.value) || 1;

  if (monto <= 0) {
    avisarPos('Ingresa un monto mayor a 0 para añadir al pago mixto.', 'warning');
    return;
  }

  const montoUsd = moneda === 'USD' ? monto : monto / tasa;
  const montoBs = moneda === 'VES' ? monto : monto * tasa;

  posPagosMixtos.push({
    metodo,
    moneda,
    montoOriginal: Number(monto.toFixed(2)),
    montoUsd: Number(montoUsd.toFixed(2)),
    montoBs: Number(montoBs.toFixed(2)),
    referencia
  });

  if (document.getElementById('mixtoMontoInput')) document.getElementById('mixtoMontoInput').value = '';
  if (document.getElementById('mixtoRefInput')) document.getElementById('mixtoRefInput').value = '';

  const selIgtf = document.getElementById('aplicaIgtfSelect');
  if (selIgtf) {
    selIgtf.value = posPagosMixtos.some(p => esMetodoDivisaIgtf(p.metodo)) ? 'SI' : 'NO';
  }

  recalcularTodo();
  renderizarPagosMixtosPos();
}

function eliminarLineaPagoMixto(idx) {
  posPagosMixtos.splice(idx, 1);
  const selIgtf = document.getElementById('aplicaIgtfSelect');
  if (selIgtf && posPagosMixtos.length > 0) {
    selIgtf.value = posPagosMixtos.some(p => esMetodoDivisaIgtf(p.metodo)) ? 'SI' : 'NO';
  }
  recalcularTodo();
  renderizarPagosMixtosPos();
}

function renderizarPagosMixtosPos() {
  const tbody = document.getElementById('tablaPagosMixtosPos');
  const resumenEl = document.getElementById('resumenPagosMixtosPos');
  if (!tbody) return;

  if (!posPagosMixtos || posPagosMixtos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="p-2.5 text-center text-slate-500 text-xs">Sin líneas agregadas. Añade 2 o más formas de pago si el cliente combina métodos.</td></tr>`;
    if (resumenEl) resumenEl.textContent = 'Pago único según selector superior';
    return;
  }

  const tasa = parseFloat(document.getElementById('tasaBcv')?.value) || 1;
  const totalUsdText = document.getElementById('totalBs')?.innerText || '$ 0.00';
  const totalFacturaUsd = parseFloat(totalUsdText.split('|')[0].replace('$', '').trim()) || 0;

  let sumaUsd = 0;
  let sumaBs = 0;
  let recUsd = 0;
  let recBs = 0;

  tbody.innerHTML = posPagosMixtos.map((p, idx) => {
    const mUsd = p.moneda === 'USD' ? p.montoOriginal : p.montoOriginal / tasa;
    const mBs = p.moneda === 'VES' ? p.montoOriginal : p.montoOriginal * tasa;
    p.montoUsd = Number(mUsd.toFixed(2));
    p.montoBs = Number(mBs.toFixed(2));
    sumaUsd += mUsd;
    sumaBs += mBs;
    if (p.moneda === 'USD') recUsd += p.montoOriginal;
    else recBs += p.montoOriginal;
    return `
      <tr class="border-b border-slate-800/40">
        <td class="p-2 font-semibold text-white">${esc(p.metodo)} ${p.referencia ? `<span class="text-slate-400 font-mono text-[10px]">(${esc(p.referencia)})</span>` : ''}</td>
        <td class="p-2 font-mono text-slate-300">${esc(p.moneda)}</td>
        <td class="p-2 text-right font-mono text-emerald-400 font-bold">${p.moneda === 'USD' ? '$ ' : 'Bs. '}${p.montoOriginal.toFixed(2)}</td>
        <td class="p-2 text-center"><button type="button" onclick="eliminarLineaPagoMixto(${idx})" class="text-rose-400 hover:underline text-xs cursor-pointer">Quitar</button></td>
      </tr>
    `;
  }).join('');

  if (posPagoMixtoActivo && posPagosMixtos.length > 0) {
    if (document.getElementById('pagoRecibidoUsd')) document.getElementById('pagoRecibidoUsd').value = recUsd.toFixed(2);
    if (document.getElementById('pagoRecibidoBs')) document.getElementById('pagoRecibidoBs').value = recBs.toFixed(2);
    calcularVuelto();
  }

  const diffUsd = sumaUsd - totalFacturaUsd;
  if (resumenEl) {
    if (Math.abs(diffUsd) <= 0.02) {
      resumenEl.innerHTML = `<span class="text-emerald-400 font-bold">Cubierto exacto: $ ${sumaUsd.toFixed(2)} (Bs. ${sumaBs.toFixed(2)})</span>`;
    } else if (diffUsd > 0) {
      resumenEl.innerHTML = `<span class="text-sky-300 font-bold">Recibido: $ ${sumaUsd.toFixed(2)} · Vuelto: $ ${diffUsd.toFixed(2)} (Bs. ${(diffUsd * tasa).toFixed(2)})</span>`;
    } else {
      resumenEl.innerHTML = `<span class="text-amber-300 font-bold">Recibido: $ ${sumaUsd.toFixed(2)} · Falta: $ ${Math.abs(diffUsd).toFixed(2)} (Bs. ${(Math.abs(diffUsd) * tasa).toFixed(2)})</span>`;
    }
  }
}

function guardarMetaFacturaSeniatLocal(tenantId, invoiceId, facturaNro, meta) {
  try {
    const key = `facturas_seniat_meta_${tenantId}`;
    const store = JSON.parse(localStorage.getItem(key) || '{}');
    if (invoiceId) store[String(invoiceId)] = meta;
    if (facturaNro) store[String(facturaNro)] = meta;
    localStorage.setItem(key, JSON.stringify(store));
  } catch (e) {
    console.warn('No se pudo guardar metadata local de factura:', e);
  }
}

function leerMetaFacturaSeniatLocal(tenantId, invoiceId, facturaNro) {
  try {
    const key = `facturas_seniat_meta_${tenantId}`;
    const store = JSON.parse(localStorage.getItem(key) || '{}');
    return store[String(invoiceId)] || store[String(facturaNro)] || null;
  } catch (e) {
    return null;
  }
}

function cancelarEdicionFactura(silencioso = false) {
  const editEl = document.getElementById('editFacturaId');
  if (editEl) editEl.value = '';
  const banner = document.getElementById('bannerEditFactura');
  if (banner) banner.classList.add('hidden');
  const btnCancel = document.getElementById('btnCancelarEditFactura');
  if (btnCancel) btnCancel.classList.add('hidden');
  const btnEmitir = document.getElementById('btnEmitirFacturaPos');
  if (btnEmitir) btnEmitir.textContent = '💾 Emitir Factura Fiscal Digital y Registrar en Kardex';
  const titulo = document.getElementById('tituloFormPos');
  if (titulo) titulo.textContent = '🛒 Facturación Fiscal Digital (POS)';

  carritoItems = [];
  posPagosMixtos = [];
  if (posPagoMixtoActivo) togglePagoMixtoPos();
  if (document.getElementById('posReferenciaPago')) document.getElementById('posReferenciaPago').value = '';
  if (document.getElementById('pagoRecibidoUsd')) document.getElementById('pagoRecibidoUsd').value = '0';
  if (document.getElementById('pagoRecibidoBs')) document.getElementById('pagoRecibidoBs').value = '0';
  if (document.getElementById('posFecha')) document.getElementById('posFecha').value = new Date().toISOString().slice(0, 10);
  if (document.getElementById('posMoneda')) document.getElementById('posMoneda').value = 'USD';

  actualizarTablaYCalculos();
  calcularProximoDocumentoVenta();
  if (!silencioso) avisarPos('Edición de factura cancelada.', 'info', 3500);
}

async function ajustarStockProductoYLotes(tenantId, productoId, almId, deltaStock) {
  const { data: pData } = await supabaseClient
    .from('productos')
    .select('*')
    .eq('id', productoId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!pData) return { ok: false, stock: 0, costo: 1, manejaInventario: false };

  const manejaInventario = Boolean(pData.maneja_inventario);
  const stockAnterior = Number(pData.stock || 0);
  const nuevoStock = Math.max(0, stockAnterior + deltaStock);

  if (manejaInventario) {
    await supabaseClient
      .from('productos')
      .update({ stock: nuevoStock })
      .eq('id', productoId)
      .eq('tenant_id', tenantId);

    if (deltaStock < 0 && almId) {
      const { data: lotesDisp } = await supabaseClient
        .from('inventario_lotes')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('producto_id', productoId)
        .eq('almacen_id', almId)
        .gt('stock', 0)
        .order('fecha_vencimiento', { ascending: true, nullsFirst: false });

      let restante = Math.abs(deltaStock);
      for (const l of (lotesDisp || [])) {
        if (restante <= 0) break;
        const stLote = Number(l.stock || 0);
        const descontar = Math.min(stLote, restante);
        await supabaseClient
          .from('inventario_lotes')
          .update({ stock: stLote - descontar, updated_at: new Date().toISOString() })
          .eq('id', l.id)
          .eq('tenant_id', tenantId);
        restante -= descontar;
      }
    } else if (deltaStock > 0) {
      let queryLote = supabaseClient
        .from('inventario_lotes')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('producto_id', productoId)
        .order('created_at', { ascending: true });
      if (almId) queryLote = queryLote.eq('almacen_id', almId);
      const { data: lotesRev } = await queryLote.limit(1);
      if (lotesRev && lotesRev.length > 0) {
        const l0 = lotesRev[0];
        await supabaseClient
          .from('inventario_lotes')
          .update({ stock: Number(l0.stock || 0) + deltaStock, updated_at: new Date().toISOString() })
          .eq('id', l0.id)
          .eq('tenant_id', tenantId);
      }
    }
  }

  return {
    ok: true,
    stock: nuevoStock,
    costo: Number(pData.costo_unitario_usd || 1),
    manejaInventario
  };
}

async function emitirFactura() {
  const tenantId = obtenerTenantPos();
  if (!tenantId) return;

  if (carritoItems.length === 0) { avisarPos('El carrito está vacío. Agrega al menos un artículo o servicio.', 'warning'); return; }

  const itemSinPrecio = carritoItems.find(it => Number(it.precio || 0) <= 0);
  if (itemSinPrecio) {
    avisarPos(`Ningún material puede facturarse sin Precio de Venta mayor a 0 (${itemSinPrecio.descripcion}).`, 'warning', 7500);
    return;
  }

  const rif = (document.getElementById('clienteRif')?.value || '').trim().toUpperCase();
  const nombre = (document.getElementById('clienteNombre')?.value || '').trim().toUpperCase();
  const direccion = (document.getElementById('clienteDireccion')?.value || '').trim();
  const telefono = (document.getElementById('clienteTelefono')?.value || '').trim();
  const tasa = parseFloat(document.getElementById('tasaBcv')?.value) || 0;
  const fechaEmision = document.getElementById('posFecha')?.value || new Date().toISOString().slice(0, 10);
  const moneda = (document.getElementById('posMoneda')?.value || 'USD').toUpperCase();

  if (!rif || !nombre) { avisarPos('Ingresa el RIF/Cédula y Nombre/Razón Social del cliente.', 'warning'); return; }
  if (!direccion) { avisarPos('Ingresa el Domicilio Fiscal del cliente (obligatorio según Art. 13 Providencia SENIAT SNAT/2011/00071).', 'warning', 7000); return; }
  if (tasa <= 0) { avisarPos('Ingresa una Tasa Oficial BCV válida mayor a 0.', 'warning'); return; }

  const editId = document.getElementById('editFacturaId')?.value || '';
  const condicionPago = document.getElementById('posCondicionPago')?.value || 'CONTADO';
  const metodoPagoBase = document.getElementById('metodoPagoSelect')?.value || 'EFECTIVO';
  const referenciaPago = (document.getElementById('posReferenciaPago')?.value || '').trim();
  const sucId = document.getElementById('posSucursalSelect')?.value || '';
  const almId = document.getElementById('posAlmacenSelect')?.value || '';
  const sucObj = posSucursalesCache.find(s => String(s.id) === String(sucId));
  const almObj = posAlmacenesCache.find(a => String(a.id) === String(almId));

  let baseUsd = 0;
  let exentoUsd = 0;
  let ivaUsd = 0;
  const desgloseAlicuotas = {};

  carritoItems.forEach(item => {
    const sub = item.precio * item.cantidad;
    const pct = Number(item.ivaPorcentaje ?? (item.esExento ? 0 : 16));
    if (pct === 0) {
      exentoUsd += sub;
    } else {
      baseUsd += sub;
      const itemIva = sub * (pct / 100);
      ivaUsd += itemIva;
      const key = String(pct);
      if (!desgloseAlicuotas[key]) desgloseAlicuotas[key] = { porcentaje: pct, baseUsd: 0, ivaUsd: 0 };
      desgloseAlicuotas[key].baseUsd += sub;
      desgloseAlicuotas[key].ivaUsd += itemIva;
    }
  });

  const baseBs = baseUsd * tasa;
  const exentoBs = exentoUsd * tasa;
  const subtotalBs = baseBs + exentoBs;
  const ivaBs = ivaUsd * tasa;
  const aplicaIgtf = document.getElementById('aplicaIgtfSelect')?.value === 'SI';
  const baseIgtfUsd = aplicaIgtf ? (baseUsd + exentoUsd + ivaUsd) : 0;
  const igtfBs = aplicaIgtf ? (subtotalBs + ivaBs) * 0.03 : 0;
  const totalBs = subtotalBs + ivaBs + igtfBs;

  const usarPagoMixto = posPagoMixtoActivo && posPagosMixtos.length > 0;
  const metodoResumen = usarPagoMixto
    ? `MIXTO (${posPagosMixtos.map(p => p.metodo).join(' + ')})`
    : metodoPagoBase;

  const monTag = `MON:${moneda}`;
  const maxViaLen = Math.max(0, 50 - monTag.length - 3);
  const viaTrim = metodoResumen.slice(0, maxViaLen);
  let metodoCompuesto = viaTrim ? `${viaTrim} | ${monTag}` : monTag;
  if (metodoCompuesto.length + (` | ${condicionPago}`).length <= 50) {
    metodoCompuesto += ` | ${condicionPago}`;
  }
  metodoCompuesto = metodoCompuesto.slice(0, 50);

  const infoVuelto = calcularVuelto();
  const vueltoUsdFinal = Number(infoVuelto?.vueltoUsd || 0);
  const vueltoBsFinal = Number(infoVuelto?.vueltoBs || 0);
  const turnoCajaId = typeof cajaTurnoActivoCache !== 'undefined' && cajaTurnoActivoCache?.id ? cajaTurnoActivoCache.id : null;
  const pagosMixtosGuardar = usarPagoMixto
    ? posPagosMixtos.map(p => ({ ...p }))
    : [{
        metodo: condicionPago === 'CRÉDITO' ? 'CRÉDITO' : metodoPagoBase,
        moneda,
        montoOriginal: Number((moneda === 'VES' ? totalBs : totalBs / tasa).toFixed(2)),
        montoUsd: Number((totalBs / tasa).toFixed(2)),
        montoBs: Number(totalBs.toFixed(2)),
        referencia: referenciaPago
      }];

  const btnEmitir = document.getElementById('btnEmitirFacturaPos');
  if (btnEmitir) {
    btnEmitir.disabled = true;
    btnEmitir.classList.add('opacity-60', 'cursor-not-allowed');
  }

  try {
    let invResult = null;
    let facturaNro = '';
    let nroControl = '';
    let kardexBloqueadoRls = false;

    if (editId) {
      // MODO EDICIÓN: validar documento existente, revertir Kardex/Stock anterior y aplicar el nuevo
      const { data: docPrev, error: errPrev } = await supabaseClient
        .from('invoices')
        .select('*')
        .eq('id', editId)
        .eq('tenant_id', tenantId)
        .single();

      if (errPrev || !docPrev) {
        avisarPos('No se encontró la factura original a editar.', 'error');
        return;
      }
      const estadoPrev = String(docPrev.estado || '').toUpperCase();
      if (estadoPrev === 'ANULADA' || estadoPrev === 'REVERSO') {
        avisarPos('No se puede editar una factura anulada o un documento de reverso.', 'warning');
        return;
      }

      facturaNro = docPrev.factura_nro;
      nroControl = docPrev.nro_control || '00-00000000';
      const metaPrev = leerMetaFacturaSeniatLocal(tenantId, editId, facturaNro);

      const { data: oldItems } = await supabaseClient
        .from('invoice_items')
        .select('*')
        .eq('invoice_id', editId);

      // Reversar en Kardex y Stock los renglones anteriores antes de reemplazar
      for (const oldIt of (oldItems || [])) {
        if (!oldIt.producto_id) continue;
        const cantOld = Number(oldIt.cantidad || 0);
        if (cantOld <= 0) continue;

        const adj = await ajustarStockProductoYLotes(tenantId, oldIt.producto_id, metaPrev?.almacenId || almId, cantOld);
        if (adj.manejaInventario) {
          const resRevEd = await supabaseClient.from('kardex_movimientos').insert([{
            tenant_id: tenantId,
            producto_id: oldIt.producto_id,
            tipo_movimiento: 'ENTRADA',
            documento_ref: `REV-EDICION | ${facturaNro} | CTRL:${nroControl}${sucObj ? ' | SUC:' + sucObj.nombre : ''}${almObj ? ' | ALM:' + almObj.nombre : ''}`,
            cantidad_in: cantOld,
            cantidad_out: 0,
            saldo_cantidad: adj.stock,
            costo_promedio_usd: adj.costo,
            precio_venta_usd: Number(oldIt.precio_unitario_usd || 0),
            tasa_bcv: tasa,
            fecha: fechaEmision
          }]);
          if (resRevEd.error && String(resRevEd.error.code || '') === '42501') kardexBloqueadoRls = true;
        }
      }

      await supabaseClient.from('invoice_items').delete().eq('invoice_id', editId);
    } else {
      const corr = await calcularProximoDocumentoVenta();
      facturaNro = corr.nextFac;
      nroControl = corr.nextCtrl;
    }

    const cliObj = clientesCache.find(c => String(c.id) === String(clienteIdSeleccionado) || String(c.rif).toUpperCase() === rif);
    const viaObj = posViasPagoCache.find(v => String(v.nombre || '').toUpperCase() === metodoPagoBase.toUpperCase());
    const centroCostoDoc = sucObj?.centro_costo || carritoItems.find(it => it.centroCosto)?.centroCosto || null;
    const diasCreditoCli = Number(cliObj?.condicion_credito_dias || 0);
    const esCredito = String(condicionPago).toUpperCase().includes('CRÉDITO') || String(condicionPago).toUpperCase().includes('CREDITO');
    const fechaVencimiento = esCredito ? sumarDiasFechaIso(fechaEmision, diasCreditoCli || 15) : fechaEmision;
    const costoTotalUsd = carritoItems.reduce((acc, it) => acc + (it.manejaInventario ? (Number(it.costoUnitarioUsd || 0) * Number(it.cantidad || 0)) : 0), 0);
    const costoTotalBs = costoTotalUsd * tasa;
    const periodoContable = fechaEmision.slice(0, 7);

    const payloadInvBase = editId
      ? {
          client_id: clienteIdSeleccionado || null,
          tasa_bcv: tasa,
          monto_usd: baseUsd + exentoUsd,
          subtotal_bs: subtotalBs,
          iva_bs: ivaBs,
          igtf_bs: igtfBs,
          total_bs: totalBs,
          cliente_rif: rif,
          cliente_nombre: nombre,
          metodo_pago: metodoCompuesto,
          estado: 'EMITIDA'
        }
      : {
          tenant_id: tenantId,
          client_id: clienteIdSeleccionado || null,
          factura_nro: facturaNro,
          nro_control: nroControl,
          tasa_bcv: tasa,
          monto_usd: baseUsd + exentoUsd,
          subtotal_bs: subtotalBs,
          iva_bs: ivaBs,
          igtf_bs: igtfBs,
          total_bs: totalBs,
          cliente_rif: rif,
          cliente_nombre: nombre,
          metodo_pago: metodoCompuesto,
          estado: 'EMITIDA'
        };

    const actorPos = typeof obtenerActorActual === 'function' ? obtenerActorActual() : null;
    const actorPosUuid = actorPos?.usuarioId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(actorPos.usuarioId))
      ? actorPos.usuarioId
      : null;

    const payloadInvContable = {
      tipo_documento: 'FACTURA',
      sucursal_id: sucId || null,
      almacen_id: almId || null,
      centro_costo: centroCostoDoc,
      moneda,
      condicion_pago: condicionPago,
      fecha_emision: fechaEmision,
      fecha_vencimiento: fechaVencimiento,
      exento_bs: Number(exentoBs.toFixed(2)),
      base_imponible_bs: Number(baseBs.toFixed(2)),
      base_igtf_bs: Number((baseIgtfUsd * tasa).toFixed(2)),
      costo_total_usd: Number(costoTotalUsd.toFixed(4)),
      costo_total_bs: Number(costoTotalBs.toFixed(2)),
      periodo_contable: periodoContable,
      usuario_id: actorPosUuid,
      usuario_nombre: actorPos?.usuarioNombre || tenantActual?.razon_social || null,
      turno_caja_id: turnoCajaId,
      vuelto_usd: vueltoUsdFinal,
      vuelto_bs: vueltoBsFinal,
      pago_mixto_json: pagosMixtosGuardar
    };

    if (typeof guardarRegistroConCompatibilidadContable === 'function') {
      const resInv = await guardarRegistroConCompatibilidadContable('invoices', editId || null, tenantId, payloadInvBase, payloadInvContable);
      if (!resInv.ok) {
        avisarPos(resInv.message, 'error', 9000);
        return;
      }
      invResult = resInv.data;
    } else {
      const resRaw = editId
        ? await supabaseClient.from('invoices').update(payloadInvBase).eq('id', editId).eq('tenant_id', tenantId).select()
        : await supabaseClient.from('invoices').insert([payloadInvBase]).select();
      if (resRaw.error || !resRaw.data || resRaw.data.length === 0) {
        avisarPos(`Error al ${editId ? 'actualizar' : 'emitir'} factura: ${resRaw.error?.message || 'Error en servidor'}`, 'error', 9000);
        return;
      }
      invResult = resRaw.data[0];
    }

    const invoiceId = invResult.id;
    const fechaAsigIso = invResult.created_at || new Date().toISOString();

    guardarMetaFacturaSeniatLocal(tenantId, invoiceId, facturaNro, {
      moneda,
      fechaEmision,
      fechaVencimiento,
      centroCosto: centroCostoDoc,
      clienteDireccion: direccion,
      clienteTelefono: telefono,
      clienteContribuyenteEspecial: Boolean(cliObj?.es_contribuyente_especial),
      clienteCuentaContable: cliObj?.cuenta_contable || null,
      viaPagoCuentaContable: viaObj?.cuenta_contable || null,
      condicionPago,
      metodoPago: metodoResumen,
      referenciaPago,
      turnoCajaId,
      vueltoUsd: vueltoUsdFinal,
      vueltoBs: vueltoBsFinal,
      pagoMixto: pagosMixtosGuardar,
      usuarioNombre: actorPos?.usuarioNombre || tenantActual?.razon_social || null,
      sucursalId: sucId,
      almacenId: almId,
      sucursalNombre: sucObj?.nombre || 'Sede Principal',
      almacenNombre: almObj?.nombre || 'Almacén General',
      fechaAsignacionControl: fechaAsigIso,
      baseIgtfUsd,
      desgloseAlicuotas,
      itemsMeta: carritoItems.map(it => ({
        productoId: it.productoId,
        sku: it.sku,
        descripcion: it.descripcion,
        unidad: it.unidad,
        cantidad: it.cantidad,
        precio: it.precio,
        costoUnitarioUsd: it.costoUnitarioUsd || 0,
        ivaPorcentaje: it.ivaPorcentaje,
        ivaNombre: it.ivaNombre,
        esExento: it.esExento,
        cuentaIngreso: it.cuentaIngreso || null,
        cuentaCosto: it.cuentaCosto || null
      }))
    });

    for (const item of carritoItems) {
      const subItemUsd = item.precio * item.cantidad;
      const pctItem = Number(item.ivaPorcentaje ?? (item.esExento ? 0 : 16));
      const ivaItemUsd = pctItem === 0 ? 0 : subItemUsd * (pctItem / 100);

      await insertarFilaCompatible('invoice_items', {
        invoice_id: invoiceId,
        producto_id: item.productoId,
        cantidad: item.cantidad,
        precio_unitario_usd: item.precio,
        es_exento: item.esExento,
        subtotal_usd: subItemUsd,
        descripcion: item.descripcion
      }, {
        alicuota_iva: pctItem,
        iva_usd: Number(ivaItemUsd.toFixed(4)),
        iva_bs: Number((ivaItemUsd * tasa).toFixed(2)),
        costo_unitario_usd: Number(item.costoUnitarioUsd || 0),
        cuenta_ingreso: item.cuentaIngreso || null,
        cuenta_costo: item.cuentaCosto || null,
        centro_costo: item.centroCosto || centroCostoDoc
      });

      if (item.manejaInventario) {
        const adj = await ajustarStockProductoYLotes(tenantId, item.productoId, almId, -item.cantidad);
        item.costoUnitarioUsd = item.costoUnitarioUsd || adj.costo;
        const tagEdit = editId ? ' (EDIT)' : '';
        const resKardex = await insertarFilaCompatible('kardex_movimientos', {
          tenant_id: tenantId,
          producto_id: item.productoId,
          tipo_movimiento: 'SALIDA',
          documento_ref: `${facturaNro}${tagEdit} | CTRL:${nroControl}${sucObj ? ' | SUC:' + sucObj.nombre : ''}${almObj ? ' | ALM:' + almObj.nombre : ''}`,
          cantidad_in: 0,
          cantidad_out: item.cantidad,
          saldo_cantidad: adj.stock,
          costo_promedio_usd: adj.costo,
          precio_venta_usd: item.precio,
          tasa_bcv: tasa,
          fecha: fechaEmision
        }, {
          sucursal_id: sucId || null,
          almacen_id: almId || null,
          costo_total_usd: Number((adj.costo * item.cantidad).toFixed(4)),
          costo_total_bs: Number((adj.costo * item.cantidad * tasa).toFixed(2)),
          cuenta_inventario: almObj?.cuenta_inventario || null,
          cuenta_contrapartida: item.cuentaCosto || null,
          centro_costo: item.centroCosto || centroCostoDoc,
          periodo_contable: periodoContable,
          usuario_id: actorPosUuid,
          usuario_nombre: actorPos?.usuarioNombre || null
        });

        if (resKardex.error && String(resKardex.error.code || '') === '42501') {
          kardexBloqueadoRls = true;
        }
      }
    }

    // Registrar desglose en invoice_pagos (soporte nativo v110 con fallback silencioso)
    try {
      if (editId) {
        await supabaseClient.from('invoice_pagos').delete().eq('invoice_id', invoiceId);
      }
      const filasPagos = pagosMixtosGuardar.map(p => ({
        tenant_id: tenantId,
        invoice_id: invoiceId,
        turno_id: turnoCajaId,
        metodo_pago: p.metodo,
        moneda: p.moneda,
        monto_original: Number(p.montoOriginal || 0),
        monto_usd: Number(p.montoUsd || 0),
        monto_bs: Number(p.montoBs || 0),
        referencia: p.referencia || null
      }));
      if (filasPagos.length > 0) {
        await supabaseClient.from('invoice_pagos').insert(filasPagos);
      }
    } catch (e) {}

    if (typeof registrarAsientoAutomaticoVenta === 'function') {
      await registrarAsientoAutomaticoVenta(invResult, carritoItems, {
        fechaEmision,
        moneda,
        condicionPago,
        metodoPago: metodoPagoBase,
        centroCosto: centroCostoDoc,
        clienteCuentaContable: cliObj?.cuenta_contable || null,
        viaPagoCuentaContable: viaObj?.cuenta_contable || null
      });
    }

    avisarPos(
      editId
        ? `¡Factura ${facturaNro} actualizada y contabilizada con éxito!`
        : `¡Factura Fiscal Digital ${facturaNro} (Control ${nroControl}) emitida y contabilizada con éxito!`,
      'success',
      7000
    );
    if (kardexBloqueadoRls) {
      avisarPos('Nota: La factura se guardó, pero "kardex_movimientos" tiene RLS (42501) pendiente en Supabase.', 'warning', 8000);
    }

    cancelarEdicionFactura(true);
    await Promise.all([
      cargarProductosSelect(),
      cargarDocumentosPos(),
      calcularProximoDocumentoVenta(),
      typeof obtenerTurnoCajaActivo === 'function' ? obtenerTurnoCajaActivo(tenantId) : Promise.resolve(),
      typeof cargarHistorial === 'function' ? cargarHistorial() : Promise.resolve(),
      typeof cargarKardexMovimientos === 'function' ? cargarKardexMovimientos() : Promise.resolve()
    ]);

    if (typeof verComprobante === 'function') {
      verComprobante({ ...invResult, tipoDoc: 'FACTURA', numero: invResult.factura_nro });
    }
  } finally {
    if (btnEmitir) {
      btnEmitir.disabled = false;
      btnEmitir.classList.remove('opacity-60', 'cursor-not-allowed');
    }
  }
}

async function cargarDocumentosPos() {
  const tenantId = obtenerTenantPos();
  if (!tenantId) return;

  const { data, error } = await supabaseClient
    .from('invoices')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  const tbody = document.getElementById('tablaDocumentosPos');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-rose-400">Error al cargar facturas: ${esc(error.message)}</td></tr>`;
    return;
  }

  posDocumentosCache = data || [];
  if (posDocumentosCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-500">Sin documentos de venta registrados.</td></tr>`;
    return;
  }

  posDocumentosCache.forEach(doc => {
    const numUpper = String(doc.factura_nro || '').toUpperCase();
    const estadoUpper = String(doc.estado || 'EMITIDA').toUpperCase();
    const esReverso = estadoUpper === 'REVERSO' || numUpper.startsWith('REV-');
    const esAnulada = estadoUpper === 'ANULADA';
    const esNota = numUpper.startsWith('NC-') || numUpper.startsWith('ND-');

    const metaLocal = leerMetaFacturaSeniatLocal(tenantId, doc.id, doc.factura_nro);
    const partesMet = String(doc.metodo_pago || '').split('|').map(s => s.trim());
    const getMet = (pref) => {
      const f = partesMet.find(p => p.startsWith(pref));
      return f ? f.slice(pref.length).trim() : '';
    };
    const monedaDoc = metaLocal?.moneda || getMet('MON:') || 'USD';
    const fechaRaw = metaLocal?.fechaEmision || getMet('FEC:') || (doc.created_at ? doc.created_at.slice(0, 10) : '');
    const mFecha = String(fechaRaw || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    const fechaMostrar = mFecha ? `${mFecha[3]}-${mFecha[2]}-${mFecha[1]}` : (fechaRaw || 'S/F');

    let badgeEstado = `<span class="px-2 py-0.5 rounded text-[10px] bg-emerald-950 text-emerald-300 font-semibold">EMITIDA</span>`;
    if (esAnulada) badgeEstado = `<span class="px-2 py-0.5 rounded text-[10px] bg-rose-950 text-rose-300 font-semibold">ANULADA</span>`;
    if (esReverso) badgeEstado = `<span class="px-2 py-0.5 rounded text-[10px] bg-amber-950 text-amber-300 font-semibold">REVERSO</span>`;
    if (esNota) badgeEstado = `<span class="px-2 py-0.5 rounded text-[10px] bg-sky-950 text-sky-300 font-semibold">NOTA</span>`;

    const tasa = Number(doc.tasa_bcv || 1);
    const totalBs = Number(doc.total_bs || 0);
    const totalUsd = tasa > 0 ? totalBs / tasa : Number(doc.monto_usd || 0);

    const botonesAccion = (!esAnulada && !esReverso && !esNota)
      ? `
        <button type="button" onclick='verComprobantePorId("${esc(doc.id)}")' class="text-emerald-400 hover:underline font-semibold cursor-pointer">Ver / PDF</button>
        <button type="button" onclick='editarFacturaPorId("${esc(doc.id)}")' class="text-sky-400 hover:underline font-semibold cursor-pointer">Editar</button>
        <button type="button" onclick='eliminarFacturaPorId("${esc(doc.id)}")' class="text-rose-400 hover:underline font-semibold cursor-pointer">Eliminar</button>
      `
      : `
        <button type="button" onclick='verComprobantePorId("${esc(doc.id)}")' class="text-emerald-400 hover:underline font-semibold cursor-pointer">Ver / PDF</button>
        <span class="text-slate-500 text-[11px]">${esAnulada ? 'Anulada' : (esReverso ? 'Reverso' : 'Nota')}</span>
      `;

    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/40 ${esAnulada ? 'opacity-65' : ''}">
        <td class="p-3 font-mono font-bold text-white">
          <div>${esc(doc.factura_nro)}</div>
          <div class="mt-0.5">${badgeEstado}</div>
        </td>
        <td class="p-3 font-mono text-slate-300">${esc(doc.nro_control || 'N/A')}</td>
        <td class="p-3 font-mono text-slate-300">${esc(fechaMostrar)}</td>
        <td class="p-3">
          <div class="text-white font-medium">${esc(doc.cliente_nombre || 'CONSUMIDOR FINAL')}</div>
          <div class="text-[11px] text-slate-400 font-mono">${esc(doc.cliente_rif || '')} | Moneda: <span class="text-emerald-400 font-bold">${esc(monedaDoc)}</span></div>
        </td>
        <td class="p-3 font-mono text-slate-300">Bs. ${tasa.toFixed(4)}</td>
        <td class="p-3 font-mono font-bold ${totalBs < 0 ? 'text-amber-400' : 'text-emerald-400'}">
          $ ${totalUsd.toFixed(2)}
          <div class="text-[11px] text-slate-400">Bs. ${totalBs.toFixed(2)}</div>
        </td>
        <td class="p-3 text-center space-x-2 whitespace-nowrap">${botonesAccion}</td>
      </tr>
    `;
  });
}

async function editarFacturaPorId(id) {
  const tenantId = obtenerTenantPos();
  if (!tenantId) return;

  const { data: doc, error } = await supabaseClient
    .from('invoices')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error || !doc) {
    avisarPos('No se pudo cargar la factura seleccionada.', 'error');
    return;
  }

  const estadoUpper = String(doc.estado || '').toUpperCase();
  const numUpper = String(doc.factura_nro || '').toUpperCase();
  if (estadoUpper === 'ANULADA' || estadoUpper === 'REVERSO' || numUpper.startsWith('REV-') || numUpper.startsWith('NC-') || numUpper.startsWith('ND-')) {
    avisarPos('Este tipo de documento o documento anulado no puede editarse.', 'warning');
    return;
  }

  if (productosCache.length === 0) await cargarProductosSelect();
  if (clientesCache.length === 0) await cargarClientesSelect();
  if (posSucursalesCache.length === 0) await cargarSucursalesYAlmacenesPos();

  const { data: itemsDb } = await supabaseClient
    .from('invoice_items')
    .select('*, productos(id, codigo_sku, descripcion, unidad_medida, maneja_inventario, tipos_iva(nombre, porcentaje))')
    .eq('invoice_id', id);

  const metaLocal = leerMetaFacturaSeniatLocal(tenantId, doc.id, doc.factura_nro);
  const partesMet = String(doc.metodo_pago || '').split('|').map(s => s.trim());
  const getMet = (pref) => {
    const f = partesMet.find(p => p.startsWith(pref));
    return f ? f.slice(pref.length).trim() : '';
  };

  document.getElementById('editFacturaId').value = doc.id;
  const banner = document.getElementById('bannerEditFactura');
  const txtBanner = document.getElementById('textoBannerEditFactura');
  if (banner) banner.classList.remove('hidden');
  if (txtBanner) txtBanner.textContent = `✏️ Editando Factura ${doc.factura_nro} (Control: ${doc.nro_control || 'N/A'}) — Al guardar se registrará el ajuste en Kardex.`;

  const btnCancel = document.getElementById('btnCancelarEditFactura');
  if (btnCancel) btnCancel.classList.remove('hidden');
  const btnEmitir = document.getElementById('btnEmitirFacturaPos');
  if (btnEmitir) btnEmitir.textContent = '💾 Guardar Cambios de Factura y Actualizar Kardex';
  const titulo = document.getElementById('tituloFormPos');
  if (titulo) titulo.textContent = `✏️ Editar Factura ${doc.factura_nro}`;
  const badgeDoc = document.getElementById('posProximoDoc');
  if (badgeDoc) badgeDoc.textContent = doc.factura_nro;

  const fechaDoc = metaLocal?.fechaEmision || getMet('FEC:') || (doc.created_at ? doc.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10));
  const monedaDoc = metaLocal?.moneda || getMet('MON:') || 'USD';
  const condFromParts = partesMet.find(p => p === 'CONTADO' || p === 'CRÉDITO' || p === 'CREDITO') || '';
  const condDoc = metaLocal?.condicionPago || getMet('COND:') || (condFromParts === 'CREDITO' ? 'CRÉDITO' : condFromParts) || 'CONTADO';
  const refDoc = metaLocal?.referenciaPago || getMet('REF:') || '';
  const viaDoc = metaLocal?.metodoPago || partesMet[0] || '';

  if (document.getElementById('posFecha')) document.getElementById('posFecha').value = fechaDoc;
  if (document.getElementById('posMoneda')) document.getElementById('posMoneda').value = monedaDoc;
  if (document.getElementById('tasaBcv')) document.getElementById('tasaBcv').value = Number(doc.tasa_bcv || 1).toFixed(4);
  if (document.getElementById('posCondicionPago')) document.getElementById('posCondicionPago').value = condDoc;
  if (document.getElementById('posReferenciaPago')) document.getElementById('posReferenciaPago').value = refDoc;

  if (metaLocal?.sucursalId && document.getElementById('posSucursalSelect')) {
    document.getElementById('posSucursalSelect').value = metaLocal.sucursalId;
    filtrarAlmacenesPosPorSucursal();
  }
  if (metaLocal?.almacenId && document.getElementById('posAlmacenSelect')) {
    document.getElementById('posAlmacenSelect').value = metaLocal.almacenId;
  }

  const selVia = document.getElementById('metodoPagoSelect');
  if (selVia && viaDoc) {
    const optMatch = Array.from(selVia.options).find(o => o.value.toUpperCase() === viaDoc.toUpperCase());
    if (optMatch) selVia.value = optMatch.value;
  }
  const selIgtf = document.getElementById('aplicaIgtfSelect');
  if (selIgtf) selIgtf.value = Number(doc.igtf_bs || 0) > 0 ? 'SI' : 'NO';

  clienteIdSeleccionado = doc.client_id || null;
  if (document.getElementById('clienteSelect')) document.getElementById('clienteSelect').value = doc.client_id || '';
  if (document.getElementById('clienteRif')) document.getElementById('clienteRif').value = doc.cliente_rif || '';
  if (document.getElementById('clienteNombre')) document.getElementById('clienteNombre').value = doc.cliente_nombre || '';

  const cliCacheObj = clientesCache.find(c => String(c.id) === String(doc.client_id) || String(c.rif).toUpperCase() === String(doc.cliente_rif || '').toUpperCase());
  if (document.getElementById('clienteDireccion')) document.getElementById('clienteDireccion').value = metaLocal?.clienteDireccion || cliCacheObj?.direccion || '';
  if (document.getElementById('clienteTelefono')) document.getElementById('clienteTelefono').value = metaLocal?.clienteTelefono || cliCacheObj?.telefono || '';

  carritoItems = (itemsDb || []).map((it, idx) => {
    const metaIt = metaLocal?.itemsMeta?.[idx] || null;
    const prodDb = it.productos || productosCache.find(p => String(p.id) === String(it.producto_id)) || null;
    let pct = 16;
    if (metaIt && metaIt.ivaPorcentaje !== undefined) pct = Number(metaIt.ivaPorcentaje);
    else if (prodDb?.tipos_iva && prodDb.tipos_iva.porcentaje !== undefined) pct = Number(prodDb.tipos_iva.porcentaje);
    else if (prodDb && prodDb._ivaPorcentaje !== undefined) pct = Number(prodDb._ivaPorcentaje);
    else if (it.es_exento) pct = 0;

    return {
      productoId: it.producto_id,
      sku: metaIt?.sku || prodDb?.codigo_sku || 'S/N',
      descripcion: metaIt?.descripcion || prodDb?.descripcion || it.descripcion || 'Artículo',
      precio: Number(it.precio_unitario_usd ?? 0),
      costoUnitarioUsd: Number(metaIt?.costoUnitarioUsd ?? it.costo_unitario_usd ?? prodDb?.costo_unitario_usd ?? 0),
      cantidad: Number(it.cantidad ?? 1),
      esExento: pct === 0,
      ivaPorcentaje: pct,
      ivaNombre: metaIt?.ivaNombre || prodDb?.tipos_iva?.nombre || (pct === 0 ? 'EXENTO' : 'GENERAL'),
      unidad: metaIt?.unidad || prodDb?.unidad_medida || 'UND',
      manejaInventario: prodDb ? Boolean(prodDb.maneja_inventario) : true,
      cuentaIngreso: metaIt?.cuentaIngreso || it.cuenta_ingreso || prodDb?.cuenta_ingreso || null,
      cuentaCosto: metaIt?.cuentaCosto || it.cuenta_costo || prodDb?.cuenta_costo || null
    };
  });

  if (typeof cambiarPestana === 'function') {
    const secPos = document.getElementById('seccionPos');
    if (secPos && secPos.classList.contains('hidden')) {
      cambiarPestana('pos');
    }
  }
  actualizarTablaYCalculos();
  document.getElementById('seccionPos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function eliminarFacturaPorId(id) {
  const tenantId = obtenerTenantPos();
  if (!tenantId) return;

  const { data: doc, error } = await supabaseClient
    .from('invoices')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error || !doc) {
    avisarPos('No se pudo encontrar el documento seleccionado.', 'error');
    return;
  }

  const estadoUpper = String(doc.estado || '').toUpperCase();
  const numUpper = String(doc.factura_nro || '').toUpperCase();
  if (estadoUpper === 'ANULADA' || estadoUpper === 'REVERSO' || numUpper.startsWith('REV-')) {
    avisarPos(`El documento ${doc.factura_nro} ya se encuentra anulado o es un reverso.`, 'warning');
    return;
  }

  const confirmado = typeof pedirConfirmacion === 'function'
    ? await pedirConfirmacion(
        '🗑️ Anular y Reversar Factura',
        `¿Estás seguro de eliminar/anular la factura "${doc.factura_nro}"? Se generará un nuevo documento de reverso y movimientos de ENTRADA (reverso) en el Kardex para conservar el historial.`
      )
    : true;

  if (!confirmado) return;

  const { nextRev, nextCtrl } = await calcularProximoDocumentoVenta();
  const metaLocal = leerMetaFacturaSeniatLocal(tenantId, doc.id, doc.factura_nro);
  const partesMet = String(doc.metodo_pago || '').split('|').map(s => s.trim());
  const getMet = (pref) => {
    const f = partesMet.find(p => p.startsWith(pref));
    return f ? f.slice(pref.length).trim() : '';
  };
  const monedaDoc = metaLocal?.moneda || getMet('MON:') || 'USD';
  const hoy = new Date().toISOString().slice(0, 10);

  const { data: itemsOrig } = await supabaseClient
    .from('invoice_items')
    .select('*')
    .eq('invoice_id', doc.id);

  const metodoRev = `REV ${doc.factura_nro} | MON:${monedaDoc}`.slice(0, 50);

  // 1. Generar nuevo documento de REVERSO en `invoices`
  const { data: revData, error: revErr } = await supabaseClient
    .from('invoices')
    .insert([{
      tenant_id: tenantId,
      client_id: doc.client_id || null,
      factura_nro: nextRev,
      nro_control: nextCtrl,
      tasa_bcv: Number(doc.tasa_bcv || 1),
      monto_usd: -Math.abs(Number(doc.monto_usd || 0)),
      subtotal_bs: -Math.abs(Number(doc.subtotal_bs || 0)),
      iva_bs: -Math.abs(Number(doc.iva_bs || 0)),
      igtf_bs: -Math.abs(Number(doc.igtf_bs || 0)),
      total_bs: -Math.abs(Number(doc.total_bs || 0)),
      cliente_rif: doc.cliente_rif,
      cliente_nombre: doc.cliente_nombre,
      metodo_pago: metodoRev,
      estado: 'REVERSO'
    }])
    .select();

  if (revErr || !revData || revData.length === 0) {
    avisarPos(`Error al generar el documento de reverso: ${revErr?.message || 'Operación denegada.'}`, 'error', 9000);
    return;
  }

  const revDoc = revData[0];

  guardarMetaFacturaSeniatLocal(tenantId, revDoc.id, nextRev, {
    ...(metaLocal || {}),
    moneda: monedaDoc,
    fechaEmision: hoy,
    documentoOrigen: doc.factura_nro,
    fechaAsignacionControl: revDoc.created_at || new Date().toISOString()
  });

  // 2. Insertar detalle del documento de reverso + revertir stock y registrar ENTRADA en Kardex
  let kardexBloqueadoRls = false;
  for (const it of (itemsOrig || [])) {
    const cant = Number(it.cantidad || 0);
    await supabaseClient.from('invoice_items').insert([{
      invoice_id: revDoc.id,
      producto_id: it.producto_id,
      cantidad: cant,
      precio_unitario_usd: -Math.abs(Number(it.precio_unitario_usd || 0)),
      es_exento: Boolean(it.es_exento),
      subtotal_usd: -Math.abs(Number(it.subtotal_usd || 0)),
      descripcion: `REVERSO: ${it.descripcion || ''}`
    }]);

    if (it.producto_id && cant > 0) {
      const adj = await ajustarStockProductoYLotes(tenantId, it.producto_id, metaLocal?.almacenId || '', cant);
      if (adj.manejaInventario) {
        const resKardex = await supabaseClient.from('kardex_movimientos').insert([{
          tenant_id: tenantId,
          producto_id: it.producto_id,
          tipo_movimiento: 'ENTRADA',
          documento_ref: `${nextRev} | REVERSO ANULACION ${doc.factura_nro} | CTRL:${nextCtrl}`,
          cantidad_in: cant,
          cantidad_out: 0,
          saldo_cantidad: adj.stock,
          costo_promedio_usd: adj.costo,
          precio_venta_usd: Number(it.precio_unitario_usd || 0),
          tasa_bcv: Number(doc.tasa_bcv || 1),
          fecha: hoy
        }]);
        if (resKardex.error && String(resKardex.error.code || '') === '42501') {
          kardexBloqueadoRls = true;
        }
      }
    }
  }

  // 3. Marcar la factura original como ANULADA para mantener trazabilidad completa
  await supabaseClient
    .from('invoices')
    .update({ estado: 'ANULADA' })
    .eq('id', doc.id)
    .eq('tenant_id', tenantId);

  if (String(document.getElementById('editFacturaId')?.value || '') === String(doc.id)) {
    cancelarEdicionFactura(true);
  }

  avisarPos(`Factura ${doc.factura_nro} anulada. Se generó el documento ${nextRev} y el movimiento de reverso en Kardex.`, 'success', 7500);
  if (kardexBloqueadoRls) {
    avisarPos('Nota: El documento de reverso se generó, pero "kardex_movimientos" tiene RLS (42501) para registrar la entrada de reverso.', 'warning', 8000);
  }

  await Promise.all([
    cargarDocumentosPos(),
    calcularProximoDocumentoVenta(),
    cargarProductosSelect(),
    typeof obtenerTurnoCajaActivo === 'function' ? obtenerTurnoCajaActivo(tenantId) : Promise.resolve(),
    typeof cargarHistorial === 'function' ? cargarHistorial() : Promise.resolve(),
    typeof cargarKardexMovimientos === 'function' ? cargarKardexMovimientos() : Promise.resolve()
  ]);
}

// ==========================================
// POS-003: CREAR, MODIFICAR Y ELIMINAR CLIENTE DIRECTO DESDE EL POS
// ==========================================

function abrirModalClienteRapidoPos(modo = 'crear') {
  const modal = document.getElementById('modalClienteRapidoPos');
  if (!modal) return;

  const titulo = document.getElementById('posCliModalTitulo');
  const idInput = document.getElementById('posCliRapidoId');
  const rifEl = document.getElementById('posCliRapidoRif');
  const nomEl = document.getElementById('posCliRapidoNombre');
  const telEl = document.getElementById('posCliRapidoTelefono');
  const emailEl = document.getElementById('posCliRapidoEmail');
  const dirEl = document.getElementById('posCliRapidoDireccion');
  const contribEl = document.getElementById('posCliRapidoContrib');

  if (modo === 'editar') {
    const selId = document.getElementById('clienteSelect')?.value || clienteIdSeleccionado;
    const cli = clientesCache.find(c => String(c.id) === String(selId));
    if (!cli) {
      avisarPos('Selecciona primero un cliente registrado en la lista para modificarlo.', 'warning');
      return;
    }
    if (titulo) titulo.textContent = 'Modificar Cliente (POS)';
    if (idInput) idInput.value = cli.id;
    if (rifEl) rifEl.value = cli.rif || '';
    if (nomEl) nomEl.value = cli.razon_social || cli.nombre || '';
    if (telEl) telEl.value = cli.telefono || '';
    if (emailEl) emailEl.value = cli.email || '';
    if (dirEl) dirEl.value = cli.direccion || '';
    if (contribEl) contribEl.value = String(Boolean(cli.es_contribuyente_especial));
  } else {
    if (titulo) titulo.textContent = 'Nuevo Cliente Rápido (POS)';
    if (idInput) idInput.value = '';
    if (rifEl) rifEl.value = document.getElementById('clienteRif')?.value.trim().toUpperCase() || '';
    if (nomEl) nomEl.value = document.getElementById('clienteNombre')?.value.trim() || '';
    if (telEl) telEl.value = document.getElementById('clienteTelefono')?.value.trim() || '';
    if (emailEl) emailEl.value = '';
    if (dirEl) dirEl.value = document.getElementById('clienteDireccion')?.value.trim() || '';
    if (contribEl) contribEl.value = 'false';
  }

  modal.classList.remove('hidden');
}

function cerrarModalClienteRapidoPos() {
  document.getElementById('modalClienteRapidoPos')?.classList.add('hidden');
}

async function guardarClienteRapidoPos(e) {
  if (e) e.preventDefault();
  const tenantId = obtenerTenantPos();
  if (!tenantId || !supabaseClient) return;

  const editId = document.getElementById('posCliRapidoId')?.value || '';
  const rif = (document.getElementById('posCliRapidoRif')?.value || '').trim().toUpperCase();
  const razon_social = (document.getElementById('posCliRapidoNombre')?.value || '').trim().toUpperCase();
  const telefono = (document.getElementById('posCliRapidoTelefono')?.value || '').trim();
  const email = (document.getElementById('posCliRapidoEmail')?.value || '').trim().toLowerCase() || null;
  const direccion = (document.getElementById('posCliRapidoDireccion')?.value || '').trim();
  const es_contribuyente_especial = document.getElementById('posCliRapidoContrib')?.value === 'true';

  if (!rif || !razon_social) {
    avisarPos('RIF / Cédula y Razón Social son obligatorios.', 'warning');
    return;
  }
  if (typeof validarRifVzla === 'function' && !validarRifVzla(rif)) {
    avisarPos('Formato de RIF/Cédula inválido (ej. V-12345678 o J-12345678-0).', 'warning');
    return;
  }

  const payload = { tenant_id: tenantId, rif, razon_social, telefono, email, direccion, es_contribuyente_especial };
  let res;
  if (editId) {
    res = await supabaseClient.from('clientes').update(payload).eq('id', editId).eq('tenant_id', tenantId).select();
  } else {
    res = await supabaseClient.from('clientes').insert([payload]).select();
  }

  if (res.error || !res.data?.[0]) {
    avisarPos(`No se pudo guardar el cliente: ${res.error?.message || 'Error en base de datos'}`, 'error', 7000);
    return;
  }

  const cliGuardado = res.data[0];
  cerrarModalClienteRapidoPos();
  await cargarClientesSelect();
  const sel = document.getElementById('clienteSelect');
  if (sel) sel.value = cliGuardado.id;
  seleccionarClientePredefinido();

  if (typeof cargarClientesGestion === 'function') {
    cargarClientesGestion();
  }
  avisarPos(editId ? `Cliente ${razon_social} actualizado.` : `Cliente ${razon_social} creado y seleccionado en el POS.`, 'success');
}

async function eliminarClienteRapidoPos() {
  const tenantId = obtenerTenantPos();
  if (!tenantId || !supabaseClient) return;

  const selId = document.getElementById('clienteSelect')?.value || clienteIdSeleccionado;
  const cli = clientesCache.find(c => String(c.id) === String(selId));
  if (!cli) {
    avisarPos('Selecciona primero un cliente registrado de la lista para eliminarlo.', 'warning');
    return;
  }

  const ok = typeof pedirConfirmacion === 'function'
    ? await pedirConfirmacion('Eliminar Cliente', `¿Eliminar al cliente "${cli.razon_social || cli.nombre}" (${cli.rif}) del catálogo?`)
    : true;
  if (!ok) return;

  const { error } = await supabaseClient.from('clientes').delete().eq('id', cli.id).eq('tenant_id', tenantId);
  if (error) {
    avisarPos(`No se pudo eliminar el cliente (puede tener facturas asociadas): ${error.message}`, 'error', 7500);
    return;
  }

  clienteIdSeleccionado = null;
  if (document.getElementById('clienteSelect')) document.getElementById('clienteSelect').value = '';
  if (document.getElementById('clienteRif')) document.getElementById('clienteRif').value = '';
  if (document.getElementById('clienteNombre')) document.getElementById('clienteNombre').value = '';
  if (document.getElementById('clienteDireccion')) document.getElementById('clienteDireccion').value = '';
  if (document.getElementById('clienteTelefono')) document.getElementById('clienteTelefono').value = '';

  await cargarClientesSelect();
  if (typeof cargarClientesGestion === 'function') cargarClientesGestion();
  avisarPos('Cliente eliminado del catálogo.', 'success');
}

// ==========================================
// POS-010 / POS-019: IMPRESORA FISCAL VENEZUELA (TFHKA / EPSON VE / ESC-POS)
// ==========================================

let puertoSerialFiscal = null;

function obtenerProtocoloFiscalTenant() {
  const raw = tenantActual?.protocolo_fiscal
    || (tenantActual?.id ? localStorage.getItem(`mfd_protocolo_fiscal_${tenantActual.id}`) : null)
    || 'GENERICO_ESCPOS';
  const norm = String(raw).toUpperCase();
  if (norm === 'TFHKA_VENEZUELA' || norm === 'EPSON_VE') return norm;
  return 'GENERICO_ESCPOS';
}

function sincronizarSelectorProtocoloFiscalPos() {
  const sel = document.getElementById('posProtocoloFiscalSelect');
  if (sel) sel.value = obtenerProtocoloFiscalTenant();
}

async function cambiarProtocoloFiscalPos(nuevoProtocolo) {
  const tenantId = obtenerTenantPos();
  const proto = ['TFHKA_VENEZUELA', 'EPSON_VE', 'GENERICO_ESCPOS'].includes(String(nuevoProtocolo).toUpperCase())
    ? String(nuevoProtocolo).toUpperCase()
    : 'GENERICO_ESCPOS';

  if (tenantId) {
    try { localStorage.setItem(`mfd_protocolo_fiscal_${tenantId}`, proto); } catch (e) {}
  }
  if (tenantActual) {
    tenantActual.protocolo_fiscal = proto;
    try { localStorage.setItem('tenant_actual', JSON.stringify(tenantActual)); } catch (e) {}
  }
  if (supabaseClient && tenantId) {
    try {
      await supabaseClient.from('tenants').update({ protocolo_fiscal: proto }).eq('id', tenantId);
    } catch (e) {}
  }

  const nombres = {
    TFHKA_VENEZUELA: 'The Factory HKA Venezuela (STX/ETX+LRC)',
    EPSON_VE: 'Epson Fiscal VE (TM-T81F / PF-220)',
    GENERICO_ESCPOS: 'Térmica ESC/POS Estándar 80mm'
  };
  avisarPos(`Protocolo de impresora fiscal configurado: ${nombres[proto] || proto}.`, 'success');
}

function calcularLrcTfhka(bytesSinStx) {
  let lrc = 0;
  for (let i = 0; i < bytesSinStx.length; i++) {
    lrc ^= bytesSinStx[i] & 0xFF;
  }
  return lrc & 0xFF;
}

function empaquetarTramaStxEtxLrc(comandoStr) {
  const enc = new TextEncoder();
  const payload = enc.encode(String(comandoStr || ''));
  const body = new Uint8Array(payload.length + 1);
  body.set(payload, 0);
  body[payload.length] = 0x03; // ETX
  const lrc = calcularLrcTfhka(body);

  const frame = new Uint8Array(1 + body.length + 1);
  frame[0] = 0x02; // STX
  frame.set(body, 1);
  frame[frame.length - 1] = lrc;
  return frame;
}

function limpiarAsciiFiscal(txt, maxLen = 40) {
  return String(txt || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function formatearMontoTfhka10(montoBs) {
  const centavos = Math.max(0, Math.round(Number(montoBs || 0) * 100));
  return String(centavos).padStart(10, '0');
}

function formatearCantTfhka8(cant) {
  const miles = Math.max(1, Math.round(Number(cant || 1) * 1000));
  return String(miles).padStart(8, '0');
}

function construirTramaTfhkaFactura(d) {
  if (!d) return { comandos: [], paqueteBytes: new Uint8Array(0), comandosTexto: '' };
  const esNc = String(d.tituloDoc || '').toUpperCase().includes('CREDITO') || String(d.numDoc || '').startsWith('REV-') || String(d.numDoc || '').startsWith('NC-');
  const tasa = Math.max(1, Number(d.tasa || 1));
  const cmds = [];

  // Cabecera de cliente TFHKA Venezuela (iR* / iS* / i01..)
  cmds.push(`iR*${limpiarAsciiFiscal(d.cliRif || 'V-00000000', 18)}`);
  cmds.push(`iS*${limpiarAsciiFiscal(d.cliNombre || 'CONTADO', 40)}`);
  cmds.push(`i01DIRECCION: ${limpiarAsciiFiscal(d.cliDir || 'VENEZUELA', 36)}`);
  cmds.push(`i02DOC DIGITAL: ${limpiarAsciiFiscal(d.numDoc || '', 24)}`);

  (d.items || []).forEach(it => {
    const alic = Number(it.alicuota || 0);
    let pref = ' '; // Exento
    if (alic >= 30) pref = '#'; // Alícuota adicional 31%
    else if (alic >= 15) pref = '!'; // General 16%
    else if (alic > 0) pref = '"'; // Reducida 8%
    if (esNc) pref = 'd' + (pref === ' ' ? '0' : (pref === '!' ? '1' : (pref === '"' ? '2' : '3')));

    const cant = Number(it.cant || 1);
    const totBs = Number(it.totBs || 0);
    const precioUnitBs = totBs > 0 ? totBs / Math.max(0.001, cant) : Number(it.precio || 0) * tasa;
    const desc = limpiarAsciiFiscal(it.desc || 'PRODUCTO', 38);
    cmds.push(`${pref}${formatearMontoTfhka10(precioUnitBs)}${formatearCantTfhka8(cant)}${desc}`);
  });

  cmds.push('3'); // Subtotal
  if (Number(d.igtfBs || 0) > 0) {
    cmds.push(`i03IGTF 3% ART.27: Bs. ${Number(d.igtfBs).toFixed(2)}`);
  }
  cmds.push('101'); // Pago directo total efectivo/vía principal
  cmds.push('199'); // Cierre comprobante fiscal

  const frames = cmds.map(c => empaquetarTramaStxEtxLrc(c));
  const totalBytes = frames.reduce((acc, f) => acc + f.length, 0);
  const paqueteBytes = new Uint8Array(totalBytes);
  let offset = 0;
  frames.forEach(f => {
    paqueteBytes.set(f, offset);
    offset += f.length;
  });

  return {
    comandos: cmds,
    paqueteBytes,
    comandosTexto: cmds.join('\r\n')
  };
}

function construirComandosEpsonVeFactura(d) {
  const enc = new TextEncoder();
  const lines = [
    `@FACTURA|${limpiarAsciiFiscal(d.cliRif || 'V-00000000', 18)}|${limpiarAsciiFiscal(d.cliNombre || 'CONTADO', 40)}`,
    ...(d.items || []).map(it => {
      const pUnitBs = Number(it.totBs || 0) / Math.max(0.001, Number(it.cant || 1));
      return `@ITEM|${limpiarAsciiFiscal(it.desc, 36)}|${Number(it.cant || 1).toFixed(3)}|${pUnitBs.toFixed(2)}|${Number(it.alicuota || 0).toFixed(2)}`;
    }),
    `@SUBTOTAL`,
    `@PAGO|${limpiarAsciiFiscal(d.metodo || 'EFECTIVO', 16)}|${Number(d.totalBs || 0).toFixed(2)}`,
    `@CIERRE\r\n`
  ];
  const texto = lines.join('\r\n');
  return {
    comandos: lines,
    paqueteBytes: enc.encode(texto),
    comandosTexto: texto
  };
}

async function conectarImpresoraFiscalWebSerial() {
  if (!('serial' in navigator)) {
    avisarPos('Tu navegador o visor embebido no soporta WebSerial API. Usa Chrome o Edge en ventana principal, o descarga la Trama TFHKA/Spooler.', 'warning', 7000);
    return null;
  }

  try {
    if (puertoSerialFiscal && puertoSerialFiscal.readable) {
      avisarPos('Impresora fiscal WebSerial ya conectada.', 'info');
      return puertoSerialFiscal;
    }

    const proto = obtenerProtocoloFiscalTenant();
    const puerto = await navigator.serial.requestPort();
    await puerto.open({
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: proto === 'TFHKA_VENEZUELA' ? 'even' : 'none'
    });
    puertoSerialFiscal = puerto;

    const badge = document.getElementById('posEstadoWebSerial');
    if (badge) {
      badge.textContent = `Serial (${proto === 'TFHKA_VENEZUELA' ? 'TFHKA' : (proto === 'EPSON_VE' ? 'Epson VE' : 'ESC/POS')})`;
      badge.className = 'text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40';
    }
    avisarPos(`Impresora fiscal conectada vía WebSerial (${proto}).`, 'success');
    return puertoSerialFiscal;
  } catch (e) {
    if (e?.name !== 'NotFoundError') {
      avisarPos(`Error conectando impresora WebSerial: ${e?.message || e}`, 'error');
    }
    return null;
  }
}

async function imprimirTicketWebSerial() {
  const d = typeof comprobanteRenderCache !== 'undefined' ? comprobanteRenderCache : null;
  if (!d) {
    avisarPos('Abre un comprobante fiscal antes de enviarlo a la impresora WebSerial.', 'warning');
    return;
  }

  const puerto = await conectarImpresoraFiscalWebSerial();
  if (!puerto || !puerto.writable) return;

  const proto = obtenerProtocoloFiscalTenant();
  const writer = puerto.writable.getWriter();
  try {
    if (proto === 'TFHKA_VENEZUELA') {
      const trama = construirTramaTfhkaFactura(d);
      await writer.write(trama.paqueteBytes);
      avisarPos(`Trama fiscal TFHKA (${trama.comandos.length} comandos STX/ETX+LRC) enviada para ${d.numDoc}.`, 'success');
    } else if (proto === 'EPSON_VE') {
      const trama = construirComandosEpsonVeFactura(d);
      await writer.write(trama.paqueteBytes);
      avisarPos(`Comandos fiscales Epson VE enviados para ${d.numDoc}.`, 'success');
    } else {
      const encoder = new TextEncoder();
      const lineas = [
        '\x1B@',
        `${String(d.emisorNombre || '').toUpperCase()}\n`,
        `RIF: ${d.emisorRif || ''}\n`,
        `--------------------------------\n`,
        `${d.tituloDoc || 'FACTURA'}: ${d.numDoc || ''}\n`,
        `CONTROL: ${d.nroControl || ''}\n`,
        `FECHA: ${d.fechaMostrar || ''}\n`,
        `CLIENTE: ${d.cliNombre || ''}\n`,
        `RIF/CI: ${d.cliRif || ''}\n`,
        `--------------------------------\n`,
        ...(d.items || []).map(it => `${Number(it.cant)} x ${String(it.desc).slice(0, 20)}  ${Number(it.totBs).toFixed(2)}\n`),
        `--------------------------------\n`,
        `EXENTO:    Bs. ${Number(d.montoExentoBs || 0).toFixed(2)}\n`,
        `IGTF 3%:   Bs. ${Number(d.igtfBs || 0).toFixed(2)}\n`,
        `TOTAL:     Bs. ${Number(d.totalBs || 0).toFixed(2)}\n`,
        `REF USD:   $ ${(Number(d.totalBs || 0) / Math.max(1, Number(d.tasa || 1))).toFixed(2)}\n`,
        `\n\n\n\x1DV\x00`
      ];
      await writer.write(encoder.encode(lineas.join('')));
      avisarPos(`Documento ${d.numDoc} enviado a impresora ESC/POS WebSerial.`, 'success');
    }
  } catch (e) {
    avisarPos(`Error enviando datos WebSerial: ${e?.message || e}`, 'error');
  } finally {
    writer.releaseLock();
  }
}

async function imprimirReporteFiscalWebSerial(tipo = 'X') {
  const t = String(tipo || 'X').toUpperCase() === 'Z' ? 'Z' : 'X';
  if (t === 'Z' && typeof pedirConfirmacion === 'function') {
    const ok = await pedirConfirmacion('Emitir Reporte Z Fiscal', 'El Reporte Z cierra la jornada fiscal en la memoria de la impresora física. ¿Deseas enviar el comando a la impresora?');
    if (!ok) return;
  }
  const puerto = await conectarImpresoraFiscalWebSerial();
  if (!puerto || !puerto.writable) return;

  const proto = obtenerProtocoloFiscalTenant();
  const writer = puerto.writable.getWriter();
  try {
    if (proto === 'TFHKA_VENEZUELA') {
      const cmd = t === 'Z' ? 'I0Z' : 'I0X';
      await writer.write(empaquetarTramaStxEtxLrc(cmd));
    } else if (proto === 'EPSON_VE') {
      const enc = new TextEncoder();
      await writer.write(enc.encode(t === 'Z' ? '@REPORTE_Z\r\n' : '@REPORTE_X\r\n'));
    } else {
      const enc = new TextEncoder();
      await writer.write(enc.encode(`\x1B@\nCORTE ${t} - ${tenantActual?.razon_social || ''}\n${new Date().toLocaleString()}\n\n\n\x1DV\x00`));
    }
    avisarPos(`Comando Corte ${t} (${proto}) enviado a impresora fiscal.`, 'success');
  } catch (e) {
    avisarPos(`Error enviando Corte ${t}: ${e?.message || e}`, 'error');
  } finally {
    writer.releaseLock();
  }
}

function descargarComandosTfhkaTxt() {
  const d = typeof comprobanteRenderCache !== 'undefined' ? comprobanteRenderCache : null;
  if (!d) {
    avisarPos('Abre un comprobante fiscal para descargar su trama de comandos TFHKA/Spooler.', 'warning');
    return;
  }
  const proto = obtenerProtocoloFiscalTenant();
  const trama = proto === 'EPSON_VE' ? construirComandosEpsonVeFactura(d) : construirTramaTfhkaFactura(d);
  const blob = new Blob([trama.comandosTexto], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Trama_Fiscal_${d.numDoc || 'FAC'}_${proto}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  avisarPos(`Archivo de comandos ${proto} descargado para spooler fiscal.`, 'success');
}
