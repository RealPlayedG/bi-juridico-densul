"""
Volta os dados a partir de um backup (.zip gerado pelo sistema).

Uso (no Railway: serviço > ... > Shell, ou localmente com a DATABASE_URL apontando para o banco):

    python restaurar.py /data/backups/bi-juridico-2026-10-20-diario.zip --confirmar

Antes de apagar qualquer coisa, faz um backup do estado atual ("antes-de-restaurar").
"""

import json
import sys
import zipfile
from datetime import date, datetime

from sqlalchemy import Date, DateTime, delete, insert, text

import backup
from db import criar_tabelas, engine, meta


def _converter(tabela, linha):
    out = {}
    for col in tabela.columns:
        if col.name not in linha:
            continue
        v = linha[col.name]
        if v is not None and isinstance(col.type, DateTime) and isinstance(v, str):
            v = datetime.fromisoformat(v)
        elif v is not None and isinstance(col.type, Date) and isinstance(v, str):
            v = date.fromisoformat(v[:10])
        out[col.name] = v
    return out


def restaurar(caminho):
    with zipfile.ZipFile(caminho) as z:
        dados = json.loads(z.read("dados.json"))["tabelas"]
    criar_tabelas()
    print("Backup do estado atual:", backup.fazer("antes-de-restaurar"))
    with engine.begin() as c:
        for t in reversed(meta.sorted_tables):
            c.execute(delete(t))
        for t in meta.sorted_tables:
            linhas = [_converter(t, r) for r in dados.get(t.name, [])]
            if linhas:
                c.execute(insert(t), linhas)
            print(f"{t.name}: {len(linhas)}")
        if engine.dialect.name == "postgresql":  # acerta os contadores de id
            for t in meta.sorted_tables:
                c.execute(text(f"SELECT setval(pg_get_serial_sequence('{t.name}', 'id'), COALESCE((SELECT MAX(id) FROM {t.name}), 0) + 1, false)"))


if __name__ == "__main__":
    if len(sys.argv) < 3 or sys.argv[2] != "--confirmar":
        print(__doc__)
        sys.exit(1)
    restaurar(sys.argv[1])
    print("Pronto.")
