// Painel do Dólar: versão "apresentação de produto".
// Um letreiro de casa de câmbio em 3D (Three.js), preso numa parede e iluminado por duas
// luminárias, fica fixo na tela e muda de posição e de conteúdo conforme o scroll (GSAP + ScrollTrigger).
// Dados da AwesomeAPI (grátis e sem chave): https://docs.awesomeapi.com.br/

const API_ATUAL = "https://economia.awesomeapi.com.br/json/last/USD-BRL";
const API_HISTORICO = "https://economia.awesomeapi.com.br/json/daily/USD-BRL/30";
const ATUALIZAR_A_CADA = 60000; // 1 minuto
const CHAVE_COTACAO = "painel-do-dolar:cotacao";
const CHAVE_HISTORICO = "painel-do-dolar:historico";

// Nome pintado no alto do letreiro. Troque pelo que quiser.
const NOME_DA_CASA = "CÂMBIO";

const $ = (seletor) => document.querySelector(seletor);

// Se a pessoa pediu menos movimento no sistema (ou o GSAP não carregou),
// nada se mexe com o scroll e as plaquinhas trocam de uma vez.
const pedeMenosMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const temGsap = typeof window.gsap !== "undefined";
const animar = temGsap && !pedeMenosMovimento;
if (temGsap && window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

// Cores (as mesmas do style.css)
const BRANCO = "#efebe3";
const AMBAR = "#f5b700";
const VERDE = "#34d17a";
const VERMELHO = "#ff5a4e";

// ================= Formatação =================

const virgula = (n, casas) => n.toFixed(casas).replace(".", ",");
const fmtReal = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const fmtCompacto = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const fmtDataHora = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const diaMes = (data) => String(data.getDate()).padStart(2, "0") + " " + MESES[data.getMonth()];
const hora = (data) => data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function textoPct(pct) {
  const sinal = pct > 0 ? "+" : pct < 0 ? "-" : "";
  return sinal + virgula(Math.abs(pct), 2) + "%";
}

const corDaVariacao = (pct) => (pct > 0 ? VERDE : pct < 0 ? VERMELHO : BRANCO);

// ================= Guardar no navegador =================
// Se a API cair, mostramos o último valor que deu certo (salvo no localStorage).

function guardar(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* modo privado: tudo bem */ }
}

function lerGuardado(chave) {
  try { return JSON.parse(localStorage.getItem(chave)); } catch { return null; }
}

// ================= Estado =================

let cotacao = lerGuardado(CHAVE_COTACAO); // { compra, venda, maxima, minima, variacao, momento }
let historico = lerGuardado(CHAVE_HISTORICO) || []; // [{ data (ms), valor }]
let aoVivo = false;
let variacaoHistorico = null;
let secaoAtual = "inicio";
let deRealPraDolar = false;
let textoResultado = "--";

// ================= Som do "tlec" (Web Audio, sem arquivo de áudio) =================

let somLigado = false;
let audio = null;
let ruidoCurto = null;
let inicioDoInstante = 0;
let tlecsNoInstante = 0;

function prepararAudio() {
  audio = new (window.AudioContext || window.webkitAudioContext)();
  const amostras = Math.floor(audio.sampleRate * 0.03);
  ruidoCurto = audio.createBuffer(1, amostras, audio.sampleRate);
  const dados = ruidoCurto.getChannelData(0);
  for (let i = 0; i < amostras; i++) {
    dados[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / amostras, 5); // forte no começo, some rápido
  }
}

function tocarTlec() {
  if (!somLigado || !audio) return;
  // No máximo 3 sons a cada 25 ms, senão vira chiado
  const agora = audio.currentTime;
  if (agora - inicioDoInstante > 0.025) {
    inicioDoInstante = agora;
    tlecsNoInstante = 0;
  }
  if (++tlecsNoInstante > 3) return;

  const fonte = audio.createBufferSource();
  fonte.buffer = ruidoCurto;
  fonte.playbackRate.value = 0.8 + Math.random() * 0.4;
  const filtro = audio.createBiquadFilter(); // só a faixa de "plástico batendo"
  filtro.type = "bandpass";
  filtro.frequency.value = 1800 + Math.random() * 1400;
  filtro.Q.value = 1.4;
  const volume = audio.createGain();
  volume.gain.value = 0.35 + Math.random() * 0.15;
  fonte.connect(filtro).connect(volume).connect(audio.destination);
  fonte.start();
}

function alternarSom() {
  somLigado = !somLigado;
  if (somLigado && !audio) prepararAudio();
  if (audio && audio.state === "suspended") audio.resume();
  $("#som").setAttribute("aria-pressed", String(somLigado));
  $("#som-estado").textContent = somLigado ? "ligado" : "desligado";
  tocarTlec();
}

// ================= Medidas do letreiro =================

// Ordem dos caracteres no rolo, como num letreiro de verdade
const ROLO = " 0123456789,.+-%/$:=ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MAX_VIRADAS = 7;

// Três grupos de plaquinhas, como numa casa de câmbio: MOEDA | COMPRA | VENDA.
// Compra e venda com 4 casas ("5,6418"), senão as duas aparecem iguais.
// A linha de baixo usa as mesmas 15 posições para recados ("AO VIVO 22:14").
const GRUPOS = [3, 6, 6];
const COLUNAS = 15;
const LINHAS = 2;

// Medidas em "unidades do mundo 3D"
const LARG_PLACA = 0.62;
const ALT_PLACA = 0.92;
const FOLGA = 0.06;
const FOLGA_GRUPO = 0.34;
const ENTRE_LINHAS = 0.16;
const MARGEM = 0.3;
const ALT_CABECALHO = 1.0;
const LARGURA_PLACAS = COLUNAS * LARG_PLACA + (COLUNAS - GRUPOS.length) * FOLGA + (GRUPOS.length - 1) * FOLGA_GRUPO;
const LARGURA_CARCACA = LARGURA_PLACAS + 2 * MARGEM;
const ALTURA_CARCACA = MARGEM + ALT_CABECALHO + 2 * ALT_PLACA + ENTRE_LINHAS + MARGEM;
const Z_PAREDE = -2.2;

// Posição x de cada coluna (com o espaço maior entre os grupos)
const XS = [];
{
  let x = -LARGURA_PLACAS / 2 + LARG_PLACA / 2;
  GRUPOS.forEach((quantas) => {
    for (let i = 0; i < quantas; i++) {
      XS.push(x);
      x += LARG_PLACA + FOLGA;
    }
    x += FOLGA_GRUPO - FOLGA;
  });
}
const Y_LINHA = [
  ALTURA_CARCACA / 2 - MARGEM - ALT_CABECALHO - ALT_PLACA / 2,
  ALTURA_CARCACA / 2 - MARGEM - ALT_CABECALHO - ALT_PLACA * 1.5 - ENTRE_LINHAS,
];

// "Aleatório" com semente: o mesmo número sempre dá o mesmo resultado entre 0 e 1.
// Assim os arranhões e os defeitos ficam iguais toda vez que a página abre.
function ruido(n) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function semAcento(texto) {
  return texto.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const centralizar = (texto) => {
  const t = semAcento(texto).slice(0, COLUNAS);
  const sobra = COLUNAS - t.length;
  return " ".repeat(Math.floor(sobra / 2)) + t + " ".repeat(Math.ceil(sobra / 2));
};

// A pose do letreiro: posição (frações da tela), escala, rotação,
// opacidade da palavra na parede e quanto ele age como "ponteiro".
// O GSAP anima este objeto com o scroll; o laço de desenho só lê os valores.
const pose = { x: 0, y: 0.06, s: 1, rx: 0.06, ry: -0.18, rz: 0, palavra: 1, ponteiro: 0 };

// ================= Texturas desenhadas em canvas =================

const FONTE_LETREIRO = 'condensed 800 140px "Archivo", "Arial Narrow", sans-serif';

// Atlas: todos os caracteres do rolo desenhados lado a lado numa imagem.
// Cada metade de plaquinha mostra um pedaço dela (coordenadas UV).
const CEL_L = 128;
const CEL_A = 192;
const POR_LINHA = 8;

function desenharAtlas() {
  const canvas = document.createElement("canvas");
  canvas.width = CEL_L * POR_LINHA;
  canvas.height = CEL_A * Math.ceil(ROLO.length / POR_LINHA);
  const ctx = canvas.getContext("2d");
  ctx.font = FONTE_LETREIRO;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  [...ROLO].forEach((caractere, i) => {
    const x = (i % POR_LINHA) * CEL_L;
    const y = Math.floor(i / POR_LINHA) * CEL_A;
    // Fundo da plaquinha: um pouco mais claro em cima (a luz vem de cima)
    const fundo = ctx.createLinearGradient(0, y, 0, y + CEL_A);
    fundo.addColorStop(0, "#262626");
    fundo.addColorStop(0.5, "#1b1b1b");
    fundo.addColorStop(0.5, "#141414");
    fundo.addColorStop(1, "#0e0e0e");
    ctx.fillStyle = fundo;
    ctx.fillRect(x, y, CEL_L, CEL_A);
    // Caractere em branco: a cor final vem do material (branco, âmbar, verde ou vermelho)
    ctx.fillStyle = "#ffffff";
    ctx.fillText(caractere, x + CEL_L / 2, y + CEL_A / 2 + 8);
  });
  return canvas;
}

// A frente da carcaça: metal escovado, arranhões, parafusos e as letras pintadas
function desenharFrente() {
  const k = 2048 / LARGURA_CARCACA; // pixels por unidade 3D
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = Math.round(ALTURA_CARCACA * k);
  const ctx = canvas.getContext("2d");
  const px = (x) => (x + LARGURA_CARCACA / 2) * k;
  const py = (y) => (ALTURA_CARCACA / 2 - y) * k;

  // Metal escuro, escovado na horizontal
  ctx.fillStyle = "#181818";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 1400; i++) {
    const y = ruido(i) * canvas.height;
    ctx.fillStyle = ruido(i + 0.5) > 0.5 ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.05)";
    ctx.fillRect(ruido(i + 0.2) * canvas.width - 200, y, 200 + ruido(i + 0.7) * 700, 1);
  }

  // Janela funda onde ficam as plaquinhas
  const topoJanela = py(Y_LINHA[0] + ALT_PLACA / 2 + 0.08);
  const baseJanela = py(Y_LINHA[1] - ALT_PLACA / 2 - 0.08);
  ctx.fillStyle = "#0b0b0b";
  ctx.fillRect(px(-LARGURA_PLACAS / 2 - 0.08), topoJanela, (LARGURA_PLACAS + 0.16) * k, baseJanela - topoJanela);

  // Sujeira acumulada embaixo (onde a poeira assenta)
  const sujeira = ctx.createLinearGradient(0, canvas.height * 0.8, 0, canvas.height);
  sujeira.addColorStop(0, "rgba(60, 45, 25, 0)");
  sujeira.addColorStop(1, "rgba(60, 45, 25, 0.35)");
  ctx.fillStyle = sujeira;
  ctx.fillRect(0, canvas.height * 0.8, canvas.width, canvas.height * 0.2);

  // Arranhões
  ctx.lineCap = "round";
  for (let i = 0; i < 46; i++) {
    const x = ruido(i * 3.1) * canvas.width;
    const y = ruido(i * 7.7) * canvas.height;
    const comprimento = 20 + ruido(i * 1.3) * 140;
    const angulo = (ruido(i * 5.9) - 0.5) * 1.2;
    ctx.strokeStyle = `rgba(255,255,255,${0.04 + ruido(i * 2.2) * 0.08})`;
    ctx.lineWidth = 1 + ruido(i * 4.4) * 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + comprimento / 2, y + comprimento * angulo * 0.6, x + comprimento, y + comprimento * angulo);
    ctx.stroke();
  }

  // Letras pintadas: num canvas separado, para depois "descascar" a tinta
  const tinta = document.createElement("canvas");
  tinta.width = canvas.width;
  tinta.height = canvas.height;
  const t = tinta.getContext("2d");
  t.fillStyle = "#e9dfc8";
  t.textBaseline = "alphabetic";
  t.font = `condensed 800 ${Math.round(0.52 * k)}px "Archivo", sans-serif`;
  const linhaNome = py(ALTURA_CARCACA / 2 - MARGEM - 0.48);
  t.fillText(NOME_DA_CASA, px(-LARGURA_PLACAS / 2), linhaNome);
  t.font = `condensed 700 ${Math.round(0.2 * k)}px "Archivo", sans-serif`;
  t.textAlign = "right";
  t.fillText("TAXAS DO DIA  ·  USD/BRL", px(LARGURA_PLACAS / 2), linhaNome);

  // Nomes das colunas em cima de cada grupo
  t.textAlign = "center";
  t.font = `condensed 700 ${Math.round(0.19 * k)}px "Archivo", sans-serif`;
  let coluna = 0;
  ["MOEDA", "COMPRA", "VENDA"].forEach((rotulo, g) => {
    const primeira = XS[coluna];
    const ultima = XS[coluna + GRUPOS[g] - 1];
    t.fillText(rotulo, px((primeira + ultima) / 2), py(Y_LINHA[0] + ALT_PLACA / 2 + 0.16));
    coluna += GRUPOS[g];
  });

  // Tinta gasta: apaga pontinhos e riscos das letras
  t.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 900; i++) {
    t.fillStyle = `rgba(0,0,0,${0.3 + ruido(i * 9.1) * 0.7})`;
    const raio = 1 + ruido(i * 3.3) * 4;
    t.beginPath();
    t.arc(ruido(i * 1.7) * canvas.width, ruido(i * 6.1) * canvas.height * 0.45, raio, 0, Math.PI * 2);
    t.fill();
  }
  ctx.drawImage(tinta, 0, 0);

  // Parafusos nos cantos e no meio de cima e de baixo
  const parafusos = [
    [-1, 1], [0, 1], [1, 1], [-1, -1], [0, -1], [1, -1],
  ].map(([sx, sy]) => [sx * (LARGURA_CARCACA / 2 - 0.13), sy * (ALTURA_CARCACA / 2 - 0.13)]);
  parafusos.forEach(([x, y], i) => {
    const cx = px(x);
    const cy = py(y);
    const r = 0.055 * k;
    const cabeca = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.1, cx, cy, r);
    cabeca.addColorStop(0, "#8a8781");
    cabeca.addColorStop(1, "#2c2b28");
    ctx.fillStyle = cabeca;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // fenda do parafuso, cada uma num ângulo
    const angulo = ruido(i * 2.7) * Math.PI;
    ctx.strokeStyle = "#141414";
    ctx.lineWidth = r * 0.28;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(angulo) * r * 0.7, cy - Math.sin(angulo) * r * 0.7);
    ctx.lineTo(cx + Math.cos(angulo) * r * 0.7, cy + Math.sin(angulo) * r * 0.7);
    ctx.stroke();
  });

  return canvas;
}

// A parede: reboco escuro com manchas
function desenharParede() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1e1d1b";
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = ruido(i) > 0.5 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.08)";
    ctx.fillRect(ruido(i * 1.9) * 512, ruido(i * 3.7) * 512, 1 + ruido(i * 5.3) * 2, 1 + ruido(i * 7.1) * 2);
  }
  for (let i = 0; i < 14; i++) {
    const x = ruido(i * 11.3) * 512;
    const y = ruido(i * 13.7) * 512;
    const mancha = ctx.createRadialGradient(x, y, 0, x, y, 40 + ruido(i) * 90);
    mancha.addColorStop(0, "rgba(0,0,0,0.12)");
    mancha.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = mancha;
    ctx.fillRect(0, 0, 512, 512);
  }
  return canvas;
}

// A palavra "DÓLAR" pintada bem apagada na parede
function desenharPalavra() {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 640;
  const ctx = canvas.getContext("2d");
  ctx.font = 'condensed 800 600px "Archivo", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("DÓLAR", 1024, 340);
  return canvas;
}

// ================= Letreiro 3D (Three.js) =================

async function criarLetreiro3D() {
  let THREE;
  try {
    THREE = await import("three");
  } catch {
    return null; // CDN fora do ar: usamos o letreiro simples
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: $("#cena"), antialias: true });
  } catch {
    return null; // navegador sem WebGL
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x0a0a0a);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Espera a fonte (no máximo 2,5 s), senão as texturas saem com a letra errada
  await Promise.race([
    document.fonts.load(FONTE_LETREIRO),
    new Promise((pronto) => setTimeout(pronto, 2500)),
  ]).catch(() => {});

  const texturaDe = (canvas) => {
    const textura = new THREE.CanvasTexture(canvas);
    textura.colorSpace = THREE.SRGBColorSpace;
    return textura;
  };

  // ----- Atlas e coordenadas UV -----
  const atlasCanvas = desenharAtlas();
  const atlas = texturaDe(atlasCanvas);
  atlas.generateMipmaps = false; // evita que um caractere "vaze" pro vizinho
  atlas.minFilter = THREE.LinearFilter;

  function uvDe(caractere, metade) {
    const i = Math.max(0, ROLO.indexOf(caractere));
    const x = (i % POR_LINHA) * CEL_L;
    const y = Math.floor(i / POR_LINHA) * CEL_A;
    const u0 = x / atlasCanvas.width;
    const u1 = (x + CEL_L) / atlasCanvas.width;
    const vTopo = 1 - y / atlasCanvas.height;
    const vBase = 1 - (y + CEL_A) / atlasCanvas.height;
    const vMeio = (vTopo + vBase) / 2;
    const [v1, v0] = metade === "topo" ? [vTopo, vMeio] : [vMeio, vBase];
    // Ordem dos vértices de um PlaneGeometry: cima-esq, cima-dir, baixo-esq, baixo-dir
    return [u0, v1, u1, v1, u0, v0, u1, v0];
  }

  function pintar(malha, caractere, metade) {
    const uv = malha.geometry.attributes.uv;
    uv.array.set(uvDe(caractere, metade));
    uv.needsUpdate = true;
  }

  // ----- Cena, câmera e parede -----
  const cena = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 12);

  const texturaParede = texturaDe(desenharParede());
  texturaParede.wrapS = texturaParede.wrapT = THREE.RepeatWrapping;
  texturaParede.repeat.set(8, 5);
  const parede = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 36),
    new THREE.MeshStandardMaterial({ map: texturaParede, roughness: 0.95, metalness: 0 })
  );
  parede.position.z = Z_PAREDE;
  parede.receiveShadow = true;
  cena.add(parede);

  const palavra = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 5),
    new THREE.MeshBasicMaterial({ map: texturaDe(desenharPalavra()), transparent: true, opacity: 0.06, depthWrite: false })
  );
  palavra.position.set(0, 0.3, Z_PAREDE + 0.01);
  cena.add(palavra);

  // Pouca luz ambiente: quem ilumina a cena são as luminárias do letreiro
  cena.add(new THREE.AmbientLight(0xffffff, 0.16));
  const luzDeFrente = new THREE.DirectionalLight(0xffffff, 0.3); // só pra as plaquinhas não sumirem
  luzDeFrente.position.set(0, 1, 6);
  cena.add(luzDeFrente);

  // ----- O letreiro -----
  const painel = new THREE.Group();
  cena.add(painel);

  const metalEscuro = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.5, metalness: 0.6 });
  const frente = new THREE.MeshStandardMaterial({ map: texturaDe(desenharFrente()), roughness: 0.65, metalness: 0.35 });
  // BoxGeometry tem 6 faces: +x, -x, +y, -y, +z (frente), -z
  const carcaca = new THREE.Mesh(
    new THREE.BoxGeometry(LARGURA_CARCACA, ALTURA_CARCACA, 0.36),
    [metalEscuro, metalEscuro, metalEscuro, metalEscuro, frente, metalEscuro]
  );
  carcaca.position.z = -0.2;
  carcaca.castShadow = true;
  painel.add(carcaca);

  // Fita de LED embaixo do letreiro: a cor muda por seção e pinta a parede
  const corLed = new THREE.Color(VERDE);
  const led = new THREE.Mesh(
    new THREE.BoxGeometry(LARGURA_CARCACA - 0.5, 0.05, 0.05),
    new THREE.MeshBasicMaterial({ color: corLed })
  );
  led.position.set(0, -ALTURA_CARCACA / 2 + 0.02, -0.02);
  painel.add(led);
  const luzLed = new THREE.PointLight(corLed, 6, 0, 2);
  luzLed.position.set(0, -ALTURA_CARCACA / 2 - 0.35, -0.4);
  painel.add(luzLed);

  // Duas luminárias em cima, cada uma com uma lâmpada de luz quente que faz sombra na parede
  const luminarias = [-1, 1].map((lado) => {
    const x = lado * LARGURA_CARCACA * 0.27;
    const topo = ALTURA_CARCACA / 2;
    const grupo = new THREE.Group();

    const haste = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.36, 0.05), metalEscuro);
    haste.position.set(x, topo + 0.18, -0.1);
    const braco = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.15), metalEscuro);
    braco.position.set(x, topo + 0.36, 0.45);
    const cupula = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.28, 0.3, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.4, metalness: 0.7, side: THREE.DoubleSide })
    );
    cupula.position.set(x, topo + 0.34, 1.02);
    cupula.rotation.x = 0.6; // a boca da cúpula aponta pra baixo e pra trás, para o letreiro
    const lampada = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffe2b0 }));
    lampada.position.set(x, topo + 0.3, 1.0);
    [haste, braco, cupula].forEach((m) => { m.castShadow = true; });
    grupo.add(haste, braco, cupula, lampada);

    const luz = new THREE.SpotLight(0xffd9a0, 20, 0, 0.85, 0.75, 2);
    luz.position.set(x, topo + 0.28, 1.0);
    luz.target.position.set(x, -0.4, 0);
    luz.castShadow = true;
    luz.shadow.mapSize.set(1024, 1024);
    luz.shadow.bias = -0.0004;
    luz.shadow.normalBias = 0.02;
    luz.shadow.camera.far = 20;
    grupo.add(luz, luz.target);

    painel.add(grupo);
    return luz;
  });

  // ----- Plaquinhas -----
  const material = (cor) => new THREE.MeshStandardMaterial({ map: atlas, color: cor, roughness: 0.55, metalness: 0.05 });
  const matMoeda = material(BRANCO);
  const matPreco = material(AMBAR);
  const matRecado = material(BRANCO);
  // Uma plaquinha foi trocada um dia e ficou de outra cor: plástico mais claro, letra mais apagada
  const matReposicao = material("#e2c37a");
  matReposicao.emissive = new THREE.Color("#141414");

  const placas = [];
  for (let linha = 0; linha < LINHAS; linha++) {
    const y = Y_LINHA[linha];
    placas.push([]);

    // O eixo (varinha preta) onde as plaquinhas da linha dobram
    const eixo = new THREE.Mesh(new THREE.BoxGeometry(LARGURA_PLACAS, 0.014, 0.012), new THREE.MeshStandardMaterial({ color: 0x050505 }));
    eixo.position.set(0, y, 0.012);
    painel.add(eixo);

    for (let coluna = 0; coluna < COLUNAS; coluna++) {
      let mat = matRecado;
      if (linha === 0) mat = coluna < GRUPOS[0] ? matMoeda : coluna === 12 ? matReposicao : matPreco;
      const metade = () => new THREE.PlaneGeometry(LARG_PLACA, ALT_PLACA / 2 - 0.006);

      const grupo = new THREE.Group();
      grupo.position.set(XS[coluna], y, (ruido(linha * 20 + coluna + 0.4) - 0.5) * 0.008);
      // Cada plaquinha fica um tiquinho torta, como num painel de verdade
      grupo.rotation.z = (ruido(linha * 20 + coluna) - 0.5) * 0.016;

      const topo = new THREE.Mesh(metade(), mat);
      topo.position.y = ALT_PLACA / 4 + 0.003;
      const base = new THREE.Mesh(metade(), mat);
      base.position.y = -ALT_PLACA / 4 - 0.003;

      // A aba que gira: na frente, a metade de cima do caractere antigo;
      // no verso, a metade de baixo do caractere novo
      const aba = new THREE.Group();
      aba.position.z = 0.005;
      aba.visible = false;
      const abaFrente = new THREE.Mesh(metade(), mat);
      abaFrente.position.y = ALT_PLACA / 4 + 0.003;
      const verso = new THREE.Mesh(metade(), mat);
      verso.position.y = ALT_PLACA / 4 + 0.003;
      verso.rotation.x = Math.PI;
      aba.add(abaFrente, verso);

      grupo.add(topo, base, aba);
      painel.add(grupo);

      const placa = { topo, base, aba, frente: abaFrente, verso, atual: " ", alvo: " ", girando: false };
      [topo, abaFrente, verso].forEach((m) => pintar(m, " ", "topo"));
      pintar(base, " ", "base");
      placas[linha].push(placa);
    }
  }

  // ----- Virar as plaquinhas -----

  // Uma virada: a aba de cima cai pra frente, bate e quica um pouco
  function virar(placa, novo) {
    return new Promise((pronto) => {
      pintar(placa.topo, novo, "topo");
      pintar(placa.frente, placa.atual, "topo");
      pintar(placa.verso, novo, "base");
      placa.aba.rotation.x = 0;
      placa.aba.visible = true;

      gsap.timeline({
        onComplete: () => {
          pintar(placa.base, novo, "base");
          placa.aba.visible = false;
          placa.atual = novo;
          pronto();
        },
      })
        .to(placa.aba.rotation, { x: Math.PI, duration: 0.13, ease: "power2.in" }) // cai acelerando
        .call(tocarTlec)
        .to(placa.aba.rotation, { x: Math.PI * 0.93, duration: 0.04, ease: "power1.out" }) // quica
        .to(placa.aba.rotation, { x: Math.PI, duration: 0.05, ease: "power1.in" });
    });
  }

  // Gira o rolo até chegar no caractere certo
  async function irPara(placa, alvo) {
    placa.alvo = alvo;
    if (placa.girando) return; // já está girando: ele para no alvo novo
    placa.girando = true;
    while (placa.atual !== placa.alvo) {
      const de = ROLO.indexOf(placa.atual);
      const para = ROLO.indexOf(placa.alvo);
      const distancia = (para - de + ROLO.length) % ROLO.length;
      let proximo;
      if (de < 0 || para < 0) proximo = placa.alvo;
      else if (distancia > MAX_VIRADAS) proximo = ROLO[(para - MAX_VIRADAS + 1 + ROLO.length) % ROLO.length];
      else proximo = ROLO[(de + 1) % ROLO.length];
      await virar(placa, proximo);
    }
    placa.girando = false;
  }

  function trocarDireto(placa, alvo) {
    if (placa.atual === alvo) return;
    pintar(placa.topo, alvo, "topo");
    pintar(placa.base, alvo, "base");
    placa.atual = placa.alvo = alvo;
    tocarTlec();
  }

  // ----- Tamanho e desenho -----
  let meiaAltura = 1;
  let meiaLargura = 1;
  let escalaBase = 1;

  function ajustarTamanho() {
    const largura = window.innerWidth;
    const altura = window.innerHeight;
    renderer.setSize(largura, altura, false);
    camera.aspect = largura / altura;
    camera.updateProjectionMatrix();
    // Quanto do mundo 3D aparece na tela, na distância do letreiro
    const tangente = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    meiaAltura = tangente * camera.position.z;
    meiaLargura = meiaAltura * camera.aspect;
    const fracaoDaLargura = largura <= 760 ? 0.9 : 0.56;
    escalaBase = Math.min(
      (meiaLargura * 2 * fracaoDaLargura) / LARGURA_CARCACA,
      (meiaAltura * 2 * 0.42) / ALTURA_CARCACA
    );
    // A palavra na parede ocupa quase a largura visível lá atrás
    const larguraNaParede = tangente * (camera.position.z - Z_PAREDE) * camera.aspect * 2;
    palavra.scale.setScalar((larguraNaParede * 0.95) / 16);
  }
  ajustarTamanho();
  window.addEventListener("resize", ajustarTamanho);

  let inclinacao = 0;

  function desenhar(tempo) {
    const escala = pose.s * escalaBase;
    painel.position.set(pose.x * meiaLargura, pose.y * meiaAltura, 0);
    painel.scale.setScalar(escala);

    // Na seção da variação, o letreiro inclina como um ponteiro: sobe se o dólar subiu
    const alvo = cotacao ? Math.max(-0.26, Math.min(0.26, cotacao.variacao * 0.16)) * pose.ponteiro : 0;
    inclinacao = animar ? inclinacao + (alvo - inclinacao) * 0.08 : alvo;
    const balanco = animar ? Math.sin(tempo / 2400) * 0.025 : 0; // respira bem devagar
    painel.rotation.set(pose.rx, pose.ry + balanco, pose.rz + inclinacao);

    // As lâmpadas ficam mais perto quando o letreiro diminui; compensamos a força delas
    luminarias.forEach((luz) => { luz.intensity = 20 * escala * escala; });
    palavra.material.opacity = 0.06 * pose.palavra;

    renderer.render(cena, camera);
    requestAnimationFrame(desenhar);
  }
  requestAnimationFrame(desenhar);

  document.body.classList.add("com-3d");

  return {
    escrever(linhas, corRecado) {
      linhas.forEach((texto, l) => {
        [...texto].forEach((caractere, c) => {
          const placa = placas[l][c];
          if (animar) setTimeout(() => irPara(placa, caractere), c * 45 + l * 30);
          else trocarDireto(placa, caractere);
        });
      });
      matRecado.color.set(corRecado);
    },
    corDaLuz(cor) {
      corLed.set(cor);
      luzLed.color.set(cor);
    },
  };
}

// Letreiro simples (sem WebGL): só texto
function criarLetreiroReserva() {
  $("#cena").hidden = true;
  $("#letreiro-reserva").hidden = false;
  return {
    escrever(linhas, corRecado) {
      $("#reserva-linha1").textContent = linhas[0];
      $("#reserva-linha2").textContent = linhas[1];
      $("#reserva-linha2").style.color = corRecado;
    },
    corDaLuz() {},
  };
}

// ================= O que o letreiro mostra em cada seção =================

// Cor da fita de LED embaixo do letreiro
const CORES_LED = {
  inicio: VERDE,
  cotacao: AMBAR,
  extremos: AMBAR,
  grafico: BRANCO,
  conversor: AMBAR,
  rodape: AMBAR,
};

function corDaSecao(id) {
  if (id === "variacao") return cotacao && cotacao.variacao < 0 ? VERMELHO : VERDE;
  return CORES_LED[id] || VERDE;
}

// Linha de cima: sempre a cotação, como numa casa de câmbio (MOEDA | COMPRA | VENDA)
function linhaDaCotacao() {
  const preco = (valor) => (cotacao ? virgula(valor, 4) : "--").padStart(6).slice(-6);
  return "USD" + preco(cotacao?.compra) + preco(cotacao?.venda);
}

// Linha de baixo: um recado que muda em cada seção
function recadoDaSecao() {
  if (!cotacao) return { texto: "CONECTANDO", cor: BRANCO };
  const quando = hora(new Date(cotacao.momento));
  switch (secaoAtual) {
    case "variacao":
      return { texto: "HOJE " + textoPct(cotacao.variacao), cor: corDaVariacao(cotacao.variacao) };
    case "extremos":
      return { texto: `${virgula(cotacao.minima, 2)} ATE ${virgula(cotacao.maxima, 2)}`, cor: BRANCO };
    case "grafico":
      return historico.length
        ? { texto: "DESDE " + diaMes(new Date(historico[0].data)), cor: BRANCO }
        : { texto: "SEM HISTORICO", cor: BRANCO };
    case "conversor":
      return { texto: `${deRealPraDolar ? "US$" : "R$"} ${textoResultado}`, cor: AMBAR };
    case "rodape":
      return { texto: "VOLTE SEMPRE", cor: AMBAR };
    default:
      return { texto: (aoVivo ? "AO VIVO " : "DADOS ") + quando, cor: aoVivo ? BRANCO : AMBAR };
  }
}

function atualizarLetreiro() {
  const recado = recadoDaSecao();
  letreiro.escrever([linhaDaCotacao(), centralizar(recado.texto)], recado.cor);
  const compra = cotacao ? `compra ${virgula(cotacao.compra, 4)}, venda ${virgula(cotacao.venda, 4)}` : "sem dados";
  $("#letreiro").setAttribute("aria-label", `Letreiro de câmbio: dólar, ${compra}. ${recado.texto}`);
}

function ativarSecao(id) {
  if (id === secaoAtual) return;
  secaoAtual = id;
  letreiro.corDaLuz(corDaSecao(id));
  atualizarLetreiro();
}

// ================= Buscar dados =================

async function buscarJSON(url) {
  const resposta = await fetch(url, { cache: "no-store" });
  if (!resposta.ok) throw new Error("Erro " + resposta.status);
  return resposta.json();
}

async function carregarCotacao() {
  try {
    const { USDBRL: usd } = await buscarJSON(API_ATUAL);
    const nova = {
      compra: parseFloat(usd.bid),
      venda: parseFloat(usd.ask),
      maxima: parseFloat(usd.high),
      minima: parseFloat(usd.low),
      variacao: parseFloat(usd.pctChange),
      momento: Date.now(),
    };
    if (!Number.isFinite(nova.compra)) throw new Error("Resposta sem valor");
    cotacao = nova;
    guardar(CHAVE_COTACAO, cotacao);
    aoVivo = true;
  } catch {
    aoVivo = false; // continua com o último valor salvo, se houver
  }
  mostrarStatus();
  mostrarCotacao();
}

async function carregarHistorico() {
  try {
    const dados = await buscarJSON(API_HISTORICO);
    historico = dados
      .map((dia) => ({ data: Number(dia.timestamp) * 1000, valor: parseFloat(dia.bid) }))
      .filter((dia) => Number.isFinite(dia.valor))
      .reverse(); // a API manda do mais novo pro mais antigo
    guardar(CHAVE_HISTORICO, historico);
  } catch {
    // fica com o histórico salvo (se houver)
  }
  desenharGrafico();
  mostrarResumoGrafico();
}

// "ao vivo" quando a API respondeu; "dados de 22:14" quando estamos mostrando o último valor salvo
function mostrarStatus() {
  const status = $("#status");
  status.classList.toggle("ao-vivo", aoVivo);
  if (aoVivo) {
    status.textContent = "ao vivo";
  } else if (cotacao) {
    const quando = new Date(cotacao.momento);
    const hoje = new Date().toDateString() === quando.toDateString();
    status.textContent = "dados de " + (hoje ? hora(quando) : `${diaMes(quando)}, ${hora(quando)}`);
  } else {
    status.textContent = "sem conexão";
  }
}

// ================= Mostrar nas seções =================

function mostrarCotacao() {
  if (!cotacao) return;

  $("#numero-cotacao").textContent = virgula(cotacao.compra, 2);
  $("#compra-venda").textContent =
    `Compra R$ ${virgula(cotacao.compra, 4)} · venda R$ ${virgula(cotacao.venda, 4)}`;

  const variacao = $("#numero-variacao");
  variacao.textContent = textoPct(cotacao.variacao);
  variacao.classList.toggle("sobe", cotacao.variacao > 0);
  variacao.classList.toggle("desce", cotacao.variacao < 0);
  $("#verbo-variacao").textContent =
    cotacao.variacao > 0 ? "subiu" : cotacao.variacao < 0 ? "caiu" : "ficou parado:";

  $("#numero-maxima").textContent = virgula(cotacao.maxima, 2);
  $("#numero-minima").textContent = virgula(cotacao.minima, 2);
  const centavos = Math.round((cotacao.maxima - cotacao.minima) * 100);
  $("#frase-extremos").textContent =
    `Entre uma e outra, ${centavos} ${centavos === 1 ? "centavo" : "centavos"} de diferença.`;

  if (secaoAtual === "variacao") letreiro.corDaLuz(corDaSecao("variacao"));
  atualizarConversor();
  atualizarLetreiro();
}

// ================= Gráfico na fita de papel (SVG) =================

let pontosGrafico = [];
let pontoMarcado = -1;

function desenharGrafico() {
  const svg = $("#grafico-svg");
  const largura = svg.clientWidth;
  const altura = svg.clientHeight;
  if (historico.length < 2 || !largura) return;

  // O viewBox tem o tamanho real do SVG, assim a linha não fica esticada
  svg.setAttribute("viewBox", `0 0 ${largura} ${altura}`);
  const valores = historico.map((d) => d.valor);
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const folga = (max - min) * 0.12 || 0.01;
  const baixo = min - folga;
  const alto = max + folga;

  pontosGrafico = historico.map((dia, i) => ({
    x: (i / (historico.length - 1)) * largura,
    y: altura - ((dia.valor - baixo) / (alto - baixo)) * altura,
    dia,
  }));
  $("#linha").setAttribute(
    "d",
    pontosGrafico.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")
  );

  const ultimo = pontosGrafico[pontosGrafico.length - 1];
  $("#ponto-final").setAttribute("cx", ultimo.x);
  $("#ponto-final").setAttribute("cy", ultimo.y);
  $("#fita-total").textContent = historico.length;
  $("#data-inicio").textContent = diaMes(new Date(historico[0].data));
  $("#data-fim").textContent = diaMes(new Date(ultimo.dia.data));
  svg.setAttribute(
    "aria-label",
    `Gráfico das últimas ${historico.length} cotações, entre R$ ${virgula(min, 2)} e R$ ${virgula(max, 2)}. ` +
    "Use as setas para ler cada dia."
  );
}

function mostrarResumoGrafico() {
  if (historico.length < 2) return;
  const primeiro = historico[0];
  const ultimo = historico[historico.length - 1];
  variacaoHistorico = (ultimo.valor / primeiro.valor - 1) * 100;
  const verbo = variacaoHistorico > 0 ? "subiu" : variacaoHistorico < 0 ? "caiu" : "ficou em";
  $("#frase-grafico").textContent =
    `Desde ${diaMes(new Date(primeiro.data))}, ele ${verbo} ${virgula(Math.abs(variacaoHistorico), 2)}%.`;
  if (secaoAtual === "grafico") atualizarLetreiro();
}

function marcarPonto(indice) {
  const ponto = $("#ponto");
  const dica = $("#dica");
  pontoMarcado = indice;
  if (indice < 0 || !pontosGrafico[indice]) {
    ponto.style.opacity = 0;
    dica.hidden = true;
    return;
  }
  const p = pontosGrafico[indice];
  ponto.setAttribute("cx", p.x);
  ponto.setAttribute("cy", p.y);
  ponto.style.opacity = 1;
  dica.textContent = `${diaMes(new Date(p.dia.data))} · R$ ${virgula(p.dia.valor, 4)}`;
  dica.hidden = false;
  const largura = $("#grafico-svg").clientWidth;
  const metade = dica.offsetWidth / 2;
  dica.style.left = Math.max(metade, Math.min(largura - metade, p.x)) + "px";
  dica.style.top = p.y - 14 + "px";
}

function apontarGrafico(evento) {
  if (!pontosGrafico.length) return;
  const caixa = $("#grafico-svg").getBoundingClientRect();
  const proporcao = (evento.clientX - caixa.left) / caixa.width;
  marcarPonto(Math.max(0, Math.min(pontosGrafico.length - 1, Math.round(proporcao * (pontosGrafico.length - 1)))));
}

function teclasGrafico(evento) {
  if (!pontosGrafico.length) return;
  const ultimo = pontosGrafico.length - 1;
  const atual = pontoMarcado < 0 ? ultimo : pontoMarcado;
  const mapa = { ArrowLeft: atual - 1, ArrowRight: atual + 1, Home: 0, End: ultimo };
  if (!(evento.key in mapa)) return;
  evento.preventDefault();
  marcarPonto(Math.max(0, Math.min(ultimo, mapa[evento.key])));
}

// ================= Conversor e comprovante =================

// Aceita "100", "250,50", "1.234,56" e "1234.56"
function lerQuantia() {
  let texto = $("#quantia").value.trim().replace(/\s/g, "");
  if (texto.includes(",")) texto = texto.replace(/\./g, "").replace(",", ".");
  const numero = Number(texto);
  return texto !== "" && Number.isFinite(numero) && numero >= 0 ? numero : null;
}

// O recado do letreiro tem 15 casas: números grandes perdem os centavos ou viram "1,2 MI"
function formatarParaLetreiro(valor) {
  if (valor < 100000) return fmtReal.format(valor);
  if (valor < 10000000) return fmtInteiro.format(valor);
  return fmtCompacto.format(valor);
}

function atualizarConversor() {
  const quantia = lerQuantia();
  const de = deRealPraDolar ? "R$" : "US$";
  const para = deRealPraDolar ? "US$" : "R$";

  $("#aviso-quantia").textContent = quantia === null ? "Digite um número, tipo 100 ou 250,50." : "";
  $("#comp-data").textContent = fmtDataHora.format(new Date());
  $("#comp-operacao").textContent = deRealPraDolar ? "real → dólar" : "dólar → real";

  if (quantia === null || !cotacao) {
    textoResultado = "--";
    $("#comp-valor").textContent = quantia === null ? "--" : `${de} ${fmtReal.format(quantia)}`;
    $("#comp-cotacao").textContent = "--";
    $("#comp-total").textContent = "--";
  } else {
    const valor = deRealPraDolar ? quantia / cotacao.compra : quantia * cotacao.compra;
    textoResultado = formatarParaLetreiro(valor);
    $("#comp-valor").textContent = `${de} ${fmtReal.format(quantia)}`;
    $("#comp-cotacao").textContent = `R$ ${virgula(cotacao.compra, 4)}`;
    $("#comp-total").textContent = `${para} ${fmtReal.format(valor)}`;
  }
  if (secaoAtual === "conversor") atualizarLetreiro();
}

function inverterConversor() {
  deRealPraDolar = !deRealPraDolar;
  $("#moeda-entrada").textContent = deRealPraDolar ? "R$" : "US$";
  $("#rotulo-quantia").textContent = deRealPraDolar ? "quantia em reais" : "quantia em dólares";
  $("#inverter").textContent = deRealPraDolar ? "trocar para dólares" : "trocar para reais";
  atualizarConversor();
}

// ================= Scroll: o letreiro muda de lugar em cada seção =================

// x e y são frações da metade da tela (-1 a 1), s é a escala.
// "palavra" é a opacidade do DÓLAR na parede; "ponteiro" liga a inclinação da variação.
const POSES_LARGA = {
  inicio:    { x: 0,     y: 0.06, s: 1,    rx: 0.06, ry: -0.16, rz: 0, palavra: 1, ponteiro: 0 },
  cotacao:   { x: 0.4,   y: 0.04, s: 0.78, rx: 0.04, ry: -0.42, rz: 0, palavra: 0, ponteiro: 0 },
  variacao:  { x: -0.36, y: 0.04, s: 0.7,  rx: 0.05, ry: 0.32,  rz: 0, palavra: 0, ponteiro: 1 },
  extremos:  { x: 0,     y: 0.5,  s: 0.66, rx: 0.32, ry: 0,     rz: 0, palavra: 0, ponteiro: 0 },
  grafico:   { x: 0.52,  y: 0.62, s: 0.46, rx: 0.1,  ry: -0.28, rz: 0, palavra: 0, ponteiro: 0 },
  conversor: { x: 0.42,  y: 0.6,  s: 0.52, rx: 0.08, ry: -0.3,  rz: 0, palavra: 0, ponteiro: 0 },
};

const POSES_ESTREITA = {
  inicio:    { x: 0, y: 0.16, s: 1,    rx: 0.1,  ry: -0.12, rz: 0, palavra: 1, ponteiro: 0 },
  cotacao:   { x: 0, y: 0.6,  s: 0.92, rx: 0.06, ry: -0.25, rz: 0, palavra: 0, ponteiro: 0 },
  variacao:  { x: 0, y: 0.6,  s: 0.88, rx: 0.08, ry: 0.3,   rz: 0, palavra: 0, ponteiro: 1 },
  extremos:  { x: 0, y: 0.62, s: 0.9,  rx: 0.3,  ry: 0,     rz: 0, palavra: 0, ponteiro: 0 },
  grafico:   { x: 0, y: 0.64, s: 0.82, rx: 0.1,  ry: -0.2,  rz: 0, palavra: 0, ponteiro: 0 },
  conversor: { x: 0, y: 0.64, s: 0.86, rx: 0.06, ry: -0.2,  rz: 0, palavra: 0, ponteiro: 0 },
};

// Com movimento reduzido o letreiro fica parado num canto (o ponteiro ainda funciona, sem animar)
const POSE_PARADA_LARGA = { x: 0.56, y: 0.64, s: 0.44, rx: 0.06, ry: -0.18, rz: 0, palavra: 0, ponteiro: 0 };
const POSE_PARADA_ESTREITA = { x: 0, y: 0.64, s: 0.82, rx: 0.06, ry: -0.12, rz: 0, palavra: 0, ponteiro: 0 };

function configurarScroll() {
  if (!temGsap || !window.ScrollTrigger) {
    Object.assign(pose, window.innerWidth <= 760 ? POSE_PARADA_ESTREITA : POSE_PARADA_LARGA);
    return;
  }

  // gsap.matchMedia refaz as animações quando a tela muda de tamanho (ou de preferência).
  // Ele só roda se pelo menos uma condição for verdadeira, por isso "larga" e "estreita" cobrem todas as telas.
  const mm = gsap.matchMedia();
  mm.add(
    {
      larga: "(min-width: 761px)",
      estreita: "(max-width: 760px)",
      reduzido: "(prefers-reduced-motion: reduce)",
    },
    (contexto) => {
      const { estreita, reduzido } = contexto.conditions;

      if (reduzido) {
        Object.assign(pose, estreita ? POSE_PARADA_ESTREITA : POSE_PARADA_LARGA);
        return;
      }

      const poses = estreita ? POSES_ESTREITA : POSES_LARGA;
      Object.assign(pose, poses.inicio);

      // Entre o começo de uma seção e o meio dela, o letreiro vai pra pose dessa seção.
      // "scrub" amarra a animação ao scroll: rolar pra trás desfaz.
      document.querySelectorAll("main [data-secao]").forEach((secao) => {
        const alvo = poses[secao.dataset.secao];
        if (!alvo || secao.dataset.secao === "inicio") return;
        gsap.to(pose, {
          ...alvo,
          ease: "none",
          immediateRender: false,
          scrollTrigger: { trigger: secao, start: "top bottom", end: "top 25%", scrub: 0.8 },
        });
      });

      // Entrada da página: o letreiro chega girando e assenta
      gsap.from(pose, { s: poses.inicio.s * 0.6, ry: -1.2, rx: 0.45, duration: 1.8, ease: "expo.out" });
      gsap.from(".inicio-texto > *", { y: 24, opacity: 0, duration: 1, ease: "power3.out", stagger: 0.12, delay: 0.5 });

      // Números grandes sobem por trás de uma "janela" (clip-path), como uma plaquinha
      gsap.utils.toArray(".numero-gigante, .numero-medio, .numero-variacao, .frase-titulo").forEach((el) => {
        gsap.fromTo(el,
          { clipPath: "inset(100% -10% -25% -10%)", yPercent: 22 },
          {
            clipPath: "inset(-25% -10% -25% -10%)", yPercent: 0, duration: 1.1, ease: "expo.out",
            scrollTrigger: { trigger: el, start: "top 88%", once: true },
            onComplete: () => gsap.set(el, { clearProps: "clipPath" }),
          });
      });

      // Frases curtas entram um pouco depois do número
      gsap.utils.toArray(".frase, .detalhe, .frase-variacao, .extremos .rotulo").forEach((el) => {
        gsap.from(el, {
          y: 20, opacity: 0, duration: 0.8, ease: "power3.out", delay: 0.15,
          scrollTrigger: { trigger: el, start: "top 92%", once: true },
        });
      });

      // A fita de papel "sai da máquina" enquanto a linha é impressa
      gsap.fromTo("#fita", { xPercent: 18 }, {
        xPercent: 0, ease: "none",
        scrollTrigger: { trigger: "#fita", start: "top 100%", end: "top 45%", scrub: 0.6 },
      });
      gsap.fromTo("#linha",
        { strokeDashoffset: 1000 },
        {
          strokeDashoffset: 0, ease: "none",
          scrollTrigger: {
            trigger: "#fita", start: "top 95%", end: "bottom 90%", scrub: 0.6,
            onUpdate: (st) => gsap.set("#ponto-final", { opacity: st.progress > 0.97 ? 1 : 0 }),
          },
        });

      // O comprovante é "impresso" de cima pra baixo quando aparece
      gsap.fromTo("#comprovante",
        { clipPath: "inset(0 0 100% 0)" },
        {
          clipPath: "inset(0 0 0% 0)", duration: 1.2, ease: "steps(14)",
          scrollTrigger: { trigger: "#comprovante", start: "top 85%", once: true },
          onComplete: () => gsap.set("#comprovante", { clearProps: "clipPath" }),
        });
    }
  );
}

// Descobre qual seção está no meio da tela
function observarSecoes() {
  const observador = new IntersectionObserver(
    (entradas) => entradas.forEach((e) => e.isIntersecting && ativarSecao(e.target.dataset.secao)),
    { rootMargin: "-50% 0px -49% 0px" }
  );
  document.querySelectorAll("[data-secao]").forEach((secao) => observador.observe(secao));
}

// ================= Começar =================

const letreiro = (await criarLetreiro3D()) || criarLetreiroReserva();

configurarScroll();
observarSecoes();

$("#som").addEventListener("click", alternarSom);
$("#quantia").addEventListener("input", atualizarConversor);
$("#inverter").addEventListener("click", inverterConversor);

const svgGrafico = $("#grafico-svg");
svgGrafico.setAttribute("tabindex", "0");
svgGrafico.addEventListener("pointermove", apontarGrafico);
svgGrafico.addEventListener("pointerdown", apontarGrafico);
svgGrafico.addEventListener("pointerleave", () => marcarPonto(-1));
svgGrafico.addEventListener("keydown", teclasGrafico);
svgGrafico.addEventListener("blur", () => marcarPonto(-1));

let redesenhoPendente = false;
window.addEventListener("resize", () => {
  if (redesenhoPendente) return;
  redesenhoPendente = true;
  requestAnimationFrame(() => {
    redesenhoPendente = false;
    desenharGrafico();
  });
});

// Mostra na hora o último valor salvo (se houver) e depois busca o valor novo
if (cotacao) {
  mostrarStatus();
  mostrarCotacao();
}
desenharGrafico();
mostrarResumoGrafico();
atualizarLetreiro();
carregarCotacao();
carregarHistorico();
setInterval(carregarCotacao, ATUALIZAR_A_CADA);
