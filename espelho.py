"""
Planilha espelho: uma cópia da planilha "Jurídico" que o sistema mantém atualizada.

- Nos dois sentidos: a cada minuto o sistema confere se a planilha foi editada. Se foi (e ninguém mexe nela há
  QUIETO segundos), traz para o BI o que mudou desde a última escrita; depois reescreve a planilha com o BI.
  Mesmo campo mudado no BI e na planilha: fica o do BI (conflito no histórico). Linha apagada na planilha volta.
- Só as abas "Cobrança" e "Processos Diversos" são reescritas, a partir da linha
  seguinte ao cabeçalho. Cabeçalho, totais do topo, fórmulas, formatação e listas
  de opções ficam como estão. As outras abas não são tocadas.
- A cada minuto confere se houve alguma alteração (pelo histórico). Se houve,
  reescreve as duas abas inteiras (são poucas centenas de linhas).

Variáveis: ESPELHO_PLANILHA_ID e GOOGLE_CREDENTIALS_JSON (conta de serviço com acesso de editor).
"""

import json
import os
import threading
import time
from datetime import date

from sqlalchemy import func, select

PLANILHA_ID = os.environ.get("ESPELHO_PLANILHA_ID", "").strip()
INTERVALO = int(os.environ.get("ESPELHO_INTERVALO", "60"))
QUIETO = int(os.environ.get("ESPELHO_QUIETO", "120"))  # espera a planilha ficar parada esse tempo antes de ler/escrever
DOIS_SENTIDOS = os.environ.get("ESPELHO_DOIS_SENTIDOS", "1") == "1"
ESCOPOS = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.readonly"]
ESTADO = {"ultima": None, "erro": None, "linhas": 0, "historico_id": None, "rodando": False, "trazido": None}
_trava = threading.Lock()


def configurado():
    return bool(PLANILHA_ID and os.environ.get("GOOGLE_CREDENTIALS_JSON", "").strip())


def url():
    return f"https://docs.google.com/spreadsheets/d/{PLANILHA_ID}/edit" if PLANILHA_ID else ""


def _br(d):
    if not d:
        return ""
    if isinstance(d, str):
        d = date.fromisoformat(d[:10])
    return d.strftime("%d/%m/%Y")


def _num(v):
    return "" if v is None else float(v)


SEP = {"v": ";"}  # separador de argumentos das fórmulas: depende do idioma da planilha (pt_BR usa ponto e vírgula)


def _link(nome, link):
    """Nome com o link do Drive (como na planilha original)."""
    if not link:
        return nome
    return '=HYPERLINK("{}"{}"{}")'.format(link.replace('"', '""'), SEP["v"], (nome or "Abrir").replace('"', '""'))


def _cred():
    from google.oauth2.service_account import Credentials
    return Credentials.from_service_account_info(json.loads(os.environ["GOOGLE_CREDENTIALS_JSON"]), scopes=ESCOPOS)


def _pasta():
    p = os.path.join(os.path.abspath(os.environ.get("PASTA_DADOS", "data")), "importacoes")
    os.makedirs(p, exist_ok=True)
    return p


BASE = "base_planilha.xlsx"  # como a planilha ficou depois da última escrita do sistema


def meta():
    """modifiedTime e quem editou por último (Drive)."""
    from google.auth.transport.requests import AuthorizedSession
    r = AuthorizedSession(_cred()).get(f"https://www.googleapis.com/drive/v3/files/{PLANILHA_ID}",
                                       params={"fields": "modifiedTime,lastModifyingUser(displayName,emailAddress)"}, timeout=30)
    r.raise_for_status()
    return r.json()


def _ts(iso):
    from datetime import datetime, timezone
    return datetime.strptime(iso[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp()


def _guardar_base():
    """Depois de escrever: baixa a planilha e guarda como base; anota o modifiedTime visto."""
    from db import config_gravar, engine
    caminho = os.path.join(_pasta(), BASE)
    baixar_xlsx(caminho + ".tmp")
    os.replace(caminho + ".tmp", caminho)
    m = meta()
    with engine.begin() as c:
        config_gravar(c, "planilha_base", BASE)
        config_gravar(c, "planilha_vista", m.get("modifiedTime", ""))


def trazer(m=None):
    """Lê a planilha e traz para o BI o que mudou desde a última escrita do sistema. Devolve o resumo."""
    import importar
    from db import config_gravar, engine
    m = m or meta()
    quem_ed = (m.get("lastModifyingUser") or {})
    caminho = os.path.join(_pasta(), "previas", f"auto_{time.strftime('%Y%m%d_%H%M%S')}.xlsx")
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    baixar_xlsx(caminho)
    base = os.path.join(_pasta(), BASE)
    try:
        itens, _ = importar.limpar(importar.ler(caminho))
        base_itens = importar.limpar(importar.ler(base))[0] if os.path.exists(base) else None
        pl = importar.planejar(itens, base_itens)
        tot = sum(len(pl[k]) for k in ("novos", "campos", "andamentos", "custas", "custas_alt", "pagamentos", "anexos"))
        n = None
        if tot or any(c.get("motivo") == "mudou no BI e na planilha" for c in pl["conflitos"]):
            nome = quem_ed.get("displayName") or quem_ed.get("emailAddress") or ""
            quem = {"usuario": "planilha", "nome": f"Planilha Google{' (última edição: ' + nome + ')' if nome else ''}"}
            n = importar.aplicar(pl, quem)
            ESTADO["trazido"] = {"em": time.strftime("%Y-%m-%d %H:%M"), **n}
            print("Trazido da planilha:", n, flush=True)
        with engine.begin() as c:
            config_gravar(c, "planilha_vista", m.get("modifiedTime", ""))
        return n
    finally:
        try:
            os.remove(caminho)
        except OSError:
            pass


def montar_linhas():
    """Devolve (linhas_cobranca, linhas_diversos) no formato das colunas da planilha original."""
    from db import andamentos, anexos, custas, engine, processos
    with engine.connect() as c:
        ps = c.execute(select(processos).where(processos.c.excluido.is_(False), func.coalesce(processos.c.autorizacao, "") == "")
                       .order_by(processos.c.id)).mappings().all()  # cobranças aguardando autorização ficam de fora
        sub = select(andamentos.c.processo_id, func.max(andamentos.c.id).label("mid")).where(
            ~andamentos.c.texto.like("Conferir:%")).group_by(andamentos.c.processo_id).subquery()
        ult = dict(c.execute(select(andamentos.c.processo_id, andamentos.c.texto).join(sub, andamentos.c.id == sub.c.mid)).all())
        nota = {}
        for r in c.execute(select(anexos.c.processo_id, anexos.c.link, anexos.c.arquivo, anexos.c.id).where(
                anexos.c.excluido.is_(False), anexos.c.categoria == "Nota", anexos.c.custa_id.is_(None)).order_by(anexos.c.id)):
            nota.setdefault(r.processo_id, r.link or "")
        cs = {}
        for r in c.execute(select(custas).where(custas.c.excluido.is_(False), custas.c.pago.is_(False)).order_by(custas.c.vencimento)).mappings():
            cs.setdefault(r["processo_id"], []).append(r)

    def _cel(cu):
        """Data do vencimento, com o link do boleto do Drive quando tiver (como na planilha original)."""
        return _link(_br(cu["vencimento"]), cu["link"]) if cu["link"] else _br(cu["vencimento"])

    def proxima(pid):
        """Vencimento da próxima custa em aberto (qualquer tipo)."""
        for cu in cs.get(pid, []):
            if cu["vencimento"]:
                return _cel(cu)
        return ""

    def custa(pid, inicial):
        """Custas - Inicial: tipo Inicial. Custas - Serviço: os demais tipos (serviço, cartório, complementar...)."""
        for cu in cs.get(pid, []):
            if cu["vencimento"] and ((cu["tipo"] == "Inicial") == inicial):
                return _cel(cu)
        return ""

    cob, div = [], []
    for p in ps:
        if p["tipo"] == "cobranca":
            cob.append([p["loja"] or "", p["carteira"] or "", p["ano"] or "", p["codigo_cliente"] or "", _link(p["parte"], nota.get(p["id"])),
                        p["documento"] or "", _num(p["valor"]), ult.get(p["id"], ""), p["status"] or "", p["numero"] or "",
                        _num(p["valor_acordo"]), _num(p["valor_pago"]), custa(p["id"], True), custa(p["id"], False)])
        else:
            div.append([p["identificacao"] or "", p["numero"] or "", p["tipo_acao"] or "", p["loja"] or "", p["uf"] or "", p["ano"] or "",
                        p["parte"] or "", p["teor"] or "", p["status"] or "", _num(p["valor"]), _num(p["valor_pago"]), proxima(p["id"])])
    return cob, div


def _cabecalho(ws, chave):
    """Linha do cabeçalho (onde está 'Loja' ou 'Identificação')."""
    col = ws.get("A1:E30")
    for i, linha in enumerate(col, start=1):
        if any(str(v).strip().lower().startswith(chave) for v in linha):
            return i
    raise ValueError(f'Cabeçalho não encontrado na aba "{ws.title}".')


def _protege(v):
    """Texto que começa com = + - @ viraria fórmula (ex.: "+ FRIO AR..."): o apóstrofo faz o Sheets guardar como texto."""
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@") and not v.upper().startswith("=HYPERLINK("):
        return "'" + v
    return v


def _escrever(ws, linha_cab, linhas, ultima_col):
    linhas = [[_protege(v) for v in ln] for ln in linhas]
    inicio = linha_cab + 1
    total = max(ws.row_count, inicio + len(linhas) + 50)
    if total > ws.row_count:
        ws.add_rows(total - ws.row_count)
    ws.batch_clear([f"A{inicio}:{ultima_col}{ws.row_count}"])  # só valores; formatação e listas ficam
    if linhas:
        ws.update(range_name=f"A{inicio}:{ultima_col}{inicio + len(linhas) - 1}", values=linhas, value_input_option="USER_ENTERED")


def sincronizar(motivo="alteracao"):
    if not configurado():
        ESTADO["erro"] = "Falta configurar ESPELHO_PLANILHA_ID e GOOGLE_CREDENTIALS_JSON no Railway."
        return False
    from db import config_ler
    if config_ler(f"espelho_ok_{PLANILHA_ID}", "") != "1":
        # trava: só escreve nesta planilha depois de trazer para o BI o que foi lançado nela (Atualizar pela planilha)
        ESTADO["erro"] = "Aguardando a primeira Atualização pela planilha: antes de escrever nela, o sistema traz o que foi lançado na planilha."
        return False
    import gspread
    with _trava:
        ESTADO["rodando"] = True
        try:
            from db import engine, historico
            with engine.connect() as c:
                hid = c.execute(select(func.max(historico.c.id))).scalar()
            planilha = gspread.authorize(_cred()).open_by_key(PLANILHA_ID)
            loc = (planilha.fetch_sheet_metadata().get("properties", {}).get("locale") or "pt_BR").lower()
            SEP["v"] = "," if loc.split("_")[0] in ("en", "ja", "zh", "ko", "th", "he", "iw") else ";"
            abas = {ws.title.strip().lower(): ws for ws in planilha.worksheets()}
            cob, div = montar_linhas()
            ws = abas.get("cobrança")
            if not ws:
                raise ValueError('A planilha espelho não tem a aba "Cobrança".')
            _escrever(ws, _cabecalho(ws, "loja"), cob, "N")
            ws = abas.get("processos diversos")
            if not ws:
                raise ValueError('A planilha espelho não tem a aba "Processos Diversos".')
            _escrever(ws, _cabecalho(ws, "identifica"), div, "L")
            ESTADO.update(ultima=time.strftime("%Y-%m-%d %H:%M"), erro=None, linhas=len(cob) + len(div), historico_id=hid)
            if DOIS_SENTIDOS:
                _guardar_base()
            return True
        except Exception as e:  # o espelho nunca derruba o sistema
            ESTADO["erro"] = f"{type(e).__name__}: {e}"[:400]
            print("Falha no espelho da planilha:", ESTADO["erro"], flush=True)
            return False
        finally:
            ESTADO["rodando"] = False


def baixar_xlsx(caminho):
    """Baixa a planilha (como .xlsx) direto do Google, para o "Atualizar pela planilha"."""
    if not configurado():
        raise ValueError("Falta configurar ESPELHO_PLANILHA_ID e GOOGLE_CREDENTIALS_JSON no Railway.")
    import gspread
    dados = gspread.authorize(_cred()).export(PLANILHA_ID, format="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    with open(caminho, "wb") as f:
        f.write(dados)
    return caminho


def rotina():
    """Confere a cada INTERVALO segundos se o histórico mudou; se mudou, reescreve a planilha."""
    if not configurado() or os.environ.get("ESPELHO_AUTOMATICO", "1") != "1":
        return

    def loop():
        time.sleep(20)
        while True:
            try:
                from db import config_ler, engine, historico
                liberado = config_ler(f"espelho_ok_{PLANILHA_ID}", "") == "1"
                if liberado and DOIS_SENTIDOS:
                    m = meta()
                    mod = m.get("modifiedTime", "")
                    if not os.path.exists(os.path.join(_pasta(), BASE)):
                        ESTADO["historico_id"] = None  # primeira vez nos dois sentidos: escreve e guarda a base antes de ler
                    elif mod and mod != config_ler("planilha_vista", ""):
                        if time.time() - _ts(mod) < QUIETO:
                            time.sleep(INTERVALO)  # alguém está mexendo na planilha: espera parar para não atropelar
                            continue
                        with _trava:
                            trazer(m)
                with engine.connect() as c:
                    hid = c.execute(select(func.max(historico.c.id))).scalar()
                if hid != ESTADO["historico_id"]:
                    sincronizar()
            except Exception as e:
                ESTADO["erro"] = f"{type(e).__name__}: {e}"[:400]
                print("Falha ao conferir o espelho:", e, flush=True)
            time.sleep(INTERVALO)
    threading.Thread(target=loop, daemon=True, name="espelho").start()
