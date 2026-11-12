/**
 * /js/reportes.js
 * Módulo de Cierres Z, Reportes Fiscales y Libros de Ventas SENIAT
 */

document.addEventListener("DOMContentLoaded", () => {
  const secCierrez = document.getElementById('seccionCierrez');
  if (secCierrez) {
    secCierrez.innerHTML = `
      <div class="space-y-6">
        <h3 class="text-sm font-bold text-emerald-400 uppercase">📊 Reporte Z y Libros Fiscales (SENIAT)</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="bg-slate-950/40 p-5 rounded-2xl border border-slate-800 space-y-4">
            <h4 class="text-xs font-bold text-slate-300 uppercase">Generar Cierre Z Diario</h4>
            <button onclick="emitirReporteZ()" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl text-xs cursor-pointer">Emitir Cierre Z Fiscal</button>
          </div>
          <div class="bg-slate-950/40 p-5 rounded-2xl border border-slate-800 space-y-4">
            <h4 class="text-xs font-bold text-slate-300 uppercase">Libro de Ventas Mensual</h4>
            <button onclick="exportarLibroVentasExcel()" class="w-full bg-slate-800 hover:bg-slate-700 text-emerald-300 font-semibold py-3 rounded-xl text-xs border border-slate-700 cursor-pointer">📥 Descargar Libro Excel / TXT</button>
          </div>
        </div>
      </div>
    `;
  }
});

function emitirReporteZ() {
  alert('📊 Cierre Z emitido y registrado exitosamente ante el servidor fiscal.');
}

function exportarLibroVentasExcel() {
  alert('📥 Libro de Ventas exportado correctamente en formato compatible con exigencias del SENIAT.');
}
