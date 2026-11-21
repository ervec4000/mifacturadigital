/**
 * /js/catalogos.js
 * Módulo completo y definitivo de Gestión de los 9 Catálogos Maestros (SENIAT 2026)
 * Sincronizado con el esquema exacto de Supabase Multi-Tenant, SheetJS (XLSX),
 * notificaciones en página y validación explícita de respuestas / políticas RLS.
 */

// Caches locales para los 9 maestros
let productosGestionCache = [];
let clientesGestionCache = [];
let proveedoresGestionCache = [];
let unidadesGestionCache = [];
let lotesGestionCache = [];
let sucursalesGestionCache = [];
let almacenesGestionCache = [];
let tiposIvaGestionCache = [];
let viasPagoGestionCache = [];
let tiposIvaSelectCache = [];
let unidadesSelectCache = [];

function avisarUsuario(mensaje, tipo = 'info', duracion = 5000) {
  if (typeof notificarSistema === 'function') {
    notificarSistema(mensaje, tipo, duracion);
  } else {
    console.log(`[${tipo}]`, mensaje);
  }
}

async function confirmarOperacion(titulo, mensaje) {
  if (typeof pedirConfirmacion === 'function') {
    return await pedirConfirmacion(titulo, mensaje);
  }
  return true;
}

function obtenerTenantIdActual() {
  let tid = tenantActual ? (tenantActual.id || tenantActual.tenant_id || null) : null;
  if (!tid && typeof usuarioActual !== 'undefined' && usuarioActual?.tenant_id) {
    tid = usuarioActual.tenant_id;
    if (tenantActual && !tenantActual.id) tenantActual.id = tid;
  }
  if (!tid) {
    avisarUsuario('No se detectó sesión activa de comercio (tenant_id). Inicia sesión nuevamente.', 'error', 7000);
  }
  return tid;
}

function explicarErrorSupabase(tabla, accion, error) {
  const msg = error?.message || 'Error desconocido';
  const code = String(error?.code || '');
  if (code === '42501' || /row-level security|rls|permission denied/i.test(msg)) {
    return `Permiso denegado por Supabase (RLS 42501) al ${accion} en "${tabla}". Debes habilitar las políticas RLS de lectura/escritura para "${tabla}" en Supabase SQL Editor o iniciar sesión con Supabase Auth.`;
  }
  return `Error al ${accion} en "${tabla}": ${msg}`;
}

async function ejecutarGuardarRegistro(tabla, editId, tenantId, payload) {
  let res;
  if (editId) {
    res = await supabaseClient
      .from(tabla)
      .update(payload)
      .eq('id', editId)
      .eq('tenant_id', tenantId)
      .select();
  } else {
    res = await supabaseClient
      .from(tabla)
      .insert([payload])
      .select();
  }

  if (res.error) {
    return { ok: false, message: explicarErrorSupabase(tabla, editId ? 'actualizar' : 'guardar', res.error) };
  }
  if (!res.data || res.data.length === 0) {
    return {
      ok: false,
      message: `Supabase no aplicó cambios al ${editId ? 'actualizar' : 'guardar'} en "${tabla}" (0 filas afectadas). Esto ocurre cuando una política RLS bloquea UPDATE/INSERT para tu sesión actual.`
    };
  }
  return { ok: true, data: res.data[0] };
}

async function ejecutarGuardarRegistroContable(tabla, editId, tenantId, payloadBase, payloadContable = {}) {
  if (typeof guardarRegistroConCompatibilidadContable === 'function') {
    return await guardarRegistroConCompatibilidadContable(tabla, editId, tenantId, payloadBase, payloadContable);
  }
  return await ejecutarGuardarRegistro(tabla, editId, tenantId, payloadBase);
}

async function enriquecerListaContable(tenantId, tabla, lista = []) {
  if (typeof sincronizarMetaContableNube === 'function') {
    await sincronizarMetaContableNube(tenantId, tabla);
  }
  if (typeof obtenerMetaContableRegistro === 'function') {
    return (lista || []).map(r => obtenerMetaContableRegistro(tenantId, tabla, r));
  }
  return lista || [];
}

async function ejecutarEliminarRegistro(tabla, id, tenantId) {
  const res = await supabaseClient
    .from(tabla)
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select();

  if (res.error) {
    return { ok: false, message: explicarErrorSupabase(tabla, 'eliminar', res.error) };
  }
  if (!res.data || res.data.length === 0) {
    return {
      ok: false,
      message: `No se pudo eliminar el registro en "${tabla}" (0 filas eliminadas). Verifica si las políticas RLS de "${tabla}" permiten DELETE para tu sesión.`
    };
  }
  return { ok: true, data: res.data[0] };
}

function setEstadoBotonGuardar(btnId, cargando, textoNormal) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = cargando;
  if (cargando) {
    btn.dataset.textoOriginal = btn.textContent;
    btn.textContent = '⏳ Procesando...';
    btn.classList.add('opacity-60', 'cursor-not-allowed');
  } else {
    btn.textContent = textoNormal || btn.dataset.textoOriginal || '💾 Guardar';
    btn.classList.remove('opacity-60', 'cursor-not-allowed');
  }
}

function enfocarFormularioSeccion(seccionId, inputId) {
  const sec = document.getElementById(seccionId);
  if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const inp = document.getElementById(inputId);
  if (inp) setTimeout(() => inp.focus(), 120);
}

// ==========================================
// 1. GESTIÓN DE PRODUCTOS / ARTÍCULOS
// ==========================================

async function cargarProductosGestion() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;

  const { data, error } = await supabaseClient
    .from('productos')
    .select('*, tipos_iva(id, nombre, porcentaje)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  const tbody = document.getElementById('tablaProductosGestion');
  if (error) {
    const msg = explicarErrorSupabase('productos', 'consultar', error);
    avisarUsuario(msg, 'error', 8000);
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="p-4 text-center text-rose-400">${esc(msg)}</td></tr>`;
    return;
  }
  productosGestionCache = await enriquecerListaContable(tenantId, 'productos', data || []);
  filtrarProductosGestion();
}

function filtrarProductosGestion() {
  const tbody = document.getElementById('tablaProductosGestion');
  if (!tbody) return;
  tbody.innerHTML = '';

  const q = (document.getElementById('filtroProductosGestion')?.value || '').trim().toUpperCase();
  const lista = q
    ? productosGestionCache.filter(prod =>
        String(prod.codigo_sku || '').toUpperCase().includes(q) ||
        String(prod.codigo_barras || '').toUpperCase().includes(q) ||
        String(prod.descripcion || '').toUpperCase().includes(q) ||
        String(prod.categoria || '').toUpperCase().includes(q)
      )
    : productosGestionCache;

  if (lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="p-4 text-center text-slate-500">${q ? 'Ningún artículo coincide con el código o búsqueda.' : 'No hay artículos registrados.'}</td></tr>`;
    return;
  }

  lista.forEach(prod => {
    const pv = Number(prod.precio_venta_usd ?? prod.precio_unitario_usd ?? 0);
    const costo = Number(prod.costo_unitario_usd ?? 0);
    const esExento = prod.tipos_iva ? Number(prod.tipos_iva.porcentaje) === 0 : false;
    const tieneIva = Boolean(prod.tipos_iva);
    const labelIva = tieneIva ? `${prod.tipos_iva.nombre} (${prod.tipos_iva.porcentaje}%)` : 'SIN ASIGNAR';
    const badgeClass = !tieneIva
      ? 'bg-slate-800 text-slate-400'
      : (esExento ? 'bg-sky-950 text-sky-300' : 'bg-emerald-950 text-emerald-300');
    const barrasTxt = prod.codigo_barras ? `<div class="text-[10px] text-sky-300 font-mono mt-0.5">BAR: ${esc(prod.codigo_barras)}</div>` : '';
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/60">
        <td class="p-3 font-mono text-emerald-400 font-bold">${esc(prod.codigo_sku || 'S/N')}${barrasTxt}</td>
        <td class="p-3 text-amber-300 font-semibold">${esc(prod.categoria || 'N/A')}</td>
        <td class="p-3 text-white font-medium">${esc(prod.descripcion)}</td>
        <td class="p-3 font-mono text-slate-300">${esc(prod.ubicacion || 'N/A')}</td>
        <td class="p-3 font-mono text-center">${prod.maneja_inventario ? (prod.stock ?? 0) : 'N/A'}</td>
        <td class="p-3 font-mono">$ ${costo.toFixed(2)}</td>
        <td class="p-3 font-mono text-emerald-400 font-bold">$ ${pv.toFixed(2)}</td>
        <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] ${badgeClass}">${esc(labelIva)}</span></td>
        <td class="p-3 text-center space-x-2">
          <button onclick='editarProducto("${esc(prod.id)}")' class="text-sky-400 hover:underline font-semibold cursor-pointer">Editar</button>
          <button onclick='eliminarProducto("${esc(prod.id)}")' class="text-rose-400 hover:underline font-semibold cursor-pointer">Eliminar</button>
        </td>
      </tr>
    `;
  });
}

function calcularPrecioPorcentaje() {
  const costo = parseFloat(document.getElementById('prodCosto')?.value) || 0;
  const utilidad = parseFloat(document.getElementById('prodUtilidad')?.value) || 0;
  const precioVenta = costo * (1 + (utilidad / 100));
  const inputPV = document.getElementById('prodPrecioVenta');
  if (inputPV) inputPV.value = precioVenta.toFixed(2);
}

function editarProducto(id) {
  const prod = productosGestionCache.find(p => String(p.id) === String(id));
  if (!prod) return;
  document.getElementById('editProductoId').value = prod.id;
  document.getElementById('prodSku').value = prod.codigo_sku || '';
  const inpBar = document.getElementById('prodCodigoBarras');
  if (inpBar) inpBar.value = prod.codigo_barras || '';
  document.getElementById('prodCategoria').value = prod.categoria || '';
  document.getElementById('prodUbicacion').value = prod.ubicacion || '';
  document.getElementById('prodManejaInventario').value = String(prod.maneja_inventario ?? true);
  const unidadProd = prod.unidad_medida || '';
  document.getElementById('prodUnidadMedida').value = unidadProd;
  const inputUnidadBuscar = document.getElementById('prodUnidadBuscar');
  const btnLimpiarUnidad = document.getElementById('btnLimpiarUnidadProd');
  if (inputUnidadBuscar) inputUnidadBuscar.value = unidadProd;
  if (btnLimpiarUnidad) {
    if (unidadProd) btnLimpiarUnidad.classList.remove('hidden'); else btnLimpiarUnidad.classList.add('hidden');
  }
  document.getElementById('prodStock').value = prod.stock ?? 0;
  document.getElementById('prodLote').value = prod.lote || 'SIN-LOTE';
  document.getElementById('prodDescripcion').value = prod.descripcion || '';
  document.getElementById('prodCosto').value = prod.costo_unitario_usd ?? 0;
  document.getElementById('prodUtilidad').value = prod.margen_utilidad_porcentaje ?? 30;
  document.getElementById('prodPrecioVenta').value = prod.precio_venta_usd ?? prod.precio_unitario_usd ?? 0;
  document.getElementById('prodExento').value = prod.tipo_iva_id || '';
  const ivaRef = prod.tipos_iva || tiposIvaSelectCache.find(t => String(t.id) === String(prod.tipo_iva_id));
  const inputIvaBuscar = document.getElementById('prodTipoIvaBuscar');
  const btnLimpiarIva = document.getElementById('btnLimpiarTipoIvaProd');
  if (inputIvaBuscar) {
    inputIvaBuscar.value = ivaRef ? `${ivaRef.nombre} (${ivaRef.porcentaje}%)` : '';
  }
  if (btnLimpiarIva) {
    if (ivaRef) btnLimpiarIva.classList.remove('hidden'); else btnLimpiarIva.classList.add('hidden');
  }
  document.getElementById('prodCuentaContable').value = prod.cuenta_contable || '';
  if (document.getElementById('prodCuentaIngreso')) document.getElementById('prodCuentaIngreso').value = prod.cuenta_ingreso || '';
  if (document.getElementById('prodCuentaCosto')) document.getElementById('prodCuentaCosto').value = prod.cuenta_costo || '';
  if (document.getElementById('prodCuentaDevolucion')) document.getElementById('prodCuentaDevolucion').value = prod.cuenta_devolucion || '';
  if (document.getElementById('prodCentroCosto')) document.getElementById('prodCentroCosto').value = prod.centro_costo_default || '';

  const btnCancel = document.getElementById('btnCancelarProd');
  if (btnCancel) btnCancel.classList.remove('hidden');
  const titulo = document.getElementById('tituloFormProducto');
  if (titulo) titulo.innerText = '✏️ Editar Artículo';
  const btnGuardar = document.getElementById('btnGuardarProducto');
  if (btnGuardar) btnGuardar.textContent = '💾 Actualizar Artículo';
  enfocarFormularioSeccion('seccionProductos', 'prodDescripcion');
}

function limpiarFormProducto() {
  document.getElementById('editProductoId').value = '';
  document.getElementById('prodSku').value = '';
  const inpBar = document.getElementById('prodCodigoBarras');
  if (inpBar) inpBar.value = '';
  document.getElementById('prodCategoria').value = '';
  document.getElementById('prodUbicacion').value = '';
  document.getElementById('prodManejaInventario').value = 'true';
  document.getElementById('prodUnidadMedida').value = '';
  const inputUnidadBuscar = document.getElementById('prodUnidadBuscar');
  if (inputUnidadBuscar) inputUnidadBuscar.value = '';
  const btnLimpiarUnidad = document.getElementById('btnLimpiarUnidadProd');
  if (btnLimpiarUnidad) btnLimpiarUnidad.classList.add('hidden');
  const listaUnidad = document.getElementById('listaBusquedaUnidad');
  if (listaUnidad) listaUnidad.classList.add('hidden');
  document.getElementById('prodStock').value = '100';
  document.getElementById('prodLote').value = 'SIN-LOTE';
  document.getElementById('prodDescripcion').value = '';
  document.getElementById('prodCosto').value = '1.00';
  document.getElementById('prodUtilidad').value = '30.00';
  document.getElementById('prodPrecioVenta').value = '1.30';
  document.getElementById('prodExento').value = '';
  const inputIvaBuscar = document.getElementById('prodTipoIvaBuscar');
  if (inputIvaBuscar) inputIvaBuscar.value = '';
  const btnLimpiarIva = document.getElementById('btnLimpiarTipoIvaProd');
  if (btnLimpiarIva) btnLimpiarIva.classList.add('hidden');
  const listaIva = document.getElementById('listaBusquedaTipoIva');
  if (listaIva) listaIva.classList.add('hidden');
  document.getElementById('prodCuentaContable').value = '';
  if (document.getElementById('prodCuentaIngreso')) document.getElementById('prodCuentaIngreso').value = '';
  if (document.getElementById('prodCuentaCosto')) document.getElementById('prodCuentaCosto').value = '';
  if (document.getElementById('prodCuentaDevolucion')) document.getElementById('prodCuentaDevolucion').value = '';
  if (document.getElementById('prodCentroCosto')) document.getElementById('prodCentroCosto').value = '';

  const btnCancel = document.getElementById('btnCancelarProd');
  if (btnCancel) btnCancel.classList.add('hidden');
  const titulo = document.getElementById('tituloFormProducto');
  if (titulo) titulo.innerText = '📦 Maestro de Artículos y Servicios';
  const btnGuardar = document.getElementById('btnGuardarProducto');
  if (btnGuardar) btnGuardar.textContent = '💾 Guardar Artículo';
}

async function guardarProducto() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const editId = document.getElementById('editProductoId').value;

  let unidadVal = document.getElementById('prodUnidadMedida').value;
  const textoUnidad = (document.getElementById('prodUnidadBuscar')?.value || '').trim().toUpperCase();
  if (!unidadVal && textoUnidad && unidadesSelectCache.length > 0) {
    const coincidenciaUni = unidadesSelectCache.find(u => String(u.nombre || '').trim().toUpperCase() === textoUnidad);
    if (coincidenciaUni) unidadVal = coincidenciaUni.nombre;
  }
  if (!unidadVal) {
    if (unidadesSelectCache.length === 0) {
      avisarUsuario('No hay Unidades de Medida creadas. Crea al menos una en el Maestro de Unidades antes de asignarla.', 'warning', 7000);
    } else {
      avisarUsuario('Busca y selecciona una Unidad de Medida de las creadas en el Maestro de Unidades.', 'warning', 6000);
    }
    abrirBusquedaUnidad();
    return;
  }

  let tipoIvaVal = document.getElementById('prodExento').value;
  const textoIva = (document.getElementById('prodTipoIvaBuscar')?.value || '').trim().toUpperCase();

  if (!tipoIvaVal && textoIva && tiposIvaSelectCache.length > 0) {
    const coincidencia = tiposIvaSelectCache.find(t =>
      `${t.nombre} (${t.porcentaje}%)`.toUpperCase() === textoIva ||
      String(t.nombre || '').toUpperCase() === textoIva
    );
    if (coincidencia) tipoIvaVal = coincidencia.id;
  }

  if (!tipoIvaVal) {
    if (tiposIvaSelectCache.length === 0) {
      avisarUsuario('No hay Tipos de IVA creados. Crea al menos uno en el Maestro de Tipos de IVA antes de asignarlo.', 'warning', 7000);
    } else {
      avisarUsuario('Busca y selecciona un Tipo de IVA de los creados en el Maestro de Tipos de IVA.', 'warning', 6000);
    }
    abrirBusquedaTipoIva();
    return;
  }

  const precioVenta = parseFloat(document.getElementById('prodPrecioVenta').value) || 0;
  if (precioVenta <= 0) {
    avisarUsuario('Ningún material puede guardarse sin Precio de Venta mayor a 0.', 'warning', 7000);
    const inputPv = document.getElementById('prodPrecioVenta');
    if (inputPv) inputPv.focus();
    return;
  }

  const payload = {
    tenant_id: tenantId,
    codigo_sku: document.getElementById('prodSku').value.trim().toUpperCase(),
    categoria: document.getElementById('prodCategoria').value.trim().toUpperCase(),
    ubicacion: document.getElementById('prodUbicacion').value.trim().toUpperCase(),
    descripcion: document.getElementById('prodDescripcion').value.trim().toUpperCase(),
    maneja_inventario: document.getElementById('prodManejaInventario').value === 'true',
    unidad_medida: unidadVal,
    stock: parseFloat(document.getElementById('prodStock').value) || 0,
    lote: document.getElementById('prodLote').value.trim().toUpperCase() || 'SIN-LOTE',
    costo_unitario_usd: parseFloat(document.getElementById('prodCosto').value) || 0,
    margen_utilidad_porcentaje: parseFloat(document.getElementById('prodUtilidad').value) || 30,
    precio_venta_usd: precioVenta,
    precio_unitario_usd: precioVenta,
    tipo_iva_id: tipoIvaVal || null,
    cuenta_contable: document.getElementById('prodCuentaContable').value.trim()
  };

  const codBarrasVal = (document.getElementById('prodCodigoBarras')?.value || '').trim().toUpperCase() || null;

  const payloadContable = {
    codigo_barras: codBarrasVal,
    cuenta_ingreso: (document.getElementById('prodCuentaIngreso')?.value || '').trim() || null,
    cuenta_costo: (document.getElementById('prodCuentaCosto')?.value || '').trim() || null,
    cuenta_devolucion: (document.getElementById('prodCuentaDevolucion')?.value || '').trim() || null,
    centro_costo_default: (document.getElementById('prodCentroCosto')?.value || '').trim().toUpperCase() || null
  };

  if (!payload.descripcion) {
    avisarUsuario('Ingrese la descripción del producto.', 'warning');
    return;
  }

  setEstadoBotonGuardar('btnGuardarProducto', true);
  try {
    const res = await ejecutarGuardarRegistroContable('productos', editId, tenantId, payload, payloadContable);
    if (!res.ok) { avisarUsuario(res.message, 'error', 9000); return; }
    avisarUsuario(editId ? '¡Artículo actualizado con éxito!' : '¡Artículo guardado con éxito!', 'success');
    limpiarFormProducto();
    await cargarProductosGestion();
  } finally {
    setEstadoBotonGuardar('btnGuardarProducto', false, document.getElementById('editProductoId').value ? '💾 Actualizar Artículo' : '💾 Guardar Artículo');
  }
}

async function eliminarProducto(id) {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const prod = productosGestionCache.find(p => String(p.id) === String(id));
  const confirmado = await confirmarOperacion(
    '🗑️ Eliminar Artículo',
    `¿Estás seguro de eliminar el artículo "${prod ? prod.descripcion : ''}"?`
  );
  if (!confirmado) return;

  const res = await ejecutarEliminarRegistro('productos', id, tenantId);
  if (!res.ok) { avisarUsuario(res.message, 'error', 9000); return; }
  avisarUsuario('¡Artículo eliminado!', 'success');
  await cargarProductosGestion();
}

async function exportarStockExcel() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const { data, error } = await supabaseClient.from('productos').select('*, tipos_iva(nombre, porcentaje)').eq('tenant_id', tenantId);
  if (error) { avisarUsuario(explicarErrorSupabase('productos', 'exportar', error), 'error'); return; }
  if (!data || data.length === 0) { avisarUsuario('Sin productos para exportar.', 'warning'); return; }

  const enriquecidos = await enriquecerListaContable(tenantId, 'productos', data);
  const excelData = enriquecidos.map(p => ({
    SKU: p.codigo_sku || 'N/A',
    'Código de Barras': p.codigo_barras || '',
    Categoría: p.categoria || '',
    Descripción: p.descripcion,
    Ubicación: p.ubicacion || '',
    'Control Inventario': p.maneja_inventario ? 'SÍ' : 'NO',
    Unidad: p.unidad_medida || 'UND',
    Stock: p.stock ?? 0,
    Lote: p.lote || 'SIN-LOTE',
    'Costo ($)': p.costo_unitario_usd ?? 0,
    '% Utilidad': p.margen_utilidad_porcentaje ?? 0,
    'Precio Venta ($)': p.precio_venta_usd ?? p.precio_unitario_usd ?? 0,
    'Estatus Fiscal': p.tipos_iva ? `${p.tipos_iva.nombre} (${p.tipos_iva.porcentaje}%)` : 'GRAVADO (16%)',
    'Cta. Inventario': p.cuenta_contable || '',
    'Cta. Ingreso': p.cuenta_ingreso || '',
    'Cta. Costo': p.cuenta_costo || '',
    'Cta. Devolución': p.cuenta_devolucion || '',
    'Centro de Costo': p.centro_costo_default || ''
  }));

  descargarExcelMatriz([Object.keys(excelData[0]), ...excelData.map(Object.values)], 'Catálogo_Productos', 'Productos');
}

// ==========================================
// 2. GESTIÓN DE CLIENTES
// ==========================================

async function cargarClientesGestion() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;

  const { data, error } = await supabaseClient
    .from('clientes')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  const tbody = document.getElementById('tablaClientesGestion');
  if (error) {
    const msg = explicarErrorSupabase('clientes', 'consultar', error);
    avisarUsuario(msg, 'error', 8000);
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-rose-400">${esc(msg)}</td></tr>`;
    return;
  }
  clientesGestionCache = await enriquecerListaContable(tenantId, 'clientes', data || []);

  if (!tbody) return;
  tbody.innerHTML = '';

  if (clientesGestionCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-500">No hay clientes registrados.</td></tr>`;
    return;
  }

  clientesGestionCache.forEach(c => {
    const contrib = Boolean(c.es_contribuyente_especial);
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/60">
        <td class="p-3 font-mono text-emerald-400 font-bold">${esc(c.rif)}</td>
        <td class="p-3 text-white font-medium">${esc(c.razon_social)}</td>
        <td class="p-3">${esc(c.telefono || 'N/A')}</td>
        <td class="p-3 font-mono text-slate-400">${esc(c.email || 'N/A')}</td>
        <td class="p-3 text-slate-300">${esc(c.contacto || 'N/A')}</td>
        <td class="p-3 text-center"><span class="px-2 py-0.5 rounded text-[10px] ${contrib ? 'bg-amber-950 text-amber-300 font-bold' : 'bg-slate-800 text-slate-400'}">${contrib ? 'SÍ' : 'NO'}</span></td>
        <td class="p-3 text-center space-x-2">
          <button onclick='editarCliente("${esc(c.id)}")' class="text-sky-400 hover:underline font-semibold cursor-pointer">Editar</button>
          <button onclick='eliminarCliente("${esc(c.id)}")' class="text-rose-400 hover:underline font-semibold cursor-pointer">Eliminar</button>
        </td>
      </tr>
    `;
  });
}

function editarCliente(id) {
  const c = clientesGestionCache.find(item => String(item.id) === String(id));
  if (!c) return;
  document.getElementById('editClienteId').value = c.id;
  document.getElementById('cliRif').value = c.rif || '';
  document.getElementById('cliRazonSocial').value = c.razon_social || '';
  document.getElementById('cliDireccion').value = c.direccion || '';
  document.getElementById('cliTelefono').value = c.telefono || '';
  document.getElementById('cliEmail').value = c.email || '';
  document.getElementById('cliContacto').value = c.contacto || '';
  document.getElementById('cliContribuyenteEspecial').value = String(Boolean(c.es_contribuyente_especial));
  document.getElementById('cliCuentaContable').value = c.cuenta_contable || '';
  if (document.getElementById('cliCuentaAnticipos')) document.getElementById('cliCuentaAnticipos').value = c.cuenta_anticipos || '';
  if (document.getElementById('cliDiasCredito')) document.getElementById('cliDiasCredito').value = c.condicion_credito_dias ?? 0;
  if (document.getElementById('cliLimiteCredito')) document.getElementById('cliLimiteCredito').value = c.limite_credito_usd ?? 0;

  const btnCancel = document.getElementById('btnCancelarCli');
  if (btnCancel) btnCancel.classList.remove('hidden');
  const titulo = document.getElementById('tituloFormCliente');
  if (titulo) titulo.innerText = '✏️ Editar Cliente';
  const btnGuardar = document.getElementById('btnGuardarCliente');
  if (btnGuardar) btnGuardar.textContent = '💾 Actualizar Cliente';
  enfocarFormularioSeccion('seccionClientes', 'cliRazonSocial');
}

function limpiarFormCliente() {
  document.getElementById('editClienteId').value = '';
  document.getElementById('cliRif').value = '';
  document.getElementById('cliRazonSocial').value = '';
  document.getElementById('cliDireccion').value = '';
  document.getElementById('cliTelefono').value = '';
  document.getElementById('cliEmail').value = '';
  document.getElementById('cliContacto').value = '';
  document.getElementById('cliContribuyenteEspecial').value = 'false';
  document.getElementById('cliCuentaContable').value = '';
  if (document.getElementById('cliCuentaAnticipos')) document.getElementById('cliCuentaAnticipos').value = '';
  if (document.getElementById('cliDiasCredito')) document.getElementById('cliDiasCredito').value = '0';
  if (document.getElementById('cliLimiteCredito')) document.getElementById('cliLimiteCredito').value = '0';

  const btnCancel = document.getElementById('btnCancelarCli');
  if (btnCancel) btnCancel.classList.add('hidden');
  const titulo = document.getElementById('tituloFormCliente');
  if (titulo) titulo.innerText = '👥 Maestro de Clientes';
  const btnGuardar = document.getElementById('btnGuardarCliente');
  if (btnGuardar) btnGuardar.textContent = '💾 Guardar Cliente';
}

async function guardarCliente() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const editId = document.getElementById('editClienteId').value;
  const isContrib = document.getElementById('cliContribuyenteEspecial').value === 'true';
  const payload = {
    tenant_id: tenantId,
    rif: document.getElementById('cliRif').value.trim().toUpperCase(),
    razon_social: document.getElementById('cliRazonSocial').value.trim().toUpperCase(),
    direccion: document.getElementById('cliDireccion').value.trim(),
    telefono: document.getElementById('cliTelefono').value.trim(),
    email: document.getElementById('cliEmail').value.trim().toLowerCase() || null,
    contacto: document.getElementById('cliContacto').value.trim() || null,
    es_contribuyente_especial: isContrib,
    cuenta_contable: document.getElementById('cliCuentaContable').value.trim()
  };
  const payloadContable = {
    cuenta_anticipos: (document.getElementById('cliCuentaAnticipos')?.value || '').trim() || null,
    condicion_credito_dias: parseInt(document.getElementById('cliDiasCredito')?.value || '0', 10) || 0,
    limite_credito_usd: parseFloat(document.getElementById('cliLimiteCredito')?.value || '0') || 0
  };

  if (!payload.rif || !payload.razon_social) {
    avisarUsuario('Ingrese RIF y Razón Social del cliente.', 'warning');
    return;
  }

  setEstadoBotonGuardar('btnGuardarCliente', true);
  try {
    const res = await ejecutarGuardarRegistroContable('clientes', editId, tenantId, payload, payloadContable);
    if (!res.ok) { avisarUsuario(res.message, 'error', 9000); return; }
    avisarUsuario(editId ? '¡Cliente actualizado con éxito!' : '¡Cliente guardado con éxito!', 'success');
    limpiarFormCliente();
    await cargarClientesGestion();
    if (typeof cargarClientesSelect === 'function') await cargarClientesSelect();
  } finally {
    setEstadoBotonGuardar('btnGuardarCliente', false, document.getElementById('editClienteId').value ? '💾 Actualizar Cliente' : '💾 Guardar Cliente');
  }
}

async function eliminarCliente(id) {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const c = clientesGestionCache.find(item => String(item.id) === String(id));
  const confirmado = await confirmarOperacion(
    '🗑️ Eliminar Cliente',
    `¿Estás seguro de eliminar al cliente "${c ? c.razon_social : ''}"?`
  );
  if (!confirmado) return;

  const res = await ejecutarEliminarRegistro('clientes', id, tenantId);
  if (!res.ok) { avisarUsuario(res.message, 'error', 9000); return; }
  avisarUsuario('¡Cliente eliminado!', 'success');
  await cargarClientesGestion();
  if (typeof cargarClientesSelect === 'function') await cargarClientesSelect();
}

async function exportarClientesExcel() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const { data, error } = await supabaseClient.from('clientes').select('*').eq('tenant_id', tenantId);
  if (error) { avisarUsuario(explicarErrorSupabase('clientes', 'exportar', error), 'error'); return; }
  if (!data || data.length === 0) { avisarUsuario('Sin clientes para exportar.', 'warning'); return; }

  const enriquecidos = await enriquecerListaContable(tenantId, 'clientes', data);
  const excelData = enriquecidos.map(c => ({
    RIF: c.rif,
    'Razón Social': c.razon_social,
    Dirección: c.direccion || '',
    Teléfono: c.telefono || '',
    Correo: c.email || '',
    Contacto: c.contacto || '',
    'Contribuyente Especial': c.es_contribuyente_especial ? 'SÍ' : 'NO',
    'Cuenta Contable (CxC)': c.cuenta_contable || '',
    'Cta. Anticipos': c.cuenta_anticipos || '',
    'Días Crédito': c.condicion_credito_dias ?? 0,
    'Límite Crédito ($)': c.limite_credito_usd ?? 0
  }));

  descargarExcelMatriz([Object.keys(excelData[0]), ...excelData.map(Object.values)], 'Directorio_Clientes', 'Clientes');
}

// ==========================================
// 3. GESTIÓN DE PROVEEDORES
// ==========================================

async function cargarProveedoresGestion() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;

  const { data, error } = await supabaseClient
    .from('proveedores')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  const tbody = document.getElementById('tablaProveedoresGestion');
  if (error) {
    const msg = explicarErrorSupabase('proveedores', 'consultar', error);
    avisarUsuario(msg, 'error', 8000);
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-rose-400">${esc(msg)}</td></tr>`;
    return;
  }
  proveedoresGestionCache = await enriquecerListaContable(tenantId, 'proveedores', data || []);

  if (!tbody) return;
  tbody.innerHTML = '';

  if (proveedoresGestionCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-500">No hay proveedores registrados.</td></tr>`;
    return;
  }

  proveedoresGestionCache.forEach(p => {
    const contrib = Boolean(p.es_contribuyente_especial ?? true);
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/60">
        <td class="p-3 font-mono text-emerald-400 font-bold">${esc(p.rif)}</td>
        <td class="p-3 text-white font-medium">${esc(p.razon_social)}</td>
        <td class="p-3">${esc(p.telefono || 'N/A')}</td>
        <td class="p-3 font-mono text-slate-400">${esc(p.email || 'N/A')}</td>
        <td class="p-3 font-mono text-slate-300">${esc(p.cuenta_contable || 'N/A')}</td>
        <td class="p-3 text-center"><span class="px-2 py-0.5 rounded text-[10px] ${contrib ? 'bg-amber-950 text-amber-300 font-bold' : 'bg-slate-800 text-slate-400'}">${contrib ? 'SÍ' : 'NO'}</span></td>
        <td class="p-3 text-center space-x-2">
          <button onclick='editarProveedor("${esc(p.id)}")' class="text-sky-400 hover:underline font-semibold cursor-pointer">Editar</button>
          <button onclick='eliminarProveedor("${esc(p.id)}")' class="text-rose-400 hover:underline font-semibold cursor-pointer">Eliminar</button>
        </td>
      </tr>
    `;
  });
}

function editarProveedor(id) {
  const p = proveedoresGestionCache.find(item => String(item.id) === String(id));
  if (!p) return;
  document.getElementById('editProveedorId').value = p.id;
  document.getElementById('provRif').value = p.rif || '';
  document.getElementById('provRazonSocial').value = p.razon_social || '';
  document.getElementById('provDireccion').value = p.direccion || '';
  document.getElementById('provTelefono').value = p.telefono || '';
  document.getElementById('provEmail').value = p.email || '';
  document.getElementById('provContacto').value = p.contacto || '';
  document.getElementById('provContribuyenteEspecial').value = String(Boolean(p.es_contribuyente_especial ?? true));
  document.getElementById('provCuentaContable').value = p.cuenta_contable || '';
  if (document.getElementById('provTipoPersona')) document.getElementById('provTipoPersona').value = p.tipo_persona || 'PJD';
  if (document.getElementById('provRetencionIvaPct')) document.getElementById('provRetencionIvaPct').value = String(p.retencion_iva_pct ?? 75);
  if (document.getElementById('provDiasCredito')) document.getElementById('provDiasCredito').value = p.condicion_credito_dias ?? 0;
  if (document.getElementById('provCuentaAnticipos')) document.getElementById('provCuentaAnticipos').value = p.cuenta_anticipos || '';

  const btnCancel = document.getElementById('btnCancelarProv');
  if (btnCancel) btnCancel.classList.remove('hidden');
  const titulo = document.getElementById('tituloFormProveedor');
  if (titulo) titulo.innerText = '✏️ Editar Proveedor';
  const btnGuardar = document.getElementById('btnGuardarProveedor');
  if (btnGuardar) btnGuardar.textContent = '💾 Actualizar Proveedor';
  enfocarFormularioSeccion('seccionProveedores', 'provRazonSocial');
}

function limpiarFormProveedor() {
  document.getElementById('editProveedorId').value = '';
  document.getElementById('provRif').value = '';
  document.getElementById('provRazonSocial').value = '';
  document.getElementById('provDireccion').value = '';
  document.getElementById('provTelefono').value = '';
  document.getElementById('provEmail').value = '';
  document.getElementById('provContacto').value = '';
  document.getElementById('provContribuyenteEspecial').value = 'true';
  document.getElementById('provCuentaContable').value = '';
  if (document.getElementById('provTipoPersona')) document.getElementById('provTipoPersona').value = 'PJD';
  if (document.getElementById('provRetencionIvaPct')) document.getElementById('provRetencionIvaPct').value = '75';
  if (document.getElementById('provDiasCredito')) document.getElementById('provDiasCredito').value = '0';
  if (document.getElementById('provCuentaAnticipos')) document.getElementById('provCuentaAnticipos').value = '';

  const btnCancel = document.getElementById('btnCancelarProv');
  if (btnCancel) btnCancel.classList.add('hidden');
  const titulo = document.getElementById('tituloFormProveedor');
  if (titulo) titulo.innerText = '🏭 Maestro de Proveedores';
  const btnGuardar = document.getElementById('btnGuardarProveedor');
  if (btnGuardar) btnGuardar.textContent = '💾 Guardar Proveedor';
}

async function guardarProveedor() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const editId = document.getElementById('editProveedorId').value;
  const isContrib = document.getElementById('provContribuyenteEspecial').value === 'true';
  const payload = {
    tenant_id: tenantId,
    rif: document.getElementById('provRif').value.trim().toUpperCase(),
    razon_social: document.getElementById('provRazonSocial').value.trim().toUpperCase(),
    direccion: document.getElementById('provDireccion').value.trim(),
    telefono: document.getElementById('provTelefono').value.trim(),
    email: document.getElementById('provEmail').value.trim().toLowerCase() || null,
    contacto: document.getElementById('provContacto').value.trim() || null,
    es_contribuyente_especial: isContrib,
    cuenta_contable: document.getElementById('provCuentaContable').value.trim()
  };
  const payloadContable = {
    tipo_persona: document.getElementById('provTipoPersona')?.value || 'PJD',
    retencion_iva_pct: parseFloat(document.getElementById('provRetencionIvaPct')?.value || '75') || 0,
    condicion_credito_dias: parseInt(document.getElementById('provDiasCredito')?.value || '0', 10) || 0,
    cuenta_anticipos: (document.getElementById('provCuentaAnticipos')?.value || '').trim() || null
  };

  if (!payload.rif || !payload.razon_social) {
    avisarUsuario('Ingrese RIF y Razón Social del proveedor.', 'warning');
    return;
  }

  setEstadoBotonGuardar('btnGuardarProveedor', true);
  try {
    const res = await ejecutarGuardarRegistroContable('proveedores', editId, tenantId, payload, payloadContable);
    if (!res.ok) { avisarUsuario(res.message, 'error', 9000); return; }
    avisarUsuario(editId ? '¡Proveedor actualizado con éxito!' : '¡Proveedor guardado con éxito!', 'success');
    limpiarFormProveedor();
    await cargarProveedoresGestion();
  } finally {
    setEstadoBotonGuardar('btnGuardarProveedor', false, document.getElementById('editProveedorId').value ? '💾 Actualizar Proveedor' : '💾 Guardar Proveedor');
  }
}

async function eliminarProveedor(id) {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const p = proveedoresGestionCache.find(item => String(item.id) === String(id));
  const confirmado = await confirmarOperacion(
    '🗑️ Eliminar Proveedor',
    `¿Estás seguro de eliminar al proveedor "${p ? p.razon_social : ''}"?`
  );
  if (!confirmado) return;

  const res = await ejecutarEliminarRegistro('proveedores', id, tenantId);
  if (!res.ok) { avisarUsuario(res.message, 'error', 9000); return; }
  avisarUsuario('¡Proveedor eliminado!', 'success');
  await cargarProveedoresGestion();
}

async function exportarProveedoresExcel() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const { data, error } = await supabaseClient.from('proveedores').select('*').eq('tenant_id', tenantId);
  if (error) { avisarUsuario(explicarErrorSupabase('proveedores', 'exportar', error), 'error'); return; }
  if (!data || data.length === 0) { avisarUsuario('Sin proveedores para exportar.', 'warning'); return; }

  const enriquecidos = await enriquecerListaContable(tenantId, 'proveedores', data);
  const excelData = enriquecidos.map(p => ({
    RIF: p.rif,
    'Razón Social': p.razon_social,
    Dirección: p.direccion || '',
    Teléfono: p.telefono || '',
    Correo: p.email || '',
    Contacto: p.contacto || '',
    'Contribuyente Especial': p.es_contribuyente_especial ? 'SÍ' : 'NO',
    'Cuenta Contable (CxP)': p.cuenta_contable || '',
    'Tipo Persona': p.tipo_persona || 'PJD',
    '% Retención IVA': p.retencion_iva_pct ?? 75,
    'Días Crédito': p.condicion_credito_dias ?? 0,
    'Cta. Anticipos': p.cuenta_anticipos || ''
  }));

  descargarExcelMatriz([Object.keys(excelData[0]), ...excelData.map(Object.values)], 'Directorio_Proveedores', 'Proveedores');
}

// ==========================================
// 4. GESTIÓN DE UNIDADES DE MEDIDA
// ==========================================

async function cargarUnidadesMedidaGestion() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;

  const { data, error } = await supabaseClient
    .from('unidades_medida')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  const tbody = document.getElementById('tablaUnidadesGestion');
  if (error) {
    const msg = explicarErrorSupabase('unidades_medida', 'consultar', error);
    avisarUsuario(msg, 'error', 8000);
    if (tbody) tbody.innerHTML = `<tr><td colspan="3" class="p-4 text-center text-rose-400">${esc(msg)}</td></tr>`;
    return;
  }
  unidadesGestionCache = data || [];

  if (!tbody) return;
  tbody.innerHTML = '';

  if (unidadesGestionCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="p-4 text-center text-slate-500">Sin unidades personalizadas. Se usan las estándar (UND, KG, LTS).</td></tr>`;
    return;
  }

  unidadesGestionCache.forEach(u => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/60">
        <td class="p-3 font-mono font-bold text-emerald-400">${esc(u.nombre)}</td>
        <td class="p-3 text-slate-400">${formatearFecha8Digitos(u.created_at)}</td>
        <td class="p-3 text-center space-x-2">
          <button onclick='editarUnidadMedida("${esc(u.id)}")' class="text-sky-400 hover:underline font-semibold cursor-pointer">Editar</button>
          <button onclick='eliminarUnidadMedida("${esc(u.id)}")' class="text-rose-400 hover:underline font-semibold cursor-pointer">Eliminar</button>
        </td>
      </tr>
    `;
  });
}

function editarUnidadMedida(id) {
  const u = unidadesGestionCache.find(item => String(item.id) === String(id));
  if (!u) return;
  document.getElementById('editUnidadId').value = u.id;
  document.getElementById('inputNuevaUnidad').value = u.nombre || '';
  const btnCancel = document.getElementById('btnCancelarUnidad');
  if (btnCancel) btnCancel.classList.remove('hidden');
  const titulo = document.getElementById('tituloFormUnidad');
  if (titulo) titulo.innerText = '✏️ Editar Unidad de Medida';
  const btnGuardar = document.getElementById('btnGuardarUnidad');
  if (btnGuardar) btnGuardar.textContent = '💾 Actualizar Unidad';
  enfocarFormularioSeccion('seccionUnidades', 'inputNuevaUnidad');
}

function limpiarFormUnidadMedida() {
  document.getElementById('editUnidadId').value = '';
  document.getElementById('inputNuevaUnidad').value = '';
  const btnCancel = document.getElementById('btnCancelarUnidad');
  if (btnCancel) btnCancel.classList.add('hidden');
  const titulo = document.getElementById('tituloFormUnidad');
  if (titulo) titulo.innerText = '📐 Maestro de Unidades de Medida';
  const btnGuardar = document.getElementById('btnGuardarUnidad');
  if (btnGuardar) btnGuardar.textContent = '💾 Guardar Unidad';
}

async function guardarUnidadMedida() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const editId = document.getElementById('editUnidadId').value;
  const nombre = document.getElementById('inputNuevaUnidad').value.trim().toUpperCase();

  if (!nombre) {
    avisarUsuario('Ingrese el nombre o abreviatura de la unidad.', 'warning');
    return;
  }

  setEstadoBotonGuardar('btnGuardarUnidad', true);
  try {
    const res = await ejecutarGuardarRegistro('unidades_medida', editId, tenantId, { tenant_id: tenantId, nombre });
    if (!res.ok) { avisarUsuario(res.message, 'error', 9000); return; }
    avisarUsuario(editId ? '¡Unidad de medida actualizada!' : '¡Unidad de medida guardada con éxito!', 'success');
    limpiarFormUnidadMedida();
    await cargarUnidadesMedidaGestion();
    await cargarUnidadesSelectForm();
  } finally {
    setEstadoBotonGuardar('btnGuardarUnidad', false, document.getElementById('editUnidadId').value ? '💾 Actualizar Unidad' : '💾 Guardar Unidad');
  }
}

async function eliminarUnidadMedida(id) {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const u = unidadesGestionCache.find(item => String(item.id) === String(id));
  const confirmado = await confirmarOperacion(
    '🗑️ Eliminar Unidad de Medida',
    `¿Eliminar la unidad de medida "${u ? u.nombre : ''}"?`
  );
  if (!confirmado) return;

  const res = await ejecutarEliminarRegistro('unidades_medida', id, tenantId);
  if (!res.ok) { avisarUsuario(res.message, 'error', 9000); return; }
  avisarUsuario('¡Unidad eliminada!', 'success');
  await cargarUnidadesMedidaGestion();
  await cargarUnidadesSelectForm();
}

async function exportarUnidadesExcel() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const { data, error } = await supabaseClient.from('unidades_medida').select('*').eq('tenant_id', tenantId);
  if (error) { avisarUsuario(explicarErrorSupabase('unidades_medida', 'exportar', error), 'error'); return; }
  if (!data || data.length === 0) { avisarUsuario('Sin unidades registradas.', 'warning'); return; }

  const excelData = data.map(u => ({
    'Abreviatura / Nombre': u.nombre,
    'Fecha Registro': formatearFecha8Digitos(u.created_at)
  }));

  descargarExcelMatriz([Object.keys(excelData[0]), ...excelData.map(Object.values)], 'Unidades_Medida', 'Unidades');
}

// ==========================================
// 5. GESTIÓN DE LOTES DE INVENTARIO
// ==========================================

async function cargarLotesGestion() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;

  const { data, error } = await supabaseClient
    .from('inventario_lotes')
    .select('*, productos(descripcion, codigo_sku, unidad_medida), almacenes(id, nombre, tipo, sucursales(nombre))')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  const tbody = document.getElementById('tablaLotesGestion');
  if (error) {
    const msg = explicarErrorSupabase('inventario_lotes', 'consultar', error);
    avisarUsuario(msg, 'error', 8000);
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-rose-400">${esc(msg)}</td></tr>`;
    return;
  }
  lotesGestionCache = data || [];

  if (!tbody) return;
  tbody.innerHTML = '';

  if (lotesGestionCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-500">No hay lotes registrados.</td></tr>`;
    return;
  }

  const hoyMs = new Date().setHours(0, 0, 0, 0);

  lotesGestionCache.forEach(l => {
    const prodNombre = l.productos?.descripcion || 'N/A';
    const prodSku = l.productos?.codigo_sku || 'S/N';
    const prodUni = l.productos?.unidad_medida || '';
    const sucNombre = l.almacenes?.sucursales?.nombre || 'General';
    const almNombre = l.almacenes?.nombre || 'Sin Almacén';
    const st = l.stock ?? 0;
    const fVenc = l.fecha_vencimiento || '';

    let badgeVenc = `<span class="text-slate-500">Sin venc.</span>`;
    if (fVenc) {
      const diffDias = Math.ceil((new Date(fVenc + 'T00:00:00').getTime() - hoyMs) / 86400000);
      if (diffDias < 0) {
        badgeVenc = `<span class="px-2 py-0.5 rounded text-[10px] bg-rose-950 text-rose-300 font-bold">${esc(fVenc)} (VENCIDO)</span>`;
      } else if (diffDias <= 30) {
        badgeVenc = `<span class="px-2 py-0.5 rounded text-[10px] bg-amber-950 text-amber-300 font-bold">${esc(fVenc)} (${diffDias}d)</span>`;
      } else {
        badgeVenc = `<span class="px-2 py-0.5 rounded text-[10px] bg-emerald-950/70 text-emerald-300">${esc(fVenc)}</span>`;
      }
    }

    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/60">
        <td class="p-3 font-mono text-emerald-400 font-bold">${esc(l.numero_lote)}</td>
        <td class="p-3 text-white font-medium">${esc(prodSku)} - ${esc(prodNombre)}</td>
        <td class="p-3 text-slate-300"><span class="text-slate-400">${esc(sucNombre)}</span> → <span class="text-sky-300 font-semibold">${esc(almNombre)}</span></td>
        <td class="p-3 font-mono text-slate-300">${esc(l.ubicacion || 'N/A')}</td>
        <td class="p-3 font-mono text-center font-bold text-amber-300">${st} ${esc(prodUni)}</td>
        <td class="p-3 font-mono">${badgeVenc}</td>
        <td class="p-3 text-center space-x-2">
          <button onclick='editarLote("${esc(l.id)}")' class="text-sky-400 hover:underline font-semibold cursor-pointer">Editar</button>
          <button onclick='eliminarLote("${esc(l.id)}")' class="text-rose-400 hover:underline font-semibold cursor-pointer">Eliminar</button>
        </td>
      </tr>
    `;
  });
}

function editarLote(id) {
  const l = lotesGestionCache.find(item => String(item.id) === String(id));
  if (!l) return;
  document.getElementById('editLoteId').value = l.id;
  document.getElementById('loteProductoSelect').value = l.producto_id || '';
  document.getElementById('loteAlmacenSelect').value = l.almacen_id || '';
  document.getElementById('loteNumero').value = l.numero_lote || '';
  document.getElementById('loteStock').value = l.stock ?? 0;
  document.getElementById('loteUbicacion').value = l.ubicacion || '';
  document.getElementById('loteFechaVencimiento').value = l.fecha_vencimiento || '';

  const btnCancel = document.getElementById('btnCancelarLote');
  if (btnCancel) btnCancel.classList.remove('hidden');
  const titulo = document.getElementById('tituloFormLote');
  if (titulo) titulo.innerText = '✏️ Editar Lote de Inventario';
  const btnGuardar = document.getElementById('btnGuardarLote');
  if (btnGuardar) btnGuardar.textContent = '💾 Actualizar Lote';
  enfocarFormularioSeccion('seccionLotes', 'loteNumero');
}

function limpiarFormLote() {
  document.getElementById('editLoteId').value = '';
  document.getElementById('loteNumero').value = '';
  document.getElementById('loteStock').value = '0';
  document.getElementById('loteUbicacion').value = '';
  document.getElementById('loteFechaVencimiento').value = '';
  const btnCancel = document.getElementById('btnCancelarLote');
  if (btnCancel) btnCancel.classList.add('hidden');
  const titulo = document.getElementById('tituloFormLote');
  if (titulo) titulo.innerText = '🏷️ Maestro de Lotes de Inventario';
  const btnGuardar = document.getElementById('btnGuardarLote');
  if (btnGuardar) btnGuardar.textContent = '💾 Guardar Lote';
}

async function guardarLote() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const editId = document.getElementById('editLoteId').value;
  const stVal = parseFloat(document.getElementById('loteStock').value) || 0;
  const fVencVal = document.getElementById('loteFechaVencimiento').value || null;
  const almId = document.getElementById('loteAlmacenSelect')?.value || null;

  const payload = {
    tenant_id: tenantId,
    producto_id: document.getElementById('loteProductoSelect').value,
    almacen_id: almId,
    numero_lote: document.getElementById('loteNumero').value.trim().toUpperCase(),
    stock: stVal,
    ubicacion: document.getElementById('loteUbicacion').value.trim().toUpperCase(),
    fecha_vencimiento: fVencVal,
    updated_at: new Date().toISOString()
  };

  if (!payload.producto_id || !payload.numero_lote) {
    avisarUsuario('Seleccione un producto e ingrese el número de lote.', 'warning');
    return;
  }

  setEstadoBotonGuardar('btnGuardarLote', true);
  try {
    const res = await ejecutarGuardarRegistro('inventario_lotes', editId, tenantId, payload);
    if (!res.ok) { avisarUsuario(res.message, 'error', 9000); return; }
    avisarUsuario(editId ? '¡Lote actualizado con éxito!' : '¡Lote guardado con éxito!', 'success');
    limpiarFormLote();
    await cargarLotesGestion();
  } finally {
    setEstadoBotonGuardar('btnGuardarLote', false, document.getElementById('editLoteId').value ? '💾 Actualizar Lote' : '💾 Guardar Lote');
  }
}

async function eliminarLote(id) {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const l = lotesGestionCache.find(item => String(item.id) === String(id));
  const confirmado = await confirmarOperacion(
    '🗑️ Eliminar Lote',
    `¿Eliminar el registro de lote "${l ? l.numero_lote : ''}"?`
  );
  if (!confirmado) return;

  const res = await ejecutarEliminarRegistro('inventario_lotes', id, tenantId);
  if (!res.ok) { avisarUsuario(res.message, 'error', 9000); return; }
  avisarUsuario('¡Lote eliminado!', 'success');
  await cargarLotesGestion();
}

async function exportarLotesExcel() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const { data, error } = await supabaseClient
    .from('inventario_lotes')
    .select('*, productos(descripcion, codigo_sku), almacenes(nombre, sucursales(nombre))')
    .eq('tenant_id', tenantId);
  if (error) { avisarUsuario(explicarErrorSupabase('inventario_lotes', 'exportar', error), 'error'); return; }
  if (!data || data.length === 0) { avisarUsuario('Sin lotes para exportar.', 'warning'); return; }

  const excelData = data.map(l => ({
    Lote: l.numero_lote,
    SKU: l.productos?.codigo_sku || 'N/A',
    Material: l.productos?.descripcion || 'N/A',
    Sucursal: l.almacenes?.sucursales?.nombre || 'General',
    Almacén: l.almacenes?.nombre || 'Sin Almacén',
    Ubicación: l.ubicacion || '',
    Stock: l.stock ?? 0,
    'Fecha Vencimiento': l.fecha_vencimiento || 'N/A'
  }));

  descargarExcelMatriz([Object.keys(excelData[0]), ...excelData.map(Object.values)], 'Control_Lotes', 'Lotes');
}

// ==========================================
// 6. GESTIÓN DE SUCURSALES
// ==========================================

async function cargarSucursalesGestion() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;

  const { data, error } = await supabaseClient
    .from('sucursales')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  const tbody = document.getElementById('tablaSucursalesGestion');
  if (error) {
    const msg = explicarErrorSupabase('sucursales', 'consultar', error);
    avisarUsuario(msg, 'error', 8000);
    if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-rose-400">${esc(msg)}</td></tr>`;
    return;
  }
  sucursalesGestionCache = await enriquecerListaContable(tenantId, 'sucursales', data || []);

  if (!tbody) return;
  tbody.innerHTML = '';

  if (sucursalesGestionCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-500">Sin sucursales registradas.</td></tr>`;
    return;
  }

  sucursalesGestionCache.forEach(s => {
    const ccBadge = s.centro_costo ? `<span class="ml-1.5 px-1.5 py-0.5 rounded bg-slate-800 text-sky-300 font-mono text-[10px]">${esc(s.centro_costo)}</span>` : '';
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/60">
        <td class="p-3 font-bold text-emerald-400">${esc(s.nombre)}${ccBadge}</td>
        <td class="p-3 text-slate-300">${esc(s.direccion || 'N/A')}</td>
        <td class="p-3 font-mono text-slate-400">${formatearFecha8Digitos(s.created_at)}</td>
        <td class="p-3 text-center space-x-2">
          <button onclick='editarSucursal("${esc(s.id)}")' class="text-sky-400 hover:underline font-semibold cursor-pointer">Editar</button>
          <button onclick='eliminarSucursal("${esc(s.id)}")' class="text-rose-400 hover:underline font-semibold cursor-pointer">Eliminar</button>
        </td>
      </tr>
    `;
  });
}

function editarSucursal(id) {
  const s = sucursalesGestionCache.find(item => String(item.id) === String(id));
  if (!s) return;
  document.getElementById('editSucursalId').value = s.id;
  document.getElementById('sucursalNombre').value = s.nombre || '';
  document.getElementById('sucursalDireccion').value = s.direccion || '';
  if (document.getElementById('sucursalCentroCosto')) document.getElementById('sucursalCentroCosto').value = s.centro_costo || '';
  const btnCancel = document.getElementById('btnCancelarSucursal');
  if (btnCancel) btnCancel.classList.remove('hidden');
  const titulo = document.getElementById('tituloFormSucursal');
  if (titulo) titulo.innerText = '✏️ Editar Sucursal';
  const btnGuardar = document.getElementById('btnGuardarSucursal');
  if (btnGuardar) btnGuardar.textContent = '💾 Actualizar Sucursal';
  enfocarFormularioSeccion('seccionSucursales', 'sucursalNombre');
}

function limpiarFormSucursal() {
  document.getElementById('editSucursalId').value = '';
  document.getElementById('sucursalNombre').value = '';
  document.getElementById('sucursalDireccion').value = '';
  if (document.getElementById('sucursalCentroCosto')) document.getElementById('sucursalCentroCosto').value = '';
  const btnCancel = document.getElementById('btnCancelarSucursal');
  if (btnCancel) btnCancel.classList.add('hidden');
  const titulo = document.getElementById('tituloFormSucursal');
  if (titulo) titulo.innerText = '🏛️ Maestro de Sucursales';
  const btnGuardar = document.getElementById('btnGuardarSucursal');
  if (btnGuardar) btnGuardar.textContent = '💾 Guardar Sucursal';
}

async function guardarSucursal() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const editId = document.getElementById('editSucursalId').value;
  const payload = {
    tenant_id: tenantId,
    nombre: document.getElementById('sucursalNombre').value.trim().toUpperCase(),
    direccion: document.getElementById('sucursalDireccion').value.trim()
  };
  const payloadContable = {
    centro_costo: (document.getElementById('sucursalCentroCosto')?.value || '').trim().toUpperCase() || null
  };

  if (!payload.nombre) {
    avisarUsuario('Ingrese el nombre de la sucursal.', 'warning');
    return;
  }

  setEstadoBotonGuardar('btnGuardarSucursal', true);
  try {
    const res = await ejecutarGuardarRegistroContable('sucursales', editId, tenantId, payload, payloadContable);
    if (!res.ok) { avisarUsuario(res.message, 'error', 9000); return; }
    avisarUsuario(editId ? '¡Sucursal actualizada con éxito!' : '¡Sucursal guardada con éxito!', 'success');
    limpiarFormSucursal();
    await cargarSucursalesGestion();
    await cargarSucursalesSelectAlmacen();
  } finally {
    setEstadoBotonGuardar('btnGuardarSucursal', false, document.getElementById('editSucursalId').value ? '💾 Actualizar Sucursal' : '💾 Guardar Sucursal');
  }
}

async function eliminarSucursal(id) {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const s = sucursalesGestionCache.find(item => String(item.id) === String(id));
  const confirmado = await confirmarOperacion(
    '🗑️ Eliminar Sucursal',
    `¿Eliminar la sucursal "${s ? s.nombre : ''}"?`
  );
  if (!confirmado) return;

  const res = await ejecutarEliminarRegistro('sucursales', id, tenantId);
  if (!res.ok) { avisarUsuario(res.message, 'error', 9000); return; }
  avisarUsuario('¡Sucursal eliminada!', 'success');
  await cargarSucursalesGestion();
  await cargarSucursalesSelectAlmacen();
}

async function exportarSucursalesExcel() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const { data, error } = await supabaseClient.from('sucursales').select('*').eq('tenant_id', tenantId);
  if (error) { avisarUsuario(explicarErrorSupabase('sucursales', 'exportar', error), 'error'); return; }
  if (!data || data.length === 0) { avisarUsuario('Sin sucursales para exportar.', 'warning'); return; }

  const enriquecidos = await enriquecerListaContable(tenantId, 'sucursales', data);
  const excelData = enriquecidos.map(s => ({
    Sucursal: s.nombre,
    Dirección: s.direccion || '',
    'Centro de Costo': s.centro_costo || '',
    'Fecha Registro': formatearFecha8Digitos(s.created_at)
  }));

  descargarExcelMatriz([Object.keys(excelData[0]), ...excelData.map(Object.values)], 'Directorio_Sucursales', 'Sucursales');
}

// ==========================================
// 7. GESTIÓN DE ALMACENES
// ==========================================

async function cargarAlmacenesGestion() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;

  const { data, error } = await supabaseClient
    .from('almacenes')
    .select('*, sucursales(nombre)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  const tbody = document.getElementById('tablaAlmacenesGestion');
  if (error) {
    const msg = explicarErrorSupabase('almacenes', 'consultar', error);
    avisarUsuario(msg, 'error', 8000);
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-rose-400">${esc(msg)}</td></tr>`;
    return;
  }
  almacenesGestionCache = await enriquecerListaContable(tenantId, 'almacenes', data || []);

  if (!tbody) return;
  tbody.innerHTML = '';

  if (almacenesGestionCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-500">Sin almacenes/depósitos registrados.</td></tr>`;
    return;
  }

  almacenesGestionCache.forEach(a => {
    const sucursalNom = a.sucursales?.nombre || 'General';
    const ctaBadge = a.cuenta_inventario ? `<span class="ml-1.5 px-1.5 py-0.5 rounded bg-slate-800 text-emerald-300 font-mono text-[10px]">${esc(a.cuenta_inventario)}</span>` : '';
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/60">
        <td class="p-3 font-bold text-white">${esc(a.nombre)}${ctaBadge}</td>
        <td class="p-3 font-mono text-emerald-400 font-bold">${esc(a.tipo || 'PRINCIPAL')}</td>
        <td class="p-3 text-slate-300">${esc(sucursalNom)}</td>
        <td class="p-3 font-mono text-slate-400">${formatearFecha8Digitos(a.created_at)}</td>
        <td class="p-3 text-center space-x-2">
          <button onclick='editarAlmacen("${esc(a.id)}")' class="text-sky-400 hover:underline font-semibold cursor-pointer">Editar</button>
          <button onclick='eliminarAlmacen("${esc(a.id)}")' class="text-rose-400 hover:underline font-semibold cursor-pointer">Eliminar</button>
        </td>
      </tr>
    `;
  });
}

function editarAlmacen(id) {
  const a = almacenesGestionCache.find(item => String(item.id) === String(id));
  if (!a) return;
  document.getElementById('editAlmacenId').value = a.id;
  document.getElementById('almacenNombre').value = a.nombre || '';
  document.getElementById('almacenTipo').value = a.tipo || 'PRINCIPAL';
  document.getElementById('almacenSucursalSelect').value = a.sucursal_id || '';
  if (document.getElementById('almacenCuentaInventario')) document.getElementById('almacenCuentaInventario').value = a.cuenta_inventario || '';

  const btnCancel = document.getElementById('btnCancelarAlmacen');
  if (btnCancel) btnCancel.classList.remove('hidden');
  const titulo = document.getElementById('tituloFormAlmacen');
  if (titulo) titulo.innerText = '✏️ Editar Almacén / Depósito';
  const btnGuardar = document.getElementById('btnGuardarAlmacen');
  if (btnGuardar) btnGuardar.textContent = '💾 Actualizar Almacén';
  enfocarFormularioSeccion('seccionAlmacenes', 'almacenNombre');
}

function limpiarFormAlmacen() {
  document.getElementById('editAlmacenId').value = '';
  document.getElementById('almacenNombre').value = '';
  document.getElementById('almacenTipo').value = 'PRINCIPAL';
  document.getElementById('almacenSucursalSelect').value = '';
  if (document.getElementById('almacenCuentaInventario')) document.getElementById('almacenCuentaInventario').value = '';
  const btnCancel = document.getElementById('btnCancelarAlmacen');
  if (btnCancel) btnCancel.classList.add('hidden');
  const titulo = document.getElementById('tituloFormAlmacen');
  if (titulo) titulo.innerText = '🏬 Maestro de Almacenes / Depósitos';
  const btnGuardar = document.getElementById('btnGuardarAlmacen');
  if (btnGuardar) btnGuardar.textContent = '💾 Guardar Almacén';
}

async function guardarAlmacen() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const editId = document.getElementById('editAlmacenId').value;
  const payload = {
    tenant_id: tenantId,
    sucursal_id: document.getElementById('almacenSucursalSelect')?.value || null,
    nombre: document.getElementById('almacenNombre').value.trim().toUpperCase(),
    tipo: document.getElementById('almacenTipo').value.trim().toUpperCase() || 'PRINCIPAL'
  };
  const payloadContable = {
    cuenta_inventario: (document.getElementById('almacenCuentaInventario')?.value || '').trim() || null
  };

  if (!payload.nombre) {
    avisarUsuario('Ingrese el nombre del almacén.', 'warning');
    return;
  }

  setEstadoBotonGuardar('btnGuardarAlmacen', true);
  try {
    const res = await ejecutarGuardarRegistroContable('almacenes', editId, tenantId, payload, payloadContable);
    if (!res.ok) { avisarUsuario(res.message, 'error', 9000); return; }
    avisarUsuario(editId ? '¡Almacén actualizado con éxito!' : '¡Almacén guardado con éxito!', 'success');
    limpiarFormAlmacen();
    await cargarAlmacenesGestion();
    await cargarAlmacenesSelectLote();
  } finally {
    setEstadoBotonGuardar('btnGuardarAlmacen', false, document.getElementById('editAlmacenId').value ? '💾 Actualizar Almacén' : '💾 Guardar Almacén');
  }
}

async function eliminarAlmacen(id) {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const a = almacenesGestionCache.find(item => String(item.id) === String(id));
  const confirmado = await confirmarOperacion(
    '🗑️ Eliminar Almacén',
    `¿Eliminar el almacén/depósito "${a ? a.nombre : ''}"?`
  );
  if (!confirmado) return;

  const res = await ejecutarEliminarRegistro('almacenes', id, tenantId);
  if (!res.ok) { avisarUsuario(res.message, 'error', 9000); return; }
  avisarUsuario('¡Almacén eliminado!', 'success');
  await cargarAlmacenesGestion();
  await cargarAlmacenesSelectLote();
}

async function exportarAlmacenesExcel() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const { data, error } = await supabaseClient.from('almacenes').select('*, sucursales(nombre)').eq('tenant_id', tenantId);
  if (error) { avisarUsuario(explicarErrorSupabase('almacenes', 'exportar', error), 'error'); return; }
  if (!data || data.length === 0) { avisarUsuario('Sin almacenes para exportar.', 'warning'); return; }

  const enriquecidos = await enriquecerListaContable(tenantId, 'almacenes', data);
  const excelData = enriquecidos.map(a => ({
    'Nombre Almacén': a.nombre,
    Tipo: a.tipo || 'PRINCIPAL',
    Sucursal: a.sucursales?.nombre || 'General',
    'Cuenta Inventario': a.cuenta_inventario || '',
    'Fecha Registro': formatearFecha8Digitos(a.created_at)
  }));

  descargarExcelMatriz([Object.keys(excelData[0]), ...excelData.map(Object.values)], 'Directorio_Almacenes', 'Almacenes');
}

// ==========================================
// 8. GESTIÓN DE TIPOS DE IVA (ALÍCUOTAS)
// ==========================================

async function cargarTiposIvaGestion() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;

  const { data, error } = await supabaseClient
    .from('tipos_iva')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('porcentaje', { ascending: false });

  const tbody = document.getElementById('tablaTiposIvaGestion');
  if (error) {
    const msg = explicarErrorSupabase('tipos_iva', 'consultar', error);
    avisarUsuario(msg, 'error', 8000);
    if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-rose-400">${esc(msg)}</td></tr>`;
    return;
  }
  tiposIvaGestionCache = await enriquecerListaContable(tenantId, 'tipos_iva', data || []);

  if (!tbody) return;
  tbody.innerHTML = '';

  if (tiposIvaGestionCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-500">Se aplican las alícuotas SENIAT estándar (16%, 8%, 0% Exento).</td></tr>`;
    return;
  }

  tiposIvaGestionCache.forEach(t => {
    const codSen = t.codigo_seniat ? `<span class="ml-1.5 px-1.5 py-0.5 rounded bg-slate-800 text-sky-300 font-mono text-[10px]">${esc(t.codigo_seniat)}</span>` : '';
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/60">
        <td class="p-3 font-bold text-emerald-400">${esc(t.nombre)}${codSen}</td>
        <td class="p-3 font-mono font-bold text-amber-300">${t.porcentaje}%</td>
        <td class="p-3 font-mono text-slate-400">${formatearFecha8Digitos(t.created_at)}</td>
        <td class="p-3 text-center space-x-2">
          <button onclick='editarTipoIva("${esc(t.id)}")' class="text-sky-400 hover:underline font-semibold cursor-pointer">Editar</button>
          <button onclick='eliminarTipoIva("${esc(t.id)}")' class="text-rose-400 hover:underline font-semibold cursor-pointer">Eliminar</button>
        </td>
      </tr>
    `;
  });
}

function editarTipoIva(id) {
  const t = tiposIvaGestionCache.find(item => String(item.id) === String(id));
  if (!t) return;
  document.getElementById('editTipoIvaId').value = t.id;
  document.getElementById('tipoIvaNombre').value = t.nombre || '';
  document.getElementById('tipoIvaPorcentaje').value = t.porcentaje ?? 16;
  if (document.getElementById('tipoIvaCodigoSeniat')) document.getElementById('tipoIvaCodigoSeniat').value = t.codigo_seniat || (Number(t.porcentaje) === 0 ? 'E' : (Number(t.porcentaje) === 8 ? 'R' : 'G'));
  if (document.getElementById('tipoIvaCuentaDebito')) document.getElementById('tipoIvaCuentaDebito').value = t.cuenta_debito_fiscal || '';
  if (document.getElementById('tipoIvaCuentaCredito')) document.getElementById('tipoIvaCuentaCredito').value = t.cuenta_credito_fiscal || '';
  const btnCancel = document.getElementById('btnCancelarTipoIva');
  if (btnCancel) btnCancel.classList.remove('hidden');
  const titulo = document.getElementById('tituloFormTipoIva');
  if (titulo) titulo.innerText = '✏️ Editar Tipo de IVA';
  const btnGuardar = document.getElementById('btnGuardarTipoIva');
  if (btnGuardar) btnGuardar.textContent = '💾 Actualizar Alícuota';
  enfocarFormularioSeccion('seccionTiposIva', 'tipoIvaNombre');
}

function limpiarFormTipoIva() {
  document.getElementById('editTipoIvaId').value = '';
  document.getElementById('tipoIvaNombre').value = '';
  document.getElementById('tipoIvaPorcentaje').value = '16';
  if (document.getElementById('tipoIvaCodigoSeniat')) document.getElementById('tipoIvaCodigoSeniat').value = 'G';
  if (document.getElementById('tipoIvaCuentaDebito')) document.getElementById('tipoIvaCuentaDebito').value = '';
  if (document.getElementById('tipoIvaCuentaCredito')) document.getElementById('tipoIvaCuentaCredito').value = '';
  const btnCancel = document.getElementById('btnCancelarTipoIva');
  if (btnCancel) btnCancel.classList.add('hidden');
  const titulo = document.getElementById('tituloFormTipoIva');
  if (titulo) titulo.innerText = '💰 Maestro de Tipos de IVA (Alícuotas SENIAT)';
  const btnGuardar = document.getElementById('btnGuardarTipoIva');
  if (btnGuardar) btnGuardar.textContent = '💾 Guardar Alícuota';
}

async function guardarTipoIva() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const editId = document.getElementById('editTipoIvaId').value;
  const porcentajeParsed = parseFloat(document.getElementById('tipoIvaPorcentaje').value);
  const payload = {
    tenant_id: tenantId,
    nombre: document.getElementById('tipoIvaNombre').value.trim().toUpperCase(),
    porcentaje: Number.isFinite(porcentajeParsed) ? porcentajeParsed : 0
  };
  const payloadContable = {
    codigo_seniat: (document.getElementById('tipoIvaCodigoSeniat')?.value || 'G').trim().toUpperCase(),
    cuenta_debito_fiscal: (document.getElementById('tipoIvaCuentaDebito')?.value || '').trim() || null,
    cuenta_credito_fiscal: (document.getElementById('tipoIvaCuentaCredito')?.value || '').trim() || null
  };

  if (!payload.nombre) {
    avisarUsuario('Ingrese la descripción de la alícuota.', 'warning');
    return;
  }

  setEstadoBotonGuardar('btnGuardarTipoIva', true);
  try {
    const res = await ejecutarGuardarRegistroContable('tipos_iva', editId, tenantId, payload, payloadContable);
    if (!res.ok) { avisarUsuario(res.message, 'error', 9000); return; }
    avisarUsuario(editId ? '¡Alícuota actualizada con éxito!' : '¡Alícuota configurada con éxito!', 'success');
    limpiarFormTipoIva();
    await cargarTiposIvaGestion();
    await cargarTiposIvaSelectForm();
  } finally {
    setEstadoBotonGuardar('btnGuardarTipoIva', false, document.getElementById('editTipoIvaId').value ? '💾 Actualizar Alícuota' : '💾 Guardar Alícuota');
  }
}

async function eliminarTipoIva(id) {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const t = tiposIvaGestionCache.find(item => String(item.id) === String(id));
  const confirmado = await confirmarOperacion(
    '🗑️ Eliminar Tipo de IVA',
    `¿Eliminar la alícuota "${t ? t.nombre : ''}"?`
  );
  if (!confirmado) return;

  const res = await ejecutarEliminarRegistro('tipos_iva', id, tenantId);
  if (!res.ok) { avisarUsuario(res.message, 'error', 9000); return; }
  avisarUsuario('¡Alícuota eliminada!', 'success');
  await cargarTiposIvaGestion();
  await cargarTiposIvaSelectForm();
}

async function exportarTiposIvaExcel() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const { data, error } = await supabaseClient.from('tipos_iva').select('*').eq('tenant_id', tenantId);
  if (error) { avisarUsuario(explicarErrorSupabase('tipos_iva', 'exportar', error), 'error'); return; }
  if (!data || data.length === 0) { avisarUsuario('Sin alícuotas para exportar.', 'warning'); return; }

  const enriquecidos = await enriquecerListaContable(tenantId, 'tipos_iva', data);
  const excelData = enriquecidos.map(t => ({
    'Descripción / Nombre': t.nombre,
    'Porcentaje (%)': t.porcentaje,
    'Código SENIAT': t.codigo_seniat || '',
    'Cta. IVA Débito': t.cuenta_debito_fiscal || '',
    'Cta. IVA Crédito': t.cuenta_credito_fiscal || '',
    'Fecha Registro': formatearFecha8Digitos(t.created_at)
  }));

  descargarExcelMatriz([Object.keys(excelData[0]), ...excelData.map(Object.values)], 'Alicuotas_IVA_SENIAT', 'TiposIVA');
}

// ==========================================
// 9. GESTIÓN DE VÍAS Y MÉTODOS DE PAGO
// ==========================================

async function cargarViasPagoGestion() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;

  const { data, error } = await supabaseClient
    .from('vias_pago')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  const tbody = document.getElementById('tablaViasPagoGestion');
  if (error) {
    const msg = explicarErrorSupabase('vias_pago', 'consultar', error);
    avisarUsuario(msg, 'error', 9000);
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-rose-400">${esc(msg)}</td></tr>`;
    return;
  }
  viasPagoGestionCache = await enriquecerListaContable(tenantId, 'vias_pago', data || []);

  if (!tbody) return;
  tbody.innerHTML = '';

  if (viasPagoGestionCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-500">No hay vías de pago personalizadas registradas aún. Registra una arriba o revisa los permisos RLS en Supabase.</td></tr>`;
    return;
  }

  viasPagoGestionCache.forEach(v => {
    const reqRef = v.requiere_referencia !== false;
    const estaActivo = v.activo !== false;
    const monTag = v.tipo_moneda ? `<span class="ml-1 px-1.5 py-0.5 rounded bg-slate-800 text-sky-300 font-mono text-[10px]">${esc(v.tipo_moneda)}</span>` : '';
    const igtfTag = v.es_divisa_igtf ? `<span class="ml-1 px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 font-mono text-[10px]">IGTF 3%</span>` : '';
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/60">
        <td class="p-3 font-bold text-white">${esc(v.nombre)}${monTag}${igtfTag}</td>
        <td class="p-3 font-mono text-emerald-400 font-bold">${esc(v.codigo_interno || 'N/A')}</td>
        <td class="p-3 text-center"><span class="px-2 py-0.5 rounded text-[10px] ${reqRef ? 'bg-amber-950 text-amber-300 font-bold' : 'bg-slate-800 text-slate-400'}">${reqRef ? 'SÍ' : 'NO'}</span></td>
        <td class="p-3 font-mono text-slate-300">${esc(v.cuenta_contable || 'N/A')}</td>
        <td class="p-3 text-center"><span class="px-2 py-0.5 rounded text-[10px] ${estaActivo ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'}">${estaActivo ? 'ACTIVO' : 'INACTIVO'}</span></td>
        <td class="p-3 text-center space-x-2">
          <button onclick='editarViaPago("${esc(v.id)}")' class="text-sky-400 hover:underline font-semibold cursor-pointer">Editar</button>
          <button onclick='eliminarViaPago("${esc(v.id)}")' class="text-rose-400 hover:underline font-semibold cursor-pointer">Eliminar</button>
        </td>
      </tr>
    `;
  });
}

function editarViaPago(id) {
  const v = viasPagoGestionCache.find(item => String(item.id) === String(id));
  if (!v) {
    avisarUsuario('No se encontró la vía de pago seleccionada en memoria.', 'warning');
    return;
  }
  document.getElementById('editViaPagoId').value = v.id;
  document.getElementById('viaPagoNombre').value = v.nombre || '';
  document.getElementById('viaPagoCodigo').value = v.codigo_interno || '';
  document.getElementById('viaPagoReqRef').value = String(v.requiere_referencia ?? true);
  document.getElementById('viaPagoActivo').value = String(v.activo ?? true);
  document.getElementById('viaPagoCuentaContable').value = v.cuenta_contable || '';
  if (document.getElementById('viaPagoMoneda')) document.getElementById('viaPagoMoneda').value = v.tipo_moneda || 'VES';
  if (document.getElementById('viaPagoCausaIgtf')) document.getElementById('viaPagoCausaIgtf').value = String(Boolean(v.es_divisa_igtf));

  const btnCancel = document.getElementById('btnCancelarViaPago');
  if (btnCancel) btnCancel.classList.remove('hidden');
  const titulo = document.getElementById('tituloFormViaPago');
  if (titulo) titulo.innerText = '✏️ Editar Vía / Método de Pago';
  const btnGuardar = document.getElementById('btnGuardarViaPago');
  if (btnGuardar) btnGuardar.textContent = '💾 Actualizar Vía';
  enfocarFormularioSeccion('seccionViasPago', 'viaPagoNombre');
}

function limpiarFormViaPago() {
  document.getElementById('editViaPagoId').value = '';
  document.getElementById('viaPagoNombre').value = '';
  document.getElementById('viaPagoCodigo').value = '';
  document.getElementById('viaPagoReqRef').value = 'true';
  document.getElementById('viaPagoActivo').value = 'true';
  document.getElementById('viaPagoCuentaContable').value = '';
  if (document.getElementById('viaPagoMoneda')) document.getElementById('viaPagoMoneda').value = 'VES';
  if (document.getElementById('viaPagoCausaIgtf')) document.getElementById('viaPagoCausaIgtf').value = 'false';

  const btnCancel = document.getElementById('btnCancelarViaPago');
  if (btnCancel) btnCancel.classList.add('hidden');
  const titulo = document.getElementById('tituloFormViaPago');
  if (titulo) titulo.innerText = '💳 Maestro de Vías y Métodos de Pago';
  const btnGuardar = document.getElementById('btnGuardarViaPago');
  if (btnGuardar) btnGuardar.textContent = '💾 Guardar Vía';
}

async function guardarViaPago() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const editId = document.getElementById('editViaPagoId').value;
  const payload = {
    tenant_id: tenantId,
    nombre: document.getElementById('viaPagoNombre').value.trim().toUpperCase(),
    codigo_interno: document.getElementById('viaPagoCodigo').value.trim().toUpperCase() || null,
    requiere_referencia: document.getElementById('viaPagoReqRef').value === 'true',
    activo: document.getElementById('viaPagoActivo').value === 'true',
    cuenta_contable: document.getElementById('viaPagoCuentaContable').value.trim() || null
  };
  const payloadContable = {
    tipo_moneda: document.getElementById('viaPagoMoneda')?.value || 'VES',
    es_divisa_igtf: document.getElementById('viaPagoCausaIgtf')?.value === 'true'
  };

  if (!payload.nombre) {
    avisarUsuario('Ingrese la denominación del método de pago.', 'warning');
    return;
  }

  setEstadoBotonGuardar('btnGuardarViaPago', true);
  try {
    const res = await ejecutarGuardarRegistroContable('vias_pago', editId, tenantId, payload, payloadContable);
    if (!res.ok) { avisarUsuario(res.message, 'error', 10000); return; }
    avisarUsuario(editId ? '¡Vía de pago actualizada con éxito!' : '¡Vía de pago registrada con éxito!', 'success');
    limpiarFormViaPago();
    await cargarViasPagoGestion();
    await cargarViasPagoSelectPos();
  } finally {
    setEstadoBotonGuardar('btnGuardarViaPago', false, document.getElementById('editViaPagoId').value ? '💾 Actualizar Vía' : '💾 Guardar Vía');
  }
}

async function eliminarViaPago(id) {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const v = viasPagoGestionCache.find(item => String(item.id) === String(id));
  const confirmado = await confirmarOperacion(
    '🗑️ Eliminar Vía de Pago',
    `¿Estás seguro de eliminar el método de pago "${v ? v.nombre : ''}"?`
  );
  if (!confirmado) return;

  const res = await ejecutarEliminarRegistro('vias_pago', id, tenantId);
  if (!res.ok) { avisarUsuario(res.message, 'error', 10000); return; }
  avisarUsuario('¡Vía de pago eliminada!', 'success');
  await cargarViasPagoGestion();
  await cargarViasPagoSelectPos();
}

async function exportarViasPagoExcel() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const { data, error } = await supabaseClient.from('vias_pago').select('*').eq('tenant_id', tenantId);
  if (error) { avisarUsuario(explicarErrorSupabase('vias_pago', 'exportar', error), 'error'); return; }
  if (!data || data.length === 0) { avisarUsuario('Sin vías de pago para exportar.', 'warning'); return; }

  const enriquecidos = await enriquecerListaContable(tenantId, 'vias_pago', data);
  const excelData = enriquecidos.map(v => ({
    'Método de Pago': v.nombre,
    Código: v.codigo_interno || '',
    'Moneda': v.tipo_moneda || 'VES',
    'Causa IGTF': v.es_divisa_igtf ? 'SÍ' : 'NO',
    'Requiere Ref': v.requiere_referencia ? 'SÍ' : 'NO',
    Estatus: v.activo ? 'ACTIVO' : 'INACTIVO',
    'Cuenta Contable': v.cuenta_contable || ''
  }));

  descargarExcelMatriz([Object.keys(excelData[0]), ...excelData.map(Object.values)], 'Metodos_Pago_POS', 'ViasPago');
}

// ==========================================
// 10. FUNCIONES AUXILIARES & EXPORTACIÓN
// ==========================================

function descargarExcelMatriz(matrizDatos, nombreArchivo, nombreHoja) {
  if (typeof XLSX === 'undefined') {
    avisarUsuario('La librería SheetJS (XLSX) no está cargada.', 'error');
    return;
  }
  const worksheet = XLSX.utils.aoa_to_sheet(matrizDatos);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, nombreHoja);
  XLSX.writeFile(workbook, `${nombreArchivo}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function formatearFecha8Digitos(isoString) {
  if (!isoString) return '--/--/---- --:--';
  const d = new Date(isoString);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function cargarUnidadesSelectForm() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const { data, error } = await supabaseClient
    .from('unidades_medida')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('nombre', { ascending: true });

  if (error) {
    avisarUsuario(explicarErrorSupabase('unidades_medida', 'consultar', error), 'error', 8000);
    return;
  }

  unidadesSelectCache = data || [];

  const hiddenVal = document.getElementById('prodUnidadMedida');
  const inputBuscar = document.getElementById('prodUnidadBuscar');
  const btnLimpiar = document.getElementById('btnLimpiarUnidadProd');
  if (hiddenVal && hiddenVal.value && inputBuscar) {
    const actual = unidadesSelectCache.find(u => String(u.nombre || '').toUpperCase() === String(hiddenVal.value).toUpperCase());
    if (actual) {
      hiddenVal.value = actual.nombre;
      inputBuscar.value = actual.nombre;
      if (btnLimpiar) btnLimpiar.classList.remove('hidden');
    }
  }
}

function renderizarListaBusquedaUnidad(filtro = '') {
  const lista = document.getElementById('listaBusquedaUnidad');
  if (!lista) return;

  const q = String(filtro || '').trim().toUpperCase();
  lista.innerHTML = '';

  if (unidadesSelectCache.length === 0) {
    lista.innerHTML = `
      <button type="button" onclick="document.getElementById('listaBusquedaUnidad').classList.add('hidden'); cambiarPestana('unidades');"
        class="w-full text-left px-3 py-2.5 text-xs text-amber-300 hover:bg-slate-800 cursor-pointer">
        ⚠️ No hay unidades creadas. Haz clic aquí para crearlas en Maestro de Unidades.
      </button>`;
    return;
  }

  const coincidencias = q
    ? unidadesSelectCache.filter(u => String(u.nombre || '').toUpperCase().includes(q))
    : unidadesSelectCache;

  if (coincidencias.length === 0) {
    lista.innerHTML = `<div class="px-3 py-2.5 text-xs text-slate-400">Sin coincidencias en el Maestro de Unidades.</div>`;
    return;
  }

  coincidencias.forEach(u => {
    lista.innerHTML += `
      <button type="button" onclick='seleccionarUnidadProducto("${esc(u.id)}")'
        class="w-full flex items-center justify-between px-3 py-2 text-left text-xs text-white hover:bg-emerald-900/40 transition cursor-pointer font-mono">
        <span class="font-bold text-emerald-400">${esc(u.nombre)}</span>
      </button>`;
  });
}

async function abrirBusquedaUnidad() {
  const lista = document.getElementById('listaBusquedaUnidad');
  if (!lista) return;
  if (unidadesSelectCache.length === 0) {
    await cargarUnidadesSelectForm();
  }
  const hiddenVal = document.getElementById('prodUnidadMedida')?.value;
  const texto = hiddenVal ? '' : (document.getElementById('prodUnidadBuscar')?.value || '');
  renderizarListaBusquedaUnidad(texto);
  lista.classList.remove('hidden');
}

function filtrarUnidadesProducto(valor) {
  const hiddenVal = document.getElementById('prodUnidadMedida');
  const btnLimpiar = document.getElementById('btnLimpiarUnidadProd');
  const lista = document.getElementById('listaBusquedaUnidad');
  if (hiddenVal) hiddenVal.value = '';
  if (btnLimpiar) {
    if (valor && valor.trim()) btnLimpiar.classList.remove('hidden');
    else btnLimpiar.classList.add('hidden');
  }
  renderizarListaBusquedaUnidad(valor);
  if (lista) lista.classList.remove('hidden');
}

function seleccionarUnidadProducto(id) {
  const u = unidadesSelectCache.find(item => String(item.id) === String(id));
  if (!u) return;
  const hiddenVal = document.getElementById('prodUnidadMedida');
  const inputBuscar = document.getElementById('prodUnidadBuscar');
  const btnLimpiar = document.getElementById('btnLimpiarUnidadProd');
  const lista = document.getElementById('listaBusquedaUnidad');
  if (hiddenVal) hiddenVal.value = u.nombre;
  if (inputBuscar) inputBuscar.value = u.nombre;
  if (btnLimpiar) btnLimpiar.classList.remove('hidden');
  if (lista) lista.classList.add('hidden');
}

function limpiarSeleccionUnidadProducto() {
  const hiddenVal = document.getElementById('prodUnidadMedida');
  const inputBuscar = document.getElementById('prodUnidadBuscar');
  const btnLimpiar = document.getElementById('btnLimpiarUnidadProd');
  if (hiddenVal) hiddenVal.value = '';
  if (inputBuscar) {
    inputBuscar.value = '';
    inputBuscar.focus();
  }
  if (btnLimpiar) btnLimpiar.classList.add('hidden');
  renderizarListaBusquedaUnidad('');
  const lista = document.getElementById('listaBusquedaUnidad');
  if (lista) lista.classList.remove('hidden');
}

async function cargarTiposIvaSelectForm() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const { data, error } = await supabaseClient
    .from('tipos_iva')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('porcentaje', { ascending: false });

  if (error) {
    avisarUsuario(explicarErrorSupabase('tipos_iva', 'consultar', error), 'error', 8000);
    return;
  }

  tiposIvaSelectCache = data || [];

  const hiddenId = document.getElementById('prodExento');
  const inputBuscar = document.getElementById('prodTipoIvaBuscar');
  const btnLimpiar = document.getElementById('btnLimpiarTipoIvaProd');
  if (hiddenId && hiddenId.value && inputBuscar) {
    const actual = tiposIvaSelectCache.find(t => String(t.id) === String(hiddenId.value));
    if (actual) {
      inputBuscar.value = `${actual.nombre} (${actual.porcentaje}%)`;
      if (btnLimpiar) btnLimpiar.classList.remove('hidden');
    } else {
      hiddenId.value = '';
      inputBuscar.value = '';
      if (btnLimpiar) btnLimpiar.classList.add('hidden');
    }
  }
}

function renderizarListaBusquedaTipoIva(filtro = '') {
  const lista = document.getElementById('listaBusquedaTipoIva');
  if (!lista) return;

  const q = String(filtro || '').trim().toUpperCase();
  lista.innerHTML = '';

  if (tiposIvaSelectCache.length === 0) {
    lista.innerHTML = `
      <button type="button" onclick="document.getElementById('listaBusquedaTipoIva').classList.add('hidden'); cambiarPestana('tiposIva');"
        class="w-full text-left px-3 py-2.5 text-xs text-amber-300 hover:bg-slate-800 cursor-pointer">
        ⚠️ No hay tipos de IVA creados. Haz clic aquí para crearlos en Maestro de Tipos de IVA.
      </button>`;
    return;
  }

  const coincidencias = q
    ? tiposIvaSelectCache.filter(t =>
        String(t.nombre || '').toUpperCase().includes(q) ||
        String(t.porcentaje ?? '').includes(q)
      )
    : tiposIvaSelectCache;

  if (coincidencias.length === 0) {
    lista.innerHTML = `<div class="px-3 py-2.5 text-xs text-slate-400">Sin coincidencias en el Maestro de Tipos de IVA.</div>`;
    return;
  }

  coincidencias.forEach(t => {
    const pct = Number(t.porcentaje ?? 0);
    const badge = pct === 0
      ? '<span class="px-2 py-0.5 rounded text-[10px] bg-sky-950 text-sky-300 font-mono">0%</span>'
      : `<span class="px-2 py-0.5 rounded text-[10px] bg-emerald-950 text-emerald-300 font-mono">${pct}%</span>`;

    lista.innerHTML += `
      <button type="button" onclick='seleccionarTipoIvaProducto("${esc(t.id)}")'
        class="w-full flex items-center justify-between px-3 py-2 text-left text-xs text-white hover:bg-emerald-900/40 transition cursor-pointer">
        <span class="font-semibold">${esc(t.nombre)}</span>
        ${badge}
      </button>`;
  });
}

async function abrirBusquedaTipoIva() {
  const lista = document.getElementById('listaBusquedaTipoIva');
  if (!lista) return;
  if (tiposIvaSelectCache.length === 0) {
    await cargarTiposIvaSelectForm();
  }
  const hiddenId = document.getElementById('prodExento')?.value;
  const texto = hiddenId ? '' : (document.getElementById('prodTipoIvaBuscar')?.value || '');
  renderizarListaBusquedaTipoIva(texto);
  lista.classList.remove('hidden');
}

function filtrarTiposIvaProducto(valor) {
  const hiddenId = document.getElementById('prodExento');
  const btnLimpiar = document.getElementById('btnLimpiarTipoIvaProd');
  const lista = document.getElementById('listaBusquedaTipoIva');
  if (hiddenId) hiddenId.value = '';
  if (btnLimpiar) {
    if (valor && valor.trim()) btnLimpiar.classList.remove('hidden');
    else btnLimpiar.classList.add('hidden');
  }
  renderizarListaBusquedaTipoIva(valor);
  if (lista) lista.classList.remove('hidden');
}

function seleccionarTipoIvaProducto(id) {
  const t = tiposIvaSelectCache.find(item => String(item.id) === String(id));
  if (!t) return;
  const hiddenId = document.getElementById('prodExento');
  const inputBuscar = document.getElementById('prodTipoIvaBuscar');
  const btnLimpiar = document.getElementById('btnLimpiarTipoIvaProd');
  const lista = document.getElementById('listaBusquedaTipoIva');
  if (hiddenId) hiddenId.value = t.id;
  if (inputBuscar) inputBuscar.value = `${t.nombre} (${t.porcentaje}%)`;
  if (btnLimpiar) btnLimpiar.classList.remove('hidden');
  if (lista) lista.classList.add('hidden');
}

function limpiarSeleccionTipoIvaProducto() {
  const hiddenId = document.getElementById('prodExento');
  const inputBuscar = document.getElementById('prodTipoIvaBuscar');
  const btnLimpiar = document.getElementById('btnLimpiarTipoIvaProd');
  if (hiddenId) hiddenId.value = '';
  if (inputBuscar) {
    inputBuscar.value = '';
    inputBuscar.focus();
  }
  if (btnLimpiar) btnLimpiar.classList.add('hidden');
  renderizarListaBusquedaTipoIva('');
  const lista = document.getElementById('listaBusquedaTipoIva');
  if (lista) lista.classList.remove('hidden');
}

document.addEventListener('click', (e) => {
  const listaIva = document.getElementById('listaBusquedaTipoIva');
  const inputIva = document.getElementById('prodTipoIvaBuscar');
  const btnIva = document.getElementById('btnLimpiarTipoIvaProd');
  if (listaIva && !listaIva.classList.contains('hidden')) {
    if (e.target !== inputIva && e.target !== btnIva && !listaIva.contains(e.target)) {
      listaIva.classList.add('hidden');
    }
  }

  const listaUni = document.getElementById('listaBusquedaUnidad');
  const inputUni = document.getElementById('prodUnidadBuscar');
  const btnUni = document.getElementById('btnLimpiarUnidadProd');
  if (listaUni && !listaUni.classList.contains('hidden')) {
    if (e.target !== inputUni && e.target !== btnUni && !listaUni.contains(e.target)) {
      listaUni.classList.add('hidden');
    }
  }
});

// Nota: cargarProveedoresSelectCompra() vive en /js/kardex.js junto a la caché del módulo de Compras.

async function cargarSucursalesSelectAlmacen() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const { data } = await supabaseClient.from('sucursales').select('*').eq('tenant_id', tenantId);
  const select = document.getElementById('almacenSucursalSelect');
  if (!select) return;
  select.innerHTML = '<option value="">-- Sucursal Principal / General --</option>';
  if (data && data.length > 0) {
    data.forEach(s => {
      select.innerHTML += `<option value="${esc(s.id)}">${esc(s.nombre)}</option>`;
    });
  }
}

async function cargarAlmacenesSelectLote() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const { data } = await supabaseClient.from('almacenes').select('*, sucursales(nombre)').eq('tenant_id', tenantId);
  const select = document.getElementById('loteAlmacenSelect');
  if (!select) return;
  select.innerHTML = '<option value="">-- Almacén Principal --</option>';
  if (data && data.length > 0) {
    data.forEach(a => {
      const sucNom = a.sucursales?.nombre ? `[${a.sucursales.nombre}] ` : '';
      select.innerHTML += `<option value="${esc(a.id)}">${esc(sucNom)}${esc(a.nombre)} (${esc(a.tipo || 'PRINCIPAL')})</option>`;
    });
  }
}

async function cargarProductosSelectLote() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const { data } = await supabaseClient.from('productos').select('id, codigo_sku, descripcion').eq('tenant_id', tenantId);
  const select = document.getElementById('loteProductoSelect');
  if (!select) return;
  select.innerHTML = '<option value="">-- Seleccionar Producto --</option>';
  if (data && data.length > 0) {
    data.forEach(p => {
      select.innerHTML += `<option value="${esc(p.id)}">[${esc(p.codigo_sku || 'S/N')}] ${esc(p.descripcion)}</option>`;
    });
  }
}

async function cargarViasPagoSelectPos() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const { data } = await supabaseClient.from('vias_pago').select('*').eq('tenant_id', tenantId);
  const select = document.getElementById('metodoPagoSelect');
  if (!select) return;
  const activos = (data || []).filter(v => v.activo !== false);
  if (activos.length > 0) {
    select.innerHTML = '';
    activos.forEach(v => {
      select.innerHTML += `<option value="${esc(v.nombre)}">${esc(v.nombre)}${v.codigo_interno ? ' (' + esc(v.codigo_interno) + ')' : ''}</option>`;
    });
    if (typeof verificarAplicacionIgtf === 'function') verificarAplicacionIgtf();
  }
}

// ==========================================
// 11. AFILIADOS Y PANEL MASTER SAAS (MAS-001)
// (Lógica completa gestionada por /js/referidos.js y /js/suscripciones.js)
// ==========================================

async function copiarCodigoReferido() {
  const elUrl = document.getElementById('refEnlaceCompartir');
  const texto = elUrl?.value || document.getElementById('refCodigoMiEmpresa')?.textContent || '';
  if (!texto) return;
  try {
    await navigator.clipboard.writeText(texto);
    avisarUsuario('Enlace de referido copiado al portapapeles.', 'success');
  } catch (e) {
    avisarUsuario(`Código de referido: ${texto}`, 'info', 6000);
  }
}

let inquilinosMasterCache = [];

async function cargarInquilinosMaster() {
  if (typeof cargarPanelMasterCompleto === 'function') {
    return await cargarPanelMasterCompleto();
  }
}

async function cambiarPlanInquilinoMaster(tenantIdTarget, nuevoPlan) {
  const { error } = await supabaseClient
    .from('tenants')
    .update({ plan_activo: nuevoPlan })
    .eq('id', tenantIdTarget);

  if (error) {
    avisarUsuario(`No se pudo actualizar el plan: ${error.message}`, 'error');
    return;
  }
  avisarUsuario(`Plan actualizado a ${nuevoPlan}.`, 'success');
  await cargarInquilinosMaster();
}

// ==========================================
// 12. IMPORTACIÓN MASIVA Y PLANTILLAS EXCEL (9 MAESTROS)
// ==========================================

function normalizarClaveExcel(clave) {
  return String(clave || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function obtenerCampoFilaExcel(filaNorm, aliases = []) {
  for (const alias of aliases) {
    const k = normalizarClaveExcel(alias);
    if (k in filaNorm && filaNorm[k] !== undefined && filaNorm[k] !== null && String(filaNorm[k]).trim() !== '') {
      return filaNorm[k];
    }
  }
  return '';
}

function parseBoolExcel(val, defecto = false) {
  if (typeof val === 'boolean') return val;
  const s = String(val ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
  if (!s) return defecto;
  if (['SI', 'S', 'YES', 'Y', 'TRUE', '1', 'ACTIVO', 'HABILITADO'].includes(s)) return true;
  if (['NO', 'N', 'FALSE', '0', 'INACTIVO', 'DESHABILITADO'].includes(s)) return false;
  return defecto;
}

function parseNumeroExcel(val, defecto = 0) {
  if (typeof val === 'number') return Number.isFinite(val) ? val : defecto;
  let s = String(val ?? '').trim().replace(/[^\d.,-]/g, '');
  if (!s) return defecto;
  if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.');
  else if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
  const num = parseFloat(s);
  return Number.isFinite(num) ? num : defecto;
}

function parseFechaIsoExcel(val) {
  if (val === undefined || val === null || val === '') return null;
  if (typeof val === 'number' && Number.isFinite(val) && val > 20000 && val < 90000) {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  if (!s || /^n\/?a$/i.test(s) || /^sin/i.test(s)) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function leerFilasExcelCatalogo(file) {
  if (!file) return [];
  if (typeof XLSX === 'undefined') {
    throw new Error('La librería SheetJS (XLSX) no está cargada.');
  }
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const worksheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
  return rawRows
    .map(row => {
      const norm = {};
      Object.keys(row).forEach(k => {
        norm[normalizarClaveExcel(k)] = row[k];
      });
      return norm;
    })
    .filter(norm => Object.values(norm).some(v => String(v ?? '').trim() !== ''));
}

function descargarPlantillaCatalogoExcel(tipo) {
  const plantillas = {
    productos: {
      archivo: 'Plantilla_Productos',
      hoja: 'Productos',
      filas: [
        ['SKU', 'Código de Barras', 'Categoría', 'Descripción', 'Ubicación', 'Control Inventario', 'Unidad', 'Stock', 'Lote', 'Costo ($)', '% Utilidad', 'Precio Venta ($)', 'Estatus Fiscal', 'Cta. Inventario', 'Cta. Ingreso', 'Cta. Costo', 'Cta. Devolución', 'Centro de Costo'],
        ['SKU-001', '7591234567890', 'VIVERES', 'HARINA DE MAIZ PRECOCIDA 1KG', 'PASILLO A-1', 'SÍ', 'UND', 50, 'LOTE-01', 1.00, 30, 1.30, 'GENERAL (16%)', '1.1.04.01', '4.1.01.01', '5.1.01.01', '4.1.02.01', 'CC-01']
      ]
    },
    clientes: {
      archivo: 'Plantilla_Clientes',
      hoja: 'Clientes',
      filas: [
        ['RIF', 'Razón Social', 'Dirección', 'Teléfono', 'Correo', 'Contacto', 'Contribuyente Especial', 'Cuenta Contable (CxC)', 'Cta. Anticipos', 'Días Crédito', 'Límite Crédito ($)'],
        ['J-12345678-9', 'INVERSIONES EJEMPLO C.A.', 'AV. BOLIVAR, LOCAL 4', '0414-0000000', 'compras@ejemplo.com', 'CARLOS PEREZ', 'NO', '1.1.02.01', '2.1.03.01', 15, 500]
      ]
    },
    proveedores: {
      archivo: 'Plantilla_Proveedores',
      hoja: 'Proveedores',
      filas: [
        ['RIF', 'Razón Social', 'Dirección', 'Teléfono', 'Correo', 'Contacto', 'Contribuyente Especial', 'Cuenta Contable (CxP)', 'Tipo Persona', '% Retención IVA', 'Días Crédito', 'Cta. Anticipos'],
        ['J-98765432-1', 'DISTRIBUIDORA NACIONAL C.A.', 'ZONA INDUSTRIAL II', '0212-0000000', 'ventas@distribuidora.com', 'ANA GOMEZ', 'SÍ', '2.1.01.01', 'PJD', 75, 30, '1.1.06.01']
      ]
    },
    unidades: {
      archivo: 'Plantilla_Unidades_Medida',
      hoja: 'Unidades',
      filas: [
        ['Abreviatura / Nombre'],
        ['CAJA'],
        ['KG']
      ]
    },
    tiposIva: {
      archivo: 'Plantilla_Tipos_IVA',
      hoja: 'TiposIVA',
      filas: [
        ['Descripción / Nombre', 'Porcentaje (%)', 'Código SENIAT', 'Cta. IVA Débito', 'Cta. IVA Crédito'],
        ['IVA GENERAL 16%', 16, 'G', '2.1.04.01', '1.1.05.01'],
        ['EXENTO 0%', 0, 'E', '', '']
      ]
    },
    viasPago: {
      archivo: 'Plantilla_Vias_Pago',
      hoja: 'ViasPago',
      filas: [
        ['Método de Pago', 'Código', 'Moneda', 'Causa IGTF', 'Requiere Ref', 'Estatus', 'Cuenta Contable'],
        ['PAGO MOVIL', 'PM-01', 'VES', 'NO', 'SÍ', 'ACTIVO', '1.1.01.02'],
        ['EFECTIVO USD', 'USD-01', 'USD', 'SÍ', 'NO', 'ACTIVO', '1.1.01.03']
      ]
    },
    sucursales: {
      archivo: 'Plantilla_Sucursales',
      hoja: 'Sucursales',
      filas: [
        ['Sucursal', 'Dirección', 'Centro de Costo'],
        ['SEDE PRINCIPAL', 'AV. FRANCISCO DE MIRANDA', 'CC-01']
      ]
    },
    almacenes: {
      archivo: 'Plantilla_Almacenes',
      hoja: 'Almacenes',
      filas: [
        ['Nombre Almacén', 'Tipo', 'Sucursal', 'Cuenta Inventario'],
        ['DEPOSITO CENTRAL', 'PRINCIPAL', 'SEDE PRINCIPAL', '1.1.04.01']
      ]
    },
    lotes: {
      archivo: 'Plantilla_Lotes',
      hoja: 'Lotes',
      filas: [
        ['Lote', 'SKU', 'Material', 'Sucursal', 'Almacén', 'Ubicación', 'Stock', 'Fecha Vencimiento'],
        ['LOTE-2026-01', 'SKU-001', 'HARINA DE MAIZ PRECOCIDA 1KG', 'SEDE PRINCIPAL', 'DEPOSITO CENTRAL', 'RACK A-1', 50, '2026-12-31']
      ]
    }
  };

  const cfg = plantillas[tipo];
  if (!cfg) return;
  descargarExcelMatriz(cfg.filas, cfg.archivo, cfg.hoja);
  avisarUsuario(`Plantilla Excel "${cfg.archivo}.xlsx" descargada.`, 'success');
}

function mostrarResumenImportacion(nombreCatalogo, creados, actualizados, omitidos, primerError = '') {
  const totalOk = creados + actualizados;
  const msg = `Importación de ${nombreCatalogo}: ${creados} creados, ${actualizados} actualizados` +
    (omitidos > 0 ? `, ${omitidos} omitidos${primerError ? ` (${primerError})` : ''}.` : '.');
  avisarUsuario(msg, totalOk > 0 ? 'success' : 'warning', 7500);
}

async function importarProductosExcel(event) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (!file) return;
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) { input.value = ''; return; }

  try {
    avisarUsuario('Leyendo archivo Excel de Productos...', 'info', 3000);
    const filas = await leerFilasExcelCatalogo(file);
    if (filas.length === 0) {
      avisarUsuario('El archivo no contiene filas válidas para importar.', 'warning');
      return;
    }

    const [{ data: prodDb }, { data: ivaDb }, { data: uniDb }] = await Promise.all([
      supabaseClient.from('productos').select('*').eq('tenant_id', tenantId),
      supabaseClient.from('tipos_iva').select('*').eq('tenant_id', tenantId),
      supabaseClient.from('unidades_medida').select('*').eq('tenant_id', tenantId)
    ]);

    const existentes = await enriquecerListaContable(tenantId, 'productos', prodDb || []);
    const listaIva = ivaDb || [];
    const listaUnidades = uniDb || [];

    if (listaIva.length === 0) {
      const resG = await ejecutarGuardarRegistroContable('tipos_iva', '', tenantId, { tenant_id: tenantId, nombre: 'GENERAL', porcentaje: 16 }, { codigo_seniat: 'G' });
      const resE = await ejecutarGuardarRegistroContable('tipos_iva', '', tenantId, { tenant_id: tenantId, nombre: 'EXENTO', porcentaje: 0 }, { codigo_seniat: 'E' });
      if (resG.ok && resG.data) listaIva.push(resG.data);
      if (resE.ok && resE.data) listaIva.push(resE.data);
    }

    const resolverTipoIvaId = (txtFiscal) => {
      if (listaIva.length === 0) return null;
      const raw = String(txtFiscal || '').trim().toUpperCase();
      if (!raw) {
        const g16 = listaIva.find(t => Number(t.porcentaje) === 16);
        return (g16 || listaIva[0]).id;
      }
      const exacto = listaIva.find(t =>
        `${t.nombre} (${t.porcentaje}%)`.toUpperCase() === raw ||
        String(t.nombre || '').toUpperCase() === raw
      );
      if (exacto) return exacto.id;
      if (/EXENT|0%/.test(raw)) {
        const ex = listaIva.find(t => Number(t.porcentaje) === 0);
        if (ex) return ex.id;
      }
      const mPct = raw.match(/(\d+(?:[.,]\d+)?)/);
      if (mPct) {
        const pct = parseNumeroExcel(mPct[1], -1);
        const byPct = listaIva.find(t => Number(t.porcentaje) === pct);
        if (byPct) return byPct.id;
      }
      const g16 = listaIva.find(t => Number(t.porcentaje) === 16);
      return (g16 || listaIva[0]).id;
    };

    const asegurarUnidad = async (uniRaw) => {
      const nombreUni = String(uniRaw || 'UND').trim().toUpperCase() || 'UND';
      const existe = listaUnidades.find(u => String(u.nombre || '').trim().toUpperCase() === nombreUni);
      if (!existe) {
        const rUni = await ejecutarGuardarRegistro('unidades_medida', '', tenantId, { tenant_id: tenantId, nombre: nombreUni });
        if (rUni.ok && rUni.data) listaUnidades.push(rUni.data);
      }
      return nombreUni;
    };

    let creados = 0, actualizados = 0, omitidos = 0, primerError = '';

    for (const fila of filas) {
      const descripcion = String(obtenerCampoFilaExcel(fila, ['Descripción', 'Descripcion', 'Nombre', 'Producto', 'Material'])).trim().toUpperCase();
      if (!descripcion) {
        omitidos++;
        if (!primerError) primerError = 'Falta columna Descripción';
        continue;
      }

      const skuRaw = String(obtenerCampoFilaExcel(fila, ['SKU', 'Código SKU', 'Codigo SKU', 'Codigo'])).trim().toUpperCase();
      const sku = (skuRaw && !['N/A', 'S/N', 'NA'].includes(skuRaw)) ? skuRaw : '';
      const codigoBarras = String(obtenerCampoFilaExcel(fila, ['Código de Barras', 'Codigo de Barras', 'Codigo Barras', 'Barras', 'EAN', 'QR'])).trim().toUpperCase() || null;
      const categoria = String(obtenerCampoFilaExcel(fila, ['Categoría', 'Categoria', 'Familia'])).trim().toUpperCase();
      const ubicacion = String(obtenerCampoFilaExcel(fila, ['Ubicación', 'Ubicacion', 'Pasillo'])).trim().toUpperCase();
      const manejaInv = parseBoolExcel(obtenerCampoFilaExcel(fila, ['Control Inventario', 'Maneja Inventario', 'Inventario']), true);
      const unidad = await asegurarUnidad(obtenerCampoFilaExcel(fila, ['Unidad', 'Unidad de Medida', 'UND']));
      const stock = parseNumeroExcel(obtenerCampoFilaExcel(fila, ['Stock', 'Existencia', 'Stock Inicial', 'Cantidad']), 0);
      const lote = String(obtenerCampoFilaExcel(fila, ['Lote'])).trim().toUpperCase() || 'SIN-LOTE';
      const costo = parseNumeroExcel(obtenerCampoFilaExcel(fila, ['Costo ($)', 'Costo', 'Costo Unitario']), 0);
      const utilidad = parseNumeroExcel(obtenerCampoFilaExcel(fila, ['% Utilidad', 'Utilidad', 'Margen']), 30);
      let precioVenta = parseNumeroExcel(obtenerCampoFilaExcel(fila, ['Precio Venta ($)', 'Precio Venta', 'Precio', 'PVP']), 0);
      if (precioVenta <= 0 && costo > 0) {
        precioVenta = Number((costo * (1 + (utilidad / 100))).toFixed(2));
      }
      if (precioVenta <= 0) {
        omitidos++;
        if (!primerError) primerError = `Precio Venta <= 0 en "${descripcion}"`;
        continue;
      }

      const tipoIvaId = resolverTipoIvaId(obtenerCampoFilaExcel(fila, ['Estatus Fiscal', 'Tipo de IVA', 'Tipo IVA', 'IVA']));
      const existente = existentes.find(p =>
        (sku && String(p.codigo_sku || '').trim().toUpperCase() === sku) ||
        (codigoBarras && String(p.codigo_barras || '').trim().toUpperCase() === codigoBarras) ||
        String(p.descripcion || '').trim().toUpperCase() === descripcion
      );

      const payload = {
        tenant_id: tenantId,
        codigo_sku: sku,
        categoria,
        ubicacion,
        descripcion,
        maneja_inventario: manejaInv,
        unidad_medida: unidad,
        stock,
        lote,
        costo_unitario_usd: costo,
        margen_utilidad_porcentaje: utilidad,
        precio_venta_usd: precioVenta,
        precio_unitario_usd: precioVenta,
        tipo_iva_id: tipoIvaId,
        cuenta_contable: String(obtenerCampoFilaExcel(fila, ['Cta. Inventario', 'Cuenta Contable', 'Cta Inventario'])).trim()
      };

      const payloadContable = {
        codigo_barras: codigoBarras,
        cuenta_ingreso: String(obtenerCampoFilaExcel(fila, ['Cta. Ingreso', 'Cuenta Ingreso'])).trim() || null,
        cuenta_costo: String(obtenerCampoFilaExcel(fila, ['Cta. Costo', 'Cuenta Costo'])).trim() || null,
        cuenta_devolucion: String(obtenerCampoFilaExcel(fila, ['Cta. Devolución', 'Cta Devolucion', 'Cuenta Devolucion'])).trim() || null,
        centro_costo_default: String(obtenerCampoFilaExcel(fila, ['Centro de Costo', 'Centro Costo'])).trim().toUpperCase() || null
      };

      const res = await ejecutarGuardarRegistroContable('productos', existente?.id || '', tenantId, payload, payloadContable);
      if (res.ok) {
        if (existente) actualizados++;
        else {
          creados++;
          if (res.data) existentes.push({ ...res.data, ...payloadContable });
        }
      } else {
        omitidos++;
        if (!primerError) primerError = res.message;
      }
    }

    mostrarResumenImportacion('Productos', creados, actualizados, omitidos, primerError);
    await cargarProductosGestion();
    await cargarUnidadesSelectForm();
    await cargarTiposIvaSelectForm();
    if (typeof cargarProductosSelect === 'function') await cargarProductosSelect();
  } catch (err) {
    avisarUsuario(`Error leyendo Excel de Productos: ${err.message}`, 'error', 7000);
  } finally {
    if (input) input.value = '';
  }
}

async function importarClientesExcel(event) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (!file) return;
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) { input.value = ''; return; }

  try {
    avisarUsuario('Leyendo archivo Excel de Clientes...', 'info', 3000);
    const filas = await leerFilasExcelCatalogo(file);
    if (filas.length === 0) {
      avisarUsuario('El archivo no contiene filas válidas.', 'warning');
      return;
    }

    const { data: cliDb } = await supabaseClient.from('clientes').select('*').eq('tenant_id', tenantId);
    const existentes = cliDb || [];
    let creados = 0, actualizados = 0, omitidos = 0, primerError = '';

    for (const fila of filas) {
      const rif = String(obtenerCampoFilaExcel(fila, ['RIF', 'RIF / Cédula', 'Cedula', 'Documento'])).trim().toUpperCase();
      const razonSocial = String(obtenerCampoFilaExcel(fila, ['Razón Social', 'Razon Social', 'Nombre', 'Cliente'])).trim().toUpperCase();
      if (!rif || !razonSocial) {
        omitidos++;
        if (!primerError) primerError = 'Falta RIF o Razón Social';
        continue;
      }

      const existente = existentes.find(c => String(c.rif || '').trim().toUpperCase() === rif);
      const payload = {
        tenant_id: tenantId,
        rif,
        razon_social: razonSocial,
        direccion: String(obtenerCampoFilaExcel(fila, ['Dirección', 'Direccion', 'Dirección Fiscal'])).trim(),
        telefono: String(obtenerCampoFilaExcel(fila, ['Teléfono', 'Telefono', 'Celular'])).trim(),
        email: String(obtenerCampoFilaExcel(fila, ['Correo', 'Correo Electrónico', 'Email'])).trim().toLowerCase() || null,
        contacto: String(obtenerCampoFilaExcel(fila, ['Contacto', 'Persona de Contacto'])).trim() || null,
        es_contribuyente_especial: parseBoolExcel(obtenerCampoFilaExcel(fila, ['Contribuyente Especial', 'Contribuyente']), false),
        cuenta_contable: String(obtenerCampoFilaExcel(fila, ['Cuenta Contable (CxC)', 'Cuenta Contable', 'CxC'])).trim()
      };
      const payloadContable = {
        cuenta_anticipos: String(obtenerCampoFilaExcel(fila, ['Cta. Anticipos', 'Cuenta Anticipos'])).trim() || null,
        condicion_credito_dias: Math.trunc(parseNumeroExcel(obtenerCampoFilaExcel(fila, ['Días Crédito', 'Dias Credito']), 0)),
        limite_credito_usd: parseNumeroExcel(obtenerCampoFilaExcel(fila, ['Límite Crédito ($)', 'Limite Credito']), 0)
      };

      const res = await ejecutarGuardarRegistroContable('clientes', existente?.id || '', tenantId, payload, payloadContable);
      if (res.ok) {
        if (existente) actualizados++;
        else {
          creados++;
          if (res.data) existentes.push(res.data);
        }
      } else {
        omitidos++;
        if (!primerError) primerError = res.message;
      }
    }

    mostrarResumenImportacion('Clientes', creados, actualizados, omitidos, primerError);
    await cargarClientesGestion();
    if (typeof cargarClientesSelect === 'function') await cargarClientesSelect();
  } catch (err) {
    avisarUsuario(`Error leyendo Excel de Clientes: ${err.message}`, 'error', 7000);
  } finally {
    if (input) input.value = '';
  }
}

async function importarProveedoresExcel(event) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (!file) return;
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) { input.value = ''; return; }

  try {
    avisarUsuario('Leyendo archivo Excel de Proveedores...', 'info', 3000);
    const filas = await leerFilasExcelCatalogo(file);
    if (filas.length === 0) {
      avisarUsuario('El archivo no contiene filas válidas.', 'warning');
      return;
    }

    const { data: provDb } = await supabaseClient.from('proveedores').select('*').eq('tenant_id', tenantId);
    const existentes = provDb || [];
    let creados = 0, actualizados = 0, omitidos = 0, primerError = '';

    for (const fila of filas) {
      const rif = String(obtenerCampoFilaExcel(fila, ['RIF', 'Documento'])).trim().toUpperCase();
      const razonSocial = String(obtenerCampoFilaExcel(fila, ['Razón Social', 'Razon Social', 'Nombre', 'Proveedor'])).trim().toUpperCase();
      if (!rif || !razonSocial) {
        omitidos++;
        if (!primerError) primerError = 'Falta RIF o Razón Social';
        continue;
      }

      const existente = existentes.find(p => String(p.rif || '').trim().toUpperCase() === rif);
      const payload = {
        tenant_id: tenantId,
        rif,
        razon_social: razonSocial,
        direccion: String(obtenerCampoFilaExcel(fila, ['Dirección', 'Direccion', 'Dirección Fiscal'])).trim(),
        telefono: String(obtenerCampoFilaExcel(fila, ['Teléfono', 'Telefono'])).trim(),
        email: String(obtenerCampoFilaExcel(fila, ['Correo', 'Correo Electrónico', 'Email'])).trim().toLowerCase() || null,
        contacto: String(obtenerCampoFilaExcel(fila, ['Contacto', 'Persona de Contacto'])).trim() || null,
        es_contribuyente_especial: parseBoolExcel(obtenerCampoFilaExcel(fila, ['Contribuyente Especial', 'Contribuyente']), true),
        cuenta_contable: String(obtenerCampoFilaExcel(fila, ['Cuenta Contable (CxP)', 'Cuenta Contable', 'CxP'])).trim()
      };
      const payloadContable = {
        tipo_persona: String(obtenerCampoFilaExcel(fila, ['Tipo Persona'])).trim().toUpperCase() || 'PJD',
        retencion_iva_pct: parseNumeroExcel(obtenerCampoFilaExcel(fila, ['% Retención IVA', 'Retencion IVA']), 75),
        condicion_credito_dias: Math.trunc(parseNumeroExcel(obtenerCampoFilaExcel(fila, ['Días Crédito', 'Dias Credito']), 0)),
        cuenta_anticipos: String(obtenerCampoFilaExcel(fila, ['Cta. Anticipos', 'Cuenta Anticipos'])).trim() || null
      };

      const res = await ejecutarGuardarRegistroContable('proveedores', existente?.id || '', tenantId, payload, payloadContable);
      if (res.ok) {
        if (existente) actualizados++;
        else {
          creados++;
          if (res.data) existentes.push(res.data);
        }
      } else {
        omitidos++;
        if (!primerError) primerError = res.message;
      }
    }

    mostrarResumenImportacion('Proveedores', creados, actualizados, omitidos, primerError);
    await cargarProveedoresGestion();
    if (typeof cargarProveedoresSelectCompra === 'function') await cargarProveedoresSelectCompra();
  } catch (err) {
    avisarUsuario(`Error leyendo Excel de Proveedores: ${err.message}`, 'error', 7000);
  } finally {
    if (input) input.value = '';
  }
}

async function importarUnidadesExcel(event) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (!file) return;
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) { input.value = ''; return; }

  try {
    const filas = await leerFilasExcelCatalogo(file);
    if (filas.length === 0) {
      avisarUsuario('El archivo no contiene filas válidas.', 'warning');
      return;
    }

    const { data: uniDb } = await supabaseClient.from('unidades_medida').select('*').eq('tenant_id', tenantId);
    const existentes = uniDb || [];
    let creados = 0, actualizados = 0, omitidos = 0, primerError = '';

    for (const fila of filas) {
      const nombre = String(obtenerCampoFilaExcel(fila, ['Abreviatura / Nombre', 'Abreviatura', 'Nombre', 'Unidad'])).trim().toUpperCase();
      if (!nombre) { omitidos++; continue; }

      const existente = existentes.find(u => String(u.nombre || '').trim().toUpperCase() === nombre);
      if (existente) {
        actualizados++;
        continue;
      }
      const res = await ejecutarGuardarRegistro('unidades_medida', '', tenantId, { tenant_id: tenantId, nombre });
      if (res.ok) {
        creados++;
        if (res.data) existentes.push(res.data);
      } else {
        omitidos++;
        if (!primerError) primerError = res.message;
      }
    }

    mostrarResumenImportacion('Unidades', creados, actualizados, omitidos, primerError);
    await cargarUnidadesMedidaGestion();
    await cargarUnidadesSelectForm();
  } catch (err) {
    avisarUsuario(`Error leyendo Excel de Unidades: ${err.message}`, 'error', 7000);
  } finally {
    if (input) input.value = '';
  }
}

async function importarTiposIvaExcel(event) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (!file) return;
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) { input.value = ''; return; }

  try {
    const filas = await leerFilasExcelCatalogo(file);
    if (filas.length === 0) {
      avisarUsuario('El archivo no contiene filas válidas.', 'warning');
      return;
    }

    const { data: ivaDb } = await supabaseClient.from('tipos_iva').select('*').eq('tenant_id', tenantId);
    const existentes = ivaDb || [];
    let creados = 0, actualizados = 0, omitidos = 0, primerError = '';

    for (const fila of filas) {
      const nombre = String(obtenerCampoFilaExcel(fila, ['Descripción / Nombre', 'Descripcion', 'Nombre', 'Alícuota', 'Tipo IVA'])).trim().toUpperCase();
      if (!nombre) { omitidos++; continue; }
      const porcentaje = parseNumeroExcel(obtenerCampoFilaExcel(fila, ['Porcentaje (%)', 'Porcentaje', 'Tasa', 'IVA']), 16);
      const codDefault = porcentaje === 0 ? 'E' : (porcentaje === 8 ? 'R' : (porcentaje > 16 ? 'A' : 'G'));
      const codigoSeniat = String(obtenerCampoFilaExcel(fila, ['Código SENIAT', 'Codigo SENIAT', 'Codigo'])).trim().toUpperCase() || codDefault;

      const existente = existentes.find(t => String(t.nombre || '').trim().toUpperCase() === nombre);
      const payload = { tenant_id: tenantId, nombre, porcentaje };
      const payloadContable = {
        codigo_seniat: codigoSeniat,
        cuenta_debito_fiscal: String(obtenerCampoFilaExcel(fila, ['Cta. IVA Débito', 'Cta IVA Debito', 'Cuenta Debito'])).trim() || null,
        cuenta_credito_fiscal: String(obtenerCampoFilaExcel(fila, ['Cta. IVA Crédito', 'Cta IVA Credito', 'Cuenta Credito'])).trim() || null
      };

      const res = await ejecutarGuardarRegistroContable('tipos_iva', existente?.id || '', tenantId, payload, payloadContable);
      if (res.ok) {
        if (existente) actualizados++;
        else {
          creados++;
          if (res.data) existentes.push(res.data);
        }
      } else {
        omitidos++;
        if (!primerError) primerError = res.message;
      }
    }

    mostrarResumenImportacion('Tipos de IVA', creados, actualizados, omitidos, primerError);
    await cargarTiposIvaGestion();
    await cargarTiposIvaSelectForm();
  } catch (err) {
    avisarUsuario(`Error leyendo Excel de Tipos de IVA: ${err.message}`, 'error', 7000);
  } finally {
    if (input) input.value = '';
  }
}

async function importarViasPagoExcel(event) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (!file) return;
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) { input.value = ''; return; }

  try {
    const filas = await leerFilasExcelCatalogo(file);
    if (filas.length === 0) {
      avisarUsuario('El archivo no contiene filas válidas.', 'warning');
      return;
    }

    const { data: viasDb } = await supabaseClient.from('vias_pago').select('*').eq('tenant_id', tenantId);
    const existentes = viasDb || [];
    let creados = 0, actualizados = 0, omitidos = 0, primerError = '';

    for (const fila of filas) {
      const nombre = String(obtenerCampoFilaExcel(fila, ['Método de Pago', 'Metodo de Pago', 'Nombre', 'Nombre del Método'])).trim().toUpperCase();
      if (!nombre) { omitidos++; continue; }

      const existente = existentes.find(v => String(v.nombre || '').trim().toUpperCase() === nombre);
      const payload = {
        tenant_id: tenantId,
        nombre,
        codigo_interno: String(obtenerCampoFilaExcel(fila, ['Código', 'Codigo', 'Código Interno'])).trim().toUpperCase() || null,
        requiere_referencia: parseBoolExcel(obtenerCampoFilaExcel(fila, ['Requiere Ref', 'Requiere Referencia']), true),
        activo: parseBoolExcel(obtenerCampoFilaExcel(fila, ['Estatus', 'Activo', 'Estado']), true),
        cuenta_contable: String(obtenerCampoFilaExcel(fila, ['Cuenta Contable', 'Cuenta'])).trim() || null
      };
      const payloadContable = {
        tipo_moneda: String(obtenerCampoFilaExcel(fila, ['Moneda', 'Moneda de Cuenta'])).trim().toUpperCase() || 'VES',
        es_divisa_igtf: parseBoolExcel(obtenerCampoFilaExcel(fila, ['Causa IGTF', 'IGTF']), false)
      };

      const res = await ejecutarGuardarRegistroContable('vias_pago', existente?.id || '', tenantId, payload, payloadContable);
      if (res.ok) {
        if (existente) actualizados++;
        else {
          creados++;
          if (res.data) existentes.push(res.data);
        }
      } else {
        omitidos++;
        if (!primerError) primerError = res.message;
      }
    }

    mostrarResumenImportacion('Vías de Pago', creados, actualizados, omitidos, primerError);
    await cargarViasPagoGestion();
    await cargarViasPagoSelectPos();
  } catch (err) {
    avisarUsuario(`Error leyendo Excel de Vías de Pago: ${err.message}`, 'error', 7000);
  } finally {
    if (input) input.value = '';
  }
}

async function importarSucursalesExcel(event) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (!file) return;
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) { input.value = ''; return; }

  try {
    const filas = await leerFilasExcelCatalogo(file);
    if (filas.length === 0) {
      avisarUsuario('El archivo no contiene filas válidas.', 'warning');
      return;
    }

    const { data: sucDb } = await supabaseClient.from('sucursales').select('*').eq('tenant_id', tenantId);
    const existentes = sucDb || [];
    let creados = 0, actualizados = 0, omitidos = 0, primerError = '';

    for (const fila of filas) {
      const nombre = String(obtenerCampoFilaExcel(fila, ['Sucursal', 'Nombre de Sucursal', 'Nombre'])).trim().toUpperCase();
      if (!nombre) { omitidos++; continue; }

      const existente = existentes.find(s => String(s.nombre || '').trim().toUpperCase() === nombre);
      const payload = {
        tenant_id: tenantId,
        nombre,
        direccion: String(obtenerCampoFilaExcel(fila, ['Dirección', 'Direccion'])).trim()
      };
      const payloadContable = {
        centro_costo: String(obtenerCampoFilaExcel(fila, ['Centro de Costo', 'Centro Costo'])).trim().toUpperCase() || null
      };

      const res = await ejecutarGuardarRegistroContable('sucursales', existente?.id || '', tenantId, payload, payloadContable);
      if (res.ok) {
        if (existente) actualizados++;
        else {
          creados++;
          if (res.data) existentes.push(res.data);
        }
      } else {
        omitidos++;
        if (!primerError) primerError = res.message;
      }
    }

    mostrarResumenImportacion('Sucursales', creados, actualizados, omitidos, primerError);
    await cargarSucursalesGestion();
    await cargarSucursalesSelectAlmacen();
  } catch (err) {
    avisarUsuario(`Error leyendo Excel de Sucursales: ${err.message}`, 'error', 7000);
  } finally {
    if (input) input.value = '';
  }
}

async function importarAlmacenesExcel(event) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (!file) return;
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) { input.value = ''; return; }

  try {
    const filas = await leerFilasExcelCatalogo(file);
    if (filas.length === 0) {
      avisarUsuario('El archivo no contiene filas válidas.', 'warning');
      return;
    }

    const [{ data: almDb }, { data: sucDb }] = await Promise.all([
      supabaseClient.from('almacenes').select('*').eq('tenant_id', tenantId),
      supabaseClient.from('sucursales').select('*').eq('tenant_id', tenantId)
    ]);
    const existentes = almDb || [];
    const sucursales = sucDb || [];
    let creados = 0, actualizados = 0, omitidos = 0, primerError = '';

    for (const fila of filas) {
      const nombre = String(obtenerCampoFilaExcel(fila, ['Nombre Almacén', 'Nombre del Almacén', 'Almacén', 'Almacen', 'Nombre'])).trim().toUpperCase();
      if (!nombre) { omitidos++; continue; }
      const tipo = String(obtenerCampoFilaExcel(fila, ['Tipo'])).trim().toUpperCase() || 'PRINCIPAL';
      const sucNom = String(obtenerCampoFilaExcel(fila, ['Sucursal'])).trim().toUpperCase();

      let sucursalId = null;
      if (sucNom && !['GENERAL', 'N/A', 'NA', 'NINGUNA'].includes(sucNom)) {
        let suc = sucursales.find(s => String(s.nombre || '').trim().toUpperCase() === sucNom);
        if (!suc) {
          const rSuc = await ejecutarGuardarRegistroContable('sucursales', '', tenantId, { tenant_id: tenantId, nombre: sucNom, direccion: '' }, {});
          if (rSuc.ok && rSuc.data) {
            suc = rSuc.data;
            sucursales.push(suc);
          }
        }
        sucursalId = suc?.id || null;
      }

      const existente = existentes.find(a =>
        String(a.nombre || '').trim().toUpperCase() === nombre &&
        String(a.sucursal_id || '') === String(sucursalId || '')
      );
      const payload = {
        tenant_id: tenantId,
        sucursal_id: sucursalId,
        nombre,
        tipo
      };
      const payloadContable = {
        cuenta_inventario: String(obtenerCampoFilaExcel(fila, ['Cuenta Inventario', 'Cta. Inventario'])).trim() || null
      };

      const res = await ejecutarGuardarRegistroContable('almacenes', existente?.id || '', tenantId, payload, payloadContable);
      if (res.ok) {
        if (existente) actualizados++;
        else {
          creados++;
          if (res.data) existentes.push(res.data);
        }
      } else {
        omitidos++;
        if (!primerError) primerError = res.message;
      }
    }

    mostrarResumenImportacion('Almacenes', creados, actualizados, omitidos, primerError);
    await cargarAlmacenesGestion();
    await cargarAlmacenesSelectLote();
    await cargarSucursalesSelectAlmacen();
  } catch (err) {
    avisarUsuario(`Error leyendo Excel de Almacenes: ${err.message}`, 'error', 7000);
  } finally {
    if (input) input.value = '';
  }
}

async function importarLotesExcel(event) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (!file) return;
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) { input.value = ''; return; }

  try {
    const filas = await leerFilasExcelCatalogo(file);
    if (filas.length === 0) {
      avisarUsuario('El archivo no contiene filas válidas.', 'warning');
      return;
    }

    const [{ data: lotesDb }, { data: prodDb }, { data: almDb }] = await Promise.all([
      supabaseClient.from('inventario_lotes').select('*').eq('tenant_id', tenantId),
      supabaseClient.from('productos').select('id, codigo_sku, descripcion').eq('tenant_id', tenantId),
      supabaseClient.from('almacenes').select('id, nombre').eq('tenant_id', tenantId)
    ]);

    const existentes = lotesDb || [];
    const productos = prodDb || [];
    const almacenes = almDb || [];
    let creados = 0, actualizados = 0, omitidos = 0, primerError = '';

    for (const fila of filas) {
      const numeroLote = String(obtenerCampoFilaExcel(fila, ['Lote', 'Número de Lote', 'Numero de Lote'])).trim().toUpperCase();
      if (!numeroLote) { omitidos++; continue; }

      const sku = String(obtenerCampoFilaExcel(fila, ['SKU', 'Código SKU', 'Codigo SKU'])).trim().toUpperCase();
      const material = String(obtenerCampoFilaExcel(fila, ['Material', 'Producto', 'Descripción', 'Descripcion'])).trim().toUpperCase();
      const prod = productos.find(p =>
        (sku && !['N/A', 'S/N'].includes(sku) && String(p.codigo_sku || '').trim().toUpperCase() === sku) ||
        (material && String(p.descripcion || '').trim().toUpperCase() === material)
      );
      if (!prod) {
        omitidos++;
        if (!primerError) primerError = `Producto no encontrado (${sku || material || 'sin SKU/Material'})`;
        continue;
      }

      const almNom = String(obtenerCampoFilaExcel(fila, ['Almacén', 'Almacen', 'Nombre Almacén'])).trim().toUpperCase();
      let alm = null;
      if (almNom && !['SIN ALMACEN', 'SIN ALMACÉN', 'N/A'].includes(almNom)) {
        alm = almacenes.find(a => String(a.nombre || '').trim().toUpperCase() === almNom);
      }

      const existente = existentes.find(l =>
        String(l.numero_lote || '').trim().toUpperCase() === numeroLote &&
        String(l.producto_id || '') === String(prod.id) &&
        String(l.almacen_id || '') === String(alm?.id || '')
      );

      const payload = {
        tenant_id: tenantId,
        producto_id: prod.id,
        almacen_id: alm?.id || null,
        numero_lote: numeroLote,
        stock: parseNumeroExcel(obtenerCampoFilaExcel(fila, ['Stock', 'Cantidad', 'Existencia']), 0),
        ubicacion: String(obtenerCampoFilaExcel(fila, ['Ubicación', 'Ubicacion'])).trim().toUpperCase(),
        fecha_vencimiento: parseFechaIsoExcel(obtenerCampoFilaExcel(fila, ['Fecha Vencimiento', 'Vencimiento'])),
        updated_at: new Date().toISOString()
      };

      const res = await ejecutarGuardarRegistro('inventario_lotes', existente?.id || '', tenantId, payload);
      if (res.ok) {
        if (existente) actualizados++;
        else {
          creados++;
          if (res.data) existentes.push(res.data);
        }
      } else {
        omitidos++;
        if (!primerError) primerError = res.message;
      }
    }

    mostrarResumenImportacion('Lotes', creados, actualizados, omitidos, primerError);
    await cargarLotesGestion();
  } catch (err) {
    avisarUsuario(`Error leyendo Excel de Lotes: ${err.message}`, 'error', 7000);
  } finally {
    if (input) input.value = '';
  }
}


