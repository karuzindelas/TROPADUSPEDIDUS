import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { getStore } from '@netlify/blobs';
import products from '../../data/products.json' with { type: 'json' };
import adminAuth from '../../data/admin-auth.json' with { type: 'json' };

const scryptAsync = promisify(scrypt);
const store = getStore({ name: 'tropa-dos-pedidos', consistency: 'strong' });
const initialState = { goal: 24, orders: [], unavailable: [], closed: false, dropNumber: 2, loginAttempts: {} };
const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin' };
const json = (status, payload, extra = {}) => new Response(JSON.stringify(payload), { status, headers: { ...headers, ...extra } });
const safeProducts = products.map(({ sourcePage, sizeSource, ...product }) => product);

async function readState() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await store.get('state', { type: 'json', consistency: 'strong' });
    if (current) return { ...structuredClone(initialState), ...current };
    await store.setJSON('state', initialState, { onlyIfNew: true });
  }
  throw new Error('Não foi possível inicializar os dados persistentes.');
}

async function changeState(mutator) {
  for (let attempt = 0; attempt < 12; attempt++) {
    let current = await store.getWithMetadata('state', { type: 'json', consistency: 'strong' });
    if (!current) {
      await store.setJSON('state', initialState, { onlyIfNew: true });
      continue;
    }
    const draft = { ...structuredClone(initialState), ...current.data };
    const result = await mutator(draft);
    if (result?.response) return result.response;
    const saved = await store.setJSON('state', draft, { onlyIfMatch: current.etag });
    if (saved.modified) return result;
  }
  return { response: json(409, { error: 'O drop recebeu outra atualização ao mesmo tempo. Tente novamente.' }) };
}

async function body(req) {
  const text = await req.text();
  if (text.length > 100_000) throw Object.assign(new Error('Corpo da requisição muito grande.'), { status: 413 });
  try { return text ? JSON.parse(text) : {}; }
  catch { throw Object.assign(new Error('O pedido contém dados inválidos.'), { status: 400 }); }
}
function cookie(req, value, maxAge) {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `tropa_admin=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}
function validAdmin(req) {
  const token = (req.headers.get('cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith('tropa_admin='))?.slice('tropa_admin='.length) || '';
  const [expires, nonce, signature] = token.split('.');
  if (!/^\d+$/.test(expires || '') || Number(expires) < Date.now() || !nonce || !signature) return false;
  const expected = createHmac('sha256', adminAuth.hash).update(`${expires}.${nonce}`).digest();
  let actual;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return false; }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function makeSession() {
  const expires = String(Date.now() + 12 * 60 * 60 * 1000);
  const nonce = randomBytes(20).toString('base64url');
  const signature = createHmac('sha256', adminAuth.hash).update(`${expires}.${nonce}`).digest('base64url');
  return `${expires}.${nonce}.${signature}`;
}
function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
function csvNumber(value) { return value == null ? '' : Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function productColor(name) {
  const match = String(name || '').match(/\b(PRETO|PRETA|BRANCO|BRANCA|MARINHO|AZUL|VERDE|CINZA|BEGE|MARROM|VERMELHO|VERMELHA|VINHO|ROSA|AMARELO|AMARELA|LARANJA|ROXO|ROXA|MESCLA|COLORIDO|COLORIDA|BLACK|WHITE|GREEN|NAVY|BLUE|GREY|GRAY|RED|YELLOW|PINK|BEIGE|BROWN|CAMO)\b/i)?.[0];
  const translation = { BLACK: 'Preto', WHITE: 'Branco', GREEN: 'Verde', NAVY: 'Marinho', BLUE: 'Azul', GREY: 'Cinza', GRAY: 'Cinza', RED: 'Vermelho', YELLOW: 'Amarelo', PINK: 'Rosa', BEIGE: 'Bege', BROWN: 'Marrom', CAMO: 'Camuflado' }[match?.toUpperCase()] || match;
  return translation ? translation[0].toLocaleUpperCase('pt-BR') + translation.slice(1).toLocaleLowerCase('pt-BR') : 'Conforme foto';
}
function dropCsv(state) {
  const rows = [['Drop', String(state.dropNumber).padStart(2, '0')], ['Gerado em', new Date().toLocaleString('pt-BR')], [], ['Cliente', 'WhatsApp', 'Código', 'Produto', 'Cor', 'Tamanho solicitado', 'Quantidade', 'Preço unitário', 'Subtotal do item', 'Total combinado do pedido', 'Status', 'Data do pedido']];
  for (const order of state.orders) for (const item of order.items) rows.push([order.name, order.phone, item.sku || item.id, item.name, item.color || productColor(item.name), item.size, item.qty, csvNumber(item.unitPrice), csvNumber(item.unitPrice == null ? null : item.unitPrice * item.qty), csvNumber(order.total), order.status, new Date(order.createdAt).toLocaleString('pt-BR')]);
  return '\ufeff' + rows.map(row => row.map(csvCell).join(';')).join('\r\n');
}

export default async (req) => {
  try {
    const url = new URL(req.url);
    const route = url.pathname;
    if (req.method === 'GET' && route === '/api/health') return json(200, { ok: true, service: 'tropa-dos-pedidos' });
    if (req.method === 'GET' && route === '/api/public') {
      const state = await readState();
      const paidPieces = state.orders.filter(order => order.status === 'Pago').reduce((sum, order) => sum + order.items.reduce((count, item) => count + item.qty, 0), 0);
      return json(200, { goal: state.goal, dropNumber: state.dropNumber, closed: state.closed, products: safeProducts, unavailable: state.unavailable, paidPieces });
    }
    if (req.method === 'GET' && route === '/api/admin/session') return json(200, { authenticated: validAdmin(req) });
    if (req.method === 'POST' && route === '/api/admin/login') {
      const input = await body(req);
      const username = String(input.username || '').trim();
      const password = String(input.password || '');
      const remote = req.headers.get('x-nf-client-connection-ip') || 'unknown';
      const ipKey = createHash('sha256').update(remote).digest('hex').slice(0, 24);
      const state = await readState();
      const attempt = state.loginAttempts[ipKey] || { count: 0, until: 0 };
      if (attempt.until > Date.now() && attempt.count >= 8) return json(429, { error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' });
      const actual = Buffer.from(await scryptAsync(password, adminAuth.salt, 64, { N: 16384, r: 8, p: 1 }));
      const expected = Buffer.from(adminAuth.hash, 'hex');
      if (username !== adminAuth.username || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        await changeState(draft => {
          const previous = draft.loginAttempts[ipKey];
          const next = previous?.until > Date.now() ? previous : { count: 0, until: Date.now() + 15 * 60 * 1000 };
          next.count++;
          draft.loginAttempts[ipKey] = next;
          return { ok: true };
        });
        return json(401, { error: 'Usuário ou senha incorretos.' });
      }
      await changeState(draft => { delete draft.loginAttempts[ipKey]; return { ok: true }; });
      return json(200, { ok: true }, { 'set-cookie': cookie(req, makeSession(), 43200) });
    }
    if (route.startsWith('/api/admin/') && !validAdmin(req)) return json(401, { error: 'Entre na área do organizador novamente.' });
    if (req.method === 'POST' && route === '/api/admin/logout') return json(200, { ok: true }, { 'set-cookie': cookie(req, '', 0) });
    if (req.method === 'GET' && route === '/api/admin/orders') { const state = await readState(); return json(200, { orders: state.orders }); }
    if (req.method === 'POST' && route === '/api/orders') {
      const input = await body(req);
      const name = String(input.name || '').trim();
      const incomingPhone = String(input.phone || '').replace(/\D/g, '');
      const phone = incomingPhone.length === 13 && incomingPhone.startsWith('55') ? incomingPhone.slice(2) : incomingPhone;
      if (name.length < 2 || name.length > 80 || phone.length < 10 || phone.length > 11 || !Array.isArray(input.items) || !input.items.length || input.items.length > 25) return json(400, { error: 'Confira nome, WhatsApp e pedido (máximo de 25 opções).' });
      const items = [];
      let total = 0; let needsQuote = false;
      for (const item of input.items) {
        const product = products.find(entry => entry.id === String(item.id));
        const qty = Number(item.qty); const size = String(item.size || '').trim();
        if (!product || !product.sizes.includes(size) || !Number.isInteger(qty) || qty < 1 || qty > 25) return json(400, { error: 'Confira produto, tamanho e quantidade.' });
        const unitPrice = Number.isFinite(product.price) && product.price > 0 ? product.price : null;
        if (unitPrice == null) needsQuote = true; else total += unitPrice * qty;
        items.push({ id: product.id, name: product.name, sku: product.sku || product.id, color: productColor(product.name), size, qty, unitPrice });
      }
      const result = await changeState(state => {
        if (state.closed) return { response: json(409, { error: 'Este drop já foi encerrado. Aguarde a abertura do próximo.' }) };
        if (items.some(item => state.unavailable.includes(item.id))) return { response: json(409, { error: 'Uma peça não está mais disponível. Atualize o pedido.' }) };
        const order = { id: randomUUID(), name, phone, nickname: String(input.nickname || '').trim().slice(0, 60), items, total: needsQuote ? null : total, status: needsQuote ? 'Cotação' : 'Aguardando', createdAt: new Date().toISOString() };
        state.orders.push(order);
        return { order };
      });
      if (result instanceof Response) return result;
      if (result?.response instanceof Response) return result.response;
      return json(201, { order: result.order });
    }
    const orderMatch = route.match(/^\/api\/admin\/orders\/([\w-]+)$/);
    if (req.method === 'PATCH' && orderMatch) {
      const input = await body(req);
      if (!['Pago', 'Cancelado', 'Aguardando'].includes(input.status)) return json(400, { error: 'Status inválido.' });
      const result = await changeState(state => {
        const order = state.orders.find(entry => entry.id === orderMatch[1]);
        if (!order) return { response: json(404, { error: 'Pedido não encontrado.' }) };
        if (input.total !== undefined) { const total = Number(input.total); if (!Number.isFinite(total) || total <= 0 || total > 10_000_000) return { response: json(400, { error: 'Informe um total combinado válido.' }) }; order.total = Number(total.toFixed(2)); }
        if (['Aguardando', 'Pago'].includes(input.status) && (!Number.isFinite(order.total) || order.total <= 0)) return { response: json(400, { error: 'Registre primeiro o valor combinado no WhatsApp.' }) };
        order.status = input.status;
        return { order };
      });
      if (result?.response instanceof Response) return result.response;
      return json(200, { order: result.order });
    }
    if (req.method === 'PATCH' && route === '/api/admin/availability') {
      const input = await body(req);
      const result = await changeState(state => {
        const product = products.find(entry => entry.id === String(input.productId));
        if (!product) return { response: json(404, { error: 'Produto não encontrado.' }) };
        state.unavailable = input.available ? state.unavailable.filter(id => id !== product.id) : [...new Set([...state.unavailable, product.id])];
        return { unavailable: state.unavailable };
      });
      if (result?.response instanceof Response) return result.response;
      return json(200, { unavailable: result.unavailable });
    }
    if (req.method === 'POST' && route === '/api/admin/finalize') {
      const result = await changeState(state => {
        if (state.closed) return { response: json(409, { error: 'Este drop já foi encerrado.' }) };
        const csv = dropCsv(state);
        state.closed = true; state.closedAt = new Date().toISOString();
        return { csv, dropNumber: state.dropNumber };
      });
      if (result?.response instanceof Response) return result.response;
      const drop = String(result.dropNumber).padStart(2, '0');
      return new Response(result.csv, { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="drop-${drop}.csv"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
    }
    if (req.method === 'POST' && route === '/api/admin/open-next') {
      const result = await changeState(state => {
        if (!state.closed) return { response: json(409, { error: 'Finalize o drop atual antes de abrir o próximo.' }) };
        state.goal = 24; state.orders = []; state.unavailable = []; state.closed = false; state.dropNumber++;
        return { dropNumber: state.dropNumber };
      });
      if (result?.response instanceof Response) return result.response;
      return json(200, { dropNumber: result.dropNumber });
    }
    return json(404, { error: 'Rota não encontrada.' });
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error(error);
    return json(status, { error: status === 413 || status === 400 ? error.message : 'Não foi possível concluir. Tente novamente.' });
  }
};

export const config = { path: '/api/*' };
