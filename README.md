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

Tudo o que é alterado fica no **histórico** (quem, quando, de quanto para quanto).

## Login

- O usuário `admin` é criado sozinho na primeira subida. Entra com a `SENHA_PADRAO` e o sistema obriga a criar uma senha própria.
- Novos usuários: Administração > Usuários > Novo usuário. Cada um entra a primeira vez com a `SENHA_PADRAO`.
- Esqueceu a senha: o administrador abre o usuário e clica em "Voltar senha para a padrão".

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

## Rodar no computador

```bash
pip install -r requirements.txt
cp .env.example .env    # preencha SECRET_KEY e SENHA_PADRAO
python -m flask --app app run
```
