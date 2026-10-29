# BI Jurídico Densul

Acompanhamento dos processos que o jurídico toca para a Densul: **Cobrança** (clientes vencidos enviados pelo
financeiro) e **Processos Diversos** (trabalhista, monitória, danos morais etc.), com custas, anexos, calendário
de vencimentos e avisos para quem precisa pagar.

## Estrutura

```
app.py          servidor Flask: login, permissões e API
db.py           tabelas do banco (Postgres no Railway, SQLite no computador)
importar.py     importação da planilha Jurídico (.xlsx)
backup.py       backups automáticos (diário, antes de atualizar, antes de importar)
restaurar.py    volta os dados a partir de um backup
templates/      páginas (sistema, login, troca de senha)
static/css      app.css (estrutura) e tema.css (identidade visual)
static/js       app.js (telas)
```

## Perfis

| Ação | Administrador | Jurídico | Financeiro |
|---|---|---|---|
| Ver processos | Todos (ou só as lojas marcadas) | Todos (ou só as lojas marcadas) | Só as lojas marcadas (ou todas) |
| Cadastrar e editar processo, status, andamento, acordo | Sim | Sim | Não |
| Lançar e editar custas | Sim | Sim | Não |
| Marcar custa paga, valor pago, conferir recebimento | Sim | Não | Sim |
| Anexar notas, boletos, comprovantes | Sim | Sim | Sim |
| Usuários, lojas, histórico, backups, importar | Sim | Não | Não |

Tudo o que é feito fica no **histórico**: quem (nome e usuário), quando, o quê, de quanto para quanto e o IP.
Inclui entradas no sistema, tentativas de senha errada, backups e downloads de backup. Ninguém consegue apagar o histórico pelo sistema.
Em Administração > Histórico dá para filtrar por pessoa e buscar por ação, cliente ou nº do processo; dentro de cada processo aparece
o histórico só dele. Para isso funcionar, **cada pessoa precisa ter o próprio usuário** (nada de login compartilhado).

## Login

- O usuário `admin` é criado sozinho na primeira subida. Entra com a `SENHA_PADRAO` e o sistema obriga a criar uma senha própria.
- Novos usuários: Administração > Usuários > Novo usuário. Cada um entra a primeira vez com a `SENHA_PADRAO`.
- Ao criar um usuário, o administrador pode definir uma **senha do primeiro acesso** só para aquela pessoa (em vez da senha padrão). No primeiro login o sistema obriga a criar uma senha própria.
- Para criar um usuário sem entrar no sistema: no Railway, `CRIAR_USUARIO=usuario|Nome|perfil|sim` e `SENHA_INICIAL=<provisória>`. Roda uma vez; depois apague as duas variáveis.
- Esqueceu a senha: o administrador abre o usuário e clica em "Voltar senha para a padrão".
- Se o próprio administrador esquecer: no Railway, crie a variável `RESETAR_SENHA=admin`. Ao reiniciar, a senha volta para a padrão (uma única vez). Para outro reset no futuro, mude o valor (ex.: `admin#2`).

## Autorização de cobranças novas

- No cadastro do usuário, a marcação **"Autoriza cobranças novas lançadas pelo jurídico"** define quem autoriza (ex.: Juliana).
- Cobrança nova lançada por quem não tem essa marcação entra como **Aguardando autorização**: aparece na lista com o aviso,
  mas não soma nos totais, gráficos, link de apresentação nem na planilha espelho.
- Quem autoriza vê o aviso no sino e no Início, e dentro do processo clica em **Autorizar** ou **Recusar** (com motivo).
  O jurídico pode corrigir e **reenviar** uma recusada. Tudo fica no histórico.

## Link de apresentação (sem login)

- Administração > Usuários > **Link de apresentação**: gera um link secreto para quem só vai ver o BI.
- Quem abre não edita nada, não vê CPF/CNPJ nem anexos, não vê cobranças aguardando autorização e não vê Processos Diversos (só a Cobrança aparece).
- No topo aparece o botão **Entrar**: quem tem usuário entra e continua logado por 30 dias naquele navegador. Abrindo o link de novo já logado, a pessoa continua com o próprio acesso (não cai para o modo visualização). É esse link que vai na intranet.
- "Gerar link novo" faz o link anterior parar de funcionar na hora; "Desativar link" desliga. Cada abertura fica no histórico.

## Audiências

- Dentro do processo: **Nova audiência** (data, hora, tipo, local ou link, observação). Só o jurídico e o administrador marcam.
- Aparecem na **Agenda** (lista e calendário, em roxo), no card "Próximos dias" do Início, e geram aviso no sino e no Início
  quando faltam 3 dias ou menos.
- A Agenda mostra **Audiências encontradas nos andamentos** (ex.: "audiência de conciliação para o dia 23/10/2026 às 10:00")
  para o jurídico adicionar com um clique ou ignorar. Nada entra sozinho.

## Filtro de lojas e regionais

- O botão de lojas no topo abre o filtro: marque uma ou mais **regionais** e/ou uma ou mais **lojas**. Vale para Início,
  Cobrança, Diversos e Agenda, e fica salvo no navegador.
- As regionais vieram da lista "Regionais" enviada pela Densul (db.py, `REGIONAIS`). Cada loja tem a sua regional em **Administração > Lojas**,
  onde o administrador pode trocar (fica no histórico). Loja sem regional aparece em "Sem regional".

## Custas e avisos

- O jurídico lança a custa dentro do processo (tipo, vencimento, valor, boleto).
- Custas vencidas, vencendo hoje ou nos próximos 3 dias aparecem no sino, no Início e na aba Custas,
  para todo mundo que enxerga aquela loja (o financeiro de Ananindeua vê as de Ananindeua).
- O financeiro marca como paga e anexa o comprovante.

## Backups

No volume do Railway (`/data/backups`), cada um com `dados.json` (completo) e `planilha.xlsx`:

- **diário**, guardado por 60 dias;
- **antes de cada atualização** do sistema (quando sobe código novo, antes de mexer no banco);
- **antes de importar** planilha e quando o administrador clica em "Fazer backup agora".

Baixe em Administração > Backups. Para voltar um backup (no Shell do serviço no Railway):

```bash
python restaurar.py /data/backups/<arquivo>.zip --confirmar
```

**Código:** antes de cada alteração, a versão em uso é copiada para uma branch `backup/...` no GitHub.
No Railway também dá para voltar a qualquer publicação anterior em Deployments > Redeploy.

## Planilha espelho

Cópia da planilha "Jurídico" que o sistema mantém atualizada (variáveis `ESPELHO_PLANILHA_ID` e
`GOOGLE_CREDENTIALS_JSON`, a mesma conta de serviço do BI Evaristo, com acesso de editor na planilha).

- Cerca de 1 minuto depois de qualquer alteração, o sistema reescreve as abas **Cobrança** e **Processos Diversos**
  a partir da linha abaixo do cabeçalho. Cabeçalho, totais, formatação, listas de opções e as outras abas ficam como estão.
- Considerações = último andamento. Custas - Inicial = próxima custa inicial em aberto; Custas - Serviço = próxima das demais.
- É só leitura: o que for digitado nela não volta para o sistema e é apagado na atualização seguinte.
- Administração > Planilha espelho mostra o link, a última atualização e o botão "Atualizar agora".

## Rodar no computador

```bash
pip install -r requirements.txt
cp .env.example .env    # preencha SECRET_KEY e SENHA_PADRAO
python -m flask --app app run
```
