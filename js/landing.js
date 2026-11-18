/**
 * /js/landing.js
 * Módulo de Landing Page Comercial Enterprise 2026 - MiFacturaDigital.com.ve
 * Incluye: Hero Section, Bento Grid de Módulos SENIAT, Captura de Leads, FAQ e Integración WhatsApp.
 * (Excluye calculadora de planes a solicitud).
 */

document.addEventListener('DOMContentLoaded', () => {
  renderizarLandingPage();
});

function renderizarLandingPage() {
  const contenedor = document.getElementById('vistaLanding') || document.getElementById('app');
  if (!contenedor) return;

  contenedor.innerHTML = `
    <!-- HEADER / NAVBAR -->
    <header class="sticky top-0 z-50 backdrop-blur-md bg-slate-950/80 border-b border-slate-800/80 px-4 lg:px-8 py-4 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-300 flex items-center justify-center font-black text-slate-950 text-xl shadow-lg shadow-emerald-500/20">
          MF
        </div>
        <div>
          <span class="text-lg font-bold text-white tracking-tight">MiFacturaDigital<span class="text-emerald-400">.com.ve</span></span>
          <span class="block text-[10px] text-slate-400 font-mono tracking-widest uppercase">Sistema Fiscal SENIAT 2026</span>
        </div>
      </div>

      <nav class="hidden md:flex items-center space-x-8 text-sm font-medium text-slate-300">
        <a href="#caracteristicas" class="hover:text-emerald-400 transition-colors">Funcionalidades</a>
        <a href="#modulos" class="hover:text-emerald-400 transition-colors">Módulos Fiscales</a>
        <a href="#faq" class="hover:text-emerald-400 transition-colors">Preguntas Frecuentes</a>
      </nav>

      <div class="flex items-center space-x-3">
        <button onclick="abrirModalDemo()" class="hidden sm:inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold text-emerald-400 bg-emerald-950/50 border border-emerald-500/30 hover:bg-emerald-900/40 transition-all">
          Solicitar Demo
        </button>
        <button onclick="mostrarVistaLogin()" class="px-5 py-2 rounded-lg text-sm font-semibold text-slate-950 bg-gradient-to-r from-emerald-400 to-teal-300 hover:from-emerald-300 hover:to-teal-200 transition-all shadow-md shadow-emerald-500/20">
          Iniciar Sesión
        </button>
      </div>
    </header>

    <!-- HERO SECTION -->
    <section class="relative overflow-hidden pt-12 pb-20 px-4 lg:px-8 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-center">
      <div class="max-w-5xl mx-auto">
        <div class="inline-flex items-center space-x-2 px-3 py-1.5 rounded-full bg-emerald-950/60 border border-emerald-500/30 text-emerald-300 text-xs font-semibold mb-6">
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span>Plataforma Adaptada a Providencias SENIAT 2026</span>
        </div>
        
        <h1 class="text-4xl sm:text-6xl font-black text-white tracking-tight leading-tight mb-6">
          Facturación Digital, Punto de Venta y Control Fiscal en la Nube
        </h1>
        
        <p class="text-lg sm:text-xl text-slate-300 max-w-3xl mx-auto mb-10 leading-relaxed">
          Diseñado para comercios, licorerías, supermercados y distribuidores en Venezuela. Emisión instantánea de comprobantes, inventario Kardex PPM, Libros de Compras/Ventas y retenciones IVA en una sola plataforma.
        </p>

        <div class="flex flex-col sm:flex-row items-center justify-center gap-4 max-w-md mx-auto mb-16">
          <button onclick="abrirModalDemo()" class="w-full sm:w-auto px-8 py-4 rounded-xl text-base font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 transition-all shadow-xl shadow-emerald-500/25">
            Probar Demostración Gratis
          </button>
          <a href="#modulos" class="w-full sm:w-auto px-8 py-4 rounded-xl text-base font-semibold text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 transition-all">
            Explorar Módulos
          </a>
        </div>

        <!-- MOCKUP / DASHBOARD PREVIEW -->
        <div class="relative mx-auto max-w-4xl rounded-2xl border border-slate-800 bg-slate-900/90 shadow-2xl overflow-hidden">
          <div class="px-4 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
            <div class="flex space-x-2">
              <div class="w-3 h-3 rounded-full bg-rose-500"></div>
              <div class="w-3 h-3 rounded-full bg-amber-500"></div>
              <div class="w-3 h-3 rounded-full bg-emerald-500"></div>
            </div>
            <span class="text-xs font-mono text-slate-400">mifacturadigital.com.ve/pos</span>
            <span class="text-xs font-mono text-emerald-400">● SENIAT ONLINE</span>
          </div>
          <div class="p-6 grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
            <div class="bg-slate-950 p-4 rounded-xl border border-slate-800">
              <span class="text-xs text-slate-400">Tasa BCV Oficial</span>
              <p class="text-2xl font-bold text-emerald-400 font-mono mt-1">Sincronizada API</p>
            </div>
            <div class="bg-slate-950 p-4 rounded-xl border border-slate-800">
              <span class="text-xs text-slate-400">Comprobantes Emitidos</span>
              <p class="text-2xl font-bold text-white font-mono mt-1">Facturas / NC / ND</p>
            </div>
            <div class="bg-slate-950 p-4 rounded-xl border border-slate-800">
              <span class="text-xs text-slate-400">Control de Caja</span>
              <p class="text-2xl font-bold text-amber-300 font-mono mt-1">Multidivisa & IGTF</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- BENTO GRID: MÓDULOS FISCALES -->
    <section id="modulos" class="py-20 px-4 lg:px-8 bg-slate-950 border-t border-slate-800/60">
      <div class="max-w-6xl mx-auto">
        <div class="text-center mb-16">
          <h2 class="text-3xl sm:text-4xl font-bold text-white mb-4">Todo lo que tu Negocio Necesita</h2>
          <p class="text-slate-400 max-w-2xl mx-auto">Cumplimiento fiscal estricto y herramientas de punto de venta diseñadas para la realidad del comercio venezolano.</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <!-- Tarjeta 1 -->
          <div class="p-6 rounded-2xl bg-slate-900 border border-slate-800 hover:border-emerald-500/50 transition-all">
            <div class="w-12 h-12 rounded-xl bg-emerald-950 text-emerald-400 flex items-center justify-center text-2xl mb-4">🛒</div>
            <h3 class="text-xl font-bold text-white mb-2">Punto de Venta POS</h3>
            <p class="text-slate-400 text-sm">Escáner de código de barras, lectura de cámara, cálculo automático de IVA (16%), exentos e IGTF 3%. Impresión fiscal en impresoras WebSerial.</p>
          </div>

          <!-- Tarjeta 2 -->
          <div class="p-6 rounded-2xl bg-slate-900 border border-slate-800 hover:border-emerald-500/50 transition-all">
            <div class="w-12 h-12 rounded-xl bg-sky-950 text-sky-400 flex items-center justify-center text-2xl mb-4">📊</div>
            <h3 class="text-xl font-bold text-white mb-2">Libros Fiscales en Excel</h3>
            <p class="text-slate-400 text-sm">Generación automática del Libro de Ventas y Libro de Compras con el formato oficial del SENIAT, exportables en XLS en un solo clic.</p>
          </div>

          <!-- Tarjeta 3 -->
          <div class="p-6 rounded-2xl bg-slate-900 border border-slate-800 hover:border-emerald-500/50 transition-all">
            <div class="w-12 h-12 rounded-xl bg-amber-950 text-amber-400 flex items-center justify-center text-2xl mb-4">🏭</div>
            <h3 class="text-xl font-bold text-white mb-2">Retenciones de IVA</h3>
            <p class="text-slate-400 text-sm">Emisión de Comprobantes de Retención de IVA (75% / 100%) para Contribuyentes Especiales, vinculados a facturas de proveedores.</p>
          </div>

          <!-- Tarjeta 4 -->
          <div class="p-6 rounded-2xl bg-slate-900 border border-slate-800 hover:border-emerald-500/50 transition-all">
            <div class="w-12 h-12 rounded-xl bg-purple-950 text-purple-400 flex items-center justify-center text-2xl mb-4">📦</div>
            <h3 class="text-xl font-bold text-white mb-2">Kardex PPM & Lotes</h3>
            <p class="text-slate-400 text-sm">Control de inventario por Precio Promedio Ponderado, trazabilidad de lotes, fecha de vencimiento y tomas físicas de almacén.</p>
          </div>

          <!-- Tarjeta 5 -->
          <div class="p-6 rounded-2xl bg-slate-900 border border-slate-800 hover:border-emerald-500/50 transition-all">
            <div class="w-12 h-12 rounded-xl bg-teal-950 text-teal-400 flex items-center justify-center text-2xl mb-4">🏬</div>
            <h3 class="text-xl font-bold text-white mb-2">Multi-Sucursal & Depósitos</h3>
            <p class="text-slate-400 text-sm">Administración multi-sede con aislamiento de datos, control de usuarios con roles y asignación de existencias por depósito.</p>
          </div>

          <!-- Tarjeta 6 -->
          <div class="p-6 rounded-2xl bg-slate-900 border border-slate-800 hover:border-emerald-500/50 transition-all">
            <div class="w-12 h-12 rounded-xl bg-rose-950 text-rose-400 flex items-center justify-center text-2xl mb-4">💵</div>
            <h3 class="text-xl font-bold text-white mb-2">Caja Multidivisa</h3>
            <p class="text-slate-400 text-sm">Calculadora de vuelto exacto en bolívares y divisas, conversión en tiempo real con tasa BCV e historial de cierres de caja (Reporte Z).</p>
          </div>
        </div>
      </div>
    </section>

    <!-- FORMULARIO DE CAPTURA DE LEADS -->
    <section id="contacto" class="py-20 px-4 lg:px-8 bg-slate-900 border-t border-slate-800">
      <div class="max-w-3xl mx-auto bg-slate-950 p-8 sm:p-12 rounded-3xl border border-slate-800 shadow-2xl">
        <div class="text-center mb-8">
          <h2 class="text-3xl font-bold text-white mb-2">Solicita una Demostración Personalizada</h2>
          <p class="text-slate-400 text-sm">Déjanos tus datos y un especialista fiscal se pondrá en contacto para configurar tu sistema.</p>
        </div>

        <form onsubmit="procesarSolicitudDemo(event)" class="space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Nombre o Razón Social</label>
              <input type="text" id="leadNombre" required placeholder="Ej: Comercial El Sol C.A." class="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500">
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">RIF de la Empresa</label>
              <input type="text" id="leadRif" required placeholder="Ej: J-12345678-0" class="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500">
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Teléfono / WhatsApp</label>
              <input type="tel" id="leadTelefono" required placeholder="0414-1234567" class="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500">
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-300 mb-1">Correo Electrónico</label>
              <input type="email" id="leadEmail" required placeholder="contacto@empresa.com" class="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500">
            </div>
          </div>

          <button type="submit" class="w-full py-4 rounded-xl text-base font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 transition-all shadow-lg shadow-emerald-500/20 mt-4">
            Enviar Solicitud de Registro
          </button>
        </form>
      </div>
    </section>

    <!-- FAQ SECTION -->
    <section id="faq" class="py-20 px-4 lg:px-8 bg-slate-950 border-t border-slate-800">
      <div class="max-w-4xl mx-auto">
        <h2 class="text-3xl font-bold text-white text-center mb-12">Preguntas Frecuentes</h2>
        
        <div class="space-y-4">
          <details class="bg-slate-900 p-6 rounded-2xl border border-slate-800 group">
            <summary class="font-bold text-white cursor-pointer flex justify-between items-center">
              <span>¿El sistema cumple con las normativas del SENIAT?</span>
              <span class="text-emerald-400 group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <p class="text-slate-400 text-sm mt-3 leading-relaxed">Sí, MiFacturaDigital.com.ve está diseñado alineado con la providencia administrativa del SENIAT, incluyendo control de numeración, tasa BCV, desglose de IVA (16%), exentos e IGTF (3%).</p>
          </details>

          <details class="bg-slate-900 p-6 rounded-2xl border border-slate-800 group">
            <summary class="font-bold text-white cursor-pointer flex justify-between items-center">
              <span>¿Se puede conectar una impresora fiscal o térmica?</span>
              <span class="text-emerald-400 group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <p class="text-slate-400 text-sm mt-3 leading-relaxed">Sí, el sistema soporta impresoras fiscales a través de integración WebSerial API y permite la impresión de comandes de 80mm/58mm directamente desde el navegador.</p>
          </details>

          <details class="bg-slate-900 p-6 rounded-2xl border border-slate-800 group">
            <summary class="font-bold text-white cursor-pointer flex justify-between items-center">
              <span>¿Cómo funciona el soporte multi-moneda?</span>
              <span class="text-emerald-400 group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <p class="text-slate-400 text-sm mt-3 leading-relaxed">El sistema consulta automáticamente la tasa oficial del Banco Central de Venezuela (BCV) cada día y permite emitir presupuestos o facturar reflejando el monto en bolívares y divisas.</p>
          </details>
        </div>
      </div>
    </section>

    <!-- FOOTER -->
    <footer class="py-8 px-4 bg-slate-950 border-t border-slate-800 text-center text-xs text-slate-500">
      <p>© 2026 MiFacturaDigital.com.ve — Sistema Fiscal Integrado SENIAT Enterprise. Todos los derechos reservados.</p>
    </footer>
  `;
}

function mostrarVistaLogin() {
  const landing = document.getElementById('vistaLanding');
  const login = document.getElementById('vistaLogin');
  if (landing) landing.classList.add('hidden');
  if (login) login.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function mostrarVistaLanding() {
  const landing = document.getElementById('vistaLanding');
  const login = document.getElementById('vistaLogin');
  if (login) login.classList.add('hidden');
  if (landing) landing.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function abrirModalDemo() {
  const elContacto = document.getElementById('contacto');
  if (elContacto) elContacto.scrollIntoView({ behavior: 'smooth' });
}

function abrirModalRegistroDemo() {
  mostrarVistaLanding();
  setTimeout(abrirModalDemo, 100);
}

function procesarSolicitudDemo(event) {
  event.preventDefault();
  const nombre = document.getElementById('leadNombre').value;
  alert(`¡Gracias ${nombre}! Tu solicitud ha sido registrada con éxito. Un asesor te contactará.`);
  event.target.reset();
}
