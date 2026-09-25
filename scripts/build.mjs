import { cp, mkdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const publicDir = new URL('../public/', import.meta.url);
await mkdir(publicDir, { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js']) await cp(new URL(`../${file}`, import.meta.url), new URL(`../public/${file}`, import.meta.url));
await cp(new URL('../assets/tropa-dos-pedidos.png', import.meta.url), new URL('../public/assets/tropa-dos-pedidos.png', import.meta.url));
console.log('Vitrine estática preparada em public/.');
