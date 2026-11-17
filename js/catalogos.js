/**
 * /js/catalogos.js
 * Módulo completo y definitivo de Gestión de Catálogos y Maestros (SENIAT 2026)
 * Sincronizado al 100% con Supabase Multi-Tenant y SheetJS (XLSX)
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

// ==========================================
// 1. GESTIÓN DE PRODUCTOS / ARTÍCULOS
// ==========================================

async function cargarProductosGestion() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const { data, error } = await supabaseClient
    .from('productos')
    .select('*')
    .or(`tenant_id.eq.${tenantId},tenants_id.eq.${tenantId}`)
    .order('created_at', { ascending: false });

  if (error) { console.error('Error al cargar artículos:', error.message); return; }
  productosGestionCache = data || [];

  const tbody = document.getElementById('tablaProductosGestion');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (productosGestionCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="p-4 text-center text-slate-500">No hay artículos registrados.</td></tr>`;
    return;
  }

  productosGestionCache.forEach(prod => {
    const pv = prod.precio_venta_usd || prod.precio_unitario_usd || 0;
    const costo = prod.costo_unitario_usd || 0;
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/60">
        <td class="p-3 font-mono text-emerald-400 font-bold">${prod.codigo_sku || 'S/N'}</td>
        <td class="p-3 text-amber-300 font-semibold">${prod.categoria || 'N/A'}</td>
        <td class="p-3 text-white font-medium">${prod.descripcion}</td>
        <td class="p-3 font-mono text-slate-300">${prod.ubicacion || 'N/A'}</td>
        <td class="p-3 font-mono text-center">${prod.maneja_inventario ? (prod.stock || 0) : 'N/A'}</td>
        <td class="p-3 font-mono">$ ${costo.toFixed(2)}</td>
        <td class="p-3 font-mono text-emerald-400 font-bold">$ ${pv.toFixed(2)}</td>
        <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] ${prod.es_exento ? 'bg-sky-950 text-sky-300' : 'bg-emerald-950 text-emerald-300'}">${prod.es_exento ? 'EXENTO' : 'GRAVADO (16%)'}</span></td>
        <td class="p-3 text-center space-x-2">
          <button onclick='editarProducto("${prod.id}", ${JSON.stringify(prod).replace(/"/g, '&quot;')})' class="text-sky-400 hover:underline font-semibold">Editar</button>
          <button onclick='eliminarProducto("${prod.id}")' class="text-rose-400 hover:underline font-semibold">Eliminar</button>
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

function editarProducto(id, prod) {
  if (!prod) return;
  document.getElementById('editProductoId').value = id;
  document.getElementById('prodSku').value = prod.codigo_sku || '';
  document.getElementById('prodCategoria').value = prod.categoria || '';
  document.getElementById('prodUbicacion').value = prod.ubicacion || '';
  document.getElementById('prodManejaInventario').value = String(prod.maneja_inventario ?? true);
  document.getElementById('prodUnidadMedida').value = prod.unidad_medida || 'UND';
  document.getElementById('prodStock').value = prod.stock || 0;
  document.getElementById('prodLote').value = prod.lote || 'SIN-LOTE';
  document.getElementById('prodDescripcion').value = prod.descripcion || '';
  document.getElementById('prodCosto').value = prod.costo_unitario_usd || 0;
  document.getElementById('prodUtilidad').value = prod.margen_utilidad_porcentaje || 30;
  document.getElementById('prodPrecioVenta').value = prod.precio_venta_usd || prod.precio_unitario_usd || 0;
  document.getElementById('prodExento').value = String(prod.es_exento ?? false);
  document.getElementById('prodCuentaContable').value = prod.cuenta_contable || '';

  const btnCancel = document.getElementById('btnCancelarProd');
  if (btnCancel) btnCancel.classList.remove('hidden');
  const titulo = document.getElementById('tituloFormProducto');
  if (titulo) titulo.innerText = '✏️ Editar Artículo';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function limpiarFormProducto() {
  document.getElementById('editProductoId').value = '';
  document.getElementById('prodSku').value = '';
  document.getElementById('prodCategoria').value = '';
  document.getElementById('prodUbicacion').value = '';
  document.getElementById('prodStock').value = '100';
  document.getElementById('prodLote').value = 'SIN-LOTE';
  document.getElementById('prodDescripcion').value = '';
  document.getElementById('prodCosto').value = '1.00';
  document.getElementById('prodUtilidad').value = '30.00';
  document.getElementById('prodPrecioVenta').value = '1.30';
  document.getElementById('prodCuentaContable').value = '';

  const btnCancel = document.getElementById('btnCancelarProd');
  if (btnCancel) btnCancel.classList.add('hidden');
  const titulo = document.getElementById('tituloFormProducto');
  if (titulo) titulo.innerText = '📦 Maestro de Artículos y Servicios';
}

async function guardarProducto() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const editId = document.getElementById('editProductoId').value;
  const payload = {
    tenant_id: tenantId,
    tenants_id: tenantId,
    codigo_sku: document.getElementById('prodSku').value.trim().toUpperCase(),
    categoria: document.getElementById('prodCategoria').value.trim().toUpperCase(),
    ubicacion: document.getElementById('prodUbicacion').value.trim().toUpperCase(),
    descripcion: document.getElementById('prodDescripcion').value.trim().toUpperCase(),
    maneja_inventario: document.getElementById('prodManejaInventario').value === 'true',
    unidad_medida: document.getElementById('prodUnidadMedida').value,
    stock: parseFloat(document.getElementById('prodStock').value) || 0,
    lote: document.getElementById('prodLote').value.trim().toUpperCase() || 'SIN-LOTE',
    costo_unitario_usd: parseFloat(document.getElementById('prodCosto').value) || 0,
    margen_utilidad_porcentaje: parseFloat(document.getElementById('prodUtilidad').value) || 30,
    precio_venta_usd: parseFloat(document.getElementById('prodPrecioVenta').value) || 0,
    precio_unitario_usd: parseFloat(document.getElementById('prodPrecioVenta').value) || 0,
    es_exento: document.getElementById('prodExento').value === 'true',
    cuenta_contable: document.getElementById('prodCuentaContable').value.trim()
  };

  if (!payload.descripcion) { alert('Ingrese la descripción del producto.'); return; }

  let error = null;
  if (editId) {
    const res = await supabaseClient.from('productos').update(payload).eq('id', editId);
    error = res.error;
  } else {
    const res = await supabaseClient.from('productos').insert([payload]);
    error = res.error;
  }

  if (error) { alert('Error al guardar artículo: ' + error.message); return; }
  alert(editId ? '¡Artículo actualizado con éxito!' : '¡Artículo guardado con éxito!');
  limpiarFormProducto();
  cargarProductosGestion();
}

async function eliminarProducto(id) {
  if (!confirm('¿Estás seguro de eliminar este artículo?')) return;
  const { error } = await supabaseClient.from('productos').delete().eq('id', id);
  if (error) { alert('Error al eliminar artículo: ' + error.message); return; }
  alert('¡Artículo eliminado!');
  cargarProductosGestion();
}

async function exportarStockExcel() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const { data } = await supabaseClient.from('productos').select('*').or(`tenant_id.eq.${tenantId},tenants_id.eq.${tenantId}`);
  if (!data || data.length === 0) { alert('Sin productos para exportar.'); return; }

  const excelData = data.map(p => ({
    SKU: p.codigo_sku || 'N/A',
    Categoría: p.categoria || '',
    Descripción: p.descripcion,
    Ubicación: p.ubicacion || '',
    'Control Inventario': p.maneja_inventario ? 'SÍ' : 'NO',
    Unidad: p.unidad_medida || 'UND',
    Stock: p.stock || 0,
    Lote: p.lote || 'SIN-LOTE',
    'Costo ($)': p.costo_unitario_usd || 0,
    '% Utilidad': p.margen_utilidad_porcentaje || 0,
    'Precio Venta ($)': p.precio_venta_usd || 0,
    'Estatus Fiscal': p.es_exento ? 'EXENTO' : 'GRAVADO',
    'Cuenta Contable': p.cuenta_contable || ''
  }));

  descargarExcelMatriz([Object.keys(excelData[0]), ...excelData.map(Object.values)], 'Catálogo_Productos', 'Productos');
}

// ==========================================
// 2. GESTIÓN DE CLIENTES
// ==========================================

async function cargarClientesGestion() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const { data, error } = await supabaseClient
    .from('clientes')
    .select('*')
    .or(`tenant_id.eq.${tenantId},tenants_id.eq.${tenantId}`)
    .order('created_at', { ascending: false });

  if (error) { console.error('Error al cargar clientes:', error.message); return; }
  clientesGestionCache = data || [];

  const tbody = document.getElementById('tablaClientesGestion');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (clientesGestionCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-500">No hay clientes registrados.</td></tr>`;
    return;
  }

  clientesGestionCache.forEach(c => {
    const contrib = c.es_contribuyente_especial ?? c.es_contruyente_especial ?? false;
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/60">
        <td class="p-3 font-mono text-emerald-400 font-bold">${c.rif}</td>
        <td class="p-3 text-white font-medium">${c.razon_social}</td>
        <td class="p-3">${c.telefono || 'N/A'}</td>
        <td class="p-3 font-mono text-slate-400">${c.email || 'N/A'}</td>
        <td class="p-3 text-slate-300">${c.contacto || 'N/A'}</td>
        <td class="p-3 text-center"><span class="px-2 py-0.5 rounded text-[10px] ${contrib ? 'bg-amber-950 text-amber-300 font-bold' : 'bg-slate-800 text-slate-400'}">${contrib ? 'SÍ' : 'NO'}</span></td>
        <td class="p-3 text-center space-x-2">
          <button onclick='editarCliente("${c.id}", ${JSON.stringify(c).replace(/"/g, '&quot;')})' class="text-sky-400 hover:underline font-semibold">Editar</button>
          <button onclick='eliminarCliente("${c.id}")' class="text-rose-400 hover:underline font-semibold">Eliminar</button>
        </td>
      </tr>
    `;
  });
}

function editarCliente(id, c) {
  if (!c) return;
  document.getElementById('editClienteId').value = id;
  document.getElementById('cliRif').value = c.rif || '';
  document.getElementById('cliRazonSocial').value = c.razon_social || '';
  document.getElementById('cliDireccion').value = c.direccion || '';
  document.getElementById('cliTelefono').value = c.telefono || '';
  document.getElementById('cliEmail').value = c.email || '';
  document.getElementById('cliContacto').value = c.contacto || '';
  document.getElementById('cliContribuyenteEspecial').value = String(c.es_contribuyente_especial ?? c.es_contruyente_especial ?? false);
  document.getElementById('cliCuentaContable').value = c.cuenta_contable || '';

  const btnCancel = document.getElementById('btnCancelarCli');
  if (btnCancel) btnCancel.classList.remove('hidden');
  const titulo = document.getElementById('tituloFormCliente');
  if (titulo) titulo.innerText = '✏️ Editar Cliente';
  window.scrollTo({ top: 0, behavior: 'smooth' });
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
}

async function guardarCliente() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const editId = document.getElementById('editClienteId').value;
  const isContrib = document.getElementById('cliContribuyenteEspecial').value === 'true';
  const payload = {
    tenant_id: tenantId,
    tenants_id: tenantId,
    rif: document.getElementById('cliRif').value.trim().toUpperCase(),
    razon_social: document.getElementById('cliRazonSocial').value.trim().toUpperCase(),
    direccion: document.getElementById('cliDireccion').value.trim(),
    telefono: document.getElementById('cliTelefono').value.trim(),
    email: document.getElementById('cliEmail').value.trim().toLowerCase(),
    contacto: document.getElementById('cliContacto').value.trim(),
    es_contribuyente_especial: isContrib,
    es_contruyente_especial: isContrib,
    cuenta_contable: document.getElementById('cliCuentaContable').value.trim()
  };

  if (!payload.rif || !payload.razon_social) {
    alert('Ingrese RIF y Razón Social del cliente.');
    return;
  }

  let error = null;
  if (editId) {
    const res = await supabaseClient.from('clientes').update(payload).eq('id', editId);
    error = res.error;
  } else {
    const res = await supabaseClient.from('clientes').insert([payload]);
    error = res.error;
  }

  if (error) { alert('Error al guardar cliente: ' + error.message); return; }
  alert(editId ? '¡Cliente actualizado con éxito!' : '¡Cliente guardado con éxito!');
  limpiarFormCliente();
  cargarClientesGestion();
}

async function eliminarCliente(id) {
  if (!confirm('¿Estás seguro de eliminar este cliente?')) return;
  const { error } = await supabaseClient.from('clientes').delete().eq('id', id);
  if (error) { alert('Error al eliminar cliente: ' + error.message); return; }
  alert('¡Cliente eliminado!');
  cargarClientesGestion();
}

async function exportarClientesExcel() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const { data } = await supabaseClient.from('clientes').select('*').or(`tenant_id.eq.${tenantId},tenants_id.eq.${tenantId}`);
  if (!data || data.length === 0) { alert('Sin clientes para exportar.'); return; }

  const excelData = data.map(c => ({
    RIF: c.rif,
    'Razón Social': c.razon_social,
    Dirección: c.direccion || '',
    Teléfono: c.telefono || '',
    Correo: c.email || '',
    Contacto: c.contacto || '',
    'Contribuyente Especial': (c.es_contribuyente_especial ?? c.es_contruyente_especial) ? 'SÍ' : 'NO',
    'Cuenta Contable': c.cuenta_contable || ''
  }));

  descargarExcelMatriz([Object.keys(excelData[0]), ...excelData.map(Object.values)], 'Directorio_Clientes', 'Clientes');
}

// ==========================================
// 3. GESTIÓN DE PROVEEDORES
// ==========================================

async function cargarProveedoresGestion() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const { data, error } = await supabaseClient
    .from('proveedores')
    .select('*')
    .or(`tenant_id.eq.${tenantId},tenants_id.eq.${tenantId}`)
    .order('created_at', { ascending: false });

  if (error) { console.error('Error al cargar proveedores:', error.message); return; }
  proveedoresGestionCache = data || [];

  const tbody = document.getElementById('tablaProveedoresGestion');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (proveedoresGestionCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-500">No hay proveedores registrados.</td></tr>`;
    return;
  }

  proveedoresGestionCache.forEach(p => {
    const contrib = p.es_contribuyente_especial ?? p.es_contruyente_especial ?? true;
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/60">
        <td class="p-3 font-mono text-emerald-400 font-bold">${p.rif}</td>
        <td class="p-3 text-white font-medium">${p.razon_social}</td>
        <td class="p-3">${p.telefono || 'N/A'}</td>
        <td class="p-3 font-mono text-slate-400">${p.email || 'N/A'}</td>
        <td class="p-3 font-mono font-bold text-amber-300">${p.porcentaje_retencion_iva || 100}%</td>
        <td class="p-3 text-center"><span class="px-2 py-0.5 rounded text-[10px] ${contrib ? 'bg-amber-950 text-amber-300 font-bold' : 'bg-slate-800 text-slate-400'}">${contrib ? 'SÍ' : 'NO'}</span></td>
        <td class="p-3 text-center space-x-2">
          <button onclick='editarProveedor("${p.id}", ${JSON.stringify(p).replace(/"/g, '&quot;')})' class="text-sky-400 hover:underline font-semibold">Editar</button>
          <button onclick='eliminarProveedor("${p.id}")' class="text-rose-400 hover:underline font-semibold">Eliminar</button>
        </td>
      </tr>
    `;
  });
}

function editarProveedor(id, p) {
  if (!p) return;
  document.getElementById('editProveedorId').value = id;
  document.getElementById('provRif').value = p.rif || '';
  document.getElementById('provRazonSocial').value = p.razon_social || '';
  document.getElementById('provDireccion').value = p.direccion || '';
  document.getElementById('provTelefono').value = p.telefono || '';
  document.getElementById('provEmail').value = p.email || '';
  document.getElementById('provContacto').value = p.contacto || '';
  document.getElementById('provRetIva').value = p.porcentaje_retencion_iva || 100;
  document.getElementById('provContribuyenteEspecial').value = String(p.es_contribuyente_especial ?? p.es_contruyente_especial ?? true);
  document.getElementById('provCuentaContable').value = p.cuenta_contable || '';

  const btnCancel = document.getElementById('btnCancelarProv');
  if (btnCancel) btnCancel.classList.remove('hidden');
  const titulo = document.getElementById('tituloFormProveedor');
  if (titulo) titulo.innerText = '✏️ Editar Proveedor';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function limpiarFormProveedor() {
  document.getElementById('editProveedorId').value = '';
  document.getElementById('provRif').value = '';
  document.getElementById('provRazonSocial').value = '';
  document.getElementById('provDireccion').value = '';
  document.getElementById('provTelefono').value = '';
  document.getElementById('provEmail').value = '';
  document.getElementById('provContacto').value = '';
  document.getElementById('provRetIva').value = '100';
  document.getElementById('provContribuyenteEspecial').value = 'true';
  document.getElementById('provCuentaContable').value = '';

  const btnCancel = document.getElementById('btnCancelarProv');
  if (btnCancel) btnCancel.classList.add('hidden');
  const titulo = document.getElementById('tituloFormProveedor');
  if (titulo) titulo.innerText = '🏭 Maestro de Proveedores';
}

async function guardarProveedor() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const editId = document.getElementById('editProveedorId').value;
  const isContrib = document.getElementById('provContribuyenteEspecial').value === 'true';
  const payload = {
    tenant_id: tenantId,
    tenants_id: tenantId,
    rif: document.getElementById('provRif').value.trim().toUpperCase(),
    razon_social: document.getElementById('provRazonSocial').value.trim().toUpperCase(),
    direccion: document.getElementById('provDireccion').value.trim(),
    telefono: document.getElementById('provTelefono').value.trim(),
    email: document.getElementById('provEmail').value.trim().toLowerCase(),
    contacto: document.getElementById('provContacto').value.trim(),
    porcentaje_retencion_iva: parseFloat(document.getElementById('provRetIva').value) || 100,
    es_contribuyente_especial: isContrib,
    es_contruyente_especial: isContrib,
    cuenta_contable: document.getElementById('provCuentaContable').value.trim()
  };

  if (!payload.rif || !payload.razon_social) {
    alert('Ingrese RIF y Razón Social del proveedor.');
    return;
  }

  let error = null;
  if (editId) {
    const res = await supabaseClient.from('proveedores').update(payload).eq('id', editId);
    error = res.error;
  } else {
    const res = await supabaseClient.from('proveedores').insert([payload]);
    error = res.error;
  }

  if (error) { alert('Error al guardar proveedor: ' + error.message); return; }
  alert(editId ? '¡Proveedor actualizado con éxito!' : '¡Proveedor guardado con éxito!');
  limpiarFormProveedor();
  cargarProveedoresGestion();
}

async function eliminarProveedor(id) {
  if (!confirm('¿Estás seguro de eliminar este proveedor?')) return;
  const { error } = await supabaseClient.from('proveedores').delete().eq('id', id);
  if (error) { alert('Error al eliminar proveedor: ' + error.message); return; }
  alert('¡Proveedor eliminado!');
  cargarProveedoresGestion();
}

async function exportarProveedoresExcel() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const { data } = await supabaseClient.from('proveedores').select('*').or(`tenant_id.eq.${tenantId},tenants_id.eq.${tenantId}`);
  if (!data || data.length === 0) { alert('Sin proveedores para exportar.'); return; }

  const excelData = data.map(p => ({
    RIF: p.rif,
    'Razón Social': p.razon_social,
    Dirección: p.direccion || '',
    Teléfono: p.telefono || '',
    Correo: p.email || '',
    Contacto: p.contacto || '',
    '% Retención IVA': p.porcentaje_retencion_iva || 100,
    'Contribuyente Especial': (p.es_contribuyente_especial ?? p.es_contruyente_especial) ? 'SÍ' : 'NO',
    'Cuenta Contable': p.cuenta_contable || ''
  }));

  descargarExcelMatriz([Object.keys(excelData[0]), ...excelData.map(Object.values)], 'Directorio_Proveedores', 'Proveedores');
}

// ==========================================
// 4. GESTIÓN DE UNIDADES DE MEDIDA
// ==========================================

async function cargarUnidadesMedidaGestion() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const { data, error } = await supabaseClient
    .from('unidades_medida')
    .select('*')
    .or(`tenant_id.eq.${tenantId},tenants_id.eq.${tenantId}`)
    .order('created_at', { ascending: false });

  if (error) { console.error('Error al cargar unidades:', error.message); return; }
  unidadesGestionCache = data || [];

  const tbody = document.getElementById('tablaUnidadesGestion');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (unidadesGestionCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="p-4 text-center text-slate-500">Sin unidades personalizadas. Se usan las estándar (UND, KG, LTS).</td></tr>`;
    return;
  }

  unidadesGestionCache.forEach(u => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/60">
        <td class="p-3 font-mono font-bold text-emerald-400">${u.nombre}</td>
        <td class="p-3 text-slate-400">${formatearFecha8Digitos(u.created_at)}</td>
        <td class="p-3 text-center space-x-2">
          <button onclick='editarUnidadMedida("${u.id}", "${u.nombre}")' class="text-sky-400 hover:underline font-semibold">Editar</button>
          <button onclick='eliminarUnidadMedida("${u.id}", "${u.nombre}")' class="text-rose-400 hover:underline font-semibold">Eliminar</button>
        </td>
      </tr>
    `;
  });
}

function editarUnidadMedida(id, nombre) {
  document.getElementById('editUnidadId').value = id;
  document.getElementById('inputNuevaUnidad').value = nombre || '';
  const btnCancel = document.getElementById('btnCancelarUnidad');
  if (btnCancel) btnCancel.classList.remove('hidden');
}

function limpiarFormUnidadMedida() {
  document.getElementById('editUnidadId').value = '';
  document.getElementById('inputNuevaUnidad').value = '';
  const btnCancel = document.getElementById('btnCancelarUnidad');
  if (btnCancel) btnCancel.classList.add('hidden');
}

async function guardarUnidadMedida() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const editId = document.getElementById('editUnidadId').value;
  const nombre = document.getElementById('inputNuevaUnidad').value.trim().toUpperCase();

  if (!nombre) { alert('Ingrese el nombre o abreviatura de la unidad.'); return; }

  let error = null;
  if (editId) {
    const res = await supabaseClient.from('unidades_medida').update({ nombre }).eq('id', editId);
    error = res.error;
  } else {
    const res = await supabaseClient.from('unidades_medida').insert([{ tenant_id: tenantId, tenants_id: tenantId, nombre }]);
    error = res.error;
  }

  if (error) { alert('Error al guardar unidad: ' + error.message); return; }
  alert('¡Unidad de medida guardada con éxito!');
  limpiarFormUnidadMedida();
  cargarUnidadesMedidaGestion();
}

async function eliminarUnidadMedida(id, nombre) {
  if (!confirm(`¿Eliminar la unidad de medida "${nombre}"?`)) return;
  const { error } = await supabaseClient.from('unidades_medida').delete().eq('id', id);
  if (error) { alert('Error al eliminar unidad: ' + error.message); return; }
  alert('¡Unidad eliminada!');
  cargarUnidadesMedidaGestion();
}

async function exportarUnidadesExcel() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const { data } = await supabaseClient.from('unidades_medida').select('*').or(`tenant_id.eq.${tenantId},tenants_id.eq.${tenantId}`);
  if (!data || data.length === 0) { alert('Sin unidades registradas.'); return; }

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
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const { data, error } = await supabaseClient
    .from('inventario_lotes')
    .select('*, productos(descripcion, codigo_sku)')
    .or(`tenant_id.eq.${tenantId},tenants_id.eq.${tenantId}`)
    .order('created_at', { ascending: false });

  if (error) { console.error('Error al cargar lotes:', error.message); return; }
  lotesGestionCache = data || [];

  const tbody = document.getElementById('tablaLotesGestion');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (lotesGestionCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-500">No hay lotes registrados.</td></tr>`;
    return;
  }

  lotesGestionCache.forEach(l => {
    const prodNombre = l.productos?.descripcion || 'N/A';
    const prodSku = l.productos?.codigo_sku || 'S/N';
    const st = l.stock ?? l.sotk ?? 0;
    const fVenc = l.fecha_vencimiento || l['fecha-vencimiento'] || 'N/A';
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/60">
        <td class="p-3 font-mono text-emerald-400 font-bold">${l.numero_lote}</td>
        <td class="p-3 text-white font-medium">${prodSku} - ${prodNombre}</td>
        <td class="p-3 font-mono text-slate-300">${l.ubicacion || 'N/A'}</td>
        <td class="p-3 font-mono text-center font-bold text-amber-300">${st}</td>
        <td class="p-3 font-mono text-slate-400">${fVenc}</td>
        <td class="p-3 text-center space-x-2">
          <button onclick='editarLote("${l.id}", ${JSON.stringify(l).replace(/"/g, '&quot;')})' class="text-sky-400 hover:underline font-semibold">Editar</button>
          <button onclick='eliminarLote("${l.id}")' class="text-rose-400 hover:underline font-semibold">Eliminar</button>
        </td>
      </tr>
    `;
  });
}

function editarLote(id, l) {
  if (!l) return;
  document.getElementById('editLoteId').value = id;
  document.getElementById('loteProductoSelect').value = l.producto_id || '';
  document.getElementById('loteAlmacenSelect').value = l.almacen_id || l.almcen_id || '';
  document.getElementById('loteNumero').value = l.numero_lote || '';
  document.getElementById('loteStock').value = l.stock ?? l.sotk ?? 0;
  document.getElementById('loteUbicacion').value = l.ubicacion || '';
  document.getElementById('loteFechaVencimiento').value = l.fecha_vencimiento || l['fecha-vencimiento'] || '';
  
  const btnCancel = document.getElementById('btnCancelarLote');
  if (btnCancel) btnCancel.classList.remove('hidden');
}

function limpiarFormLote() {
  document.getElementById('editLoteId').value = '';
  document.getElementById('loteNumero').value = '';
  document.getElementById('loteStock').value = '0';
  document.getElementById('loteUbicacion').value = '';
  document.getElementById('loteFechaVencimiento').value = '';
  const btnCancel = document.getElementById('btnCancelarLote');
  if (btnCancel) btnCancel.classList.add('hidden');
}

async function guardarLote() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const editId = document.getElementById('editLoteId').value;
  const stVal = parseFloat(document.getElementById('loteStock').value) || 0;
  const fVencVal = document.getElementById('loteFechaVencimiento').value || null;
  const almId = document.getElementById('loteAlmacenSelect')?.value || null;

  const payload = {
    tenant_id: tenantId,
    tenants_id: tenantId,
    producto_id: document.getElementById('loteProductoSelect').value,
    almacen_id: almId,
    almcen_id: almId,
    numero_lote: document.getElementById('loteNumero').value.trim().toUpperCase(),
    stock: stVal,
    sotk: stVal,
    ubicacion: document.getElementById('loteUbicacion').value.trim().toUpperCase(),
    fecha_vencimiento: fVencVal,
    'fecha-vencimiento': fVencVal,
    updated_at: new Date().toISOString(),
    update_at: new Date().toISOString()
  };

  if (!payload.producto_id || !payload.numero_lote) {
    alert('Seleccione un producto e ingrese el número de lote.');
    return;
  }

  let error = null;
  if (editId) {
    const res = await supabaseClient.from('inventario_lotes').update(payload).eq('id', editId);
    error = res.error;
  } else {
    const res = await supabaseClient.from('inventario_lotes').insert([payload]);
    error = res.error;
  }

  if (error) { alert('Error al guardar lote: ' + error.message); return; }
  alert('¡Lote guardado con éxito!');
  limpiarFormLote();
  cargarLotesGestion();
}

async function eliminarLote(id) {
  if (!confirm('¿Eliminar este registro de lote?')) return;
  const { error } = await supabaseClient.from('inventario_lotes').delete().eq('id', id);
  if (error) { alert('Error al eliminar lote: ' + error.message); return; }
  alert('¡Lote eliminado!');
  cargarLotesGestion();
}

async function exportarLotesExcel() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const { data } = await supabaseClient.from('inventario_lotes').select('*, productos(descripcion, codigo_sku)').or(`tenant_id.eq.${tenantId},tenants_id.eq.${tenantId}`);
  if (!data || data.length === 0) { alert('Sin lotes para exportar.'); return; }

  const excelData = data.map(l => ({
    Lote: l.numero_lote,
    SKU: l.productos?.codigo_sku || 'N/A',
    Producto: l.productos?.descripcion || 'N/A',
    Ubicación: l.ubicacion || '',
    Stock: l.stock ?? l.sotk ?? 0,
    'Fecha Vencimiento': l.fecha_vencimiento || l['fecha-vencimiento'] || 'N/A'
  }));

  descargarExcelMatriz([Object.keys(excelData[0]), ...excelData.map(Object.values)], 'Control_Lotes', 'Lotes');
}

// ==========================================
// 6. GESTIÓN DE SUCURSALES
// ==========================================

async function cargarSucursalesGestion() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const { data, error } = await supabaseClient
    .from('sucursales')
    .select('*')
    .or(`tenant_id.eq.${tenantId},tenants_id.eq.${tenantId}`)
    .order('created_at', { ascending: false });

  if (error) { console.error('Error al cargar sucursales:', error.message); return; }
  sucursalesGestionCache = data || [];

  const tbody = document.getElementById('tablaSucursalesGestion');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (sucursalesGestionCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-500">Sin sucursales registradas.</td></tr>`;
    return;
  }

  sucursalesGestionCache.forEach(s => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/60">
        <td class="p-3 font-bold text-emerald-400">${s.nombre}</td>
        <td class="p-3 text-slate-300">${s.direccion || 'N/A'}</td>
        <td class="p-3 font-mono text-slate-400">${formatearFecha8Digitos(s.created_at || s.create_at)}</td>
        <td class="p-3 text-center space-x-2">
          <button onclick='editarSucursal("${s.id}", "${s.nombre}", "${s.direccion || ''}")' class="text-sky-400 hover:underline font-semibold">Editar</button>
          <button onclick='eliminarSucursal("${s.id}")' class="text-rose-400 hover:underline font-semibold">Eliminar</button>
        </td>
      </tr>
    `;
  });
}

function editarSucursal(id, nombre, direccion) {
  document.getElementById('editSucursalId').value = id;
  document.getElementById('sucursalNombre').value = nombre || '';
  document.getElementById('sucursalDireccion').value = direccion || '';
  const btnCancel = document.getElementById('btnCancelarSucursal');
  if (btnCancel) btnCancel.classList.remove('hidden');
}

function limpiarFormSucursal() {
  document.getElementById('editSucursalId').value = '';
  document.getElementById('sucursalNombre').value = '';
  document.getElementById('sucursalDireccion').value = '';
  const btnCancel = document.getElementById('btnCancelarSucursal');
  if (btnCancel) btnCancel.classList.add('hidden');
}

async function guardarSucursal() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const editId = document.getElementById('editSucursalId').value;
  const payload = {
    tenant_id: tenantId,
    tenants_id: tenantId,
    nombre: document.getElementById('sucursalNombre').value.trim().toUpperCase(),
    direccion: document.getElementById('sucursalDireccion').value.trim()
  };

  if (!payload.nombre) { alert('Ingrese el nombre de la sucursal.'); return; }

  let error = null;
  if (editId) {
    const res = await supabaseClient.from('sucursales').update(payload).eq('id', editId);
    error = res.error;
  } else {
    const res = await supabaseClient.from('sucursales').insert([payload]);
    error = res.error;
  }

  if (error) { alert('Error al guardar sucursal: ' + error.message); return; }
  alert('¡Sucursal guardada con éxito!');
  limpiarFormSucursal();
  cargarSucursalesGestion();
}

async function eliminarSucursal(id) {
  if (!confirm('¿Eliminar esta sucursal?')) return;
  const { error } = await supabaseClient.from('sucursales').delete().eq('id', id);
  if (error) { alert('Error al eliminar sucursal: ' + error.message); return; }
  alert('¡Sucursal eliminada!');
  cargarSucursalesGestion();
}

async function exportarSucursalesExcel() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const { data } = await supabaseClient.from('sucursales').select('*').or(`tenant_id.eq.${tenantId},tenants_id.eq.${tenantId}`);
  if (!data || data.length === 0) { alert('Sin sucursales para exportar.'); return; }

  const excelData = data.map(s => ({
    Sucursal: s.nombre,
    Dirección: s.direccion || '',
    'Fecha Registro': formatearFecha8Digitos(s.created_at || s.create_at)
  }));

  descargarExcelMatriz([Object.keys(excelData[0]), ...excelData.map(Object.values)], 'Directorio_Sucursales', 'Sucursales');
}

// ==========================================
// 7. GESTIÓN DE ALMACENES (NUEVO)
// ==========================================

async function cargarAlmacenesGestion() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const { data, error } = await supabaseClient
    .from('almacenes')
    .select('*, sucursales(nombre)')
    .or(`tenant_id.eq.${tenantId},tenants_id.eq.${tenantId}`)
    .order('created_at', { ascending: false });

  if (error) { console.error('Error al cargar almacenes:', error.message); return; }
  almacenesGestionCache = data || [];

  const tbody = document.getElementById('tablaAlmacenesGestion');
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
        <td class="p-3 font-bold text-white">${a.nombre}</td>
        <td class="p-3 font-mono text-emerald-400 font-bold">${a.tipo || 'PRINCIPAL'}</td>
        <td class="p-3 text-slate-300">${sucursalNom}</td>
        <td class="p-3 font-mono text-slate-400">${formatearFecha8Digitos(a.created_at || a.create_at)}</td>
        <td class="p-3 text-center space-x-2">
          <button onclick='editarAlmacen("${a.id}", ${JSON.stringify(a).replace(/"/g, '&quot;')})' class="text-sky-400 hover:underline font-semibold">Editar</button>
          <button onclick='eliminarAlmacen("${a.id}")' class="text-rose-400 hover:underline font-semibold">Eliminar</button>
        </td>
      </tr>
    `;
  });
}

function editarAlmacen(id, a) {
  if (!a) return;
  document.getElementById('editAlmacenId').value = id;
  document.getElementById('almacenNombre').value = a.nombre || '';
  document.getElementById('almacenTipo').value = a.tipo || 'PRINCIPAL';
  document.getElementById('almacenSucursalSelect').value = a.sucursal_id || '';

  const btnCancel = document.getElementById('btnCancelarAlmacen');
  if (btnCancel) btnCancel.classList.remove('hidden');
}

function limpiarFormAlmacen() {
  document.getElementById('editAlmacenId').value = '';
  document.getElementById('almacenNombre').value = '';
  document.getElementById('almacenTipo').value = 'PRINCIPAL';
  const btnCancel = document.getElementById('btnCancelarAlmacen');
  if (btnCancel) btnCancel.classList.add('hidden');
}

async function guardarAlmacen() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const editId = document.getElementById('editAlmacenId').value;
  const payload = {
    tenant_id: tenantId,
    tenants_id: tenantId,
    sucursal_id: document.getElementById('almacenSucursalSelect')?.value || null,
    nombre: document.getElementById('almacenNombre').value.trim().toUpperCase(),
    tipo: document.getElementById('almacenTipo').value.trim().toUpperCase() || 'PRINCIPAL'
  };

  if (!payload.nombre) { alert('Ingrese el nombre del almacén.'); return; }

  let error = null;
  if (editId) {
    const res = await supabaseClient.from('almacenes').update(payload).eq('id', editId);
    error = res.error;
  } else {
    const res = await supabaseClient.from('almacenes').insert([payload]);
    error = res.error;
  }

  if (error) { alert('Error al guardar almacén: ' + error.message); return; }
  alert('¡Almacén guardado con éxito!');
  limpiarFormAlmacen();
  cargarAlmacenesGestion();
}

async function eliminarAlmacen(id) {
  if (!confirm('¿Eliminar este almacén/depósito?')) return;
  const { error } = await supabaseClient.from('almacenes').delete().eq('id', id);
  if (error) { alert('Error al eliminar almacén: ' + error.message); return; }
  alert('¡Almacén eliminado!');
  cargarAlmacenesGestion();
}

async function exportarAlmacenesExcel() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const { data } = await supabaseClient.from('almacenes').select('*, sucursales(nombre)').or(`tenant_id.eq.${tenantId},tenants_id.eq.${tenantId}`);
  if (!data || data.length === 0) { alert('Sin almacenes para exportar.'); return; }

  const excelData = data.map(a => ({
    'Nombre Almacén': a.nombre,
    Tipo: a.tipo || 'PRINCIPAL',
    Sucursal: a.sucursales?.nombre || 'General',
    'Fecha Registro': formatearFecha8Digitos(a.created_at || a.create_at)
  }));

  descargarExcelMatriz([Object.keys(excelData[0]), ...excelData.map(Object.values)], 'Directorio_Almacenes', 'Almacenes');
}

// ==========================================
// 8. GESTIÓN DE TIPOS DE IVA (ALÍCUOTAS)
// ==========================================

async function cargarTiposIvaGestion() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const { data, error } = await supabaseClient
    .from('tipos_iva')
    .select('*')
    .or(`tenant_id.eq.${tenantId},tenants_id.eq.${tenantId}`)
    .order('porcentaje', { ascending: false });

  if (error) { console.error('Error al cargar alícuotas IVA:', error.message); return; }
  tiposIvaGestionCache = data || [];

  const tbody = document.getElementById('tablaTiposIvaGestion');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (tiposIvaGestionCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-500">Se aplican las alícuotas SENIAT estándar (16%, 8%, 0% Exento).</td></tr>`;
    return;
  }

  tiposIvaGestionCache.forEach(t => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/60">
        <td class="p-3 font-bold text-emerald-400">${t.nombre}</td>
        <td class="p-3 font-mono font-bold text-amber-300">${t.porcentaje}%</td>
        <td class="p-3 font-mono text-slate-400">${formatearFecha8Digitos(t.created_at || t.create_at)}</td>
        <td class="p-3 text-center space-x-2">
          <button onclick='editarTipoIva("${t.id}", "${t.nombre}", ${t.porcentaje})' class="text-sky-400 hover:underline font-semibold">Editar</button>
          <button onclick='eliminarTipoIva("${t.id}")' class="text-rose-400 hover:underline font-semibold">Eliminar</button>
        </td>
      </tr>
    `;
  });
}

function editarTipoIva(id, nombre, porcentaje) {
  document.getElementById('editTipoIvaId').value = id;
  document.getElementById('tipoIvaNombre').value = nombre || '';
  document.getElementById('tipoIvaPorcentaje').value = porcentaje || 16;
  const btnCancel = document.getElementById('btnCancelarTipoIva');
  if (btnCancel) btnCancel.classList.remove('hidden');
}

function limpiarFormTipoIva() {
  document.getElementById('editTipoIvaId').value = '';
  document.getElementById('tipoIvaNombre').value = '';
  document.getElementById('tipoIvaPorcentaje').value = '16';
  const btnCancel = document.getElementById('btnCancelarTipoIva');
  if (btnCancel) btnCancel.classList.add('hidden');
}

async function guardarTipoIva() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const editId = document.getElementById('editTipoIvaId').value;
  const payload = {
    tenant_id: tenantId,
    tenants_id: tenantId,
    nombre: document.getElementById('tipoIvaNombre').value.trim().toUpperCase(),
    porcentaje: parseFloat(document.getElementById('tipoIvaPorcentaje').value) || 0
  };

  if (!payload.nombre) { alert('Ingrese la descripción de la alícuota.'); return; }

  let error = null;
  if (editId) {
    const res = await supabaseClient.from('tipos_iva').update(payload).eq('id', editId);
    error = res.error;
  } else {
    const res = await supabaseClient.from('tipos_iva').insert([payload]);
    error = res.error;
  }

  if (error) { alert('Error al guardar tipo de IVA: ' + error.message); return; }
  alert('¡Alícuota configurada con éxito!');
  limpiarFormTipoIva();
  cargarTiposIvaGestion();
}

async function eliminarTipoIva(id) {
  if (!confirm('¿Eliminar esta alícuota de IVA?')) return;
  const { error } = await supabaseClient.from('tipos_iva').delete().eq('id', id);
  if (error) { alert('Error al eliminar tipo de IVA: ' + error.message); return; }
  alert('¡Alícuota eliminada!');
  cargarTiposIvaGestion();
}

async function exportarTiposIvaExcel() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const { data } = await supabaseClient.from('tipos_iva').select('*').or(`tenant_id.eq.${tenantId},tenants_id.eq.${tenantId}`);
  if (!data || data.length === 0) { alert('Sin alícuotas para exportar.'); return; }

  const excelData = data.map(t => ({
    'Descripción / Nombre': t.nombre,
    'Porcentaje (%)': t.porcentaje,
    'Fecha Registro': formatearFecha8Digitos(t.created_at || t.create_at)
  }));

  descargarExcelMatriz([Object.keys(excelData[0]), ...excelData.map(Object.values)], 'Alicuotas_IVA_SENIAT', 'TiposIVA');
}

// ==========================================
// 9. GESTIÓN DE VÍAS Y MÉTODOS DE PAGO
// ==========================================

async function cargarViasPagoGestion() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const { data, error } = await supabaseClient
    .from('vias_pago')
    .select('*')
    .or(`tenant_id.eq.${tenantId},tenants_id.eq.${tenantId}`)
    .order('created_at', { ascending: false });

  if (error) { console.error('Error al cargar vías de pago:', error.message); return; }
  viasPagoGestionCache = data || [];

  const tbody = document.getElementById('tablaViasPagoGestion');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (viasPagoGestionCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-500">Se utilizan las vías estándar de caja (Efectivo Divisas, Zelle, Pago Móvil, POS).</td></tr>`;
    return;
  }

  viasPagoGestionCache.forEach(v => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/60">
        <td class="p-3 font-bold text-white">${v.nombre}</td>
        <td class="p-3 font-mono text-emerald-400 font-bold">${v.codigo_interno || 'N/A'}</td>
        <td class="p-3 text-center"><span class="px-2 py-0.5 rounded text-[10px] ${v.requiere_referencia ? 'bg-amber-950 text-amber-300 font-bold' : 'bg-slate-800 text-slate-400'}">${v.requiere_referencia ? 'SÍ' : 'NO'}</span></td>
        <td class="p-3 font-mono text-slate-300">${v.cuenta_contable || v['cuenta contable'] || 'N/A'}</td>
        <td class="p-3 text-center"><span class="px-2 py-0.5 rounded text-[10px] ${v.activo ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'}">${v.activo ? 'ACTIVO' : 'INACTIVO'}</span></td>
        <td class="p-3 text-center space-x-2">
          <button onclick='editarViaPago("${v.id}", ${JSON.stringify(v).replace(/"/g, '&quot;')})' class="text-sky-400 hover:underline font-semibold">Editar</button>
          <button onclick='eliminarViaPago("${v.id}")' class="text-rose-400 hover:underline font-semibold">Eliminar</button>
        </td>
      </tr>
    `;
  });
}

function editarViaPago(id, v) {
  if (!v) return;
  document.getElementById('editViaPagoId').value = id;
  document.getElementById('viaPagoNombre').value = v.nombre || '';
  document.getElementById('viaPagoCodigo').value = v.codigo_interno || '';
  document.getElementById('viaPagoReqRef').value = String(v.requiere_referencia ?? true);
  document.getElementById('viaPagoActivo').value = String(v.activo ?? true);
  document.getElementById('viaPagoCuentaContable').value = v.cuenta_contable || v['cuenta contable'] || '';

  const btnCancel = document.getElementById('btnCancelarViaPago');
  if (btnCancel) btnCancel.classList.remove('hidden');
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
}

async function guardarViaPago() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const editId = document.getElementById('editViaPagoId').value;
  const ccVal = document.getElementById('viaPagoCuentaContable').value.trim();
  const payload = {
    tenant_id: tenantId,
    tenants_id: tenantId,
    nombre: document.getElementById('viaPagoNombre').value.trim().toUpperCase(),
    codigo_interno: document.getElementById('viaPagoCodigo').value.trim().toUpperCase(),
    requiere_referencia: document.getElementById('viaPagoReqRef').value === 'true',
    activo: document.getElementById('viaPagoActivo').value === 'true',
    cuenta_contable: ccVal,
    'cuenta contable': ccVal
  };

  if (!payload.nombre) { alert('Ingrese la denominación del método de pago.'); return; }

  let error = null;
  if (editId) {
    const res = await supabaseClient.from('vias_pago').update(payload).eq('id', editId);
    error = res.error;
  } else {
    const res = await supabaseClient.from('vias_pago').insert([payload]);
    error = res.error;
  }

  if (error) { alert('Error al guardar vía de pago: ' + error.message); return; }
  alert('¡Vía de pago registrada con éxito!');
  limpiarFormViaPago();
  cargarViasPagoGestion();
}

async function eliminarViaPago(id) {
  if (!confirm('¿Eliminar esta vía de pago?')) return;
  const { error } = await supabaseClient.from('vias_pago').delete().eq('id', id);
  if (error) { alert('Error al eliminar vía de pago: ' + error.message); return; }
  alert('¡Vía de pago eliminada!');
  cargarViasPagoGestion();
}

async function exportarViasPagoExcel() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const { data } = await supabaseClient.from('vias_pago').select('*').or(`tenant_id.eq.${tenantId},tenants_id.eq.${tenantId}`);
  if (!data || data.length === 0) { alert('Sin vías de pago para exportar.'); return; }

  const excelData = data.map(v => ({
    'Método de Pago': v.nombre,
    Código: v.codigo_interno || '',
    'Requiere Ref': v.requiere_referencia ? 'SÍ' : 'NO',
    Estatus: v.activo ? 'ACTIVO' : 'INACTIVO',
    'Cuenta Contable': v.cuenta_contable || v['cuenta contable'] || ''
  }));

  descargarExcelMatriz([Object.keys(excelData[0]), ...excelData.map(Object.values)], 'Metodos_Pago_POS', 'ViasPago');
}

// ==========================================
// 10. FUNCIONES AUXILIARES & EXPORTACIÓN
// ==========================================

function descargarExcelMatriz(matrizDatos, nombreArchivo, nombreHoja) {
  if (typeof XLSX === 'undefined') {
    alert('La librería SheetJS (XLSX) no está cargada.');
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
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const { data } = await supabaseClient.from('unidades_medida').select('*').or(`tenant_id.eq.${tenantId},tenants_id.eq.${tenantId}`);
  const select = document.getElementById('prodUnidadMedida');
  if (!select) return;
  select.innerHTML = '<option value="UND">UND</option><option value="KG">KG</option><option value="LTS">LTS</option><option value="MT">MT</option>';
  if (data && data.length > 0) {
    data.forEach(u => {
      select.innerHTML += `<option value="${u.nombre}">${u.nombre}</option>`;
    });
  }
}

async function cargarProveedoresSelectCompra() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const { data } = await supabaseClient.from('proveedores').select('*').or(`tenant_id.eq.${tenantId},tenants_id.eq.${tenantId}`);
  const select = document.getElementById('compraProveedorSelect');
  if (!select) return;
  select.innerHTML = '<option value="">-- Seleccionar Proveedor --</option>';
  if (data && data.length > 0) {
    data.forEach(p => {
      select.innerHTML += `<option value="${p.id}" data-retencion="${p.porcentaje_retencion_iva}">${p.razon_social} (${p.rif})</option>`;
    });
  }
}

async function cargarSucursalesSelectAlmacen() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const { data } = await supabaseClient.from('sucursales').select('*').or(`tenant_id.eq.${tenantId},tenants_id.eq.${tenantId}`);
  const select = document.getElementById('almacenSucursalSelect');
  if (!select) return;
  select.innerHTML = '<option value="">-- Sucursal Principal / General --</option>';
  if (data && data.length > 0) {
    data.forEach(s => {
      select.innerHTML += `<option value="${s.id}">${s.nombre}</option>`;
    });
  }
}

async function cargarAlmacenesSelectLote() {
  if (!tenantActual) return;
  const tenantId = tenantActual.id || tenantActual.tenants_id;
  const { data } = await supabaseClient.from('almacenes').select('*').or(`tenant_id.eq.${tenantId},tenants_id.eq.${tenantId}`);
  const select = document.getElementById('loteAlmacenSelect');
  if (!select) return;
  select.innerHTML = '<option value="">-- Almacén Principal --</option>';
  if (data && data.length > 0) {
    data.forEach(a => {
      select.innerHTML += `<option value="${a.id}">${a.nombre} (${a.tipo || 'PRINCIPAL'})</option>`;
    });
  }
}
