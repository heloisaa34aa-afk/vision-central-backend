CREATE TABLE IF NOT EXISTS public.instagram_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    username TEXT NOT NULL,
    encrypted_cookies TEXT NOT NULL,
    user_agent TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INVALID', 'EXPIRED')),
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.instagram_sync_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    perfil TEXT NOT NULL,
    tempo_ms INTEGER,
    memoria_mb NUMERIC,
    cpu_percent NUMERIC,
    proxy_usado TEXT,
    sessao_usada TEXT,
    retries INTEGER,
    status TEXT,
    posts_encontrados INTEGER,
    data_hora TIMESTAMPTZ DEFAULT NOW()
);
