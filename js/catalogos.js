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
  const tid = tenantActual ? (tenantActual.id || tenantActual.tenant_id || null) : null;
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
  productosGestionCache = data || [];

  if (!tbody) return;
  tbody.innerHTML = '';

  if (productosGestionCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="p-4 text-center text-slate-500">No hay artículos registrados.</td></tr>`;
    return;
  }

  productosGestionCache.forEach(prod => {
    const pv = Number(prod.precio_venta_usd ?? prod.precio_unitario_usd ?? 0);
    const costo = Number(prod.costo_unitario_usd ?? 0);
    const esExento = prod.tipos_iva ? Number(prod.tipos_iva.porcentaje) === 0 : false;
    const tieneIva = Boolean(prod.tipos_iva);
    const labelIva = tieneIva ? `${prod.tipos_iva.nombre} (${prod.tipos_iva.porcentaje}%)` : 'SIN ASIGNAR';
    const badgeClass = !tieneIva
      ? 'bg-slate-800 text-slate-400'
      : (esExento ? 'bg-sky-950 text-sky-300' : 'bg-emerald-950 text-emerald-300');
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/60">
        <td class="p-3 font-mono text-emerald-400 font-bold">${esc(prod.codigo_sku || 'S/N')}</td>
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

  if (!payload.descripcion) {
    avisarUsuario('Ingrese la descripción del producto.', 'warning');
    return;
  }

  setEstadoBotonGuardar('btnGuardarProducto', true);
  try {
    const res = await ejecutarGuardarRegistro('productos', editId, tenantId, payload);
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

  const excelData = data.map(p => ({
    SKU: p.codigo_sku || 'N/A',
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
    'Cuenta Contable': p.cuenta_contable || ''
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
  clientesGestionCache = data || [];

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

  if (!payload.rif || !payload.razon_social) {
    avisarUsuario('Ingrese RIF y Razón Social del cliente.', 'warning');
    return;
  }

  setEstadoBotonGuardar('btnGuardarCliente', true);
  try {
    const res = await ejecutarGuardarRegistro('clientes', editId, tenantId, payload);
    if (!res.ok) { avisarUsuario(res.message, 'error', 9000); return; }
    avisarUsuario(editId ? '¡Cliente actualizado con éxito!' : '¡Cliente guardado con éxito!', 'success');
    limpiarFormCliente();
    await cargarClientesGestion();
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
}

async function exportarClientesExcel() {
  const tenantId = obtenerTenantIdActual();
  if (!tenantId) return;
  const { data, error } = await supabaseClient.from('clientes').select('*').eq('tenant_id', tenantId);
  if (error) { avisarUsuario(explicarErrorSupabase('clientes', 'exportar', error), 'error'); return; }
  if (!data || data.length === 0) { avisarUsuario('Sin clientes para exportar.', 'warning'); return; }

  const excelData = data.map(c => ({
    RIF: c.rif,
    'Razón Social': c.razon_social,
    Dirección: c.direccion || '',
    Teléfono: c.telefono || '',
    Correo: c.email || '',
    Contacto: c.contacto || '',
    'Contribuyente Especial': c.es_contribuyente_especial ? 'SÍ' : 'NO',
    'Cuenta Contable': c.cuenta_contable || ''
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
  proveedoresGestionCache = data || [];

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

  if (!payload.rif || !payload.razon_social) {
    avisarUsuario('Ingrese RIF y Razón Social del proveedor.', 'warning');
    return;
  }

  setEstadoBotonGuardar('btnGuardarProveedor', true);
  try {
    const res = await ejecutarGuardarRegistro('proveedores', editId, tenantId, payload);
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

  const excelData = data.map(p => ({
    RIF: p.rif,
    'Razón Social': p.razon_social,
    Dirección: p.direccion || '',
    Teléfono: p.telefono || '',
    Correo: p.email || '',
    Contacto: p.contacto || '',
    'Contribuyente Especial': p.es_contribuyente_especial ? 'SÍ' : 'NO',
    'Cuenta Contable': p.cuenta_contable || ''
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
  sucursalesGestionCache = data || [];

  if (!tbody) return;
  tbody.innerHTML = '';

  if (sucursalesGestionCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-500">Sin sucursales registradas.</td></tr>`;
    return;
  }

  sucursalesGestionCache.forEach(s => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/60">
        <td class="p-3 font-bold text-emerald-400">${esc(s.nombre)}</td>
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

  if (!payload.nombre) {
    avisarUsuario('Ingrese el nombre de la sucursal.', 'warning');
    return;
  }

  setEstadoBotonGuardar('btnGuardarSucursal', true);
  try {
    const res = await ejecutarGuardarRegistro('sucursales', editId, tenantId, payload);
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

  const excelData = data.map(s => ({
    Sucursal: s.nombre,
    Dirección: s.direccion || '',
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
  almacenesGestionCache = data || [];

  if (!tbody) return;
  tbody.innerHTML = '';

  if (almacenesGestionCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-500">Sin almacenes/depósitos registrados.</td></tr>`;
    return;
  }

  almacenesGestionCache.forEach(a => {
    const sucursalNom = a.sucursales?.nombre || 'General';
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/60">
        <td class="p-3 font-bold text-white">${esc(a.nombre)}</td>
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

  if (!payload.nombre) {
    avisarUsuario('Ingrese el nombre del almacén.', 'warning');
    return;
  }

  setEstadoBotonGuardar('btnGuardarAlmacen', true);
  try {
    const res = await ejecutarGuardarRegistro('almacenes', editId, tenantId, payload);
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

  const excelData = data.map(a => ({
    'Nombre Almacén': a.nombre,
    Tipo: a.tipo || 'PRINCIPAL',
    Sucursal: a.sucursales?.nombre || 'General',
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
  tiposIvaGestionCache = data || [];

  if (!tbody) return;
  tbody.innerHTML = '';

  if (tiposIvaGestionCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-500">Se aplican las alícuotas SENIAT estándar (16%, 8%, 0% Exento).</td></tr>`;
    return;
  }

  tiposIvaGestionCache.forEach(t => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/60">
        <td class="p-3 font-bold text-emerald-400">${esc(t.nombre)}</td>
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

  if (!payload.nombre) {
    avisarUsuario('Ingrese la descripción de la alícuota.', 'warning');
    return;
  }

  setEstadoBotonGuardar('btnGuardarTipoIva', true);
  try {
    const res = await ejecutarGuardarRegistro('tipos_iva', editId, tenantId, payload);
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

  const excelData = data.map(t => ({
    'Descripción / Nombre': t.nombre,
    'Porcentaje (%)': t.porcentaje,
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
  viasPagoGestionCache = data || [];

  if (!tbody) return;
  tbody.innerHTML = '';

  if (viasPagoGestionCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-500">No hay vías de pago personalizadas registradas aún. Registra una arriba o revisa los permisos RLS en Supabase.</td></tr>`;
    return;
  }

  viasPagoGestionCache.forEach(v => {
    const reqRef = v.requiere_referencia !== false;
    const estaActivo = v.activo !== false;
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/60">
        <td class="p-3 font-bold text-white">${esc(v.nombre)}</td>
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

  if (!payload.nombre) {
    avisarUsuario('Ingrese la denominación del método de pago.', 'warning');
    return;
  }

  setEstadoBotonGuardar('btnGuardarViaPago', true);
  try {
    const res = await ejecutarGuardarRegistro('vias_pago', editId, tenantId, payload);
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

  const excelData = data.map(v => ({
    'Método de Pago': v.nombre,
    Código: v.codigo_interno || '',
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
// ==========================================

function cargarDatosReferidos() {
  if (!tenantActual) return;
  const base = String(tenantActual.rif || tenantActual.id || 'VE2026').replace(/[^A-Z0-9]/gi, '').slice(0, 8).toUpperCase();
  const codigo = `MFD-${base}`;
  const enlace = `${window.location.origin}/?ref=${encodeURIComponent(codigo)}`;

  const elCod = document.getElementById('refCodigoMiEmpresa');
  const elUrl = document.getElementById('refEnlaceCompartir');
  if (elCod) elCod.textContent = codigo;
  if (elUrl) elUrl.value = enlace;
}

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
  const tbody = document.getElementById('tablaInquilinosMaster');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">Consultando inquilinos SaaS...</td></tr>`;

  const { data, error } = await supabaseClient
    .from('tenants')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-rose-400">${esc(explicarErrorSupabase('tenants', 'consultar', error))}</td></tr>`;
    return;
  }

  inquilinosMasterCache = data || [];
  const totalEl = document.getElementById('masterTotalInquilinos');
  if (totalEl) totalEl.textContent = String(inquilinosMasterCache.length);

  tbody.innerHTML = '';
  if (inquilinosMasterCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-500">Sin inquilinos registrados.</td></tr>`;
    return;
  }

  inquilinosMasterCache.forEach(t => {
    const plan = String(t.plan_activo || 'Freemium').toUpperCase();
    const rol = String(t.rol || 'cliente').toUpperCase();
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/40">
        <td class="p-3 font-medium text-white">${esc(t.razon_social || 'Sin Razón Social')}</td>
        <td class="p-3 font-mono text-slate-300">${esc(t.rif || 'N/A')}</td>
        <td class="p-3 font-mono text-slate-400">${esc(t.email || '')}</td>
        <td class="p-3 font-mono text-xs text-slate-300">${esc(rol)}</td>
        <td class="p-3 font-mono text-xs font-bold text-emerald-400">${esc(plan)}</td>
        <td class="p-3 text-emerald-400 font-semibold text-xs">Activo</td>
        <td class="p-3 text-center">
          <select onchange='cambiarPlanInquilinoMaster("${esc(t.id)}", this.value)' class="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 cursor-pointer">
            <option value="Freemium" ${plan === 'FREEMIUM' ? 'selected' : ''}>Freemium</option>
            <option value="Pyme" ${plan === 'PYME' ? 'selected' : ''}>Pyme</option>
            <option value="Enterprise" ${plan === 'ENTERPRISE' ? 'selected' : ''}>Enterprise</option>
          </select>
        </td>
      </tr>
    `;
  });
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

