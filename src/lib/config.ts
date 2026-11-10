// Endereço e chave PÚBLICA (anon) do Supabase da DashMed. São públicos por
// natureza — vão para o navegador de qualquer jeito, e quem protege os dados é
// a RLS (cada usuário lê só o próprio cliente). A chave de serviço NUNCA vem
// para cá: mora só nas edge functions.
export const SUPABASE_URL = "https://yjwhhkzqmsouvnryiwde.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlqd2hoa3pxbXNvdXZucnlpd2RlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQzNDc2OTAsImV4cCI6MjEwOTkyMzY5MH0.9trNrt4dJ0J9prEOggXYdTkk2DVYfheWL-Nu-P8EDYM";

/** O cookie do cliente em foco (a equipe da plataforma escolhe em qual trabalha). */
export const COOKIE_DO_CLIENTE = "dashmed-cliente";
