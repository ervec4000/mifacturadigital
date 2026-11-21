-- ============================================================================
-- MiFacturaDigital.com.ve - Migración Enterprise v120:
-- 1. CxC Avanzado (Recibos de Abono, Historial Cronológico y Conciliación)
-- 2. Cuentas por Pagar (CxP a Proveedores) y Conciliación Bancaria / POS
-- 3. Retenciones IVA SENIAT (Campos completos para archivo TXT oficial)
-- 4. Configuración de Arqueo Ciego de Caja y Protocolo Impresora Fiscal VE
--
-- Ejecutar en Supabase SQL Editor (PostgreSQL) — Solo Usuario Master
-- Script 100% idempotente: seguro para ejecutar múltiples veces.
-- ============================================================================

-- 1. EXTENSIÓN DE ABONOS CXC (RECIBOS, MONEDA, REFERENCIA Y CONCILIACIÓN)
ALTER TABLE IF EXISTS public.abonos_cxc
  ADD COLUMN IF NOT EXISTS recibo_nro TEXT,
  ADD COLUMN IF NOT EXISTS moneda TEXT DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS monto_bs NUMERIC(16,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referencia TEXT,
  ADD COLUMN IF NOT EXISTS notas TEXT,
  ADD COLUMN IF NOT EXISTS conciliado BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS fecha_conciliacion TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS conciliado_por TEXT,
  ADD COLUMN IF NOT EXISTS banco_conciliacion TEXT,
  ADD COLUMN IF NOT EXISTS turno_caja_id UUID;

CREATE INDEX IF NOT EXISTS idx_abonos_cxc_fecha ON public.abonos_cxc (tenant_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_abonos_cxc_conciliado ON public.abonos_cxc (tenant_id, conciliado);

-- 2. EXTENSIÓN DE COMPRAS PARA CUENTAS POR PAGAR (CXP)
ALTER TABLE IF EXISTS public.compras_documentos
  ADD COLUMN IF NOT EXISTS condicion_pago TEXT DEFAULT 'CONTADO',
  ADD COLUMN IF NOT EXISTS dias_credito INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE,
  ADD COLUMN IF NOT EXISTS metodo_pago TEXT DEFAULT 'TRANSFERENCIA',
  ADD COLUMN IF NOT EXISTS saldo_pendiente_usd NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estado_pago TEXT DEFAULT 'PAGADA',
  ADD COLUMN IF NOT EXISTS conciliado BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_compras_docs_cxp ON public.compras_documentos (tenant_id, condicion_pago, estado_pago);

-- 3. TABLA NATIVA DE ABONOS / PAGOS A PROVEEDORES (CXP)
CREATE TABLE IF NOT EXISTS public.abonos_cxp (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  compra_id UUID NOT NULL,
  doc_nro TEXT,
  nro_factura TEXT,
  proveedor_id UUID,
  proveedor_nombre TEXT,
  recibo_nro TEXT,
  moneda TEXT DEFAULT 'USD',
  monto_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  monto_bs NUMERIC(16,2) DEFAULT 0,
  tasa_bcv NUMERIC(16,4) DEFAULT 1,
  metodo_pago TEXT DEFAULT 'TRANSFERENCIA',
  referencia TEXT,
  notas TEXT,
  conciliado BOOLEAN DEFAULT false,
  fecha_conciliacion TIMESTAMPTZ,
  conciliado_por TEXT,
  usuario_id UUID,
  usuario_nombre TEXT,
  fecha TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_abonos_cxp_tenant ON public.abonos_cxp (tenant_id, compra_id, fecha DESC);

-- 4. CONCILIACIONES BANCARIAS Y LOTES DE PUNTOS DE VENTA
CREATE TABLE IF NOT EXISTS public.conciliaciones_bancarias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  origen_tipo TEXT NOT NULL CHECK (origen_tipo IN ('VENTA_POS', 'ABONO_CXC', 'PAGO_CXP', 'CAJA_TURNO')),
  origen_id TEXT NOT NULL,
  documento_ref TEXT,
  canal_pago TEXT NOT NULL,
  referencia_banco TEXT,
  banco_destino TEXT,
  moneda TEXT DEFAULT 'VES',
  monto_usd NUMERIC(14,2) DEFAULT 0,
  monto_bs NUMERIC(16,2) DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'CONCILIADO' CHECK (estado IN ('PENDIENTE', 'CONCILIADO', 'OBSERVADO')),
  fecha_operacion DATE,
  fecha_conciliacion TIMESTAMPTZ DEFAULT now(),
  conciliado_por TEXT,
  observaciones TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_conciliacion_origen ON public.conciliaciones_bancarias (tenant_id, origen_tipo, origen_id);
CREATE INDEX IF NOT EXISTS idx_conciliaciones_tenant_fecha ON public.conciliaciones_bancarias (tenant_id, fecha_conciliacion DESC);

-- 5. RETENCIONES IVA SENIAT & CONFIGURACIÓN CAJA CIEGA / IMPRESORA FISCAL
ALTER TABLE IF EXISTS public.retenciones_iva
  ADD COLUMN IF NOT EXISTS proveedor_rif TEXT,
  ADD COLUMN IF NOT EXISTS proveedor_nombre TEXT,
  ADD COLUMN IF NOT EXISTS nro_control_factura TEXT,
  ADD COLUMN IF NOT EXISTS monto_exento_bs NUMERIC(16,2) DEFAULT 0;

ALTER TABLE IF EXISTS public.tenants
  ADD COLUMN IF NOT EXISTS caja_arqueo_ciego BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS protocolo_fiscal TEXT DEFAULT 'GENERICO_ESCPOS';

-- 6. SEGURIDAD RLS MULTITENANT PARA NUEVAS TABLAS
DO $$
DECLARE
  v_tbl TEXT;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY['abonos_cxp', 'conciliaciones_bancarias']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tbl);
    EXECUTE format('DROP POLICY IF EXISTS mfd_iso_select_%I ON public.%I', v_tbl, v_tbl);
    EXECUTE format('DROP POLICY IF EXISTS mfd_iso_insert_%I ON public.%I', v_tbl, v_tbl);
    EXECUTE format('DROP POLICY IF EXISTS mfd_iso_update_%I ON public.%I', v_tbl, v_tbl);
    EXECUTE format('DROP POLICY IF EXISTS mfd_iso_delete_%I ON public.%I', v_tbl, v_tbl);

    EXECUTE format(
      'CREATE POLICY mfd_iso_select_%I ON public.%I FOR SELECT USING (public.mfd_es_master() OR tenant_id = public.mfd_tenant_id() OR public.mfd_tenant_id() IS NULL)',
      v_tbl, v_tbl
    );
    EXECUTE format(
      'CREATE POLICY mfd_iso_insert_%I ON public.%I FOR INSERT WITH CHECK (public.mfd_es_master() OR tenant_id = public.mfd_tenant_id() OR public.mfd_tenant_id() IS NULL)',
      v_tbl, v_tbl
    );
    EXECUTE format(
      'CREATE POLICY mfd_iso_update_%I ON public.%I FOR UPDATE USING (public.mfd_es_master() OR tenant_id = public.mfd_tenant_id() OR public.mfd_tenant_id() IS NULL)',
      v_tbl, v_tbl
    );
    EXECUTE format(
      'CREATE POLICY mfd_iso_delete_%I ON public.%I FOR DELETE USING (public.mfd_es_master() OR tenant_id = public.mfd_tenant_id() OR public.mfd_tenant_id() IS NULL)',
      v_tbl, v_tbl
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.abonos_cxp TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conciliaciones_bancarias TO anon, authenticated;

-- 7. VERIFICADOR DE ESQUEMA v120 PARA PANEL MASTER
CREATE OR REPLACE FUNCTION public.mfd_estado_esquema_v120()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'ok', true,
    'abonos_cxp', to_regclass('public.abonos_cxp') IS NOT NULL,
    'conciliaciones_bancarias', to_regclass('public.conciliaciones_bancarias') IS NOT NULL,
    'abonos_cxc_conciliado', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'abonos_cxc' AND column_name = 'conciliado'
    ),
    'compras_condicion_pago', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'compras_documentos' AND column_name = 'condicion_pago'
    ),
    'tenants_arqueo_ciego', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'caja_arqueo_ciego'
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.mfd_estado_esquema_v120() TO anon, authenticated;
