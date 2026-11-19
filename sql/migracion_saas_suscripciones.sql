-- ============================================================================
-- MiFacturaDigital.com.ve - Migración SaaS: Suscripciones, Permisos y Pagos
-- Ejecutar en Supabase SQL Editor (PostgreSQL) — Solo Usuario Master
-- Script 100% idempotente: puede ejecutarse múltiples veces sin afectar datos.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. EXTENSIÓN DE TABLA TENANTS PARA CONTROL DE SUSCRIPCIONES Y MENÚS
ALTER TABLE IF EXISTS public.tenants
  ADD COLUMN IF NOT EXISTS ciclo_facturacion TEXT DEFAULT 'MENSUAL',
  ADD COLUMN IF NOT EXISTS fecha_vencimiento_plan DATE,
  ADD COLUMN IF NOT EXISTS estado_suscripcion TEXT DEFAULT 'ACTIVA',
  ADD COLUMN IF NOT EXISTS modulos_permitidos JSONB;

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

-- 3. CONFIGURACIÓN DE CUENTAS RECEPTORAS DEL MASTER (BANCOS / PAGO MÓVIL / ZELLE)
CREATE TABLE IF NOT EXISTS public.saas_config_pagos (
  clave TEXT PRIMARY KEY,
  valor_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. POLÍTICAS RLS PARA ADMINISTRACIÓN MASTER Y REPORTES DE CLIENTES
ALTER TABLE public.saas_pagos_suscripcion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_config_pagos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Acceso multi-tenant saas_pagos_suscripcion" ON public.saas_pagos_suscripcion;
CREATE POLICY "Acceso multi-tenant saas_pagos_suscripcion" ON public.saas_pagos_suscripcion
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso saas_config_pagos" ON public.saas_config_pagos;
CREATE POLICY "Acceso saas_config_pagos" ON public.saas_config_pagos
  FOR ALL USING (true) WITH CHECK (true);

-- Asegurar que Master pueda actualizar planes/estados/permisos en tenants
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Acceso SaaS tenants" ON public.tenants;
CREATE POLICY "Acceso SaaS tenants" ON public.tenants
  FOR ALL USING (true) WITH CHECK (true);
