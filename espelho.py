"""
Planilha espelho: uma cópia da planilha "Jurídico" que o sistema mantém atualizada.

- O sistema ESCREVE na planilha; o que for digitado nela não volta para o sistema.
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
ESTADO = {"ultima": None, "erro": None, "linhas": 0, "historico_id": None, "rodando": False}
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


def _link(nome, link):
    """Nome com o link do Drive (como na planilha original). Fórmulas pela API usam vírgula."""
    if not link:
        return nome
    return '=HYPERLINK("{}","{}")'.format(link.replace('"', '""'), (nome or "Abrir").replace('"', '""'))


def montar_linhas():
    """Devolve (linhas_cobranca, linhas_diversos) no formato das colunas da planilha original."""
    from db import andamentos, anexos, custas, engine, processos
    with engine.connect() as c:
        ps = c.execute(select(processos).where(processos.c.excluido.is_(False)).order_by(processos.c.id)).mappings().all()
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

    def proxima(pid):
        """Vencimento da próxima custa em aberto (qualquer tipo)."""
        for cu in cs.get(pid, []):
            if cu["vencimento"]:
                return _br(cu["vencimento"])
        return ""

    def custa(pid, inicial):
        """Custas - Inicial: tipo Inicial. Custas - Serviço: os demais tipos (serviço, cartório, complementar...)."""
        for cu in cs.get(pid, []):
            if cu["vencimento"] and ((cu["tipo"] == "Inicial") == inicial):
                return _br(cu["vencimento"])
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


def _escrever(ws, linha_cab, linhas, ultima_col):
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
    import gspread
    from google.oauth2.service_account import Credentials
    with _trava:
        ESTADO["rodando"] = True
        try:
            from db import engine, historico
            with engine.connect() as c:
                hid = c.execute(select(func.max(historico.c.id))).scalar()
            cred = Credentials.from_service_account_info(json.loads(os.environ["GOOGLE_CREDENTIALS_JSON"]),
                                                         scopes=["https://www.googleapis.com/auth/spreadsheets"])
            planilha = gspread.authorize(cred).open_by_key(PLANILHA_ID)
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
            return True
        except Exception as e:  # o espelho nunca derruba o sistema
            ESTADO["erro"] = f"{type(e).__name__}: {e}"[:400]
            print("Falha no espelho da planilha:", ESTADO["erro"], flush=True)
            return False
        finally:
            ESTADO["rodando"] = False


def rotina():
    """Confere a cada INTERVALO segundos se o histórico mudou; se mudou, reescreve a planilha."""
    if not configurado() or os.environ.get("ESPELHO_AUTOMATICO", "1") != "1":
        return

    def loop():
        time.sleep(20)
        while True:
            try:
                from db import engine, historico
                with engine.connect() as c:
                    hid = c.execute(select(func.max(historico.c.id))).scalar()
                if hid != ESTADO["historico_id"]:
                    sincronizar()
            except Exception as e:
                print("Falha ao conferir o espelho:", e, flush=True)
            time.sleep(INTERVALO)
    threading.Thread(target=loop, daemon=True, name="espelho").start()
