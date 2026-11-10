# DashMed

Plataforma multi-cliente da DashMed — Next.js 16 (Vercel) + Supabase (Postgres, Auth e Edge Functions).

- **Clientes**: cada cliente é uma conta da plataforma; todo dado leva `cliente_id` e a RLS só deixa ler o do próprio cliente. A equipe da plataforma (`usuarios.plataforma`) vê todos e escolhe em qual trabalha (seletor no menu).
- **Entrada**: link no e-mail, sem senha (`/login` → `/auth/callback`). Só entra quem tem conta: o cadastro aberto está desligado no Supabase.
- **Escrita**: pelas edge functions (chave de serviço só lá). A `saude` responde à tela Início.
- **Menu**: `src/app/(app)/menu-lateral.tsx` — os itens entram aos poucos.

```
supabase/migrations   esquema (0001_inicio.sql)
supabase/functions    edge functions (saude)
src/app/(app)         telas logadas (layout com o menu da esquerda)
```

Projeto Supabase `yjwhhkzqmsouvnryiwde` (São Paulo).
