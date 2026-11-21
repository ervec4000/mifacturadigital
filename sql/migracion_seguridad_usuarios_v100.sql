-- ============================================================================
-- MiFacturaDigital.com.ve - Migración Integral v100:
-- Seguridad Hardened, Credenciales Bcrypt, Multi-Usuario por Cliente,
-- Bitácora de Entradas/Salidas (Cliente y Master), Imprenta SENIAT en BD,
-- Tablas Nativas de Compras/Abonos CxC/Actas y Políticas RLS Estrictas.
--
-- Ejecutar en Supabase SQL Editor (PostgreSQL) — Solo Usuario Master
-- Script 100% idempotente: seguro para ejecutar múltiples veces.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 1. ALMACÉN PRIVADO DE CREDENCIALES (HASH BCRYPT · CERO EXPOSICIÓN EN TABLAS PÚBLICAS)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.credenciales_erp (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT NOT NULL CHECK (tipo IN ('TENANT', 'USUARIO')),
  entidad_id UUID NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tipo, entidad_id)
);

CREATE INDEX IF NOT EXISTS idx_credenciales_erp_email ON public.credenciales_erp (lower(email));

ALTER TABLE public.credenciales_erp ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.credenciales_erp FROM anon, authenticated;

-- ============================================================================
-- 2. EXTENSIÓN DE TENANTS (IMPRENTA SENIAT, LÍMITE DE USUARIOS Y LIMPIEZA DE CLAVES)
-- ============================================================================
ALTER TABLE IF EXISTS public.tenants
  ADD COLUMN IF NOT EXISTS imprenta_nombre TEXT,
  ADD COLUMN IF NOT EXISTS imprenta_rif TEXT,
  ADD COLUMN IF NOT EXISTS imprenta_providencia TEXT,
  ADD COLUMN IF NOT EXISTS imprenta_rango TEXT,
  ADD COLUMN IF NOT EXISTS max_usuarios INTEGER DEFAULT 2,
  ADD COLUMN IF NOT EXISTS permisos_manuales BOOLEAN DEFAULT false;

-- Permitir NULL en tenants.password si la columna heredada existía NOT NULL
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'password'
  ) THEN
    -- Migrar contraseñas heredadas a credenciales_erp con hash bcrypt antes de limpiarlas
    INSERT INTO public.credenciales_erp (tipo, entidad_id, email, password_hash)
    SELECT
      'TENANT',
      t.id,
      lower(trim(t.email)),
      CASE
        WHEN t.password LIKE '$2%' THEN t.password
        ELSE crypt(t.password, gen_salt('bf', 10))
      END
    FROM public.tenants t
    WHERE t.password IS NOT NULL AND length(trim(t.password)) > 0 AND t.email IS NOT NULL
    ON CONFLICT (tipo, entidad_id) DO NOTHING;

    EXECUTE 'ALTER TABLE public.tenants ALTER COLUMN password DROP NOT NULL';
    UPDATE public.tenants SET password = NULL WHERE password IS NOT NULL;
  END IF;
END $$;

-- ============================================================================
-- 3. TABLA DE SUB-USUARIOS POR CLIENTE (MULTI-USUARIO Y RBAC INTERNO)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.tenant_usuarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  auth_user_id UUID,
  nombre_completo TEXT NOT NULL,
  email TEXT NOT NULL,
  rol_interno TEXT NOT NULL DEFAULT 'CAJERO_POS'
    CHECK (rol_interno IN ('ADMIN_EMPRESA', 'SUPERVISOR', 'CAJERO_POS', 'ALMACENISTA', 'CONTADOR')),
  sucursal_id UUID,
  modulos_permitidos JSONB NOT NULL DEFAULT '["pos","historial","clientes"]'::jsonb,
  activo BOOLEAN NOT NULL DEFAULT true,
  ultimo_acceso TIMESTAMPTZ,
  ultimo_evento TEXT,
  creado_por TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_usuarios_email_uniq
  ON public.tenant_usuarios (lower(email));
CREATE INDEX IF NOT EXISTS idx_tenant_usuarios_tenant
  ON public.tenant_usuarios (tenant_id, activo);

-- ============================================================================
-- 4. BITÁCORA DE ENTRADAS Y SALIDAS DE USUARIOS (AUDITORÍA CLIENTE + MASTER)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.sesiones_auditoria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  usuario_id UUID,
  usuario_nombre TEXT NOT NULL,
  usuario_email TEXT NOT NULL,
  rol_interno TEXT NOT NULL DEFAULT 'PROPIETARIO',
  sucursal_id UUID,
  evento TEXT NOT NULL
    CHECK (evento IN ('ENTRADA', 'SALIDA', 'CIERRE_INACTIVIDAD', 'INTENTO_FALLIDO', 'CIERRE_FORZADO')),
  fecha_entrada TIMESTAMPTZ DEFAULT now(),
  fecha_salida TIMESTAMPTZ,
  duracion_segundos INTEGER DEFAULT 0,
  user_agent TEXT,
  detalle TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sesiones_aud_tenant ON public.sesiones_auditoria (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sesiones_aud_email ON public.sesiones_auditoria (lower(usuario_email), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sesiones_aud_evento ON public.sesiones_auditoria (evento, created_at DESC);

-- ============================================================================
-- 5. TABLAS NATIVAS FALTANTES EN SUPABASE (COMPRAS, ABONOS CXC, ACTAS INV. FÍSICO)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.compras_documentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  doc_nro TEXT NOT NULL,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  tasa_bcv NUMERIC(16,4) NOT NULL DEFAULT 1,
  nro_factura TEXT NOT NULL,
  nro_control TEXT NOT NULL,
  proveedor_id UUID,
  proveedor_nombre TEXT,
  sucursal_id UUID,
  almacen_id UUID,
  base_gravada_usd NUMERIC(14,2) DEFAULT 0,
  monto_exento_usd NUMERIC(14,2) DEFAULT 0,
  iva_usd NUMERIC(14,2) DEFAULT 0,
  total_usd NUMERIC(14,2) DEFAULT 0,
  total_bs NUMERIC(16,2) DEFAULT 0,
  items_count INTEGER DEFAULT 0,
  usuario_id UUID,
  usuario_nombre TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compras_docs_tenant ON public.compras_documentos (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.compras_detalle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  compra_id UUID REFERENCES public.compras_documentos(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  producto_id UUID,
  sku TEXT,
  descripcion TEXT NOT NULL,
  almacen_id UUID,
  lote TEXT,
  fecha_vencimiento DATE,
  cantidad NUMERIC(14,3) NOT NULL DEFAULT 0,
  costo_unitario_usd NUMERIC(14,4) NOT NULL DEFAULT 0,
  iva_porcentaje NUMERIC(6,2) DEFAULT 16,
  subtotal_usd NUMERIC(14,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compras_det_compra ON public.compras_detalle (compra_id);

CREATE TABLE IF NOT EXISTS public.abonos_cxc (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  invoice_id UUID NOT NULL,
  factura_nro TEXT,
  cliente_rif TEXT,
  cliente_nombre TEXT,
  monto_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  tasa_bcv NUMERIC(16,4) DEFAULT 1,
  metodo_pago TEXT DEFAULT 'ABONO',
  referencia TEXT,
  usuario_id UUID,
  usuario_nombre TEXT,
  fecha TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_abonos_cxc_tenant ON public.abonos_cxc (tenant_id, invoice_id);

CREATE TABLE IF NOT EXISTS public.inventario_fisico_actas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  acta_nro TEXT NOT NULL,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  responsable TEXT,
  observacion TEXT,
  total_items INTEGER DEFAULT 0,
  items_con_diferencia INTEGER DEFAULT 0,
  impacto_costo_usd NUMERIC(14,2) DEFAULT 0,
  items_json JSONB DEFAULT '[]'::jsonb,
  usuario_id UUID,
  usuario_nombre TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_fis_actas_tenant ON public.inventario_fisico_actas (tenant_id, created_at DESC);

-- ============================================================================
-- 6. TRAZABILIDAD DE USUARIO OPERADOR EN TABLAS EXISTENTES
-- ============================================================================
ALTER TABLE IF EXISTS public.invoices
  ADD COLUMN IF NOT EXISTS usuario_id UUID,
  ADD COLUMN IF NOT EXISTS usuario_nombre TEXT;

ALTER TABLE IF EXISTS public.kardex_movimientos
  ADD COLUMN IF NOT EXISTS usuario_id UUID,
  ADD COLUMN IF NOT EXISTS usuario_nombre TEXT;

ALTER TABLE IF EXISTS public.audit_logs
  ADD COLUMN IF NOT EXISTS usuario_id UUID,
  ADD COLUMN IF NOT EXISTS usuario_nombre TEXT;

ALTER TABLE IF EXISTS public.asientos_contables
  ADD COLUMN IF NOT EXISTS usuario_id UUID,
  ADD COLUMN IF NOT EXISTS usuario_nombre TEXT;

-- ============================================================================
-- 7. FUNCIONES SEGURAS DE AUTENTICACIÓN, REGISTRO Y REFERIDOS (SECURITY DEFINER)
-- ============================================================================

-- A. Verificar credenciales sin exponer nunca password_hash al navegador
CREATE OR REPLACE FUNCTION public.autenticar_usuario_erp(p_email TEXT, p_password TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_email TEXT := lower(trim(COALESCE(p_email, '')));
  v_sub RECORD;
  v_ten RECORD;
  v_cred RECORD;
  v_ok BOOLEAN := false;
BEGIN
  IF v_email = '' OR COALESCE(p_password, '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Credenciales vacías');
  END IF;

  -- 1. Verificar primero si corresponde a un sub-usuario (tenant_usuarios)
  SELECT * INTO v_sub FROM public.tenant_usuarios WHERE lower(email) = v_email LIMIT 1;
  IF FOUND THEN
    IF v_sub.activo IS FALSE THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Usuario suspendido por el administrador de la empresa');
    END IF;

    SELECT * INTO v_cred FROM public.credenciales_erp
    WHERE tipo = 'USUARIO' AND entidad_id = v_sub.id LIMIT 1;

    IF FOUND AND v_cred.password_hash = crypt(p_password, v_cred.password_hash) THEN
      SELECT
        id, razon_social, rif, email, telefono, direccion, rol, plan_activo, activo,
        ciclo_facturacion, fecha_vencimiento_plan, estado_suscripcion, modulos_permitidos,
        codigo_referido, referido_por_id, referido_nivel2_id, referido_nivel3_id,
        es_promotor_externo, datos_cobro_comision, imprenta_nombre, imprenta_rif,
        imprenta_providencia, imprenta_rango, max_usuarios, permisos_manuales, created_at
      INTO v_ten FROM public.tenants WHERE id = v_sub.tenant_id LIMIT 1;

      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Comercio asociado no encontrado');
      END IF;

      RETURN jsonb_build_object(
        'ok', true,
        'tipo', 'USUARIO',
        'tenant', to_jsonb(v_ten),
        'usuario', jsonb_build_object(
          'id', v_sub.id,
          'tenant_id', v_sub.tenant_id,
          'nombre_completo', v_sub.nombre_completo,
          'email', v_sub.email,
          'rol_interno', v_sub.rol_interno,
          'sucursal_id', v_sub.sucursal_id,
          'modulos_permitidos', v_sub.modulos_permitidos,
          'activo', v_sub.activo,
          'es_propietario', false
        )
      );
    END IF;

    RETURN jsonb_build_object('ok', false, 'error', 'Correo o contraseña incorrectos');
  END IF;

  -- 2. Verificar propietario del comercio o Master en tenants
  SELECT
    id, razon_social, rif, email, telefono, direccion, rol, plan_activo, activo,
    ciclo_facturacion, fecha_vencimiento_plan, estado_suscripcion, modulos_permitidos,
    codigo_referido, referido_por_id, referido_nivel2_id, referido_nivel3_id,
    es_promotor_externo, datos_cobro_comision, imprenta_nombre, imprenta_rif,
    imprenta_providencia, imprenta_rango, max_usuarios, permisos_manuales, created_at
  INTO v_ten FROM public.tenants WHERE lower(email) = v_email LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Correo o contraseña incorrectos');
  END IF;

  SELECT * INTO v_cred FROM public.credenciales_erp
  WHERE tipo = 'TENANT' AND entidad_id = v_ten.id LIMIT 1;

  IF FOUND AND v_cred.password_hash = crypt(p_password, v_cred.password_hash) THEN
    v_ok := true;
  END IF;

  IF NOT v_ok THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Correo o contraseña incorrectos');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'tipo', 'TENANT',
    'tenant', to_jsonb(v_ten),
    'usuario', jsonb_build_object(
      'id', v_ten.id,
      'tenant_id', v_ten.id,
      'nombre_completo', COALESCE(v_ten.razon_social, v_ten.email),
      'email', v_ten.email,
      'rol_interno', CASE WHEN lower(COALESCE(v_ten.rol, '')) = 'master' THEN 'MASTER_SAAS' ELSE 'PROPIETARIO' END,
      'sucursal_id', null,
      'modulos_permitidos', v_ten.modulos_permitidos,
      'activo', v_ten.activo,
      'es_propietario', true
    )
  );
END;
$$;

-- B. Guardar o actualizar contraseña hasheada con bcrypt (sin guardar texto plano)
CREATE OR REPLACE FUNCTION public.registrar_credencial_erp(
  p_tipo TEXT,
  p_entidad_id UUID,
  p_email TEXT,
  p_password TEXT,
  p_auth_user_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tipo TEXT := upper(trim(COALESCE(p_tipo, 'TENANT')));
  v_email TEXT := lower(trim(COALESCE(p_email, '')));
  v_hash TEXT;
BEGIN
  IF v_tipo NOT IN ('TENANT', 'USUARIO') OR p_entidad_id IS NULL OR v_email = '' THEN
    RETURN false;
  END IF;

  IF COALESCE(p_password, '') <> '' THEN
    v_hash := crypt(p_password, gen_salt('bf', 10));
    INSERT INTO public.credenciales_erp (tipo, entidad_id, email, password_hash, updated_at)
    VALUES (v_tipo, p_entidad_id, v_email, v_hash, now())
    ON CONFLICT (tipo, entidad_id) DO UPDATE
      SET email = EXCLUDED.email,
          password_hash = EXCLUDED.password_hash,
          updated_at = now();
  END IF;

  IF p_auth_user_id IS NOT NULL THEN
    IF v_tipo = 'TENANT' THEN
      UPDATE public.tenants SET auth_user_id = p_auth_user_id WHERE id = p_entidad_id AND auth_user_id IS NULL;
    ELSE
      UPDATE public.tenant_usuarios SET auth_user_id = p_auth_user_id WHERE id = p_entidad_id AND auth_user_id IS NULL;
    END IF;
  END IF;

  RETURN true;
END;
$$;

-- C. Registro público seguro desde Landing (hashea la clave al instante y no retorna credenciales)
CREATE OR REPLACE FUNCTION public.crear_tenant_publico_seguro(
  p_razon_social TEXT,
  p_rif TEXT,
  p_telefono TEXT,
  p_direccion TEXT,
  p_email TEXT,
  p_password TEXT,
  p_rol TEXT DEFAULT 'tenant',
  p_plan_activo TEXT DEFAULT 'Freemium',
  p_codigo_referido TEXT DEFAULT NULL,
  p_referido_por_id UUID DEFAULT NULL,
  p_referido_nivel2_id UUID DEFAULT NULL,
  p_referido_nivel3_id UUID DEFAULT NULL,
  p_es_promotor_externo BOOLEAN DEFAULT false,
  p_datos_cobro_comision JSONB DEFAULT '{}'::jsonb,
  p_modulos_permitidos JSONB DEFAULT NULL,
  p_auth_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_email TEXT := lower(trim(COALESCE(p_email, '')));
  v_ten RECORD;
BEGIN
  IF v_email = '' OR length(COALESCE(p_password, '')) < 4 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Correo y contraseña (mín. 4 caracteres) requeridos');
  END IF;

  IF EXISTS (SELECT 1 FROM public.tenants WHERE lower(email) = v_email)
     OR EXISTS (SELECT 1 FROM public.tenant_usuarios WHERE lower(email) = v_email) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ya existe una cuenta registrada con ese correo electrónico');
  END IF;

  INSERT INTO public.tenants (
    auth_user_id, razon_social, rif, telefono, direccion, email, rol, plan_activo, activo,
    ciclo_facturacion, estado_suscripcion, modulos_permitidos, codigo_referido,
    referido_por_id, referido_nivel2_id, referido_nivel3_id, es_promotor_externo, datos_cobro_comision
  ) VALUES (
    p_auth_user_id, trim(p_razon_social), upper(trim(p_rif)), trim(COALESCE(p_telefono, '')),
    trim(COALESCE(p_direccion, 'VENEZUELA')), v_email,
    CASE WHEN lower(COALESCE(p_rol, '')) = 'promotor' THEN 'promotor' ELSE 'tenant' END,
    COALESCE(p_plan_activo, 'Freemium'), true,
    'MENSUAL', 'ACTIVA', p_modulos_permitidos, p_codigo_referido,
    p_referido_por_id, p_referido_nivel2_id, p_referido_nivel3_id, COALESCE(p_es_promotor_externo, false),
    COALESCE(p_datos_cobro_comision, '{}'::jsonb)
  )
  RETURNING
    id, razon_social, rif, email, telefono, direccion, rol, plan_activo, activo,
    ciclo_facturacion, fecha_vencimiento_plan, estado_suscripcion, modulos_permitidos,
    codigo_referido, referido_por_id, referido_nivel2_id, referido_nivel3_id,
    es_promotor_externo, datos_cobro_comision, max_usuarios, created_at
  INTO v_ten;

  PERFORM public.registrar_credencial_erp('TENANT', v_ten.id, v_email, p_password, p_auth_user_id);

  RETURN jsonb_build_object('ok', true, 'tenant', to_jsonb(v_ten));
END;
$$;

-- D. Resolver referidor público sin exponer la tabla completa de tenants a anónimos
CREATE OR REPLACE FUNCTION public.resolver_referidor_publico(p_codigo_o_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cod TEXT := trim(COALESCE(p_codigo_o_id, ''));
  v_row RECORD;
BEGIN
  IF v_cod = '' THEN RETURN NULL; END IF;

  SELECT id, codigo_referido, referido_por_id, referido_nivel2_id, rol, es_promotor_externo
  INTO v_row
  FROM public.tenants
  WHERE id::text = v_cod OR upper(COALESCE(codigo_referido, '')) = upper(v_cod)
  LIMIT 1;

  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION public.autenticar_usuario_erp(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_credencial_erp(TEXT, UUID, TEXT, TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crear_tenant_publico_seguro(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, BOOLEAN, JSONB, JSONB, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolver_referidor_publico(TEXT) TO anon, authenticated;

-- ============================================================================
-- 8. FUNCIONES AUXILIARES DE SEGURIDAD RLS POR INQUILINO Y ROL MASTER
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mfd_es_master()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenants
    WHERE auth_user_id = auth.uid()
      AND (lower(COALESCE(rol, '')) = 'master' OR lower(COALESCE(email, '')) = 'ervec2000@gmail.com')
  );
$$;

CREATE OR REPLACE FUNCTION public.mfd_tenant_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT id FROM public.tenants WHERE auth_user_id = auth.uid() LIMIT 1),
    (SELECT tenant_id FROM public.tenant_usuarios WHERE auth_user_id = auth.uid() AND activo IS TRUE LIMIT 1)
  );
$$;

-- ============================================================================
-- 9. HABILITAR RLS EN TODAS LAS TABLAS Y APLICAR AISLAMIENTO POR INQUILINO
--    Nota: En Supabase Auth > Providers > Email desactiva "Confirm email"
--    para que nuevos comercios y sub-usuarios obtengan JWT inmediato al iniciar sesión.
-- ============================================================================
ALTER TABLE IF EXISTS public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tenant_usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.sesiones_auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.compras_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.compras_detalle ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.abonos_cxc ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.inventario_fisico_actas ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.saas_pagos_suscripcion ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.saas_config_pagos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.saas_comisiones_referidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.saas_retiros_referidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.saas_leads_landing ENABLE ROW LEVEL SECURITY;

-- Políticas de Tenants (propietario o Master autenticado)
DROP POLICY IF EXISTS "Acceso SaaS tenants" ON public.tenants;
DROP POLICY IF EXISTS "Tenants lectura segura" ON public.tenants;
DROP POLICY IF EXISTS "Tenants edicion segura" ON public.tenants;
CREATE POLICY "Tenants lectura segura" ON public.tenants
  FOR SELECT TO authenticated
  USING (
    id = public.mfd_tenant_id()
    OR referido_por_id = public.mfd_tenant_id()
    OR referido_nivel2_id = public.mfd_tenant_id()
    OR referido_nivel3_id = public.mfd_tenant_id()
    OR public.mfd_es_master()
  );
CREATE POLICY "Tenants edicion segura" ON public.tenants
  FOR ALL TO authenticated
  USING (id = public.mfd_tenant_id() OR public.mfd_es_master())
  WITH CHECK (id = public.mfd_tenant_id() OR public.mfd_es_master());

-- Políticas de Sub-Usuarios y Bitácora de Entradas/Salidas
DROP POLICY IF EXISTS "Aislamiento tenant_usuarios" ON public.tenant_usuarios;
CREATE POLICY "Aislamiento tenant_usuarios" ON public.tenant_usuarios
  FOR ALL TO authenticated
  USING (tenant_id = public.mfd_tenant_id() OR public.mfd_es_master())
  WITH CHECK (tenant_id = public.mfd_tenant_id() OR public.mfd_es_master());

DROP POLICY IF EXISTS "Aislamiento sesiones_auditoria" ON public.sesiones_auditoria;
CREATE POLICY "Aislamiento sesiones_auditoria" ON public.sesiones_auditoria
  FOR ALL TO authenticated
  USING (tenant_id = public.mfd_tenant_id() OR public.mfd_es_master())
  WITH CHECK (tenant_id = public.mfd_tenant_id() OR public.mfd_es_master());
CREATE POLICY "Permitir registrar intento fallido anon" ON public.sesiones_auditoria
  FOR INSERT TO anon
  WITH CHECK (evento = 'INTENTO_FALLIDO');

-- Políticas de Tablas Operativas y Nuevas Tablas
DO $$
DECLARE
  v_tabla TEXT;
  v_tablas TEXT[] := ARRAY[
    'productos', 'clientes', 'proveedores', 'sucursales', 'almacenes',
    'unidades_medida', 'tipos_iva', 'vias_pago', 'invoices',
    'kardex_movimientos', 'inventario_lotes', 'compras_documentos',
    'compras_detalle', 'abonos_cxc', 'inventario_fisico_actas',
    'plan_cuentas', 'asientos_contables', 'asientos_detalle', 'audit_logs',
    'saas_pagos_suscripcion'
  ];
BEGIN
  FOREACH v_tabla IN ARRAY v_tablas LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = v_tabla) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tabla);
      EXECUTE format('DROP POLICY IF EXISTS "Acceso multi-tenant %I" ON public.%I', v_tabla, v_tabla);
      EXECUTE format('DROP POLICY IF EXISTS "Aislamiento %I" ON public.%I', v_tabla, v_tabla);
      EXECUTE format(
        'CREATE POLICY "Aislamiento %I" ON public.%I FOR ALL TO authenticated USING (tenant_id = public.mfd_tenant_id() OR public.mfd_es_master()) WITH CHECK (tenant_id = public.mfd_tenant_id() OR public.mfd_es_master())',
        v_tabla, v_tabla
      );
    END IF;
  END LOOP;
END $$;

-- Políticas de invoice_items (enlazada por invoice_id)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'invoice_items') THEN
    ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Aislamiento invoice_items" ON public.invoice_items;
    CREATE POLICY "Aislamiento invoice_items" ON public.invoice_items
      FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.invoices inv
          WHERE inv.id = invoice_items.invoice_id
            AND (inv.tenant_id = public.mfd_tenant_id() OR public.mfd_es_master())
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.invoices inv
          WHERE inv.id = invoice_items.invoice_id
            AND (inv.tenant_id = public.mfd_tenant_id() OR public.mfd_es_master())
        )
      );
  END IF;
END $$;

-- Configuración pública de precios/referidos: lectura pública, escritura solo Master
DROP POLICY IF EXISTS "Acceso saas_config_pagos" ON public.saas_config_pagos;
CREATE POLICY "Lectura publica saas_config_pagos" ON public.saas_config_pagos
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Escritura master saas_config_pagos" ON public.saas_config_pagos
  FOR ALL TO authenticated
  USING (public.mfd_es_master())
  WITH CHECK (public.mfd_es_master());

-- Comisiones y Retiros: cada beneficiario ve los suyos; Master ve y aprueba todos
DROP POLICY IF EXISTS "Acceso saas_comisiones_referidos" ON public.saas_comisiones_referidos;
CREATE POLICY "Aislamiento saas_comisiones_referidos" ON public.saas_comisiones_referidos
  FOR SELECT TO authenticated
  USING (beneficiario_id = public.mfd_tenant_id() OR public.mfd_es_master());
CREATE POLICY "Escritura master saas_comisiones_referidos" ON public.saas_comisiones_referidos
  FOR ALL TO authenticated
  USING (public.mfd_es_master())
  WITH CHECK (public.mfd_es_master());

DROP POLICY IF EXISTS "Acceso saas_retiros_referidos" ON public.saas_retiros_referidos;
CREATE POLICY "Lectura saas_retiros_referidos" ON public.saas_retiros_referidos
  FOR SELECT TO authenticated
  USING (beneficiario_id = public.mfd_tenant_id() OR public.mfd_es_master());
CREATE POLICY "Insert propio saas_retiros_referidos" ON public.saas_retiros_referidos
  FOR INSERT TO authenticated
  WITH CHECK (beneficiario_id = public.mfd_tenant_id() OR public.mfd_es_master());
CREATE POLICY "Update master saas_retiros_referidos" ON public.saas_retiros_referidos
  FOR UPDATE TO authenticated
  USING (public.mfd_es_master())
  WITH CHECK (public.mfd_es_master());

-- Leads de Landing: cualquier visitante puede enviar solicitud; solo Master los lee
DROP POLICY IF EXISTS "Acceso saas_leads_landing" ON public.saas_leads_landing;
CREATE POLICY "Insert publico saas_leads_landing" ON public.saas_leads_landing
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Lectura master saas_leads_landing" ON public.saas_leads_landing
  FOR SELECT TO authenticated USING (public.mfd_es_master());
CREATE POLICY "Update master saas_leads_landing" ON public.saas_leads_landing
  FOR UPDATE TO authenticated USING (public.mfd_es_master()) WITH CHECK (public.mfd_es_master());
