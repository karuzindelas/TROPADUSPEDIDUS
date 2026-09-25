# Tropa dos Pedidos

## Abrir no computador

Com o Node.js instalado, abra um terminal nesta pasta e execute `node server.mjs`. A vitrine fica em `http://localhost:4173`. O painel do organizador é acessado pelo botão no topo.

## O que está funcionando

- A vitrine contém 828 produtos distintos da listagem pública da Chronic, com nome, foto, link e código. A captura percorreu 26 páginas em 25/09/2026; quatro entradas repetidas foram removidas.
- A identidade visual usa letras de tag, um emblema em estilo graffiti, textura urbana e uma barra de meta com brilho e efeito de fogo. O botão de compartilhamento abre o envio nativo do celular ou prepara uma mensagem para o WhatsApp.
- As peças com mais de uma imagem têm setas para alternar a foto principal e a seguinte. Produtos publicados separadamente por cor ou versão são agrupados quando o código e o nome indicam que pertencem ao mesmo modelo; cada opção continua ligada ao seu código Chronic.
- A busca inclui roupas e acessórios. O tipo e a cor são derivados do nome/código mostrado pela Chronic; quando não há cor escrita no catálogo, aparece “Conforme foto”.
- O cliente pesquisa por nome ou código, ou cola o link de um produto Chronic e abre a escolha de tamanho e quantidade.
- Como o preço de lojista e a grade exata não aparecem na página pública, os pedidos começam como cotação. O organizador confirma tamanho, estoque e valor no WhatsApp, registra o total no painel e então o pedido aguarda o Pix.
- Os pedidos ficam salvos no servidor e aparecem no painel após login.
- O organizador confirma Pix, acompanha as peças pagas e sinaliza produtos indisponíveis.
- A barra de 24 peças atualiza nos dispositivos conectados.
- Ao finalizar o drop, o painel baixa um CSV `drop-01.csv` com cliente, contato, código Chronic, produto, tamanho, quantidade, preço e status. Uma cópia também fica em `data/drops/`.
- Depois do fechamento, novos pedidos são pausados. O organizador pode abrir o próximo drop pelo painel.
- O painel usa sessão HttpOnly, limite de tentativas de login e senha guardada como hash salgado (não reversível), nunca como texto no HTML.

## O que ainda exige confirmação

Os preços de venda não foram preenchidos. Os tamanhos listados são sugestões por tipo de produto e precisam ser confirmados antes do Pix. O estoque também não é sincronizado com a Chronic; o organizador deve confirmar disponibilidade pelo WhatsApp.

## Hospedagem

O servidor inicia somente em `127.0.0.1` e não fica acessível pela internet. Para publicar, é necessário configurar hospedagem Node.js, HTTPS, domínio e variáveis/segredos no servidor; esta pasta não contém uma implantação pública. O Pix ainda é combinado manualmente pelo WhatsApp.
