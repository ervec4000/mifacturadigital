/**
 * /js/catalogos.js
 * Módulo completo de Gestión de Artículos, Clientes, Proveedores y Unidades (SENIAT 2026)
 */

async function cargarProductosGestion() {
  if (!tenantActual) return;
  const { data, error } = await supabaseClient.from('productos').select('*').eq('tenant_id', tenantActual.id);
  const tbody = document.getElementById('tablaProductosGestion');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  if (error || !data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-500">No hay artículos registrados.</td></tr>`;
    return;
  }

  data.forEach(prod => {
    const pv = prod.precio_venta_usd || prod.precio_unitario_usd || 0;
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/40">
        <td class="p-3 font-mono text-emerald-400 font-bold">${esc(prod.codigo_sku || 'S/N')}</td>
        <td class="p-3 text-white">${esc(prod.descripcion)}</td>
        <td class="p-3 font-mono text-slate-300">${prod.stock || 0}</td>
        <td class="p-3 font-mono text-emerald-300 font-bold">$ ${pv.toFixed(2)}</td>
        <td class="p-3 text-center">
          <button onclick="eliminarProducto('${prod.id}')" class="text-rose-400 hover:underline text-xs">Eliminar</button>
        </td>
      </tr>
    `;
  });
}

async function guardarProducto() {
  const sku = document.getElementById('prodSku').value.trim();
  const descripcion = document.getElementById('prodDescripcion').value.trim().toUpperCase();
  const precioVenta = parseFloat(document.getElementById('prodPrecioVenta').value) || 0;
  const stock = parseFloat(document.getElementById('prodStock').value) || 0;

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
    es_exento: false,
    maneja_inventario: true
  };

  const { error } = await supabaseClient.from('productos').insert([payload]);
  if (error) {
    alert('❌ Error al guardar el artículo: ' + error.message);
    return;
  }

  alert('¡Artículo guardado con éxito!');
  document.getElementById('prodSku').value = '';
  document.getElementById('prodDescripcion').value = '';
  document.getElementById('prodPrecioVenta').value = '';
  document.getElementById('prodStock').value = '';
  cargarProductosGestion();
}

async function eliminarProducto(id) {
  if (!confirm('¿Estás seguro de eliminar este artículo?')) return;
  await supabaseClient.from('productos').delete().eq('id', id);
  cargarProductosGestion();
}

async function cargarClientesGestion() {
  if (!tenantActual) return;
  const { data, error } = await supabaseClient.from('clientes').select('*').eq('tenant_id', tenantActual.id);
  const tbody = document.getElementById('tablaClientes');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (error || !data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-500">Sin clientes registrados.</td></tr>`;
    return;
  }

  data.forEach(c => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/40">
        <td class="p-3 font-mono text-emerald-400">${esc(c.rif)}</td>
        <td class="p-3 text-white">${esc(c.nombre)}</td>
        <td class="p-3 font-mono text-slate-300">${esc(c.telefono || 'N/A')}</td>
        <td class="p-3 text-center"><button onclick="eliminarCliente('${c.id}')" class="text-rose-400 hover:underline text-xs">Eliminar</button></td>
      </tr>
    `;
  });
}

async function eliminarCliente(id) {
  if (!confirm('¿Eliminar cliente?')) return;
  await supabaseClient.from('clientes').delete().eq('id', id);
  cargarClientesGestion();
}

async function cargarProveedoresGestion() {
  if (!tenantActual) return;
  const { data, error } = await supabaseClient.from('proveedores').select('*').eq('tenant_id', tenantActual.id);
  const tbody = document.getElementById('tablaProveedores');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (error || !data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-500">Sin proveedores registrados.</td></tr>`;
    return;
  }

  data.forEach(p => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-900 border-b border-slate-800/40">
        <td class="p-3 font-mono text-emerald-400">${esc(p.rif)}</td>
        <td class="p-3 text-white">${esc(p.razon_social)}</td>
        <td class="p-3 font-mono text-slate-300">${esc(p.telefono || 'N/A')}</td>
        <td class="p-3 text-center">
          <button onclick='editarProveedor("${p.id}", ${JSON.stringify(p)})' class="text-emerald-400 hover:underline text-xs mr-2">Editar</button>
          <button onclick="eliminarProveedor('${p.id}')" class="text-rose-400 hover:underline text-xs">Eliminar</button>
        </td>
      </tr>
    `;
  });
}

function editarProveedor(id, prov) {
  const idEl = document.getElementById('editProveedorId');
  if (idEl) idEl.value = id;
  document.getElementById('provRif').value = prov.rif || '';
  document.getElementById('provTelefono').value = prov.telefono || '';
  document.getElementById('provContribuyenteEspecial').value = String(prov.es_contribuyente_especial ?? true);
  document.getElementById('provRazonSocial').value = prov.razon_social || '';
  document.getElementById('provDireccion').value = prov.direccion || '';
  const titulo = document.getElementById('tituloFormProveedor');
  if (titulo) titulo.innerText = '✏️ Editar Proveedor';
  const btnCanc = document.getElementById('btnCancelarProv');
  if (btnCanc) btnCanc.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function limpiarFormProveedor() {
  const idEl = document.getElementById('editProveedorId');
  if (idEl) idEl.value = '';
  document.getElementById('provRif').value = '';
  document.getElementById('provTelefono').value = '';
  document.getElementById('provContribuyenteEspecial').value = 'true';
  document.getElementById('provRazonSocial').value = '';
  document.getElementById('provDireccion').value = '';
  const titulo = document.getElementById('tituloFormProveedor');
  if (titulo) titulo.innerText = '🏭 Maestro de Proveedores';
  const btnCanc = document.getElementById('btnCancelarProv');
  if (btnCanc) btnCanc.classList.add('hidden');
}

async function guardarProveedor() {
  const editId = document.getElementById('editProveedorId')?.value;
  const rifVal = document.getElementById('provRif').value.trim();
  if (rifVal && !validarRifVzla(rifVal)) { alert('Formato de RIF inválido.'); return; }

  const payload = {
    rif: rifVal,
    telefono: document.getElementById('provTelefono').value.trim(),
    es_contribuyente_especial: document.getElementById('provContribuyenteEspecial').value === 'true',
    razon_social: document.getElementById('provRazonSocial').value.trim().toUpperCase(),
    direccion: document.getElementById('provDireccion').value.trim(),
    tenant_id: tenantActual.id
  };

  if (!payload.rif || !payload.razon_social) {
    alert('Ingrese RIF y Razón Social del proveedor.');
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
  await supabaseClient.from('proveedores').delete().eq('id', id);
  cargarProveedoresGestion();
}

async function cargarUnidadesMedidaGestion() {
  const tbody = document.getElementById('tablaUnidadesMedida');
  if (!tbody) return;
  tbody.innerHTML = `
    <tr class="hover:bg-slate-900 border-b border-slate-800/40"><td class="p-3 font-mono text-emerald-400">UND</td><td class="p-3">Unidad / Pieza</td></tr>
    <tr class="hover:bg-slate-900 border-b border-slate-800/40"><td class="p-3 font-mono text-emerald-400">KG</td><td class="p-3">Kilogramos</td></tr>
    <tr class="hover:bg-slate-900 border-b border-slate-800/40"><td class="p-3 font-mono text-emerald-400">LTS</td><td class="p-3">Litros</td></tr>
    <tr class="hover:bg-slate-900 border-b border-slate-800/40"><td class="p-3 font-mono text-emerald-400">MT</td><td class="p-3">Metros</td></tr>
  `;
}

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
