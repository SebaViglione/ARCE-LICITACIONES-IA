--
-- PostgreSQL database dump
--

\restrict dIvJSHa0nf2Wcww3NMfFKEeBhOu0wuYdPPhQ9HYqiPahWfblKFpoEiaPRcM9tNA

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: aclaraciones; Type: TABLE; Schema: public; Owner: n8n
--

CREATE TABLE public.aclaraciones (
    id integer NOT NULL,
    id_llamado character varying(20),
    fecha date,
    hora time without time zone,
    texto text,
    archivo_url text,
    actualizado_en timestamp without time zone DEFAULT now()
);


ALTER TABLE public.aclaraciones OWNER TO n8n;

--
-- Name: aclaraciones_id_seq; Type: SEQUENCE; Schema: public; Owner: n8n
--

CREATE SEQUENCE public.aclaraciones_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.aclaraciones_id_seq OWNER TO n8n;

--
-- Name: aclaraciones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: n8n
--

ALTER SEQUENCE public.aclaraciones_id_seq OWNED BY public.aclaraciones.id;


--
-- Name: analisis_ia; Type: TABLE; Schema: public; Owner: n8n
--

CREATE TABLE public.analisis_ia (
    id integer NOT NULL,
    llamado_id character varying(20),
    archivo_analizado character varying(500),
    es_relevante boolean,
    confianza integer,
    razon text,
    resumen_trabajo text,
    ubicacion_obra text,
    requiere_visita boolean,
    ubicacion_visita text,
    fecha_visita_especifica date,
    coordina_visita boolean,
    contacto_visita_nombre text,
    contacto_visita_telefono text,
    analizado_en timestamp without time zone DEFAULT now(),
    errores_extraccion text,
    descripcion_llamado text,
    contacto_visita_correo text,
    materiales_detectados jsonb,
    formularios_requeridos jsonb DEFAULT '[]'::jsonb,
    CONSTRAINT analisis_ia_confianza_check CHECK (((confianza >= 0) AND (confianza <= 100)))
);


ALTER TABLE public.analisis_ia OWNER TO n8n;

--
-- Name: analisis_ia_id_seq; Type: SEQUENCE; Schema: public; Owner: n8n
--

CREATE SEQUENCE public.analisis_ia_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.analisis_ia_id_seq OWNER TO n8n;

--
-- Name: analisis_ia_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: n8n
--

ALTER SEQUENCE public.analisis_ia_id_seq OWNED BY public.analisis_ia.id;


--
-- Name: archivos_adjuntos; Type: TABLE; Schema: public; Owner: n8n
--

CREATE TABLE public.archivos_adjuntos (
    id integer NOT NULL,
    llamado_id character varying(20),
    nombre text,
    tipo text,
    archivo_url text,
    label text,
    actualizado_en timestamp without time zone DEFAULT now()
);


ALTER TABLE public.archivos_adjuntos OWNER TO n8n;

--
-- Name: archivos_adjuntos_id_seq; Type: SEQUENCE; Schema: public; Owner: n8n
--

CREATE SEQUENCE public.archivos_adjuntos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.archivos_adjuntos_id_seq OWNER TO n8n;

--
-- Name: archivos_adjuntos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: n8n
--

ALTER SEQUENCE public.archivos_adjuntos_id_seq OWNED BY public.archivos_adjuntos.id;


--
-- Name: feedback_usuario; Type: TABLE; Schema: public; Owner: n8n
--

CREATE TABLE public.feedback_usuario (
    id integer NOT NULL,
    llamado_id character varying(64) NOT NULL,
    es_relevante_real boolean,
    comentario text,
    estado_seguimiento character varying(20) DEFAULT 'pendiente'::character varying,
    ia_es_relevante boolean,
    ia_confianza numeric(5,2),
    ia_razon text,
    usuario character varying(50) DEFAULT CURRENT_USER,
    creado_en timestamp without time zone DEFAULT now(),
    actualizado_en timestamp without time zone DEFAULT now()
);


ALTER TABLE public.feedback_usuario OWNER TO n8n;

--
-- Name: feedback_usuario_id_seq; Type: SEQUENCE; Schema: public; Owner: n8n
--

CREATE SEQUENCE public.feedback_usuario_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.feedback_usuario_id_seq OWNER TO n8n;

--
-- Name: feedback_usuario_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: n8n
--

ALTER SEQUENCE public.feedback_usuario_id_seq OWNED BY public.feedback_usuario.id;


--
-- Name: items_llamado; Type: TABLE; Schema: public; Owner: n8n
--

CREATE TABLE public.items_llamado (
    id integer NOT NULL,
    id_llamado character varying(20),
    texto text
);


ALTER TABLE public.items_llamado OWNER TO n8n;

--
-- Name: items_llamado_id_seq; Type: SEQUENCE; Schema: public; Owner: n8n
--

CREATE SEQUENCE public.items_llamado_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.items_llamado_id_seq OWNER TO n8n;

--
-- Name: items_llamado_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: n8n
--

ALTER SEQUENCE public.items_llamado_id_seq OWNED BY public.items_llamado.id;


--
-- Name: llamados; Type: TABLE; Schema: public; Owner: n8n
--

CREATE TABLE public.llamados (
    id character varying(20) NOT NULL,
    titulo text,
    descripcion text,
    fecha_publicacion date,
    hora_publicacion time without time zone,
    fecha_apertura date,
    hora_apertura time without time zone,
    url_detalle text,
    detectado_en timestamp without time zone DEFAULT now(),
    dias_restantes integer,
    urgencia character varying(20),
    estado character varying(20) DEFAULT 'activo'::character varying,
    prioridad_score integer,
    tsv_search tsvector GENERATED ALWAYS AS (to_tsvector('spanish'::regconfig, ((COALESCE(titulo, ''::text) || ' '::text) || COALESCE(descripcion, ''::text)))) STORED,
    CONSTRAINT llamados_estado_check CHECK (((estado)::text = ANY ((ARRAY['activo'::character varying, 'vencido'::character varying, 'archivado'::character varying])::text[])))
);


ALTER TABLE public.llamados OWNER TO n8n;

--
-- Name: aclaraciones id; Type: DEFAULT; Schema: public; Owner: n8n
--

ALTER TABLE ONLY public.aclaraciones ALTER COLUMN id SET DEFAULT nextval('public.aclaraciones_id_seq'::regclass);


--
-- Name: analisis_ia id; Type: DEFAULT; Schema: public; Owner: n8n
--

ALTER TABLE ONLY public.analisis_ia ALTER COLUMN id SET DEFAULT nextval('public.analisis_ia_id_seq'::regclass);


--
-- Name: archivos_adjuntos id; Type: DEFAULT; Schema: public; Owner: n8n
--

ALTER TABLE ONLY public.archivos_adjuntos ALTER COLUMN id SET DEFAULT nextval('public.archivos_adjuntos_id_seq'::regclass);


--
-- Name: feedback_usuario id; Type: DEFAULT; Schema: public; Owner: n8n
--

ALTER TABLE ONLY public.feedback_usuario ALTER COLUMN id SET DEFAULT nextval('public.feedback_usuario_id_seq'::regclass);


--
-- Name: items_llamado id; Type: DEFAULT; Schema: public; Owner: n8n
--

ALTER TABLE ONLY public.items_llamado ALTER COLUMN id SET DEFAULT nextval('public.items_llamado_id_seq'::regclass);


--
-- Name: aclaraciones aclaraciones_pkey; Type: CONSTRAINT; Schema: public; Owner: n8n
--

ALTER TABLE ONLY public.aclaraciones
    ADD CONSTRAINT aclaraciones_pkey PRIMARY KEY (id);


--
-- Name: aclaraciones aclaraciones_unique; Type: CONSTRAINT; Schema: public; Owner: n8n
--

ALTER TABLE ONLY public.aclaraciones
    ADD CONSTRAINT aclaraciones_unique UNIQUE (id_llamado, archivo_url);


--
-- Name: archivos_adjuntos adjuntos_unique; Type: CONSTRAINT; Schema: public; Owner: n8n
--

ALTER TABLE ONLY public.archivos_adjuntos
    ADD CONSTRAINT adjuntos_unique UNIQUE (llamado_id, archivo_url);


--
-- Name: analisis_ia analisis_ia_llamado_id_archivo_analizado_key; Type: CONSTRAINT; Schema: public; Owner: n8n
--

ALTER TABLE ONLY public.analisis_ia
    ADD CONSTRAINT analisis_ia_llamado_id_archivo_analizado_key UNIQUE (llamado_id, archivo_analizado);


--
-- Name: analisis_ia analisis_ia_pkey; Type: CONSTRAINT; Schema: public; Owner: n8n
--

ALTER TABLE ONLY public.analisis_ia
    ADD CONSTRAINT analisis_ia_pkey PRIMARY KEY (id);


--
-- Name: archivos_adjuntos archivos_adjuntos_pkey; Type: CONSTRAINT; Schema: public; Owner: n8n
--

ALTER TABLE ONLY public.archivos_adjuntos
    ADD CONSTRAINT archivos_adjuntos_pkey PRIMARY KEY (id);


--
-- Name: feedback_usuario feedback_usuario_llamado_id_key; Type: CONSTRAINT; Schema: public; Owner: n8n
--

ALTER TABLE ONLY public.feedback_usuario
    ADD CONSTRAINT feedback_usuario_llamado_id_key UNIQUE (llamado_id);


--
-- Name: feedback_usuario feedback_usuario_pkey; Type: CONSTRAINT; Schema: public; Owner: n8n
--

ALTER TABLE ONLY public.feedback_usuario
    ADD CONSTRAINT feedback_usuario_pkey PRIMARY KEY (id);


--
-- Name: items_llamado items_llamado_pkey; Type: CONSTRAINT; Schema: public; Owner: n8n
--

ALTER TABLE ONLY public.items_llamado
    ADD CONSTRAINT items_llamado_pkey PRIMARY KEY (id);


--
-- Name: llamados llamados_pkey; Type: CONSTRAINT; Schema: public; Owner: n8n
--

ALTER TABLE ONLY public.llamados
    ADD CONSTRAINT llamados_pkey PRIMARY KEY (id);


--
-- Name: idx_analisis_confianza; Type: INDEX; Schema: public; Owner: n8n
--

CREATE INDEX idx_analisis_confianza ON public.analisis_ia USING btree (confianza DESC);


--
-- Name: idx_analisis_fecha_visita; Type: INDEX; Schema: public; Owner: n8n
--

CREATE INDEX idx_analisis_fecha_visita ON public.analisis_ia USING btree (fecha_visita_especifica) WHERE (fecha_visita_especifica IS NOT NULL);


--
-- Name: idx_analisis_relevante; Type: INDEX; Schema: public; Owner: n8n
--

CREATE INDEX idx_analisis_relevante ON public.analisis_ia USING btree (es_relevante, confianza DESC);


--
-- Name: idx_analisis_relevantes; Type: INDEX; Schema: public; Owner: n8n
--

CREATE INDEX idx_analisis_relevantes ON public.analisis_ia USING btree (es_relevante, confianza DESC);


--
-- Name: idx_analisis_visita; Type: INDEX; Schema: public; Owner: n8n
--

CREATE INDEX idx_analisis_visita ON public.analisis_ia USING btree (requiere_visita) WHERE (requiere_visita = true);


--
-- Name: idx_feedback_comparacion; Type: INDEX; Schema: public; Owner: n8n
--

CREATE INDEX idx_feedback_comparacion ON public.feedback_usuario USING btree (ia_es_relevante, es_relevante_real) WHERE (es_relevante_real IS NOT NULL);


--
-- Name: idx_feedback_estado; Type: INDEX; Schema: public; Owner: n8n
--

CREATE INDEX idx_feedback_estado ON public.feedback_usuario USING btree (estado_seguimiento);


--
-- Name: idx_llamados_estado_urgencia; Type: INDEX; Schema: public; Owner: n8n
--

CREATE INDEX idx_llamados_estado_urgencia ON public.llamados USING btree (estado, urgencia, dias_restantes) WHERE ((estado)::text = 'activo'::text);


--
-- Name: idx_llamados_fecha_apertura; Type: INDEX; Schema: public; Owner: n8n
--

CREATE INDEX idx_llamados_fecha_apertura ON public.llamados USING btree (fecha_apertura) WHERE ((estado)::text = 'activo'::text);


--
-- Name: idx_llamados_fts; Type: INDEX; Schema: public; Owner: n8n
--

CREATE INDEX idx_llamados_fts ON public.llamados USING gin (tsv_search);


--
-- Name: idx_llamados_prioridad; Type: INDEX; Schema: public; Owner: n8n
--

CREATE INDEX idx_llamados_prioridad ON public.llamados USING btree (prioridad_score DESC NULLS LAST) WHERE ((estado)::text = 'activo'::text);


--
-- Name: idx_materiales_gin; Type: INDEX; Schema: public; Owner: n8n
--

CREATE INDEX idx_materiales_gin ON public.analisis_ia USING gin (materiales_detectados jsonb_path_ops);


--
-- Name: analisis_ia trg_actualizar_prioridad; Type: TRIGGER; Schema: public; Owner: n8n
--

CREATE TRIGGER trg_actualizar_prioridad AFTER INSERT OR UPDATE OF confianza, requiere_visita ON public.analisis_ia FOR EACH ROW EXECUTE FUNCTION public.actualizar_prioridad_trigger();


--
-- Name: aclaraciones aclaraciones_llamado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: n8n
--

ALTER TABLE ONLY public.aclaraciones
    ADD CONSTRAINT aclaraciones_llamado_id_fkey FOREIGN KEY (id_llamado) REFERENCES public.llamados(id) ON DELETE CASCADE;


--
-- Name: analisis_ia analisis_ia_llamado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: n8n
--

ALTER TABLE ONLY public.analisis_ia
    ADD CONSTRAINT analisis_ia_llamado_id_fkey FOREIGN KEY (llamado_id) REFERENCES public.llamados(id) ON DELETE CASCADE;


--
-- Name: archivos_adjuntos archivos_adjuntos_llamado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: n8n
--

ALTER TABLE ONLY public.archivos_adjuntos
    ADD CONSTRAINT archivos_adjuntos_llamado_id_fkey FOREIGN KEY (llamado_id) REFERENCES public.llamados(id) ON DELETE CASCADE;


--
-- Name: feedback_usuario feedback_usuario_llamado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: n8n
--

ALTER TABLE ONLY public.feedback_usuario
    ADD CONSTRAINT feedback_usuario_llamado_id_fkey FOREIGN KEY (llamado_id) REFERENCES public.llamados(id) ON DELETE CASCADE;


--
-- Name: items_llamado items_llamado_id_llamado_fkey; Type: FK CONSTRAINT; Schema: public; Owner: n8n
--

ALTER TABLE ONLY public.items_llamado
    ADD CONSTRAINT items_llamado_id_llamado_fkey FOREIGN KEY (id_llamado) REFERENCES public.llamados(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict dIvJSHa0nf2Wcww3NMfFKEeBhOu0wuYdPPhQ9HYqiPahWfblKFpoEiaPRcM9tNA

