"""
BI Jurídico Densul: banco de dados.

Tabelas:
- usuarios     quem acessa, perfil (admin, juridico, financeiro) e lojas que enxerga
- lojas        lista fixa de lojas (evita nomes escritos de jeitos diferentes)
- processos    Cobrança e Processos Diversos na mesma tabela (campo "tipo")
- andamentos   linha do tempo do processo (o que antes ficava em "Considerações")
- custas       cada custa com valor, vencimento, boleto e pagamento
- anexos       notas, boletos, comprovantes e documentos (arquivo no volume ou link)
- historico    quem alterou o quê e quando (nada é alterado sem deixar rastro)

Em produção usa o Postgres do Railway (DATABASE_URL). No computador, sem
DATABASE_URL, usa um arquivo SQLite em data/local.db.
"""

import json
import os
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import (Boolean, Column, Date, DateTime, ForeignKey, Integer, MetaData, Numeric, String, Table, Text,
                        create_engine, insert, select, text, update)

FUSO = ZoneInfo("America/Sao_Paulo")


def agora():
    return datetime.now(FUSO).replace(tzinfo=None, microsecond=0)


def _url():
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        os.makedirs("data", exist_ok=True)
        return "sqlite:///data/local.db"
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


engine = create_engine(_url(), pool_pre_ping=True, future=True)
meta = MetaData()

usuarios = Table(
    "usuarios", meta,
    Column("id", Integer, primary_key=True),
    Column("usuario", String(60), unique=True, nullable=False),
    Column("nome", String(120), nullable=False),
    Column("perfil", String(20), nullable=False),          # admin | juridico | financeiro
    Column("lojas", Text, default=""),                      # vazio = todas; senão nomes separados por "|"
    Column("hash", String(255)),                            # vazio = ainda usa a senha padrão
    Column("v", Integer, default=0),                        # muda a cada troca/reset de senha (derruba sessões antigas)
    Column("ativo", Boolean, default=True),
    Column("criado_em", DateTime, default=agora),
    Column("autoriza", Boolean, default=False),             # pode autorizar cobranças novas lançadas pelo jurídico
    Column("trocar_senha", Boolean, default=False),         # senha provisória: obriga a criar uma própria no próximo acesso
)

lojas = Table(
    "lojas", meta,
    Column("id", Integer, primary_key=True),
    Column("nome", String(80), unique=True, nullable=False),
    Column("uf", String(2), default=""),
)

processos = Table(
    "processos", meta,
    Column("id", Integer, primary_key=True),
    Column("tipo", String(12), nullable=False),             # cobranca | diversos
    Column("loja", String(80), default=""),
    Column("uf", String(2), default=""),
    Column("carteira", String(20), default=""),
    Column("ano", Integer),
    Column("codigo_cliente", String(30), default=""),
    Column("parte", String(255), default=""),               # cliente (cobrança) ou parte (diversos)
    Column("documento", String(40), default=""),            # CNPJ / CPF
    Column("identificacao", String(40), default=""),        # Densul, Sparcould, Diretoria (diversos)
    Column("tipo_acao", String(120), default=""),           # trabalhista, monitória... (diversos)
    Column("numero", String(60), default=""),               # nº do processo
    Column("status", String(60), default=""),
    Column("valor", Numeric(14, 2)),                        # dívida (cobrança) ou condenação (diversos)
    Column("valor_acordo", Numeric(14, 2)),
    Column("valor_pago", Numeric(14, 2)),
    Column("conferido", Boolean, default=False),            # financeiro confirmou o recebimento
    Column("conferido_por", String(120), default=""),
    Column("conferido_em", DateTime),
    Column("teor", Text, default=""),                       # resumo fixo do processo (diversos)
    Column("criado_em", DateTime, default=agora),
    Column("criado_por", String(120), default=""),
    Column("atualizado_em", DateTime, default=agora),
    Column("excluido", Boolean, default=False),
    # autorização de cobrança nova: "" = autorizada (ou anterior à regra), "pendente", "recusada"
    Column("autorizacao", String(12), default=""),
    Column("autorizado_por", String(120), default=""),
    Column("autorizado_em", DateTime),
    Column("motivo_recusa", Text, default=""),
)

andamentos = Table(
    "andamentos", meta,
    Column("id", Integer, primary_key=True),
    Column("processo_id", Integer, ForeignKey("processos.id"), nullable=False, index=True),
    Column("texto", Text, nullable=False),
    Column("por", String(120), default=""),
    Column("em", DateTime, default=agora),
)

custas = Table(
    "custas", meta,
    Column("id", Integer, primary_key=True),
    Column("processo_id", Integer, ForeignKey("processos.id"), nullable=False, index=True),
    Column("tipo", String(40), default="Inicial"),          # Inicial, Serviço, Cartório, Complementar, Outra
    Column("descricao", String(255), default=""),
    Column("valor", Numeric(14, 2)),
    Column("vencimento", Date),
    Column("link", Text, default=""),                       # link externo do boleto (ex.: pasta do Drive antiga)
    Column("pago", Boolean, default=False),
    Column("pago_em", DateTime),
    Column("pago_por", String(120), default=""),
    Column("criado_por", String(120), default=""),
    Column("criado_em", DateTime, default=agora),
    Column("excluido", Boolean, default=False),
)

anexos = Table(
    "anexos", meta,
    Column("id", Integer, primary_key=True),
    Column("processo_id", Integer, ForeignKey("processos.id"), nullable=False, index=True),
    Column("custa_id", Integer, ForeignKey("custas.id"), index=True),
    Column("categoria", String(30), default="Documento"),   # Nota, Boleto, Comprovante, Documento
    Column("nome", String(255), default=""),
    Column("arquivo", String(255), default=""),             # nome do arquivo salvo no volume
    Column("link", Text, default=""),                       # ou um link externo
    Column("por", String(120), default=""),
    Column("em", DateTime, default=agora),
    Column("excluido", Boolean, default=False),
)

audiencias = Table(
    "audiencias", meta,
    Column("id", Integer, primary_key=True),
    Column("processo_id", Integer, ForeignKey("processos.id"), nullable=False, index=True),
    Column("data", Date, nullable=False),
    Column("hora", String(5), default=""),
    Column("tipo", String(60), default="Conciliação"),
    Column("local", Text, default=""),                      # endereço ou link da audiência online
    Column("obs", Text, default=""),
    Column("andamento_id", Integer),                        # quando veio de uma sugestão tirada do andamento
    Column("criado_por", String(120), default=""),
    Column("criado_em", DateTime, default=agora),
    Column("excluido", Boolean, default=False),
)

config = Table(
    "config", meta,
    Column("chave", String(60), primary_key=True),
    Column("valor", Text, default=""),
)

historico = Table(
    "historico", meta,
    Column("id", Integer, primary_key=True),
    Column("em", DateTime, default=agora, index=True),
    Column("usuario", String(60), default=""),
    Column("nome", String(120), default=""),
    Column("processo_id", Integer, index=True),
    Column("acao", String(60), nullable=False),
    Column("detalhes", Text, default=""),
    Column("ip", String(64), default=""),
)

STATUS = {
    "cobranca": ["Sem Análise", "Documentos em Análise", "Elaborando Petição", "Processo Aberto", "Feito Acordo",
                 "Título Prescrito", "Não entrar com ação", "Finalizado"],
    "diversos": ["Conhecimento", "Fase de Sentença", "Fase de Execução", "Finalizado"],
}
IDENTIFICACOES = ["Densul", "Sparcould", "Diretoria"]
TIPOS_CUSTA = ["Inicial", "Serviço", "Cartório", "Complementar", "Outra"]
TIPOS_AUDIENCIA = ["Conciliação", "Instrução e julgamento", "Una", "Mediação", "Outra"]
CATEGORIAS_ANEXO = ["Nota", "Boleto", "Comprovante", "Documento"]
PERFIS = {"admin": "Administrador", "juridico": "Jurídico", "financeiro": "Financeiro"}
COLUNAS_NOVAS = [  # (tabela, coluna, tipo SQL): criadas sozinhas na subida, em bancos que já existiam
    ("historico", "ip", "VARCHAR(64) DEFAULT ''"),
    ("usuarios", "autoriza", "BOOLEAN DEFAULT FALSE"),
    ("usuarios", "trocar_senha", "BOOLEAN DEFAULT FALSE"),
    ("processos", "autorizacao", "VARCHAR(12) DEFAULT ''"),
    ("processos", "autorizado_por", "VARCHAR(120) DEFAULT ''"),
    ("processos", "autorizado_em", "TIMESTAMP"),
    ("processos", "motivo_recusa", "TEXT DEFAULT ''"),
]


def criar_tabelas():
    meta.create_all(engine)
    # colunas novas em tabelas que já existem (create_all não altera tabela existente)
    from sqlalchemy import inspect
    insp = inspect(engine)
    for tabela, coluna, tipo in COLUNAS_NOVAS:
        if coluna not in {c["name"] for c in insp.get_columns(tabela)}:
            with engine.begin() as c:
                c.execute(text(f"ALTER TABLE {tabela} ADD COLUMN {coluna} {tipo}"))


def config_ler(chave, padrao=""):
    with engine.connect() as c:
        r = c.execute(select(config.c.valor).where(config.c.chave == chave)).first()
    return r[0] if r else padrao


def config_gravar(conn, chave, valor):
    if conn.execute(select(config.c.chave).where(config.c.chave == chave)).first():
        conn.execute(update(config).where(config.c.chave == chave).values(valor=valor))
    else:
        conn.execute(insert(config).values(chave=chave, valor=valor))


def _ip_atual():
    try:
        from flask import has_request_context, request
        if has_request_context():
            return (request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0].strip())[:64]
    except Exception:
        pass
    return ""


def registrar(conn, quem, acao, processo_id=None, detalhes=None):
    """Grava no histórico. 'quem' é o dicionário do usuário logado."""
    conn.execute(insert(historico).values(
        em=agora(), usuario=(quem or {}).get("usuario", "sistema"), nome=(quem or {}).get("nome", "Sistema"),
        processo_id=processo_id, acao=acao, ip=_ip_atual(),
        detalhes=json.dumps(detalhes, ensure_ascii=False, default=str) if isinstance(detalhes, (dict, list)) else (detalhes or ""),
    ))


def linha(r):
    """Row -> dict com tipos que o JSON entende."""
    d = dict(r._mapping)
    for k, v in d.items():
        if hasattr(v, "quantize"):
            d[k] = float(v)
        elif isinstance(v, datetime):
            d[k] = v.strftime("%Y-%m-%d %H:%M")
        elif hasattr(v, "isoformat"):
            d[k] = v.isoformat()
    return d


def garantir_admin(usuario, nome):
    """Cria o usuário administrador padrão se ainda não existir nenhum admin."""
    with engine.begin() as conn:
        tem = conn.execute(select(usuarios.c.id).where(usuarios.c.perfil == "admin")).first()
        if tem:
            return False
        conn.execute(insert(usuarios).values(usuario=usuario, nome=nome, perfil="admin", lojas="", hash=None, v=1, ativo=True, criado_em=agora()))
        registrar(conn, None, "Usuário criado", detalhes={"usuario": usuario, "perfil": "admin"})
        return True


def contar(tabela):
    with engine.connect() as conn:
        return conn.execute(text(f"SELECT COUNT(*) FROM {tabela.name}")).scalar()
