"""
Importa as abas "Cobrança" e "Processos Diversos" da planilha Jurídico (.xlsx).

O que a importação arruma:
- nomes de loja escritos de jeitos diferentes viram um só (ex.: "ANANINDEUA" e "Ananindeua\n");
- "Não entrar com ação" escrito no nº do processo sai de lá e vira um andamento;
- o texto de "Considerações" / "Teor" vira o primeiro andamento do processo;
- o link do Drive no nome do cliente vira um anexo (Nota);
- cada data em "Custas - Inicial" / "Custas - Serviço" / "Custas" vira uma custa com
  vencimento e o link do Drive (pasta ou boleto) que estava na célula;
- linha idêntica a outra entra uma vez só; mesmo nº de processo com dados diferentes
  entra nas duas linhas, com um andamento "Conferir" para o jurídico revisar.

Não muda o status de ninguém: o que estava na planilha é o que entra.
"""

import re
import unicodedata
from datetime import date, datetime

import openpyxl
from sqlalchemy import insert, select

from db import agora, andamentos, anexos, custas, engine, lojas, processos, registrar

LOJA_CANONICA = {
    "agua boa": "Água Boa", "anapolis": "Anápolis", "ananindeua": "Ananindeua", "araguaina": "Araguaína",
    "balsas": "Balsas", "brasilia": "Brasília", "bueno": "Bueno", "castelo": "Castelo", "contagem": "Contagem",
    "cuiaba": "Cuiabá", "goiania": "Goiânia", "macapa": "Macapá", "maraba": "Marabá", "matriz": "Matriz",
    "palmas": "Palmas", "redencao": "Redenção", "rio verde": "Rio Verde", "rondonopolis": "Rondonópolis",
    "santarem": "Santarém", "sao luis": "São Luís", "sinop": "Sinop", "uberlandia": "Uberlândia",
    "asa norte": "Asa Norte", "atacado": "Atacado",
}


def _chave(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", s).strip()


def loja_canonica(s):
    k = _chave(s)
    if not k or k == "none":
        return ""
    return LOJA_CANONICA.get(k, re.sub(r"\s+", " ", str(s)).strip().title())


def _txt(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return re.sub(r"\s+", " ", str(v)).strip()


def _num(v):
    if v in (None, ""):
        return None
    if isinstance(v, (int, float)):
        return round(float(v), 2)
    s = str(v).replace("R$", "").replace(" ", "").replace(".", "").replace(",", ".")
    try:
        return round(float(s), 2)
    except ValueError:
        return None


def _ano(v):
    try:
        a = int(float(v))
        return a if 1990 <= a <= 2100 else None
    except (TypeError, ValueError):
        return None


def _data(v):
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    m = re.match(r"^\s*(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\s*$", str(v or ""))
    if m:
        d, mth, y = int(m[1]), int(m[2]), m[3]
        y = int(y) + (2000 if y and len(y) == 2 else 0) if y else 2026
        try:
            return date(y, mth, d)
        except ValueError:
            return None
    return None


def _aba(wb, nome):
    for ws in wb.worksheets:
        if _chave(ws.title) == _chave(nome):
            return ws
    raise ValueError(f'A planilha não tem a aba "{nome}".')


def _cabecalho(ws):
    """Acha a linha do cabeçalho (a que tem 'Loja') e devolve {nome_normalizado: índice}."""
    for r in range(1, 30):
        vals = [_chave(c.value) for c in ws[r]]
        if "loja" in vals or "identificacao" in vals:
            return r, {v: i for i, v in enumerate(vals) if v}
    raise ValueError(f'Não achei o cabeçalho da aba "{ws.title}".')


def _col(cab, *nomes):
    for n in nomes:
        for k, i in cab.items():
            if k.startswith(_chave(n)):
                return i
    return None


def ler(caminho):
    wb = openpyxl.load_workbook(caminho, data_only=True)
    itens = []
    # ---------- Cobrança ----------
    ws = _aba(wb, "Cobrança")
    hr, cab = _cabecalho(ws)
    c = {k: _col(cab, *n) for k, n in {
        "loja": ["loja"], "carteira": ["carteira"], "ano": ["ano"], "cod": ["codigo c"], "cliente": ["cliente"],
        "doc": ["cnpj"], "valor": ["valor da divida"], "cons": ["consideracoes"], "status": ["status"],
        "num": ["n processo", "no processo", "n° processo"], "acordo": ["valor do acordo"], "pago": ["valor pago"],
        "ci": ["custas - inicial"], "cs": ["custas - servico"]}.items()}
    for row in ws.iter_rows(min_row=hr + 1):
        v = lambda k: row[c[k]].value if c[k] is not None and c[k] < len(row) else None  # noqa: E731
        cliente = _txt(v("cliente"))
        if not cliente and not _txt(v("num")) and _num(v("valor")) is None:
            continue
        item = {
            "tipo": "cobranca", "loja": loja_canonica(v("loja")), "carteira": _txt(v("carteira")), "ano": _ano(v("ano")),
            "codigo_cliente": _txt(v("cod")), "parte": cliente, "documento": _txt(v("doc")).replace(" ", ""),
            "valor": _num(v("valor")), "status": _txt(v("status")), "numero": _txt(v("num")),
            "valor_acordo": _num(v("acordo")), "valor_pago": _num(v("pago")), "andamento": _txt(v("cons")),
            "anexos": [], "custas": [],
        }
        lk = row[c["cliente"]].hyperlink if c["cliente"] is not None else None
        if lk and lk.target:
            item["anexos"].append({"categoria": "Nota", "nome": "Nota (Drive)", "link": lk.target})
        for k, tipo in (("ci", "Inicial"), ("cs", "Serviço")):
            if c[k] is None:
                continue
            cel = row[c[k]]
            dt = _data(cel.value)
            link = cel.hyperlink.target if cel.hyperlink else ""
            if dt or link or _txt(cel.value):
                item["custas"].append({"tipo": tipo, "vencimento": dt, "link": link,
                                       "descricao": "" if dt else _txt(cel.value)})
        itens.append(item)
    # ---------- Processos Diversos ----------
    ws = _aba(wb, "Processos Diversos")
    hr, cab = _cabecalho(ws)
    c = {k: _col(cab, *n) for k, n in {
        "ident": ["identificacao"], "num": ["n processo", "no processo", "n° processo"], "acao": ["tipo de acao"],
        "loja": ["loja"], "uf": ["uf"], "ano": ["ano"], "parte": ["parte"], "teor": ["teor"], "status": ["status"],
        "valor": ["valor da condenacao"], "pago": ["valor pago"], "custas": ["custas"]}.items()}
    for row in ws.iter_rows(min_row=hr + 1):
        v = lambda k: row[c[k]].value if c[k] is not None and c[k] < len(row) else None  # noqa: E731
        num, parte = _txt(v("num")), _txt(v("parte"))
        cel = row[c["custas"]] if c["custas"] is not None else None
        tem_custa = cel is not None and (cel.value or cel.hyperlink)
        if not num and not parte and not tem_custa:
            continue
        item = {
            "tipo": "diversos", "identificacao": _txt(v("ident")), "numero": num, "tipo_acao": _txt(v("acao")),
            "loja": loja_canonica(v("loja")), "uf": _txt(v("uf")).upper()[:2], "ano": _ano(v("ano")), "parte": parte,
            "teor": _txt(v("teor")), "status": _txt(v("status")), "valor": _num(v("valor")),
            "valor_pago": _num(v("pago")), "andamento": "", "anexos": [], "custas": [],
        }
        if item["tipo_acao"]:
            item["tipo_acao"] = item["tipo_acao"][0].upper() + item["tipo_acao"][1:].lower()
        if tem_custa:
            item["custas"].append({"tipo": "Inicial", "vencimento": _data(cel.value),
                                   "link": cel.hyperlink.target if cel.hyperlink else "", "descricao": ""})
        itens.append(item)
    return itens


def limpar(itens):
    """Correções de dados antes de gravar. Devolve (itens, avisos)."""
    avisos, vistos, saida = [], {}, []
    for it in itens:
        if _chave(it["numero"]) == "nao entrar com acao":
            it["numero"] = ""
            it["andamento"] = (it["andamento"] + " | " if it["andamento"] else "") + "Não entrar com ação (anotado no nº do processo na planilha)."
        it["duplicado"] = False
        chave = (it["tipo"], _chave(it["numero"]))
        if it["numero"] and chave in vistos:
            outro = vistos[chave]
            iguais = all(_chave(outro.get(k)) == _chave(it.get(k)) for k in ("parte", "valor", "status", "andamento", "loja"))
            if iguais and not it["custas"]:
                avisos.append(f'Linha idêntica ignorada: {it["numero"]} ({it["parte"]})')
                continue
            # mesmo nº com dados diferentes: entra, mas fica marcado para o jurídico conferir
            outro["duplicado"] = it["duplicado"] = True
            avisos.append(f'Nº repetido com dados diferentes (as duas linhas entraram): {it["numero"]} ({it["parte"]})')
        else:
            vistos[chave] = it
        if not it["numero"] and not it["parte"]:
            # só uma custa solta, sem processo: entra como processo "sem identificação" para não perder o vencimento
            it["parte"] = "(sem identificação na planilha)"
        saida.append(it)
    return saida, avisos


def gravar(itens, quem, origem="planilha"):
    """Grava tudo numa transação só: ou entra tudo, ou nada."""
    n = {"processos": 0, "custas": 0, "anexos": 0}
    with engine.begin() as conn:
        existentes = {r.nome for r in conn.execute(select(lojas.c.nome))}
        for nome in sorted({it["loja"] for it in itens if it["loja"]} - existentes):
            uf = next((it["uf"] for it in itens if it["loja"] == nome and it.get("uf")), "")
            conn.execute(insert(lojas).values(nome=nome, uf=uf))
        for it in itens:
            campos = {k: it.get(k) for k in ("tipo", "loja", "uf", "carteira", "ano", "codigo_cliente", "parte", "documento",
                                              "identificacao", "tipo_acao", "numero", "status", "valor", "valor_acordo",
                                              "valor_pago", "teor")}
            campos = {k: ("" if v is None and k not in ("ano", "valor", "valor_acordo", "valor_pago") else v) for k, v in campos.items()}
            pid = conn.execute(insert(processos).values(**campos, criado_em=agora(), atualizado_em=agora(),
                                                        criado_por=f"Importação ({origem})", conferido=False, excluido=False)).inserted_primary_key[0]
            n["processos"] += 1
            if it["andamento"]:
                conn.execute(insert(andamentos).values(processo_id=pid, texto=it["andamento"], por="Importado da planilha", em=agora()))
            if it.get("duplicado"):
                conn.execute(insert(andamentos).values(processo_id=pid, por="Importação", em=agora(),
                    texto="Conferir: este nº de processo aparece em mais de uma linha da planilha, com valores ou andamentos diferentes."))
            for a in it["anexos"]:
                conn.execute(insert(anexos).values(processo_id=pid, categoria=a["categoria"], nome=a["nome"], link=a["link"],
                                                   arquivo="", por="Importado da planilha", em=agora(), excluido=False))
                n["anexos"] += 1
            for cu in it["custas"]:
                conn.execute(insert(custas).values(processo_id=pid, tipo=cu["tipo"], descricao=cu["descricao"], valor=None,
                                                   vencimento=cu["vencimento"], link=cu["link"], pago=False,
                                                   criado_por="Importado da planilha", criado_em=agora(), excluido=False))
                n["custas"] += 1
        registrar(conn, quem, "Importação da planilha", detalhes=n)
    return n


if __name__ == "__main__":
    import sys
    from db import criar_tabelas
    criar_tabelas()
    itens, avisos = limpar(ler(sys.argv[1]))
    print(gravar(itens, None), avisos)
