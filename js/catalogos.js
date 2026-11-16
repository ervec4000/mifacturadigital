/**
 * /js/catalogos.js
 * Módulo completo y definitivo de Gestión de Artículos, Clientes, Proveedores y Unidades (SENIAT 2026)
 */

let productosGestionCache = [];
let clientesGestionCache = [];
let proveedoresGestionCache = [];

// ==========================================
// 1. GESTIÓN DE ARTÍCULOS / PRODUCTOS
// ==========================================
async function cargarProductosGestion() {
  if (!tenantActual) return;
  const { data, error } = await supabaseClient.from('productos').select('*').eq('tenant_id', tenantActual.id);
  if (error) { console.error('Error al cargar artículos:', error); return; }
  productosGestionCache = data || [];
  
  const tbody = document.getElementById('tablaProductosGestion');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  if (productosGestionCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-500">No hay artículos registrados.</td></tr>`;
    return;
  }

  productosGestionCache.forEach(prod => {
    const pv = prod.precio_venta_usd || prod.precio_unitario_usd || 0;
    const esExento = prod.es_exento ? 'Exento' : 'Gravado 16%';
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/40">
        <td class="p-3 font-mono text-emerald-400 font-bold">${esc(prod.codigo_sku || 'S/N')}</td>
        <td class="p-3 text-white font-semibold">${esc(prod.descripcion)}</td>
        <td class="p-3 font-mono text-slate-300">${prod.stock || 0}</td>
        <td class="p-3 font-mono text-emerald-300 font-bold">$ ${pv.toFixed(2)}</td>
        <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] ${prod.es_exento?'bg-sky-950 text-sky-300':'bg-emerald-950 text-emerald-300'}">${esExento}</span></td>
        <td class="p-3 text-center">
          <button onclick="eliminarProducto('${prod.id}')" class="text-rose-400 hover:underline text-xs font-semibold">Eliminar</button>
        </td>
      </tr>
    `;
  });
}

async function guardarProducto() {
  if (!tenantActual) return;
  const sku = document.getElementById('prodSku')?.value.trim();
  const descripcion = document.getElementById('prodDescripcion')?.value.trim().toUpperCase();
  const precioVenta = parseFloat(document.getElementById('prodPrecioVenta')?.value) || 0;
  const stock = parseFloat(document.getElementById('prodStock')?.value) || 0;
  const esExento = document.getElementById('prodEsExento')?.value === 'true';

  if (!descripcion || precioVenta <= 0) {
    alert('⚠️ Por favor, ingrese al menos la descripción y un precio de venta válido.');
    return;
  }

  const payload = {
    tenant_id: tenantActual.id,
    codigo_sku: sku || ('SKU-' + Math.floor(Math.random() * 90000 + 10000)),
    descripcion: descripcion,
    precio_venta_usd: precioVenta,
    stock: stock,
    es_exento: esExento,
    maneja_inventario: true
  };

  const { error } = await supabaseClient.from('productos').insert([payload]);
  if (error) {
    alert('❌ Error al guardar el artículo: ' + error.message);
    return;
  }

  alert('¡Artículo guardado con éxito en Supabase!');
  if (document.getElementById('prodSku')) document.getElementById('prodSku').value = '';
  if (document.getElementById('prodDescripcion')) document.getElementById('prodDescripcion').value = '';
  if (document.getElementById('prodPrecioVenta')) document.getElementById('prodPrecioVenta').value = '';
  if (document.getElementById('prodStock')) document.getElementById('prodStock').value = '';
  cargarProductosGestion();
}

async function eliminarProducto(id) {
  if (!confirm('¿Estás seguro de eliminar este artículo del inventario?')) return;
  const { error } = await supabaseClient.from('productos').delete().eq('id', id);
  if (error) { alert('Error al eliminar: ' + error.message); return; }
  cargarProductosGestion();
}

// ==========================================
// 2. GESTIÓN DE CLIENTES
// ==========================================
async function cargarClientesGestion() {
  if (!tenantActual) return;
  const { data, error } = await supabaseClient.from('clientes').select('*').eq('tenant_id', tenantActual.id);
  if (error) { console.error('Error al cargar clientes:', error); return; }
  clientesGestionCache = data || [];

  const tbody = document.getElementById('tablaClientes');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (clientesGestionCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-500">Sin clientes registrados.</td></tr>`;
    return;
  }

  clientesGestionCache.forEach(c => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/40">
        <td class="p-3 font-mono text-emerald-400 font-bold">${esc(c.rif)}</td>
        <td class="p-3 text-white font-semibold">${esc(c.nombre || c.razon_social)}</td>
        <td class="p-3 font-mono text-slate-300">${esc(c.telefono || 'N/A')}</td>
        <td class="p-3 text-slate-300">${esc(c.direccion || 'N/A')}</td>
        <td class="p-3 text-center">
          <button onclick="eliminarCliente('${c.id}')" class="text-rose-400 hover:underline text-xs font-semibold">Eliminar</button>
        </td>
      </tr>
    `;
  });
}

async function guardarCliente() {
  if (!tenantActual) return;
  const rif = document.getElementById('clienteRifInput')?.value.trim();
  const nombre = document.getElementById('clienteNombreInput')?.value.trim().toUpperCase();
  const telefono = document.getElementById('clienteTelefonoInput')?.value.trim();
  const direccion = document.getElementById('clienteDireccionInput')?.value.trim();

  if (!rif || !nombre) {
    alert('⚠️ Ingrese RIF y Nombre / Razón Social del cliente.');
    return;
  }
  if (!validarRifVzla(rif)) {
    alert('⚠️ Formato de RIF/Cédula inválido.');
    return;
  }

  const payload = {
    tenant_id: tenantActual.id,
    rif: rif,
    nombre: nombre,
    razon_social: nombre,
    telefono: telefono,
    direccion: direccion
  };

  const { error } = await supabaseClient.from('clientes').insert([payload]);
  if (error) { alert('Error al registrar cliente: ' + error.message); return; }

  alert('¡Cliente registrado con éxito!');
  if (document.getElementById('clienteRifInput')) document.getElementById('clienteRifInput').value = '';
  if (document.getElementById('clienteNombreInput')) document.getElementById('clienteNombreInput').value = '';
  if (document.getElementById('clienteTelefonoInput')) document.getElementById('clienteTelefonoInput').value = '';
  if (document.getElementById('clienteDireccionInput')) document.getElementById('clienteDireccionInput').value = '';
  cargarClientesGestion();
}

async function eliminarCliente(id) {
  if (!confirm('¿Estás seguro de eliminar este cliente?')) return;
  const { error } = await supabaseClient.from('clientes').delete().eq('id', id);
  if (error) { alert('Error al eliminar: ' + error.message); return; }
  cargarClientesGestion();
}

// ==========================================
// 3. GESTIÓN DE PROVEEDORES
// ==========================================
async function cargarProveedoresGestion() {
  if (!tenantActual) return;
  const { data, error } = await supabaseClient.from('proveedores').select('*').eq('tenant_id', tenantActual.id);
  if (error) { console.error('Error al cargar proveedores:', error); return; }
  proveedoresGestionCache = data || [];

  const tbody = document.getElementById('tablaProveedores');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (proveedoresGestionCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-500">Sin proveedores registrados.</td></tr>`;
    return;
  }

  proveedoresGestionCache.forEach(p => {
    const esEsp = p.es_contribuyente_especial ?? true;
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/40">
        <td class="p-3 font-mono text-emerald-400 font-bold">${esc(p.rif)}</td>
        <td class="p-3 text-white font-semibold">${esc(p.razon_social)}</td>
        <td class="p-3 font-mono text-slate-300">${esc(p.telefono || 'N/A')}</td>
        <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] ${esEsp?'bg-emerald-950 text-emerald-300':'bg-slate-800 text-slate-300'}">${esEsp?'SÍ':'NO'}</span></td>
        <td class="p-3 text-center">
          <button onclick='editarProveedor("${p.id}", ${JSON.stringify(p).replace(/"/g, '&quot;')})' class="text-sky-400 hover:underline text-xs mr-3 font-semibold">Editar</button>
          <button onclick="eliminarProveedor('${p.id}')" class="text-rose-400 hover:underline text-xs font-semibold">Eliminar</button>
        </td>
      </tr>
    `;
  });
}

function editarProveedor(id, prov) {
  const editIdEl = document.getElementById('editProveedorId');
  if (editIdEl) editIdEl.value = id;
  if (document.getElementById('provRif')) document.getElementById('provRif').value = prov.rif || '';
  if (document.getElementById('provTelefono')) document.getElementById('provTelefono').value = prov.telefono || '';
  if (document.getElementById('provContribuyenteEspecial')) document.getElementById('provContribuyenteEspecial').value = String(prov.es_contribuyente_especial ?? true);
  if (document.getElementById('provRazonSocial')) document.getElementById('provRazonSocial').value = prov.razon_social || '';
  if (document.getElementById('provDireccion')) document.getElementById('provDireccion').value = prov.direccion || '';
  
  const titulo = document.getElementById('tituloFormProveedor');
  if (titulo) titulo.innerText = '✏️ Editar Proveedor';
  const btnCanc = document.getElementById('btnCancelarProv');
  if (btnCanc) btnCanc.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function limpiarFormProveedor() {
  const editIdEl = document.getElementById('editProveedorId');
  if (editIdEl) editIdEl.value = '';
  if (document.getElementById('provRif')) document.getElementById('provRif').value = '';
  if (document.getElementById('provTelefono')) document.getElementById('provTelefono').value = '';
  if (document.getElementById('provContribuyenteEspecial')) document.getElementById('provContribuyenteEspecial').value = 'true';
  if (document.getElementById('provRazonSocial')) document.getElementById('provRazonSocial').value = '';
  if (document.getElementById('provDireccion')) document.getElementById('provDireccion').value = '';
  
  const titulo = document.getElementById('tituloFormProveedor');
  if (titulo) titulo.innerText = '🏭 Maestro de Proveedores';
  const btnCanc = document.getElementById('btnCancelarProv');
  if (btnCanc) btnCanc.classList.add('hidden');
}

async function guardarProveedor() {
  if (!tenantActual) return;
  const editId = document.getElementById('editProveedorId')?.value;
  const rifVal = document.getElementById('provRif')?.value.trim();
  if (rifVal && !validarRifVzla(rifVal)) { alert('Formato de RIF inválido.'); return; }

  const payload = {
    rif: rifVal,
    telefono: document.getElementById('provTelefono')?.value.trim(),
    es_contribuyente_especial: document.getElementById('provContribuyenteEspecial')?.value === 'true',
    razon_social: document.getElementById('provRazonSocial')?.value.trim().toUpperCase(),
    direccion: document.getElementById('provDireccion')?.value.trim(),
    tenant_id: tenantActual.id
  };

  if (!payload.rif || !payload.razon_social) {
    alert('⚠️ Ingrese RIF y Razón Social del proveedor.');
    return;
  }

  if (editId) {
    const { error } = await supabaseClient.from('proveedores').update(payload).eq('id', editId);
    if (error) { alert('Error al actualizar: ' + error.message); return; }
    alert('¡Proveedor actualizado con éxito!');
  } else {
    const { error } = await supabaseClient.from('proveedores').insert([payload]);
    if (error) { alert('Error al registrar: ' + error.message); return; }
    alert('¡Proveedor guardado con éxito en Supabase!');
  }
  limpiarFormProveedor();
  cargarProveedoresGestion();
}

async function eliminarProveedor(id) {
  if (!confirm('¿Estás seguro de eliminar este proveedor?')) return;
  const { error } = await supabaseClient.from('proveedores').delete().eq('id', id);
  if (error) { alert('Error al eliminar: ' + error.message); return; }
  cargarProveedoresGestion();
}

// ==========================================
// 4. UNIDADES DE MEDIDA Y EXPORTACIONES
// ==========================================
async function cargarUnidadesMedidaGestion() {
  const tbody = document.getElementById('tablaUnidadesMedida');
  if (!tbody) return;
  tbody.innerHTML = `
    <tr class="hover:bg-slate-900 border-b border-slate-800/40"><td class="p-3 font-mono text-emerald-400 font-bold">UND</td><td class="p-3 text-white">Unidad / Pieza</td></tr>
    <tr class="hover:bg-slate-900 border-b border-slate-800/40"><td class="p-3 font-mono text-emerald-400 font-bold">KG</td><td class="p-3 text-white">Kilogramos</td></tr>
    <tr class="hover:bg-slate-900 border-b border-slate-800/40"><td class="p-3 font-mono text-emerald-400 font-bold">LTS</td><td class="p-3 text-white">Litros</td></tr>
    <tr class="hover:bg-slate-900 border-b border-slate-800/40"><td class="p-3 font-mono text-emerald-400 font-bold">MT</td><td class="p-3 text-white">Metros</td></tr>
  `;
}

function cargarUnidadesSelectForm() {}

function cargarDatosReferidos() {
  if (!tenantActual) return;
  const linkInput = document.getElementById('linkReferidoInput');
  if (linkInput) linkInput.value = `https://mifacturadigital.com.ve/register?ref=${tenantActual.id}`;
}

async function cargarInquilinosMaster() {
  if (!tenantActual || (tenantActual.rol !== 'master' && tenantActual.email !== 'ervec2000@gmail.com')) return;
  const { data } = await supabaseClient.from('tenants').select('*');
  const tbody = document.getElementById('tablaInquilinosMaster');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!data || data.length === 0) { tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-500">Sin inquilinos.</td></tr>`; return; }
  data.forEach(t => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/40">
        <td class="p-3 text-white font-bold">${esc(t.razon_social||'S/N')}</td>
        <td class="p-3 font-mono text-slate-300">${esc(t.email)}</td>
        <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] bg-emerald-950 text-emerald-300">${esc(t.plan_activo||'Freemium')}</span></td>
        <td class="p-3 uppercase font-mono text-amber-400">${esc(t.rol||'tenant')}</td>
      </tr>
    `;
  });
}
