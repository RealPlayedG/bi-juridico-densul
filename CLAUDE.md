# BI Jurídico Densul: regras do projeto

- Antes de QUALQUER alteração no código publicado, criar uma cópia da versão atual:
  `git branch backup/AAAA-MM-DD-descricao origin/main && git push origin backup/AAAA-MM-DD-descricao`
  (o sistema também guarda um backup dos dados sozinho quando sobe uma versão nova).
- Nunca apagar dados de verdade: processos, custas e anexos são "excluídos" só com a marca `excluido`.
- Toda alteração de dado passa por `registrar()` (histórico de quem mudou o quê).
- Permissões são checadas no servidor (app.py), não só na tela.
- Textos sem travessão (em-dash). Português do Brasil, simples e direto.
- Visual: tema.css (Barlow / Barlow Condensed, verde #1f5f4a). app.css é a base de layout.
