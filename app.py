"""
BI Jurídico Densul: servidor web.

- login individual (cada pessoa com usuário e senha; primeiro acesso com a senha padrão);
- perfis: Administrador, Jurídico e Financeiro, cada um mexe só no que é dele;
- lojas: o usuário pode ficar restrito a uma ou mais lojas;
- tudo que muda fica no histórico (quem, quando, de quanto para quanto);
- backups automáticos no volume do Railway (diário e antes de cada atualização do sistema).

As regras de permissão ficam aqui no servidor (e não só na tela), porque a tela pode ser burlada.
"""

import hmac
import json
import re
import secrets
import os
import threading
import time
from datetime import date, datetime, timedelta
from functools import wraps

from dotenv import load_dotenv
from flask import Flask, abort, jsonify, redirect, render_template, request, send_from_directory, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

load_dotenv()

import backup  # noqa: E402
import espelho  # noqa: E402
from db import (CATEGORIAS_ANEXO, IDENTIFICACOES, PERFIS, STATUS, TIPOS_AUDIENCIA, TIPOS_CUSTA, agora, andamentos,  # noqa: E402
                anexos, audiencias, config_gravar, config_ler, criar_tabelas, custas, engine, garantir_admin, historico, linha,
                lojas, processos, registrar, usuarios)
from sqlalchemy import and_, func, insert, select, update  # noqa: E402

app = Flask(__name__)
app.secret_key = os.environ["SECRET_KEY"]
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SEGURO", "1") == "1",
    PERMANENT_SESSION_LIFETIME=60 * 60 * 24 * 30,
    MAX_CONTENT_LENGTH=60 * 1024 * 1024,
)

PASTA_DADOS = os.path.abspath(os.environ.get("PASTA_DADOS", "data"))
PASTA_ANEXOS = os.path.join(PASTA_DADOS, "anexos")
os.makedirs(PASTA_ANEXOS, exist_ok=True)
SENHA_PADRAO = os.environ.get("SENHA_PADRAO", "")
SENHA_MINIMA = 6
EXTENSOES = (".pdf", ".jpg", ".jpeg", ".png", ".webp", ".heic", ".doc", ".docx", ".xls", ".xlsx", ".txt", ".zip")

# ---------- subida: backup antes da atualização, tabelas e admin padrão ----------
backup.antes_de_atualizar()      # se o código mudou desde a última vez, guarda uma cópia dos dados antes de mexer
criar_tabelas()
garantir_admin(os.environ.get("ADMIN_USUARIO", "admin").strip().lower(), os.environ.get("ADMIN_NOME", "Administrador"))


def _reset_pelo_railway():
    """Senha esquecida do administrador: no Railway, crie RESETAR_SENHA=<usuário> (ex.: admin).
    Ao reiniciar, a senha desse usuário volta para a SENHA_PADRAO uma única vez, mesmo que a variável continue lá.
    Para resetar de novo no futuro, mude o valor (ex.: admin#2)."""
    pedido = os.environ.get("RESETAR_SENHA", "").strip()
    if not pedido:
        return
    marca = os.path.join(PASTA_DADOS, "resets_feitos.txt")
    feitos = open(marca).read().split("\n") if os.path.exists(marca) else []
    if pedido in feitos:
        return
    with engine.begin() as c:
        for nome in [p.split("#")[0].strip().lower() for p in pedido.split(",")]:
            r = c.execute(select(usuarios).where(usuarios.c.usuario == nome)).first()
            if r:
                c.execute(update(usuarios).where(usuarios.c.id == r.id).values(hash=None, v=(r.v or 0) + 1))
                registrar(c, None, "Senha voltou para a padrão (pelo Railway)", detalhes={"usuario": nome})
    with open(marca, "a") as f:
        f.write(pedido + "\n")


_reset_pelo_railway()


def _criar_pelo_railway():
    """Criar um usuário sem entrar no sistema (ex.: o primeiro administrador além do admin):
    no Railway, CRIAR_USUARIO=usuario|Nome|perfil|autoriza(sim/nao) e SENHA_INICIAL=<senha provisória>.
    Roda uma única vez por valor; a pessoa é obrigada a criar a própria senha no primeiro acesso.
    Depois de criado, apague as duas variáveis."""
    pedido = os.environ.get("CRIAR_USUARIO", "").strip()
    senha = os.environ.get("SENHA_INICIAL", "")
    if not pedido or len(senha) < SENHA_MINIMA:
        return
    marca = os.path.join(PASTA_DADOS, "usuarios_criados.txt")
    feitos = open(marca).read().split("\n") if os.path.exists(marca) else []
    if pedido in feitos:
        return
    partes = [x.strip() for x in pedido.split("|")]
    if len(partes) < 3 or partes[2] not in PERFIS:
        print("CRIAR_USUARIO inválido:", pedido, flush=True)
        return
    usuario, nome, perfil = partes[0].lower(), partes[1], partes[2]
    autoriza = len(partes) > 3 and partes[3].lower() in ("sim", "1", "true")
    with engine.begin() as c:
        if not c.execute(select(usuarios.c.id).where(usuarios.c.usuario == usuario)).first():
            c.execute(insert(usuarios).values(usuario=usuario, nome=nome, perfil=perfil, lojas="", hash=generate_password_hash(senha), v=1,
                                              ativo=True, autoriza=autoriza, trocar_senha=True, criado_em=agora()))
            registrar(c, None, "Usuário criado (pelo Railway)", detalhes={"usuario": usuario, "perfil": perfil, "autoriza": autoriza})
    with open(marca, "a") as f:
        f.write(pedido + "\n")


_criar_pelo_railway()


# ---------- usuário logado ----------

def _usuario(uid):
    with engine.connect() as c:
        r = c.execute(select(usuarios).where(usuarios.c.id == uid)).first()
    return linha(r) if r else None


def eu():
    """Usuário da sessão (recarregado do banco a cada requisição)."""
    return getattr(request, "_eu", None)


def lojas_de(u):
    return [x for x in (u.get("lojas") or "").split("|") if x]


def pode(acao, u=None):
    u = u or eu()
    p = u["perfil"]
    regras = {
        "editar_juridico": p in ("admin", "juridico"),     # criar/editar processo, status, andamento, custas, audiências
        "editar_financeiro": p in ("admin", "financeiro"),  # valor pago, conferido, pagar custa
        "anexar": p != "leitura",
        "admin": p == "admin",
        "autorizar": p != "leitura" and bool(u.get("autoriza")),  # autoriza cobranças novas (ex.: Juliana)
    }
    return regras[acao]


def _filtro_lojas(u):
    ls = lojas_de(u)
    return processos.c.loja.in_(ls) if ls else None


def _ip():
    return request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0].strip()


_tentativas = {}


def _limite(ip):
    janela = [t for t in _tentativas.get(ip, []) if time.time() - t < 600]
    _tentativas[ip] = janela
    return len(janela) >= 8


# Quem entra pelo link de apresentação: só vê, sem login. Não é um usuário do banco.
VISITANTE = {"id": 0, "usuario": "apresentacao", "nome": "Apresentação (link sem login)", "perfil": "leitura", "lojas": "",
             "hash": "-", "ativo": True, "v": 0, "autoriza": False}


def _token_apresentacao():
    return config_ler("apresentacao_token", "")


def logado(f):
    @wraps(f)
    def w(*a, **k):
        if session.get("apresentacao"):
            tok = _token_apresentacao()
            if tok and hmac.compare_digest(session["apresentacao"], tok):
                request._eu = dict(VISITANTE)
                if request.method in ("POST", "DELETE"):
                    return jsonify(erro="Este é um link só de visualização."), 403
                return f(*a, **k)
            session.clear()  # link trocado ou desativado
            if request.path.startswith("/api/"):
                return jsonify(erro="Este link de apresentação foi desativado."), 401
            return redirect(url_for("login"))
        u = _usuario(session.get("uid")) if session.get("uid") else None
        if u and (not u["ativo"] or u["v"] != session.get("v")):
            u = None
            session.clear()
        if not u:
            if request.path.startswith("/api/"):
                return jsonify(erro="Sessão expirada. Entre de novo."), 401
            return redirect(url_for("login"))
        request._eu = u
        if not u["hash"] or u.get("trocar_senha"):
            if request.path.startswith("/api/"):
                return jsonify(erro="Crie a sua senha antes de continuar."), 403
            return redirect(url_for("trocar_senha"))
        if request.method in ("POST", "DELETE") and request.headers.get("X-Requested-With") != "fetch":
            abort(400)  # proteção simples contra envio de formulário de outro site
        return f(*a, **k)
    return w


def so(acao):
    def deco(f):
        @wraps(f)
        def w(*a, **k):
            if not pode(acao):
                return jsonify(erro="Seu perfil não tem permissão para isso."), 403
            return f(*a, **k)
        return w
    return deco


def corpo():
    return request.get_json(silent=True) or {}


# ---------- login ----------

@app.route("/login", methods=["GET", "POST"])
def login():
    erro = None
    if request.method == "POST":
        ip = _ip()
        if _limite(ip):
            erro = "Muitas tentativas. Espere alguns minutos."
        else:
            nome = request.form.get("usuario", "").strip().lower()
            senha = request.form.get("senha", "")
            with engine.connect() as c:
                r = c.execute(select(usuarios).where(usuarios.c.usuario == nome)).first()
            u = linha(r) if r else None
            ok = False
            if u and u["ativo"]:
                if u["hash"]:
                    ok = check_password_hash(u["hash"], senha)
                else:
                    ok = bool(SENHA_PADRAO) and hmac.compare_digest(senha.encode(), SENHA_PADRAO.encode())
            if ok:
                session.clear()
                session.permanent = True
                session.update(uid=u["id"], v=u["v"])
                _tentativas.pop(ip, None)
                with engine.begin() as c:
                    registrar(c, u, "Entrou no sistema")
                return redirect(url_for("trocar_senha" if not u["hash"] or u.get("trocar_senha") else "index"))
            _tentativas.setdefault(ip, []).append(time.time())
            erro = "Usuário ou senha incorretos."
            with engine.begin() as c:
                if u:
                    registrar(c, u, "Tentativa de entrar com senha errada")
                else:  # não grava o texto digitado: pode ser uma senha digitada no campo errado
                    registrar(c, {"usuario": "?", "nome": "Desconhecido"}, "Tentativa de entrar com usuário inexistente")
    return render_template("login.html", erro=erro)


@app.route("/ver/<token>")
def ver_apresentacao(token):
    """Link de apresentação: entra só para ver, sem usuário e senha."""
    ip = _ip()
    tok = _token_apresentacao()
    if _limite(ip) or not tok or not hmac.compare_digest(token, tok):
        _tentativas.setdefault(ip, []).append(time.time())
        return render_template("login.html", erro="Este link de apresentação não existe mais. Peça o link novo ao administrador."), 404
    session.clear()
    session.permanent = True
    session["apresentacao"] = tok
    with engine.begin() as c:
        registrar(c, VISITANTE, "Abriu o link de apresentação")
    return redirect(url_for("index"))


@app.route("/senha", methods=["GET", "POST"])
def trocar_senha():
    u = _usuario(session.get("uid")) if session.get("uid") else None
    if not u or u["v"] != session.get("v") or not u["ativo"]:
        session.clear()
        return redirect(url_for("login"))
    primeiro = not u["hash"] or bool(u.get("trocar_senha"))  # 1º acesso (senha padrão ou provisória): não pede a atual
    erro = None
    if request.method == "POST":
        atual, nova = request.form.get("atual", ""), request.form.get("nova", "")
        if _limite(_ip()):
            erro = "Muitas tentativas. Espere alguns minutos."
        elif not primeiro and not check_password_hash(u["hash"], atual):
            _tentativas.setdefault(_ip(), []).append(time.time())
            erro = "A senha atual não confere."
        elif len(nova) < SENHA_MINIMA:
            erro = f"A senha precisa ter pelo menos {SENHA_MINIMA} caracteres."
        elif nova != request.form.get("confirma", ""):
            erro = "As duas senhas não são iguais."
        elif SENHA_PADRAO and hmac.compare_digest(nova.encode(), SENHA_PADRAO.encode()):
            erro = "Escolha uma senha diferente da senha padrão."
        elif u.get("trocar_senha") and u["hash"] and check_password_hash(u["hash"], nova):
            erro = "Escolha uma senha diferente da senha provisória."
        elif nova.strip().lower() == u["usuario"]:
            erro = "A senha não pode ser igual ao usuário."
        else:
            v = (u["v"] or 0) + 1
            with engine.begin() as c:
                c.execute(update(usuarios).where(usuarios.c.id == u["id"]).values(hash=generate_password_hash(nova), v=v, trocar_senha=False))
                registrar(c, u, "Criou a própria senha" if primeiro else "Trocou a senha")
            session["v"] = v
            return redirect(url_for("index"))
    return render_template("senha.html", erro=erro, primeiro=primeiro, nome=u["nome"], minimo=SENHA_MINIMA)


@app.route("/sair")
def sair():
    session.clear()
    if request.args.get("de") == "apresentacao":
        return redirect(url_for("login"))
    return redirect(url_for("login"))


@app.route("/saude")
def saude():
    return "ok", 200


@app.route("/")
@logado
def index():
    u = eu()
    return render_template("index.html", me={"id": u["id"], "nome": u["nome"], "usuario": u["usuario"], "perfil": u["perfil"],
                                              "perfil_nome": PERFIS.get(u["perfil"], "Apresentação"), "lojas": lojas_de(u),
                                              "autoriza": pode("autorizar")},
                           versao=os.environ.get("RAILWAY_GIT_COMMIT_SHA", "dev")[:7])


# ---------- leitura ----------

def _processo_visivel(conn, pid):
    u = eu()
    q = select(processos).where(processos.c.id == pid, processos.c.excluido.is_(False))
    f = _filtro_lojas(u)
    if f is not None:
        q = q.where(f)
    if u["perfil"] == "leitura":  # a apresentação só mostra o que já foi autorizado
        q = q.where(func.coalesce(processos.c.autorizacao, "") == "")
    r = conn.execute(q).first()
    if not r:
        abort(404)
    return linha(r)


def _mascarar(p):
    """Na apresentação (sem login) não aparecem CPF/CNPJ."""
    if eu()["perfil"] == "leitura":
        p["documento"] = ""
    return p


# Audiência escrita no andamento, ex.: "audiência de conciliação para o dia 23/10/2026 às 10:00"
RX_AUDIENCIA = re.compile(r"(audi[eê]ncia[^.]{0,80}?)(\d{1,2})/(\d{1,2})/(\d{2,4})(?:[^.\d]{0,20}?(\d{1,2})\s*[:h]\s*(\d{2})?)?", re.I)


def _sugestoes(conn, ids, hoje):
    """Audiências futuras citadas nos andamentos que ainda não foram cadastradas nem ignoradas."""
    ignoradas = set(json.loads(config_ler("sugestoes_ignoradas", "[]") or "[]"))
    ja = {(r.processo_id, r.data) for r in conn.execute(select(audiencias.c.processo_id, audiencias.c.data).where(audiencias.c.excluido.is_(False)))}
    out = []
    for r in conn.execute(select(andamentos.c.id, andamentos.c.processo_id, andamentos.c.texto).where(andamentos.c.texto.ilike("%audi%"))):
        if r.processo_id not in ids or r.id in ignoradas:
            continue
        m = RX_AUDIENCIA.search(r.texto)
        if not m:
            continue
        try:
            a = int(m.group(4))
            d = date(a + 2000 if a < 100 else a, int(m.group(3)), int(m.group(2)))
        except ValueError:
            continue
        if d < hoje or (r.processo_id, d) in ja:
            continue
        hora = f"{int(m.group(5)):02d}:{m.group(6) or '00'}" if m.group(5) else ""
        tipo = next((t for t in TIPOS_AUDIENCIA if t.split()[0].lower()[:6] in m.group(1).lower()), "Outra")
        out.append({"andamento_id": r.id, "processo_id": r.processo_id, "data": d.isoformat(), "hora": hora, "tipo": tipo,
                    "trecho": r.texto[max(0, m.start() - 40): m.end() + 40]})
    return out


@app.errorhandler(404)
def nao_achou(e):
    if request.path.startswith("/api/"):
        return jsonify(erro="Item não encontrado. Ele pode ter sido apagado."), 404
    return e


@app.route("/api/dados")
@logado
def api_dados():
    u = eu()
    f = _filtro_lojas(u)
    with engine.connect() as c:
        q = select(processos).where(processos.c.excluido.is_(False))
        if f is not None:
            q = q.where(f)
        if u["perfil"] == "leitura":
            q = q.where(func.coalesce(processos.c.autorizacao, "") == "")
        ps = [_mascarar(linha(r)) for r in c.execute(q.order_by(processos.c.id))]
        ids = {p["id"] for p in ps}
        # último andamento de cada processo
        sub = select(andamentos.c.processo_id, func.max(andamentos.c.id).label("mid")).group_by(andamentos.c.processo_id).subquery()
        ult = {r.processo_id: (r.texto, r.em, r.por) for r in c.execute(
            select(andamentos.c.processo_id, andamentos.c.texto, andamentos.c.em, andamentos.c.por).join(sub, andamentos.c.id == sub.c.mid))}
        nanx = dict(c.execute(select(anexos.c.processo_id, func.count()).where(anexos.c.excluido.is_(False)).group_by(anexos.c.processo_id)).all())
        cs = [linha(r) for r in c.execute(select(custas).where(custas.c.excluido.is_(False)).order_by(custas.c.vencimento))]
        anx_custa = {}
        for r in c.execute(select(anexos.c.custa_id, anexos.c.categoria).where(anexos.c.excluido.is_(False), anexos.c.custa_id.is_not(None))):
            anx_custa.setdefault(r.custa_id, []).append(r.categoria)
        ls = [linha(r) for r in c.execute(select(lojas).order_by(lojas.c.nome))]
        auds = [linha(r) for r in c.execute(select(audiencias).where(audiencias.c.excluido.is_(False)).order_by(audiencias.c.data, audiencias.c.hora))]
        sug = _sugestoes(c, ids, agora().date()) if pode("editar_juridico") else []
    for p in ps:
        t = ult.get(p["id"])
        p["andamento"] = t[0] if t else ""
        p["andamento_em"] = t[1].strftime("%Y-%m-%d %H:%M") if t and t[1] else ""
        p["n_anexos"] = nanx.get(p["id"], 0)
    cs = [x for x in cs if x["processo_id"] in ids]
    for x in cs:
        cats = anx_custa.get(x["id"], [])
        x["tem_boleto"] = bool(x["link"]) or "Boleto" in cats
        x["tem_comprovante"] = "Comprovante" in cats
    auds = [x for x in auds if x["processo_id"] in ids]
    return jsonify(processos=ps, custas=cs, audiencias=auds, sugestoes=sug, lojas=ls, hoje=agora().date().isoformat(),
                   listas={"status": STATUS, "identificacoes": IDENTIFICACOES, "tipos_custa": TIPOS_CUSTA,
                           "categorias": CATEGORIAS_ANEXO, "perfis": PERFIS, "tipos_audiencia": TIPOS_AUDIENCIA})


@app.route("/api/processos/<int:pid>")
@logado
def api_processo(pid):
    with engine.connect() as c:
        p = _processo_visivel(c, pid)
        p["andamentos"] = [linha(r) for r in c.execute(select(andamentos).where(andamentos.c.processo_id == pid).order_by(andamentos.c.em.desc(), andamentos.c.id.desc()))]
        p["custas"] = [linha(r) for r in c.execute(select(custas).where(custas.c.processo_id == pid, custas.c.excluido.is_(False)).order_by(custas.c.vencimento))]
        p["anexos"] = [linha(r) for r in c.execute(select(anexos).where(anexos.c.processo_id == pid, anexos.c.excluido.is_(False)).order_by(anexos.c.em.desc()))]
        p["historico"] = [linha(r) for r in c.execute(select(historico).where(historico.c.processo_id == pid).order_by(historico.c.id.desc()).limit(80))]
        p["audiencias"] = [linha(r) for r in c.execute(select(audiencias).where(audiencias.c.processo_id == pid, audiencias.c.excluido.is_(False)).order_by(audiencias.c.data, audiencias.c.hora))]
    for a in p["anexos"]:
        a["url"] = a["link"] or f"/anexos/{a['id']}"
    if eu()["perfil"] == "leitura":  # apresentação: sem anexos, sem histórico e sem CPF/CNPJ
        p["anexos"], p["historico"] = [], []
        _mascarar(p)
    return jsonify(p)


# ---------- processos ----------

CAMPOS_JURIDICO = {"tipo", "loja", "uf", "carteira", "ano", "codigo_cliente", "parte", "documento", "identificacao",
                   "tipo_acao", "numero", "status", "valor", "valor_acordo", "teor"}
CAMPOS_FINANCEIRO = {"valor_pago", "conferido"}
NOMES = {"loja": "Loja", "uf": "UF", "carteira": "Carteira", "ano": "Ano", "codigo_cliente": "Código do cliente",
         "parte": "Cliente / parte", "documento": "CNPJ / CPF", "identificacao": "Identificação", "tipo_acao": "Tipo de ação",
         "numero": "Nº do processo", "status": "Status", "valor": "Valor", "valor_acordo": "Valor do acordo",
         "valor_pago": "Valor pago", "conferido": "Recebimento conferido", "teor": "Teor", "tipo": "Aba"}


def _limpar(campo, v):
    if campo in ("valor", "valor_acordo", "valor_pago"):
        if v in (None, ""):
            return None
        try:
            return round(float(str(v).replace(",", ".")), 2)
        except ValueError:
            raise ValueError(f"{NOMES[campo]}: digite só números.")
    if campo == "ano":
        if v in (None, ""):
            return None
        try:
            return int(v)
        except ValueError:
            raise ValueError("Ano inválido.")
    if campo == "conferido":
        return bool(v)
    if campo == "tipo":
        if v not in STATUS:
            raise ValueError("Aba inválida.")
        return v
    s = str(v or "").strip()
    return s.upper()[:2] if campo == "uf" else s[:255]


def _igual(a, b):
    if isinstance(a, (int, float)) or isinstance(b, (int, float)):
        try:
            return a is not None and b is not None and abs(float(a) - float(b)) < 0.005
        except (TypeError, ValueError):
            return False
    return (a or "") == (b or "")


@app.post("/api/processos")
@logado
@so("editar_juridico")
def api_novo_processo():
    d = corpo()
    if d.get("tipo") not in STATUS:
        return jsonify(erro="Escolha se é Cobrança ou Processo Diverso."), 400
    try:
        vals = {k: _limpar(k, d.get(k)) for k in CAMPOS_JURIDICO if k in d}
    except ValueError as e:
        return jsonify(erro=str(e)), 400
    if not vals.get("parte") and not vals.get("numero"):
        return jsonify(erro="Preencha o cliente/parte ou o nº do processo."), 400
    ls = lojas_de(eu())
    if ls and vals.get("loja") not in ls:
        return jsonify(erro="Você só pode cadastrar processos das suas lojas."), 403
    # Cobrança nova lançada por quem não autoriza fica aguardando a autorização (ex.: da Juliana)
    precisa = d["tipo"] == "cobranca" and not pode("autorizar")
    aut = {"autorizacao": "pendente"} if precisa else {"autorizacao": "", "autorizado_por": eu()["nome"], "autorizado_em": agora()}
    with engine.begin() as c:
        pid = c.execute(insert(processos).values(**vals, **aut, conferido=False, excluido=False, criado_em=agora(), atualizado_em=agora(),
                                                 criado_por=eu()["nome"])).inserted_primary_key[0]
        if str(d.get("andamento", "")).strip():
            c.execute(insert(andamentos).values(processo_id=pid, texto=str(d["andamento"]).strip(), por=eu()["nome"], em=agora()))
        registrar(c, eu(), "Processo criado" + (" (aguardando autorização)" if precisa else ""), pid,
                  {"parte": vals.get("parte"), "numero": vals.get("numero")})
    return jsonify(id=pid, pendente=precisa)


@app.post("/api/processos/<int:pid>/autorizacao")
@logado
def api_autorizacao(pid):
    """Autorizar ou recusar uma cobrança nova; o jurídico pode reenviar uma recusada."""
    d = corpo()
    dec = d.get("decisao")
    motivo = str(d.get("motivo", "")).strip()[:500]
    with engine.begin() as c:
        p = _processo_visivel(c, pid)
        if dec in ("autorizar", "recusar"):
            if not pode("autorizar"):
                return jsonify(erro="Você não tem permissão para autorizar processos."), 403
            if p["autorizacao"] not in ("pendente", "recusada"):
                return jsonify(erro="Este processo já está autorizado."), 409
            if dec == "recusar" and not motivo:
                return jsonify(erro="Escreva o motivo da recusa."), 400
            vals = {"autorizacao": "" if dec == "autorizar" else "recusada", "autorizado_por": eu()["nome"], "autorizado_em": agora(),
                    "motivo_recusa": "" if dec == "autorizar" else motivo}
            acao = "Processo autorizado" if dec == "autorizar" else "Processo recusado"
        elif dec == "reenviar":
            if not pode("editar_juridico"):
                return jsonify(erro="Seu perfil não pode reenviar processos."), 403
            if p["autorizacao"] != "recusada":
                return jsonify(erro="Só processos recusados podem ser reenviados."), 409
            vals = {"autorizacao": "pendente", "motivo_recusa": ""}
            acao = "Processo reenviado para autorização"
        else:
            return jsonify(erro="Decisão inválida."), 400
        c.execute(update(processos).where(processos.c.id == pid).values(**vals, atualizado_em=agora()))
        registrar(c, eu(), acao, pid, {"motivo": motivo} if motivo else None)
    return jsonify(ok=True)


@app.post("/api/processos/<int:pid>")
@logado
def api_editar_processo(pid):
    d = corpo()
    permitidos = (CAMPOS_JURIDICO if pode("editar_juridico") else set()) | (CAMPOS_FINANCEIRO if pode("editar_financeiro") else set())
    with engine.begin() as c:
        atual = _processo_visivel(c, pid)
        try:
            novos = {k: _limpar(k, d[k]) for k in d if k in (CAMPOS_JURIDICO | CAMPOS_FINANCEIRO)}
        except ValueError as e:
            return jsonify(erro=str(e)), 400
        mud = {k: v for k, v in novos.items() if not _igual(atual.get(k), v)}
        # quem não pode mexer num campo só é barrado se tentou de fato mudar o valor
        tentou = [NOMES.get(k, k) for k in mud if k not in permitidos]
        if tentou:
            return jsonify(erro="Seu perfil não pode alterar: " + ", ".join(tentou) + "."), 403
        ls = lojas_de(eu())
        if ls and "loja" in mud and mud["loja"] not in ls:
            return jsonify(erro="Você só pode usar as suas lojas."), 403
        if not mud:
            return jsonify(ok=True, mudancas=0)
        if "conferido" in mud:
            mud["conferido_por"] = eu()["nome"] if mud["conferido"] else ""
            mud["conferido_em"] = agora() if mud["conferido"] else None
        c.execute(update(processos).where(processos.c.id == pid).values(**mud, atualizado_em=agora()))
        registrar(c, eu(), "Processo alterado", pid,
                  [{"campo": NOMES.get(k, k), "de": atual.get(k), "para": v} for k, v in mud.items() if k in NOMES])
    return jsonify(ok=True, mudancas=len(mud))


@app.delete("/api/processos/<int:pid>")
@logado
@so("editar_juridico")
def api_excluir_processo(pid):
    with engine.begin() as c:
        p = _processo_visivel(c, pid)
        c.execute(update(processos).where(processos.c.id == pid).values(excluido=True, atualizado_em=agora()))
        registrar(c, eu(), "Processo excluído", pid, {"parte": p["parte"], "numero": p["numero"]})
    return jsonify(ok=True)


@app.post("/api/processos/<int:pid>/andamentos")
@logado
@so("editar_juridico")
def api_andamento(pid):
    texto = str(corpo().get("texto", "")).strip()
    if not texto:
        return jsonify(erro="Escreva o andamento."), 400
    with engine.begin() as c:
        _processo_visivel(c, pid)
        c.execute(insert(andamentos).values(processo_id=pid, texto=texto[:4000], por=eu()["nome"], em=agora()))
        c.execute(update(processos).where(processos.c.id == pid).values(atualizado_em=agora()))
        registrar(c, eu(), "Andamento adicionado", pid, texto[:300])
    return jsonify(ok=True)


# ---------- custas ----------

def _data(s):
    try:
        return date.fromisoformat(str(s)[:10]) if s else None
    except ValueError:
        raise ValueError("Data inválida.")


def _custa(conn, cid):
    r = conn.execute(select(custas).where(custas.c.id == cid, custas.c.excluido.is_(False))).first()
    if not r:
        abort(404)
    cu = linha(r)
    _processo_visivel(conn, cu["processo_id"])
    return cu


@app.post("/api/processos/<int:pid>/custas")
@logado
@so("editar_juridico")
def api_nova_custa(pid):
    d = corpo()
    try:
        venc = _data(d.get("vencimento"))
        valor = _limpar("valor", d.get("valor"))
    except ValueError as e:
        return jsonify(erro=str(e)), 400
    if not venc:
        return jsonify(erro="Informe o vencimento da custa."), 400
    tipo = d.get("tipo") if d.get("tipo") in TIPOS_CUSTA else "Outra"
    with engine.begin() as c:
        _processo_visivel(c, pid)
        cid = c.execute(insert(custas).values(processo_id=pid, tipo=tipo, descricao=str(d.get("descricao", "")).strip()[:255], valor=valor,
                                              vencimento=venc, link=str(d.get("link", "")).strip(), pago=False, criado_por=eu()["nome"],
                                              criado_em=agora(), excluido=False)).inserted_primary_key[0]
        registrar(c, eu(), "Custa lançada", pid, {"tipo": tipo, "valor": valor, "vencimento": venc})
    return jsonify(id=cid)


@app.post("/api/custas/<int:cid>")
@logado
@so("editar_juridico")
def api_editar_custa(cid):
    d = corpo()
    with engine.begin() as c:
        cu = _custa(c, cid)
        try:
            novos = {"tipo": d.get("tipo") if d.get("tipo") in TIPOS_CUSTA else cu["tipo"],
                     "descricao": str(d.get("descricao", cu["descricao"]) or "").strip()[:255],
                     "valor": _limpar("valor", d.get("valor", cu["valor"])),
                     "vencimento": _data(d.get("vencimento", cu["vencimento"])),
                     "link": str(d.get("link", cu["link"]) or "").strip()}
        except ValueError as e:
            return jsonify(erro=str(e)), 400
        if not novos["vencimento"]:
            return jsonify(erro="Informe o vencimento da custa."), 400
        mud = {k: v for k, v in novos.items() if not _igual(cu.get(k), v if k != "vencimento" else v.isoformat())}
        if mud:
            c.execute(update(custas).where(custas.c.id == cid).values(**mud))
            registrar(c, eu(), "Custa alterada", cu["processo_id"], [{"campo": k, "de": cu.get(k), "para": v} for k, v in mud.items()])
    return jsonify(ok=True)


@app.post("/api/custas/<int:cid>/pago")
@logado
@so("editar_financeiro")
def api_pagar_custa(cid):
    pago = bool(corpo().get("pago", True))
    with engine.begin() as c:
        cu = _custa(c, cid)
        c.execute(update(custas).where(custas.c.id == cid).values(pago=pago, pago_em=agora() if pago else None, pago_por=eu()["nome"] if pago else ""))
        registrar(c, eu(), "Custa paga" if pago else "Pagamento de custa desfeito", cu["processo_id"],
                  {"tipo": cu["tipo"], "valor": cu["valor"], "vencimento": cu["vencimento"]})
    return jsonify(ok=True)


@app.delete("/api/custas/<int:cid>")
@logado
@so("editar_juridico")
def api_excluir_custa(cid):
    with engine.begin() as c:
        cu = _custa(c, cid)
        if cu["pago"] and not pode("admin"):
            return jsonify(erro="Custa já paga: só o administrador pode excluir."), 403
        c.execute(update(custas).where(custas.c.id == cid).values(excluido=True))
        registrar(c, eu(), "Custa excluída", cu["processo_id"], {"tipo": cu["tipo"], "valor": cu["valor"], "vencimento": cu["vencimento"]})
    return jsonify(ok=True)


# ---------- audiências ----------

def _audiencia_dados(d):
    try:
        dia = _data(d.get("data"))
    except ValueError as e:
        raise ValueError(str(e))
    if not dia:
        raise ValueError("Informe a data da audiência.")
    hora = str(d.get("hora", "")).strip()[:5]
    if hora and not re.match(r"^\d{2}:\d{2}$", hora):
        raise ValueError("Hora inválida (use 09:30).")
    return {"data": dia, "hora": hora, "tipo": d.get("tipo") if d.get("tipo") in TIPOS_AUDIENCIA else "Outra",
            "local": str(d.get("local", "")).strip()[:500], "obs": str(d.get("obs", "")).strip()[:1000]}


@app.post("/api/processos/<int:pid>/audiencias")
@logado
@so("editar_juridico")
def api_nova_audiencia(pid):
    d = corpo()
    try:
        vals = _audiencia_dados(d)
    except ValueError as e:
        return jsonify(erro=str(e)), 400
    with engine.begin() as c:
        _processo_visivel(c, pid)
        aid = c.execute(insert(audiencias).values(processo_id=pid, **vals, andamento_id=d.get("andamento_id") or None,
                                                  criado_por=eu()["nome"], criado_em=agora(), excluido=False)).inserted_primary_key[0]
        registrar(c, eu(), "Audiência marcada", pid, {"tipo": vals["tipo"], "data": vals["data"], "hora": vals["hora"]})
    return jsonify(id=aid)


def _audiencia(conn, aid):
    r = conn.execute(select(audiencias).where(audiencias.c.id == aid, audiencias.c.excluido.is_(False))).first()
    if not r:
        abort(404)
    a = linha(r)
    _processo_visivel(conn, a["processo_id"])
    return a


@app.post("/api/audiencias/<int:aid>")
@logado
@so("editar_juridico")
def api_editar_audiencia(aid):
    try:
        vals = _audiencia_dados(corpo())
    except ValueError as e:
        return jsonify(erro=str(e)), 400
    with engine.begin() as c:
        a = _audiencia(c, aid)
        mud = {k: v for k, v in vals.items() if not _igual(a.get(k), v.isoformat() if k == "data" else v)}
        if mud:
            c.execute(update(audiencias).where(audiencias.c.id == aid).values(**mud))
            registrar(c, eu(), "Audiência alterada", a["processo_id"], [{"campo": k, "de": a.get(k), "para": v} for k, v in mud.items()])
    return jsonify(ok=True)


@app.delete("/api/audiencias/<int:aid>")
@logado
@so("editar_juridico")
def api_excluir_audiencia(aid):
    with engine.begin() as c:
        a = _audiencia(c, aid)
        c.execute(update(audiencias).where(audiencias.c.id == aid).values(excluido=True))
        registrar(c, eu(), "Audiência excluída", a["processo_id"], {"tipo": a["tipo"], "data": a["data"], "hora": a["hora"]})
    return jsonify(ok=True)


@app.post("/api/sugestoes/<int:andamento_id>/ignorar")
@logado
@so("editar_juridico")
def api_ignorar_sugestao(andamento_id):
    with engine.begin() as c:
        lista = json.loads(config_ler("sugestoes_ignoradas", "[]") or "[]")
        if andamento_id not in lista:
            lista.append(andamento_id)
        config_gravar(c, "sugestoes_ignoradas", json.dumps(lista[-2000:]))
        r = c.execute(select(andamentos.c.processo_id).where(andamentos.c.id == andamento_id)).first()
        registrar(c, eu(), "Sugestão de audiência ignorada", r.processo_id if r else None)
    return jsonify(ok=True)


# ---------- anexos ----------

@app.post("/api/processos/<int:pid>/anexos")
@logado
@so("anexar")
def api_anexar(pid):
    arqs = [a for a in request.files.getlist("arquivo") if a and a.filename]
    link = request.form.get("link", "").strip()
    cat = request.form.get("categoria") if request.form.get("categoria") in CATEGORIAS_ANEXO else "Documento"
    cid = request.form.get("custa_id", type=int)
    if not arqs and not link:
        return jsonify(erro="Escolha um arquivo ou cole um link."), 400
    if len(arqs) > 15:
        return jsonify(erro="Envie no máximo 15 arquivos por vez."), 400
    for a in arqs:
        if os.path.splitext(a.filename)[1].lower() not in EXTENSOES:
            return jsonify(erro=f'"{a.filename}": tipo de arquivo não aceito.'), 400
    if link and not link.startswith(("http://", "https://")):
        return jsonify(erro="O link precisa começar com https://"), 400
    with engine.begin() as c:
        _processo_visivel(c, pid)
        if cid:
            cu = _custa(c, cid)
            if cu["processo_id"] != pid:
                abort(404)
        marca = int(time.time())
        for i, a in enumerate(arqs, start=1):
            base, ext = os.path.splitext(a.filename)
            nome = secure_filename(f"{pid}_{marca}_{i}_{base[:60]}{ext.lower()}") or f"{pid}_{marca}_{i}{ext.lower()}"
            a.save(os.path.join(PASTA_ANEXOS, nome))
            c.execute(insert(anexos).values(processo_id=pid, custa_id=cid, categoria=cat, nome=a.filename[:255], arquivo=nome, link="",
                                            por=eu()["nome"], em=agora(), excluido=False))
        if link:
            c.execute(insert(anexos).values(processo_id=pid, custa_id=cid, categoria=cat, nome=request.form.get("nome", "").strip()[:255] or "Link",
                                            arquivo="", link=link, por=eu()["nome"], em=agora(), excluido=False))
        registrar(c, eu(), "Anexo adicionado", pid, {"categoria": cat, "arquivos": [a.filename for a in arqs], "link": link or None})
    return jsonify(ok=True)


@app.delete("/api/anexos/<int:aid>")
@logado
def api_excluir_anexo(aid):
    with engine.begin() as c:
        r = c.execute(select(anexos).where(anexos.c.id == aid, anexos.c.excluido.is_(False))).first()
        if not r:
            abort(404)
        a = linha(r)
        _processo_visivel(c, a["processo_id"])
        if a["por"] != eu()["nome"] and not pode("admin"):
            return jsonify(erro="Só quem enviou (ou o administrador) pode remover este anexo."), 403
        c.execute(update(anexos).where(anexos.c.id == aid).values(excluido=True))  # o arquivo continua guardado, por segurança
        registrar(c, eu(), "Anexo removido", a["processo_id"], {"nome": a["nome"], "categoria": a["categoria"]})
    return jsonify(ok=True)


@app.route("/anexos/<int:aid>")
@logado
def baixar_anexo(aid):
    if not pode("anexar"):
        abort(403)
    with engine.connect() as c:
        r = c.execute(select(anexos).where(anexos.c.id == aid)).first()
        if not r:
            abort(404)
        a = linha(r)
        _processo_visivel(c, a["processo_id"])
    if a["link"]:
        return redirect(a["link"])
    return send_from_directory(PASTA_ANEXOS, a["arquivo"], download_name=a["nome"] or a["arquivo"])


# ---------- usuários e lojas (administrador) ----------

@app.route("/api/usuarios")
@logado
@so("admin")
def api_usuarios():
    with engine.connect() as c:
        us = [linha(r) for r in c.execute(select(usuarios).order_by(usuarios.c.nome))]
    for u in us:
        u["pendente"] = not u.pop("hash") or bool(u.get("trocar_senha"))
        u["lojas"] = lojas_de(u)
    return jsonify(usuarios=us)


@app.post("/api/usuarios")
@logado
@so("admin")
def api_salvar_usuario():
    d = corpo()
    usuario = str(d.get("usuario", "")).strip().lower()
    nome = str(d.get("nome", "")).strip()
    perfil = d.get("perfil")
    ls = [x for x in d.get("lojas") or [] if isinstance(x, str) and x]
    if perfil not in PERFIS:
        return jsonify(erro="Escolha o perfil."), 400
    if not nome:
        return jsonify(erro="Preencha o nome."), 400
    with engine.begin() as c:
        if d.get("id"):
            atual = c.execute(select(usuarios).where(usuarios.c.id == int(d["id"]))).first()
            if not atual:
                abort(404)
            atual = linha(atual)
            if atual["id"] == eu()["id"] and (perfil != "admin" or not d.get("ativo", True)):
                return jsonify(erro="Você não pode tirar o seu próprio acesso de administrador."), 400
            vals = {"nome": nome, "perfil": perfil, "lojas": "|".join(ls), "ativo": bool(d.get("ativo", True)), "autoriza": bool(d.get("autoriza"))}
            c.execute(update(usuarios).where(usuarios.c.id == atual["id"]).values(**vals))
            registrar(c, eu(), "Usuário alterado", detalhes={"usuario": atual["usuario"], **vals})
            return jsonify(ok=True)
        if not usuario or not usuario.replace(".", "").replace("_", "").replace("-", "").isalnum():
            return jsonify(erro="Usuário: use só letras, números e ponto (ex.: maria.silva)."), 400
        if c.execute(select(usuarios.c.id).where(usuarios.c.usuario == usuario)).first():
            return jsonify(erro="Esse usuário já existe."), 400
        prov = str(d.get("senha_inicial") or "")
        if prov and len(prov) < SENHA_MINIMA:
            return jsonify(erro=f"A senha do primeiro acesso precisa ter pelo menos {SENHA_MINIMA} caracteres."), 400
        if not prov and not SENHA_PADRAO:
            return jsonify(erro="Informe a senha do primeiro acesso (ou defina a SENHA_PADRAO no Railway)."), 400
        c.execute(insert(usuarios).values(usuario=usuario, nome=nome, perfil=perfil, lojas="|".join(ls), v=1, ativo=True,
                                          hash=generate_password_hash(prov) if prov else None, trocar_senha=bool(prov),
                                          criado_em=agora(), autoriza=bool(d.get("autoriza"))))
        registrar(c, eu(), "Usuário criado", detalhes={"usuario": usuario, "perfil": perfil, "lojas": ls, "autoriza": bool(d.get("autoriza")),
                                                      "primeiro acesso": "senha provisória" if prov else "senha padrão"})
    return jsonify(ok=True)


@app.post("/api/usuarios/<int:uid>/redefinir")
@logado
@so("admin")
def api_redefinir(uid):
    if uid == eu()["id"]:
        return jsonify(erro="Para a sua senha, use Trocar senha."), 400
    with engine.begin() as c:
        r = c.execute(select(usuarios).where(usuarios.c.id == uid)).first()
        if not r:
            abort(404)
        c.execute(update(usuarios).where(usuarios.c.id == uid).values(hash=None, v=(r.v or 0) + 1))
        registrar(c, eu(), "Senha voltou para a padrão", detalhes={"usuario": r.usuario})
    return jsonify(ok=True)


@app.route("/api/apresentacao")
@logado
@so("admin")
def api_apresentacao():
    tok = _token_apresentacao()
    return jsonify(ativo=bool(tok), url=(request.host_url.rstrip("/") + url_for("ver_apresentacao", token=tok)) if tok else "")


@app.post("/api/apresentacao")
@logado
@so("admin")
def api_apresentacao_mudar():
    acao = corpo().get("acao")
    if acao not in ("gerar", "desativar"):
        return jsonify(erro="Ação inválida."), 400
    tok = secrets.token_urlsafe(24) if acao == "gerar" else ""
    with engine.begin() as c:
        config_gravar(c, "apresentacao_token", tok)
        registrar(c, eu(), "Link de apresentação gerado (o anterior parou de funcionar)" if acao == "gerar" else "Link de apresentação desativado")
    return api_apresentacao()


@app.post("/api/lojas")
@logado
@so("admin")
def api_nova_loja():
    d = corpo()
    nome = " ".join(str(d.get("nome", "")).split())
    if not nome:
        return jsonify(erro="Digite o nome da loja."), 400
    with engine.begin() as c:
        if c.execute(select(lojas.c.id).where(func.lower(lojas.c.nome) == nome.lower())).first():
            return jsonify(erro="Essa loja já existe."), 400
        c.execute(insert(lojas).values(nome=nome, uf=str(d.get("uf", "")).strip().upper()[:2]))
        registrar(c, eu(), "Loja cadastrada", detalhes={"nome": nome})
    return jsonify(ok=True)


@app.route("/api/historico")
@logado
@so("admin")
def api_historico():
    antes = request.args.get("antes", type=int)
    quem_ = request.args.get("usuario", "").strip().lower()
    busca = request.args.get("q", "").strip()
    with engine.connect() as c:
        q = select(historico, processos.c.parte, processos.c.numero).select_from(
            historico.outerjoin(processos, historico.c.processo_id == processos.c.id)).order_by(historico.c.id.desc()).limit(100)
        if antes:
            q = q.where(historico.c.id < antes)
        if quem_:
            q = q.where(historico.c.usuario == quem_)
        if busca:
            like = f"%{busca}%"
            q = q.where(historico.c.acao.ilike(like) | historico.c.detalhes.ilike(like) | processos.c.parte.ilike(like) | processos.c.numero.ilike(like))
        itens = [linha(r) for r in c.execute(q)]
        pessoas = [{"usuario": r.usuario, "nome": r.nome} for r in c.execute(
            select(historico.c.usuario, func.max(historico.c.nome).label("nome")).group_by(historico.c.usuario).order_by(func.max(historico.c.nome)))]
    return jsonify(itens=itens, pessoas=pessoas)


# ---------- importação da planilha (administrador) ----------

@app.post("/api/importar")
@logado
@so("admin")
def api_importar():
    import importar
    arq = request.files.get("arquivo")
    if not arq or not arq.filename.lower().endswith(".xlsx"):
        return jsonify(erro="Envie a planilha em .xlsx (no Google Sheets: Arquivo > Fazer download > Microsoft Excel)."), 400
    destino = os.path.join(PASTA_DADOS, "importacoes")
    os.makedirs(destino, exist_ok=True)
    caminho = os.path.join(destino, f"{agora().strftime('%Y-%m-%d_%H%M%S')}_{secure_filename(arq.filename)}")
    arq.save(caminho)
    try:
        itens, avisos = importar.limpar(importar.ler(caminho))
    except ValueError as e:
        return jsonify(erro=str(e)), 400
    with engine.connect() as c:
        ja = c.execute(select(func.count()).select_from(processos).where(processos.c.excluido.is_(False))).scalar()
    if ja and request.form.get("confirmar") != "sim":
        return jsonify(erro=f"O sistema já tem {ja} processos. A importação adicionaria mais {len(itens)} (pode duplicar).", confirmar=True), 409
    backup.fazer("antes-da-importacao")
    n = importar.gravar(itens, eu())
    return jsonify(ok=True, **n, avisos=avisos)


# ---------- backups (administrador) ----------

@app.route("/api/backups")
@logado
@so("admin")
def api_backups():
    return jsonify(backups=backup.listar())


@app.post("/api/backups")
@logado
@so("admin")
def api_backup_agora():
    nome = os.path.basename(backup.fazer("manual"))
    with engine.begin() as c:
        registrar(c, eu(), "Backup feito manualmente", detalhes={"arquivo": nome})
    return jsonify(nome=nome)


@app.route("/backups/<path:nome>")
@logado
@so("admin")
def baixar_backup(nome):
    with engine.begin() as c:
        registrar(c, eu(), "Backup baixado", detalhes={"arquivo": secure_filename(nome)})
    return send_from_directory(backup.PASTA, secure_filename(nome), as_attachment=True)


# ---------- planilha espelho (administrador) ----------

@app.route("/api/espelho")
@logado
@so("admin")
def api_espelho():
    return jsonify(configurado=espelho.configurado(), url=espelho.url(), **{k: v for k, v in espelho.ESTADO.items() if k != "historico_id"})


@app.post("/api/espelho")
@logado
@so("admin")
def api_espelho_agora():
    if not espelho.configurado():
        return jsonify(erro="A planilha espelho ainda não está configurada no Railway."), 400
    with engine.begin() as c:
        registrar(c, eu(), "Planilha espelho atualizada manualmente")
    ok = espelho.sincronizar("manual")
    if not ok:
        return jsonify(erro="Não foi possível atualizar a planilha: " + (espelho.ESTADO["erro"] or "")), 502
    return jsonify(ok=True, ultima=espelho.ESTADO["ultima"], linhas=espelho.ESTADO["linhas"])


backup.rotina_diaria()
espelho.rotina()

if __name__ == "__main__":
    app.run(debug=os.environ.get("DEBUG") == "1", port=int(os.environ.get("PORT", 5000)))
