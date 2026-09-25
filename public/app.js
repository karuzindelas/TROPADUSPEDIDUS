const $ = (selector) => document.querySelector(selector);
const money = (value) => Number(value).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const cartKey = 'tropa_cart_v2';
let storeState = { goal:24, products:[], unavailable:[], paidPieces:0 };
let orders = [];
let selectedFilter = 'Tudo';
let catalogPage = 1;
const catalogPageSize = 24;
let adminProductSearch = '';

function getCart(){ try { return JSON.parse(sessionStorage.getItem(cartKey) || '[]'); } catch { return []; } }
function setCart(cart){ try{sessionStorage.setItem(cartKey,JSON.stringify(cart));updateCartBadge();return true;}catch{showToast('Não foi possível salvar seu pedido neste navegador. Libere espaço e tente novamente.');return false;} }
function updateCartBadge(){ $('#cartCount').textContent = getCart().reduce((sum,item)=>sum+item.qty,0); }
function showToast(message){ const el=$('#toast'); el.textContent=message; el.classList.add('on'); clearTimeout(showToast.timer); showToast.timer=setTimeout(()=>el.classList.remove('on'),2600); }
function openModal(html){ $('#modal').innerHTML=html; $('#overlay').classList.add('show'); }
function closeModal(){ $('#overlay').classList.remove('show'); }
async function request(path, options={}){ const response=await fetch(path,{...options,headers:{'content-type':'application/json',...(options.headers||{})}}); const result=await response.json(); if(!response.ok)throw new Error(result.error||'Algo deu errado.'); return result; }

async function loadStore(){
  try { storeState=await request('/api/public'); renderStore(); }
  catch(error){ showToast('Não conectou ao servidor. Recarregue a página em instantes.'); }
}
async function loadAdmin(){
  try { ({orders}=await request('/api/admin/orders')); renderAdmin(); }
  catch(error){ showToast(error.message); }
}
function connectLiveUpdates(){
  const events=new EventSource('/api/events');
  events.onmessage=()=>{ loadStore(); if($('#admin').classList.contains('visible')&&$('#admin').classList.contains('authenticated'))loadAdmin(); };
  events.onerror=()=>{ events.close(); setTimeout(connectLiveUpdates,2500); };
}

const colorWords=['OFF WHITE','OFF-WHITE','BEIGE','BROWN','BLACK','WHITE','GREEN','NAVY','BLUE','GREY','GRAY','RED','YELLOW','PINK','CAMO','PRETO','PRETA','BRANCO','BRANCA','MARINHO','AZUL','VERDE','CINZA','BEGE','MARROM','VERMELHO','VERMELHA','VINHO','ROSA','AMARELO','AMARELA','LARANJA','ROXO','ROXA','MESCLA','COLORIDO','COLORIDA'];
const colorPattern=new RegExp(`\\b(${colorWords.map(word=>word.replaceAll(' ','\\s+')).join('|')})\\b`,'i');
const colorTranslations={BLACK:'Preto',WHITE:'Branco',GREEN:'Verde',NAVY:'Marinho',BLUE:'Azul',GREY:'Cinza',GRAY:'Cinza',RED:'Vermelho',YELLOW:'Amarelo',PINK:'Rosa',BEIGE:'Bege',BROWN:'Marrom',CAMO:'Camuflado'};
function namedColor(product){const match=String(product.color||product.name.match(colorPattern)?.[0]||'').trim();return colorTranslations[match.toUpperCase()]||match.toLocaleLowerCase('pt-BR').replace(/^\p{L}/u,char=>char.toLocaleUpperCase('pt-BR'));}
function productOption(product){const color=namedColor(product);if(color)return {type:'color',label:color};const version=product.name.match(/\bV\d+\b/i)?.[0];return version?{type:'variant',label:version.toUpperCase()}:null;}
function displayOption(product){const option=product?productOption(product):null;return option?.label||'cor da foto';}
function optionBaseName(product){return productOption(product)?.type==='color'?product.name.replace(colorPattern,' ').replace(/\s+/g,' ').trim().toLocaleLowerCase('pt-BR'):product.name.replace(/\s+V\d+\b/i,'').replace(/\s+/g,' ').trim().toLocaleLowerCase('pt-BR');}
function groupColors(products){
  const groups=[],byBase=new Map();
  for(const product of products){const option=productOption(product),base=option?optionBaseName(product):'',sku=String(product.sku||''),family=/^\d{8,}$/.test(sku)?sku.slice(0,-2):String(product.id),key=base?`${product.category}:${base}:${option.type}:${family}`:`product:${product.id}`;let group=byBase.get(key);if(!group){group={name:option?base.toLocaleUpperCase('pt-BR'):product.name,type:option?.type||'',variants:[]};byBase.set(key,group);groups.push(group);}group.variants.push(product);}
  return groups;
}
function photoPair(product){
  const front=String(product.img||'');let back='';
  const path=front.split('?')[0];
  const modern=path.match(/^(.*\/)(\d+)-(\d+)(?:-\d+)?\.jpg$/i);
  const legacy=path.match(/^(.*\/)(\d+)_\s*(\d+)\.jpg$/i);
  if(modern)back=`${modern[1]}${modern[2]}-${Number(modern[3])+1}.jpg`;
  else if(legacy)back=`${legacy[1]}${legacy[2]}_${Number(legacy[3])+1}.jpg`;
  return [front,back].filter(Boolean);
}
function renderProductCard(group){
  const product=group.variants.find(variant=>!storeState.unavailable.includes(variant.id))||group.variants[0],photos=photoPair(product),options=group.variants.map(variant=>productOption(variant)?.label||'').filter(Boolean),allUnavailable=group.variants.every(variant=>storeState.unavailable.includes(variant.id));
  const colorInfo=group.variants.length>1
    ?`<div class="color-options"><span>${group.type==='color'?'CORES':'VERSÕES'}</span>${group.variants.map(variant=>{const label=productOption(variant)?.label||'Conforme foto',swatch=group.type==='color'?label.toLocaleLowerCase('pt-BR').replaceAll(' ','-'):'foto';return `<button class="color-chip" data-color-product="${group.variants.map(item=>escapeHtml(item.id)).join(',')}" data-selected="${escapeHtml(variant.id)}" title="Escolher ${escapeHtml(label)}" ${storeState.unavailable.includes(variant.id)?'disabled':''}><i class="swatch swatch-${escapeHtml(swatch)}"></i>${escapeHtml(label)}</button>`;}).join('')}</div>`
    :`<div class="color-options"><span>${productOption(product)?.type==='variant'?'VERSÃO':'COR'}</span><span class="color-chip color-fixed"><i class="swatch swatch-${escapeHtml((namedColor(product)||'foto').toLocaleLowerCase('pt-BR').replaceAll(' ','-'))}"></i>${escapeHtml(productOption(product)?.label||'Conforme foto')}</span></div>`;
  return `<article class="product"><div class="product-img gallery" data-gallery="${escapeHtml(product.id)}" data-index="0" data-front="${escapeHtml(photos[0]||product.img)}" data-back="${escapeHtml(photos[1]||'')}"><img class="gallery-image" src="${escapeHtml(photos[0]||product.img)}" loading="lazy" alt="${escapeHtml(group.name)} · foto 1"><button class="gallery-arrow previous" data-gallery-step="-1" aria-label="Foto anterior" disabled>‹</button><span class="gallery-count">FOTO 1</span><button class="gallery-arrow next" data-gallery-step="1" aria-label="Próxima foto" ${photos.length<2?'hidden':''}>›</button><span class="tag">${storeState.closed?'Drop encerrado':allUnavailable?'Indisponível':escapeHtml(product.category)}</span></div><div class="product-info"><div class="sku">CÓD. <span data-card-sku>${escapeHtml(product.sku||product.id)}</span>${group.variants.length>1?` · ${group.variants.length} ${group.type==='color'?'cores':'versões'}`:''}</div><h3>${escapeHtml(group.name)}</h3>${colorInfo}<div class="spec">${escapeHtml(product.desc||'Peças de rua, acessórios e mais.')}</div><div class="price-row"><span class="price">${product.price==null?'Valor a confirmar':money(product.price)}</span><span class="cost-note">no WhatsApp</span></div><button class="add" data-add="${group.variants.map(variant=>escapeHtml(variant.id)).join(',')}" ${(allUnavailable||storeState.closed)?'disabled':''}>${storeState.closed?'Drop encerrado':allUnavailable?'Indisponível':'Escolher cor e tamanho +'}</button></div></article>`;
}
function changeGallery(button){
  const gallery=button.closest('[data-gallery]');if(!gallery)return;
  const current=Number(gallery.dataset.index||0),next=current?0:1,back=gallery.dataset.back;
  if(next===1&&!back)return;
  const image=gallery.querySelector('.gallery-image');image.src=next?back:gallery.dataset.front;image.alt=`${image.alt.split(' · ')[0]} · foto ${next+1}`;
  gallery.dataset.index=String(next);gallery.querySelector('.gallery-count').textContent=`FOTO ${next+1}`;
  gallery.querySelector('[data-gallery-step="-1"]').disabled=next===0;
  gallery.querySelector('[data-gallery-step="1"]').disabled=next===1;
}
async function shareDrop(){
  const pieces=storeState.paidPieces||0,goal=storeState.goal||24,remaining=Math.max(goal-pieces,0),url=location.origin+location.pathname;
  const message=`Tô no Drop ${String(storeState.dropNumber||1).padStart(2,'0')} da Tropa dos Pedidos. Faltam ${remaining} peças pra fechar o pedido; cada compra paga acelera a chegada. Escolhe a tua: ${url}`;
  if(navigator.share){try{await navigator.share({title:'Tropa dos Pedidos · Drop',text:message,url});return;}catch(error){if(error.name==='AbortError')return;}}
  window.open(`https://wa.me/?text=${encodeURIComponent(message)}`,'_blank','noopener');
}

function renderStore(){
  updateCartBadge();
  const dropName=`Drop ${String(storeState.dropNumber||1).padStart(2,'0')}`;
  document.title=`Tropa dos Pedidos — ${dropName}`;
  $('#dropLabel').textContent=`${dropName} · Coleção urbana`;
  $('#dropNote').textContent=storeState.closed?'Este drop foi finalizado. Aguarde a abertura do próximo para fazer um pedido.':'O pedido fecha quando o grupo alcançar o mínimo de 24 peças.';
  $('#dropNote').classList.toggle('drop-closed',Boolean(storeState.closed));
  document.querySelectorAll('[data-filter]').forEach(button=>{button.hidden=button.dataset.filter!=='Tudo'&&!storeState.products.some(product=>product.category===button.dataset.filter);});
  const term=$('#catalogSearch').value.trim().toLocaleLowerCase('pt-BR');
  const filtered=storeState.products.filter(p=>(selectedFilter==='Tudo'||p.category===selectedFilter)&&(!term||`${p.name} ${p.sku} ${p.id}`.toLocaleLowerCase('pt-BR').includes(term)));
  const grouped=groupColors(filtered),pageCount=Math.max(1,Math.ceil(grouped.length/catalogPageSize));catalogPage=Math.min(catalogPage,pageCount);
  const visible=grouped.slice((catalogPage-1)*catalogPageSize,catalogPage*catalogPageSize);
  $('#catalogCount').textContent=`${filtered.length} produto${filtered.length===1?'':'s'}${term?' encontrado'+(filtered.length===1?'':'s'):''}`;
  $('#catalog').innerHTML=visible.map(renderProductCard).join('') || '<div class="empty">Não encontramos peças com essa busca.</div>';
  $('#catalogCount').textContent=`${filtered.length} produtos · ${grouped.length} modelos${term?' encontrados':''}`;
  $('#catalogPages').innerHTML=pageCount>1?`<button class="secondary" data-page="${catalogPage-1}" ${catalogPage===1?'disabled':''}>← Anterior</button><span>Página ${catalogPage} de ${pageCount}</span><button class="secondary" data-page="${catalogPage+1}" ${catalogPage===pageCount?'disabled':''}>Próxima →</button>`:'';
  const pieces=storeState.paidPieces;
  const goal=storeState.goal;
  $('#count').textContent=pieces;
  $('#progress').style.width=`${Math.min(pieces/goal*100,100)}%`;
  $('#remaining').textContent=pieces>=goal?'Meta mínima atingida!':`Faltam ${goal-pieces} peças para fechar`;
  $('#percent').textContent=`${Math.min(Math.round(pieces/goal*100),100)}%`;
  $('#statPieces').textContent=`${pieces} / ${goal}`;
}

function productById(id){return storeState.products.find(product=>String(product.id)===String(id));}
function cartTotal(cart){let total=0;for(const item of cart){const product=productById(item.id);if(!product||product.price==null)return null;total+=product.price*item.qty;}return total;}
function startAdd(ids,selectedId=''){
  let requestedIds=Array.isArray(ids)?ids:String(ids).split(',');
  if(requestedIds.length===1){const group=groupColors(storeState.products).find(item=>item.variants.some(product=>String(product.id)===String(requestedIds[0])));if(group?.variants.length>1)requestedIds=group.variants.map(product=>product.id);}
  const products=requestedIds.map(productById).filter(Boolean),requested=products.find(item=>String(item.id)===String(selectedId||requestedIds[0])),product=requested&&!storeState.unavailable.includes(requested.id)?requested:products.find(item=>!storeState.unavailable.includes(item.id));
  if(!product||storeState.closed)return;
  const sizeOptions=product.sizes.length?product.sizes:['Tamanho a confirmar'],photos=photoPair(product),optionLabel=productOption(product)?.label||'conforme a foto',choiceLabel=productOption(product)?.type==='variant'?'Variação':'Cor';
  const colorPicker=products.length>1?`<label class="field" for="colorSelect">${groupColors(products)[0]?.type==='variant'?'Variação':'Cor'}</label><select class="input" id="colorSelect">${products.map(item=>`<option value="${escapeHtml(item.id)}" ${String(item.id)===String(product.id)?'selected':''} ${storeState.unavailable.includes(item.id)?'disabled':''}>${escapeHtml(productOption(item)?.label||item.name)}${storeState.unavailable.includes(item.id)?' · indisponível':''} · cód. ${escapeHtml(item.sku||item.id)}</option>`).join('')}</select>`:`<div class="selected-color">${choiceLabel}: <b>${escapeHtml(optionLabel)}</b></div>`;
  openModal(`<button class="close" data-close aria-label="Fechar">×</button><div class="eyebrow">Adicionar ao drop · <span id="modalSku">cód. ${escapeHtml(product.sku||product.id)}</span></div><h2 id="modalName">${escapeHtml(optionBaseName(product).toLocaleUpperCase('pt-BR'))}</h2><div class="modal-gallery gallery" data-gallery="modal" data-index="0" data-front="${escapeHtml(photos[0]||product.img)}" data-back="${escapeHtml(photos[1]||'')}"><img class="gallery-image" src="${escapeHtml(photos[0]||product.img)}" alt="${escapeHtml(product.name)} · foto 1"><button class="gallery-arrow previous" data-gallery-step="-1" aria-label="Foto anterior" disabled>‹</button><span class="gallery-count">FOTO 1</span><button class="gallery-arrow next" data-gallery-step="1" aria-label="Próxima foto" ${photos.length<2?'hidden':''}>›</button></div><p class="modal-sub">${escapeHtml(product.desc||'O catálogo tem roupas, acessórios e outras peças.')}</p>${colorPicker}<label class="field" for="size">Tamanho / opção</label><select class="input" id="size">${sizeOptions.map(size=>`<option value="${escapeHtml(size)}">${escapeHtml(size)}</option>`).join('')}</select><p class="size-hint">Vamos confirmar tamanho, cor e disponibilidade com a Chronic antes de pedir o Pix.</p><label class="field">Quantidade</label><div class="qty"><button data-qty="-1" aria-label="Diminuir">−</button><span id="qty">1</span><button data-qty="1" aria-label="Aumentar">+</button></div><div style="height:18px"></div><button class="primary" data-add-confirm="${escapeHtml(product.id)}">Adicionar ao pedido</button>`);
}
function changeModalColor(id){
  const product=productById(id);if(!product)return;const sizeOptions=product.sizes.length?product.sizes:['Tamanho a confirmar'],gallery=$('#modal .modal-gallery'),photos=photoPair(product);
  $('#modalSku').textContent=`cód. ${product.sku||product.id}`;$('#modalName').textContent=optionBaseName(product).toLocaleUpperCase('pt-BR');
  $('#size').innerHTML=sizeOptions.map(size=>`<option value="${escapeHtml(size)}">${escapeHtml(size)}</option>`).join('');
  const image=gallery.querySelector('.gallery-image');image.src=photos[0]||product.img;image.alt=`${product.name} · foto 1`;gallery.dataset.front=photos[0]||product.img;gallery.dataset.back=photos[1]||'';gallery.dataset.index='0';gallery.querySelector('.gallery-count').textContent='FOTO 1';gallery.querySelector('[data-gallery-step="-1"]').disabled=true;gallery.querySelector('[data-gallery-step="1"]').disabled=!photos[1];
  const add=$('[data-add-confirm]');add.dataset.addConfirm=product.id;
}
function addSelectedProduct(id){
  const size=$('#size').value;const qty=Number($('#qty').textContent);const cart=getCart();const existing=cart.find(item=>String(item.id)===String(id)&&item.size===size);
  if(existing&&existing.qty+qty>25){showToast('O limite é de 25 unidades por opção.');return;}
  if(!existing&&cart.length>=25){showToast('O pedido pode ter até 25 opções de produto.');return;}
  if(existing)existing.qty+=qty;else cart.push({id:String(id),size,qty});
  if(!setCart(cart))return;closeModal();showToast('Peça adicionada ao seu pedido.');showCart();
}
function showCart(){
  const cart=getCart();
  if(!cart.length){openModal('<button class="close" data-close aria-label="Fechar">×</button><div class="eyebrow">Seu pedido</div><h2>Ainda tá vazio.</h2><p class="modal-sub">Escolha as peças do drop e elas aparecem aqui para você revisar.</p><button class="primary" data-close>Escolher peças</button>');return;}
  const total=cartTotal(cart);
  const lines=cart.map((item,index)=>{const product=productById(item.id);const unit=product?.price==null?'a confirmar no WhatsApp':`${money(product.price)} cada`;const line=product?.price==null?'Valor a confirmar':money(item.qty*product.price);return `<div class="cartline"><span>${item.qty} × ${escapeHtml(product?.name||'Produto')} · ${escapeHtml(displayOption(product))} · ${escapeHtml(item.size)}<br><small>Cód. ${escapeHtml(product?.sku||product?.id)} · ${unit}</small></span><span style="text-align:right"><b>${line}</b><br><button class="rowaction" data-remove="${index}">Remover</button></span></div>`;}).join('');
  openModal(`<button class="close" data-close aria-label="Fechar">×</button><div class="eyebrow">Seu pedido · ${cart.reduce((sum,item)=>sum+item.qty,0)} peças</div><h2>Confere aí.</h2><p class="modal-sub">Continue escolhendo ou envie a lista para confirmar preço e estoque.</p>${lines}<div class="total"><span>${total==null?'Valor final':'Total'}</span><span>${total==null?'A combinar no WhatsApp':money(total)}</span></div><div class="split"><button class="secondary" data-close>Continuar escolhendo</button><button class="primary" data-checkout>Informar meus dados →</button></div>`);
}
function checkout(){
  const cart=getCart();if(!cart.length)return showCart();
  const total=cartTotal(cart);
  const lines=cart.map(item=>{const product=productById(item.id);return `<div class="cartline"><span>${item.qty} × ${escapeHtml(product?.name||'Produto')} · ${escapeHtml(displayOption(product))} · ${escapeHtml(item.size)} <small>(cód. ${escapeHtml(product?.sku||product?.id)})</small></span><b>${product?.price==null?'A confirmar':money(item.qty*product.price)}</b></div>`;}).join('');
  const totalText=total==null?'Confirmaremos preço e disponibilidade pelo WhatsApp antes do Pix.':`Total ${money(total)}. O Pix será combinado pelo WhatsApp.`;
  openModal(`<button class="close" data-cart aria-label="Voltar ao carrinho">←</button><div class="eyebrow">Quase lá · confira seu pedido</div><h2>Seus dados</h2><p class="modal-sub">${totalText} As peças só entram na meta depois que o pagamento for confirmado.</p>${lines}<div class="total"><span>${total==null?'Valor final':'Total'}</span><span>${total==null?'A confirmar':money(total)}</span></div><label class="field" for="customer">Seu nome</label><input class="input" id="customer" maxlength="80" placeholder="Como podemos te chamar?"><label class="field" for="phone">WhatsApp com DDD</label><input class="input" id="phone" maxlength="24" placeholder="(11) 99999-9999" inputmode="tel"><label class="field" for="nickname">Vulgo (opcional)</label><input class="input" id="nickname" maxlength="60" placeholder="Como te chamam na tropa?"><div style="height:18px"></div><button class="primary" data-submit-order>Enviar pedido pro drop</button><p class="modal-sub" style="margin:12px 0 0">O organizador fala com você pelo WhatsApp para confirmar tamanho, disponibilidade e valor.</p>`);
}
async function submitOrder(button){
  const cart=getCart(); const name=$('#customer').value.trim(); const phoneDigits=$('#phone').value.replace(/\D/g,'');const phone=phoneDigits.length===13&&phoneDigits.startsWith('55')?phoneDigits.slice(2):phoneDigits;
  if(name.length<2||name.length>80||phone.length<10||phone.length>11){showToast('Preencha seu nome e um WhatsApp válido com DDD.');return;}
  button.disabled=true; button.textContent='Enviando…';
  try{
    const {order}=await request('/api/orders',{method:'POST',body:JSON.stringify({name,phone,nickname:$('#nickname').value.trim(),items:cart})});
    setCart([]); await loadStore();
    const quote=order.status==='Cotação';
    openModal(`<div class="eyebrow">Pedido recebido · ${escapeHtml(order.id.slice(0,8).toUpperCase())}</div><h2>Fechou, ${escapeHtml(name.split(' ')[0])}.</h2><p class="modal-sub">${quote?'Sua lista chegou. O organizador confirma tamanho, disponibilidade e valor pelo WhatsApp; o Pix vem depois.':'Seu pedido está registrado. O organizador vai falar com você pelo WhatsApp. As peças entram na barra quando o pagamento for confirmado.'}</p><button class="primary" data-close>Voltar pra vitrine</button>`);
  }catch(error){button.disabled=false;button.textContent='Enviar pedido pro drop';showToast(error.message);}
}

function renderAdmin(){
  const active=orders.filter(order=>order.status!=='Cancelado');
  $('#statOrders').textContent=orders.length;
  $('#statValue').textContent=money(active.reduce((sum,order)=>sum+(Number(order.total)||0),0));
  if(!orders.length)$('#ordersTable').innerHTML='<div class="empty">Ainda não chegaram pedidos. O próximo aparece aqui em tempo real.</div>';
    else $('#ordersTable').innerHTML=`<table><thead><tr><th>Cliente</th><th>Itens</th><th>Total combinado</th><th>Data</th><th>Status</th><th>Ação</th></tr></thead><tbody>${orders.slice().reverse().map(order=>`<tr><td><b>${escapeHtml(order.name)}</b><br>${escapeHtml(order.phone)}${order.nickname?' · '+escapeHtml(order.nickname):''}</td><td>${order.items.map(item=>`${item.qty}× ${escapeHtml(item.name)} / ${escapeHtml(item.size)}${storeState.unavailable.includes(item.id)?' ⚠ indisponível':''} <small>(cód. ${escapeHtml(item.sku)})</small>`).join('<br>')}</td><td>${order.total==null?`<small>Preço a confirmar</small><br><input class="quote-input" data-quote-input="${escapeHtml(order.id)}" type="number" min="0.01" step="0.01" placeholder="R$ total"><br><button class="rowaction" data-quote="${escapeHtml(order.id)}">Salvar valor combinado</button>`:money(order.total)}</td><td>${new Date(order.createdAt).toLocaleString('pt-BR')}</td><td><span class="status ${order.status==='Cotação'?'Cotacao':escapeHtml(order.status)}">${order.status==='Cotação'?'Cotação pendente':order.status==='Aguardando'?'Aguardando Pix':escapeHtml(order.status)}</span></td><td>${order.status==='Aguardando'?`<button class="rowaction" data-status="Pago" data-order="${escapeHtml(order.id)}">Confirmar Pix recebido</button><br>`:''}${order.status!=='Cancelado'?`<button class="rowaction" data-whatsapp="${escapeHtml(order.phone)}" data-name="${escapeHtml(order.name)}" data-status="${escapeHtml(order.status)}">WhatsApp ↗</button><br><button class="rowaction" data-status="Cancelado" data-order="${escapeHtml(order.id)}">Cancelar pedido</button>`:''}</td></tr>`).join('')}</tbody></table>`;
  const term=adminProductSearch.toLocaleLowerCase('pt-BR');
  const matchedProducts=storeState.products.filter(product=>!term||`${product.name} ${product.sku} ${product.id}`.toLocaleLowerCase('pt-BR').includes(term));
  const visibleProducts=term?matchedProducts.slice(0,50):matchedProducts.slice(0,25);
  $('#productsTable').innerHTML=`<div class="catalog-admin-count">${matchedProducts.length} produto${matchedProducts.length===1?'':'s'}${term?' encontrado'+(matchedProducts.length===1?'':'s'):' · mostro os 25 primeiros; use a busca para localizar outro'}</div><table><thead><tr><th>Produto / código</th><th>Tamanhos sugeridos</th><th>Vitrine</th><th>Ação</th></tr></thead><tbody>${visibleProducts.map(product=>{const available=!storeState.unavailable.includes(product.id);return `<tr><td><b>${escapeHtml(product.name)}</b><br><small>Cód. ${escapeHtml(product.sku||product.id)}</small></td><td>${product.sizes.map(escapeHtml).join(', ')}</td><td>${available?'Disponível':'Indisponível'}</td><td><button class="rowaction" data-availability="${available?'off':'on'}" data-product="${escapeHtml(product.id)}">${available?'Marcar indisponível':'Reativar'}</button></td></tr>`;}).join('')||'<tr><td colspan="4">Nenhum produto encontrado.</td></tr>'}</tbody></table>`;
  const closed=Boolean(storeState.closed);$('#finalizeDrop').hidden=closed;$('#openNextDrop').hidden=!closed;
  $('#finalizeDrop').textContent=`Finalizar e baixar Drop ${String(storeState.dropNumber||1).padStart(2,'0')}`;
}
async function showAdmin(){
  $('#store').style.display='none';$('#admin').classList.add('visible');window.scrollTo(0,0);
  try{const session=await request('/api/admin/session');$('#admin').classList.toggle('authenticated',session.authenticated);if(session.authenticated){await loadStore();await loadAdmin();}}
  catch{$('#admin').classList.remove('authenticated');}
}
function showStore(){ $('#admin').classList.remove('visible','authenticated'); $('#store').style.display='block'; window.scrollTo(0,0); }
async function loginAdmin(event){
  event.preventDefault();const error=$('#loginError'),button=$('#loginForm button[type="submit"]');error.textContent='';button.disabled=true;button.textContent='Entrando…';
  try{await request('/api/admin/login',{method:'POST',body:JSON.stringify({username:$('#adminUsername').value.trim(),password:$('#adminPassword').value})});$('#adminPassword').value='';$('#admin').classList.add('authenticated');await loadStore();await loadAdmin();}
  catch(e){error.textContent=e.message;}
  finally{button.disabled=false;button.textContent='Entrar no painel';}
}
async function finalizeDrop(){
  if(!confirm(`Finalizar o Drop ${String(storeState.dropNumber||1).padStart(2,'0')} e baixar o arquivo com os pedidos? Depois disso, novos pedidos ficam pausados.`))return;
  const button=$('#finalizeDrop');button.disabled=true;button.textContent='Preparando arquivo…';
  try{const response=await fetch('/api/admin/finalize',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});if(!response.ok){const result=await response.json();throw new Error(result.error||'Não foi possível finalizar.');}const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`drop-${String(storeState.dropNumber||1).padStart(2,'0')}.csv`;document.body.append(a);a.click();a.remove();URL.revokeObjectURL(url);await loadStore();await loadAdmin();showToast('Drop finalizado. Arquivo baixado.');}
  catch(e){showToast(e.message);}
  finally{button.disabled=false;button.textContent=`Finalizar e baixar Drop ${String(storeState.dropNumber||1).padStart(2,'0')}`;}
}
async function openNextDrop(){try{await request('/api/admin/open-next',{method:'POST',body:'{}'});await loadStore();await loadAdmin();showToast('O próximo drop foi aberto.');}catch(e){showToast(e.message);}}

document.addEventListener('click',async(event)=>{
  const target=event.target.closest('button'); if(!target)return;
  if(target.matches('[data-filter]')){selectedFilter=target.dataset.filter;catalogPage=1;document.querySelectorAll('[data-filter]').forEach(button=>button.classList.toggle('active',button===target));renderStore();}
  else if(target.matches('[data-page]')){catalogPage=Math.max(1,Number(target.dataset.page));renderStore();$('#catalogo').scrollIntoView({behavior:'smooth',block:'start'});}
  else if(target.matches('[data-gallery-step]'))changeGallery(target);
  else if(target.matches('[data-color-product]'))startAdd(target.dataset.colorProduct.split(','),target.dataset.selected);
  else if(target.matches('[data-add]'))startAdd(target.dataset.add.split(','));
  else if(target.matches('[data-add-confirm]'))addSelectedProduct(target.dataset.addConfirm);
  else if(target.matches('[data-qty]'))$('#qty').textContent=Math.max(1,Math.min(25,Number($('#qty').textContent)+Number(target.dataset.qty)));
  else if(target.matches('[data-close]'))closeModal();
  else if(target.matches('[data-cart]'))showCart();
  else if(target.matches('[data-checkout]'))checkout();
  else if(target.matches('[data-remove]')){const cart=getCart();cart.splice(Number(target.dataset.remove),1);setCart(cart);showCart();}
  else if(target.matches('[data-submit-order]'))await submitOrder(target);
  else if(target.matches('[data-quote]')){const input=document.querySelector(`[data-quote-input="${CSS.escape(target.dataset.quote)}"]`),total=Number(input?.value);if(!Number.isFinite(total)||total<=0){showToast('Informe o valor total combinado pelo WhatsApp.');return;}target.disabled=true;try{await request(`/api/admin/orders/${encodeURIComponent(target.dataset.quote)}`,{method:'PATCH',body:JSON.stringify({status:'Aguardando',total})});await loadAdmin();await loadStore();showToast('Valor salvo. O pedido aguarda o Pix.');}catch(error){target.disabled=false;showToast(error.message);}}
  else if(target.matches('[data-status]')){target.disabled=true;try{await request(`/api/admin/orders/${encodeURIComponent(target.dataset.order)}`,{method:'PATCH',body:JSON.stringify({status:target.dataset.status})});await loadAdmin();await loadStore();}catch(error){target.disabled=false;showToast(error.message);}}
  else if(target.matches('[data-availability]')){target.disabled=true;try{await request('/api/admin/availability',{method:'PATCH',body:JSON.stringify({productId:target.dataset.product,available:target.dataset.availability==='on'})});await loadStore();await loadAdmin();}catch(error){target.disabled=false;showToast(error.message);}}
  else if(target.matches('[data-whatsapp]')){const message=target.dataset.status==='Cotação'?`Oi ${target.dataset.name}! Recebi seu pedido no Tropa dos Pedidos. Estou confirmando os tamanhos e valores e já te retorno antes do Pix.`:`Oi ${target.dataset.name}! Sobre seu pedido no Tropa dos Pedidos:`;window.open(`https://wa.me/55${target.dataset.whatsapp.replace(/\D/g,'')}?text=${encodeURIComponent(message)}`,'_blank','noopener');}
});
$('#cartToggle').addEventListener('click',showCart);
$('#adminToggle').addEventListener('click',showAdmin);
$('#backStore').addEventListener('click',showStore);
$('#loginForm').addEventListener('submit',loginAdmin);
$('#logoutAdmin').addEventListener('click',async()=>{try{await request('/api/admin/logout',{method:'POST',body:'{}'});}catch{}showStore();showToast('Você saiu do painel.');});
$('#finalizeDrop').addEventListener('click',finalizeDrop);
$('#openNextDrop').addEventListener('click',openNextDrop);
$('#shareDrop').addEventListener('click',shareDrop);
$('#catalogSearch').addEventListener('input',()=>{catalogPage=1;renderStore();});
document.addEventListener('change',event=>{if(event.target.id==='colorSelect')changeModalColor(event.target.value);});
document.addEventListener('error',event=>{const image=event.target;if(!image.matches?.('.gallery-image'))return;const gallery=image.closest('[data-gallery]');if(!gallery||gallery.dataset.index!=='1')return;image.src=gallery.dataset.front;gallery.dataset.index='0';gallery.classList.add('no-second-photo');gallery.querySelector('.gallery-count').textContent='FOTO 1';gallery.querySelector('[data-gallery-step="-1"]').disabled=true;gallery.querySelector('[data-gallery-step="1"]').hidden=true;},true);
$('#productLinkForm').addEventListener('submit',event=>{
  event.preventDefault();const input=$('#productLink'),raw=input.value.trim();
  try{const url=new URL(raw);if(!['chronic420.com.br','www.chronic420.com.br'].includes(url.hostname)||!url.pathname.endsWith('/p'))throw new Error();const product=storeState.products.find(item=>{try{return new URL(item.url).pathname===url.pathname;}catch{return false;}});if(!product)throw new Error();selectedFilter='Tudo';$('#catalogSearch').value=product.sku||product.name;catalogPage=1;document.querySelectorAll('[data-filter]').forEach(button=>button.classList.toggle('active',button.dataset.filter==='Tudo'));renderStore();input.value='';startAdd(product.id);}
  catch{showToast('Não encontrei esse link no catálogo Chronic carregado. Confira se é a página de um produto.');}
});
$('#adminProductSearch').addEventListener('input',event=>{adminProductSearch=event.target.value;renderAdmin();});
$('#overlay').addEventListener('click',event=>{if(event.target.id==='overlay')closeModal();});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeModal();});

loadStore();
connectLiveUpdates();
