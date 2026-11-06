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

from db import agora, andamentos, anexos, custas, engine, lojas, pagamentos, processos, registrar

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
    from db import FILIAIS, chave_loja
    nomes = {chave_loja(n): n for _, n, _ in FILIAIS}
    if chave_loja(s) in nomes:  # nome oficial da filial (com acento e hífen certos)
        return nomes[chave_loja(s)]
    return LOJA_CANONICA.get(k, re.sub(r"\s+", " ", str(s)).strip().title())


ERROS_PLANILHA = {"#error!", "#ref!", "#n/a", "#value!", "#name?", "#div/0!", "#num!", "#null!"}


def _txt(v):
    if v is None:
        return ""
    if isinstance(v, str) and v.strip().lower() in ERROS_PLANILHA:
        return ""  # célula com erro de fórmula não vale como dado
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


RX_HL = re.compile(r'^=\s*HYPERLINK\(\s*"((?:[^"]|"")*)"', re.I)


def ler(caminho):
    wb = openpyxl.load_workbook(caminho, data_only=True)
    wbf = openpyxl.load_workbook(caminho)  # com as fórmulas: links escritos pelo sistema vêm como =HYPERLINK(...)

    def hl(cel):
        """Link da célula: hyperlink normal ou fórmula HYPERLINK."""
        if cel.hyperlink and cel.hyperlink.target:
            return cel.hyperlink.target
        try:
            f = wbf[cel.parent.title].cell(cel.row, cel.column).value
        except (KeyError, AttributeError):
            return ""
        m = RX_HL.match(f) if isinstance(f, str) else None
        return m.group(1).replace('""', '"') if m else ""
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
            "tipo": "cobranca", "linha": row[0].row, "loja": loja_canonica(v("loja")), "carteira": _txt(v("carteira")), "ano": _ano(v("ano")),
            "codigo_cliente": _txt(v("cod")), "parte": cliente, "documento": _txt(v("doc")).replace(" ", ""),
            "valor": _num(v("valor")), "status": _txt(v("status")), "numero": _txt(v("num")),
            "valor_acordo": _num(v("acordo")), "valor_pago": _num(v("pago")), "andamento": _txt(v("cons")),
            "anexos": [], "custas": [],
        }
        lk = hl(row[c["cliente"]]) if c["cliente"] is not None else ""
        if lk:
            item["anexos"].append({"categoria": "Nota", "nome": "Nota (Drive)", "link": lk})
        for k, tipo in (("ci", "Inicial"), ("cs", "Serviço")):
            if c[k] is None:
                continue
            cel = row[c[k]]
            dt = _data(cel.value)
            link = hl(cel)
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
        tem_custa = cel is not None and (cel.value or hl(cel))
        if not num and not parte and not tem_custa:
            continue
        item = {
            "tipo": "diversos", "linha": row[0].row, "identificacao": _txt(v("ident")), "numero": num, "tipo_acao": _txt(v("acao")),
            "loja": loja_canonica(v("loja")), "uf": _txt(v("uf")).upper()[:2], "ano": _ano(v("ano")), "parte": parte,
            "teor": _txt(v("teor")), "status": _txt(v("status")), "valor": _num(v("valor")),
            "valor_pago": _num(v("pago")), "andamento": "", "anexos": [], "custas": [],
        }
        if item["tipo_acao"]:
            item["tipo_acao"] = item["tipo_acao"][0].upper() + item["tipo_acao"][1:].lower()
        if tem_custa:
            item["custas"].append({"tipo": "Inicial", "vencimento": _data(cel.value),
                                   "link": hl(cel), "descricao": ""})
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
            from db import regional_da_loja
            conn.execute(insert(lojas).values(nome=nome, uf=uf, regional=regional_da_loja(nome)))
        for it in itens:
            campos = {k: it.get(k) for k in ("tipo", "loja", "uf", "carteira", "ano", "codigo_cliente", "parte", "documento",
                                              "identificacao", "tipo_acao", "numero", "status", "valor", "valor_acordo",
                                              "valor_pago", "teor")}
            campos = {k: ("" if v is None and k not in ("ano", "valor", "valor_acordo", "valor_pago") else v) for k, v in campos.items()}
            pid = conn.execute(insert(processos).values(**campos, criado_em=agora(), atualizado_em=agora(),
                                                        criado_por=f"Importação ({origem})", conferido=False, excluido=False)).inserted_primary_key[0]
            n["processos"] += 1
            if campos.get("valor_pago"):  # o valor pago da planilha entra como um pagamento, para a soma das parcelas bater
                conn.execute(insert(pagamentos).values(processo_id=pid, data=None, valor=campos["valor_pago"], descricao="Valor pago da planilha",
                                                       criado_por="Importado da planilha", criado_em=agora(), excluido=False))
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


# ---------- atualizar pela planilha (mesclar, sem duplicar) ----------

CAMPOS_MESCLA = ("loja", "uf", "carteira", "ano", "codigo_cliente", "parte", "documento", "identificacao", "tipo_acao", "numero",
                 "status", "valor", "valor_acordo", "teor")
NOMES_MESCLA = {"loja": "Loja", "uf": "UF", "carteira": "Carteira", "ano": "Ano", "codigo_cliente": "Código do cliente",
                "parte": "Cliente / parte", "documento": "CNPJ / CPF", "identificacao": "Identificação", "tipo_acao": "Tipo de ação",
                "numero": "Nº do processo", "status": "Status", "valor": "Valor", "valor_acordo": "Valor do acordo", "teor": "Teor"}


def _igual(a, b):
    if isinstance(a, (int, float)) or isinstance(b, (int, float)) or (a is not None and hasattr(a, "as_tuple")) or (b is not None and hasattr(b, "as_tuple")):
        try:
            return (a in (None, "") and b in (None, "")) or (a not in (None, "") and b not in (None, "") and abs(float(a) - float(b)) < 0.005)
        except (TypeError, ValueError):
            return False
    return _chave(a) == _chave(b)


def _chaves(it):
    """Como achar o mesmo processo: pelo nº do processo; sem nº, pelo cliente + código."""
    num = _chave(it.get("numero"))
    if num:
        return (it["tipo"], "n", num)
    return (it["tipo"], "p", _chave(it.get("parte")), _chave(it.get("codigo_cliente")))


def _parear(lista):
    """{chave: [itens na ordem]}: o mesmo nº em duas linhas pareia 1ª com 1ª, 2ª com 2ª."""
    d = {}
    for it in lista:
        d.setdefault(_chaves(it), []).append(it)
    return d


def planejar(itens, base_itens=None):
    """Compara a planilha com o sistema (e com a planilha da última importação, se houver) e devolve o que fazer.
    Regra: o que mudou na planilha entra no sistema, a não ser que alguém já tenha mudado o mesmo campo no BI
    (aí fica o do BI e aparece como conflito). Nada é apagado."""
    from sqlalchemy import select as sel
    with engine.connect() as c:
        db = [dict(r._mapping) for r in c.execute(sel(processos).where(processos.c.excluido.is_(False)).order_by(processos.c.id))]
        excl = [dict(r._mapping) for r in c.execute(sel(processos).where(processos.c.excluido.is_(True)))]
        ands = {}
        for r in c.execute(sel(andamentos.c.processo_id, andamentos.c.texto)):
            ands.setdefault(r.processo_id, set()).add(_chave(r.texto))
        cus = {}
        for r in c.execute(sel(custas.c.processo_id, custas.c.tipo, custas.c.vencimento, custas.c.link).where(custas.c.excluido.is_(False))):
            cus.setdefault(r.processo_id, []).append((r.tipo, r.vencimento, r.link or ""))
        links = {}
        for r in c.execute(sel(anexos.c.processo_id, anexos.c.link).where(anexos.c.excluido.is_(False))):
            links.setdefault(r.processo_id, set()).add(r.link or "")
    pdb, pex = _parear(db), _parear(excl)
    pbase = _parear(base_itens or [])
    usados = set()
    def por_cliente(it, lista):
        """Sem achar pelo nº (nº mudou ou foi digitado errado): mesmo cliente + código, ainda não pareado."""
        alvo = (it["tipo"], _chave(it.get("parte")), _chave(it.get("codigo_cliente")))
        if not alvo[1]:
            return None
        for x in lista:
            if (x["tipo"], _chave(x.get("parte")), _chave(x.get("codigo_cliente"))) == alvo and id(x) not in usados and x.get("id") not in usados:
                return x
        return None
    plano = {"novos": [], "campos": [], "conflitos": [], "andamentos": [], "custas": [], "custas_alt": [], "pagamentos": [],
             "anexos": [], "ignorados": []}
    base_linha = {(b["tipo"], b.get("linha")): b for b in (base_itens or []) if b.get("linha")}
    db_por_id = {x["id"]: x for x in db}
    pago_db = {x["id"]: float(x.get("valor_pago") or 0) for x in db}
    cus_db = {}
    from sqlalchemy import select as sel2
    with engine.connect() as c:
        for r in c.execute(sel2(custas.c.id, custas.c.processo_id, custas.c.tipo, custas.c.vencimento).where(
                custas.c.excluido.is_(False), custas.c.pago.is_(False))):
            cus_db.setdefault(r.processo_id, []).append(r)
    _todas = set(_parear(itens).keys())
    for k, lst in _parear(itens).items():
        for i, it in enumerate(lst):
            base = pbase.get(k, [None] * (i + 1))[i] if i < len(pbase.get(k, [])) else None
            p = pdb.get(k, [])[i] if i < len(pdb.get(k, [])) else None
            if p is None:
                p = por_cliente(it, [x for x in db if x["id"] not in usados and _chaves(x) not in _todas])
                if base is None:
                    base = por_cliente(it, [x for x in (base_itens or []) if _chaves(x) not in _todas])
            if p is None and it.get("linha"):
                # mesma linha da última versão, cujo processo sumiu da planilha: foi a linha que alguém editou (nº ou nome)
                b = base_linha.get((it["tipo"], it["linha"]))
                if b is not None and _chaves(b) not in _todas:
                    kb = _chaves(b)
                    cand = [x for x in pdb.get(kb, []) if x["id"] not in usados]
                    if cand:
                        p, base = cand[0], b
            if p is not None:
                usados.add(p["id"])
            rotulo = f'{it.get("parte") or "(sem nome)"} ({it.get("numero") or "sem nº"})'
            if p is None:
                if i < len(pex.get(k, [])) or base is not None:
                    plano["ignorados"].append({"processo": rotulo, "motivo": "foi excluído no BI ou mudou de nº no BI; não volta"})
                else:
                    plano["novos"].append(it)
                continue
            pid = p["id"]
            for f in CAMPOS_MESCLA:
                novo = it.get(f)
                if f == "uf" and it["tipo"] == "cobranca":
                    continue
                if novo in (None, "") and p.get(f) not in (None, ""):
                    continue  # célula vazia na planilha não apaga o que tem no BI
                if _igual(novo, p.get(f)):
                    continue
                mudou_planilha = base is None or not _igual(novo, base.get(f))
                mudou_bi = base is not None and not _igual(p.get(f), base.get(f))
                if not mudou_planilha:
                    continue  # quem mudou foi o BI: fica o do BI
                item = {"processo_id": pid, "processo": rotulo, "campo": f, "nome": NOMES_MESCLA[f], "de": p.get(f), "para": novo}
                if f == "numero" and p.get("numero"):
                    item["motivo"] = "nº do processo diferente: confira qual está certo"
                    plano["conflitos"].append(item)
                elif mudou_bi or base is None:
                    item["motivo"] = "mudou no BI e na planilha" if mudou_bi else "sem a planilha anterior para comparar"
                    plano["conflitos"].append(item)
                else:
                    plano["campos"].append(item)
            if it.get("andamento") and _chave(it["andamento"]) not in ands.get(pid, set()) and \
                    (base is None or _chave(it["andamento"]) != _chave(base.get("andamento"))):
                plano["andamentos"].append({"processo_id": pid, "processo": rotulo, "texto": it["andamento"]})
            for cu in it["custas"]:
                def mesmo_tipo(t):  # a coluna "Custas - Serviço" (e a "Custas" dos diversos) junta vários tipos
                    return t == cu["tipo"] or it["tipo"] == "diversos" or (cu["tipo"] == "Serviço" and t != "Inicial")
                ja = any((mesmo_tipo(t) and v == cu["vencimento"]) or (cu["link"] and l == cu["link"]) for t, v, l in cus.get(pid, []))
                if ja:
                    continue
                # data trocada na planilha: a custa em aberto do mesmo tipo que estava na versão anterior muda de data
                antes = [b for b in (base or {}).get("custas", []) if b["tipo"] == cu["tipo"] and b["vencimento"]] if base else []
                alvo = next((r for r in cus_db.get(pid, []) for b in antes if mesmo_tipo(r.tipo) and r.vencimento == b["vencimento"]), None)
                if alvo is not None and cu["vencimento"]:
                    plano["custas_alt"].append({"custa_id": alvo.id, "processo_id": pid, "processo": rotulo, "tipo": cu["tipo"],
                                                "de": alvo.vencimento, "para": cu["vencimento"], "link": cu["link"]})
                else:
                    plano["custas"].append({"processo_id": pid, "processo": rotulo, **cu})
            # valor pago mexido na planilha: a diferença vira um pagamento (o valor pago do BI é a soma dos pagamentos)
            if base is not None and it.get("valor_pago") is not None and not _igual(it.get("valor_pago"), base.get("valor_pago")) \
                    and not _igual(it.get("valor_pago"), pago_db.get(pid, 0)):
                if _igual(pago_db.get(pid, 0), base.get("valor_pago") or 0):
                    dif = round(float(it["valor_pago"]) - pago_db.get(pid, 0), 2)
                    if abs(dif) >= 0.01:
                        plano["pagamentos"].append({"processo_id": pid, "processo": rotulo, "valor": dif})
                else:
                    plano["conflitos"].append({"processo_id": pid, "processo": rotulo, "campo": "valor_pago", "nome": "Valor pago",
                                               "de": pago_db.get(pid), "para": it["valor_pago"], "motivo": "mudou no BI e na planilha"})
            for a in it["anexos"]:
                if a["link"] and a["link"] not in links.get(pid, set()):
                    plano["anexos"].append({"processo_id": pid, "processo": rotulo, **a})
    return plano


def aplicar(plano, quem):
    """Grava o plano numa transação só. Cada mudança fica no histórico."""
    from sqlalchemy import update as upd
    n = {"novos": 0, "campos": 0, "andamentos": 0, "custas": 0, "anexos": 0, "pagamentos": 0}
    if plano["novos"]:
        r = gravar(plano["novos"], quem, origem="atualização pela planilha")
        n["novos"] = r["processos"]
    with engine.begin() as conn:
        por_proc = {}
        for m in plano["campos"]:
            por_proc.setdefault(m["processo_id"], []).append(m)
        for pid, ms in por_proc.items():
            conn.execute(upd(processos).where(processos.c.id == pid).values(**{m["campo"]: m["para"] for m in ms}, atualizado_em=agora()))
            registrar(conn, quem, "Atualizado pela planilha", pid, [{"campo": m["nome"], "de": m["de"], "para": m["para"]} for m in ms])
            n["campos"] += len(ms)
        for a in plano["andamentos"]:
            conn.execute(insert(andamentos).values(processo_id=a["processo_id"], texto=a["texto"], por="Planilha Jurídico", em=agora()))
            registrar(conn, quem, "Andamento trazido da planilha", a["processo_id"], a["texto"][:300])
            n["andamentos"] += 1
        for cu in plano["custas"]:
            conn.execute(insert(custas).values(processo_id=cu["processo_id"], tipo=cu["tipo"], descricao=cu["descricao"], valor=None,
                                               vencimento=cu["vencimento"], link=cu["link"], pago=False, criado_por="Planilha Jurídico",
                                               criado_em=agora(), excluido=False))
            registrar(conn, quem, "Custa trazida da planilha", cu["processo_id"], {"tipo": cu["tipo"], "vencimento": cu["vencimento"]})
            n["custas"] += 1
        for cu in plano.get("custas_alt", []):
            vals = {"vencimento": cu["para"]}
            if cu["link"]:
                vals["link"] = cu["link"]
            conn.execute(upd(custas).where(custas.c.id == cu["custa_id"]).values(**vals))
            registrar(conn, quem, "Vencimento de custa mudado na planilha", cu["processo_id"], {"tipo": cu["tipo"], "de": cu["de"], "para": cu["para"]})
            n["custas"] += 1
        if plano.get("pagamentos"):
            from db import pagamentos as pg
            from sqlalchemy import func as fn
            for g in plano["pagamentos"]:
                conn.execute(insert(pg).values(processo_id=g["processo_id"], data=agora().date(), valor=g["valor"],
                                               descricao="Ajuste do valor pago feito na planilha", criado_por=(quem or {}).get("nome", "Planilha"),
                                               criado_em=agora(), excluido=False))
                tot = conn.execute(select(fn.sum(pg.c.valor)).where(pg.c.processo_id == g["processo_id"], pg.c.excluido.is_(False))).scalar()
                conn.execute(upd(processos).where(processos.c.id == g["processo_id"]).values(valor_pago=round(float(tot), 2) if tot else None))
                registrar(conn, quem, "Pagamento lançado pela planilha", g["processo_id"], {"valor": g["valor"], "total_pago": tot})
                n["pagamentos"] += 1
        for cf in plano["conflitos"]:
            if cf.get("motivo") == "mudou no BI e na planilha":
                registrar(conn, quem, "Conflito com a planilha: ficou o valor do BI", cf["processo_id"],
                          {"campo": cf["nome"], "no_bi": cf["de"], "na_planilha": cf["para"]})
        for a in plano["anexos"]:
            conn.execute(insert(anexos).values(processo_id=a["processo_id"], categoria=a["categoria"], nome=a["nome"], link=a["link"],
                                               arquivo="", por="Planilha Jurídico", em=agora(), excluido=False))
            registrar(conn, quem, "Anexo trazido da planilha", a["processo_id"], {"link": a["link"]})
            n["anexos"] += 1
        registrar(conn, quem, "Atualização pela planilha", detalhes={**n, "conflitos": len(plano["conflitos"]), "ignorados": len(plano["ignorados"])})
    return n


if __name__ == "__main__":
    import sys
    from db import criar_tabelas
    criar_tabelas()
    itens, avisos = limpar(ler(sys.argv[1]))
    print(gravar(itens, None), avisos)
