# Painel do Dólar

A cotação do dólar **ao vivo**, contada numa página só. Um letreiro de casa de câmbio em 3D, com plaquinhas que viram (split-flap), fica preso na parede e acompanha a rolagem. Feito com **HTML, CSS e JavaScript puro**, sem etapa de build. As bibliotecas vêm por CDN: [Three.js](https://threejs.org) para o 3D e [GSAP](https://gsap.com) com ScrollTrigger para as animações.

## O que a página mostra

1. **Abertura:** o letreiro acende sob duas luminárias, com "DÓLAR" pintado na parede
2. **Cotação atual:** compra e venda com 4 casas, nas plaquinhas e em número grande
3. **Variação do dia:** o letreiro inclina como um ponteiro, para cima ou para baixo
4. **Máxima e mínima** do dia
5. **Histórico:** as últimas 30 cotações numa fita de papel, como as antigas máquinas de cotação. A linha é desenhada conforme a rolagem e dá pra passar o mouse, tocar ou usar as setas do teclado
6. **Conversor:** dólar para real e real para dólar, com o resultado impresso num comprovante
7. **Rodapé** com autoria e fonte dos dados

## Detalhes

- Atualiza sozinha a cada 60 segundos
- Se a API falhar, mostra a última cotação salva com o aviso "dados de [horário]"
- Som de "tlec" nas viradas, gerado com a Web Audio API (começa desligado)
- Respeita `prefers-reduced-motion`: sem animação de rolagem, os valores trocam direto
- Sem WebGL, aparece uma versão simples do letreiro
- Funciona no celular

## O que pratiquei

- Consumo de API com `fetch` e `async/await`, com tratamento de erro e cache em `localStorage`
- Cena 3D com Three.js: luzes, sombras e texturas desenhadas em `<canvas>` (metal escovado, desgaste, parafusos)
- Animação ligada à rolagem com GSAP ScrollTrigger e `gsap.matchMedia` (desktop, celular e movimento reduzido)
- Gráfico de linha em SVG feito à mão, sem biblioteca de gráficos
- Som sintetizado com a Web Audio API, sem arquivo de áudio
- Acessibilidade: textos para leitor de tela, navegação por teclado e movimento reduzido
- Formatação de moeda, porcentagem e datas com `Intl`

Dados da [AwesomeAPI](https://docs.awesomeapi.com.br/).
