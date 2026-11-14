-- DashMed — descartar pauta por função (14/11/26). O teste rls_youtube.sql
-- pegou: na 0015 a sessão descartava com update de deleted_at, mas UPDATE com
-- WHERE aplica a política de leitura também à linha nova, e a linha arquivada
-- (deleted_at preenchido) não passa em yt_pautas_ler. Mesma solução da
-- arquivar_conteudo (0002): uma função que confere o acesso e arquiva.
drop policy yt_pautas_descartar on yt_pautas;
revoke update on yt_pautas from authenticated;

create or replace function descartar_pauta(p_pauta uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- a que já virou conteúdo fica: é o registro de onde o conteúdo nasceu
  update yt_pautas set deleted_at = now()
  where id = p_pauta and deleted_at is null and conteudo_id is null and vejo_cliente(cliente_id);
  if not found then
    raise exception 'Pauta não encontrada, já virou conteúdo ou sem acesso.' using errcode = 'P0002';
  end if;
end $$;
revoke execute on function descartar_pauta(uuid) from public, anon;
grant execute on function descartar_pauta(uuid) to authenticated;
