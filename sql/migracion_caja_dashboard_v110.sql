-- ============================================================================
-- MiFacturaDigital.com.ve - Migración Integral v110:
-- Módulo de Caja y Turnos (Apertura, Ingresos/Egresos, Arqueo X/Z, Cierre),
-- Pagos Mixtos Multi-Vía en POS, Vuelto Multidivisa y Soporte para Dashboard.
--
-- Ejecutar en Supabase SQL Editor (PostgreSQL) — Solo Usuario Master
-- Script 100% idempotente: seguro para ejecutar múltiples veces.
-- ============================================================================

-- 1. EXTENSIÓN DE FACTURAS (VÍNCULO A TURNO DE CAJA, VUELTO Y PAGO MIXTO)
ALTER TABLE IF EXISTS public.invoices
  ADD COLUMN IF NOT EXISTS turno_caja_id UUID,
  ADD COLUMN IF NOT EXISTS vuelto_usd NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vuelto_bs NUMERIC(16,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pago_mixto_json JSONB;

CREATE INDEX IF NOT EXISTS idx_invoices_turno_caja ON public.invoices (tenant_id, turno_caja_id);

-- 2. TURNOS Y ARQUEOS DE CAJA (APERTURA, CONTROL EN VIVO Y CIERRE Z)
CREATE TABLE IF NOT EXISTS public.cajas_turnos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  codigo_turno TEXT NOT NULL,
  caja_nombre TEXT NOT NULL DEFAULT 'Caja Principal',
  sucursal_id UUID,
  sucursal_nombre TEXT,
  usuario_id UUID,
  usuario_nombre TEXT NOT NULL,
  usuario_email TEXT,
  estado TEXT NOT NULL DEFAULT 'ABIERTA' CHECK (estado IN ('ABIERTA', 'CERRADA')),
  fecha_apertura TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_cierre TIMESTAMPTZ,
  tasa_bcv NUMERIC(16,4) NOT NULL DEFAULT 1,
  fondo_inicial_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  fondo_inicial_bs NUMERIC(16,2) NOT NULL DEFAULT 0,
  ingresos_extra_usd NUMERIC(14,2) DEFAULT 0,
  ingresos_extra_bs NUMERIC(16,2) DEFAULT 0,
  egresos_usd NUMERIC(14,2) DEFAULT 0,
  egresos_bs NUMERIC(16,2) DEFAULT 0,
  ventas_total_usd NUMERIC(14,2) DEFAULT 0,
  ventas_total_bs NUMERIC(16,2) DEFAULT 0,
  cantidad_facturas INTEGER DEFAULT 0,
  esperado_desglose_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  contado_desglose_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_esperado_usd NUMERIC(14,2) DEFAULT 0,
  total_contado_usd NUMERIC(14,2) DEFAULT 0,
  diferencia_usd NUMERIC(14,2) DEFAULT 0,
  total_esperado_bs NUMERIC(16,2) DEFAULT 0,
  total_contado_bs NUMERIC(16,2) DEFAULT 0,
  diferencia_bs NUMERIC(16,2) DEFAULT 0,
  observaciones TEXT,
  cerrado_por TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cajas_turnos_tenant ON public.cajas_turnos (tenant_id, estado, fecha_apertura DESC);

-- 3. MOVIMIENTOS DE CAJA (INGRESOS DE SENCILLO, EGRESOS / VALES, RETIROS PARCIALES)
CREATE TABLE IF NOT EXISTS public.cajas_movimientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  turno_id UUID NOT NULL REFERENCES public.cajas_turnos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('INGRESO', 'EGRESO', 'RETIRO_PARCIAL')),
  concepto TEXT NOT NULL,
  categoria TEXT DEFAULT 'OPERATIVO',
  moneda TEXT NOT NULL DEFAULT 'USD' CHECK (moneda IN ('USD', 'VES')),
  monto NUMERIC(16,2) NOT NULL DEFAULT 0,
  monto_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  monto_bs NUMERIC(16,2) NOT NULL DEFAULT 0,
  tasa_bcv NUMERIC(16,4) NOT NULL DEFAULT 1,
  referencia TEXT,
  usuario_id UUID,
  usuario_nombre TEXT,
  fecha TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cajas_movs_turno ON public.cajas_movimientos (tenant_id, turno_id, fecha DESC);

-- 4. DESGLOSE DE PAGOS POR FACTURA (SOPORTE PAGO MIXTO MULTI-VÍA)
CREATE TABLE IF NOT EXISTS public.invoice_pagos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  turno_id UUID,
  metodo_pago TEXT NOT NULL,
  moneda TEXT NOT NULL DEFAULT 'USD',
  monto_original NUMERIC(16,2) NOT NULL DEFAULT 0,
  monto_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  monto_bs NUMERIC(16,2) NOT NULL DEFAULT 0,
  referencia TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_pagos_inv ON public.invoice_pagos (tenant_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_pagos_turno ON public.invoice_pagos (tenant_id, turno_id);

-- 5. SEGURIDAD RLS MULTITENANT (COMPATIBLE CON mfd_tenant_id() / mfd_es_master() DE v100)
CREATE OR REPLACE FUNCTION public.mfd_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid,
    NULLIF(current_setting('request.jwt.claim.tenant_id', true), '')::uuid,
    (SELECT id FROM public.tenants WHERE auth_user_id = auth.uid() LIMIT 1),
    (SELECT tenant_id FROM public.tenant_usuarios WHERE auth_user_id = auth.uid() LIMIT 1)
  );
$$;

CREATE OR REPLACE FUNCTION public.mfd_es_master()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (auth.jwt() ->> 'email') = 'ervec2000@gmail.com',
    (auth.jwt() ->> 'rol') = 'master',
    EXISTS (
      SELECT 1 FROM public.tenants
      WHERE auth_user_id = auth.uid()
        AND (lower(email) = 'ervec2000@gmail.com' OR lower(COALESCE(rol, '')) = 'master')
    )
  );
$$;

DO $$
DECLARE
  v_tbl TEXT;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY['cajas_turnos', 'cajas_movimientos', 'invoice_pagos']
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cajas_turnos TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cajas_movimientos TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_pagos TO anon, authenticated;

-- 6. VERIFICADOR DE ESQUEMA v110 PARA PANEL MASTER
CREATE OR REPLACE FUNCTION public.mfd_estado_esquema_v110()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'ok', true,
    'cajas_turnos', to_regclass('public.cajas_turnos') IS NOT NULL,
    'cajas_movimientos', to_regclass('public.cajas_movimientos') IS NOT NULL,
    'invoice_pagos', to_regclass('public.invoice_pagos') IS NOT NULL,
    'invoices_turno_caja_id', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'turno_caja_id'
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.mfd_estado_esquema_v110() TO anon, authenticated;
