import http from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = join(root, 'data');
const stateFile = join(dataDir, 'state.json');
const productsFile = join(dataDir, 'products.json');
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const clients = new Set();
const sessions = new Map();
const loginAttempts = new Map();
const scryptAsync = promisify(scrypt);
let persistQueue = Promise.resolve();
const contentTypes = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.otf':'font/otf' };

await mkdir(dataDir, { recursive:true });
let products = JSON.parse(await readFile(productsFile,'utf8'));
let state = JSON.parse(await readFile(stateFile,'utf8'));
state = { goal:24, orders:[], unavailable:[], closed:false, dropNumber:1, ...state };
const adminAuth = JSON.parse(await readFile(join(dataDir,'admin-auth.json'),'utf8'));
const send = (res, status, payload) => { res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'same-origin'}); res.end(JSON.stringify(payload)); };
const persist = () => {
  const snapshot=JSON.stringify(state,null,2);
  const write=persistQueue.then(async()=>{const tmp=stateFile+'.'+randomUUID()+'.tmp';await writeFile(tmp,snapshot);await rename(tmp,stateFile);});
  persistQueue=write.catch(()=>{});
  return write;
};
const persistProducts = async () => { const tmp=productsFile+'.tmp'; await writeFile(tmp,JSON.stringify(products,null,2)); await rename(tmp,productsFile); };
const publicSummary = () => ({ goal:state.goal, dropNumber:state.dropNumber, closed:state.closed, products:products.map(({sourcePage,sizeSource,...p})=>p), unavailable:state.unavailable, paidPieces:state.orders.filter(o=>o.status==='Pago').reduce((n,o)=>n+o.items.reduce((m,i)=>m+i.qty,0),0) });
function publish(){ const message=`data: ${JSON.stringify({type:'refresh',at:Date.now()})}\n\n`; for(const response of clients) response.write(message); }
async function body(req){let text='';for await(const chunk of req)text+=chunk;if(text.length>100_000)throw new Error('Corpo da requisição muito grande.');return text?JSON.parse(text):{};}
function sessionToken(req){return (req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('tropa_admin='))?.slice('tropa_admin='.length)||'';}
function isAdmin(req){const token=sessionToken(req), expires=sessions.get(token);if(!token||!expires)return false;if(expires<Date.now()){sessions.delete(token);return false;}return true;}
function csvCell(value){const text=String(value??'');const safe=/^[\s\u0000-\u001f]*[=+@-]/.test(text)?`'${text}`:text;return `"${safe.replaceAll('"','""')}"`;}
function csvNumber(value){return value==null?'':Number(value).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});}
function productColor(name){const match=String(name||'').match(/\b(OFF\s?WHITE|OFF-WHITE|BEIGE|BROWN|BLACK|WHITE|GREEN|NAVY|BLUE|GREY|GRAY|RED|YELLOW|PINK|CAMO|PRETO|PRETA|BRANCO|BRANCA|MARINHO|AZUL|VERDE|CINZA|BEGE|MARROM|VERMELHO|VERMELHA|VINHO|ROSA|AMARELO|AMARELA|LARANJA|ROXO|ROXA|MESCLA|COLORIDO|COLORIDA)\b/i)?.[0];const translated=({BLACK:'Preto',WHITE:'Branco',GREEN:'Verde',NAVY:'Marinho',BLUE:'Azul',GREY:'Cinza',GRAY:'Cinza',RED:'Vermelho',YELLOW:'Amarelo',PINK:'Rosa',BEIGE:'Bege',BROWN:'Marrom',CAMO:'Camuflado'})[match?.toUpperCase()]||match;if(!translated)return 'Conforme foto';return translated.toLocaleLowerCase('pt-BR').replace(/^\p{L}/u,char=>char.toLocaleUpperCase('pt-BR'));}
function dropCsv(){const rows=[['Drop',String(state.dropNumber).padStart(2,'0')],['Gerado em',new Date().toLocaleString('pt-BR')],[],['Cliente','WhatsApp','Código','Produto','Cor','Tamanho','Quantidade','Preço unitário','Subtotal do item','Total combinado do pedido','Status','Data do pedido']];for(const o of state.orders)for(const i of o.items)rows.push([o.name,o.phone,i.sku||i.id,i.name,i.color||productColor(i.name),i.size,i.qty,csvNumber(i.unitPrice),csvNumber(i.unitPrice==null?null:i.unitPrice*i.qty),csvNumber(o.total),o.status,new Date(o.createdAt).toLocaleString('pt-BR')]);return '\ufeff'+rows.map(row=>row.map(csvCell).join(';')).join('\r\n');}
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&url.pathname==='/api/public')return send(res,200,publicSummary());
    if(req.method==='GET'&&url.pathname==='/api/admin/session')return send(res,200,{authenticated:isAdmin(req)});
    if(req.method==='POST'&&url.pathname==='/api/admin/login'){
      const input=await body(req),ip=req.socket.remoteAddress||'unknown',attempt=loginAttempts.get(ip)||{count:0,until:0};
      if(attempt.until>Date.now()&&attempt.count>=8)return send(res,429,{error:'Muitas tentativas. Aguarde 15 minutos e tente novamente.'});
      const username=String(input.username||'').trim(),password=String(input.password||'');
      const actual=Buffer.from(await scryptAsync(password,adminAuth.salt,64,{N:16384,r:8,p:1}));
      const expected=Buffer.from(adminAuth.hash,'hex');
      if(username!==adminAuth.username||actual.length!==expected.length||!timingSafeEqual(actual,expected)){
        const next=attempt.until>Date.now()?attempt:{count:0,until:Date.now()+15*60*1000};next.count++;loginAttempts.set(ip,next);return send(res,401,{error:'Usuário ou senha incorretos.'});
      }
      loginAttempts.delete(ip);const token=randomBytes(32).toString('base64url');sessions.set(token,Date.now()+12*60*60*1000);
      res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','set-cookie':`tropa_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${req.socket.encrypted?'; Secure':''}`});return res.end(JSON.stringify({ok:true,username:adminAuth.username}));
    }
    if(url.pathname.startsWith('/api/admin/')&&!isAdmin(req))return send(res,401,{error:'Entre na área do organizador novamente.'});
    if(req.method==='POST'&&url.pathname==='/api/admin/logout'){
      sessions.delete(sessionToken(req));res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','set-cookie':'tropa_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});return res.end('{"ok":true}');
    }
    if(req.method==='GET'&&url.pathname==='/api/admin/orders')return send(res,200,{orders:state.orders});
    if(req.method==='GET'&&url.pathname==='/api/events'){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive','x-content-type-options':'nosniff','x-frame-options':'DENY'});res.write('retry: 2000\n\n');clients.add(res);const heartbeat=setInterval(()=>res.write(': ping\n\n'),20000);req.on('close',()=>{clearInterval(heartbeat);clients.delete(res)});return;}
    if(req.method==='POST'&&url.pathname==='/api/orders'){
      if(state.closed)return send(res,409,{error:'Este drop já foi encerrado. Aguarde a abertura do próximo.'});
      const input=await body(req);const name=String(input.name||'').trim(),phoneInput=String(input.phone||'').replace(/\D/g,'');
      const phone=phoneInput.length===13&&phoneInput.startsWith('55')?phoneInput.slice(2):phoneInput;
      if(name.length<2||name.length>80||phone.length<10||phone.length>11||!Array.isArray(input.items)||!input.items.length||input.items.length>25)return send(res,400,{error:'Confira nome, WhatsApp e pedido (máximo de 25 opções).'});
      let items=[],total=0,needsQuote=false;
      for(const item of input.items){
        const product=products.find(p=>p.id===String(item.id));const qty=Number(item.qty);const size=String(item.size||'').trim();
        if(!product||state.unavailable.includes(product.id))return send(res,409,{error:'Uma peça não está mais disponível. Atualize o pedido.'});
        if(!product.sizes.includes(size)||!Number.isInteger(qty)||qty<1||qty>25)return send(res,400,{error:'Confira o tamanho e a quantidade.'});
        const unitPrice=Number.isFinite(product.price)&&product.price>0?product.price:null;
        if(unitPrice==null)needsQuote=true;else total+=unitPrice*qty;
        items.push({id:product.id,name:product.name,sku:product.sku||product.id,color:productColor(product.name),size,qty,unitPrice});
      }
      const nickname=String(input.nickname||'').trim().slice(0,60);
      const order={id:randomUUID(),name,phone,nickname,items,total:needsQuote?null:total,status:needsQuote?'Cotação':'Aguardando',createdAt:new Date().toISOString()};state.orders.push(order);await persist();publish();return send(res,201,{order});
    }
    const statusMatch=url.pathname.match(/^\/api\/admin\/orders\/([\w-]+)$/);
    if(req.method==='PATCH'&&statusMatch){
      const input=await body(req);if(!['Pago','Cancelado','Aguardando'].includes(input.status))return send(res,400,{error:'Status inválido.'});
      const order=state.orders.find(o=>o.id===statusMatch[1]);if(!order)return send(res,404,{error:'Pedido não encontrado.'});
      if(input.total!==undefined){const total=Number(input.total);if(!Number.isFinite(total)||total<=0||total>10000000)return send(res,400,{error:'Informe um total combinado válido.'});order.total=Number(total.toFixed(2));}
      if(['Aguardando','Pago'].includes(input.status)&&(!Number.isFinite(order.total)||order.total<=0))return send(res,400,{error:'Registre primeiro o valor combinado no WhatsApp.'});
      order.status=input.status;await persist();publish();return send(res,200,{order});
    }
    if(req.method==='PATCH'&&url.pathname==='/api/admin/availability'){const input=await body(req);const product=products.find(p=>p.id===String(input.productId));if(!product)return send(res,404,{error:'Produto não encontrado.'});state.unavailable=input.available?state.unavailable.filter(id=>id!==product.id):[...new Set([...state.unavailable,product.id])];await persist();publish();return send(res,200,{unavailable:state.unavailable});}
    if(req.method==='POST'&&url.pathname==='/api/admin/finalize'){
      if(state.closed)return send(res,409,{error:'Este drop já foi encerrado.'});
      const csv=dropCsv(),drop=String(state.dropNumber).padStart(2,'0'),filename=`drop-${drop}.csv`;
      await mkdir(join(dataDir,'drops'),{recursive:true});await writeFile(join(dataDir,'drops',filename),csv,'utf8');
      state.closed=true;state.closedAt=new Date().toISOString();await persist();publish();res.writeHead(200,{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="${filename}"`,'cache-control':'no-store'});return res.end(csv);
    }
    if(req.method==='POST'&&url.pathname==='/api/admin/open-next'){
      if(!state.closed)return send(res,409,{error:'Finalize o drop atual antes de abrir o próximo.'});
      state={goal:24,orders:[],unavailable:[],closed:false,dropNumber:state.dropNumber+1};await persist();publish();return send(res,200,{dropNumber:state.dropNumber});
    }
    if(req.method==='GET'&&url.pathname==='/api/health')return send(res,200,{ok:true,service:'tropa-dos-pedidos',connectedClients:clients.size});
    if(req.method!=='GET')return send(res,404,{error:'Rota não encontrada.'});
    const requested=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
    const allowed=new Set(['/index.html','/styles.css','/app.js']);let file;
    if(allowed.has(requested))file=resolve(root,'.'+requested);
    else if(requested.startsWith('/assets/')){const assetRoot=resolve(root,'assets'),candidate=resolve(assetRoot,requested.slice('/assets/'.length));if(candidate!==assetRoot&&candidate.startsWith(assetRoot+sep))file=candidate;}
    if(!file)return send(res,404,{error:'Página não encontrada.'});
    const bytes=await readFile(file);res.writeHead(200,{'content-type':contentTypes[extname(file)]||'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'same-origin'});res.end(bytes);
  } catch(error){if(error.code==='ENOENT')return send(res,404,{error:'Página não encontrada.'});if(error instanceof SyntaxError)return send(res,400,{error:'O pedido contém dados inválidos.'});console.error(error);const tooLarge=error.message==='Corpo da requisição muito grande.';send(res,tooLarge?413:500,{error:tooLarge?error.message:'Não foi possível concluir. Tente novamente.'});}
});
server.listen(port,host,()=>console.log(`Tropa dos Pedidos disponível em http://localhost:${port}`));

