-- ============================================================================
-- MiFacturaDigital.com.ve - Migración SaaS: Suscripciones, Permisos, Pagos y Referidos Híbridos (3 Niveles)
-- Ejecutar en Supabase SQL Editor (PostgreSQL) — Solo Usuario Master
-- Script 100% idempotente: puede ejecutarse múltiples veces sin afectar datos.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. EXTENSIÓN DE TABLA TENANTS PARA SUSCRIPCIONES, MENÚS Y RED DE REFERIDOS (3 NIVELES)
ALTER TABLE IF EXISTS public.tenants
  ADD COLUMN IF NOT EXISTS ciclo_facturacion TEXT DEFAULT 'MENSUAL',
  ADD COLUMN IF NOT EXISTS fecha_vencimiento_plan DATE,
  ADD COLUMN IF NOT EXISTS estado_suscripcion TEXT DEFAULT 'ACTIVA',
  ADD COLUMN IF NOT EXISTS modulos_permitidos JSONB,
  ADD COLUMN IF NOT EXISTS codigo_referido TEXT,
  ADD COLUMN IF NOT EXISTS referido_por_id UUID,
  ADD COLUMN IF NOT EXISTS referido_nivel2_id UUID,
  ADD COLUMN IF NOT EXISTS referido_nivel3_id UUID,
  ADD COLUMN IF NOT EXISTS es_promotor_externo BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS datos_cobro_comision JSONB DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_codigo_referido_uniq
  ON public.tenants(codigo_referido)
  WHERE codigo_referido IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tenants_referido_por ON public.tenants(referido_por_id);

-- 2. TABLA DE REPORTES Y HISTORIAL DE PAGOS SAAS (TRANSFERENCIAS / PAGO MÓVIL / TARJETA)
CREATE TABLE IF NOT EXISTS public.saas_pagos_suscripcion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  tenant_nombre TEXT,
  tenant_rif TEXT,
  plan_solicitado TEXT NOT NULL,
  ciclo TEXT NOT NULL DEFAULT 'MENSUAL' CHECK (ciclo IN ('MENSUAL', 'ANUAL')),
  metodo_pago TEXT NOT NULL DEFAULT 'TRANSFERENCIA',
  banco_origen TEXT,
  referencia TEXT NOT NULL,
  monto_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  monto_bs NUMERIC(16,2) NOT NULL DEFAULT 0,
  tasa_bcv NUMERIC(16,4) NOT NULL DEFAULT 1,
  fecha_pago DATE NOT NULL DEFAULT CURRENT_DATE,
  nota TEXT,
  estado TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'APROBADO', 'RECHAZADO')),
  motivo_rechazo TEXT,
  revisado_por TEXT,
  revisado_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saas_pagos_tenant ON public.saas_pagos_suscripcion(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saas_pagos_estado ON public.saas_pagos_suscripcion(estado, created_at DESC);

-- 3. CONFIGURACIÓN GLOBAL DEL MASTER (CUENTAS BANCARIAS, PRECIOS DE PLANES Y REGLAS DE REFERIDOS)
CREATE TABLE IF NOT EXISTS public.saas_config_pagos (
  clave TEXT PRIMARY KEY,
  valor_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. LIBRO MAYOR DE COMISIONES DE REFERIDOS (3 NIVELES + BONOS + CANJES)
CREATE TABLE IF NOT EXISTS public.saas_comisiones_referidos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pago_id TEXT,
  beneficiario_id UUID NOT NULL,
  beneficiario_nombre TEXT,
  referido_origen_id UUID NOT NULL,
  referido_origen_nombre TEXT,
  nivel INTEGER NOT NULL CHECK (nivel IN (1, 2, 3)),
  tipo_evento TEXT NOT NULL DEFAULT 'RECURRENTE',
  porcentaje NUMERIC(6,2) NOT NULL DEFAULT 0,
  monto_base_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  monto_comision_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'ACREDITADA',
  nota TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saas_comisiones_benef ON public.saas_comisiones_referidos(beneficiario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saas_comisiones_pago ON public.saas_comisiones_referidos(pago_id);

-- 5. SOLICITUDES DE RETIRO / LIQUIDACIÓN DE COMISIONES
CREATE TABLE IF NOT EXISTS public.saas_retiros_referidos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  beneficiario_id UUID NOT NULL,
  beneficiario_nombre TEXT,
  beneficiario_rif TEXT,
  tipo_liquidacion TEXT NOT NULL DEFAULT 'RETIRO_EFECTIVO',
  metodo_pago TEXT,
  datos_destino TEXT,
  monto_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  monto_bs NUMERIC(16,2) NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'PAGADO', 'RECHAZADO')),
  referencia_pago TEXT,
  revisado_por TEXT,
  revisado_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saas_retiros_benef ON public.saas_retiros_referidos(beneficiario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saas_retiros_estado ON public.saas_retiros_referidos(estado, created_at DESC);

-- 6. LEADS DE LA LANDING PAGE CON ATRIBUCIÓN ?ref=
CREATE TABLE IF NOT EXISTS public.saas_leads_landing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  rif TEXT,
  telefono TEXT,
  email TEXT,
  tipo_interes TEXT DEFAULT 'COMERCIO',
  referido_por_codigo TEXT,
  referido_por_id UUID,
  estado TEXT DEFAULT 'NUEVO',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saas_leads_created ON public.saas_leads_landing(created_at DESC);

-- 7. POLÍTICAS RLS PARA LANDING PÚBLICA, CLIENTES, PROMOTORES Y MASTER
ALTER TABLE public.saas_pagos_suscripcion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_config_pagos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_comisiones_referidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_retiros_referidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_leads_landing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Acceso multi-tenant saas_pagos_suscripcion" ON public.saas_pagos_suscripcion;
CREATE POLICY "Acceso multi-tenant saas_pagos_suscripcion" ON public.saas_pagos_suscripcion
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso saas_config_pagos" ON public.saas_config_pagos;
CREATE POLICY "Acceso saas_config_pagos" ON public.saas_config_pagos
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso saas_comisiones_referidos" ON public.saas_comisiones_referidos;
CREATE POLICY "Acceso saas_comisiones_referidos" ON public.saas_comisiones_referidos
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso saas_retiros_referidos" ON public.saas_retiros_referidos;
CREATE POLICY "Acceso saas_retiros_referidos" ON public.saas_retiros_referidos
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso saas_leads_landing" ON public.saas_leads_landing;
CREATE POLICY "Acceso saas_leads_landing" ON public.saas_leads_landing
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso SaaS tenants" ON public.tenants;
CREATE POLICY "Acceso SaaS tenants" ON public.tenants
  FOR ALL USING (true) WITH CHECK (true);
