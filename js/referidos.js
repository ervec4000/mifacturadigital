/**
 * /js/referidos.js
 * Sistema Híbrido de Referidos hasta 3 Niveles (Clientes + Promotores Externos)
 * - Atribución persistente ?ref=CODIGO o ?ref=TENANT_ID (30 días)
 * - Registro público desde Landing/Login para Comercios y Promotores/Contadores
 * - Reglas, porcentajes, Tiers y bonos 100% editables por el usuario Master
 * - Liquidación automática al aprobar pagos, billetera USD, canje y retiros
 */

const CONFIG_REFERIDOS_MASTER_DEFECTO = {
  activo: true,
  // Bono Primer Pago del referido nuevo
  primerPagoN1Pct: 40,
  primerPagoN2Pct: 15,
  primerPagoN3Pct: 5,
  modoAnual: 'RECURRENTE', // 'RECURRENTE' (recomendado) o 'PRIMER_PAGO'
  // Comisión Recurrente mensual (Mes 2+)
  recurrenteN1Pct: 15,
  recurrenteN2Pct: 7,
  recurrenteN3Pct: 3,
  // Escalador por metas (Tiers para Nivel 1 recurrente)
  tier2MinActivos: 10,
  tier2N1Pct: 20,
  tier3MinActivos: 25,
  tier3N1Pct: 25,
  // Incentivos y reglas operativas
  descuentoBienvenidaPct: 15,
  minimoRetiroUsd: 20,
  metaReferidosMesGratis: 3,
  bonoMetaUsd: 19,
  requerirActivoParaN2N3: true
};

let saasConfigReferidosCache = { ...CONFIG_REFERIDOS_MASTER_DEFECTO };
let saasComisionesCache = [];
let saasRetirosCache = [];
let saasLeadsLandingCache = [];

function avisarRef(msg, tipo = 'info', duracion = 5500) {
  if (typeof notificarSistema === 'function') notificarSistema(msg, tipo, duracion);
  else console.log(`[REF:${tipo}]`, msg);
}

function esPromotorExterno(tenant = tenantActual) {
  if (!tenant) return false;
  return String(tenant.rol || '').toLowerCase() === 'promotor' || tenant.es_promotor_externo === true;
}

function obtenerCodigoReferidoTenant(t) {
  if (!t) return 'MFD-VE';
  if (t.codigo_referido) return String(t.codigo_referido).trim().toUpperCase();
  const base = String(t.rif || t.id || 'VE2026').replace(/[^A-Z0-9]/gi, '').slice(0, 8).toUpperCase();
  const prefijo = esPromotorExterno(t) ? 'PRM' : 'MFD';
  return `${prefijo}-${base}`;
}

function leerAtribucionReferidoLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem('mfd_ref_atribucion') || 'null');
    if (!raw || !raw.codigo) return null;
    const dias = (Date.now() - Number(raw.capturedAt || 0)) / (1000 * 60 * 60 * 24);
    if (dias > 30) {
      localStorage.removeItem('mfd_ref_atribucion');
      return null;
    }
    return raw;
  } catch (e) {
    return null;
  }
}

function capturarReferidoDeUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const refParam = (params.get('ref') || params.get('r') || '').trim();
    if (refParam) {
      const payload = {
        codigo: refParam,
        capturedAt: Date.now()
      };
      localStorage.setItem('mfd_ref_atribucion', JSON.stringify(payload));
    }
  } catch (e) {}
  actualizarBannersReferidoPublicos();
}

function actualizarBannersReferidoPublicos() {
  const atrib = leerAtribucionReferidoLocal();
  const dto = Number(saasConfigReferidosCache.descuentoBienvenidaPct || 0);
  const bannerLanding = document.getElementById('landingBannerReferido');
  const txtLanding = document.getElementById('landingBannerReferidoTexto');
  if (bannerLanding && txtLanding) {
    if (atrib?.codigo && saasConfigReferidosCache.activo) {
      txtLanding.textContent = dto > 0
        ? `Invitado con código ${atrib.codigo} · Recibe ${dto}% de descuento en tu primera suscripción Pyme o Enterprise.`
        : `Invitado con código ${atrib.codigo} · Tu asesor/referidor quedará vinculado automáticamente.`;
      bannerLanding.classList.remove('hidden');
    } else {
      bannerLanding.classList.add('hidden');
    }
  }

  const inputCod = document.getElementById('regCodigoReferidor');
  if (inputCod && atrib?.codigo && !inputCod.value) {
    inputCod.value = atrib.codigo;
  }
  const bannerModal = document.getElementById('regBannerInvitado');
  const txtModal = document.getElementById('regBannerInvitadoTexto');
  if (bannerModal && txtModal) {
    if (atrib?.codigo && saasConfigReferidosCache.activo) {
      txtModal.textContent = dto > 0
        ? `Código de invitación detectado (${atrib.codigo}): obtendrás ${dto}% de descuento en tu primer pago de plan.`
        : `Código de invitación detectado (${atrib.codigo}).`;
      bannerModal.classList.remove('hidden');
    } else {
      bannerModal.classList.add('hidden');
    }
  }
}

// ==========================================
// 1. CONFIGURACIÓN HÍBRIDA EDITABLE (MASTER)
// ==========================================

function sanitizarConfigReferidos(raw) {
  const d = CONFIG_REFERIDOS_MASTER_DEFECTO;
  if (!raw || typeof raw !== 'object') return { ...d };
  const num = (v, fb, max = 100) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= 0 && n <= max ? Number(n.toFixed(2)) : fb;
  };
  return {
    activo: raw.activo !== false,
    primerPagoN1Pct: num(raw.primerPagoN1Pct, d.primerPagoN1Pct, 100),
    primerPagoN2Pct: num(raw.primerPagoN2Pct, d.primerPagoN2Pct, 100),
    primerPagoN3Pct: num(raw.primerPagoN3Pct, d.primerPagoN3Pct, 100),
    modoAnual: raw.modoAnual === 'PRIMER_PAGO' ? 'PRIMER_PAGO' : 'RECURRENTE',
    recurrenteN1Pct: num(raw.recurrenteN1Pct, d.recurrenteN1Pct, 100),
    recurrenteN2Pct: num(raw.recurrenteN2Pct, d.recurrenteN2Pct, 100),
    recurrenteN3Pct: num(raw.recurrenteN3Pct, d.recurrenteN3Pct, 100),
    tier2MinActivos: Math.max(1, Math.round(num(raw.tier2MinActivos, d.tier2MinActivos, 10000))),
    tier2N1Pct: num(raw.tier2N1Pct, d.tier2N1Pct, 100),
    tier3MinActivos: Math.max(2, Math.round(num(raw.tier3MinActivos, d.tier3MinActivos, 10000))),
    tier3N1Pct: num(raw.tier3N1Pct, d.tier3N1Pct, 100),
    descuentoBienvenidaPct: num(raw.descuentoBienvenidaPct, d.descuentoBienvenidaPct, 90),
    minimoRetiroUsd: num(raw.minimoRetiroUsd, d.minimoRetiroUsd, 10000),
    metaReferidosMesGratis: Math.max(1, Math.round(num(raw.metaReferidosMesGratis, d.metaReferidosMesGratis, 1000))),
    bonoMetaUsd: num(raw.bonoMetaUsd, d.bonoMetaUsd, 5000),
    requerirActivoParaN2N3: raw.requerirActivoParaN2N3 !== false
  };
}

async function cargarConfigReferidosMaster() {
  let cfg = null;
  try {
    const local = JSON.parse(localStorage.getItem('saas_config_referidos_master') || 'null');
    if (local && typeof local === 'object') cfg = local;
  } catch (e) {}

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('saas_config_pagos')
        .select('valor_json')
        .eq('clave', 'programa_referidos')
        .maybeSingle();
      if (!error && data?.valor_json) cfg = data.valor_json;
    } catch (e) {}

    if (!cfg) {
      try {
        const { data, error } = await supabaseClient
          .from('audit_logs')
          .select('detalle')
          .eq('accion', 'SAAS_CONFIG_REFERIDOS')
          .order('created_at', { ascending: false })
          .limit(1);
        if (!error && data && data[0]?.detalle) cfg = JSON.parse(data[0].detalle);
      } catch (e) {}
    }
  }

  saasConfigReferidosCache = sanitizarConfigReferidos(cfg);
  try {
    localStorage.setItem('saas_config_referidos_master', JSON.stringify(saasConfigReferidosCache));
  } catch (e) {}
  actualizarBannersReferidoPublicos();
  return saasConfigReferidosCache;
}

async function guardarConfigReferidosMaster() {
  if (typeof esUsuarioMaster === 'function' && !esUsuarioMaster()) {
    avisarRef('Solo el usuario Master puede editar las reglas de referidos.', 'error');
    return;
  }

  const getVal = id => document.getElementById(id)?.value;
  const getChk = id => Boolean(document.getElementById(id)?.checked);

  const nuevaCfg = sanitizarConfigReferidos({
    activo: getChk('masterRefActivo'),
    primerPagoN1Pct: getVal('masterRefP1N1'),
    primerPagoN2Pct: getVal('masterRefP1N2'),
    primerPagoN3Pct: getVal('masterRefP1N3'),
    modoAnual: getVal('masterRefModoAnual'),
    recurrenteN1Pct: getVal('masterRefRecN1'),
    recurrenteN2Pct: getVal('masterRefRecN2'),
    recurrenteN3Pct: getVal('masterRefRecN3'),
    tier2MinActivos: getVal('masterRefTier2Min'),
    tier2N1Pct: getVal('masterRefTier2Pct'),
    tier3MinActivos: getVal('masterRefTier3Min'),
    tier3N1Pct: getVal('masterRefTier3Pct'),
    descuentoBienvenidaPct: getVal('masterRefDescuentoBienv'),
    minimoRetiroUsd: getVal('masterRefMinRetiro'),
    metaReferidosMesGratis: getVal('masterRefMetaClientes'),
    bonoMetaUsd: getVal('masterRefBonoMetaUsd'),
    requerirActivoParaN2N3: getChk('masterRefReqActivoN2N3')
  });

  const sumaRec = nuevaCfg.recurrenteN1Pct + nuevaCfg.recurrenteN2Pct + nuevaCfg.recurrenteN3Pct;
  const sumaP1 = nuevaCfg.primerPagoN1Pct + nuevaCfg.primerPagoN2Pct + nuevaCfg.primerPagoN3Pct;
  if (sumaP1 > 100 || sumaRec > 100) {
    avisarRef('La suma de Nivel 1 + Nivel 2 + Nivel 3 no puede superar el 100%.', 'warning');
    return;
  }

  saasConfigReferidosCache = nuevaCfg;
  localStorage.setItem('saas_config_referidos_master', JSON.stringify(nuevaCfg));

  let guardadoNativo = false;
  if (supabaseClient) {
    try {
      const { error } = await supabaseClient
        .from('saas_config_pagos')
        .upsert([{ clave: 'programa_referidos', valor_json: nuevaCfg, updated_at: new Date().toISOString() }], { onConflict: 'clave' });
      if (!error) guardadoNativo = true;
    } catch (e) {}

    if (!guardadoNativo && tenantActual?.id) {
      try {
        await supabaseClient.from('audit_logs').insert([{
          tenant_id: tenantActual.id,
          accion: 'SAAS_CONFIG_REFERIDOS',
          detalle: JSON.stringify(nuevaCfg)
        }]);
      } catch (e) {}
    }
  }

  recalcularMargenReferidosMasterUI();
  avisarRef(`Reglas de referidos actualizadas · Mes 1: ${sumaP1.toFixed(1)}% total · Recurrente: ${sumaRec.toFixed(1)}% total.`, 'success', 6500);
}

function pintarConfigReferidosEnMasterUI() {
  const c = saasConfigReferidosCache;
  const setVal = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
  const setChk = (id, v) => { const e = document.getElementById(id); if (e) e.checked = Boolean(v); };

  setChk('masterRefActivo', c.activo);
  setVal('masterRefP1N1', c.primerPagoN1Pct);
  setVal('masterRefP1N2', c.primerPagoN2Pct);
  setVal('masterRefP1N3', c.primerPagoN3Pct);
  setVal('masterRefModoAnual', c.modoAnual);
  setVal('masterRefRecN1', c.recurrenteN1Pct);
  setVal('masterRefRecN2', c.recurrenteN2Pct);
  setVal('masterRefRecN3', c.recurrenteN3Pct);
  setVal('masterRefTier2Min', c.tier2MinActivos);
  setVal('masterRefTier2Pct', c.tier2N1Pct);
  setVal('masterRefTier3Min', c.tier3MinActivos);
  setVal('masterRefTier3Pct', c.tier3N1Pct);
  setVal('masterRefDescuentoBienv', c.descuentoBienvenidaPct);
  setVal('masterRefMinRetiro', c.minimoRetiroUsd);
  setVal('masterRefMetaClientes', c.metaReferidosMesGratis);
  setVal('masterRefBonoMetaUsd', c.bonoMetaUsd);
  setChk('masterRefReqActivoN2N3', c.requerirActivoParaN2N3);

  recalcularMargenReferidosMasterUI();
}

function recalcularMargenReferidosMasterUI() {
  const el = document.getElementById('masterRefMargenResumen');
  if (!el) return;
  const leer = id => {
    const n = parseFloat(document.getElementById(id)?.value || '0');
    return Number.isFinite(n) ? n : 0;
  };
  const p1 = leer('masterRefP1N1') + leer('masterRefP1N2') + leer('masterRefP1N3');
  const rec = leer('masterRefRecN1') + leer('masterRefRecN2') + leer('masterRefRecN3');
  const margenP1 = Math.max(0, 100 - p1);
  const margenRec = Math.max(0, 100 - rec);
  const alerta = p1 > 90 || rec > 40;
  el.className = `text-xs font-mono tabular-nums ${alerta ? 'text-amber-300' : 'text-emerald-400'}`;
  el.textContent = `Reparto 1er Pago: ${p1.toFixed(1)}% (Margen SaaS: ${margenP1.toFixed(1)}%) · Reparto Recurrente: ${rec.toFixed(1)}% (Margen SaaS: ${margenRec.toFixed(1)}%)`;
}

// ==========================================
// 2. RESOLUCIÓN DE CADENA 3 NIVELES Y REGISTRO PÚBLICO
// ==========================================

async function cargarTenantsParaReferidos(forceRefresh = false) {
  if (!forceRefresh && Array.isArray(saasTenantsCache) && saasTenantsCache.length > 0) {
    return saasTenantsCache;
  }
  if (!supabaseClient) return Array.isArray(saasTenantsCache) ? saasTenantsCache : [];
  const cols = typeof TENANT_SAFE_COLS !== 'undefined'
    ? TENANT_SAFE_COLS
    : 'id,razon_social,rif,email,telefono,direccion,rol,plan_activo,activo,created_at';
  try {
    const [resTen] = await Promise.all([
      supabaseClient.from('tenants').select(cols).order('created_at', { ascending: false }).limit(500),
      typeof sincronizarMetaSaasNube === 'function' ? sincronizarMetaSaasNube(null) : Promise.resolve({})
    ]);
    let data = resTen?.data;
    if (resTen?.error && typeof esErrorColumnaOTablaFaltante === 'function' && esErrorColumnaOTablaFaltante(resTen.error)) {
      const fallback = await supabaseClient
        .from('tenants')
        .select('id,razon_social,rif,email,telefono,direccion,rol,plan_activo,activo,created_at')
        .order('created_at', { ascending: false })
        .limit(500);
      data = fallback.data;
    }
    const lista = (data || []).map(t => {
      const safe = typeof sanitizarTenantSeguro === 'function' ? sanitizarTenantSeguro(t) : t;
      return typeof fusionarTenantConMetaSaas === 'function' ? fusionarTenantConMetaSaas(safe) : safe;
    });
    saasTenantsCache = lista;
    return lista;
  } catch (e) {
    return Array.isArray(saasTenantsCache) ? saasTenantsCache : [];
  }
}

async function resolverReferidorPorCodigoOId(codigoOId) {
  const limpio = String(codigoOId || '').trim();
  if (!limpio) return null;

  if (supabaseClient) {
    try {
      const { data: rpcRef, error: rpcErr } = await supabaseClient.rpc('resolver_referidor_publico', { p_codigo_o_id: limpio });
      if (!rpcErr && rpcRef && rpcRef.encontrado && rpcRef.nivel1?.id) {
        return {
          nivel1: rpcRef.nivel1,
          nivel2Id: rpcRef.nivel2_id || null,
          nivel3Id: rpcRef.nivel3_id || null
        };
      }
    } catch (e) {}
  }

  const lista = await cargarTenantsParaReferidos();
  const upper = limpio.toUpperCase();

  const encontrado = lista.find(t =>
    String(t.id) === limpio ||
    String(t.codigo_referido || '').toUpperCase() === upper ||
    obtenerCodigoReferidoTenant(t).toUpperCase() === upper
  );

  if (!encontrado) return null;
  const enriquecido = typeof fusionarTenantConMetaSaas === 'function' ? fusionarTenantConMetaSaas(encontrado) : encontrado;
  return {
    nivel1: enriquecido,
    nivel2Id: enriquecido.referido_por_id || null,
    nivel3Id: enriquecido.referido_nivel2_id || null
  };
}

function abrirModalRegistroLanding(modo = 'COMERCIO') {
  const modal = document.getElementById('modalRegistroSaasPublico');
  if (!modal) return;
  cambiarTipoRegistroPublico(modo);
  actualizarBannersReferidoPublicos();
  modal.classList.remove('hidden');
}

function cerrarModalRegistroLanding() {
  document.getElementById('modalRegistroSaasPublico')?.classList.add('hidden');
}

function cambiarTipoRegistroPublico(modo = 'COMERCIO') {
  const esProm = modo === 'PROMOTOR';
  const inputTipo = document.getElementById('regTipoCuenta');
  if (inputTipo) inputTipo.value = esProm ? 'PROMOTOR' : 'COMERCIO';

  const btnC = document.getElementById('btnRegTabComercio');
  const btnP = document.getElementById('btnRegTabPromotor');
  if (btnC && btnP) {
    if (esProm) {
      btnP.className = 'flex-1 py-2 px-3 rounded-lg text-xs font-semibold bg-emerald-600 text-white cursor-pointer';
      btnC.className = 'flex-1 py-2 px-3 rounded-lg text-xs font-semibold bg-slate-950 text-slate-300 hover:text-white cursor-pointer';
    } else {
      btnC.className = 'flex-1 py-2 px-3 rounded-lg text-xs font-semibold bg-emerald-600 text-white cursor-pointer';
      btnP.className = 'flex-1 py-2 px-3 rounded-lg text-xs font-semibold bg-slate-950 text-slate-300 hover:text-white cursor-pointer';
    }
  }

  const lblNom = document.getElementById('regRazonSocialLabel');
  const inpNom = document.getElementById('regRazonSocial');
  const lblRif = document.getElementById('regRifLabel');
  const inpRif = document.getElementById('regRif');
  const bloqueCobro = document.getElementById('regBloqueCobroPromotor');
  const sub = document.getElementById('regSubtituloModal');
  const btnSub = document.getElementById('btnSubmitRegistroPublico');

  if (lblNom) lblNom.textContent = esProm ? 'Nombre Completo o Firma Contable *' : 'Razón Social del Comercio *';
  if (inpNom) inpNom.placeholder = esProm ? 'Ej. Lic. María Pérez / Asesores Contables' : 'Ej. Inversiones El Sol C.A.';
  if (lblRif) lblRif.textContent = esProm ? 'Cédula o RIF *' : 'RIF del Comercio *';
  if (inpRif) inpRif.placeholder = esProm ? 'Ej. V-18456789' : 'Ej. J-12345678-0';
  if (bloqueCobro) {
    if (esProm) bloqueCobro.classList.remove('hidden');
    else bloqueCobro.classList.add('hidden');
  }
  if (sub) {
    sub.textContent = esProm
      ? 'Regístrate gratis como Promotor o Contador Aliado sin tener comercio. Obtén tu enlace ?ref= y cobra comisiones hasta 3 niveles.'
      : 'Crea tu cuenta comercial en la nube (Plan Freemium inicial) y comienza a facturar hoy mismo.';
  }
  if (btnSub) {
    btnSub.textContent = esProm ? 'Crear Cuenta de Promotor y Obtener Enlace' : 'Crear Cuenta Comercial Gratis';
  }
}

async function registrarCuentaDesdeLanding(e) {
  if (e) e.preventDefault();
  if (!supabaseClient) {
    avisarRef('Conexión a base de datos no inicializada todavía. Intenta en unos segundos.', 'warning');
    return;
  }

  const tipo = document.getElementById('regTipoCuenta')?.value === 'PROMOTOR' ? 'PROMOTOR' : 'COMERCIO';
  const esPromotor = tipo === 'PROMOTOR';
  const razon_social = (document.getElementById('regRazonSocial')?.value || '').trim();
  const rif = (document.getElementById('regRif')?.value || '').trim().toUpperCase();
  const telefono = (document.getElementById('regTelefono')?.value || '').trim();
  const email = (document.getElementById('regEmail')?.value || '').trim().toLowerCase();
  const password = (document.getElementById('regPassword')?.value || '').trim();
  const codigoInvitacion = (document.getElementById('regCodigoReferidor')?.value || '').trim();
  const metodoCobro = document.getElementById('regMetodoCobro')?.value || 'PAGO MOVIL';
  const datoCobro = (document.getElementById('regDatoCobro')?.value || '').trim();

  if (!razon_social || !rif || !email || password.length < 6) {
    avisarRef('Completa Nombre/Razón Social, Cédula/RIF, Correo y Contraseña (mín. 6 caracteres).', 'warning');
    return;
  }
  if (typeof validarRifVzla === 'function' && !validarRifVzla(rif)) {
    avisarRef('Formato de Cédula/RIF inválido. Usa formato venezolano (ej. V-12345678 o J-12345678-0).', 'warning');
    return;
  }

  const btn = document.getElementById('btnSubmitRegistroPublico');
  const txtOrig = btn?.textContent || '';
  if (btn) { btn.disabled = true; btn.textContent = 'Creando cuenta...'; }

  try {
    // 1. Resolver cadena de hasta 3 niveles antes de crear la cuenta
    const atribCodigo = codigoInvitacion || leerAtribucionReferidoLocal()?.codigo || '';
    const cadena = atribCodigo ? await resolverReferidorPorCodigoOId(atribCodigo) : null;

    const baseCod = rif.replace(/[^A-Z0-9]/gi, '').slice(0, 8).toUpperCase();
    const sufijo = Math.random().toString(36).slice(2, 5).toUpperCase();
    const codigoPropio = `${esPromotor ? 'PRM' : 'MFD'}-${baseCod}-${sufijo}`;

    const datosCobro = esPromotor && datoCobro ? { metodo: metodoCobro, destino: datoCobro } : {};
    const modulosIniciales = esPromotor
      ? ['referidos']
      : (typeof obtenerPresetModulosPorPlan === 'function' ? obtenerPresetModulosPorPlan('Freemium') : ['pos', 'historial', 'productos', 'clientes', 'usuarios', 'referidos', 'suscripcion']);

    const metaSaas = {
      ciclo_facturacion: 'MENSUAL',
      estado_suscripcion: 'ACTIVA',
      modulos_permitidos: modulosIniciales,
      codigo_referido: codigoPropio,
      referido_por_id: cadena?.nivel1?.id || null,
      referido_nivel2_id: cadena?.nivel2Id || null,
      referido_nivel3_id: cadena?.nivel3Id || null,
      es_promotor_externo: esPromotor,
      datos_cobro_comision: datosCobro
    };

    // 2. Intentar crear sesión JWT real en Supabase Auth
    let authUserId = null;
    try {
      const { data: signUpData } = await supabaseClient.auth.signUp({ email, password });
      authUserId = signUpData?.user?.id || null;
    } catch (e) {}

    let nuevoTenant = null;

    // 3. Ruta segura principal v100 via RPC SECURITY DEFINER (crea tenant + credencial bcrypt aislada)
    try {
      const { data: rpcRes, error: rpcErr } = await supabaseClient.rpc('crear_tenant_publico_seguro', {
        p_razon_social: razon_social,
        p_rif: rif,
        p_telefono: telefono,
        p_direccion: esPromotor ? 'PROMOTOR ALIADO EXTERNO' : 'VENEZUELA',
        p_email: email,
        p_password: password,
        p_rol: esPromotor ? 'promotor' : 'tenant',
        p_plan_activo: esPromotor ? 'Promotor' : 'Freemium',
        p_modulos_permitidos: modulosIniciales,
        p_codigo_referido: codigoPropio,
        p_referido_por_id: metaSaas.referido_por_id,
        p_referido_nivel2_id: metaSaas.referido_nivel2_id,
        p_referido_nivel3_id: metaSaas.referido_nivel3_id,
        p_es_promotor_externo: esPromotor,
        p_datos_cobro_comision: datosCobro,
        p_auth_user_id: authUserId
      });

      if (!rpcErr && rpcRes) {
        if (!rpcRes.ok) {
          avisarRef(rpcRes.error || 'Ya existe una cuenta registrada con ese correo electrónico.', 'warning');
          return;
        }
        nuevoTenant = {
          id: rpcRes.tenant_id,
          auth_user_id: authUserId,
          razon_social,
          rif,
          telefono,
          direccion: esPromotor ? 'PROMOTOR ALIADO EXTERNO' : 'VENEZUELA',
          email,
          rol: esPromotor ? 'promotor' : 'tenant',
          plan_activo: esPromotor ? 'Promotor' : 'Freemium',
          activo: true,
          ...metaSaas
        };
      }
    } catch (e) {}

    // 4. Fallback pre-SQL si aún no ejecutan migracion_seguridad_usuarios_v100.sql
    if (!nuevoTenant) {
      const { data: existe } = await supabaseClient.from('tenants').select('id').eq('email', email).maybeSingle();
      if (existe?.id) {
        avisarRef('Ya existe una cuenta registrada con ese correo electrónico. Inicia sesión con tus credenciales.', 'warning');
        return;
      }

      const payloadBase = {
        razon_social,
        rif,
        telefono,
        direccion: esPromotor ? 'PROMOTOR ALIADO EXTERNO' : 'VENEZUELA',
        email,
        rol: esPromotor ? 'promotor' : 'tenant',
        plan_activo: esPromotor ? 'Promotor' : 'Freemium',
        activo: true
      };

      const colsRet = typeof TENANT_SAFE_COLS !== 'undefined'
        ? TENANT_SAFE_COLS
        : 'id,razon_social,rif,email,telefono,direccion,rol,plan_activo,activo,created_at';
      let res = await supabaseClient.from('tenants').insert([{ ...payloadBase, ...metaSaas }]).select(colsRet);
      if (res.error && typeof esErrorColumnaOTablaFaltante === 'function' && esErrorColumnaOTablaFaltante(res.error)) {
        res = await supabaseClient.from('tenants').insert([payloadBase]).select('id,razon_social,rif,email,telefono,direccion,rol,plan_activo,activo,created_at');
      }

      if (res.error || !res.data?.[0]) {
        avisarRef(`No se pudo completar el registro: ${res.error?.message || 'Error en base de datos'}`, 'error', 7000);
        return;
      }
      nuevoTenant = res.data[0];

      if (typeof generarHashSha256Salted === 'function') {
        const hash = await generarHashSha256Salted(password);
        const credLocal = JSON.parse(localStorage.getItem('mfd_credenciales_fallback') || '{}');
        credLocal[email] = { id: nuevoTenant.id, tenant_id: nuevoTenant.id, hash };
        localStorage.setItem('mfd_credenciales_fallback', JSON.stringify(credLocal));
      }
    }

    if (typeof guardarMetaYEstadoTenantEnNube === 'function') {
      await guardarMetaYEstadoTenantEnNube(nuevoTenant.id, {}, metaSaas);
    }

    const safeTenant = typeof sanitizarTenantSeguro === 'function'
      ? sanitizarTenantSeguro({ ...nuevoTenant, ...metaSaas })
      : { ...nuevoTenant, ...metaSaas };
    tenantActual = typeof fusionarTenantConMetaSaas === 'function'
      ? fusionarTenantConMetaSaas(safeTenant)
      : safeTenant;

    if (typeof usuarioActual !== 'undefined') {
      usuarioActual = {
        id: tenantActual.id,
        tenant_id: tenantActual.id,
        nombre_completo: tenantActual.razon_social,
        email: tenantActual.email,
        rol_interno: 'PROPIETARIO',
        sucursal_id: null,
        modulos_permitidos: modulosIniciales,
        es_propietario: true
      };
      localStorage.setItem('mfd_usuario_actual', JSON.stringify(usuarioActual));
    }
    localStorage.setItem('tenant_actual', JSON.stringify(tenantActual));

    cerrarModalRegistroLanding();
    document.getElementById('formRegistroPublicoSaas')?.reset();

    if (typeof registrarEntradaSesion === 'function') {
      await registrarEntradaSesion();
    }
    if (typeof activarVistaPrincipal === 'function') {
      activarVistaPrincipal();
    }

    avisarRef(
      esPromotor
        ? `¡Bienvenido ${razon_social}! Tu código de promotor es ${codigoPropio}. Ya puedes compartir tu enlace y ganar comisiones.`
        : `¡Cuenta comercial creada! Tu código de afiliado es ${codigoPropio}.`,
      'success',
      7500
    );
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = txtOrig; }
  }
}

async function registrarLeadLandingConAtribucion(payload) {
  const atrib = leerAtribucionReferidoLocal();
  const cadena = atrib?.codigo ? await resolverReferidorPorCodigoOId(atrib.codigo) : null;
  const lead = {
    id: `lead-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    nombre: payload.nombre || '',
    rif: payload.rif || '',
    telefono: payload.telefono || '',
    email: payload.email || '',
    tipo_interes: payload.tipo_interes || 'COMERCIO',
    referido_por_codigo: atrib?.codigo || null,
    referido_por_id: cadena?.nivel1?.id || null,
    estado: 'NUEVO',
    created_at: new Date().toISOString()
  };

  try {
    const local = JSON.parse(localStorage.getItem('saas_leads_landing_cache') || '[]');
    local.unshift(lead);
    localStorage.setItem('saas_leads_landing_cache', JSON.stringify(local.slice(0, 200)));
  } catch (e) {}

  if (supabaseClient) {
    try {
      const { id, ...sinId } = lead;
      const { error } = await supabaseClient.from('saas_leads_landing').insert([sinId]);
      if (error) {
        const tenantRef = cadena?.nivel1?.id || (await cargarTenantsParaReferidos())[0]?.id || null;
        if (tenantRef) {
          await supabaseClient.from('audit_logs').insert([{
            tenant_id: tenantRef,
            accion: 'SAAS_LEAD_LANDING',
            detalle: JSON.stringify(lead)
          }]);
        }
      }
    } catch (e) {}
  }
  return lead;
}

// ==========================================
// 3. LIBRO MAYOR DE COMISIONES, RETIROS Y LEADS (NUBE + RESPALDO)
// ==========================================

async function cargarComisionesReferidos(soloBeneficiarioId = null) {
  const mapa = new Map();
  try {
    const local = JSON.parse(localStorage.getItem('saas_comisiones_cache') || '[]');
    if (Array.isArray(local)) local.forEach(c => { if (c?.id) mapa.set(String(c.id), c); });
  } catch (e) {}

  if (supabaseClient) {
    try {
      let q = supabaseClient.from('saas_comisiones_referidos').select('*').order('created_at', { ascending: false }).limit(500);
      if (soloBeneficiarioId) q = q.eq('beneficiario_id', soloBeneficiarioId);
      const { data, error } = await q;
      if (!error && Array.isArray(data)) {
        data.forEach(c => mapa.set(String(c.id), c));
      }
    } catch (e) {}

    try {
      let q2 = supabaseClient.from('audit_logs').select('tenant_id, detalle, created_at').eq('accion', 'SAAS_COMISION_REF').order('created_at', { ascending: true }).limit(500);
      if (soloBeneficiarioId) q2 = q2.eq('tenant_id', soloBeneficiarioId);
      const { data: logs, error: errLog } = await q2;
      if (!errLog && Array.isArray(logs)) {
        logs.forEach(l => {
          try {
            const c = JSON.parse(l.detalle || '{}');
            if (c?.id) mapa.set(String(c.id), { ...(mapa.get(String(c.id)) || {}), ...c });
          } catch (e) {}
        });
      }
    } catch (e) {}
  }

  let lista = Array.from(mapa.values());
  if (soloBeneficiarioId) {
    lista = lista.filter(c => String(c.beneficiario_id) === String(soloBeneficiarioId));
  }
  lista.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  saasComisionesCache = lista;
  return lista;
}

async function registrarComisionReferidoNube(com) {
  const oldId = String(com.id || '');
  if (supabaseClient) {
    try {
      const { id, ...sinId } = com;
      const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(oldId);
      const res = esUuid
        ? await supabaseClient.from('saas_comisiones_referidos').upsert([com], { onConflict: 'id' }).select()
        : await supabaseClient.from('saas_comisiones_referidos').insert([sinId]).select();
      if (!res.error && res.data?.[0]) {
        com.id = res.data[0].id;
        if (res.data[0].created_at) com.created_at = res.data[0].created_at;
      }
    } catch (e) {}

    try {
      await supabaseClient.from('audit_logs').insert([{
        tenant_id: com.beneficiario_id,
        accion: 'SAAS_COMISION_REF',
        detalle: JSON.stringify(com)
      }]);
    } catch (e) {}
  }

  try {
    const local = JSON.parse(localStorage.getItem('saas_comisiones_cache') || '[]')
      .filter(x => String(x?.id) !== oldId && String(x?.id) !== String(com.id));
    local.unshift(com);
    localStorage.setItem('saas_comisiones_cache', JSON.stringify(local.slice(0, 500)));
  } catch (e) {}

  return com;
}

async function cargarRetirosReferidos(soloBeneficiarioId = null) {
  const mapa = new Map();
  try {
    const local = JSON.parse(localStorage.getItem('saas_retiros_cache') || '[]');
    if (Array.isArray(local)) local.forEach(r => { if (r?.id) mapa.set(String(r.id), r); });
  } catch (e) {}

  if (supabaseClient) {
    try {
      let q = supabaseClient.from('saas_retiros_referidos').select('*').order('created_at', { ascending: false }).limit(500);
      if (soloBeneficiarioId) q = q.eq('beneficiario_id', soloBeneficiarioId);
      const { data, error } = await q;
      if (!error && Array.isArray(data)) data.forEach(r => mapa.set(String(r.id), r));
    } catch (e) {}

    try {
      let q2 = supabaseClient.from('audit_logs').select('tenant_id, detalle, created_at').eq('accion', 'SAAS_RETIRO_REF').order('created_at', { ascending: true }).limit(500);
      if (soloBeneficiarioId) q2 = q2.eq('tenant_id', soloBeneficiarioId);
      const { data: logs, error: errLog } = await q2;
      if (!errLog && Array.isArray(logs)) {
        logs.forEach(l => {
          try {
            const r = JSON.parse(l.detalle || '{}');
            if (r?.id) mapa.set(String(r.id), { ...(mapa.get(String(r.id)) || {}), ...r });
          } catch (e) {}
        });
      }
    } catch (e) {}
  }

  let lista = Array.from(mapa.values());
  if (soloBeneficiarioId) lista = lista.filter(r => String(r.beneficiario_id) === String(soloBeneficiarioId));
  lista.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  saasRetirosCache = lista;
  return lista;
}

async function registrarRetiroReferidoNube(retiroObj) {
  const oldId = String(retiroObj.id || '');
  if (supabaseClient) {
    try {
      const { id, ...sinId } = retiroObj;
      const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(oldId);
      const res = esUuid
        ? await supabaseClient.from('saas_retiros_referidos').upsert([retiroObj], { onConflict: 'id' }).select()
        : await supabaseClient.from('saas_retiros_referidos').insert([sinId]).select();
      if (!res.error && res.data?.[0]) {
        retiroObj.id = res.data[0].id;
        if (res.data[0].created_at) retiroObj.created_at = res.data[0].created_at;
      }
    } catch (e) {}

    try {
      await supabaseClient.from('audit_logs').insert([{
        tenant_id: retiroObj.beneficiario_id,
        accion: 'SAAS_RETIRO_REF',
        detalle: JSON.stringify(retiroObj)
      }]);
    } catch (e) {}
  }

  try {
    const local = JSON.parse(localStorage.getItem('saas_retiros_cache') || '[]')
      .filter(x => String(x?.id) !== oldId && String(x?.id) !== String(retiroObj.id));
    local.unshift(retiroObj);
    localStorage.setItem('saas_retiros_cache', JSON.stringify(local.slice(0, 500)));
  } catch (e) {}

  return retiroObj;
}

async function cargarLeadsLandingMaster() {
  const mapa = new Map();
  try {
    const local = JSON.parse(localStorage.getItem('saas_leads_landing_cache') || '[]');
    if (Array.isArray(local)) local.forEach(l => { if (l?.id) mapa.set(String(l.id), l); });
  } catch (e) {}

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.from('saas_leads_landing').select('*').order('created_at', { ascending: false }).limit(200);
      if (!error && Array.isArray(data)) data.forEach(l => mapa.set(String(l.id), l));
    } catch (e) {}

    try {
      const { data: logs, error } = await supabaseClient.from('audit_logs').select('detalle').eq('accion', 'SAAS_LEAD_LANDING').order('created_at', { ascending: false }).limit(200);
      if (!error && Array.isArray(logs)) {
        logs.forEach(row => {
          try {
            const l = JSON.parse(row.detalle || '{}');
            if (l?.id) mapa.set(String(l.id), l);
          } catch (e) {}
        });
      }
    } catch (e) {}
  }

  saasLeadsLandingCache = Array.from(mapa.values()).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return saasLeadsLandingCache;
}

// ==========================================
// 4. MOTOR AUTOMÁTICO: DESCUENTO BIENVENIDA Y COMISIONES 3 NIVELES
// ==========================================

function contarPagosAprobadosTenant(tenantId) {
  if (!Array.isArray(saasPagosCache)) return 0;
  return saasPagosCache.filter(p => String(p.tenant_id) === String(tenantId) && String(p.estado || '').toUpperCase() === 'APROBADO').length;
}

function obtenerDescuentoBienvenidaParaTenant(tenant = tenantActual) {
  if (!tenant || !saasConfigReferidosCache.activo) return 0;
  const enriquecido = typeof fusionarTenantConMetaSaas === 'function' ? fusionarTenantConMetaSaas(tenant) : tenant;
  if (!enriquecido.referido_por_id) return 0;
  if (contarPagosAprobadosTenant(enriquecido.id) > 0) return 0;
  return Number(saasConfigReferidosCache.descuentoBienvenidaPct || 0);
}

function calcularTierPromotor(beneficiarioId, tenantsLista) {
  const cfg = saasConfigReferidosCache;
  const n1ActivosPagos = (tenantsLista || []).filter(t =>
    String(t.referido_por_id || '') === String(beneficiarioId) &&
    t.activo !== false &&
    !esPromotorExterno(t) &&
    (typeof normalizarNombrePlan === 'function' ? normalizarNombrePlan(t.plan_activo) : t.plan_activo) !== 'Freemium'
  ).length;

  if (n1ActivosPagos >= Number(cfg.tier3MinActivos || 25)) {
    return { nombre: 'Oro (Partner VIP)', pctN1Recurrente: Number(cfg.tier3N1Pct || cfg.recurrenteN1Pct), n1ActivosPagos, siguienteMeta: null };
  }
  if (n1ActivosPagos >= Number(cfg.tier2MinActivos || 10)) {
    return {
      nombre: 'Plata (Aliado)',
      pctN1Recurrente: Number(cfg.tier2N1Pct || cfg.recurrenteN1Pct),
      n1ActivosPagos,
      siguienteMeta: { nombre: 'Oro', faltan: Number(cfg.tier3MinActivos || 25) - n1ActivosPagos, pct: Number(cfg.tier3N1Pct) }
    };
  }
  return {
    nombre: 'Bronce (Inicial)',
    pctN1Recurrente: Number(cfg.recurrenteN1Pct || 15),
    n1ActivosPagos,
    siguienteMeta: { nombre: 'Plata', faltan: Math.max(1, Number(cfg.tier2MinActivos || 10) - n1ActivosPagos), pct: Number(cfg.tier2N1Pct) }
  };
}

function puedeCobrarN2N3(beneficiario, tenantsLista) {
  if (!beneficiario || beneficiario.activo === false) return false;
  if (!saasConfigReferidosCache.requerirActivoParaN2N3) return true;

  if (!esPromotorExterno(beneficiario)) {
    const plan = typeof normalizarNombrePlan === 'function' ? normalizarNombrePlan(beneficiario.plan_activo) : beneficiario.plan_activo;
    if (plan !== 'Freemium') return true;
  }
  // Promotor externo o Freemium califica para N2/N3 si tiene al menos 1 referido pago activo directo
  const tieneReferidoPago = (tenantsLista || []).some(t =>
    String(t.referido_por_id || '') === String(beneficiario.id) &&
    t.activo !== false &&
    !esPromotorExterno(t) &&
    (typeof normalizarNombrePlan === 'function' ? normalizarNombrePlan(t.plan_activo) : t.plan_activo) !== 'Freemium'
  );
  return tieneReferidoPago;
}

async function procesarComisionesPorPagoAprobado(pago, tenantPagador) {
  await Promise.all([cargarConfigReferidosMaster(), cargarComisionesReferidos(null), cargarTenantsParaReferidos()]);
  const cfg = saasConfigReferidosCache;
  if (!cfg.activo || !pago || !tenantPagador) return [];

  const yaProcesado = saasComisionesCache.some(c => String(c.pago_id) === String(pago.id) && c.tipo_evento !== 'RETIRO');
  if (yaProcesado) return [];

  const pagador = typeof fusionarTenantConMetaSaas === 'function' ? fusionarTenantConMetaSaas(tenantPagador) : tenantPagador;
  const montoBase = Number(pago.monto_usd || 0);
  if (montoBase <= 0 || !pagador.referido_por_id) return [];

  const pagosPreviosAprobados = saasPagosCache.filter(p =>
    String(p.tenant_id) === String(pagador.id) &&
    String(p.id) !== String(pago.id) &&
    String(p.estado || '').toUpperCase() === 'APROBADO'
  ).length;
  const esPrimerPago = pagosPreviosAprobados === 0;
  const usaTasasPrimerPago = esPrimerPago && (String(pago.ciclo || 'MENSUAL').toUpperCase() === 'MENSUAL' || cfg.modoAnual === 'PRIMER_PAGO');

  const n1 = saasTenantsCache.find(t => String(t.id) === String(pagador.referido_por_id));
  const n2Id = pagador.referido_nivel2_id || n1?.referido_por_id || null;
  const n2 = n2Id ? saasTenantsCache.find(t => String(t.id) === String(n2Id)) : null;
  const n3Id = pagador.referido_nivel3_id || n2?.referido_por_id || null;
  const n3 = n3Id ? saasTenantsCache.find(t => String(t.id) === String(n3Id)) : null;

  const creadas = [];

  // Nivel 1
  if (n1 && String(n1.id) !== String(pagador.id)) {
    const tierN1 = calcularTierPromotor(n1.id, saasTenantsCache);
    const pctN1 = usaTasasPrimerPago ? Number(cfg.primerPagoN1Pct || 0) : Number(tierN1.pctN1Recurrente || cfg.recurrenteN1Pct || 0);
    if (pctN1 > 0) {
      const montoCom = Number(((montoBase * pctN1) / 100).toFixed(2));
      const comObj = {
        id: `com-${Date.now()}-n1-${Math.random().toString(36).slice(2, 6)}`,
        pago_id: String(pago.id),
        beneficiario_id: n1.id,
        beneficiario_nombre: n1.razon_social || n1.email,
        referido_origen_id: pagador.id,
        referido_origen_nombre: pagador.razon_social || pagador.email,
        nivel: 1,
        tipo_evento: usaTasasPrimerPago ? 'PRIMER_PAGO' : 'RECURRENTE',
        porcentaje: pctN1,
        monto_base_usd: montoBase,
        monto_comision_usd: montoCom,
        estado: 'ACREDITADA',
        nota: `Plan ${pago.plan_solicitado} (${pago.ciclo}) · ${tierN1.nombre}`,
        created_at: new Date().toISOString()
      };
      await registrarComisionReferidoNube(comObj);
      creadas.push(comObj);
    }

    // Bono automático por meta de referidos activos (solo en primer pago del nuevo referido)
    if (esPrimerPago && Number(cfg.bonoMetaUsd || 0) > 0 && Number(cfg.metaReferidosMesGratis || 0) > 0) {
      const activosTrasPago = saasTenantsCache.filter(t =>
        String(t.referido_por_id || '') === String(n1.id) &&
        t.activo !== false &&
        !esPromotorExterno(t) &&
        ((String(t.id) === String(pagador.id)) || (typeof normalizarNombrePlan === 'function' ? normalizarNombrePlan(t.plan_activo) : t.plan_activo) !== 'Freemium')
      ).length;
      if (activosTrasPago > 0 && activosTrasPago % Number(cfg.metaReferidosMesGratis) === 0) {
        const bonoObj = {
          id: `com-${Date.now()}-bono-${Math.random().toString(36).slice(2, 6)}`,
          pago_id: `${pago.id}-META-${activosTrasPago}`,
          beneficiario_id: n1.id,
          beneficiario_nombre: n1.razon_social || n1.email,
          referido_origen_id: pagador.id,
          referido_origen_nombre: pagador.razon_social || pagador.email,
          nivel: 1,
          tipo_evento: 'BONO_META',
          porcentaje: 0,
          monto_base_usd: montoBase,
          monto_comision_usd: Number(cfg.bonoMetaUsd),
          estado: 'ACREDITADA',
          nota: `Bono meta alcanzada: ${activosTrasPago} clientes pagos activos`,
          created_at: new Date().toISOString()
        };
        await registrarComisionReferidoNube(bonoObj);
        creadas.push(bonoObj);
      }
    }
  }

  // Nivel 2
  if (n2 && String(n2.id) !== String(pagador.id) && String(n2.id) !== String(n1?.id) && puedeCobrarN2N3(n2, saasTenantsCache)) {
    const pctN2 = usaTasasPrimerPago ? Number(cfg.primerPagoN2Pct || 0) : Number(cfg.recurrenteN2Pct || 0);
    if (pctN2 > 0) {
      const comObj2 = {
        id: `com-${Date.now()}-n2-${Math.random().toString(36).slice(2, 6)}`,
        pago_id: String(pago.id),
        beneficiario_id: n2.id,
        beneficiario_nombre: n2.razon_social || n2.email,
        referido_origen_id: pagador.id,
        referido_origen_nombre: pagador.razon_social || pagador.email,
        nivel: 2,
        tipo_evento: usaTasasPrimerPago ? 'PRIMER_PAGO' : 'RECURRENTE',
        porcentaje: pctN2,
        monto_base_usd: montoBase,
        monto_comision_usd: Number(((montoBase * pctN2) / 100).toFixed(2)),
        estado: 'ACREDITADA',
        nota: `Red Nivel 2 · Plan ${pago.plan_solicitado}`,
        created_at: new Date().toISOString()
      };
      await registrarComisionReferidoNube(comObj2);
      creadas.push(comObj2);
    }
  }

  // Nivel 3
  if (n3 && String(n3.id) !== String(pagador.id) && String(n3.id) !== String(n1?.id) && String(n3.id) !== String(n2?.id) && puedeCobrarN2N3(n3, saasTenantsCache)) {
    const pctN3 = usaTasasPrimerPago ? Number(cfg.primerPagoN3Pct || 0) : Number(cfg.recurrenteN3Pct || 0);
    if (pctN3 > 0) {
      const comObj3 = {
        id: `com-${Date.now()}-n3-${Math.random().toString(36).slice(2, 6)}`,
        pago_id: String(pago.id),
        beneficiario_id: n3.id,
        beneficiario_nombre: n3.razon_social || n3.email,
        referido_origen_id: pagador.id,
        referido_origen_nombre: pagador.razon_social || pagador.email,
        nivel: 3,
        tipo_evento: usaTasasPrimerPago ? 'PRIMER_PAGO' : 'RECURRENTE',
        porcentaje: pctN3,
        monto_base_usd: montoBase,
        monto_comision_usd: Number(((montoBase * pctN3) / 100).toFixed(2)),
        estado: 'ACREDITADA',
        nota: `Red Nivel 3 · Plan ${pago.plan_solicitado}`,
        created_at: new Date().toISOString()
      };
      await registrarComisionReferidoNube(comObj3);
      creadas.push(comObj3);
    }
  }

  return creadas;
}

// ==========================================
// 5. PANEL DEL CLIENTE Y PROMOTOR (#seccionReferidos)
// ==========================================

function calcularResumenBilleteraReferido(beneficiarioId) {
  const misComs = saasComisionesCache.filter(c => String(c.beneficiario_id) === String(beneficiarioId) && c.estado !== 'ANULADA');
  const misRetiros = saasRetirosCache.filter(r => String(r.beneficiario_id) === String(beneficiarioId) && r.estado !== 'RECHAZADO');

  const totalGanado = misComs.reduce((s, c) => s + Number(c.monto_comision_usd || 0), 0);
  const totalRetiradoOCanjeado = misRetiros.reduce((s, r) => s + Number(r.monto_usd || 0), 0);
  const saldoDisponible = Math.max(0, Number((totalGanado - totalRetiradoOCanjeado).toFixed(2)));
  return {
    totalGanado: Number(totalGanado.toFixed(2)),
    totalRetirado: Number(totalRetiradoOCanjeado.toFixed(2)),
    saldoDisponible
  };
}

async function cargarDatosReferidos() {
  if (!tenantActual) return;
  await Promise.all([
    cargarConfigReferidosMaster(),
    typeof cargarConfigPlanesMaster === 'function' ? cargarConfigPlanesMaster() : Promise.resolve(),
    cargarTenantsParaReferidos(true),
    cargarComisionesReferidos(tenantActual.id),
    cargarRetirosReferidos(tenantActual.id)
  ]);

  const t = typeof fusionarTenantConMetaSaas === 'function' ? fusionarTenantConMetaSaas(tenantActual) : tenantActual;
  const codigo = obtenerCodigoReferidoTenant(t);
  const enlace = `${window.location.origin}/?ref=${encodeURIComponent(codigo)}`;
  const enlaceUuid = `${window.location.origin}/?ref=${encodeURIComponent(t.id)}`;

  const elCod = document.getElementById('refCodigoMiEmpresa');
  const elUrl = document.getElementById('refEnlaceCompartir');
  const elUrlUuid = document.getElementById('refEnlaceUuid');
  if (elCod) elCod.textContent = codigo;
  if (elUrl) elUrl.value = enlace;
  if (elUrlUuid) elUrlUuid.value = enlaceUuid;

  const qrCont = document.getElementById('refQrContenedor');
  if (qrCont) {
    qrCont.innerHTML = '';
    if (typeof QRCode !== 'undefined') {
      try {
        new QRCode(qrCont, { text: enlace, width: 112, height: 112, colorDark: '#0f172a', colorLight: '#ffffff' });
      } catch (e) {}
    }
  }

  const bannerProm = document.getElementById('refBannerPromotorExterno');
  const bloqueCanje = document.getElementById('refBloqueCanjeComercio');
  if (esPromotorExterno(t)) {
    bannerProm?.classList.remove('hidden');
    bloqueCanje?.classList.add('hidden');
  } else {
    bannerProm?.classList.add('hidden');
    bloqueCanje?.classList.remove('hidden');
  }

  // Prellenar datos de cobro si ya existen
  const elMet = document.getElementById('refRetiroMetodo');
  const elDest = document.getElementById('refRetiroDatosDestino');
  if (t.datos_cobro_comision?.metodo && elMet) elMet.value = t.datos_cobro_comision.metodo;
  if (t.datos_cobro_comision?.destino && elDest && !elDest.value) elDest.value = t.datos_cobro_comision.destino;

  renderizarPanelReferidosUsuario(t);
  renderizarEstadoCuentaUsuario();
}

function renderizarPanelReferidosUsuario(t) {
  const cfg = saasConfigReferidosCache;
  const tasa = typeof obtenerTasaBcvVigenteSaas === 'function' ? obtenerTasaBcvVigenteSaas() : 1;
  const billetera = calcularResumenBilleteraReferido(t.id);
  const tier = calcularTierPromotor(t.id, saasTenantsCache);

  // Red 3 niveles
  const n1List = saasTenantsCache.filter(x => String(x.referido_por_id || '') === String(t.id));
  const n1Ids = new Set(n1List.map(x => String(x.id)));
  const n2List = saasTenantsCache.filter(x => String(x.referido_nivel2_id || '') === String(t.id) || (x.referido_por_id && n1Ids.has(String(x.referido_por_id))));
  const n2Ids = new Set(n2List.map(x => String(x.id)));
  const n3List = saasTenantsCache.filter(x =>
    String(x.referido_nivel3_id || '') === String(t.id) ||
    (x.referido_por_id && n2Ids.has(String(x.referido_por_id)) && !n1Ids.has(String(x.id)) && String(x.id) !== String(t.id))
  );

  const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  setTxt('refKpiSaldoUsd', `$ ${billetera.saldoDisponible.toFixed(2)}`);
  setTxt('refKpiSaldoBs', `Bs. ${(billetera.saldoDisponible * tasa).toFixed(2)}`);
  setTxt('refKpiTotalGanadoUsd', `$ ${billetera.totalGanado.toFixed(2)}`);
  setTxt('refKpiRedTotales', String(n1List.length + n2List.length + n3List.length));
  setTxt('refKpiRedDetalle', `N1: ${n1List.length} · N2: ${n2List.length} · N3: ${n3List.length}`);
  setTxt('refKpiTierNombre', tier.nombre);
  setTxt('refKpiTierDetalle', tier.siguienteMeta
    ? `${tier.n1ActivosPagos} pagos activos · Faltan ${tier.siguienteMeta.faltan} para ${tier.siguienteMeta.nombre} (${tier.siguienteMeta.pct}%)`
    : `${tier.n1ActivosPagos} pagos activos · Máximo Nivel (${tier.pctN1Recurrente}%)`);
  setTxt('refMinimoRetiroInfo', `Mínimo de retiro: $ ${Number(cfg.minimoRetiroUsd || 20).toFixed(2)} USD`);

  const reglasCont = document.getElementById('refReglasResumenGrid');
  if (reglasCont) {
    reglasCont.innerHTML = `
      <div class="bg-slate-950 border border-slate-800 rounded-xl p-3">
        <p class="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Primer Pago Cliente Nuevo</p>
        <p class="text-xs font-mono text-white mt-1">N1: ${cfg.primerPagoN1Pct}% · N2: ${cfg.primerPagoN2Pct}% · N3: ${cfg.primerPagoN3Pct}%</p>
      </div>
      <div class="bg-slate-950 border border-slate-800 rounded-xl p-3">
        <p class="text-[10px] font-bold uppercase tracking-wider text-slate-300">Recurrente Mensual (Mes 2+)</p>
        <p class="text-xs font-mono text-white mt-1">N1: ${cfg.recurrenteN1Pct}% · N2: ${cfg.recurrenteN2Pct}% · N3: ${cfg.recurrenteN3Pct}%</p>
      </div>
      <div class="bg-slate-950 border border-slate-800 rounded-xl p-3">
        <p class="text-[10px] font-bold uppercase tracking-wider text-amber-300">Tiers Desempeño N1</p>
        <p class="text-xs font-mono text-white mt-1">${cfg.tier2MinActivos}+ → ${cfg.tier2N1Pct}% · ${cfg.tier3MinActivos}+ → ${cfg.tier3N1Pct}%</p>
      </div>
      <div class="bg-slate-950 border border-slate-800 rounded-xl p-3">
        <p class="text-[10px] font-bold uppercase tracking-wider text-sky-300">Incentivos & Bonos</p>
        <p class="text-xs font-mono text-white mt-1">Dto. Invitado: ${cfg.descuentoBienvenidaPct}% · Meta ${cfg.metaReferidosMesGratis} = $${cfg.bonoMetaUsd}</p>
      </div>
    `;
  }

  // Tabla Mi Red 3 Niveles
  const tbRed = document.getElementById('tablaMiRedReferidos');
  if (tbRed) {
    const combinada = [
      ...n1List.map(x => ({ ...x, _nivel: 1 })),
      ...n2List.map(x => ({ ...x, _nivel: 2 })),
      ...n3List.map(x => ({ ...x, _nivel: 3 }))
    ];
    if (combinada.length === 0) {
      tbRed.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-500">Aún no tienes comercios o promotores registrados con tu enlace.</td></tr>`;
    } else {
      tbRed.innerHTML = combinada.map(x => {
        const plan = esPromotorExterno(x) ? 'Promotor Aliado' : (typeof normalizarNombrePlan === 'function' ? normalizarNombrePlan(x.plan_activo) : (x.plan_activo || 'Freemium'));
        const est = x.activo !== false ? 'Activo' : 'Suspendido';
        return `
          <tr class="border-b border-slate-800/40">
            <td class="p-3 font-mono text-xs font-bold text-emerald-400">Nivel ${x._nivel}</td>
            <td class="p-3 text-xs text-white font-semibold">${esc(x.razon_social || x.email)}<div class="text-[11px] font-mono text-slate-400">${esc(x.rif || '')}</div></td>
            <td class="p-3 text-xs text-slate-300">${esPromotorExterno(x) ? 'Promotor Externo' : 'Comercio ERP'}</td>
            <td class="p-3 font-mono text-xs text-slate-200">${esc(plan)}</td>
            <td class="p-3 text-xs ${x.activo !== false ? 'text-emerald-400' : 'text-rose-400'} font-semibold">${est}</td>
          </tr>
        `;
      }).join('');
    }
  }

  // Tabla Mis Comisiones
  const tbCom = document.getElementById('tablaMisComisionesReferidos');
  if (tbCom) {
    if (saasComisionesCache.length === 0) {
      tbCom.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-500">Sin comisiones acreditadas todavía. Se generan al aprobarse el pago de tus referidos.</td></tr>`;
    } else {
      tbCom.innerHTML = saasComisionesCache.map(c => `
        <tr class="border-b border-slate-800/40">
          <td class="p-3 font-mono text-xs text-slate-400">${esc(String(c.created_at || '').slice(0, 10))}</td>
          <td class="p-3 text-xs text-white">${esc(c.referido_origen_nombre || '')}</td>
          <td class="p-3 font-mono text-xs text-emerald-400">N${c.nivel} · ${esc(c.tipo_evento)}</td>
          <td class="p-3 text-right font-mono text-xs tabular-nums text-slate-300">${Number(c.porcentaje || 0).toFixed(1)}%</td>
          <td class="p-3 text-right font-mono text-xs font-bold tabular-nums text-emerald-400">$ ${Number(c.monto_comision_usd || 0).toFixed(2)}</td>
          <td class="p-3 text-xs text-slate-300">${esc(c.nota || c.estado)}</td>
        </tr>
      `).join('');
    }
  }

  // Tabla Mis Retiros / Canjes
  const tbRet = document.getElementById('tablaMisRetirosReferidos');
  if (tbRet) {
    if (saasRetirosCache.length === 0) {
      tbRet.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-500">Sin solicitudes de retiro ni canjes realizados.</td></tr>`;
    } else {
      tbRet.innerHTML = saasRetirosCache.map(r => {
        const est = String(r.estado || 'PENDIENTE').toUpperCase();
        const col = est === 'PAGADO' ? 'text-emerald-400' : (est === 'RECHAZADO' ? 'text-rose-400' : 'text-amber-300');
        return `
          <tr class="border-b border-slate-800/40">
            <td class="p-3 font-mono text-xs text-slate-400">${esc(String(r.created_at || '').slice(0, 10))}</td>
            <td class="p-3 text-xs text-white">${esc(r.metodo_pago || r.tipo_liquidacion)}</td>
            <td class="p-3 font-mono text-xs text-slate-300">${esc(r.datos_destino || '--')}</td>
            <td class="p-3 text-right font-mono text-xs font-bold tabular-nums text-white">$ ${Number(r.monto_usd || 0).toFixed(2)}</td>
            <td class="p-3 font-mono text-xs font-bold ${col}">${esc(est)}${r.referencia_pago ? ` (${esc(r.referencia_pago)})` : ''}</td>
          </tr>
        `;
      }).join('');
    }
  }
}

function compartirReferidoWhatsapp() {
  const enlace = document.getElementById('refEnlaceCompartir')?.value || '';
  if (!enlace) return;
  const dto = Number(saasConfigReferidosCache.descuentoBienvenidaPct || 0);
  const texto = dto > 0
    ? `Te invito a usar MiFacturaDigital.com.ve (Facturación POS SENIAT, Inventario Kardex y Contabilidad). Regístrate con mi enlace y obtén ${dto}% de descuento en tu primer plan: ${enlace}`
    : `Te invito a usar MiFacturaDigital.com.ve (Facturación POS SENIAT, Inventario Kardex y Contabilidad). Regístrate con mi enlace: ${enlace}`;
  const a = document.createElement('a');
  a.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}`;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.click();
}

function copiarEnlaceReferidoUuid() {
  const val = document.getElementById('refEnlaceUuid')?.value || '';
  if (!val) return;
  navigator.clipboard?.writeText(val).then(
    () => avisarRef('Enlace alternativo (?ref=TENANT_ID) copiado.', 'success'),
    () => avisarRef(val, 'info', 6000)
  );
}

async function solicitarRetiroComisiones() {
  if (!tenantActual) return;
  await Promise.all([cargarConfigReferidosMaster(), cargarComisionesReferidos(tenantActual.id), cargarRetirosReferidos(tenantActual.id)]);
  const billetera = calcularResumenBilleteraReferido(tenantActual.id);
  const minimo = Number(saasConfigReferidosCache.minimoRetiroUsd || 20);
  const monto = parseFloat(document.getElementById('refRetiroMontoUsd')?.value || '0');
  const metodo = document.getElementById('refRetiroMetodo')?.value || 'PAGO MOVIL';
  const destino = (document.getElementById('refRetiroDatosDestino')?.value || '').trim();

  if (!Number.isFinite(monto) || monto <= 0) {
    avisarRef('Ingresa un monto válido en USD a retirar.', 'warning');
    return;
  }
  if (monto < minimo) {
    avisarRef(`El monto mínimo de retiro configurado es $ ${minimo.toFixed(2)} USD.`, 'warning');
    return;
  }
  if (monto > billetera.saldoDisponible) {
    avisarRef(`Saldo insuficiente. Tu saldo disponible actual es $ ${billetera.saldoDisponible.toFixed(2)} USD.`, 'warning');
    return;
  }
  if (!destino || destino.length < 5) {
    avisarRef('Ingresa tus datos de cobro (Teléfono/Banco Pago Móvil, Cuenta, Correo Zelle o ID Binance).', 'warning');
    return;
  }

  const tasa = typeof obtenerTasaBcvVigenteSaas === 'function' ? obtenerTasaBcvVigenteSaas() : 1;
  const retiroObj = {
    id: `ret-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    beneficiario_id: tenantActual.id,
    beneficiario_nombre: tenantActual.razon_social || tenantActual.email,
    beneficiario_rif: tenantActual.rif || '',
    tipo_liquidacion: 'RETIRO_EFECTIVO',
    metodo_pago: metodo,
    datos_destino: destino,
    monto_usd: Number(monto.toFixed(2)),
    monto_bs: Number((monto * tasa).toFixed(2)),
    estado: 'PENDIENTE',
    created_at: new Date().toISOString()
  };

  if (typeof guardarMetaYEstadoTenantEnNube === 'function') {
    await guardarMetaYEstadoTenantEnNube(tenantActual.id, {}, { datos_cobro_comision: { metodo, destino } });
  }
  await registrarRetiroReferidoNube(retiroObj);

  const elMonto = document.getElementById('refRetiroMontoUsd');
  if (elMonto) elMonto.value = '';
  avisarRef(`Solicitud de retiro por $ ${monto.toFixed(2)} USD enviada al administrador Master.`, 'success', 6500);
  await cargarDatosReferidos();
}

async function canjearSaldoPorSuscripcion() {
  if (!tenantActual || esPromotorExterno(tenantActual)) return;
  await Promise.all([
    cargarConfigReferidosMaster(),
    typeof cargarConfigPlanesMaster === 'function' ? cargarConfigPlanesMaster() : Promise.resolve(),
    cargarComisionesReferidos(tenantActual.id),
    cargarRetirosReferidos(tenantActual.id)
  ]);

  const plan = document.getElementById('refCanjePlanSelect')?.value || 'Pyme';
  const ciclo = document.getElementById('refCanjeCicloSelect')?.value || 'MENSUAL';
  const cfgPlan = typeof PLANES_SAAS_CATALOGO !== 'undefined' ? (PLANES_SAAS_CATALOGO[plan] || PLANES_SAAS_CATALOGO.Pyme) : { precioMensual: 19, precioAnual: 182 };
  const costoUsd = Number(ciclo === 'ANUAL' ? cfgPlan.precioAnual : cfgPlan.precioMensual);
  const billetera = calcularResumenBilleteraReferido(tenantActual.id);

  if (costoUsd <= 0) return;
  if (billetera.saldoDisponible < costoUsd) {
    avisarRef(`Necesitas $ ${costoUsd.toFixed(2)} USD en saldo para canjear ${plan} (${ciclo}). Saldo disponible: $ ${billetera.saldoDisponible.toFixed(2)}.`, 'warning', 6500);
    return;
  }

  const ok = typeof pedirConfirmacion === 'function'
    ? await pedirConfirmacion('Canjear Saldo por Suscripción', `Se descontarán $ ${costoUsd.toFixed(2)} USD de tu billetera para activar/renovar el Plan ${plan} (${ciclo}). ¿Continuar?`)
    : true;
  if (!ok) return;

  const nuevaFecha = typeof calcularNuevaFechaVencimiento === 'function'
    ? calcularNuevaFechaVencimiento(ciclo, tenantActual.fecha_vencimiento_plan)
    : new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const retiroCanje = {
    id: `canje-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    beneficiario_id: tenantActual.id,
    beneficiario_nombre: tenantActual.razon_social || tenantActual.email,
    beneficiario_rif: tenantActual.rif || '',
    tipo_liquidacion: 'CREDITO_SUSCRIPCION',
    metodo_pago: 'CANJE BILLETERA',
    datos_destino: `Activación ${plan} (${ciclo}) hasta ${nuevaFecha}`,
    monto_usd: Number(costoUsd.toFixed(2)),
    monto_bs: 0,
    estado: 'PAGADO',
    referencia_pago: 'AUTO-CANJE',
    revisado_por: 'SISTEMA',
    revisado_en: new Date().toISOString(),
    created_at: new Date().toISOString()
  };
  await registrarRetiroReferidoNube(retiroCanje);

  if (typeof guardarMetaYEstadoTenantEnNube === 'function') {
    const modulos = typeof obtenerPresetModulosPorPlan === 'function' ? obtenerPresetModulosPorPlan(plan) : undefined;
    await guardarMetaYEstadoTenantEnNube(
      tenantActual.id,
      { plan_activo: plan, activo: true },
      {
        ciclo_facturacion: ciclo,
        fecha_vencimiento_plan: nuevaFecha,
        estado_suscripcion: 'ACTIVA',
        ...(modulos ? { modulos_permitidos: modulos } : {})
      }
    );
  }

  avisarRef(`¡Canje exitoso! Tu Plan ${plan} (${ciclo}) ha sido activado hasta ${nuevaFecha} usando tus comisiones.`, 'success', 7500);
  await cargarDatosReferidos();
}

// ==========================================
// 6. PANEL MASTER: REGLAS, RETIROS, LEADS Y AUDITORÍA DE RED
// ==========================================

async function cargarPanelReferidosMaster() {
  if (typeof esUsuarioMaster === 'function' && !esUsuarioMaster()) return;
  await Promise.all([
    cargarConfigReferidosMaster(),
    cargarTenantsParaReferidos(true),
    cargarComisionesReferidos(null),
    cargarRetirosReferidos(null),
    cargarLeadsLandingMaster()
  ]);

  pintarConfigReferidosEnMasterUI();
  renderizarDashboardReferidosMaster();
  poblarSelectoresReferidosUI();
  renderizarEstadoCuentaMaster();
}

function renderizarDashboardReferidosMaster() {
  const promotores = saasTenantsCache.filter(t => esPromotorExterno(t)).length;
  const referidosComercio = saasTenantsCache.filter(t => !esPromotorExterno(t) && t.referido_por_id).length;
  const totalComUsd = saasComisionesCache.filter(c => c.estado !== 'ANULADA').reduce((s, c) => s + Number(c.monto_comision_usd || 0), 0);
  const retirosPendUsd = saasRetirosCache.filter(r => r.estado === 'PENDIENTE').reduce((s, r) => s + Number(r.monto_usd || 0), 0);

  const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  setTxt('masterRefKpiPromotores', String(promotores));
  setTxt('masterRefKpiComerciosRef', String(referidosComercio));
  setTxt('masterRefKpiComisionesUsd', `$ ${totalComUsd.toFixed(2)}`);
  setTxt('masterRefKpiRetirosPendUsd', `$ ${retirosPendUsd.toFixed(2)}`);

  // Bandeja Retiros y Liquidaciones
  const tbRet = document.getElementById('tablaMasterRetirosReferidos');
  if (tbRet) {
    if (saasRetirosCache.length === 0) {
      tbRet.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-500">Sin solicitudes de retiro ni liquidaciones registradas.</td></tr>`;
    } else {
      tbRet.innerHTML = saasRetirosCache.map(r => {
        const est = String(r.estado || 'PENDIENTE').toUpperCase();
        const col = est === 'PAGADO' ? 'text-emerald-400' : (est === 'RECHAZADO' ? 'text-rose-400' : 'text-amber-300');
        const btns = est === 'PENDIENTE'
          ? `
            <button type="button" onclick='aprobarRetiroReferidoMaster("${esc(r.id)}")' class="bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer">Marcar Pagado</button>
            <button type="button" onclick='rechazarRetiroReferidoMaster("${esc(r.id)}")' class="bg-rose-950 hover:bg-rose-900 text-rose-200 border border-rose-700/50 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer">Rechazar</button>
          `
          : `<span class="text-[11px] font-mono text-slate-500">${esc(r.referencia_pago || 'Liquidado')}</span>`;

        return `
          <tr class="border-b border-slate-800/40">
            <td class="p-3 text-xs text-white font-semibold">${esc(r.beneficiario_nombre)}<div class="text-[11px] font-mono text-slate-400">${esc(String(r.created_at || '').slice(0, 10))}</div></td>
            <td class="p-3 text-xs text-slate-300">${esc(r.metodo_pago || r.tipo_liquidacion)}</td>
            <td class="p-3 font-mono text-xs text-slate-200">${esc(r.datos_destino || '--')}</td>
            <td class="p-3 text-right font-mono text-xs font-bold tabular-nums text-emerald-400">$ ${Number(r.monto_usd || 0).toFixed(2)}</td>
            <td class="p-3 font-mono text-xs font-bold ${col}">${esc(est)}</td>
            <td class="p-3 text-center space-x-1">${btns}</td>
          </tr>
        `;
      }).join('');
    }
  }

  // Leads Landing
  const tbLeads = document.getElementById('tablaMasterLeadsLanding');
  if (tbLeads) {
    if (saasLeadsLandingCache.length === 0) {
      tbLeads.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-500">Sin solicitudes de demo registradas desde la Landing todavía.</td></tr>`;
    } else {
      tbLeads.innerHTML = saasLeadsLandingCache.map(l => `
        <tr class="border-b border-slate-800/40">
          <td class="p-3 font-mono text-xs text-slate-400">${esc(String(l.created_at || '').slice(0, 10))}</td>
          <td class="p-3 text-xs text-white font-semibold">${esc(l.nombre)}<div class="text-[11px] font-mono text-slate-400">${esc(l.rif || '')}</div></td>
          <td class="p-3 text-xs text-slate-300">${esc(l.telefono)} · ${esc(l.email)}</td>
          <td class="p-3 font-mono text-xs ${l.referido_por_codigo ? 'text-emerald-400 font-bold' : 'text-slate-500'}">${esc(l.referido_por_codigo || 'Orgánico Directo')}</td>
          <td class="p-3 text-xs text-slate-300">${esc(l.estado || 'NUEVO')}</td>
        </tr>
      `).join('');
    }
  }

  // Ranking Referidores
  const tbRank = document.getElementById('tablaMasterRankingReferidores');
  if (tbRank) {
    const afiliados = obtenerListaAfiliadosActivosOrdenada();

    if (afiliados.length === 0) {
      tbRank.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-500">Sin promotores ni referidos registrados todavía.</td></tr>`;
    } else {
      tbRank.innerHTML = afiliados.slice(0, 50).map(({ t, directos, b, tier }) => `
        <tr class="border-b border-slate-800/40">
          <td class="p-3 text-xs text-white font-semibold">${esc(t.razon_social)}<div class="text-[11px] font-mono text-slate-400">${esc(obtenerCodigoReferidoTenant(t))}</div></td>
          <td class="p-3 text-xs text-slate-300">${esPromotorExterno(t) ? 'Promotor Externo' : 'Comercio'}</td>
          <td class="p-3 font-mono text-xs text-slate-200">${esc(tier.nombre)}</td>
          <td class="p-3 text-right font-mono text-xs tabular-nums text-white">${directos} (${tier.n1ActivosPagos} pagos)</td>
          <td class="p-3 text-right font-mono text-xs tabular-nums text-emerald-400">$ ${b.totalGanado.toFixed(2)}</td>
          <td class="p-3 text-right font-mono text-xs tabular-nums text-amber-300">$ ${b.saldoDisponible.toFixed(2)}</td>
          <td class="p-3 text-center whitespace-nowrap space-x-1">
            <button type="button" onclick='seleccionarReferidoParaEstadoCuenta("${esc(t.id)}", true)' class="bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-emerald-700/40 px-2 py-1 rounded-lg text-[11px] font-semibold cursor-pointer">Est. Cuenta</button>
          </td>
        </tr>
      `).join('');
    }
  }

  // Historial reciente comisiones
  const tbHist = document.getElementById('tablaMasterHistorialComisiones');
  if (tbHist) {
    if (saasComisionesCache.length === 0) {
      tbHist.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-500">Sin comisiones calculadas todavía.</td></tr>`;
    } else {
      tbHist.innerHTML = saasComisionesCache.slice(0, 50).map(c => `
        <tr class="border-b border-slate-800/40">
          <td class="p-3 font-mono text-xs text-slate-400">${esc(String(c.created_at || '').slice(0, 10))}</td>
          <td class="p-3 text-xs text-white font-semibold">${esc(c.beneficiario_nombre)}</td>
          <td class="p-3 text-xs text-slate-300">${esc(c.referido_origen_nombre)}</td>
          <td class="p-3 font-mono text-xs text-emerald-400">N${c.nivel} · ${esc(c.tipo_evento)} (${Number(c.porcentaje || 0).toFixed(1)}%)</td>
          <td class="p-3 text-right font-mono text-xs tabular-nums text-slate-300">$ ${Number(c.monto_base_usd || 0).toFixed(2)}</td>
          <td class="p-3 text-right font-mono text-xs font-bold tabular-nums text-emerald-400">$ ${Number(c.monto_comision_usd || 0).toFixed(2)}</td>
        </tr>
      `).join('');
    }
  }
}

async function aprobarRetiroReferidoMaster(retiroId) {
  const r = saasRetirosCache.find(x => String(x.id) === String(retiroId));
  if (!r) return;
  const refInput = document.getElementById('masterRefPagoRetiroInput')?.value.trim() || `LIQ-${Date.now().toString().slice(-6)}`;
  await registrarRetiroReferidoNube({
    ...r,
    estado: 'PAGADO',
    referencia_pago: refInput,
    revisado_por: tenantActual?.email || 'master',
    revisado_en: new Date().toISOString()
  });
  avisarRef(`Liquidación de $ ${Number(r.monto_usd).toFixed(2)} USD a ${r.beneficiario_nombre} marcada como PAGADA.`, 'success');
  await cargarPanelReferidosMaster();
}

async function rechazarRetiroReferidoMaster(retiroId) {
  const r = saasRetirosCache.find(x => String(x.id) === String(retiroId));
  if (!r) return;
  const ok = typeof pedirConfirmacion === 'function'
    ? await pedirConfirmacion('Rechazar Retiro', `¿Rechazar la solicitud de retiro de ${r.beneficiario_nombre} por $ ${Number(r.monto_usd).toFixed(2)}? El saldo volverá a quedar disponible.`)
    : true;
  if (!ok) return;
  await registrarRetiroReferidoNube({
    ...r,
    estado: 'RECHAZADO',
    revisado_por: tenantActual?.email || 'master',
    revisado_en: new Date().toISOString()
  });
  avisarRef('Solicitud de retiro rechazada; saldo liberado.', 'warning');
  await cargarPanelReferidosMaster();
}

// ==========================================
// 7. HISTORIAL CRONOLÓGICO, CARGA DE PAGOS MASTER Y ESTADOS DE CUENTA IMPRIMIBLES (PDF / EXCEL)
// ==========================================

function obtenerListaAfiliadosActivosOrdenada() {
  const mapaBilleteraIds = new Set([
    ...saasComisionesCache.map(c => String(c.beneficiario_id || '')),
    ...saasRetirosCache.map(r => String(r.beneficiario_id || ''))
  ]);
  const lista = (saasTenantsCache || []).map(t => {
    const directos = saasTenantsCache.filter(x => String(x.referido_por_id || '') === String(t.id)).length;
    const b = calcularResumenBilleteraReferido(t.id);
    const tier = calcularTierPromotor(t.id, saasTenantsCache);
    return { t, directos, b, tier };
  }).filter(x => esPromotorExterno(x.t) || x.directos > 0 || mapaBilleteraIds.has(String(x.t.id)));

  lista.sort((a, b) => b.b.saldoDisponible - a.b.saldoDisponible || b.b.totalGanado - a.b.totalGanado || b.directos - a.directos);
  return lista;
}

function construirMovimientosUnificadosReferido(beneficiarioId = null) {
  const tasa = typeof obtenerTasaBcvVigenteSaas === 'function' ? obtenerTasaBcvVigenteSaas() : 1;
  const movs = [];

  saasComisionesCache.forEach(c => {
    if (beneficiarioId && String(c.beneficiario_id) !== String(beneficiarioId)) return;
    const est = String(c.estado || 'ACREDITADA').toUpperCase();
    const anulada = est === 'ANULADA';
    const monto = anulada ? 0 : Number(c.monto_comision_usd || 0);
    const esBono = c.tipo_evento === 'BONO_META' || c.tipo_evento === 'BONO_MANUAL';
    const fechaIso = c.created_at || new Date().toISOString();
    movs.push({
      id: c.id,
      beneficiarioId: c.beneficiario_id,
      beneficiarioNombre: c.beneficiario_nombre || '--',
      fechaIso,
      fecha: String(fechaIso).slice(0, 10),
      ordenSec: 1, // Créditos primero en igual timestamp
      tipoCategoria: esBono ? 'BONO' : 'COMISION',
      evento: c.tipo_evento || 'RECURRENTE',
      concepto: c.tipo_evento === 'BONO_MANUAL'
        ? 'Bono / Ajuste Manual Master'
        : (c.tipo_evento === 'BONO_META'
          ? 'Bono Automático por Meta'
          : `Comisión N${c.nivel || 1} (${Number(c.porcentaje || 0).toFixed(1)}%)`),
      origenOReferencia: [c.referido_origen_nombre, c.nota].filter(Boolean).join(' · ') || c.pago_id || '--',
      creditoUsd: monto,
      debitoUsd: 0,
      montoBs: Number((monto * tasa).toFixed(2)),
      estado: est,
      afectaSaldo: !anulada
    });
  });

  saasRetirosCache.forEach(r => {
    if (beneficiarioId && String(r.beneficiario_id) !== String(beneficiarioId)) return;
    const est = String(r.estado || 'PENDIENTE').toUpperCase();
    const rechazada = est === 'RECHAZADO';
    const monto = rechazada ? 0 : Number(r.monto_usd || 0);
    const esCanje = r.tipo_liquidacion === 'CREDITO_SUSCRIPCION';
    const fechaIso = r.created_at || new Date().toISOString();
    const conceptoBase = esCanje
      ? 'Canje por Suscripción SaaS'
      : (r.tipo_liquidacion === 'PAGO_DIRECTO_MASTER' ? 'Pago Directo Liquidado (Master)' : 'Retiro de Comisiones');

    movs.push({
      id: r.id,
      beneficiarioId: r.beneficiario_id,
      beneficiarioNombre: r.beneficiario_nombre || '--',
      fechaIso,
      fecha: String(fechaIso).slice(0, 10),
      ordenSec: 2,
      tipoCategoria: esCanje ? 'CANJE' : 'PAGO',
      evento: r.tipo_liquidacion || 'RETIRO_EFECTIVO',
      concepto: `${conceptoBase}${r.metodo_pago ? ` (${r.metodo_pago})` : ''}`,
      origenOReferencia: [r.referencia_pago ? `Ref: ${r.referencia_pago}` : '', r.datos_destino].filter(Boolean).join(' · ') || '--',
      creditoUsd: 0,
      debitoUsd: monto,
      montoBs: Number(r.monto_bs || (monto * tasa) || 0),
      estado: est,
      afectaSaldo: !rechazada
    });
  });

  // Orden cronológico ascendente estricto para calcular saldo corrido exacto
  movs.sort((a, b) => {
    const cmp = String(a.fechaIso).localeCompare(String(b.fechaIso));
    if (cmp !== 0) return cmp;
    if (a.ordenSec !== b.ordenSec) return a.ordenSec - b.ordenSec;
    return String(a.id).localeCompare(String(b.id));
  });

  return movs;
}

function construirEstadoCuentaReferido({ beneficiarioId = null, desde = '', hasta = '', tipo = 'TODOS' } = {}) {
  const todos = construirMovimientosUnificadosReferido(beneficiarioId);
  const dDesde = (desde || '').trim();
  const dHasta = (hasta || '').trim();
  const fTipo = (tipo || 'TODOS').toUpperCase();

  let saldoInicial = 0;
  let saldoCorrido = 0;
  let totalGanadoHistorico = 0;
  let totalPagadoHistorico = 0;
  let pendientePorPagar = 0;

  const enriquecidos = [];

  todos.forEach(m => {
    if (m.afectaSaldo) {
      totalGanadoHistorico += m.creditoUsd;
      if (m.debitoUsd > 0) {
        totalPagadoHistorico += m.debitoUsd;
        if (m.estado === 'PENDIENTE') pendientePorPagar += m.debitoUsd;
      }
    }

    if (dDesde && m.fecha < dDesde) {
      saldoInicial = Number((saldoInicial + m.creditoUsd - m.debitoUsd).toFixed(2));
      saldoCorrido = saldoInicial;
      return;
    }

    saldoCorrido = Number((saldoCorrido + m.creditoUsd - m.debitoUsd).toFixed(2));
    enriquecidos.push({ ...m, saldoCorrido });
  });

  const enRango = enriquecidos.filter(m => {
    if (dHasta && m.fecha > dHasta) return false;
    if (fTipo !== 'TODOS' && m.tipoCategoria !== fTipo) return false;
    return true;
  });

  const totalCreditos = Number(enRango.reduce((s, m) => s + m.creditoUsd, 0).toFixed(2));
  const totalDebitos = Number(enRango.reduce((s, m) => s + m.debitoUsd, 0).toFixed(2));
  const ultimoEnRango = enriquecidos.filter(m => !dHasta || m.fecha <= dHasta);
  const saldoCierrePeriodo = ultimoEnRango.length > 0
    ? ultimoEnRango[ultimoEnRango.length - 1].saldoCorrido
    : saldoInicial;
  const saldoActualDisponible = Math.max(0, Number((totalGanadoHistorico - totalPagadoHistorico).toFixed(2)));

  const beneficiario = beneficiarioId
    ? (saasTenantsCache.find(t => String(t.id) === String(beneficiarioId)) || null)
    : null;

  return {
    beneficiario,
    beneficiarioId: beneficiarioId || 'TODOS',
    desde: dDesde,
    hasta: dHasta,
    tipo: fTipo,
    movimientos: enRango,
    saldoInicial: Number(saldoInicial.toFixed(2)),
    totalCreditos,
    totalDebitos,
    saldoCierrePeriodo: Number(saldoCierrePeriodo.toFixed(2)),
    saldoActualDisponible,
    totalGanadoHistorico: Number(totalGanadoHistorico.toFixed(2)),
    totalPagadoHistorico: Number(totalPagadoHistorico.toFixed(2)),
    pendientePorPagar: Number(pendientePorPagar.toFixed(2))
  };
}

function poblarSelectoresReferidosUI() {
  const afiliados = obtenerListaAfiliadosActivosOrdenada();
  const selPago = document.getElementById('masterCargaPagoBeneficiario');
  const selFiltro = document.getElementById('masterRefFiltroBeneficiario');
  const fechaInput = document.getElementById('masterCargaPagoFecha');
  if (fechaInput && !fechaInput.value) {
    fechaInput.value = new Date().toISOString().slice(0, 10);
  }

  if (selPago) {
    const valPrev = selPago.value;
    const opts = ['<option value="">-- Selecciona un comercio o promotor --</option>'];
    const todosTenantsOrdenados = [...afiliados];
    const idsIncluidos = new Set(afiliados.map(a => String(a.t.id)));
    (saasTenantsCache || []).forEach(t => {
      if (!idsIncluidos.has(String(t.id))) {
        todosTenantsOrdenados.push({
          t,
          b: calcularResumenBilleteraReferido(t.id)
        });
      }
    });
    todosTenantsOrdenados.forEach(({ t, b }) => {
      const cod = obtenerCodigoReferidoTenant(t);
      const tipoTxt = esPromotorExterno(t) ? 'Promotor' : 'Comercio';
      opts.push(`<option value="${esc(t.id)}">${esc(t.razon_social || t.email)} (${cod} · ${tipoTxt}) — Saldo: $${b.saldoDisponible.toFixed(2)}</option>`);
    });
    selPago.innerHTML = opts.join('');
    if (valPrev) selPago.value = valPrev;
    pintarSaldoCargaPagoMaster();
  }

  if (selFiltro) {
    const valPrevF = selFiltro.value;
    const optsF = ['<option value="">Todos los Afiliados (Consolidado)</option>'];
    afiliados.forEach(({ t, b }) => {
      const cod = obtenerCodigoReferidoTenant(t);
      optsF.push(`<option value="${esc(t.id)}">${esc(t.razon_social || t.email)} (${cod}) · Saldo: $${b.saldoDisponible.toFixed(2)}</option>`);
    });
    selFiltro.innerHTML = optsF.join('');
    if (valPrevF) selFiltro.value = valPrevF;
  }
}

function pintarSaldoCargaPagoMaster() {
  const id = document.getElementById('masterCargaPagoBeneficiario')?.value || '';
  const elInfo = document.getElementById('masterCargaPagoSaldoInfo');
  if (!elInfo) return;
  if (!id) {
    elInfo.textContent = 'Selecciona un afiliado para consultar su saldo disponible y datos de cobro.';
    return;
  }
  const t = saasTenantsCache.find(x => String(x.id) === String(id));
  const b = calcularResumenBilleteraReferido(id);
  const cobro = t?.datos_cobro_comision?.destino
    ? ` · Cobro reg.: ${t.datos_cobro_comision.metodo || ''} ${t.datos_cobro_comision.destino}`
    : '';
  elInfo.textContent = `Saldo disponible: $ ${b.saldoDisponible.toFixed(2)} USD (Ganado: $${b.totalGanado.toFixed(2)})${cobro}`;

  // Pre-rellenar método y nota con datos de cobro si están vacíos
  const metSel = document.getElementById('masterCargaPagoMetodo');
  const notaInp = document.getElementById('masterCargaPagoNota');
  if (t?.datos_cobro_comision?.metodo && metSel) {
    const existe = Array.from(metSel.options).some(o => o.value === t.datos_cobro_comision.metodo);
    if (existe) metSel.value = t.datos_cobro_comision.metodo;
  }
  if (t?.datos_cobro_comision?.destino && notaInp && !notaInp.value) {
    notaInp.placeholder = `Destino registrado: ${t.datos_cobro_comision.destino}`;
  }
  actualizarPreviewCargaPagoMaster();
}

function usarSaldoCompletoCargaMaster() {
  const id = document.getElementById('masterCargaPagoBeneficiario')?.value || '';
  if (!id) {
    avisarRef('Selecciona primero un afiliado.', 'warning');
    return;
  }
  const b = calcularResumenBilleteraReferido(id);
  const inp = document.getElementById('masterCargaPagoMontoUsd');
  if (inp) {
    inp.value = b.saldoDisponible.toFixed(2);
    actualizarPreviewCargaPagoMaster();
  }
}

function actualizarPreviewCargaPagoMaster() {
  const el = document.getElementById('masterCargaPagoBsInfo');
  if (!el) return;
  const monto = parseFloat(document.getElementById('masterCargaPagoMontoUsd')?.value || '0');
  const tasa = typeof obtenerTasaBcvVigenteSaas === 'function' ? obtenerTasaBcvVigenteSaas() : 1;
  const bs = Number.isFinite(monto) && monto > 0 ? monto * tasa : 0;
  el.textContent = `Equivalente BCV: Bs. ${bs.toFixed(2)} (Tasa: ${Number(tasa).toFixed(2)})`;
}

async function cargarPagoAReferidoMaster(e) {
  if (e) e.preventDefault();
  if (typeof esUsuarioMaster === 'function' && !esUsuarioMaster()) {
    avisarRef('Solo el usuario Master puede cargar pagos o bonos directos a referidos.', 'error');
    return;
  }

  const beneficiarioId = document.getElementById('masterCargaPagoBeneficiario')?.value || '';
  const tipoOp = document.getElementById('masterCargaPagoTipo')?.value || 'PAGO_LIQUIDACION';
  const monto = parseFloat(document.getElementById('masterCargaPagoMontoUsd')?.value || '0');
  const metodo = document.getElementById('masterCargaPagoMetodo')?.value || 'PAGO MOVIL';
  const fecha = document.getElementById('masterCargaPagoFecha')?.value || new Date().toISOString().slice(0, 10);
  const referencia = (document.getElementById('masterCargaPagoReferencia')?.value || '').trim();
  const nota = (document.getElementById('masterCargaPagoNota')?.value || '').trim();

  if (!beneficiarioId) {
    avisarRef('Selecciona el referido/promotor beneficiario.', 'warning');
    return;
  }
  if (!Number.isFinite(monto) || monto <= 0) {
    avisarRef('Ingresa un monto en USD mayor a 0.', 'warning');
    return;
  }

  const benef = saasTenantsCache.find(t => String(t.id) === String(beneficiarioId));
  if (!benef) {
    avisarRef('No se encontró el afiliado seleccionado.', 'error');
    return;
  }

  const fechaIso = /^\d{4}-\d{2}-\d{2}$/.test(fecha)
    ? `${fecha}T12:00:00.000Z`
    : new Date().toISOString();
  const tasa = typeof obtenerTasaBcvVigenteSaas === 'function' ? obtenerTasaBcvVigenteSaas() : 1;

  if (tipoOp === 'PAGO_LIQUIDACION') {
    const b = calcularResumenBilleteraReferido(beneficiarioId);
    if (monto > b.saldoDisponible + 0.009) {
      avisarRef(`El monto ($ ${monto.toFixed(2)}) supera el saldo disponible actual del referido ($ ${b.saldoDisponible.toFixed(2)} USD). Si deseas otorgarle un crédito primero, usa "Bono / Ajuste Manual".`, 'warning', 7000);
      return;
    }
    if (!referencia) {
      avisarRef('Ingresa el número de referencia bancaria o comprobante del pago realizado.', 'warning');
      return;
    }

    const destino = nota || benef.datos_cobro_comision?.destino || 'Pago directo cargado por Master';
    const pagoObj = {
      id: `ret-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      beneficiario_id: benef.id,
      beneficiario_nombre: benef.razon_social || benef.email,
      beneficiario_rif: benef.rif || '',
      tipo_liquidacion: 'PAGO_DIRECTO_MASTER',
      metodo_pago: metodo,
      datos_destino: destino,
      monto_usd: Number(monto.toFixed(2)),
      monto_bs: Number((monto * tasa).toFixed(2)),
      estado: 'PAGADO',
      referencia_pago: referencia,
      revisado_por: tenantActual?.email || 'master',
      revisado_en: fechaIso,
      created_at: fechaIso
    };
    await registrarRetiroReferidoNube(pagoObj);
    avisarRef(`Pago por $ ${monto.toFixed(2)} USD cargado a ${benef.razon_social || benef.email} (Ref: ${referencia}).`, 'success', 6500);
  } else {
    const bonoObj = {
      id: `com-${Date.now()}-manual-${Math.random().toString(36).slice(2, 6)}`,
      pago_id: referencia || `MANUAL-${Date.now().toString().slice(-6)}`,
      beneficiario_id: benef.id,
      beneficiario_nombre: benef.razon_social || benef.email,
      referido_origen_id: tenantActual?.id || benef.id,
      referido_origen_nombre: 'Administración Master',
      nivel: 1,
      tipo_evento: 'BONO_MANUAL',
      porcentaje: 0,
      monto_base_usd: Number(monto.toFixed(2)),
      monto_comision_usd: Number(monto.toFixed(2)),
      estado: 'ACREDITADA',
      nota: nota || (referencia ? `Ref: ${referencia}` : 'Bono / Ajuste manual cargado por Master'),
      created_at: fechaIso
    };
    await registrarComisionReferidoNube(bonoObj);
    avisarRef(`Bono manual por +$ ${monto.toFixed(2)} USD acreditado a ${benef.razon_social || benef.email}.`, 'success', 6500);
  }

  const resetId = id => { const el = document.getElementById(id); if (el) el.value = ''; };
  resetId('masterCargaPagoMontoUsd');
  resetId('masterCargaPagoReferencia');
  resetId('masterCargaPagoNota');
  actualizarPreviewCargaPagoMaster();
  await cargarPanelReferidosMaster();
  const selFiltro = document.getElementById('masterRefFiltroBeneficiario');
  if (selFiltro) selFiltro.value = String(beneficiarioId);
  renderizarEstadoCuentaMaster();
}

function seleccionarReferidoParaEstadoCuenta(beneficiarioId, hacerScroll = false) {
  const selFiltro = document.getElementById('masterRefFiltroBeneficiario');
  if (selFiltro) {
    selFiltro.value = String(beneficiarioId || '');
  }
  const selPago = document.getElementById('masterCargaPagoBeneficiario');
  if (selPago && beneficiarioId) {
    selPago.value = String(beneficiarioId);
    pintarSaldoCargaPagoMaster();
  }
  renderizarEstadoCuentaMaster();
  if (hacerScroll) {
    document.getElementById('cardMasterEstadoCuentaReferido')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderizarResumenYTablaEstadoCuenta(estado, elResumenId, elTbodyId, incluirAfiliado = false) {
  const elRes = document.getElementById(elResumenId);
  if (elRes) {
    elRes.innerHTML = `
      <div class="bg-slate-950 border border-slate-800 rounded-xl p-3">
        <p class="text-[10px] font-bold uppercase text-slate-400">Saldo Inicial</p>
        <p class="text-sm font-bold font-mono tabular-nums text-white mt-0.5">$ ${estado.saldoInicial.toFixed(2)}</p>
      </div>
      <div class="bg-slate-950 border border-slate-800 rounded-xl p-3">
        <p class="text-[10px] font-bold uppercase text-emerald-400">Créditos (Rango)</p>
        <p class="text-sm font-bold font-mono tabular-nums text-emerald-400 mt-0.5">+ $ ${estado.totalCreditos.toFixed(2)}</p>
      </div>
      <div class="bg-slate-950 border border-slate-800 rounded-xl p-3">
        <p class="text-[10px] font-bold uppercase text-amber-300">Débitos / Pagos (Rango)</p>
        <p class="text-sm font-bold font-mono tabular-nums text-amber-300 mt-0.5">- $ ${estado.totalDebitos.toFixed(2)}</p>
      </div>
      <div class="bg-slate-950 border border-emerald-500/40 rounded-xl p-3">
        <p class="text-[10px] font-bold uppercase text-emerald-300">Saldo Disponible Actual</p>
        <p class="text-sm font-bold font-mono tabular-nums text-emerald-400 mt-0.5">$ ${estado.saldoActualDisponible.toFixed(2)}</p>
      </div>
    `;
  }

  const tb = document.getElementById(elTbodyId);
  if (!tb) return;

  const colspan = incluirAfiliado ? 8 : 7;
  if (estado.movimientos.length === 0) {
    tb.innerHTML = `<tr><td colspan="${colspan}" class="p-4 text-center text-slate-500">No hay movimientos registrados para los filtros seleccionados.</td></tr>`;
    return;
  }

  tb.innerHTML = estado.movimientos.map(m => {
    const colEst = m.estado === 'ACREDITADA' || m.estado === 'PAGADO'
      ? 'text-emerald-400'
      : (m.estado === 'RECHAZADO' || m.estado === 'ANULADA' ? 'text-rose-400' : 'text-amber-300');
    const creditoTxt = m.creditoUsd > 0 ? `+ $ ${m.creditoUsd.toFixed(2)}` : '--';
    const debitoTxt = m.debitoUsd > 0 ? `- $ ${m.debitoUsd.toFixed(2)}` : '--';
    return `
      <tr class="border-b border-slate-800/40">
        <td class="p-3 font-mono text-xs text-slate-300 whitespace-nowrap">${esc(m.fecha)}</td>
        ${incluirAfiliado ? `<td class="p-3 text-xs text-white font-semibold">${esc(m.beneficiarioNombre)}</td>` : ''}
        <td class="p-3 text-xs text-white font-semibold">${esc(m.concepto)}<div class="text-[10px] font-mono text-slate-400">${esc(m.evento)}</div></td>
        <td class="p-3 text-xs text-slate-300">${esc(m.origenOReferencia)}</td>
        <td class="p-3 text-right font-mono text-xs font-bold tabular-nums ${m.creditoUsd > 0 ? 'text-emerald-400' : 'text-slate-500'}">${creditoTxt}</td>
        <td class="p-3 text-right font-mono text-xs font-bold tabular-nums ${m.debitoUsd > 0 ? 'text-amber-300' : 'text-slate-500'}">${debitoTxt}</td>
        <td class="p-3 text-right font-mono text-xs font-bold tabular-nums text-white">$ ${m.saldoCorrido.toFixed(2)}</td>
        <td class="p-3 font-mono text-[11px] font-bold ${colEst}">${esc(m.estado)}</td>
      </tr>
    `;
  }).join('');
}

function renderizarEstadoCuentaUsuario() {
  if (!tenantActual) return;
  const desde = document.getElementById('refMovDesde')?.value || '';
  const hasta = document.getElementById('refMovHasta')?.value || '';
  const tipo = document.getElementById('refMovTipo')?.value || 'TODOS';
  const estado = construirEstadoCuentaReferido({ beneficiarioId: tenantActual.id, desde, hasta, tipo });
  renderizarResumenYTablaEstadoCuenta(estado, 'refEstadoCuentaResumenStrip', 'tablaMovimientosReferidoUsuario', false);
}

function renderizarEstadoCuentaMaster() {
  const beneficiarioId = document.getElementById('masterRefFiltroBeneficiario')?.value || '';
  const desde = document.getElementById('masterRefMovDesde')?.value || '';
  const hasta = document.getElementById('masterRefMovHasta')?.value || '';
  const tipo = document.getElementById('masterRefMovTipo')?.value || 'TODOS';
  const estado = construirEstadoCuentaReferido({ beneficiarioId: beneficiarioId || null, desde, hasta, tipo });
  renderizarResumenYTablaEstadoCuenta(estado, 'masterRefEstadoCuentaResumenStrip', 'tablaMasterEstadoCuentaReferido', true);
}

function imprimirEstadoCuentaUsuario() {
  if (!tenantActual) return;
  const desde = document.getElementById('refMovDesde')?.value || '';
  const hasta = document.getElementById('refMovHasta')?.value || '';
  const tipo = document.getElementById('refMovTipo')?.value || 'TODOS';
  generarPdfEstadoCuentaReferido({ beneficiarioId: tenantActual.id, desde, hasta, tipo });
}

function imprimirEstadoCuentaMaster() {
  const beneficiarioId = document.getElementById('masterRefFiltroBeneficiario')?.value || '';
  const desde = document.getElementById('masterRefMovDesde')?.value || '';
  const hasta = document.getElementById('masterRefMovHasta')?.value || '';
  const tipo = document.getElementById('masterRefMovTipo')?.value || 'TODOS';
  generarPdfEstadoCuentaReferido({ beneficiarioId: beneficiarioId || null, desde, hasta, tipo });
}

function exportarEstadoCuentaUsuarioExcel() {
  if (!tenantActual) return;
  const desde = document.getElementById('refMovDesde')?.value || '';
  const hasta = document.getElementById('refMovHasta')?.value || '';
  const tipo = document.getElementById('refMovTipo')?.value || 'TODOS';
  exportarEstadoCuentaReferidoExcel({ beneficiarioId: tenantActual.id, desde, hasta, tipo });
}

function exportarEstadoCuentaMasterExcel() {
  const beneficiarioId = document.getElementById('masterRefFiltroBeneficiario')?.value || '';
  const desde = document.getElementById('masterRefMovDesde')?.value || '';
  const hasta = document.getElementById('masterRefMovHasta')?.value || '';
  const tipo = document.getElementById('masterRefMovTipo')?.value || 'TODOS';
  exportarEstadoCuentaReferidoExcel({ beneficiarioId: beneficiarioId || null, desde, hasta, tipo });
}

function generarPdfEstadoCuentaReferido({ beneficiarioId = null, desde = '', hasta = '', tipo = 'TODOS' } = {}) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    avisarRef('La librería jsPDF no está disponible.', 'error');
    return null;
  }

  const estado = construirEstadoCuentaReferido({ beneficiarioId, desde, hasta, tipo });
  const tasa = typeof obtenerTasaBcvVigenteSaas === 'function' ? obtenerTasaBcvVigenteSaas() : 1;
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 12;
  const usableW = pageW - margin * 2;

  const benef = estado.beneficiario;
  const esConsolidado = !benef;
  const nombreTitular = esConsolidado ? 'REPORTE CONSOLIDADO DE TODOS LOS AFILIADOS' : (benef.razon_social || benef.email || 'Afiliado');
  const codRef = benef ? obtenerCodigoReferidoTenant(benef) : 'TODOS';
  const tier = benef ? calcularTierPromotor(benef.id, saasTenantsCache) : null;
  const rangoTexto = `${desde || 'Inicio'} al ${hasta || 'Hoy'} · Tipo: ${tipo}`;
  const fechaEmision = new Date().toISOString().slice(0, 10);

  const drawHeader = (pageNum) => {
    pdf.setFillColor(15, 23, 42);
    pdf.rect(margin, 10, usableW, 18, 'F');
    pdf.setFillColor(16, 185, 129);
    pdf.rect(margin, 10, 3, 18, 'F');

    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.text('MiFacturaDigital.com.ve — ESTADO DE CUENTA DE REFERIDOS', margin + 6, 17.5);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(203, 213, 225);
    pdf.text(`Emisión: ${fechaEmision} | Período: ${rangoTexto} | Tasa Ref. BCV: ${Number(tasa).toFixed(2)} Bs./$ | Pág. ${pageNum}`, margin + 6, 23.5);

    let y = 32;
    if (pageNum === 1) {
      pdf.setDrawColor(203, 213, 225);
      pdf.setFillColor(248, 250, 252);
      pdf.rect(margin, y, usableW, 20, 'FD');

      pdf.setTextColor(15, 23, 42);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9.5);
      pdf.text(`Afiliado: ${String(nombreTitular).slice(0, 65)}`, margin + 3, y + 6);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(51, 65, 85);
      if (benef) {
        const tipoAfil = esPromotorExterno(benef) ? 'Promotor / Contador Externo' : 'Comercio ERP Activo';
        const cobro = benef.datos_cobro_comision?.destino
          ? `${benef.datos_cobro_comision.metodo || ''} (${benef.datos_cobro_comision.destino})`
          : 'Sin datos de cobro predeterminados';
        pdf.text(`Cédula/RIF: ${benef.rif || 'N/A'} | Código: ${codRef} | Tipo: ${tipoAfil} | Rango: ${tier?.nombre || 'Bronce'}`, margin + 3, y + 11.5);
        pdf.text(`Correo: ${benef.email || '--'} | Cobro Preferido: ${String(cobro).slice(0, 58)}`, margin + 3, y + 16.5);
      } else {
        pdf.text(`Resumen multi-afiliado de comisiones acreditadas, bonos manuales, retiros y canjes aplicados.`, margin + 3, y + 12.5);
      }
      y += 24;

      // 4 cajas KPI
      const boxW = (usableW - 6) / 4;
      const kpis = [
        { lbl: 'SALDO INICIAL', val: `$ ${estado.saldoInicial.toFixed(2)}` },
        { lbl: 'CRÉDITOS (+)', val: `+ $ ${estado.totalCreditos.toFixed(2)}` },
        { lbl: 'DÉBITOS / PAGOS (-)', val: `- $ ${estado.totalDebitos.toFixed(2)}` },
        { lbl: 'SALDO DISPONIBLE', val: `$ ${estado.saldoActualDisponible.toFixed(2)}` }
      ];
      kpis.forEach((k, idx) => {
        const bx = margin + idx * (boxW + 2);
        pdf.setFillColor(idx === 3 ? 236 : 248, idx === 3 ? 253 : 250, idx === 3 ? 245 : 252);
        pdf.setDrawColor(idx === 3 ? 16 : 203, idx === 3 ? 185 : 213, idx === 3 ? 129 : 225);
        pdf.rect(bx, y, boxW, 13, 'FD');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(6.5);
        pdf.setTextColor(71, 85, 105);
        pdf.text(k.lbl, bx + 2.5, y + 4.5);
        pdf.setFont('courier', 'bold');
        pdf.setFontSize(9.5);
        pdf.setTextColor(idx === 3 ? 4 : 15, idx === 3 ? 120 : 23, idx === 3 ? 87 : 42);
        pdf.text(k.val, bx + 2.5, y + 10.5);
      });
      y += 17;
    }

    // Cabecera tabla
    pdf.setFillColor(15, 23, 42);
    pdf.rect(margin, y, usableW, 7, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.2);
    pdf.text('Fecha', margin + 2, y + 4.8);
    pdf.text('Concepto / Evento', margin + 22, y + 4.8);
    pdf.text(esConsolidado ? 'Afiliado / Origen / Ref.' : 'Origen / Referencia', margin + 72, y + 4.8);
    pdf.text('Crédito +$', margin + 141, y + 4.8, { align: 'right' });
    pdf.text('Débito -$', margin + 163, y + 4.8, { align: 'right' });
    pdf.text('Saldo $', margin + 184, y + 4.8, { align: 'right' });
    pdf.text('Est.', pageW - margin - 1.5, y + 4.8, { align: 'right' });
    return y + 9;
  };

  let pageNum = 1;
  let y = drawHeader(pageNum);

  if (estado.movimientos.length === 0) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(100, 116, 139);
    pdf.text('Sin movimientos registrados en el rango de fechas seleccionado.', margin + 2, y + 6);
    y += 12;
  } else {
    estado.movimientos.forEach(m => {
      if (y > pageH - 26) {
        pdf.addPage();
        pageNum += 1;
        y = drawHeader(pageNum);
      }

      pdf.setTextColor(15, 23, 42);
      pdf.setFont('courier', 'normal');
      pdf.setFontSize(7.2);
      pdf.text(m.fecha, margin + 2, y + 3.5);

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7.2);
      pdf.text(String(m.concepto || '').slice(0, 31), margin + 22, y + 3.5);

      pdf.setFont('helvetica', 'normal');
      const det = esConsolidado
        ? `${m.beneficiarioNombre} · ${m.origenOReferencia}`
        : m.origenOReferencia;
      pdf.text(String(det || '--').slice(0, 36), margin + 72, y + 3.5);

      pdf.setFont('courier', 'bold');
      pdf.setTextColor(m.creditoUsd > 0 ? 4 : 148, m.creditoUsd > 0 ? 120 : 163, m.creditoUsd > 0 ? 87 : 184);
      pdf.text(m.creditoUsd > 0 ? `+${m.creditoUsd.toFixed(2)}` : '--', margin + 141, y + 3.5, { align: 'right' });

      pdf.setTextColor(m.debitoUsd > 0 ? 180 : 148, m.debitoUsd > 0 ? 83 : 163, m.debitoUsd > 0 ? 9 : 184);
      pdf.text(m.debitoUsd > 0 ? `-${m.debitoUsd.toFixed(2)}` : '--', margin + 163, y + 3.5, { align: 'right' });

      pdf.setTextColor(15, 23, 42);
      pdf.text(`${m.saldoCorrido.toFixed(2)}`, margin + 184, y + 3.5, { align: 'right' });

      pdf.setFont('courier', 'normal');
      pdf.setFontSize(6.2);
      pdf.text(String(m.estado || '').slice(0, 6), pageW - margin - 1.5, y + 3.5, { align: 'right' });

      pdf.setDrawColor(226, 232, 240);
      pdf.line(margin, y + 5.5, pageW - margin, y + 5.5);
      y += 6.2;
    });
  }

  if (y > pageH - 32) {
    pdf.addPage();
    pageNum += 1;
    y = drawHeader(pageNum);
  }

  y += 4;
  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(203, 213, 225);
  pdf.rect(margin, y, usableW, 14, 'FD');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.setTextColor(15, 23, 42);
  pdf.text(`Resumen Histórico Acumulado · Total Ganado: $ ${estado.totalGanadoHistorico.toFixed(2)} | Total Liquidado/Canjeado: $ ${estado.totalPagadoHistorico.toFixed(2)} | Saldo Disponible: $ ${estado.saldoActualDisponible.toFixed(2)} (Bs. ${(estado.saldoActualDisponible * tasa).toFixed(2)})`, margin + 3, y + 5.5);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(71, 85, 105);
  pdf.text(`Saldo al cierre del período consultado: $ ${estado.saldoCierrePeriodo.toFixed(2)} USD · Pendiente por aprobar/pagar: $ ${estado.pendientePorPagar.toFixed(2)} USD`, margin + 3, y + 10.5);

  y += 26;
  pdf.setDrawColor(148, 163, 184);
  pdf.line(margin + 10, y, margin + 78, y);
  pdf.line(pageW - margin - 78, y, pageW - margin - 10, y);
  pdf.setFontSize(7.5);
  pdf.text('Administración Master · MiFacturaDigital.com.ve', margin + 12, y + 4.5);
  pdf.text(`Conforme: ${String(nombreTitular).slice(0, 32)}`, pageW - margin - 76, y + 4.5);

  const safeSlug = String(codRef).replace(/[^A-Z0-9_-]/gi, '_');
  const nombreArchivo = `Estado_Cuenta_Referidos_${safeSlug}_${fechaEmision}.pdf`;
  if (typeof abrirVisorImpresionPdf === 'function') {
    abrirVisorImpresionPdf(pdf, nombreArchivo, `Estado de Cuenta · ${nombreTitular}`);
  } else {
    pdf.save(nombreArchivo);
  }
  return pdf;
}

function exportarEstadoCuentaReferidoExcel({ beneficiarioId = null, desde = '', hasta = '', tipo = 'TODOS' } = {}) {
  if (typeof XLSX === 'undefined') {
    avisarRef('La librería XLSX no está disponible.', 'error');
    return;
  }
  const estado = construirEstadoCuentaReferido({ beneficiarioId, desde, hasta, tipo });
  const benef = estado.beneficiario;
  const codRef = benef ? obtenerCodigoReferidoTenant(benef) : 'CONSOLIDADO';

  const filas = [
    ['MiFacturaDigital.com.ve — ESTADO DE CUENTA DE REFERIDOS'],
    ['Afiliado', benef ? (benef.razon_social || benef.email) : 'TODOS LOS AFILIADOS'],
    ['Código Referido', codRef, 'Período', `${desde || 'Inicio'} al ${hasta || 'Hoy'}`],
    ['Saldo Inicial ($)', estado.saldoInicial, 'Créditos Rango ($)', estado.totalCreditos, 'Débitos Rango ($)', estado.totalDebitos, 'Saldo Disponible ($)', estado.saldoActualDisponible],
    [],
    ['Fecha', 'Afiliado', 'Concepto', 'Evento', 'Origen / Referencia', 'Crédito (+$)', 'Débito (-$)', 'Saldo ($)', 'Estado']
  ];

  estado.movimientos.forEach(m => {
    filas.push([
      m.fecha,
      m.beneficiarioNombre,
      m.concepto,
      m.evento,
      m.origenOReferencia,
      m.creditoUsd,
      m.debitoUsd,
      m.saldoCorrido,
      m.estado
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'EstadoCuenta');
  const safeSlug = String(codRef).replace(/[^A-Z0-9_-]/gi, '_');
  XLSX.writeFile(wb, `Estado_Cuenta_Referidos_${safeSlug}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  avisarRef('Estado de cuenta exportado en Excel (.xlsx).', 'success');
}

document.addEventListener('DOMContentLoaded', () => {
  capturarReferidoDeUrl();
  setTimeout(() => { cargarConfigReferidosMaster(); }, 300);
});
