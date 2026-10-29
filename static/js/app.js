/* ================= BI Jurídico Densul ================= */
const pad=n=>String(n).padStart(2,'0');
const ymd=(y,m,d)=>`${y}-${pad(m+1)}-${pad(d)}`;
const fmt=v=>(v==null||v==='')?'–':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const fmt0=v=>'R$ '+Math.round(Number(v)||0).toLocaleString('pt-BR');
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const dParts=d=>{const [y,m,dd]=d.slice(0,10).split('-').map(Number);return {y,m:m-1,d:dd}};
const brDate=d=>{if(!d)return '–';const p=dParts(d);return `${pad(p.d)}/${pad(p.m+1)}/${p.y}`};
const brDT=d=>d?brDate(d)+(d.length>10?' '+d.slice(11,16):''):'';
function addDays(d,n){const p=dParts(d);const t=new Date(p.y,p.m,p.d+n);return ymd(t.getFullYear(),t.getMonth(),t.getDate())}
const icon=(n,c='')=>`<i data-lucide="${n}" class="${c}"></i>`;
const cssv=v=>getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const $=s=>document.querySelector(s);
const norm=s=>String(s??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
const MES=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const MES3=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const WD=['dom','seg','ter','qua','qui','sex','sáb'];

const ME=window.ME||{};
const isAdmin=ME.perfil==='admin', canJ=ME.perfil==='admin'||ME.perfil==='juridico', canF=ME.perfil==='admin'||ME.perfil==='financeiro';
const isLeitura=ME.perfil==='leitura', canAutorizar=!!ME.autoriza;

/* ================= Dados ================= */
let P=[],C=[],AUD=[],SUG=[],LOJAS=[],LISTAS={status:{},tipos_custa:[],categorias:[],identificacoes:[],perfis:{}},HOJE='';
let LOADED=false,SYNC={at:null,err:null,busy:false};
const _t=new Date();
const S={g:{st:'rosca',lj:'barras',dv:'barras'},fl:{lojas:[],regs:[]},flOpen:false,page:'painel',loja:'',q:'',st:'todos',cv:'lista',cf:'atencao',cy:_t.getFullYear(),cm:_t.getMonth(),sel:'',bell:false,ord:'padrao',adm:'usuarios'};
try{const sv=JSON.parse(localStorage.getItem('bj-estado')||'{}');if(sv.fl&&Array.isArray(sv.fl.lojas))S.fl={lojas:sv.fl.lojas,regs:sv.fl.regs||[]};else if(sv.loja)S.fl={lojas:[sv.loja],regs:[]};if(sv.cv)S.cv=sv.cv;if(sv.g)Object.assign(S.g,sv.g)}catch(e){}
function salvaEstado(){try{localStorage.setItem('bj-estado',JSON.stringify({fl:S.fl,cv:S.cv,g:S.g}))}catch(e){}}

async function api(path,opts={}){
  const o={method:opts.method||'GET',headers:{'X-Requested-With':'fetch'},credentials:'same-origin'};
  if(opts.body instanceof FormData)o.body=opts.body;
  else if(opts.body!==undefined){o.body=JSON.stringify(opts.body);o.headers['Content-Type']='application/json'}
  const r=await fetch(path,o);
  if(r.status===401){location.href='/login';throw new Error('Sessão expirada')}
  let j={};try{j=await r.json()}catch(e){}
  if(!r.ok){const e=new Error(j.erro||'Não foi possível salvar. Tente de novo.');e.dados=j;e.status=r.status;throw e}
  return j;
}
async function refresh(silent){
  if(SYNC.busy)return;SYNC.busy=true;
  try{const d=await api('/api/dados');P=d.processos;C=d.custas;AUD=d.audiencias||[];SUG=d.sugestoes||[];LOJAS=d.lojas;LISTAS=d.listas;HOJE=d.hoje;if(!S.sel)S.sel=HOJE;LOADED=true;SYNC.at=new Date();SYNC.err=null}
  catch(e){SYNC.err=e.message;if(!silent)toast(e.message)}
  SYNC.busy=false;
  if(document.activeElement&&['q'].includes(document.activeElement.id)){renderShell();drawIcons()}else render();
}
async function salvar(fn,okMsg){
  try{const r=await fn();await refresh(true);if(okMsg)toast(okMsg);return r}
  catch(e){toast(e.message);e.avisado=true;throw e}
}

/* ================= Regras ================= */
const PM=Object.create(null);
const proc=id=>PM[id]||(PM[id]=P.find(p=>p.id===id));
const SEM_REG='Sem regional';
const lojaReg=n=>{const l=LOJAS.find(x=>x.nome===n);return (l&&l.regional)||SEM_REG};
const lojasDisp=()=>ME.lojas&&ME.lojas.length?LOJAS.filter(l=>ME.lojas.includes(l.nome)):LOJAS;
const filtroAtivo=()=>S.fl.lojas.length+S.fl.regs.length>0;
const vis=p=>!filtroAtivo()||S.fl.lojas.includes(p.loja)||S.fl.regs.includes(lojaReg(p.loja));
function lojasFiltradas(){return lojasDisp().filter(l=>S.fl.lojas.includes(l.nome)||S.fl.regs.includes(l.regional||SEM_REG)).map(l=>l.nome)}
function filtroNome(){
  if(!filtroAtivo())return ME.lojas&&ME.lojas.length?'Minhas lojas':'Todas as lojas';
  if(!S.fl.lojas.length&&S.fl.regs.length===1)return 'Regional '+S.fl.regs[0];
  const n=lojasFiltradas();return n.length===1?n[0]:`${n.length} lojas`;
}
function regsOrdem(){const ord=[...(LISTAS.regionais||[]),SEM_REG];const tem=new Set(lojasDisp().map(l=>l.regional||SEM_REG));return ord.filter(r=>tem.has(r))}
const ativos=()=>P.filter(vis);
const autorizado=p=>!p.autorizacao;               // pendente/recusada não entram nos totais
const validos=()=>ativos().filter(autorizado);
const pendAut=()=>canAutorizar?P.filter(p=>p.autorizacao==='pendente'&&vis(p)):[];
const audVis=()=>{PMreset();return AUD.filter(a=>{const p=proc(a.processo_id);return p&&vis(p)})};
const audHora=a=>a.hora?' às '+a.hora:'';
const audFut=()=>audVis().filter(a=>a.data>=HOJE).sort((x,y)=>(x.data+x.hora).localeCompare(y.data+y.hora));
const audProx=()=>audFut().filter(a=>a.data<=addDays(HOJE,3));
const autPill=p=>p.autorizacao==='pendente'?'<span class="cu proxima">Aguardando autorização</span>':p.autorizacao==='recusada'?'<span class="cu vencida">Recusada</span>':'';
function custaSt(c){
  if(c.pago)return 'paga';
  if(!c.vencimento)return 'semdata';
  if(c.vencimento<HOJE)return 'vencida';
  if(c.vencimento===HOJE)return 'hoje';
  if(c.vencimento<=addDays(HOJE,3))return 'proxima';
  return 'aberta';
}
const CU_NOME={paga:'Paga',vencida:'Vencida',hoje:'Vence hoje',proxima:'Vence logo',aberta:'A pagar',semdata:'Sem vencimento'};
const cuPill=c=>{const s=custaSt(c);return `<span class="cu ${s}">${s==='proxima'?'Vence '+quando(c.vencimento):CU_NOME[s]}</span>`};
function quando(d){if(!d)return '';if(d===HOJE)return 'hoje';if(d===addDays(HOJE,1))return 'amanhã';const n=Math.round((new Date(d)-new Date(HOJE))/864e5);if(n>0&&n<7)return `em ${n} dias`;return brDate(d)}
const custasVis=()=>{PMreset();return C.filter(c=>{const p=proc(c.processo_id);return p&&vis(p)})};
function PMreset(){for(const k in PM)delete PM[k]}
const atencao=()=>custasVis().filter(c=>['vencida','hoje','proxima'].includes(custaSt(c))).sort((a,b)=>(a.vencimento||'').localeCompare(b.vencimento||''));
function stCls(s){const n=norm(s);if(n.includes('aberto'))return 's-aberto';if(n.includes('peticao')||n.includes('execucao')||n.includes('sentenca'))return 's-peticao';if(n.includes('documento')||n.includes('conhecimento'))return 's-docs';if(n.includes('acordo'))return 's-acordo';if(n.includes('finaliz'))return 's-fim';if(n.includes('nao entrar')||n.includes('prescrito'))return 's-neg';return ''}
const stPill=s=>`<span class="st ${stCls(s)}">${esc(s||'Sem status')}</span>`;
const parteNome=p=>p.parte||'(sem nome)';
const TIPO_NOME={cobranca:'Cobrança',diversos:'Processos diversos'};

/* ================= Casca ================= */
const PAGES=[['painel','layout-dashboard','Início'],['cobranca','hand-coins','Cobrança'],['diversos','scale','Diversos'],['custas','calendar-clock','Agenda']].filter(([k])=>!(isLeitura&&k==='diversos')); // apresentação não vê processos diversos
const isDark=()=>{const t=document.documentElement.dataset.theme;return t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches};
const READ_KEY='bj-lidos-'+ME.id;let READ=new Set();
try{READ=new Set(JSON.parse(localStorage.getItem(READ_KEY)||'[]'))}catch(e){}
function saveRead(){try{localStorage.setItem(READ_KEY,JSON.stringify([...READ].slice(-400)))}catch(e){}}

function renderShell(){
  const at=LOADED?atencao().length+audProx().length:0;
  $('#nav').innerHTML=PAGES.map(([k,ic,t])=>`<button class="${S.page===k?'active':''}" data-page="${k}">${icon(ic)}${t}${k==='custas'&&at?`<span class="badge">${at}</span>`:''}</button>`).join('')
    +(isAdmin?`<button class="nav-extra ${S.page==='admin'?'active':''}" data-page="admin">${icon('shield')}Administração</button>`:'');
  const minhas=ME.lojas&&ME.lojas.length?LOJAS.filter(l=>ME.lojas.includes(l.nome)):LOJAS;
  $('#lojaSel').innerHTML=filtroHTML();
  if(isLeitura){$('#profile').innerHTML=`<span class="me"><span class="av dono">${icon('eye')}</span><span class="me-t"><b>Modo apresentação</b><small>Só visualização</small></span></span><a class="btn sm primary btn-entrar" href="/login" title="Entrar com usuário e senha">${icon('log-in')}Entrar</a>`}
  else $('#profile').innerHTML=`<span class="me"><span class="av ${ME.perfil==='financeiro'?'sec':ME.perfil==='admin'?'eq':'dono'}">${esc((ME.nome||'?')[0])}</span><span class="me-t"><b>${esc(ME.nome)}</b><small>${esc(ME.perfil_nome)}</small></span></span><a class="iconbtn sm" href="/senha" title="Trocar senha" aria-label="Trocar senha">${icon('key-round')}</a><a class="iconbtn sm" href="/sair" title="Sair" aria-label="Sair">${icon('log-out')}</a>`;
  $('#sync').innerHTML=SYNC.err?`<span class="sync err" title="${esc(SYNC.err)}">${icon('cloud-off')}<span>Sem conexão</span></span>`:`<button class="sync" data-refresh="1" title="Atualizar agora">${icon(SYNC.busy?'loader':'cloud')}<span>${SYNC.at?'Atualizado às '+pad(SYNC.at.getHours())+':'+pad(SYNC.at.getMinutes()):'Conectando'}</span></button>`;
  $('#themeBtn').innerHTML=icon(isDark()?'sun':'moon');
  renderBell();
}
function avisos(){
  if(!LOADED)return [];
  const out=[];
  pendAut().forEach(p=>out.push({k:`p${p.id}`,tipo:'pend',ic:'shield-check',cls:'rem',t:`Cobrança aguardando sua autorização`,sub:`${parteNome(p)} · ${p.loja||'sem loja'}`,pid:p.id,ord:'0'}));
  audProx().forEach(a=>{const p=proc(a.processo_id);out.push({k:`a${a.id}-${a.data}-${a.hora}`,tipo:'aud',ic:'gavel',cls:a.data===HOJE?'late':'rem',t:`Audiência ${a.tipo.toLowerCase()} ${quando(a.data)}${audHora(a)}`,sub:`${parteNome(p)} · ${p.loja||'sem loja'}`,pid:p.id,ord:'1'+a.data+a.hora})});
  atencao().forEach(c=>{const p=proc(c.processo_id),st=custaSt(c);out.push({k:`c${c.id}-${c.vencimento}`,tipo:'cus',ic:st==='proxima'?'calendar-clock':'alert-triangle',cls:st==='proxima'?'rem':'late',t:`Custa ${c.tipo.toLowerCase()} ${st==='vencida'?'vencida em '+brDate(c.vencimento):'vence '+quando(c.vencimento)}${c.valor?' · '+fmt(c.valor):''}`,sub:`${parteNome(p)} · ${p.loja||'sem loja'}`,pid:p.id,ord:'2'+c.vencimento})});
  return out;
}
function filtroHTML(){
  const regs=regsOrdem(),ls=lojasDisp();
  const cnt=n=>P.filter(p=>p.loja===n&&p.tipo==='cobranca').length;
  const btn=`<button class="fl-btn ${filtroAtivo()?'on':''}" data-flbtn="1" aria-expanded="${S.flOpen}">${icon('store')}<span>${esc(filtroNome())}</span>${icon('chevron-down')}</button>`;
  if(!S.flOpen)return btn;
  return btn+`<div class="fl-pop" role="dialog" aria-label="Filtrar lojas">
    <div class="fl-h"><b>Regional</b>${filtroAtivo()?'<button class="fl-link" data-flclear="1">Limpar filtro</button>':''}</div>
    <div class="fl-regs">${regs.map(r=>`<label class="fl-chip ${S.fl.regs.includes(r)?'on':''}"><input type="checkbox" data-flreg="${esc(r)}" ${S.fl.regs.includes(r)?'checked':''}>${esc(r)}</label>`).join('')}</div>
    <div class="fl-h"><b>Lojas</b><span class="muted">marque uma ou mais</span></div>
    <div class="fl-lojas">${regs.map(r=>{const doR=ls.filter(l=>(l.regional||SEM_REG)===r);const regOn=S.fl.regs.includes(r);
      return `<div class="fl-grupo"><small>${esc(r)}</small>${doR.map(l=>{const on=regOn||S.fl.lojas.includes(l.nome);return `<label class="${regOn?'via':''}"><input type="checkbox" data-flloja="${esc(l.nome)}" ${on?'checked':''} ${regOn?'disabled title="Já incluída pela regional"':''}>${esc(l.nome)}<span class="muted">${cnt(l.nome)}</span></label>`}).join('')}</div>`}).join('')}</div>
    <div class="fl-f"><button class="btn sm primary" data-flok="1">Pronto</button></div></div>`;
}
function renderBell(){
  const list=avisos(),unread=list.filter(n=>!READ.has(n.k)).length;
  $('#bell').innerHTML=`<button class="iconbtn" data-bell="1" aria-label="Avisos">${icon('bell')}</button>${unread?`<span class="cnt">${unread}</span>`:''}
  ${S.bell?`<div class="np" role="dialog" aria-label="Avisos"><div class="np-h"><b>Avisos</b><span class="np-acts">${unread?'<button data-readall="1">Marcar como vistos</button>':''}</span></div>
  <div class="np-list">${list.length?list.map(n=>`<button class="np-item ${READ.has(n.k)?'':'unread'}" data-notif="${esc(n.k)}" data-pid="${n.pid}"><span class="np-ic ${n.cls}">${icon(n.ic)}</span><span style="flex:1;min-width:0"><span class="np-t">${esc(n.t)}</span><small>${esc(n.sub)}</small></span></button>`).join(''):'<div class="np-empty">Nenhum aviso. Tudo em dia.</div>'}</div></div>`:''}`;
}
let CH=[];
function render(){
  renderShell();
  if(!LOADED){$('#page').innerHTML=SYNC.err?`<div class="loading aviso"><div>${icon('plug-zap')}<h2>Sem conexão</h2><p>${esc(SYNC.err)}</p><button class="btn" data-refresh="1">${icon('refresh-cw')}Tentar de novo</button></div></div>`:`<div class="loading"><span class="spin"></span>Carregando...</div>`;drawIcons();return}
  PMreset();
  if(isLeitura&&S.page==='diversos')S.page='painel';
  const PG={painel,cobranca:()=>lista('cobranca'),diversos:()=>lista('diversos'),custas:pgCustas,admin:pgAdmin};
  $('#page').innerHTML=(PG[S.page]||painel)();
  drawIcons();mountCharts();
  if(S.page==='admin')carregaAdmin();
}
function drawIcons(){try{window.lucide&&lucide.createIcons()}catch(e){}}
const mseg=(key,opts)=>`<div class="mseg">${opts.map(([v,t,ic])=>`<button class="${S[key]===v?'active':''}" data-set="${key}:${v}">${ic?icon(ic):''}${t}</button>`).join('')}</div>`;
const kpi=(ic,l,v,s,c,hero)=>`<div class="card kpi ${hero?'hero':''}"><div class="kpi-top"><span class="kchip ${c||''}">${icon(ic)}</span><span class="kpi-l">${l}</span></div><span class="kpi-v num ${hero?'':c||''}">${v}</span>${s?`<span class="kpi-s num">${s}</span>`:''}</div>`;
const soma=(arr,f)=>arr.reduce((a,x)=>a+(Number(x[f])||0),0);

/* ================= Início ================= */
function painel(){
  const ps=validos(),cob=ps.filter(p=>p.tipo==='cobranca'),div=ps.filter(p=>p.tipo==='diversos');
  const enc=s=>['Não entrar com ação','Finalizado'].includes(s);
  const cobAt=cob.filter(p=>!enc(p.status));
  const acordos=cob.filter(p=>p.valor_acordo);
  const tAc=soma(acordos,'valor_acordo'),tPago=soma(cob,'valor_pago');
  const cv=custasVis(),abertas=cv.filter(c=>!c.pago),venc=abertas.filter(c=>c.vencimento&&c.vencimento<HOJE);
  const at=atencao();
  let h=`<div class="ph"><div><h1>${filtroAtivo()?esc(filtroNome()):'Visão geral'}</h1><p>${isLeitura?`${cob.length} cobranças`:`${cob.length} cobranças e ${div.length} processos diversos`}</p></div><div class="ph-actions">${canJ?`<button class="btn primary" data-act="novo">${icon('plus')}Novo processo</button>`:''}</div></div>`;
  const pa=pendAut();
  if(pa.length)h+=`<button class="strip warn" data-goaut="1">${icon('shield-check')}<span><b>${pa.length} ${pa.length===1?'cobrança aguardando':'cobranças aguardando'} sua autorização</b><small>Lançada${pa.length>1?'s':''} pelo jurídico e ainda fora dos totais</small></span><em>Ver${icon('chevron-right')}</em></button>`;
  const ap=audProx();
  if(ap.length){const a=ap[0],pp=proc(a.processo_id);h+=`<button class="strip aud" data-page="custas" data-cfgo="aud">${icon('gavel')}<span><b>${ap.length} ${ap.length===1?'audiência':'audiências'} nos próximos 3 dias</b><small>Próxima: ${esc(parteNome(pp))}, ${quando(a.data)}${audHora(a)}</small></span><em>Ver agenda${icon('chevron-right')}</em></button>`}
  if(at.length){const nv=at.filter(c=>['vencida','hoje'].includes(custaSt(c))).length,nl=at.length-nv;
    h+=`<button class="strip ${nv?'neg':'warn'}" data-page="custas" data-cfgo="atencao">${icon(nv?'alert-triangle':'calendar-clock')}<span><b>${nv?`${nv} ${nv===1?'custa vencida':'custas vencidas'}`:''}${nv&&nl?' e ':''}${nl?`${nl} vencendo nos próximos 3 dias`:''}</b><small>Mais antiga: ${esc(parteNome(proc(at[0].processo_id)))}, ${brDate(at[0].vencimento)}</small></span><em>Ver custas${icon('chevron-right')}</em></button>`}
  h+=`<div class="kpis kpis5">
    ${kpi('hand-coins','Em cobrança',fmt0(soma(cobAt,'valor')),`${cobAt.length} clientes no jurídico`,'',true)}
    ${kpi('gavel','Processo aberto',fmt0(soma(cob.filter(p=>p.status==='Processo Aberto'),'valor')),`${cob.filter(p=>p.status==='Processo Aberto').length} processos`)}
    ${kpi('handshake','Acordos',fmt0(tAc),(()=>{const f=cob.filter(p=>p.status==='Feito Acordo').length;return tAc?`${acordos.length} com valor lançado`:f?`${f} feitos, sem valor lançado`:'nenhum ainda'})(),'pos')}
    ${kpi('wallet','Recebido',fmt0(tPago),tAc>tPago?`falta receber ${fmt0(tAc-tPago)}`:'','pos')}
    ${kpi('receipt','Custas a pagar',String(abertas.length),venc.length?`${venc.length} vencida${venc.length>1?'s':''}`:`${fmt0(soma(abertas,'valor'))} lançado`,venc.length?'neg':'warn')}
  </div>`;
  const nSt=k=>cob.filter(p=>(p.status||'Sem status')===k).length;
  const nLj=k=>cob.filter(p=>(p.loja||'Sem loja')===k).length;
  const totSt=porStatus().reduce((x,r)=>x+r[1],0)||1;
  const rSt=porStatus().map(([k,v])=>({k,v,cor:corStatus(k),sub:`${nSt(k)} · ${Math.round(v/totSt*100)}%`,attrs:`data-gost="${esc(k)}"`}));
  const cLj=coresEntidade(P.filter(p=>p.tipo==='cobranca'),p=>p.loja||'Sem loja',p=>Number(p.valor)||0);
  const rLj=porLoja().map(([k,v])=>({k,v,cor:cLj(k),sub:`${nLj(k)} ${nLj(k)===1?'cliente':'clientes'}`,attrs:`data-golj="${esc(k)}"`}));
  const mDv={};div.forEach(p=>{const k=p.tipo_acao||'Sem tipo';mDv[k]=(mDv[k]||0)+1});
  const cDv=coresEntidade(P.filter(p=>p.tipo==='diversos'),p=>p.tipo_acao||'Sem tipo',()=>1);
  const rDv=Object.entries(mDv).sort((a,b)=>b[1]-a[1]).map(([k,v])=>({k,v,cor:cDv(k),sub:'',attrs:`data-godiv="${esc(k)}"`}));
  const cond=soma(div,'valor');
  G={};
  h+=`<div class="g2 g2-eq">
    ${cardGraf('st','Cobrança por status','valor da dívida',rSt,{centro:'Todos os status',maxPie:9,maxBar:9,aria:'Valor em cobrança por status'})}
    ${cardGraf('lj','Cobrança por loja',`${rLj.length} lojas, maiores valores`,rLj,{centro:'Todas as lojas',outros:n=>`Outras ${n} lojas`,aria:'Valor em cobrança por loja'})}
  </div>
  <div class="${isLeitura?'':'g2 g2-eq'}">
    <section class="card"><div class="card-h"><h2>Próximos dias</h2><span class="sub">custas e audiências</span><button class="link" data-page="custas">Agenda</button></div><div class="card-b">${proxCustas()}</div></section>
    ${isLeitura?'':div.length?cardGraf('dv','Processos diversos',`${div.length} processos`,rDv,{centro:'Processos',cont:true,maxBar:7,outros:n=>`Outros ${n} tipos`,aria:'Processos diversos por tipo de ação'}):`<section class="card"><div class="card-h"><h2>Processos diversos</h2></div><div class="card-b"><p class="empty">Nenhum processo diverso.</p></div></section>`}
  </div>`;
  return h;
}
/* Gráfico com opção Rosca ou Barras (a escolha fica salva no navegador) */
let G={};
function coresEntidade(lista,chave,peso){ // cor fixa por item: ordem pelo total de toda a base, não pelo filtro atual
  const m={};lista.forEach(p=>{const k=chave(p);m[k]=(m[k]||0)+peso(p)});
  const ord=Object.entries(m).sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
  return k=>{const i=ord.indexOf(k);return i>=0&&i<7?cssv('--s'+(i+1)):cssv('--s0')};
}
function cardGraf(key,titulo,sub,rows,o){
  const modo=S.g[key]||'rosca',fv=o.cont?(v=>String(v)):fmt0,tot=rows.reduce((x,r)=>x+r.v,0)||1;
  const tools=`<div class="tools"><div class="mseg" role="group" aria-label="Tipo de gráfico"><button class="${modo==='rosca'?'active':''}" data-graf="${key}:rosca" title="Rosca">${icon('circle-dot')}Rosca</button><button class="${modo==='barras'?'active':''}" data-graf="${key}:barras" title="Barras">${icon('bar-chart-horizontal')}Barras</button></div></div>`;
  let corpo;
  if(!rows.length)corpo='<p class="empty">Sem dados.</p>';
  else if(modo==='barras'){
    const top=rows.slice(0,o.maxBar||8),resto=rows.slice(top.length),max=Math.max(...top.map(r=>r.v),1),sr=resto.reduce((x,r)=>x+r.v,0);
    corpo=`<div class="hb-list">${top.map(r=>`<button class="hb ${o.cont?'hb-n':''}" ${r.attrs} title="${esc(r.k)}: ${fv(r.v)}"><span class="hb-l">${esc(r.k)}</span><span class="hb-t"><i style="width:${Math.max(r.v/max*100,r.v?1.5:0)}%"></i></span><span class="hb-v num">${fv(r.v)}${r.sub?`<small>${r.sub}</small>`:''}</span></button>`).join('')}${resto.length?`<p class="hint" style="margin:6px 0 0">${o.outros(resto.length)} somam ${fv(sr)}.</p>`:''}</div>`;
  }else{
    let fat=rows.slice(0,o.maxPie||6);const resto=rows.slice(fat.length);
    if(resto.length)fat=[...fat,{k:o.outros(resto.length),v:resto.reduce((x,r)=>x+r.v,0),cor:cssv('--s0'),sub:'',attrs:''}];
    G[key]={fat,tot,fv};
    corpo=`<div class="pie-st"><div class="pie-box"><canvas id="cg-${key}" role="img" aria-label="${esc(o.aria)}"></canvas><div class="center"><small>${o.centro}</small><b class="num">${fv(tot)}</b></div></div>
      <ul class="pie-lgd">${fat.map(r=>`<li><button ${r.attrs||'disabled'}><i style="background:${r.cor}"></i><span>${esc(r.k)}</span><b class="num">${fv(r.v)}</b><small class="num">${r.sub&&!o.cont?r.sub:Math.round(r.v/tot*100)+'%'}</small></button></li>`).join('')}</ul></div>`;
  }
  return `<section class="card" id="card-${key}"><div class="card-h"><h2>${titulo}</h2><span class="sub">${sub}</span>${tools}</div><div class="card-b">${corpo}</div></section>`;
}
function corStatus(k){const ord=LISTAS.status.cobranca||[];const i=ord.indexOf(k);return i<0?cssv('--s0'):cssv('--s'+(i%7+1))}
function porLoja(){const m={};validos().filter(p=>p.tipo==='cobranca').forEach(p=>{const k=p.loja||'Sem loja';m[k]=(m[k]||0)+(Number(p.valor)||0)});return Object.entries(m).sort((a,b)=>b[1]-a[1])}
function porStatus(){const m={};validos().filter(p=>p.tipo==='cobranca').forEach(p=>{const k=p.status||'Sem status';m[k]=(m[k]||0)+(Number(p.valor)||0)});const ord=[...(LISTAS.status.cobranca||[]),'Sem status'];return Object.entries(m).sort((a,b)=>ord.indexOf(a[0])-ord.indexOf(b[0]))}
function proxCustas(){
  const l=[...custasVis().filter(c=>!c.pago&&c.vencimento&&c.vencimento>=HOJE).map(c=>({d:c.vencimento+'9',h:cRow(c,true)})),
           ...audFut().map(a=>({d:a.data+(a.hora||'0'),h:aRow(a,true)}))].sort((x,y)=>x.d.localeCompare(y.d)).slice(0,7);
  return l.length?`<div class="ulist">${l.map(x=>x.h).join('')}</div>`:'<p class="empty">Nada marcado para os próximos dias.</p>';
}
function aRow(a,compacto){
  const p=proc(a.processo_id),d=dParts(a.data),hoje=a.data===HOJE;
  const pill=`<span class="cu ${hoje?'hoje':a.data<=addDays(HOJE,3)?'proxima':'aud'}">${hoje?'Hoje':'Audiência '+quando(a.data)}${audHora(a)}</span>`;
  if(compacto)return `<div class="urow clickable is-aud" data-open="${p.id}"><div class="datebox">${`<b>${d.d}</b><small>${MES3[d.m]}</small>`}</div><div class="t"><b>${esc(parteNome(p))}</b><small>Audiência de ${esc(a.tipo.toLowerCase())} · ${esc(p.loja||'sem loja')} ${pill}</small></div><div class="v num">${a.hora||''}</div></div>`;
  return `<div class="crow is-aud"><div class="datebox"><b>${d.d}</b><small>${MES3[d.m]}</small></div><div class="t" data-open="${p.id}"><b>${esc(parteNome(p))}</b><small>Audiência de ${esc(a.tipo.toLowerCase())}${a.local?' · '+esc(a.local):''} · ${esc(p.loja||'sem loja')} ${pill}</small></div><div class="v num">${a.hora||''}</div><div class="acts"><button class="btn sm" data-open="${p.id}">${icon('folder-open')}Abrir processo</button></div></div>`;
}
function cRow(c,compacto){
  const p=proc(c.processo_id),d=c.vencimento?dParts(c.vencimento):null;
  if(compacto)return `<div class="urow clickable" data-open="${p.id}"><div class="datebox">${d?`<b>${d.d}</b><small>${MES3[d.m]}</small>`:'<b>–</b>'}</div><div class="t"><b>${esc(parteNome(p))}</b><small>${esc(c.tipo)} · ${esc(p.loja||'sem loja')} ${cuPill(c)}</small></div><div class="v num">${c.valor?fmt(c.valor):''}</div></div>`;
  return `<div class="crow"><div class="datebox">${d?`<b>${d.d}</b><small>${MES3[d.m]}</small>`:'<b>–</b>'}</div><div class="t" data-open="${p.id}"><b>${esc(parteNome(p))}</b><small>Custa ${esc(c.tipo.toLowerCase())}${c.descricao?' · '+esc(c.descricao):''} · ${esc(p.loja||'sem loja')} ${cuPill(c)}</small></div><div class="v num">${c.valor?fmt(c.valor):'<span class="muted">sem valor</span>'}</div><div class="acts">${c.link&&!isLeitura?`<a class="btn sm" href="${esc(c.link)}" target="_blank" rel="noopener" title="Abrir boleto">${icon('file-text')}Boleto</a>`:''}${canF&&!c.pago?`<button class="btn sm primary" data-pagar="${c.id}">${icon('check')}Paga</button>`:''}</div></div>`;
}

/* ================= Gráficos ================= */
function baseOpts(){const ink=cssv('--ink'),surf=cssv('--surface'),line=cssv('--line');
  return {responsive:true,maintainAspectRatio:false,animation:matchMedia('(prefers-reduced-motion: reduce)').matches?false:{duration:500},indexAxis:'y',
    plugins:{legend:{display:false},tooltip:{backgroundColor:surf,titleColor:ink,bodyColor:ink,borderColor:line,borderWidth:1,padding:12,cornerRadius:12,callbacks:{label:c=>' '+fmt0(c.parsed.x)}}},
    scales:{x:{grid:{color:line},border:{display:false},ticks:{maxTicksLimit:5,callback:v=>v>=1000?(v/1000).toLocaleString('pt-BR')+' mil':v}},y:{grid:{display:false},border:{display:false},ticks:{color:ink}}}}}
function mountCharts(){
  CH.forEach(c=>c.destroy());CH=[];
  if(S.page!=='painel'||!window.Chart)return;
  Chart.defaults.font.family="'Poppins',system-ui,sans-serif";Chart.defaults.font.size=11.5;Chart.defaults.color=cssv('--muted');
  const surf=cssv('--surface'),ink=cssv('--ink'),line=cssv('--line'),anim=matchMedia('(prefers-reduced-motion: reduce)').matches?false:{duration:500};
  Object.entries(G).forEach(([key,g])=>{
    const el=$('#cg-'+key);if(!el)return;
    const leg=()=>document.querySelectorAll(`#card-${key} .pie-lgd button`);
    CH.push(new Chart(el,{type:'doughnut',data:{labels:g.fat.map(r=>r.k),datasets:[{data:g.fat.map(r=>r.v),backgroundColor:g.fat.map(r=>r.cor),borderColor:surf,borderWidth:2,hoverOffset:6,spacing:1}]},
      options:{responsive:true,maintainAspectRatio:false,cutout:'70%',animation:anim,layout:{padding:6},
        onClick:(e,els)=>{if(els.length){const b=leg()[els[0].index];if(b&&!b.disabled)b.click()}},
        onHover:(e,els)=>{const b=els.length&&leg()[els[0].index];e.native.target.style.cursor=b&&!b.disabled?'pointer':'default'},
        plugins:{legend:{display:false},tooltip:{backgroundColor:surf,titleColor:ink,bodyColor:ink,borderColor:line,borderWidth:1,padding:12,cornerRadius:8,boxPadding:4,
          callbacks:{label:c=>` ${g.fv(c.parsed)} (${Math.round(c.parsed/g.tot*100)}%)`}}}}}));
  });
}

/* ================= Listas (Cobrança e Diversos) ================= */
function filtrados(tipo){
  const q=norm(S.q.trim());
  let l=ativos().filter(p=>p.tipo===tipo);
  if(S.st==='autorizacao')l=l.filter(p=>p.autorizacao==='pendente');
  else if(S.st==='recusada')l=l.filter(p=>p.autorizacao==='recusada');
  else if(S.st==='conferir')l=l.filter(p=>norm(p.andamento).startsWith('conferir'));
  else if(S.st==='custas')l=l.filter(p=>C.some(c=>c.processo_id===p.id&&!c.pago));
  else if(S.st!=='todos')l=l.filter(p=>(p.status||'Sem status')===S.st);
  if(q)l=l.filter(p=>norm([p.parte,p.numero,p.codigo_cliente,p.documento,p.loja,p.tipo_acao,p.andamento,p.identificacao].join(' ')).includes(q));
  const o={padrao:(a,b)=>(a.loja||'').localeCompare(b.loja||'')||parteNome(a).localeCompare(parteNome(b)),valor:(a,b)=>(Number(b.valor)||0)-(Number(a.valor)||0),recente:(a,b)=>(b.andamento_em||b.atualizado_em||'').localeCompare(a.andamento_em||a.atualizado_em||''),nome:(a,b)=>parteNome(a).localeCompare(parteNome(b))};
  return l.sort(o[S.ord]||o.padrao);
}
function lista(tipo){
  const todos=ativos().filter(p=>p.tipo===tipo),l=filtrados(tipo);
  const cont={};todos.forEach(p=>{const k=p.status||'Sem status';cont[k]=(cont[k]||0)+1});
  const sts=[...(LISTAS.status[tipo]||[]),'Sem status'].filter(s=>cont[s]);Object.keys(cont).forEach(s=>{if(!sts.includes(s))sts.push(s)});
  const nConf=todos.filter(p=>norm(p.andamento).startsWith('conferir')).length,nCus=todos.filter(p=>C.some(c=>c.processo_id===p.id&&!c.pago)).length;
  const nAut=todos.filter(p=>p.autorizacao==='pendente').length,nRec=todos.filter(p=>p.autorizacao==='recusada').length;
  const chips=[['todos','Todos',todos.length],...(nAut?[['autorizacao','Aguardando autorização',nAut]]:[]),...(nRec?[['recusada','Recusadas',nRec]]:[]),...sts.map(s=>[s,s,cont[s]]),...(nCus?[['custas','Com custa a pagar',nCus]]:[]),...(nConf?[['conferir','Para conferir',nConf]]:[])];
  const pend=p=>C.filter(c=>c.processo_id===p.id&&!c.pago);
  const icons=p=>{const pc=pend(p),v=pc.some(c=>['vencida','hoje'].includes(custaSt(c)));return `<span class="ico-row">${p.n_anexos?`<span class="on" title="${p.n_anexos} anexo(s)">${icon('paperclip')}${p.n_anexos}</span>`:''}${pc.length?`<span class="${v?'miss':'on'}" title="${pc.length} custa(s) a pagar">${icon('receipt')}${pc.length}</span>`:''}${p.conferido?`<span class="on" title="Recebimento conferido">${icon('badge-check')}</span>`:''}</span>`};
  let head,rows;
  if(tipo==='cobranca'){
    head=`<th>Loja</th><th>Cliente</th><th>Status</th><th class="r">Dívida</th><th class="r">Acordo</th><th class="r">Pago</th><th></th><th>Último andamento</th>`;
    rows=l.map(p=>`<tr data-open="${p.id}"><td>${esc(p.loja||'–')}</td><td class="desc"><b>${esc(parteNome(p))}</b><span class="nproc">${p.documento&&!isLeitura?esc(p.documento)+' · ':''}${p.codigo_cliente?'Cód. '+esc(p.codigo_cliente)+' · ':''}${p.numero?esc(p.numero):'sem nº de processo'}</span></td><td>${stPill(p.status)} ${autPill(p)}</td><td class="r num">${fmt(p.valor)}</td><td class="r num">${p.valor_acordo?fmt(p.valor_acordo):'–'}</td><td class="r num ${p.valor_pago?'pos':''}">${p.valor_pago?fmt(p.valor_pago):'–'}</td><td>${icons(p)}</td><td class="and"><span>${esc(p.andamento)}</span></td></tr>`).join('');
  }else{
    head=`<th>Nº do processo</th><th>Parte</th><th>Tipo de ação</th><th>Loja</th><th>Status</th><th class="r">Condenação</th><th class="r">Pago</th><th></th>`;
    rows=l.map(p=>`<tr data-open="${p.id}"><td class="num">${esc(p.numero||'–')}</td><td class="desc"><b>${esc(parteNome(p))}</b>${p.identificacao?`<span class="nproc">${esc(p.identificacao)}</span>`:''}</td><td>${esc(p.tipo_acao||'–')}</td><td>${esc(p.loja||'–')}${p.uf?` <span class="tag">${esc(p.uf)}</span>`:''}</td><td>${stPill(p.status)}</td><td class="r num">${p.valor?fmt(p.valor):'–'}</td><td class="r num">${p.valor_pago?fmt(p.valor_pago):'–'}</td><td>${icons(p)}</td></tr>`).join('');
  }
  const cols=8,tv=soma(l,'valor');
  return `<div class="ph"><div><h1>${TIPO_NOME[tipo]}</h1><p>${l.length} de ${todos.length} processos${tv?' · '+fmt0(tv):''}</p></div><div class="ph-actions">${isLeitura?'':`<button class="btn" data-csv="${tipo}">${icon('download')}Exportar</button>`}${canJ?`<button class="btn primary" data-act="novo" data-tipo="${tipo}">${icon('plus')}Novo processo</button>`:''}</div></div>
  <section class="card"><div class="flt-row">${chips.map(([k,t,n])=>`<button class="chip ${S.st===k?'active':''}" data-st="${esc(k)}">${esc(t)} <small>${n}</small></button>`).join('')}</div>
  <div class="filters"><select class="mseg" data-ord="1" aria-label="Ordenar" style="border:0;padding:7px 10px;font-size:12.5px;font-weight:500">${[['padrao','Ordenar por loja'],['nome','Por nome'],['valor','Maior valor'],['recente','Atualizados recentemente']].map(([k,t])=>`<option value="${k}" ${S.ord===k?'selected':''}>${t}</option>`).join('')}</select><label class="search">${icon('search')}<input id="q" placeholder="Buscar cliente, nº, código..." value="${esc(S.q)}"></label></div>
  <div class="tbl-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows||`<tr><td colspan="${cols}" class="empty" style="padding:24px 12px">Nenhum processo encontrado.</td></tr>`}</tbody></table></div></section>`;
}
function exportarCSV(tipo){
  const l=filtrados(tipo);
  const cols=tipo==='cobranca'?[['loja','Loja'],['carteira','Carteira'],['ano','Ano'],['codigo_cliente','Código'],['parte','Cliente'],['documento','CNPJ/CPF'],['valor','Valor da dívida'],['status','Status'],['numero','Nº processo'],['valor_acordo','Valor do acordo'],['valor_pago','Valor pago'],['andamento','Último andamento']]
    :[['identificacao','Identificação'],['numero','Nº processo'],['tipo_acao','Tipo de ação'],['loja','Loja'],['uf','UF'],['ano','Ano'],['parte','Parte'],['teor','Teor'],['status','Status'],['valor','Valor da condenação'],['valor_pago','Valor pago'],['andamento','Último andamento']];
  const cel=v=>{if(typeof v==='number')return String(v).replace('.',',');const s=String(v??'');return /[;"\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};
  const csv='﻿'+[cols.map(c=>c[1]).join(';'),...l.map(p=>cols.map(c=>cel(p[c[0]])).join(';'))].join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download=`${tipo}-${HOJE}.csv`;a.click();
}

/* ================= Custas ================= */
function pgCustas(){
  const cv=custasVis();
  const grupos={atencao:cv.filter(c=>['vencida','hoje','proxima'].includes(custaSt(c))),abertas:cv.filter(c=>!c.pago),pagas:cv.filter(c=>c.pago),todas:cv};
  const af=audFut(),av=audVis();
  const tools=`<div class="ag-bar">${mseg('cv',[['lista','Lista','list'],['mes','Calendário','calendar-days']])}</div>`;
  let body;
  if(S.cv==='lista'){
    const chipsA=[['aud','Audiências',af.length],['atencao','Custas vencidas e vencendo',grupos.atencao.length],['abertas','Custas a pagar',grupos.abertas.length],['pagas','Custas pagas',grupos.pagas.length],['todas','Todas as custas',cv.length]];
    let conteudo;
    if(S.cf==='aud')conteudo=af.length?`<div class="ulist">${af.map(a=>aRow(a)).join('')}</div>`:`<p class="empty">Nenhuma audiência marcada.${canJ?' Para marcar, abra o processo e use "Nova audiência".':''}</p>`;
    else{const l=[...grupos[S.cf]].sort((a,b)=>S.cf==='pagas'?(b.pago_em||'').localeCompare(a.pago_em||''):(a.vencimento||'9').localeCompare(b.vencimento||'9'));
      conteudo=l.length?`<div class="ulist">${l.map(c=>cRow(c)).join('')}</div>`:'<p class="empty">Nenhuma custa aqui.</p>'}
    body=`<section class="card"><div class="flt-row" style="padding-bottom:14px">${chipsA.map(([k,t,n])=>`<button class="chip ${S.cf===k?'active':''}" data-cf="${k}">${t} <small>${n}</small></button>`).join('')}</div><div class="card-b" style="padding-top:0">${conteudo}</div></section>`;
  }else{
    const first=new Date(S.cy,S.cm,1),start=first.getDay(),dim=new Date(S.cy,S.cm+1,0).getDate();
    const cells=Math.ceil((start+dim)/7)*7;let g=WD.map(w=>`<div class="wd">${w}</div>`).join('');
    for(let i=0;i<cells;i++){
      const t=new Date(S.cy,S.cm,1-start+i),d=ymd(t.getFullYear(),t.getMonth(),t.getDate()),out=t.getMonth()!==S.cm;
      const its=cv.filter(c=>c.vencimento===d),aus=av.filter(a=>a.data===d);
      const k=c=>c.pago?'cp':(['vencida','hoje'].includes(custaSt(c))?'cv':'ca');
      const items=[...aus.map(a=>`<span class="ev au">${a.hora?a.hora+' ':''}${esc(parteNome(proc(a.processo_id)))}</span>`),...its.map(c=>`<span class="ev ${k(c)}">${esc(parteNome(proc(c.processo_id)))}</span>`)];
      const dots=[...aus.map(()=>'<i class="au"></i>'),...its.map(c=>`<i class="${k(c)}"></i>`)].slice(0,6).join('');
      g+=`<button class="day ${out?'out':''} ${d===HOJE?'today':''} ${d===S.sel?'sel':''}" data-day="${d}" aria-label="${t.getDate()} de ${MES[t.getMonth()]}"><span class="n">${t.getDate()}</span>${items.slice(0,3).join('')}${items.length>3?`<span class="more">+${items.length-3}</span>`:''}<span class="dots">${dots}</span></button>`;
    }
    const sel=cv.filter(c=>c.vencimento===S.sel),selA=av.filter(a=>a.data===S.sel).sort((x,y)=>(x.hora||'').localeCompare(y.hora||'')),p=dParts(S.sel||HOJE);
    body=`<div class="legend" style="margin-bottom:-6px"><span><i style="background:var(--nt)"></i>Audiência</span><span><i style="background:var(--neg)"></i>Custa vencida</span><span><i style="background:var(--accent)"></i>Custa a pagar</span><span><i style="background:var(--pos)"></i>Custa paga</span></div>
    <div class="cal"><section class="card" style="overflow:hidden"><div class="cal-grid">${g}</div></section><section class="card"><div class="card-h"><h2>${S.sel===HOJE?'Hoje, ':''}${p.d} de ${MES[p.m]}</h2></div><div class="card-b">${sel.length||selA.length?`<div class="ulist">${selA.map(a=>aRow(a)).join('')}${sel.map(c=>cRow(c)).join('')}</div>`:'<p class="empty">Nada neste dia.</p>'}</div></section></div>`;
  }
  const semData=cv.filter(c=>!c.vencimento&&!c.pago).length;
  const sugH=canJ&&SUG.length?`<section class="card sug"><div class="card-h"><h2>${icon('sparkles')}Audiências encontradas nos andamentos</h2><span class="sub">confira e adicione na agenda com um clique</span></div><div class="card-b"><div class="ulist">${SUG.filter(x=>{const pp=proc(x.processo_id);return pp&&vis(pp)}).map(x=>{const pp=proc(x.processo_id),d=dParts(x.data);return `<div class="crow is-aud"><div class="datebox"><b>${d.d}</b><small>${MES3[d.m]}</small></div><div class="t" data-open="${pp.id}"><b>${esc(parteNome(pp))}</b><small>${esc(x.tipo)}${x.hora?' às '+x.hora:''} · ${esc(pp.loja||'sem loja')}</small><small class="trecho">"...${esc(x.trecho)}..."</small></div><div class="v"></div><div class="acts"><button class="btn sm" data-sug-ign="${x.andamento_id}">Ignorar</button><button class="btn sm primary" data-sug-add="${x.andamento_id}">${icon('plus')}Adicionar</button></div></div>`}).join('')}</div></div></section>`:'';
  return `<div class="ph"><div><h1>Agenda</h1><p>${af.length} ${af.length===1?'audiência marcada':'audiências marcadas'} · ${grupos.abertas.length} custas a pagar${semData?` · ${semData} sem vencimento`:''}</p></div><div class="ph-actions">${S.cv==='mes'?`<div class="monthnav"><button data-mnav="-1" aria-label="Mês anterior">${icon('chevron-left')}</button><span>${MES[S.cm]} ${S.cy}</span><button data-mnav="1" aria-label="Próximo mês">${icon('chevron-right')}</button></div><button class="btn" data-today="1">Hoje</button>`:''}</div></div>${sugH}${tools}${body}
  <p class="hint">${canJ?'Para lançar uma custa ou marcar uma audiência, abra o processo. ':''}${canF?'Ao pagar, anexe o comprovante dentro do processo.':''}</p>`;
}

/* ================= Janelas ================= */
function closeLayer(){$('#layer').innerHTML='';ABERTO=null}
function openLayer(html,drawer=false){$('#layer').innerHTML=`<div class="overlay ${drawer?'drawer':''}" data-close="1"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;drawIcons();if(!drawer){const f=document.querySelector('#layer input:not([type=checkbox]):not([type=file]),#layer select,#layer textarea');if(f)f.focus()}}
const mh=t=>`<div class="m-h"><h2>${t}</h2><button class="x" data-close="1" aria-label="Fechar">${icon('x')}</button></div>`;
function toast(t){const el=document.createElement('div');el.className='toast';el.textContent=t;document.body.appendChild(el);setTimeout(()=>el.remove(),2600)}
const opts=(arr,sel,vazio)=>(vazio!==undefined?`<option value="">${vazio}</option>`:'')+arr.map(v=>`<option ${v===sel?'selected':''}>${esc(v)}</option>`).join('');
const lojaOpts=sel=>{const ls=(ME.lojas&&ME.lojas.length?ME.lojas:LOJAS.map(l=>l.nome));const all=sel&&!ls.includes(sel)?[sel,...ls]:ls;return opts(all,sel,'Escolha')};
const numIn=v=>v==null||v===''?'':Number(v).toFixed(2);

function camposForm(p,tipo){
  const dJ=canJ?'':'disabled';
  const f=(id,l,v,extra='',full)=>`<div class="fld ${full?'full':''}"><label for="p-${id}">${l}</label><input id="p-${id}" value="${esc(v??'')}" ${extra} ${dJ}></div>`;
  const stSel=`<div class="fld"><label for="p-status">Status</label><select id="p-status" ${dJ}>${opts([...(LISTAS.status[tipo]||[]),...(p.status&&!(LISTAS.status[tipo]||[]).includes(p.status)?[p.status]:[])],p.status||'','Sem status')}</select></div>`;
  const lj=`<div class="fld"><label for="p-loja">Loja</label><select id="p-loja" ${dJ}>${lojaOpts(p.loja||(S.fl.lojas.length===1&&!S.fl.regs.length?S.fl.lojas[0]:''))}</select></div>`;
  if(tipo==='cobranca')return `${f('parte','Cliente',p.parte,'',true)}${lj}${stSel}${f('codigo_cliente','Código do cliente',p.codigo_cliente)}${f('documento','CNPJ / CPF',p.documento)}${f('numero','Nº do processo',p.numero)}${f('carteira','Carteira',p.carteira)}${f('ano','Ano',p.ano,'inputmode="numeric"')}${f('valor','Valor da dívida (R$)',numIn(p.valor),'inputmode="decimal"')}`;
  return `${f('numero','Nº do processo',p.numero)}<div class="fld"><label for="p-identificacao">Identificação</label><select id="p-identificacao" ${dJ}>${opts(LISTAS.identificacoes,p.identificacao||'','–')}</select></div>${f('parte','Parte',p.parte,'',true)}${f('tipo_acao','Tipo de ação',p.tipo_acao,'list="acoes"')}${lj}${f('uf','UF',p.uf,'maxlength="2"')}${f('ano','Ano',p.ano,'inputmode="numeric"')}${stSel}${f('valor','Valor da condenação (R$)',numIn(p.valor),'inputmode="decimal"')}<div class="fld full"><label for="p-teor">Teor do processo</label><textarea id="p-teor" ${dJ} style="min-height:60px">${esc(p.teor||'')}</textarea></div>
  <datalist id="acoes">${[...new Set(P.filter(x=>x.tipo_acao).map(x=>x.tipo_acao))].sort().map(a=>`<option value="${esc(a)}">`).join('')}</datalist>`;
}
const CJ=['parte','loja','status','codigo_cliente','documento','numero','carteira','ano','valor','identificacao','tipo_acao','uf','teor'];
function lerForm(){const d={};CJ.forEach(k=>{const el=$('#p-'+k);if(el)d[k]=el.value.trim()});return d}

function openNovo(tipo){
  tipo=tipo||(S.page==='diversos'?'diversos':'cobranca');
  openLayer(`${mh('Novo processo')}<form id="f-novo" data-tipo="${tipo}"><div class="m-b">
    <div class="mseg" style="align-self:flex-start">${['cobranca','diversos'].map(t=>`<button type="button" class="${t===tipo?'active':''}" data-novotipo="${t}">${TIPO_NOME[t]}</button>`).join('')}</div>
    <div class="frm">${camposForm({},tipo)}<div class="fld full"><label for="p-and">Primeiro andamento (opcional)</label><textarea id="p-and" style="min-height:60px"></textarea></div></div></div>
    <div class="m-f"><button type="button" class="btn" data-close="1">Cancelar</button><button class="btn primary" type="submit">${icon('check')}Cadastrar</button></div></form>`);
}

/* ---------- Detalhe do processo ---------- */
let ABERTO=null;
async function openProc(id){
  ABERTO=id;
  openLayer(`${mh('Carregando...')}<div class="m-b"><div class="loading" style="min-height:200px"><span class="spin"></span></div></div>`,true);
  try{const p=await api('/api/processos/'+id);if(ABERTO===id)renderProc(p)}catch(e){toast(e.message);closeLayer()}
}
function renderProc(p){
  const tipo=p.tipo,aRec=(Number(p.valor_acordo)||0)-(Number(p.valor_pago)||0);
  const custasH=p.custas.length?p.custas.map(c=>{
    const ax=p.anexos.filter(a=>a.custa_id===c.id);
    return `<div class="cbox"><div class="cbox-h"><b>Custa ${esc(c.tipo.toLowerCase())}</b>${cuPill(c)}<span class="v num">${c.valor?fmt(c.valor):'<span class="muted">sem valor</span>'}</span></div>
    <small class="muted">${c.vencimento?'Vence '+brDate(c.vencimento):'Sem vencimento'}${c.descricao?' · '+esc(c.descricao):''}${c.pago?` · paga por ${esc(c.pago_por)} em ${brDT(c.pago_em)}`:''} · lançada por ${esc(c.criado_por)}</small>
    <div class="cbox-a">${c.link&&!isLeitura?`<a href="${esc(c.link)}" target="_blank" rel="noopener">${icon('external-link')}Boleto (link)</a>`:''}${ax.map(a=>`<a href="${esc(a.url)}" target="_blank" rel="noopener">${icon(a.categoria==='Comprovante'?'badge-check':'file-text')}${esc(a.categoria)}: ${esc(a.nome)}</a>`).join('')}<span class="sp"></span>
      ${isLeitura?'':`<button class="btn sm" data-anexar-custa="${c.id}" data-cat="${c.pago?'Comprovante':'Boleto'}">${icon('paperclip')}${c.pago?'Comprovante':'Boleto'}</button>`}
      ${canJ&&!c.pago?`<button class="btn sm" data-edit-custa="${c.id}">${icon('pencil')}</button>`:''}
      ${canF?(c.pago?`<button class="btn sm" data-despagar="${c.id}">Desfazer pagamento</button>`:`<button class="btn sm primary" data-pagar="${c.id}">${icon('check')}Marcar paga</button>`):''}</div></div>`}).join(''):'<p class="empty">Nenhuma custa lançada.</p>';
  const audH=p.audiencias.length?p.audiencias.map(a=>`<div class="cbox"><div class="cbox-h"><b>Audiência de ${esc(a.tipo.toLowerCase())}</b><span class="cu ${a.data<HOJE?'semdata':a.data===HOJE?'hoje':a.data<=addDays(HOJE,3)?'proxima':'aud'}">${a.data<HOJE?'Realizada':quando(a.data)}</span><span class="v num">${brDate(a.data)}${audHora(a)}</span></div>
    ${a.local||a.obs?`<small class="muted">${a.local?esc(a.local):''}${a.local&&a.obs?' · ':''}${a.obs?esc(a.obs):''}</small>`:''}
    ${canJ?`<div class="cbox-a"><small class="muted">marcada por ${esc(a.criado_por)}</small><span class="sp"></span><button class="btn sm" data-edit-aud="${a.id}">${icon('pencil')}Editar</button></div>`:''}</div>`).join(''):'<p class="empty">Nenhuma audiência marcada.</p>';
  const autH=p.autorizacao==='pendente'?`<div class="box miss aut-box">${icon('shield-alert')}<span><b>Aguardando autorização.</b> Esta cobrança ainda não entra nos totais.</span>${canAutorizar?`<span class="aut-acts"><button class="btn sm" data-recusar="${p.id}">${icon('x')}Recusar</button><button class="btn sm primary" data-autorizar="${p.id}">${icon('check')}Autorizar</button></span>`:''}</div><div id="rec-form"></div>`
    :p.autorizacao==='recusada'?`<div class="box aut-box rec">${icon('ban')}<span><b>Recusada por ${esc(p.autorizado_por)}</b> em ${brDT(p.autorizado_em)}${p.motivo_recusa?`: ${esc(p.motivo_recusa)}`:''}</span>${canJ?`<span class="aut-acts"><button class="btn sm" data-reenviar="${p.id}">${icon('send')}Reenviar para autorização</button></span>`:''}</div>`
    :p.autorizado_por&&p.tipo==='cobranca'?`<p class="hint aut-ok">${icon('shield-check')}Autorizada por ${esc(p.autorizado_por)} em ${brDT(p.autorizado_em)}</p>`:'';
  const anxs=p.anexos.filter(a=>!a.custa_id);
  const anexH=anxs.length?`<ul class="anx-list">${anxs.map(a=>`<li><a href="${esc(a.url)}" target="_blank" rel="noopener">${icon(a.link?'external-link':'file')}<span>${esc(a.categoria)}: ${esc(a.nome)}</span><small class="muted">${esc(a.por)} · ${brDate(a.em)}</small></a>${a.por===ME.nome||isAdmin?`<button class="anx-del" data-del-anexo="${a.id}" title="Remover">${icon('trash-2')}</button>`:''}</li>`).join('')}</ul>`:'<p class="empty">Nenhum anexo.</p>';
  const hist=p.historico.map(h=>{const det=h.detalhes?fmtDet(h.detalhes):'';return `<div><b>${esc(h.acao)}</b> · ${esc(h.nome)} (${esc(h.usuario)}) · ${brDT(h.em)}${det?`<br><span style="white-space:pre-wrap">${esc(det)}</span>`:''}</div>`}).join('')||'Sem registros.';
  openLayer(`<div class="m-h"><div style="min-width:0"><h2 style="overflow:hidden;text-overflow:ellipsis">${esc(parteNome(p))}</h2><small class="muted">${TIPO_NOME[tipo]} · ${p.numero?esc(p.numero):'sem nº de processo'}</small></div><button class="x" data-close="1" aria-label="Fechar">${icon('x')}</button></div>
  <div class="m-b">
    ${autH}
    <div class="sec">
      <div class="fin">
        <div><small>${tipo==='cobranca'?'Dívida':'Condenação'}</small><b class="num">${fmt(p.valor)}</b></div>
        <div><small>Acordo</small><b class="num">${fmt(p.valor_acordo)}</b></div>
        <div><small>Pago</small><b class="num ${p.valor_pago?'pos':''}">${fmt(p.valor_pago)}</b>${p.valor_acordo?`<small>${aRec>0?'falta '+fmt(aRec):'quitado'}</small>`:''}</div>
      </div>
    </div>
    <form class="sec" id="f-proc" data-id="${p.id}" data-tipo="${tipo}">
      <div class="sec-h"><h3>${icon('file-text')}Dados do processo</h3>${canJ?'':`<span class="lock" style="margin-left:auto">${icon(isLeitura?'eye':'lock')}${isLeitura?'Só visualização':'Só o jurídico edita'}</span>`}</div>
      <div class="frm">${camposForm(p,tipo)}</div>
      <div class="sec-h" style="margin-top:6px"><h3>${icon('wallet')}Valores</h3></div>
      <div class="frm">
        <div class="fld"><label for="p-valor_acordo">Valor do acordo (R$)</label><input id="p-valor_acordo" inputmode="decimal" value="${numIn(p.valor_acordo)}" ${canJ?'':'disabled'}></div>
        <div class="fld"><label for="p-valor_pago">Valor pago (R$) ${canF||isLeitura?'':`<span class="lock">${icon('lock')}financeiro</span>`}</label><input id="p-valor_pago" inputmode="decimal" value="${numIn(p.valor_pago)}" ${canF?'':'disabled'}></div>
        <label class="check fld full"><input type="checkbox" id="p-conferido" ${p.conferido?'checked':''} ${canF?'':'disabled'}>Recebimento conferido pelo financeiro${p.conferido?` <span class="muted">(${esc(p.conferido_por)}, ${brDT(p.conferido_em)})</span>`:''}</label>
      </div>
      ${canJ||canF?`<div class="acts" style="display:flex;justify-content:flex-end;gap:8px">${canJ?`<button type="button" class="btn danger" data-excluir="${p.id}">${icon('trash-2')}Excluir</button>`:''}<button class="btn primary" type="submit">${icon('check')}Salvar alterações</button></div>`:''}
    </form>
    <div class="sec">
      <div class="sec-h"><h3>${icon('list')}Andamento</h3></div>
      ${canJ?`<form id="f-and" data-id="${p.id}" class="reply" style="border:0;padding:0"><textarea id="and-t" placeholder="O que aconteceu no processo?"></textarea><button class="btn primary" aria-label="Adicionar andamento">${icon('send')}</button></form>`:''}
      ${p.andamentos.length?`<ul class="tl">${p.andamentos.map(a=>`<li class="${norm(a.texto).startsWith('conferir')?'conferir':''}"><small>${brDT(a.em)} · ${esc(a.por)}</small>${esc(a.texto)}</li>`).join('')}</ul>`:'<p class="empty">Nenhum andamento.</p>'}
    </div>
    <div class="sec">
      <div class="sec-h"><h3>${icon('gavel')}Audiências</h3>${canJ?`<button class="btn sm" data-nova-aud="${p.id}">${icon('plus')}Nova audiência</button>`:''}</div>
      <div id="aud-form"></div>
      ${audH}
    </div>
    <div class="sec">
      <div class="sec-h"><h3>${icon('receipt')}Custas</h3>${canJ?`<button class="btn sm" data-nova-custa="${p.id}">${icon('plus')}Nova custa</button>`:''}</div>
      <div id="custa-form"></div>
      ${custasH}
    </div>
    ${isLeitura?'':`<div class="sec anexos">
      <div class="sec-h"><h3>${icon('paperclip')}Anexos</h3><button class="btn sm" data-anexar="${p.id}">${icon('upload')}Anexar</button></div>
      <div id="anx-form"></div>
      ${anexH}
    </div>
    <div class="sec"><details class="more-h"><summary>${icon('history')}Histórico de alterações (${p.historico.length})</summary><div class="hist" style="margin-top:10px">${hist}</div></details></div>`}
  </div>`,true);
  window._P=p;
}
function custaForm(pid,c){
  c=c||{};
  $('#custa-form').innerHTML=`<form class="inline-form" id="f-custa" data-pid="${pid}" data-cid="${c.id||''}"><div class="frm">
    <div class="fld"><label for="c-tipo">Tipo</label><select id="c-tipo">${opts(LISTAS.tipos_custa,c.tipo||'Inicial')}</select></div>
    <div class="fld"><label for="c-venc">Vencimento</label><input id="c-venc" type="date" value="${c.vencimento||''}" required></div>
    <div class="fld"><label for="c-valor">Valor (R$)</label><input id="c-valor" inputmode="decimal" value="${numIn(c.valor)}"></div>
    <div class="fld"><label for="c-desc">Descrição</label><input id="c-desc" value="${esc(c.descricao||'')}" placeholder="Ex.: custas de cartório"></div>
    ${c.id?'':`<div class="fld full"><label for="c-arq">Boleto (opcional)</label><input id="c-arq" type="file" multiple accept=".pdf,image/*"></div>`}
  </div><div class="acts">${c.id&&canJ?`<button type="button" class="btn danger" data-del-custa="${c.id}">${icon('trash-2')}Excluir</button>`:''}<button type="button" class="btn" data-fechar-form="custa-form">Cancelar</button><button class="btn primary">${icon('check')}${c.id?'Salvar':'Lançar custa'}</button></div></form>`;
  drawIcons();$('#c-venc').focus();
}
function audForm(pid,a,pre){
  a=a||{};pre=pre||{};
  $('#aud-form').innerHTML=`<form class="inline-form" id="f-aud" data-pid="${pid}" data-aid="${a.id||''}" data-andamento="${pre.andamento_id||''}"><div class="frm">
    <div class="fld"><label for="au-data">Data</label><input id="au-data" type="date" value="${a.data||pre.data||''}" required></div>
    <div class="fld"><label for="au-hora">Hora</label><input id="au-hora" type="time" value="${a.hora||pre.hora||''}"></div>
    <div class="fld"><label for="au-tipo">Tipo</label><select id="au-tipo">${opts(LISTAS.tipos_audiencia||[],a.tipo||pre.tipo||'Conciliação')}</select></div>
    <div class="fld"><label for="au-local">Local ou link</label><input id="au-local" value="${esc(a.local||'')}" placeholder="Ex.: CEJUSC Brasília ou link da sala"></div>
    <div class="fld full"><label for="au-obs">Observação</label><input id="au-obs" value="${esc(a.obs||'')}"></div>
  </div><div class="acts">${a.id?`<button type="button" class="btn danger" data-del-aud="${a.id}">${icon('trash-2')}Excluir</button>`:''}<button type="button" class="btn" data-fechar-form="aud-form">Cancelar</button><button class="btn primary">${icon('check')}${a.id?'Salvar':'Marcar audiência'}</button></div></form>`;
  drawIcons();$('#au-data').focus();
}
function anexoForm(pid,cid,cat){
  const alvo=cid?'#custa-form':'#anx-form';
  $(alvo).innerHTML=`<form class="inline-form" id="f-anx" data-pid="${pid}" data-cid="${cid||''}"><div class="frm">
    <div class="fld"><label for="a-cat">Tipo</label><select id="a-cat">${opts(LISTAS.categorias,cat||'Documento')}</select></div>
    <div class="fld"><label for="a-arq">Arquivos</label><input id="a-arq" type="file" multiple></div>
    <div class="fld full"><label for="a-link">Ou cole um link (Drive, site do tribunal...)</label><input id="a-link" placeholder="https://"></div>
  </div><div class="acts"><button type="button" class="btn" data-fechar-form="${alvo.slice(1)}">Cancelar</button><button class="btn primary">${icon('upload')}Enviar</button></div></form>`;
  drawIcons();
}
async function enviarAnexo(pid,cid,cat,files,link){
  const fd=new FormData();[...(files||[])].forEach(f=>fd.append('arquivo',f));if(link)fd.append('link',link);fd.append('categoria',cat);if(cid)fd.append('custa_id',cid);
  return api(`/api/processos/${pid}/anexos`,{method:'POST',body:fd});
}

/* ================= Administração ================= */
let ADM={usuarios:null,historico:null,backups:null,espelho:null,apres:null};
function pgAdmin(){
  if(!isAdmin)return '<p class="empty">Sem acesso.</p>';
  const tabs=[['usuarios','Usuários','users'],['lojas','Lojas','store'],['historico','Histórico','history'],['backups','Backups','archive'],['espelho','Planilha espelho','sheet'],['importar','Importar planilha','file-up']];
  return `<div class="ph"><div><h1>Administração</h1></div></div><div>${mseg('adm',tabs)}</div><div id="adm">${admBody()}</div>`;
}
function admBody(){
  if(S.adm==='usuarios'){
    if(!ADM.usuarios)return '<div class="loading" style="min-height:160px"><span class="spin"></span></div>';
    return `${apresCard()}<section class="card"><div class="card-h"><h2>Usuários</h2><span class="sub">cada pessoa entra com o próprio usuário; no primeiro acesso usa a senha padrão e cria a sua</span><div class="tools"><button class="btn sm primary" data-novo-user="1">${icon('user-plus')}Novo usuário</button></div></div><div class="tbl-wrap" style="padding-top:12px"><table><thead><tr><th>Nome</th><th>Usuário</th><th>Perfil</th><th>Lojas</th><th>Autoriza cobranças</th><th>Situação</th><th></th></tr></thead><tbody>${ADM.usuarios.map(u=>`<tr data-edit-user="${u.id}"><td><b style="font-weight:500">${esc(u.nome)}</b></td><td class="num">${esc(u.usuario)}</td><td>${esc(LISTAS.perfis[u.perfil]||u.perfil)}</td><td style="white-space:normal">${u.lojas.length?esc(u.lojas.join(', ')):'<span class="muted">Todas</span>'}</td><td>${u.autoriza?'<span class="cu paga">Sim</span>':'<span class="muted">Não</span>'}</td><td>${!u.ativo?'<span class="cu vencida">Desativado</span>':u.pendente?'<span class="cu proxima">Aguardando 1º acesso</span>':'<span class="cu paga">Ativo</span>'}</td><td class="r">${icon('chevron-right')}</td></tr>`).join('')}</tbody></table></div></section>`;
  }
  if(S.adm==='lojas'){const regs=LISTAS.regionais||[];const ro=r=>`<option value="">Sem regional</option>${regs.map(x=>`<option ${x===r?'selected':''}>${esc(x)}</option>`).join('')}`;
    return `<section class="card"><div class="card-h"><h2>Lojas</h2><span class="sub">${LOJAS.length} cadastradas · ${LOJAS.filter(l=>!l.regional).length} sem regional</span></div><div class="card-b"><form id="f-loja" class="filters" style="padding:0 0 14px"><div class="fld" style="flex:1;min-width:160px"><input id="lj-nome" placeholder="Nome da loja"></div><div class="fld" style="width:80px"><input id="lj-uf" placeholder="UF" maxlength="2"></div><div class="fld" style="width:170px"><select id="lj-reg">${ro('')}</select></div><button class="btn primary">${icon('plus')}Adicionar</button></form>
    <div class="tbl-wrap" style="padding:0"><table><thead><tr><th>Loja</th><th>UF</th><th>Regional</th><th class="r">Processos</th></tr></thead><tbody>${LOJAS.map(l=>`<tr style="cursor:default"><td><b style="font-weight:500">${esc(l.nome)}</b></td><td>${esc(l.uf||'–')}</td><td><select class="reg-sel ${l.regional?'':'falta'}" data-loja-reg="${l.id}" aria-label="Regional de ${esc(l.nome)}">${ro(l.regional)}</select></td><td class="r num">${P.filter(p=>p.loja===l.nome).length}</td></tr>`).join('')}</tbody></table></div></div></section>`}
  if(S.adm==='historico'){
    if(!ADM.historico)return '<div class="loading" style="min-height:160px"><span class="spin"></span></div>';
    const H=ADM.historico,F=ADM.hf||{usuario:'',q:''};
    return `<section class="card"><div class="card-h"><h2>Histórico</h2><span class="sub">quem fez o quê, do mais recente para o mais antigo</span></div>
    <form id="f-hist" class="filters"><select id="h-quem" class="mseg" style="border:0;padding:8px 10px;font-size:13px" aria-label="Pessoa"><option value="">Todas as pessoas</option>${(ADM.pessoas||[]).map(p=>`<option value="${esc(p.usuario)}" ${F.usuario===p.usuario?'selected':''}>${esc(p.nome)} (${esc(p.usuario)})</option>`).join('')}</select><label class="search">${icon('search')}<input id="h-q" placeholder="Buscar ação, cliente, nº do processo..." value="${esc(F.q)}"></label><button class="btn sm primary">Filtrar</button></form>
    <div class="log">${H.length?H.map(h=>`<div class="log-row"><time>${brDT(h.em)}</time><span class="av eq">${esc((h.nome||'?')[0])}</span><div class="lg-d"><b>${esc(h.nome)}</b> <span class="muted">(${esc(h.usuario)})</span> · ${esc(h.acao)}${h.parte?` · <a href="#" data-open="${h.processo_id}">${esc(h.parte)}</a>`:''}${h.detalhes?`<small>${esc(fmtDet(h.detalhes))}</small>`:''}${h.ip?`<small>IP ${esc(h.ip)}</small>`:''}</div></div>`).join(''):'<p class="empty" style="padding:16px 20px">Nada encontrado.</p>'}</div>${H.length&&H.length%100===0?`<div class="card-b"><button class="btn" data-hist-mais="1">Carregar mais</button></div>`:''}</section>`;
  }
  if(S.adm==='backups'){
    if(!ADM.backups)return '<div class="loading" style="min-height:160px"><span class="spin"></span></div>';
    return `<section class="card"><div class="card-h"><h2>Backups</h2><span class="sub">um por dia (60 dias), um antes de cada atualização do sistema e antes de importar</span><div class="tools"><button class="btn sm primary" data-backup-agora="1">${icon('archive')}Fazer backup agora</button></div></div><div class="card-b"><div class="bk-list">${ADM.backups.length?ADM.backups.map(b=>`<a class="bk-item" href="/backups/${encodeURIComponent(b.nome)}">${icon('file-archive')}<span>${esc(b.nome.replace('bi-juridico-','').replace('.zip',''))}</span><small>${(b.tamanho/1024).toFixed(0)} KB</small>${icon('download')}</a>`).join(''):'<p class="empty">Nenhum backup ainda. O primeiro sai em até 1 hora.</p>'}</div><p class="hint" style="margin-top:12px">Cada arquivo tem os dados completos (dados.json) e uma planilha para abrir no Excel (planilha.xlsx).</p></div></section>`;
  }
  if(S.adm==='espelho'){
    const e=ADM.espelho;if(!e)return '<div class="loading" style="min-height:160px"><span class="spin"></span></div>';
    return `<section class="card"><div class="card-h"><h2>Planilha espelho</h2><span class="sub">cópia da planilha Jurídico, atualizada pelo sistema</span><div class="tools">${e.configurado?`<button class="btn sm primary" data-espelho-agora="1">${icon('refresh-cw')}Atualizar agora</button>`:''}</div></div><div class="card-b" style="display:flex;flex-direction:column;gap:12px">
      ${e.url?`<a class="bk-item" href="${esc(e.url)}" target="_blank" rel="noopener">${icon('sheet')}<span>Abrir a planilha espelho</span>${icon('external-link')}</a>`:''}
      ${!e.configurado?`<div class="box miss">${icon('alert-triangle')}Falta configurar no Railway: ESPELHO_PLANILHA_ID e GOOGLE_CREDENTIALS_JSON.</div>`:e.erro?`<div class="box miss">${icon('alert-triangle')}${esc(e.erro)}</div>`:e.ultima?`<div class="box ok">${icon('check')}Atualizada em ${brDT(e.ultima)} com ${e.linhas} processos.</div>`:`<div class="box">${icon('loader')}Aguardando a primeira atualização (até 1 minuto).</div>`}
      <p class="hint">O sistema reescreve as abas Cobrança e Processos Diversos cerca de 1 minuto depois de qualquer alteração. Cabeçalho, totais e as outras abas ficam como estão. O que for digitado na planilha não volta para o sistema e é apagado na próxima atualização.</p></div></section>`;
  }
  if(S.adm==='importar')return `<section class="card"><div class="card-h"><h2>Importar planilha</h2></div><div class="card-b"><p class="hint">Envie a planilha Jurídico em .xlsx (no Google Sheets: Arquivo › Fazer download › Microsoft Excel). Entram as abas Cobrança e Processos Diversos, com notas, custas e links do Drive. Um backup é feito antes.</p><form id="f-imp" class="filters" style="padding:14px 0 0"><input type="file" id="imp-arq" accept=".xlsx" required><button class="btn primary">${icon('file-up')}Importar</button></form><div id="imp-res"></div></div></section>`;
  return '';
}
function histQS(extra){const F=ADM.hf||{};const q=new URLSearchParams();if(F.usuario)q.set('usuario',F.usuario);if(F.q)q.set('q',F.q);if(extra)Object.entries(extra).forEach(([k,v])=>q.set(k,v));const t=q.toString();return t?'?'+t:''}
const legivel=v=>v===true||v==='true'?'sim':v===false||v==='false'?'não':v==null||v===''?'vazio':(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}/.test(v))?brDT(v.replace('T',' ').slice(0,16)):typeof v==='number'?v.toLocaleString('pt-BR'):v;
function apresCard(){
  const a=ADM.apres;if(!a)return '';
  return `<section class="card" style="margin-bottom:16px"><div class="card-h"><h2>${icon('presentation')} Link de apresentação</h2><span class="sub">para quem só vai ver o BI, sem usuário e senha</span></div><div class="card-b" style="display:flex;flex-direction:column;gap:12px">
    ${a.ativo?`<div class="link-box"><input id="apres-url" readonly value="${esc(a.url)}"><button class="btn sm" data-copiar="1">${icon('copy')}Copiar</button></div>`:'<div class="box">'+icon('link-2-off')+'Nenhum link ativo. Gere um para compartilhar.</div>'}
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm ${a.ativo?'':'primary'}" data-apres="gerar">${icon('refresh-cw')}${a.ativo?'Gerar link novo (o atual para de funcionar)':'Gerar link'}</button>${a.ativo?`<button class="btn sm danger" data-apres="desativar">${icon('link-2-off')}Desativar link</button>`:''}</div>
    <p class="hint">Quem abre o link vê o Início, as listas e a agenda, mas não edita nada, não vê CPF/CNPJ nem anexos, e cobranças aguardando autorização não aparecem. Cada abertura fica no histórico.</p></div></section>`;
}
function fmtDet(s){try{const d=JSON.parse(s);if(Array.isArray(d))return d.map(x=>x.campo?`${x.campo}: ${legivel(x.de)} → ${legivel(x.para)}`:JSON.stringify(x)).join('\n');if(d&&typeof d==='object')return Object.entries(d).filter(([,v])=>v!=null&&v!=='').map(([k,v])=>`${k}: ${Array.isArray(v)?v.join(', '):legivel(v)}`).join(' · ');return String(d)}catch(e){return s}}
async function carregaAdmin(){
  try{
    if(S.adm==='usuarios'&&!ADM.usuarios){ADM.usuarios=(await api('/api/usuarios')).usuarios;ADM.apres=await api('/api/apresentacao')}
    else if(S.adm==='historico'&&!ADM.historico){const r=await api('/api/historico'+histQS());ADM.historico=r.itens;ADM.pessoas=r.pessoas}
    else if(S.adm==='backups'&&!ADM.backups){ADM.backups=(await api('/api/backups')).backups}
    else if(S.adm==='espelho'&&!ADM.espelho){ADM.espelho=await api('/api/espelho')}
    else return;
    if(S.page==='admin'){$('#adm').innerHTML=admBody();drawIcons()}
  }catch(e){toast(e.message)}
}
function openUser(u){
  u=u||{perfil:'juridico',lojas:[],ativo:true};
  openLayer(`${mh(u.id?'Editar usuário':'Novo usuário')}<form id="f-user" data-id="${u.id||''}"><div class="m-b"><div class="frm">
    <div class="fld"><label for="u-nome">Nome</label><input id="u-nome" value="${esc(u.nome||'')}" required></div>
    <div class="fld"><label for="u-usuario">Usuário de acesso</label><input id="u-usuario" value="${esc(u.usuario||'')}" ${u.id?'disabled':''} placeholder="ex.: maria.silva" autocapitalize="none"></div>
    ${u.id?'':`<div class="fld full"><label for="u-senha">Senha do primeiro acesso <span class="muted">(opcional; vazio = senha padrão)</span></label><input id="u-senha" type="text" autocomplete="off" placeholder="mínimo 6 caracteres"><small class="muted">No primeiro acesso o sistema obriga a pessoa a criar a própria senha.</small></div>`}
    <div class="fld full"><label for="u-perfil">Perfil</label><select id="u-perfil">${Object.entries(LISTAS.perfis).map(([k,v])=>`<option value="${k}" ${u.perfil===k?'selected':''}>${v}</option>`).join('')}</select></div>
    <div class="fld full"><label>Lojas que enxerga <span class="muted">(nenhuma marcada = todas)</span></label><div class="lojas-chk">${LOJAS.map(l=>`<label><input type="checkbox" name="u-loja" value="${esc(l.nome)}" ${u.lojas.includes(l.nome)?'checked':''}>${esc(l.nome)}</label>`).join('')}</div></div>
    <label class="check fld full"><input type="checkbox" id="u-autoriza" ${u.autoriza?'checked':''}>Autoriza cobranças novas lançadas pelo jurídico</label>
    ${u.id?`<label class="check fld full"><input type="checkbox" id="u-ativo" ${u.ativo?'checked':''}>Acesso ativo</label>`:''}
  </div><p class="hint">Jurídico: cadastra e edita processos, andamentos e custas. Financeiro: marca custas pagas, valor pago e conferência. Administrador: tudo, mais usuários e backups.</p></div>
  <div class="m-f">${u.id?`<button type="button" class="btn" data-reset="${u.id}" style="margin-right:auto">${icon('key-round')}Voltar senha para a padrão</button>`:''}<button type="button" class="btn" data-close="1">Cancelar</button><button class="btn primary">${icon('check')}Salvar</button></div></form>`);
}

/* ================= Eventos ================= */
let armado=null;
function confirma(el,txt){if(armado===el){armado=null;return true}if(armado){armado.classList.remove('confirm');armado.innerHTML=armado._h}armado=el;el._h=el.innerHTML;el.classList.add('confirm');el.innerHTML=txt;setTimeout(()=>{if(armado===el){el.classList.remove('confirm');el.innerHTML=el._h;armado=null;drawIcons()}},3500);return false}

document.addEventListener('click',async e=>{
  const t=e.target.closest('button,a,tr,.t,.day,[data-open]');
  if(S.bell&&!e.target.closest('#bell')){S.bell=false;renderBell();drawIcons()}
  if(S.flOpen&&!e.target.closest('#lojaSel')){S.flOpen=false;renderShell();drawIcons()}
  {const f=e.target.closest('[data-flbtn],[data-flok],[data-flclear]');if(f){const d=f.dataset;
    if(d.flbtn){S.flOpen=!S.flOpen;renderShell();drawIcons();return}
    if(d.flok){S.flOpen=false;renderShell();drawIcons();return}
    if(d.flclear){S.fl={lojas:[],regs:[]};salvaEstado();render();return}}}
  if(e.target.matches('.overlay')){closeLayer();return}
  if(!t)return;const d=t.dataset;
  if(d.close){closeLayer();return}
  if(d.page){e.preventDefault();if(d.cfgo){S.cf=d.cfgo;S.cv='lista'}S.page=d.page;S.st='todos';S.q='';closeLayer();render();window.scrollTo(0,0);return}
  if(d.refresh){refresh();return}
  if(d.bell){S.bell=!S.bell;renderBell();drawIcons();return}
  if(d.readall){avisos().forEach(n=>READ.add(n.k));saveRead();renderBell();drawIcons();return}
  if(d.notif){READ.add(d.notif);saveRead();S.bell=false;renderBell();openProc(+d.pid);return}
  if(d.goaut){S.page='cobranca';S.st='autorizacao';S.q='';render();window.scrollTo(0,0);return}
  if(d.autorizar){if(!confirma(t,'Confirmar autorização?'))return;await salvar(()=>api(`/api/processos/${d.autorizar}/autorizacao`,{method:'POST',body:{decisao:'autorizar'}}),'Cobrança autorizada.');openProc(ABERTO);return}
  if(d.recusar){$('#rec-form').innerHTML=`<form class="inline-form" id="f-rec" data-id="${d.recusar}"><div class="fld"><label for="rec-motivo">Motivo da recusa</label><textarea id="rec-motivo" style="min-height:60px" required></textarea></div><div class="acts"><button type="button" class="btn" data-fechar-form="rec-form">Cancelar</button><button class="btn primary">Recusar</button></div></form>`;$('#rec-motivo').focus();return}
  if(d.reenviar){await salvar(()=>api(`/api/processos/${d.reenviar}/autorizacao`,{method:'POST',body:{decisao:'reenviar'}}),'Reenviado para autorização.');openProc(ABERTO);return}
  if(d.novaAud){audForm(+d.novaAud);return}
  if(d.editAud){const p=window._P;audForm(ABERTO,p.audiencias.find(x=>x.id===+d.editAud));return}
  if(d.delAud){if(!confirma(t,'Excluir mesmo?'))return;await salvar(()=>api('/api/audiencias/'+d.delAud,{method:'DELETE'}),'Audiência excluída.');openProc(ABERTO);return}
  if(d.sugAdd){const x=SUG.find(z=>z.andamento_id===+d.sugAdd);t.disabled=true;await salvar(()=>api(`/api/processos/${x.processo_id}/audiencias`,{method:'POST',body:{data:x.data,hora:x.hora,tipo:x.tipo,andamento_id:x.andamento_id}}),'Audiência adicionada na agenda.');return}
  if(d.sugIgn){await salvar(()=>api(`/api/sugestoes/${d.sugIgn}/ignorar`,{method:'POST'}),'Sugestão ignorada.');return}
  if(d.apres){if(!confirma(t,d.apres==='gerar'&&ADM.apres&&ADM.apres.ativo?'Confirmar: o link atual para de funcionar':'Confirmar?'))return;try{ADM.apres=await api('/api/apresentacao',{method:'POST',body:{acao:d.apres}});toast(d.apres==='gerar'?'Link gerado.':'Link desativado.');$('#adm').innerHTML=admBody();drawIcons()}catch(er){toast(er.message)}return}
  if(d.copiar){const el=$('#apres-url');try{await navigator.clipboard.writeText(el.value);toast('Link copiado.')}catch(er){el.select();toast('Selecionei o link: use Ctrl+C.')}return}
  if(d.set){const [k,v]=d.set.split(':');S[k]=v;salvaEstado();if(k==='adm'){$('#adm').innerHTML=admBody();document.querySelectorAll('[data-set^="adm:"]').forEach(b=>b.classList.toggle('active',b.dataset.set===d.set));drawIcons();carregaAdmin()}else render();return}
  if(d.st!==undefined&&t.classList.contains('chip')){S.st=d.st;render();return}
  if(d.cf){S.cf=d.cf;render();return}
  if(d.mnav){S.cm+=+d.mnav;if(S.cm<0){S.cm=11;S.cy--}if(S.cm>11){S.cm=0;S.cy++}render();return}
  if(d.today){S.cy=_t.getFullYear();S.cm=_t.getMonth();S.sel=HOJE;render();return}
  if(d.day){S.sel=d.day;render();return}
  if(d.gost!==undefined){S.page='cobranca';S.st=d.gost;S.q='';render();window.scrollTo(0,0);return}
  if(d.golj!==undefined){S.page='cobranca';S.st='todos';S.fl=d.golj==='Sem loja'?{lojas:[],regs:[]}:{lojas:[d.golj],regs:[]};S.q='';salvaEstado();render();window.scrollTo(0,0);return}
  if(d.godiv!==undefined){S.page='diversos';S.st='todos';S.q=d.godiv==='Sem tipo'?'':d.godiv;render();window.scrollTo(0,0);return}
  if(d.graf){const [k,v]=d.graf.split(':');S.g[k]=v;salvaEstado();render();return}
  if(d.csv){exportarCSV(d.csv);return}
  if(d.act==='novo'){openNovo(d.tipo);return}
  if(d.novotipo){openNovo(d.novotipo);return}
  if(d.open){e.preventDefault();openProc(+d.open);return}
  if(d.pagar){const c=C.find(x=>x.id===+d.pagar)||(window._P&&window._P.custas.find(x=>x.id===+d.pagar));if(!confirma(t,'Confirmar pagamento?'))return;
    await salvar(()=>api(`/api/custas/${d.pagar}/pago`,{method:'POST',body:{pago:true}}),'Custa marcada como paga. Anexe o comprovante.');if(ABERTO)openProc(ABERTO);return}
  if(d.despagar){if(!confirma(t,'Desfazer?'))return;await salvar(()=>api(`/api/custas/${d.despagar}/pago`,{method:'POST',body:{pago:false}}),'Pagamento desfeito.');openProc(ABERTO);return}
  if(d.novaCusta){custaForm(+d.novaCusta);return}
  if(d.editCusta){custaForm(ABERTO,window._P.custas.find(x=>x.id===+d.editCusta));return}
  if(d.delCusta){if(!confirma(t,'Excluir mesmo?'))return;await salvar(()=>api('/api/custas/'+d.delCusta,{method:'DELETE'}),'Custa excluída.');openProc(ABERTO);return}
  if(d.anexar){anexoForm(+d.anexar);return}
  if(d.anexarCusta){anexoForm(ABERTO,+d.anexarCusta,d.cat);return}
  if(d.fecharForm){$('#'+d.fecharForm).innerHTML='';return}
  if(d.delAnexo){if(!confirma(t,icon('check')))return;await salvar(()=>api('/api/anexos/'+d.delAnexo,{method:'DELETE'}),'Anexo removido.');openProc(ABERTO);return}
  if(d.excluir){if(!confirma(t,'Excluir o processo?'))return;await salvar(()=>api('/api/processos/'+d.excluir,{method:'DELETE'}),'Processo excluído.');closeLayer();return}
  if(d.novoUser){openUser();return}
  if(d.editUser){openUser(ADM.usuarios.find(u=>u.id===+d.editUser));return}
  if(d.reset){if(!confirma(t,'Confirmar: voltar para a padrão?'))return;try{await api(`/api/usuarios/${d.reset}/redefinir`,{method:'POST'});toast('Pronto. No próximo acesso a pessoa entra com a senha padrão e cria outra.');ADM.usuarios=null;closeLayer();carregaAdmin()}catch(er){toast(er.message)}return}
  if(d.espelhoAgora){t.disabled=true;try{const r=await api('/api/espelho',{method:'POST'});toast(`Planilha atualizada com ${r.linhas} processos.`)}catch(er){toast(er.message)}ADM.espelho=null;carregaAdmin();return}
  if(d.backupAgora){t.disabled=true;try{await api('/api/backups',{method:'POST'});toast('Backup feito.');ADM.backups=null;carregaAdmin()}catch(er){toast(er.message)}t.disabled=false;return}
  if(d.histMais){const mais=(await api('/api/historico'+histQS({antes:ADM.historico[ADM.historico.length-1].id}))).itens;ADM.historico=ADM.historico.concat(mais);$('#adm').innerHTML=admBody();drawIcons();return}
  if(t.id==='themeBtn'){const n=isDark()?'light':'dark';document.documentElement.dataset.theme=n;try{localStorage.setItem('bj-theme',n)}catch(er){}render();return}
});
document.addEventListener('change',e=>{
  if(e.target.dataset.flreg!==undefined){const r=e.target.dataset.flreg;S.fl.regs=e.target.checked?[...S.fl.regs,r]:S.fl.regs.filter(x=>x!==r);
    if(e.target.checked)S.fl.lojas=S.fl.lojas.filter(n=>lojaReg(n)!==r);salvaEstado();render();return}
  if(e.target.dataset.flloja!==undefined){const n=e.target.dataset.flloja;S.fl.lojas=e.target.checked?[...S.fl.lojas,n]:S.fl.lojas.filter(x=>x!==n);salvaEstado();render();return}
  if(e.target.dataset.lojaReg){api('/api/lojas/'+e.target.dataset.lojaReg,{method:'POST',body:{regional:e.target.value}}).then(()=>refresh(true)).then(()=>toast('Regional salva.')).catch(er=>toast(er.message));return}
  if(e.target.dataset.ord){S.ord=e.target.value;render();return}
});
let qT;
document.addEventListener('input',e=>{if(e.target.id==='q'){S.q=e.target.value;clearTimeout(qT);qT=setTimeout(()=>{const pos=e.target.selectionStart;render();const q=$('#q');if(q){q.focus();q.setSelectionRange(pos,pos)}},180)}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('#layer').innerHTML)closeLayer()});

const num=v=>{v=String(v||'').trim();if(!v)return '';if(/,/.test(v))v=v.replace(/\./g,'').replace(',','.');return v};
document.addEventListener('submit',async e=>{
  e.preventDefault();const f=e.target,btn=f.querySelector('button.primary');if(btn)btn.disabled=true;
  try{
    if(f.id==='f-novo'){const d=lerForm();d.valor=num($('#p-valor').value);d.tipo=f.dataset.tipo;d.andamento=$('#p-and').value;const r=await salvar(()=>api('/api/processos',{method:'POST',body:d}));toast(r.pendente?'Cobrança cadastrada. Aguardando autorização.':'Processo cadastrado.');openProc(r.id)}
    if(f.id==='f-proc'){const p=window._P,d={};
      if(canJ){Object.assign(d,lerForm());d.valor=num($('#p-valor').value);d.valor_acordo=num($('#p-valor_acordo').value)}
      if(canF){d.valor_pago=num($('#p-valor_pago').value);d.conferido=$('#p-conferido').checked}
      const r=await salvar(()=>api('/api/processos/'+p.id,{method:'POST',body:d}));toast(r.mudancas?'Alterações salvas.':'Nada mudou.');openProc(p.id)}
    if(f.id==='f-and'){const tx=$('#and-t').value.trim();if(!tx){toast('Escreva o andamento.');return}await salvar(()=>api(`/api/processos/${f.dataset.id}/andamentos`,{method:'POST',body:{texto:tx}}),'Andamento adicionado.');openProc(+f.dataset.id)}
    if(f.id==='f-custa'){const body={tipo:$('#c-tipo').value,vencimento:$('#c-venc').value,valor:num($('#c-valor').value),descricao:$('#c-desc').value};
      if(f.dataset.cid){await salvar(()=>api('/api/custas/'+f.dataset.cid,{method:'POST',body}),'Custa alterada.')}
      else{const r=await api(`/api/processos/${f.dataset.pid}/custas`,{method:'POST',body});const arq=$('#c-arq');if(arq&&arq.files.length)await enviarAnexo(f.dataset.pid,r.id,'Boleto',arq.files);await refresh(true);toast('Custa lançada.')}
      openProc(+f.dataset.pid)}
    if(f.id==='f-anx'){const files=$('#a-arq').files,link=$('#a-link').value.trim();if(!files.length&&!link){toast('Escolha um arquivo ou cole um link.');return}
      await salvar(()=>enviarAnexo(f.dataset.pid,f.dataset.cid,$('#a-cat').value,files,link),'Anexo enviado.');openProc(+f.dataset.pid)}
    if(f.id==='f-user'){const body={id:f.dataset.id||null,nome:$('#u-nome').value,usuario:$('#u-usuario').value,perfil:$('#u-perfil').value,lojas:[...document.querySelectorAll('input[name=u-loja]:checked')].map(x=>x.value),autoriza:$('#u-autoriza').checked,senha_inicial:$('#u-senha')?$('#u-senha').value:'',ativo:$('#u-ativo')?$('#u-ativo').checked:true};
      await api('/api/usuarios',{method:'POST',body});toast(body.id?'Usuário salvo.':'Usuário criado. No primeiro acesso ele usa a senha padrão.');ADM.usuarios=null;closeLayer();carregaAdmin()}
    if(f.id==='f-hist'){ADM.hf={usuario:$('#h-quem').value,q:$('#h-q').value.trim()};ADM.historico=null;$('#adm').innerHTML=admBody();drawIcons();await carregaAdmin()}
    if(f.id==='f-rec'){const m=$('#rec-motivo').value.trim();if(!m){toast('Escreva o motivo.');return}await salvar(()=>api(`/api/processos/${f.dataset.id}/autorizacao`,{method:'POST',body:{decisao:'recusar',motivo:m}}),'Cobrança recusada.');openProc(+f.dataset.id)}
    if(f.id==='f-aud'){const body={data:$('#au-data').value,hora:$('#au-hora').value,tipo:$('#au-tipo').value,local:$('#au-local').value,obs:$('#au-obs').value,andamento_id:+f.dataset.andamento||null};
      if(f.dataset.aid)await salvar(()=>api('/api/audiencias/'+f.dataset.aid,{method:'POST',body}),'Audiência alterada.');
      else await salvar(()=>api(`/api/processos/${f.dataset.pid}/audiencias`,{method:'POST',body}),'Audiência marcada.');
      openProc(+f.dataset.pid)}
    if(f.id==='f-loja'){await salvar(()=>api('/api/lojas',{method:'POST',body:{nome:$('#lj-nome').value,uf:$('#lj-uf').value,regional:$('#lj-reg').value}}),'Loja adicionada.')}
    if(f.id==='f-imp'){const fd=new FormData();fd.append('arquivo',$('#imp-arq').files[0]);
      let r;try{r=await api('/api/importar',{method:'POST',body:fd})}catch(er){if(er.dados&&er.dados.confirmar&&confirm(er.message+' Continuar mesmo assim?')){fd.append('confirmar','sim');r=await api('/api/importar',{method:'POST',body:fd})}else throw er}
      $('#imp-res').innerHTML=`<div class="box ok" style="margin-top:14px">${icon('check')}${r.processos} processos, ${r.custas} custas e ${r.anexos} anexos importados.</div>${r.avisos.length?`<ul class="hint">${r.avisos.map(a=>`<li>${esc(a)}</li>`).join('')}</ul>`:''}`;drawIcons();await refresh(true)}
  }catch(er){if(!er.avisado)toast(er.message)}
  finally{if(btn)btn.disabled=false}
});

refresh();
setInterval(()=>{if(!document.hidden&&!$('#layer').innerHTML)refresh(true)},60000);
