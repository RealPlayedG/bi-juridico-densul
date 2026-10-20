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

/* ================= Dados ================= */
let P=[],C=[],LOJAS=[],LISTAS={status:{},tipos_custa:[],categorias:[],identificacoes:[],perfis:{}},HOJE='';
let LOADED=false,SYNC={at:null,err:null,busy:false};
const _t=new Date();
const S={page:'painel',loja:'',q:'',st:'todos',cv:'lista',cf:'atencao',cy:_t.getFullYear(),cm:_t.getMonth(),sel:'',bell:false,ord:'padrao',adm:'usuarios'};
try{const sv=JSON.parse(localStorage.getItem('bj-estado')||'{}');if(sv.loja!==undefined)S.loja=sv.loja;if(sv.cv)S.cv=sv.cv}catch(e){}
function salvaEstado(){try{localStorage.setItem('bj-estado',JSON.stringify({loja:S.loja,cv:S.cv}))}catch(e){}}

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
  try{const d=await api('/api/dados');P=d.processos;C=d.custas;LOJAS=d.lojas;LISTAS=d.listas;HOJE=d.hoje;if(!S.sel)S.sel=HOJE;LOADED=true;SYNC.at=new Date();SYNC.err=null}
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
const vis=p=>!S.loja||p.loja===S.loja;
const ativos=()=>P.filter(vis);
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
const PAGES=[['painel','layout-dashboard','Início'],['cobranca','hand-coins','Cobrança'],['diversos','scale','Diversos'],['custas','calendar-clock','Custas']];
const isDark=()=>{const t=document.documentElement.dataset.theme;return t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches};
const READ_KEY='bj-lidos-'+ME.id;let READ=new Set();
try{READ=new Set(JSON.parse(localStorage.getItem(READ_KEY)||'[]'))}catch(e){}
function saveRead(){try{localStorage.setItem(READ_KEY,JSON.stringify([...READ].slice(-400)))}catch(e){}}

function renderShell(){
  const at=LOADED?atencao().length:0;
  $('#nav').innerHTML=PAGES.map(([k,ic,t])=>`<button class="${S.page===k?'active':''}" data-page="${k}">${icon(ic)}${t}${k==='custas'&&at?`<span class="badge">${at}</span>`:''}</button>`).join('')
    +(isAdmin?`<button class="nav-extra ${S.page==='admin'?'active':''}" data-page="admin">${icon('shield')}Administração</button>`:'');
  const minhas=ME.lojas&&ME.lojas.length?LOJAS.filter(l=>ME.lojas.includes(l.nome)):LOJAS;
  $('#lojaSel').innerHTML=`${icon('store')}<select id="loja" aria-label="Loja"><option value="">${ME.lojas&&ME.lojas.length?'Minhas lojas':'Todas as lojas'}</option>${minhas.map(l=>`<option ${S.loja===l.nome?'selected':''}>${esc(l.nome)}</option>`).join('')}</select>`;
  $('#profile').innerHTML=`<span class="me"><span class="av ${ME.perfil==='financeiro'?'sec':ME.perfil==='admin'?'eq':'dono'}">${esc((ME.nome||'?')[0])}</span><span class="me-t"><b>${esc(ME.nome)}</b><small>${esc(ME.perfil_nome)}</small></span></span><a class="iconbtn sm" href="/senha" title="Trocar senha" aria-label="Trocar senha">${icon('key-round')}</a><a class="iconbtn sm" href="/sair" title="Sair" aria-label="Sair">${icon('log-out')}</a>`;
  $('#sync').innerHTML=SYNC.err?`<span class="sync err" title="${esc(SYNC.err)}">${icon('cloud-off')}<span>Sem conexão</span></span>`:`<button class="sync" data-refresh="1" title="Atualizar agora">${icon(SYNC.busy?'loader':'cloud')}<span>${SYNC.at?'Atualizado às '+pad(SYNC.at.getHours())+':'+pad(SYNC.at.getMinutes()):'Conectando'}</span></button>`;
  $('#themeBtn').innerHTML=icon(isDark()?'sun':'moon');
  renderBell();
}
function renderBell(){
  const list=LOADED?atencao():[];const unread=list.filter(c=>!READ.has(`c${c.id}-${c.vencimento}`)).length;
  $('#bell').innerHTML=`<button class="iconbtn" data-bell="1" aria-label="Avisos">${icon('bell')}</button>${unread?`<span class="cnt">${unread}</span>`:''}
  ${S.bell?`<div class="np" role="dialog" aria-label="Avisos"><div class="np-h"><b>Custas para pagar</b><span class="np-acts">${unread?'<button data-readall="1">Marcar como vistos</button>':''}</span></div>
  <div class="np-list">${list.length?list.map(c=>{const p=proc(c.processo_id),s=custaSt(c),k=`c${c.id}-${c.vencimento}`;return `<button class="np-item ${READ.has(k)?'':'unread'}" data-notif="${c.id}"><span class="np-ic ${s==='proxima'?'rem':'late'}">${icon(s==='proxima'?'calendar-clock':'alert-triangle')}</span><span style="flex:1;min-width:0"><span class="np-t">Custa ${esc(c.tipo.toLowerCase())} ${s==='vencida'?'vencida em '+brDate(c.vencimento):'vence '+quando(c.vencimento)}${c.valor?' · '+fmt(c.valor):''}</span><small>${esc(parteNome(p))} · ${esc(p.loja||'sem loja')}</small></span></button>`}).join(''):'<div class="np-empty">Nenhuma custa vencendo. Tudo em dia.</div>'}</div></div>`:''}`;
}
let CH=[];
function render(){
  renderShell();
  if(!LOADED){$('#page').innerHTML=SYNC.err?`<div class="loading aviso"><div>${icon('plug-zap')}<h2>Sem conexão</h2><p>${esc(SYNC.err)}</p><button class="btn" data-refresh="1">${icon('refresh-cw')}Tentar de novo</button></div></div>`:`<div class="loading"><span class="spin"></span>Carregando...</div>`;drawIcons();return}
  PMreset();
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
  const ps=ativos(),cob=ps.filter(p=>p.tipo==='cobranca'),div=ps.filter(p=>p.tipo==='diversos');
  const enc=s=>['Não entrar com ação','Finalizado'].includes(s);
  const cobAt=cob.filter(p=>!enc(p.status));
  const acordos=cob.filter(p=>p.valor_acordo);
  const tAc=soma(acordos,'valor_acordo'),tPago=soma(cob,'valor_pago');
  const cv=custasVis(),abertas=cv.filter(c=>!c.pago),venc=abertas.filter(c=>c.vencimento&&c.vencimento<HOJE);
  const at=atencao();
  let h=`<div class="ph"><div><h1>${S.loja?esc(S.loja):'Visão geral'}</h1><p>${cob.length} cobranças e ${div.length} processos diversos</p></div><div class="ph-actions">${canJ?`<button class="btn primary" data-act="novo">${icon('plus')}Novo processo</button>`:''}</div></div>`;
  if(at.length){const nv=at.filter(c=>['vencida','hoje'].includes(custaSt(c))).length,nl=at.length-nv;
    h+=`<button class="strip ${nv?'neg':'warn'}" data-page="custas" data-cfgo="atencao">${icon(nv?'alert-triangle':'calendar-clock')}<span><b>${nv?`${nv} ${nv===1?'custa vencida':'custas vencidas'}`:''}${nv&&nl?' e ':''}${nl?`${nl} vencendo nos próximos 3 dias`:''}</b><small>Mais antiga: ${esc(parteNome(proc(at[0].processo_id)))}, ${brDate(at[0].vencimento)}</small></span><em>Ver custas${icon('chevron-right')}</em></button>`}
  h+=`<div class="kpis kpis5">
    ${kpi('hand-coins','Em cobrança',fmt0(soma(cobAt,'valor')),`${cobAt.length} clientes no jurídico`,'',true)}
    ${kpi('gavel','Processo aberto',fmt0(soma(cob.filter(p=>p.status==='Processo Aberto'),'valor')),`${cob.filter(p=>p.status==='Processo Aberto').length} processos`)}
    ${kpi('handshake','Acordos',fmt0(tAc),(()=>{const f=cob.filter(p=>p.status==='Feito Acordo').length;return tAc?`${acordos.length} com valor lançado`:f?`${f} feitos, sem valor lançado`:'nenhum ainda'})(),'pos')}
    ${kpi('wallet','Recebido',fmt0(tPago),tAc>tPago?`falta receber ${fmt0(tAc-tPago)}`:'','pos')}
    ${kpi('receipt','Custas a pagar',String(abertas.length),venc.length?`${venc.length} vencida${venc.length>1?'s':''}`:`${fmt0(soma(abertas,'valor'))} lançado`,venc.length?'neg':'warn')}
  </div>`;
  const st=porStatus(),totSt=st.reduce((x,r)=>x+r[1],0)||1,maxSt=Math.max(...st.map(r=>r[1]),1);
  const nSt=k=>cob.filter(p=>(p.status||'Sem status')===k).length;
  const lj=porLoja(),top=lj.slice(0,8),resto=lj.slice(8),maxLj=Math.max(...top.map(r=>r[1]),1);
  const nLj=k=>cob.filter(p=>(p.loja||'Sem loja')===k).length;
  const barra=(rot,v,max,sub,attrs)=>`<button class="hb" ${attrs} title="${esc(rot)}: ${fmt(v)}${sub?' ('+sub+')':''}"><span class="hb-l">${esc(rot)}</span><span class="hb-t"><i style="width:${Math.max(v/max*100,v?1.5:0)}%"></i></span><span class="hb-v num">${fmt0(v)}<small>${sub}</small></span></button>`;
  h+=`<div class="g2 g2-eq">
    <section class="card"><div class="card-h"><h2>Cobrança por status</h2><span class="sub">valor da dívida</span></div><div class="card-b hb-list">${st.map(([k,v])=>barra(k,v,maxSt,`${nSt(k)} · ${Math.round(v/totSt*100)}%`,`data-gost="${esc(k)}"`)).join('')}</div></section>
    <section class="card"><div class="card-h"><h2>Cobrança por loja</h2><span class="sub">${lj.length} lojas, maiores valores</span></div><div class="card-b hb-list">${top.map(([k,v])=>barra(k,v,maxLj,`${nLj(k)} ${nLj(k)===1?'cliente':'clientes'}`,`data-golj="${esc(k)}"`)).join('')}${resto.length?`<p class="hint" style="margin:6px 0 0">Outras ${resto.length} lojas somam ${fmt0(resto.reduce((x,r)=>x+r[1],0))}.</p>`:''}</div></section>
  </div>
  <div class="g2 g2-eq">
    <section class="card"><div class="card-h"><h2>Próximas custas</h2><button class="link" data-page="custas">Calendário</button></div><div class="card-b">${proxCustas()}</div></section>
    <section class="card"><div class="card-h"><h2>Processos diversos</h2><button class="link" data-page="diversos">Ver todos</button></div><div class="card-b">${resumoDiv(div)}</div></section>
  </div>`;
  return h;
}
function porLoja(){const m={};ativos().filter(p=>p.tipo==='cobranca').forEach(p=>{const k=p.loja||'Sem loja';m[k]=(m[k]||0)+(Number(p.valor)||0)});return Object.entries(m).sort((a,b)=>b[1]-a[1])}
function porStatus(){const m={};ativos().filter(p=>p.tipo==='cobranca').forEach(p=>{const k=p.status||'Sem status';m[k]=(m[k]||0)+(Number(p.valor)||0)});const ord=[...(LISTAS.status.cobranca||[]),'Sem status'];return Object.entries(m).sort((a,b)=>ord.indexOf(a[0])-ord.indexOf(b[0]))}
function proxCustas(){
  const l=custasVis().filter(c=>!c.pago&&c.vencimento&&c.vencimento>=HOJE).slice(0,6);
  return l.length?`<div class="ulist">${l.map(c=>cRow(c,true)).join('')}</div>`:'<p class="empty">Nenhuma custa a vencer.</p>';
}
function resumoDiv(div){
  if(!div.length)return '<p class="empty">Nenhum processo diverso.</p>';
  const m={};div.forEach(p=>{const k=p.tipo_acao||'Sem tipo';m[k]=(m[k]||0)+1});
  const rows=Object.entries(m).sort((a,b)=>b[1]-a[1]),max=rows[0][1];
  const cond=soma(div,'valor');
  return `<p class="insight"><b>${div.length} processos</b>${cond?`<span>${fmt0(cond)} em condenações registradas</span>`:''}</p><div class="hb-list">${rows.slice(0,7).map(([k,v])=>`<button class="hb hb-n" data-godiv="${esc(k)}" title="${esc(k)}: ${v}"><span class="hb-l">${esc(k)}</span><span class="hb-t"><i style="width:${v/max*100}%"></i></span><span class="hb-v num">${v}</span></button>`).join('')}</div>`;
}
function cRow(c,compacto){
  const p=proc(c.processo_id),d=c.vencimento?dParts(c.vencimento):null;
  if(compacto)return `<div class="urow clickable" data-open="${p.id}"><div class="datebox">${d?`<b>${d.d}</b><small>${MES3[d.m]}</small>`:'<b>–</b>'}</div><div class="t"><b>${esc(parteNome(p))}</b><small>${esc(c.tipo)} · ${esc(p.loja||'sem loja')} ${cuPill(c)}</small></div><div class="v num">${c.valor?fmt(c.valor):''}</div></div>`;
  return `<div class="crow"><div class="datebox">${d?`<b>${d.d}</b><small>${MES3[d.m]}</small>`:'<b>–</b>'}</div><div class="t" data-open="${p.id}"><b>${esc(parteNome(p))}</b><small>Custa ${esc(c.tipo.toLowerCase())}${c.descricao?' · '+esc(c.descricao):''} · ${esc(p.loja||'sem loja')} ${cuPill(c)}</small></div><div class="v num">${c.valor?fmt(c.valor):'<span class="muted">sem valor</span>'}</div><div class="acts">${c.link?`<a class="btn sm" href="${esc(c.link)}" target="_blank" rel="noopener" title="Abrir boleto">${icon('file-text')}Boleto</a>`:''}${canF&&!c.pago?`<button class="btn sm primary" data-pagar="${c.id}">${icon('check')}Paga</button>`:''}</div></div>`;
}

/* ================= Gráficos ================= */
function baseOpts(){const ink=cssv('--ink'),surf=cssv('--surface'),line=cssv('--line');
  return {responsive:true,maintainAspectRatio:false,animation:matchMedia('(prefers-reduced-motion: reduce)').matches?false:{duration:500},indexAxis:'y',
    plugins:{legend:{display:false},tooltip:{backgroundColor:surf,titleColor:ink,bodyColor:ink,borderColor:line,borderWidth:1,padding:12,cornerRadius:12,callbacks:{label:c=>' '+fmt0(c.parsed.x)}}},
    scales:{x:{grid:{color:line},border:{display:false},ticks:{maxTicksLimit:5,callback:v=>v>=1000?(v/1000).toLocaleString('pt-BR')+' mil':v}},y:{grid:{display:false},border:{display:false},ticks:{color:ink}}}}}
function mountCharts(){
  CH.forEach(c=>c.destroy());CH=[];
  if(S.page!=='painel'||!window.Chart)return;
  Chart.defaults.font.family="'Poppins',system-ui,sans-serif";Chart.defaults.font.size=11.5;Chart.defaults.font.size=11.5;Chart.defaults.color=cssv('--muted');
  const corSt=s=>{const c=stCls(s);return cssv(c==='s-aberto'?'--accent':c==='s-peticao'?'--warn':c==='s-docs'?'--nt':c==='s-acordo'||c==='s-fim'?'--pos':c==='s-neg'?'--neg':'--c8')};
  const st=porStatus(),a=$('#cSt');
  if(a&&st.length)CH.push(new Chart(a,{type:'bar',data:{labels:st.map(x=>x[0]),datasets:[{data:st.map(x=>x[1]),backgroundColor:st.map(x=>corSt(x[0])),borderRadius:8,borderSkipped:false,maxBarThickness:26}]},options:baseOpts()}));
  const lj=porLoja().slice(0,14),b=$('#cLj');
  if(b&&lj.length)CH.push(new Chart(b,{type:'bar',data:{labels:lj.map(x=>x[0]),datasets:[{data:lj.map(x=>x[1]),backgroundColor:cssv('--c1'),borderRadius:6,borderSkipped:false,maxBarThickness:18}]},options:baseOpts()}));
}

/* ================= Listas (Cobrança e Diversos) ================= */
function filtrados(tipo){
  const q=norm(S.q.trim());
  let l=ativos().filter(p=>p.tipo===tipo);
  if(S.st==='conferir')l=l.filter(p=>norm(p.andamento).startsWith('conferir'));
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
  const chips=[['todos','Todos',todos.length],...sts.map(s=>[s,s,cont[s]]),...(nCus?[['custas','Com custa a pagar',nCus]]:[]),...(nConf?[['conferir','Para conferir',nConf]]:[])];
  const pend=p=>C.filter(c=>c.processo_id===p.id&&!c.pago);
  const icons=p=>{const pc=pend(p),v=pc.some(c=>['vencida','hoje'].includes(custaSt(c)));return `<span class="ico-row">${p.n_anexos?`<span class="on" title="${p.n_anexos} anexo(s)">${icon('paperclip')}${p.n_anexos}</span>`:''}${pc.length?`<span class="${v?'miss':'on'}" title="${pc.length} custa(s) a pagar">${icon('receipt')}${pc.length}</span>`:''}${p.conferido?`<span class="on" title="Recebimento conferido">${icon('badge-check')}</span>`:''}</span>`};
  let head,rows;
  if(tipo==='cobranca'){
    head=`<th>Loja</th><th>Cliente</th><th>Status</th><th class="r">Dívida</th><th class="r">Acordo</th><th class="r">Pago</th><th></th><th>Último andamento</th>`;
    rows=l.map(p=>`<tr data-open="${p.id}"><td>${esc(p.loja||'–')}</td><td class="desc"><b>${esc(parteNome(p))}</b><span class="nproc">${p.codigo_cliente?'Cód. '+esc(p.codigo_cliente)+' · ':''}${p.numero?esc(p.numero):'sem nº de processo'}</span></td><td>${stPill(p.status)}</td><td class="r num">${fmt(p.valor)}</td><td class="r num">${p.valor_acordo?fmt(p.valor_acordo):'–'}</td><td class="r num ${p.valor_pago?'pos':''}">${p.valor_pago?fmt(p.valor_pago):'–'}</td><td>${icons(p)}</td><td class="and"><span>${esc(p.andamento)}</span></td></tr>`).join('');
  }else{
    head=`<th>Nº do processo</th><th>Parte</th><th>Tipo de ação</th><th>Loja</th><th>Status</th><th class="r">Condenação</th><th class="r">Pago</th><th></th>`;
    rows=l.map(p=>`<tr data-open="${p.id}"><td class="num">${esc(p.numero||'–')}</td><td class="desc"><b>${esc(parteNome(p))}</b>${p.identificacao?`<span class="nproc">${esc(p.identificacao)}</span>`:''}</td><td>${esc(p.tipo_acao||'–')}</td><td>${esc(p.loja||'–')}${p.uf?` <span class="tag">${esc(p.uf)}</span>`:''}</td><td>${stPill(p.status)}</td><td class="r num">${p.valor?fmt(p.valor):'–'}</td><td class="r num">${p.valor_pago?fmt(p.valor_pago):'–'}</td><td>${icons(p)}</td></tr>`).join('');
  }
  const cols=8,tv=soma(l,'valor');
  return `<div class="ph"><div><h1>${TIPO_NOME[tipo]}</h1><p>${l.length} de ${todos.length} processos${tv?' · '+fmt0(tv):''}</p></div><div class="ph-actions"><button class="btn" data-csv="${tipo}">${icon('download')}Exportar</button>${canJ?`<button class="btn primary" data-act="novo" data-tipo="${tipo}">${icon('plus')}Novo processo</button>`:''}</div></div>
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
  const tools=`<div class="ag-bar">${mseg('cv',[['lista','Lista','list'],['mes','Calendário','calendar-days']])}</div>`;
  let body;
  if(S.cv==='lista'){
    const l=[...grupos[S.cf]].sort((a,b)=>S.cf==='pagas'?(b.pago_em||'').localeCompare(a.pago_em||''):(a.vencimento||'9').localeCompare(b.vencimento||'9'));
    body=`<section class="card"><div class="flt-row" style="padding-bottom:14px">${[['atencao','Vencidas e vencendo'],['abertas','A pagar'],['pagas','Pagas'],['todas','Todas']].map(([k,t])=>`<button class="chip ${S.cf===k?'active':''}" data-cf="${k}">${t} <small>${grupos[k].length}</small></button>`).join('')}</div><div class="card-b" style="padding-top:0">${l.length?`<div class="ulist">${l.map(c=>cRow(c)).join('')}</div>`:'<p class="empty">Nenhuma custa aqui.</p>'}</div></section>`;
  }else{
    const first=new Date(S.cy,S.cm,1),start=first.getDay(),dim=new Date(S.cy,S.cm+1,0).getDate();
    const cells=Math.ceil((start+dim)/7)*7;let g=WD.map(w=>`<div class="wd">${w}</div>`).join('');
    for(let i=0;i<cells;i++){
      const t=new Date(S.cy,S.cm,1-start+i),d=ymd(t.getFullYear(),t.getMonth(),t.getDate()),out=t.getMonth()!==S.cm;
      const its=cv.filter(c=>c.vencimento===d);
      const k=c=>c.pago?'cp':(['vencida','hoje'].includes(custaSt(c))?'cv':'ca');
      const items=its.map(c=>`<span class="ev ${k(c)}">${esc(parteNome(proc(c.processo_id)))}</span>`);
      g+=`<button class="day ${out?'out':''} ${d===HOJE?'today':''} ${d===S.sel?'sel':''}" data-day="${d}" aria-label="${t.getDate()} de ${MES[t.getMonth()]}"><span class="n">${t.getDate()}</span>${items.slice(0,3).join('')}${items.length>3?`<span class="more">+${items.length-3}</span>`:''}<span class="dots">${its.slice(0,6).map(c=>`<i class="${k(c)}"></i>`).join('')}</span></button>`;
    }
    const sel=cv.filter(c=>c.vencimento===S.sel),p=dParts(S.sel||HOJE);
    body=`<div class="cal"><section class="card" style="overflow:hidden"><div class="cal-grid">${g}</div></section><section class="card"><div class="card-h"><h2>${S.sel===HOJE?'Hoje, ':''}${p.d} de ${MES[p.m]}</h2></div><div class="card-b">${sel.length?`<div class="ulist">${sel.map(c=>cRow(c)).join('')}</div>`:'<p class="empty">Nenhuma custa vence neste dia.</p>'}</div></section></div>`;
  }
  const semData=cv.filter(c=>!c.vencimento&&!c.pago).length;
  return `<div class="ph"><div><h1>Custas</h1><p>${grupos.abertas.length} a pagar · ${fmt0(soma(grupos.abertas,'valor'))} com valor lançado${semData?` · ${semData} sem vencimento`:''}</p></div><div class="ph-actions">${S.cv==='mes'?`<div class="monthnav"><button data-mnav="-1" aria-label="Mês anterior">${icon('chevron-left')}</button><span>${MES[S.cm]} ${S.cy}</span><button data-mnav="1" aria-label="Próximo mês">${icon('chevron-right')}</button></div><button class="btn" data-today="1">Hoje</button>`:''}</div></div>${tools}${body}
  <p class="hint">${canJ?'Para lançar uma custa, abra o processo e use "Nova custa". ':''}${canF?'Ao pagar, anexe o comprovante dentro do processo.':''}</p>`;
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
  const lj=`<div class="fld"><label for="p-loja">Loja</label><select id="p-loja" ${dJ}>${lojaOpts(p.loja||(S.loja||''))}</select></div>`;
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
    <div class="cbox-a">${c.link?`<a href="${esc(c.link)}" target="_blank" rel="noopener">${icon('external-link')}Boleto (link)</a>`:''}${ax.map(a=>`<a href="${esc(a.url)}" target="_blank" rel="noopener">${icon(a.categoria==='Comprovante'?'badge-check':'file-text')}${esc(a.categoria)}: ${esc(a.nome)}</a>`).join('')}<span class="sp"></span>
      <button class="btn sm" data-anexar-custa="${c.id}" data-cat="${c.pago?'Comprovante':'Boleto'}">${icon('paperclip')}${c.pago?'Comprovante':'Boleto'}</button>
      ${canJ&&!c.pago?`<button class="btn sm" data-edit-custa="${c.id}">${icon('pencil')}</button>`:''}
      ${canF?(c.pago?`<button class="btn sm" data-despagar="${c.id}">Desfazer pagamento</button>`:`<button class="btn sm primary" data-pagar="${c.id}">${icon('check')}Marcar paga</button>`):''}</div></div>`}).join(''):'<p class="empty">Nenhuma custa lançada.</p>';
  const anxs=p.anexos.filter(a=>!a.custa_id);
  const anexH=anxs.length?`<ul class="anx-list">${anxs.map(a=>`<li><a href="${esc(a.url)}" target="_blank" rel="noopener">${icon(a.link?'external-link':'file')}<span>${esc(a.categoria)}: ${esc(a.nome)}</span><small class="muted">${esc(a.por)} · ${brDate(a.em)}</small></a>${a.por===ME.nome||isAdmin?`<button class="anx-del" data-del-anexo="${a.id}" title="Remover">${icon('trash-2')}</button>`:''}</li>`).join('')}</ul>`:'<p class="empty">Nenhum anexo.</p>';
  const hist=p.historico.map(h=>{let det='';try{const d=JSON.parse(h.detalhes);if(Array.isArray(d))det=d.map(x=>`${x.campo}: ${x.de??'vazio'} → ${x.para??'vazio'}`).join('\n');else if(d&&typeof d==='object')det=Object.entries(d).filter(([,v])=>v!=null&&v!=='').map(([k,v])=>`${k}: ${Array.isArray(v)?v.join(', '):v}`).join(' · ')}catch(e){det=h.detalhes||''}return `<div><b>${esc(h.acao)}</b> · ${esc(h.nome)} · ${brDT(h.em)}${det?`<br><span style="white-space:pre-wrap">${esc(det)}</span>`:''}</div>`}).join('')||'Sem registros.';
  openLayer(`<div class="m-h"><div style="min-width:0"><h2 style="overflow:hidden;text-overflow:ellipsis">${esc(parteNome(p))}</h2><small class="muted">${TIPO_NOME[tipo]} · ${p.numero?esc(p.numero):'sem nº de processo'}</small></div><button class="x" data-close="1" aria-label="Fechar">${icon('x')}</button></div>
  <div class="m-b">
    <div class="sec">
      <div class="fin">
        <div><small>${tipo==='cobranca'?'Dívida':'Condenação'}</small><b class="num">${fmt(p.valor)}</b></div>
        <div><small>Acordo</small><b class="num">${fmt(p.valor_acordo)}</b></div>
        <div><small>Pago</small><b class="num ${p.valor_pago?'pos':''}">${fmt(p.valor_pago)}</b>${p.valor_acordo?`<small>${aRec>0?'falta '+fmt(aRec):'quitado'}</small>`:''}</div>
      </div>
    </div>
    <form class="sec" id="f-proc" data-id="${p.id}" data-tipo="${tipo}">
      <div class="sec-h"><h3>${icon('file-text')}Dados do processo</h3>${canJ?'':`<span class="lock" style="margin-left:auto">${icon('lock')}Só o jurídico edita</span>`}</div>
      <div class="frm">${camposForm(p,tipo)}</div>
      <div class="sec-h" style="margin-top:6px"><h3>${icon('wallet')}Valores</h3></div>
      <div class="frm">
        <div class="fld"><label for="p-valor_acordo">Valor do acordo (R$)</label><input id="p-valor_acordo" inputmode="decimal" value="${numIn(p.valor_acordo)}" ${canJ?'':'disabled'}></div>
        <div class="fld"><label for="p-valor_pago">Valor pago (R$) ${canF?'':`<span class="lock">${icon('lock')}financeiro</span>`}</label><input id="p-valor_pago" inputmode="decimal" value="${numIn(p.valor_pago)}" ${canF?'':'disabled'}></div>
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
      <div class="sec-h"><h3>${icon('receipt')}Custas</h3>${canJ?`<button class="btn sm" data-nova-custa="${p.id}">${icon('plus')}Nova custa</button>`:''}</div>
      <div id="custa-form"></div>
      ${custasH}
    </div>
    <div class="sec anexos">
      <div class="sec-h"><h3>${icon('paperclip')}Anexos</h3><button class="btn sm" data-anexar="${p.id}">${icon('upload')}Anexar</button></div>
      <div id="anx-form"></div>
      ${anexH}
    </div>
    <div class="sec"><details class="more-h"><summary>${icon('history')}Histórico de alterações (${p.historico.length})</summary><div class="hist" style="margin-top:10px">${hist}</div></details></div>
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
let ADM={usuarios:null,historico:null,backups:null};
function pgAdmin(){
  if(!isAdmin)return '<p class="empty">Sem acesso.</p>';
  const tabs=[['usuarios','Usuários','users'],['lojas','Lojas','store'],['historico','Histórico','history'],['backups','Backups','archive'],['importar','Importar planilha','file-up']];
  return `<div class="ph"><div><h1>Administração</h1></div></div><div>${mseg('adm',tabs)}</div><div id="adm">${admBody()}</div>`;
}
function admBody(){
  if(S.adm==='usuarios'){
    if(!ADM.usuarios)return '<div class="loading" style="min-height:160px"><span class="spin"></span></div>';
    return `<section class="card"><div class="card-h"><h2>Usuários</h2><span class="sub">cada pessoa entra com o próprio usuário; no primeiro acesso usa a senha padrão e cria a sua</span><div class="tools"><button class="btn sm primary" data-novo-user="1">${icon('user-plus')}Novo usuário</button></div></div><div class="tbl-wrap" style="padding-top:12px"><table><thead><tr><th>Nome</th><th>Usuário</th><th>Perfil</th><th>Lojas</th><th>Situação</th><th></th></tr></thead><tbody>${ADM.usuarios.map(u=>`<tr data-edit-user="${u.id}"><td><b style="font-weight:500">${esc(u.nome)}</b></td><td class="num">${esc(u.usuario)}</td><td>${esc(LISTAS.perfis[u.perfil]||u.perfil)}</td><td style="white-space:normal">${u.lojas.length?esc(u.lojas.join(', ')):'<span class="muted">Todas</span>'}</td><td>${!u.ativo?'<span class="cu vencida">Desativado</span>':u.pendente?'<span class="cu proxima">Aguardando 1º acesso</span>':'<span class="cu paga">Ativo</span>'}</td><td class="r">${icon('chevron-right')}</td></tr>`).join('')}</tbody></table></div></section>`;
  }
  if(S.adm==='lojas')return `<section class="card"><div class="card-h"><h2>Lojas</h2><span class="sub">${LOJAS.length} cadastradas</span></div><div class="card-b"><form id="f-loja" class="filters" style="padding:0 0 14px"><div class="fld" style="flex:1;min-width:160px"><input id="lj-nome" placeholder="Nome da loja"></div><div class="fld" style="width:80px"><input id="lj-uf" placeholder="UF" maxlength="2"></div><button class="btn primary">${icon('plus')}Adicionar</button></form><div class="lojas-chk" style="max-height:none">${LOJAS.map(l=>`<span>${esc(l.nome)}${l.uf?` <span class="tag">${esc(l.uf)}</span>`:''} <small class="muted">${P.filter(p=>p.loja===l.nome).length}</small></span>`).join('')}</div></div></section>`;
  if(S.adm==='historico'){
    if(!ADM.historico)return '<div class="loading" style="min-height:160px"><span class="spin"></span></div>';
    return `<section class="card"><div class="card-h"><h2>Histórico</h2><span class="sub">tudo que foi feito no sistema, do mais recente para o mais antigo</span></div><div class="log" style="padding-top:10px">${ADM.historico.map(h=>`<div class="log-row"><time>${brDT(h.em)}</time><span class="av eq">${esc((h.nome||'?')[0])}</span><div class="lg-d"><b>${esc(h.nome)}</b> · ${esc(h.acao)}${h.parte?` · <a href="#" data-open="${h.processo_id}">${esc(h.parte)}</a>`:''}${h.detalhes?`<small>${esc(fmtDet(h.detalhes))}</small>`:''}</div></div>`).join('')}</div>${ADM.historico.length&&ADM.historico.length%100===0?`<div class="card-b"><button class="btn" data-hist-mais="1">Carregar mais</button></div>`:''}</section>`;
  }
  if(S.adm==='backups'){
    if(!ADM.backups)return '<div class="loading" style="min-height:160px"><span class="spin"></span></div>';
    return `<section class="card"><div class="card-h"><h2>Backups</h2><span class="sub">um por dia (60 dias), um antes de cada atualização do sistema e antes de importar</span><div class="tools"><button class="btn sm primary" data-backup-agora="1">${icon('archive')}Fazer backup agora</button></div></div><div class="card-b"><div class="bk-list">${ADM.backups.length?ADM.backups.map(b=>`<a class="bk-item" href="/backups/${encodeURIComponent(b.nome)}">${icon('file-archive')}<span>${esc(b.nome.replace('bi-juridico-','').replace('.zip',''))}</span><small>${(b.tamanho/1024).toFixed(0)} KB</small>${icon('download')}</a>`).join(''):'<p class="empty">Nenhum backup ainda. O primeiro sai em até 1 hora.</p>'}</div><p class="hint" style="margin-top:12px">Cada arquivo tem os dados completos (dados.json) e uma planilha para abrir no Excel (planilha.xlsx).</p></div></section>`;
  }
  if(S.adm==='importar')return `<section class="card"><div class="card-h"><h2>Importar planilha</h2></div><div class="card-b"><p class="hint">Envie a planilha Jurídico em .xlsx (no Google Sheets: Arquivo › Fazer download › Microsoft Excel). Entram as abas Cobrança e Processos Diversos, com notas, custas e links do Drive. Um backup é feito antes.</p><form id="f-imp" class="filters" style="padding:14px 0 0"><input type="file" id="imp-arq" accept=".xlsx" required><button class="btn primary">${icon('file-up')}Importar</button></form><div id="imp-res"></div></div></section>`;
  return '';
}
function fmtDet(s){try{const d=JSON.parse(s);if(Array.isArray(d))return d.map(x=>x.campo?`${x.campo}: ${x.de??'vazio'} → ${x.para??'vazio'}`:JSON.stringify(x)).join('\n');if(d&&typeof d==='object')return Object.entries(d).filter(([,v])=>v!=null&&v!=='').map(([k,v])=>`${k}: ${Array.isArray(v)?v.join(', '):v}`).join(' · ');return String(d)}catch(e){return s}}
async function carregaAdmin(){
  try{
    if(S.adm==='usuarios'&&!ADM.usuarios){ADM.usuarios=(await api('/api/usuarios')).usuarios}
    else if(S.adm==='historico'&&!ADM.historico){ADM.historico=(await api('/api/historico')).itens}
    else if(S.adm==='backups'&&!ADM.backups){ADM.backups=(await api('/api/backups')).backups}
    else return;
    if(S.page==='admin'){$('#adm').innerHTML=admBody();drawIcons()}
  }catch(e){toast(e.message)}
}
function openUser(u){
  u=u||{perfil:'juridico',lojas:[],ativo:true};
  openLayer(`${mh(u.id?'Editar usuário':'Novo usuário')}<form id="f-user" data-id="${u.id||''}"><div class="m-b"><div class="frm">
    <div class="fld"><label for="u-nome">Nome</label><input id="u-nome" value="${esc(u.nome||'')}" required></div>
    <div class="fld"><label for="u-usuario">Usuário de acesso</label><input id="u-usuario" value="${esc(u.usuario||'')}" ${u.id?'disabled':''} placeholder="ex.: maria.silva" autocapitalize="none"></div>
    <div class="fld full"><label for="u-perfil">Perfil</label><select id="u-perfil">${Object.entries(LISTAS.perfis).map(([k,v])=>`<option value="${k}" ${u.perfil===k?'selected':''}>${v}</option>`).join('')}</select></div>
    <div class="fld full"><label>Lojas que enxerga <span class="muted">(nenhuma marcada = todas)</span></label><div class="lojas-chk">${LOJAS.map(l=>`<label><input type="checkbox" name="u-loja" value="${esc(l.nome)}" ${u.lojas.includes(l.nome)?'checked':''}>${esc(l.nome)}</label>`).join('')}</div></div>
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
  if(e.target.matches('.overlay')){closeLayer();return}
  if(!t)return;const d=t.dataset;
  if(d.close){closeLayer();return}
  if(d.page){e.preventDefault();if(d.cfgo){S.cf=d.cfgo;S.cv='lista'}S.page=d.page;S.st='todos';S.q='';closeLayer();render();window.scrollTo(0,0);return}
  if(d.refresh){refresh();return}
  if(d.bell){S.bell=!S.bell;renderBell();drawIcons();return}
  if(d.readall){atencao().forEach(c=>READ.add(`c${c.id}-${c.vencimento}`));saveRead();renderBell();drawIcons();return}
  if(d.notif){const c=C.find(x=>x.id===+d.notif);READ.add(`c${c.id}-${c.vencimento}`);saveRead();S.bell=false;renderBell();openProc(c.processo_id);return}
  if(d.set){const [k,v]=d.set.split(':');S[k]=v;salvaEstado();if(k==='adm'){$('#adm').innerHTML=admBody();document.querySelectorAll('[data-set^="adm:"]').forEach(b=>b.classList.toggle('active',b.dataset.set===d.set));drawIcons();carregaAdmin()}else render();return}
  if(d.st!==undefined&&t.classList.contains('chip')){S.st=d.st;render();return}
  if(d.cf){S.cf=d.cf;render();return}
  if(d.mnav){S.cm+=+d.mnav;if(S.cm<0){S.cm=11;S.cy--}if(S.cm>11){S.cm=0;S.cy++}render();return}
  if(d.today){S.cy=_t.getFullYear();S.cm=_t.getMonth();S.sel=HOJE;render();return}
  if(d.day){S.sel=d.day;render();return}
  if(d.gost!==undefined){S.page='cobranca';S.st=d.gost;S.q='';render();window.scrollTo(0,0);return}
  if(d.golj!==undefined){S.page='cobranca';S.st='todos';S.loja=d.golj==='Sem loja'?'':d.golj;S.q='';salvaEstado();render();window.scrollTo(0,0);return}
  if(d.godiv!==undefined){S.page='diversos';S.st='todos';S.q=d.godiv==='Sem tipo'?'':d.godiv;render();window.scrollTo(0,0);return}
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
  if(d.backupAgora){t.disabled=true;try{await api('/api/backups',{method:'POST'});toast('Backup feito.');ADM.backups=null;carregaAdmin()}catch(er){toast(er.message)}t.disabled=false;return}
  if(d.histMais){const mais=(await api('/api/historico?antes='+ADM.historico[ADM.historico.length-1].id)).itens;ADM.historico=ADM.historico.concat(mais);$('#adm').innerHTML=admBody();drawIcons();return}
  if(t.id==='themeBtn'){const n=isDark()?'light':'dark';document.documentElement.dataset.theme=n;try{localStorage.setItem('bj-theme',n)}catch(er){}render();return}
});
document.addEventListener('change',e=>{
  if(e.target.id==='loja'){S.loja=e.target.value;salvaEstado();render();return}
  if(e.target.dataset.ord){S.ord=e.target.value;render();return}
});
let qT;
document.addEventListener('input',e=>{if(e.target.id==='q'){S.q=e.target.value;clearTimeout(qT);qT=setTimeout(()=>{const pos=e.target.selectionStart;render();const q=$('#q');if(q){q.focus();q.setSelectionRange(pos,pos)}},180)}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('#layer').innerHTML)closeLayer()});

const num=v=>{v=String(v||'').trim();if(!v)return '';if(/,/.test(v))v=v.replace(/\./g,'').replace(',','.');return v};
document.addEventListener('submit',async e=>{
  e.preventDefault();const f=e.target,btn=f.querySelector('button.primary');if(btn)btn.disabled=true;
  try{
    if(f.id==='f-novo'){const d=lerForm();d.valor=num($('#p-valor').value);d.tipo=f.dataset.tipo;d.andamento=$('#p-and').value;const r=await salvar(()=>api('/api/processos',{method:'POST',body:d}),'Processo cadastrado.');openProc(r.id)}
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
    if(f.id==='f-user'){const body={id:f.dataset.id||null,nome:$('#u-nome').value,usuario:$('#u-usuario').value,perfil:$('#u-perfil').value,lojas:[...document.querySelectorAll('input[name=u-loja]:checked')].map(x=>x.value),ativo:$('#u-ativo')?$('#u-ativo').checked:true};
      await api('/api/usuarios',{method:'POST',body});toast(body.id?'Usuário salvo.':'Usuário criado. No primeiro acesso ele usa a senha padrão.');ADM.usuarios=null;closeLayer();carregaAdmin()}
    if(f.id==='f-loja'){await salvar(()=>api('/api/lojas',{method:'POST',body:{nome:$('#lj-nome').value,uf:$('#lj-uf').value}}),'Loja adicionada.')}
    if(f.id==='f-imp'){const fd=new FormData();fd.append('arquivo',$('#imp-arq').files[0]);
      let r;try{r=await api('/api/importar',{method:'POST',body:fd})}catch(er){if(er.dados&&er.dados.confirmar&&confirm(er.message+' Continuar mesmo assim?')){fd.append('confirmar','sim');r=await api('/api/importar',{method:'POST',body:fd})}else throw er}
      $('#imp-res').innerHTML=`<div class="box ok" style="margin-top:14px">${icon('check')}${r.processos} processos, ${r.custas} custas e ${r.anexos} anexos importados.</div>${r.avisos.length?`<ul class="hint">${r.avisos.map(a=>`<li>${esc(a)}</li>`).join('')}</ul>`:''}`;drawIcons();await refresh(true)}
  }catch(er){if(!er.avisado)toast(er.message)}
  finally{if(btn)btn.disabled=false}
});

refresh();
setInterval(()=>{if(!document.hidden&&!$('#layer').innerHTML)refresh(true)},60000);
