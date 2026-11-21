/**
 * /js/escaner.js
 * Motor Universal de Lectura de Códigos de Barras (EAN-13, EAN-8, UPC, Code-128, Code-39) y QR
 * Compatible con:
 * - Pistolas Lectoras USB / Bluetooth (Keyboard Wedge + Enter + atajo F2)
 * - Cámara Web / Teléfono en vivo (Html5Qrcode + BarcodeDetector nativo)
 * - Carga de imagen de código de barras/QR desde archivo
 * - Etiquetas QR internas de MiFacturaDigital (SKU:...|LOTE:...|BAR:...)
 */

let escanerDestinoActual = 'pos';
let escanerHtml5Instance = null;
let escanerActivo = false;
let escanerUltimoTexto = '';
let escanerUltimoTs = 0;
let escanerAudioCtx = null;

function avisarEscaner(mensaje, tipo = 'info', duracion = 4500) {
  if (typeof notificarSistema === 'function') {
    notificarSistema(mensaje, tipo, duracion);
  } else {
    console.log(`[ESCANER:${tipo}]`, mensaje);
  }
}

function reproducirBeepEscaner(tipo = 'ok') {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!escanerAudioCtx) escanerAudioCtx = new AudioCtx();
    if (escanerAudioCtx.state === 'suspended') {
      escanerAudioCtx.resume().catch(() => {});
    }

    const tocarTono = (freq, startOffset, duration, gainVal = 0.12) => {
      const osc = escanerAudioCtx.createOscillator();
      const gain = escanerAudioCtx.createGain();
      osc.type = tipo === 'ok' ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq, escanerAudioCtx.currentTime + startOffset);
      gain.gain.setValueAtTime(gainVal, escanerAudioCtx.currentTime + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.001, escanerAudioCtx.currentTime + startOffset + duration);
      osc.connect(gain);
      gain.connect(escanerAudioCtx.destination);
      osc.start(escanerAudioCtx.currentTime + startOffset);
      osc.stop(escanerAudioCtx.currentTime + startOffset + duration + 0.01);
    };

    if (tipo === 'ok') {
      tocarTono(1046.5, 0, 0.09, 0.12);
    } else {
      tocarTono(260, 0, 0.1, 0.14);
      tocarTono(200, 0.12, 0.14, 0.14);
    }
  } catch (e) {
    // Silencioso si el navegador restringe audio
  }
}

function normalizarCodigoComparacion(val) {
  return String(val || '').trim().toUpperCase();
}

function extraerCodigoDeEscaneo(rawText) {
  const raw = String(rawText || '').trim();
  const res = {
    raw,
    codigo: raw,
    sku: '',
    barcode: '',
    lote: ''
  };
  if (!raw) return res;

  // 1. Formato QR interno MiFacturaDigital: SKU:...|DESC:...|LOTE:...|UBI:...|PV:$...|BAR:...
  if (/SKU:/i.test(raw) && raw.includes('|')) {
    const partes = raw.split('|');
    partes.forEach(p => {
      const idx = p.indexOf(':');
      if (idx === -1) return;
      const k = p.slice(0, idx).trim().toUpperCase();
      const v = p.slice(idx + 1).trim();
      if (k === 'SKU' && v && v !== 'S/N') res.sku = v;
      if ((k === 'BAR' || k === 'BARRAS' || k === 'EAN') && v) res.barcode = v;
      if (k === 'LOTE' && v && v !== 'SIN-LOTE') res.lote = v;
    });
    res.codigo = res.barcode || res.sku || raw;
    return res;
  }

  // 2. Formato JSON
  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const obj = JSON.parse(raw);
      res.sku = String(obj.sku || obj.codigo_sku || '').trim();
      res.barcode = String(obj.codigo_barras || obj.barcode || obj.ean || obj.codigo || '').trim();
      res.lote = String(obj.lote || obj.numero_lote || '').trim();
      res.codigo = res.barcode || res.sku || raw;
      return res;
    } catch (e) {}
  }

  // 3. Formato URL con parámetros (?sku=..., ?code=..., ?barcode=...)
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const qBar = u.searchParams.get('barcode') || u.searchParams.get('ean') || u.searchParams.get('code') || '';
      const qSku = u.searchParams.get('sku') || '';
      const qLote = u.searchParams.get('lote') || '';
      if (qBar || qSku) {
        res.barcode = qBar.trim();
        res.sku = qSku.trim();
        res.lote = qLote.trim();
        res.codigo = res.barcode || res.sku || raw;
        return res;
      }
    } catch (e) {}
  }

  return res;
}

function equivalentesBarcode(a, b) {
  const ca = normalizarCodigoComparacion(a);
  const cb = normalizarCodigoComparacion(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  // Equivalencia EAN-13 vs UPC-A (cero inicial)
  const sinCeroA = ca.replace(/^0+/, '');
  const sinCeroB = cb.replace(/^0+/, '');
  return sinCeroA.length >= 6 && sinCeroA === sinCeroB;
}

function buscarProductoPorCodigoEscaneado(productosList = [], rawInput = '') {
  const parsed = extraerCodigoDeEscaneo(rawInput);
  const candidatos = [];
  if (parsed.barcode) candidatos.push(parsed.barcode);
  if (parsed.sku) candidatos.push(parsed.sku);
  if (parsed.codigo && !candidatos.includes(parsed.codigo)) candidatos.push(parsed.codigo);
  if (parsed.raw && !candidatos.includes(parsed.raw)) candidatos.push(parsed.raw);

  const lista = Array.isArray(productosList) ? productosList : [];
  if (!lista.length || candidatos.length === 0) {
    return { producto: null, parsed };
  }

  // 1. Coincidencia exacta por Código de Barras
  for (const cand of candidatos) {
    const matchBar = lista.find(p => p.codigo_barras && equivalentesBarcode(p.codigo_barras, cand));
    if (matchBar) return { producto: matchBar, parsed };
  }

  // 2. Coincidencia exacta por SKU
  for (const cand of candidatos) {
    const cNorm = normalizarCodigoComparacion(cand);
    const matchSku = lista.find(p => p.codigo_sku && normalizarCodigoComparacion(p.codigo_sku) === cNorm);
    if (matchSku) return { producto: matchSku, parsed };
  }

  // 3. Coincidencia por ID o Descripción exacta
  const rawNorm = normalizarCodigoComparacion(parsed.codigo);
  const matchExactoDesc = lista.find(p =>
    String(p.id) === parsed.codigo ||
    normalizarCodigoComparacion(p.descripcion) === rawNorm
  );
  if (matchExactoDesc) return { producto: matchExactoDesc, parsed };

  // 4. Coincidencia parcial única si el usuario escribió >= 4 caracteres de búsqueda
  if (rawNorm.length >= 4) {
    const parciales = lista.filter(p =>
      normalizarCodigoComparacion(p.codigo_barras).includes(rawNorm) ||
      normalizarCodigoComparacion(p.codigo_sku).includes(rawNorm) ||
      normalizarCodigoComparacion(p.descripcion).includes(rawNorm)
    );
    if (parciales.length === 1) {
      return { producto: parciales[0], parsed };
    }
  }

  return { producto: null, parsed };
}

function generarCodigoBarrasEan13() {
  // Prefijo 759 (GS1 Venezuela) + 9 dígitos pseudoaleatorios únicos + dígito verificador EAN-13
  const base9 = String(Date.now()).slice(-6) + String(Math.floor(100 + Math.random() * 900));
  const primeros12 = '759' + base9.slice(0, 9);

  let suma = 0;
  for (let i = 0; i < 12; i++) {
    const digito = parseInt(primeros12[i], 10);
    suma += (i % 2 === 0) ? digito : digito * 3;
  }
  const checkDigit = (10 - (suma % 10)) % 10;
  const ean13 = primeros12 + String(checkDigit);

  const input = document.getElementById('prodCodigoBarras');
  if (input) {
    input.value = ean13;
    input.focus();
    input.select();
  }
  reproducirBeepEscaner('ok');
  avisarEscaner(`Código EAN-13 generado: ${ean13}`, 'success', 3500);
  return ean13;
}

function enfocarEscanerPos() {
  const inp = document.getElementById('posBarcodeInput');
  if (inp) {
    inp.focus();
    inp.select();
  }
}

function irACrearMaterialConCodigo(codigo = '') {
  const parsed = extraerCodigoDeEscaneo(codigo);
  const bar = parsed.barcode || parsed.codigo || '';
  if (typeof cambiarPestana === 'function') {
    cambiarPestana('productos');
  }
  setTimeout(() => {
    if (typeof limpiarFormProducto === 'function') limpiarFormProducto();
    const inpBar = document.getElementById('prodCodigoBarras');
    if (inpBar && bar) inpBar.value = bar;
    const inpDesc = document.getElementById('prodDescripcion');
    if (inpDesc) inpDesc.focus();
  }, 180);
}

function despacharCodigoEscaneado(rawText, destino = escanerDestinoActual) {
  const texto = String(rawText || '').trim();
  if (!texto) return;

  const badge = document.getElementById('escanerUltimoResultado');
  if (badge) badge.textContent = `Último código leído: ${texto}`;

  switch (destino) {
    case 'pos':
      if (typeof procesarCodigoBarrasPos === 'function') {
        procesarCodigoBarrasPos(texto);
      }
      break;
    case 'producto': {
      const parsed = extraerCodigoDeEscaneo(texto);
      const valorFinal = parsed.barcode || parsed.codigo || texto;
      const inp = document.getElementById('prodCodigoBarras');
      if (inp) {
        inp.value = valorFinal;
        inp.focus();
      }
      reproducirBeepEscaner('ok');
      avisarEscaner(`Código de barras capturado: ${valorFinal}`, 'success', 3500);
      break;
    }
    case 'catalogo': {
      const parsed = extraerCodigoDeEscaneo(texto);
      const q = parsed.barcode || parsed.sku || parsed.codigo || texto;
      const inp = document.getElementById('filtroProductosGestion');
      if (inp) {
        inp.value = q;
        if (typeof filtrarProductosGestion === 'function') filtrarProductosGestion();
      }
      reproducirBeepEscaner('ok');
      break;
    }
    case 'compra':
      if (typeof procesarCodigoBarrasCompra === 'function') {
        procesarCodigoBarrasCompra(texto);
      }
      break;
    case 'fisico':
      if (typeof procesarCodigoBarrasFisico === 'function') {
        procesarCodigoBarrasFisico(texto);
      }
      break;
    case 'transferencia':
      if (typeof procesarCodigoBarrasTransferencia === 'function') {
        procesarCodigoBarrasTransferencia(texto);
      }
      break;
    case 'etiquetas': {
      const parsed = extraerCodigoDeEscaneo(texto);
      const q = parsed.barcode || parsed.sku || parsed.codigo || texto;
      const inp = document.getElementById('filtroEtiquetasQr');
      if (inp) {
        inp.value = q;
        if (typeof filtrarEtiquetasQr === 'function') filtrarEtiquetasQr();
      }
      reproducirBeepEscaner('ok');
      break;
    }
    case 'notaNd':
      if (typeof procesarCodigoBarrasNotaNd === 'function') {
        procesarCodigoBarrasNotaNd(texto);
      }
      break;
    default:
      avisarEscaner(`Código leído: ${texto}`, 'info');
  }
}

async function abrirEscanerCamara(destino = 'pos', opciones = {}) {
  escanerDestinoActual = destino || 'pos';
  escanerUltimoTexto = '';
  escanerUltimoTs = 0;

  const modal = document.getElementById('modalEscanerCamara');
  if (!modal) return;

  const subtituloMap = {
    pos: 'Facturación POS: escanea productos para sumarlos al carrito automáticamente.',
    producto: 'Maestro de Artículos: captura el código de barras o QR para asignarlo al material.',
    catalogo: 'Búsqueda en Catálogo: escanea un artículo para ubicarlo y editarlo.',
    compra: 'Registro de Compras: escanea un material para seleccionarlo en la factura de compra.',
    fisico: 'Inventario Físico: cada lectura suma al conteo físico y recalcula diferencias.',
    transferencia: 'Transferencias: escanea el material o etiqueta QR para seleccionar producto y lote.',
    etiquetas: 'Etiquetas QR: escanea para filtrar e imprimir la etiqueta del artículo.',
    notaNd: 'Notas de Débito: escanea el material adicional a incorporar en la nota.'
  };

  const lblDesc = document.getElementById('escanerModalSubtitulo');
  if (lblDesc) lblDesc.textContent = subtituloMap[escanerDestinoActual] || 'Apunta la cámara al código de barras o QR.';

  const chkCont = document.getElementById('escanerModoContinuo');
  if (chkCont) {
    if (typeof opciones.continuo === 'boolean') {
      chkCont.checked = opciones.continuo;
    } else {
      chkCont.checked = (escanerDestinoActual === 'pos' || escanerDestinoActual === 'fisico');
    }
  }

  const resEl = document.getElementById('escanerUltimoResultado');
  if (resEl) resEl.textContent = 'Apunta el código de barras o QR frente a la cámara...';

  modal.classList.remove('hidden');
  await iniciarFlujoCamaraEscaner();
}

async function iniciarFlujoCamaraEscaner(camaraIdForzada = '') {
  const estadoEl = document.getElementById('escanerEstadoCamara');
  const selCam = document.getElementById('escanerCamaraSelect');

  if (typeof Html5Qrcode !== 'function') {
    if (estadoEl) estadoEl.textContent = 'La librería óptica no cargó. Usa lector USB o "Subir imagen de código".';
    return;
  }

  await detenerFlujoCamaraEscaner();

  try {
    if (estadoEl) estadoEl.textContent = 'Detectando cámaras disponibles...';
    const cameras = await Html5Qrcode.getCameras();
    if (!cameras || cameras.length === 0) {
      if (estadoEl) estadoEl.textContent = 'No se detectó cámara activa. Puedes subir una imagen del código o usar pistola USB.';
      return;
    }

    if (selCam) {
      const prev = camaraIdForzada || selCam.value;
      selCam.innerHTML = '';
      cameras.forEach((cam, idx) => {
        const label = cam.label || `Cámara ${idx + 1}`;
        selCam.innerHTML += `<option value="${esc(cam.id)}">${esc(label)}</option>`;
      });
      if (prev && cameras.some(c => c.id === prev)) {
        selCam.value = prev;
      } else {
        const trasera = cameras.find(c => /back|rear|trasera|environment/i.test(c.label || ''));
        selCam.value = (trasera || cameras[0]).id;
      }
    }

    const camId = camaraIdForzada || selCam?.value || cameras[0].id;
    const formatsToSupport = (typeof Html5QrcodeSupportedFormats !== 'undefined')
      ? [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.ITF,
          Html5QrcodeSupportedFormats.CODABAR,
          Html5QrcodeSupportedFormats.DATA_MATRIX
        ]
      : undefined;

    escanerHtml5Instance = new Html5Qrcode('escanerCamaraReader', {
      formatsToSupport,
      verbose: false
    });

    await escanerHtml5Instance.start(
      camId,
      {
        fps: 12,
        qrbox: (viewfinderWidth, viewfinderHeight) => {
          const w = Math.max(180, Math.min(340, Math.floor(viewfinderWidth * 0.82)));
          const h = Math.max(120, Math.min(220, Math.floor(viewfinderHeight * 0.58)));
          return { width: w, height: h };
        },
        aspectRatio: 1.5,
        experimentalFeatures: { useBarCodeDetectorIfSupported: true }
      },
      (decodedText) => {
        const ahora = Date.now();
        if (decodedText === escanerUltimoTexto && (ahora - escanerUltimoTs) < 1400) {
          return;
        }
        escanerUltimoTexto = decodedText;
        escanerUltimoTs = ahora;

        despacharCodigoEscaneado(decodedText, escanerDestinoActual);

        const continuo = Boolean(document.getElementById('escanerModoContinuo')?.checked);
        if (!continuo) {
          cerrarEscanerCamara();
        }
      },
      () => {}
    );

    escanerActivo = true;
    if (estadoEl) estadoEl.textContent = 'Cámara activa. Centra el código de barras o QR dentro del recuadro.';
  } catch (err) {
    console.warn('No se pudo iniciar cámara escáner:', err);
    if (estadoEl) {
      estadoEl.textContent = 'No se obtuvo permiso de cámara o no está disponible. Usa pistola USB o sube una imagen del código.';
    }
  }
}

async function cambiarCamaraEscaner() {
  const camId = document.getElementById('escanerCamaraSelect')?.value || '';
  if (camId) {
    await iniciarFlujoCamaraEscaner(camId);
  }
}

async function detenerFlujoCamaraEscaner() {
  if (escanerHtml5Instance) {
    try {
      if (escanerActivo) {
        await escanerHtml5Instance.stop();
      }
      await escanerHtml5Instance.clear();
    } catch (e) {}
  }
  escanerHtml5Instance = null;
  escanerActivo = false;
  const readerEl = document.getElementById('escanerCamaraReader');
  if (readerEl) readerEl.innerHTML = '';
}

async function cerrarEscanerCamara() {
  await detenerFlujoCamaraEscaner();
  const modal = document.getElementById('modalEscanerCamara');
  if (modal) modal.classList.add('hidden');
}

async function decodificarArchivoCodigo(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;
  const estadoEl = document.getElementById('escanerEstadoCamara');

  try {
    if (typeof Html5Qrcode !== 'function') {
      avisarEscaner('Librería de decodificación óptica no disponible.', 'error');
      return;
    }
    await detenerFlujoCamaraEscaner();
    const scannerFile = new Html5Qrcode('escanerCamaraReader', { verbose: false });
    if (estadoEl) estadoEl.textContent = 'Analizando imagen...';
    const decodedText = await scannerFile.scanFile(file, true);
    try { await scannerFile.clear(); } catch (e) {}
    despacharCodigoEscaneado(decodedText, escanerDestinoActual);
    await cerrarEscanerCamara();
  } catch (err) {
    if (estadoEl) estadoEl.textContent = 'No se detectó ningún código de barras o QR legible en esa imagen.';
    reproducirBeepEscaner('error');
    avisarEscaner('No se pudo leer un código de barras o QR en la imagen seleccionada.', 'warning');
  } finally {
    if (event?.target) event.target.value = '';
  }
}

// Atajo F2 estilo Valery para enfocar el lector de código de barras en POS
document.addEventListener('keydown', (e) => {
  if (e.key === 'F2') {
    const secPos = document.getElementById('seccionPos');
    if (secPos && !secPos.classList.contains('hidden')) {
      e.preventDefault();
      enfocarEscanerPos();
    }
  }
});
