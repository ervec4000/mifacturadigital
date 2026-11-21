-- ============================================================================
-- MiFacturaDigital.com.ve - Migración para Integración Contable (VEN-NIF / SENIAT)
-- Ejecutar en Supabase SQL Editor (PostgreSQL)
-- Script 100% idempotente: puede ejecutarse múltiples veces sin afectar datos.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. EMPRESA / INQUILINO (tenants): parámetros fiscales y cuentas contables por defecto
ALTER TABLE IF EXISTS public.tenants
  ADD COLUMN IF NOT EXISTS moneda_funcional TEXT DEFAULT 'VES',
  ADD COLUMN IF NOT EXISTS ejercicio_fiscal_inicio TEXT DEFAULT '01-01',
  ADD COLUMN IF NOT EXISTS regimen_iva TEXT DEFAULT 'ORDINARIO',
  ADD COLUMN IF NOT EXISTS agente_retencion_iva BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS porcentaje_retencion_iva NUMERIC(5,2) DEFAULT 75.00,
  ADD COLUMN IF NOT EXISTS cta_cxc_clientes TEXT DEFAULT '1.1.02.01',
  ADD COLUMN IF NOT EXISTS cta_cxp_proveedores TEXT DEFAULT '2.1.01.01',
  ADD COLUMN IF NOT EXISTS cta_iva_debito TEXT DEFAULT '2.1.04.01',
  ADD COLUMN IF NOT EXISTS cta_iva_credito TEXT DEFAULT '1.1.05.01',
  ADD COLUMN IF NOT EXISTS cta_igtf_percibido TEXT DEFAULT '2.1.04.05',
  ADD COLUMN IF NOT EXISTS cta_retenciones_iva_por_pagar TEXT DEFAULT '2.1.04.06',
  ADD COLUMN IF NOT EXISTS cta_ventas_gravadas TEXT DEFAULT '4.1.01.01',
  ADD COLUMN IF NOT EXISTS cta_ventas_exentas TEXT DEFAULT '4.1.01.02',
  ADD COLUMN IF NOT EXISTS cta_devoluciones_ventas TEXT DEFAULT '4.1.02.01',
  ADD COLUMN IF NOT EXISTS cta_inventario TEXT DEFAULT '1.1.04.01',
  ADD COLUMN IF NOT EXISTS cta_costo_ventas TEXT DEFAULT '5.1.01.01',
  ADD COLUMN IF NOT EXISTS cta_diferencial_cambiario TEXT DEFAULT '7.1.01.01',
  ADD COLUMN IF NOT EXISTS contabilidad_auto_asientos BOOLEAN DEFAULT true;

-- 2. ARTÍCULOS / SERVICIOS (productos): mapeo contable completo (Inventario, Ingreso, Costo, Devolución, CC)
ALTER TABLE IF EXISTS public.productos
  ADD COLUMN IF NOT EXISTS codigo_barras TEXT,
  ADD COLUMN IF NOT EXISTS cuenta_contable TEXT,
  ADD COLUMN IF NOT EXISTS cuenta_ingreso TEXT DEFAULT '4.1.01.01',
  ADD COLUMN IF NOT EXISTS cuenta_costo TEXT DEFAULT '5.1.01.01',
  ADD COLUMN IF NOT EXISTS cuenta_devolucion TEXT DEFAULT '4.1.02.01',
  ADD COLUMN IF NOT EXISTS centro_costo_default TEXT;

-- 3. CLIENTES: cuenta auxiliar CxC, anticipos, condiciones y límite de crédito
ALTER TABLE IF EXISTS public.clientes
  ADD COLUMN IF NOT EXISTS cuenta_contable TEXT DEFAULT '1.1.02.01',
  ADD COLUMN IF NOT EXISTS cuenta_anticipos TEXT DEFAULT '2.1.03.01',
  ADD COLUMN IF NOT EXISTS condicion_credito_dias INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS limite_credito_usd NUMERIC(14,2) DEFAULT 0;

-- 4. PROVEEDORES: cuenta auxiliar CxP, tipo persona ISLR/IVA, % retención IVA y días de crédito
ALTER TABLE IF EXISTS public.proveedores
  ADD COLUMN IF NOT EXISTS cuenta_contable TEXT DEFAULT '2.1.01.01',
  ADD COLUMN IF NOT EXISTS cuenta_anticipos TEXT DEFAULT '1.1.06.01',
  ADD COLUMN IF NOT EXISTS tipo_persona TEXT DEFAULT 'PJD',
  ADD COLUMN IF NOT EXISTS retencion_iva_pct NUMERIC(5,2) DEFAULT 75.00,
  ADD COLUMN IF NOT EXISTS condicion_credito_dias INTEGER DEFAULT 0;

-- 5. SUCURSALES Y ALMACENES: centros de costo y cuentas de inventario por depósito
ALTER TABLE IF EXISTS public.sucursales
  ADD COLUMN IF NOT EXISTS codigo_contable TEXT,
  ADD COLUMN IF NOT EXISTS centro_costo TEXT;

ALTER TABLE IF EXISTS public.almacenes
  ADD COLUMN IF NOT EXISTS cuenta_inventario TEXT,
  ADD COLUMN IF NOT EXISTS centro_costo TEXT;

-- 6. TIPOS DE IVA (ALÍCUOTAS): código SENIAT y cuentas de Débito / Crédito Fiscal
ALTER TABLE IF EXISTS public.tipos_iva
  ADD COLUMN IF NOT EXISTS codigo_seniat TEXT DEFAULT 'G',
  ADD COLUMN IF NOT EXISTS cuenta_debito_fiscal TEXT DEFAULT '2.1.04.01',
  ADD COLUMN IF NOT EXISTS cuenta_credito_fiscal TEXT DEFAULT '1.1.05.01';

-- 7. VÍAS DE PAGO (TESORERÍA / BANCOS): moneda de la cuenta, indicador IGTF y código bancario
ALTER TABLE IF EXISTS public.vias_pago
  ADD COLUMN IF NOT EXISTS cuenta_contable TEXT DEFAULT '1.1.01.01',
  ADD COLUMN IF NOT EXISTS tipo_moneda TEXT DEFAULT 'VES',
  ADD COLUMN IF NOT EXISTS es_divisa_igtf BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS codigo_banco TEXT;

-- 8. DOCUMENTOS FISCALES (invoices): campos contables, vencimiento, bases, costo y vínculo de asiento
ALTER TABLE IF EXISTS public.invoices
  ADD COLUMN IF NOT EXISTS tipo_documento TEXT DEFAULT 'FACTURA',
  ADD COLUMN IF NOT EXISTS modalidad_nota TEXT,
  ADD COLUMN IF NOT EXISTS documento_afectado_nro TEXT,
  ADD COLUMN IF NOT EXISTS sucursal_id UUID,
  ADD COLUMN IF NOT EXISTS almacen_id UUID,
  ADD COLUMN IF NOT EXISTS centro_costo TEXT,
  ADD COLUMN IF NOT EXISTS moneda TEXT DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS condicion_pago TEXT DEFAULT 'CONTADO',
  ADD COLUMN IF NOT EXISTS fecha_emision DATE,
  ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE,
  ADD COLUMN IF NOT EXISTS exento_bs NUMERIC(16,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_imponible_bs NUMERIC(16,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_igtf_bs NUMERIC(16,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS costo_total_usd NUMERIC(16,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS costo_total_bs NUMERIC(16,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS periodo_contable TEXT,
  ADD COLUMN IF NOT EXISTS contabilizado BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS asiento_contable_id UUID;

-- 9. DETALLE DE DOCUMENTOS (invoice_items): alícuota, IVA, costo unitario y cuentas por línea
ALTER TABLE IF EXISTS public.invoice_items
  ADD COLUMN IF NOT EXISTS alicuota_iva NUMERIC(5,2) DEFAULT 16,
  ADD COLUMN IF NOT EXISTS iva_usd NUMERIC(16,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS iva_bs NUMERIC(16,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS costo_unitario_usd NUMERIC(16,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cuenta_ingreso TEXT,
  ADD COLUMN IF NOT EXISTS cuenta_costo TEXT,
  ADD COLUMN IF NOT EXISTS centro_costo TEXT;

-- 10. KARDEX DE INVENTARIO (kardex_movimientos): almacén, lote, valorización y contrapartida contable
ALTER TABLE IF EXISTS public.kardex_movimientos
  ADD COLUMN IF NOT EXISTS sucursal_id UUID,
  ADD COLUMN IF NOT EXISTS almacen_id UUID,
  ADD COLUMN IF NOT EXISTS lote TEXT,
  ADD COLUMN IF NOT EXISTS costo_total_usd NUMERIC(16,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS costo_total_bs NUMERIC(16,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cuenta_inventario TEXT,
  ADD COLUMN IF NOT EXISTS cuenta_contrapartida TEXT,
  ADD COLUMN IF NOT EXISTS centro_costo TEXT,
  ADD COLUMN IF NOT EXISTS periodo_contable TEXT;

-- 11. RETENCIONES IVA / ISLR (retenciones_iva): tipo, sujeto, período impositivo y cuenta contable
ALTER TABLE IF EXISTS public.retenciones_iva
  ADD COLUMN IF NOT EXISTS tipo_retencion TEXT DEFAULT 'IVA_COMPRAS',
  ADD COLUMN IF NOT EXISTS sujeto_rif TEXT,
  ADD COLUMN IF NOT EXISTS sujeto_nombre TEXT,
  ADD COLUMN IF NOT EXISTS periodo_impositivo TEXT,
  ADD COLUMN IF NOT EXISTS fecha_comprobante DATE,
  ADD COLUMN IF NOT EXISTS nro_control_factura TEXT,
  ADD COLUMN IF NOT EXISTS cuenta_contable TEXT DEFAULT '2.1.04.06',
  ADD COLUMN IF NOT EXISTS contabilizado BOOLEAN DEFAULT false;

-- 12. TABLA NUEVA: PLAN DE CUENTAS CONTABLES (VEN-NIF)
CREATE TABLE IF NOT EXISTS public.plan_cuentas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  codigo TEXT NOT NULL,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('ACTIVO','PASIVO','PATRIMONIO','INGRESO','COSTO','GASTO','ORDEN')),
  naturaleza TEXT NOT NULL CHECK (naturaleza IN ('DEUDORA','ACREEDORA')),
  nivel INTEGER NOT NULL DEFAULT 4,
  cuenta_padre TEXT,
  acepta_movimiento BOOLEAN DEFAULT true,
  activa BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, codigo)
);

CREATE INDEX IF NOT EXISTS idx_plan_cuentas_tenant ON public.plan_cuentas(tenant_id, codigo);

-- 13. TABLA NUEVA: CABECERA DE ASIENTOS CONTABLES (LIBRO DIARIO)
CREATE TABLE IF NOT EXISTS public.asientos_contables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  numero_comprobante TEXT NOT NULL,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  periodo_contable TEXT NOT NULL,
  origen_modulo TEXT NOT NULL DEFAULT 'MANUAL',
  documento_origen_id TEXT,
  documento_ref TEXT,
  descripcion TEXT NOT NULL,
  moneda TEXT DEFAULT 'VES',
  tasa_bcv NUMERIC(16,4) DEFAULT 1,
  total_debe_bs NUMERIC(16,2) DEFAULT 0,
  total_haber_bs NUMERIC(16,2) DEFAULT 0,
  total_debe_usd NUMERIC(16,4) DEFAULT 0,
  total_haber_usd NUMERIC(16,4) DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'CONTABILIZADO',
  exportado_erp BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asientos_tenant_fecha ON public.asientos_contables(tenant_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_asientos_periodo ON public.asientos_contables(tenant_id, periodo_contable);

-- 14. TABLA NUEVA: LÍNEAS / PARTIDA DOBLE DE ASIENTOS CONTABLES
CREATE TABLE IF NOT EXISTS public.asientos_detalle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asiento_id UUID NOT NULL REFERENCES public.asientos_contables(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  linea INTEGER NOT NULL DEFAULT 1,
  cuenta_codigo TEXT NOT NULL,
  cuenta_nombre TEXT NOT NULL,
  centro_costo TEXT,
  tercero_rif TEXT,
  tercero_nombre TEXT,
  descripcion TEXT,
  debe_bs NUMERIC(16,2) DEFAULT 0,
  haber_bs NUMERIC(16,2) DEFAULT 0,
  debe_usd NUMERIC(16,4) DEFAULT 0,
  haber_usd NUMERIC(16,4) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asientos_det_asiento ON public.asientos_detalle(asiento_id);
CREATE INDEX IF NOT EXISTS idx_asientos_det_cuenta ON public.asientos_detalle(tenant_id, cuenta_codigo);

-- 15. POLÍTICAS RLS PARA LAS NUEVAS TABLAS CONTABLES
ALTER TABLE public.plan_cuentas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asientos_contables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asientos_detalle ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Acceso multi-tenant plan_cuentas" ON public.plan_cuentas;
CREATE POLICY "Acceso multi-tenant plan_cuentas" ON public.plan_cuentas
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso multi-tenant asientos_contables" ON public.asientos_contables;
CREATE POLICY "Acceso multi-tenant asientos_contables" ON public.asientos_contables
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso multi-tenant asientos_detalle" ON public.asientos_detalle;
CREATE POLICY "Acceso multi-tenant asientos_detalle" ON public.asientos_detalle
  FOR ALL USING (true) WITH CHECK (true);
