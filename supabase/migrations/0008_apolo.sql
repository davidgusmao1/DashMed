-- DashMed — código do paciente no Apolo Ninsaúde (David, 12/11/26: no cartão do
-- CRM, um botão "Abrir ficha no Apolo Ninsaúde" que abre a ficha desse
-- paciente exatamente lá dentro do prontuário, numa outra aba).
--
-- O Apolo não tem link que abra a ficha de fora: a ficha só abre pela função
-- interna openWin({viewName: "cadastro_paciente", urlParam: {id}}). Uma
-- extensão no Chrome (Tampermonkey + public/dashmed-apolo.user.js) lê o código
-- que a DashMed manda no endereço e chama essa função. O código de cada
-- paciente foi buscado no próprio Apolo (pelo telefone, conferindo nome e
-- nascimento) e gravado aqui fora do git, porque é dado de paciente.

alter table pacientes add column apolo_id int check (apolo_id > 0);

-- Um paciente do Apolo é um só paciente na DashMed: dois cartões apontando
-- para a mesma ficha seria cadastro duplicado.
create unique index pacientes_apolo_unico on pacientes (cliente_id, apolo_id)
  where deleted_at is null and apolo_id is not null;

grant update (apolo_id) on pacientes to authenticated;
