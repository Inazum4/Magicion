/* ================================
   CARD DUEL MVP (Turnos + Deck + IA)
   Estilo visual: MTG-like
   ================================ */

/** ========= CONFIG ========= **/
const GAME = {
  startHP: 20,
  startHand: 4,
  maxField: 4,
  deckSize: 14,
  energyPerTurnCap: 10,
  maxHand: 8,
};

// Danbooru tags
// rating:explicit => NSFW
// negativos => bloqueio de tags relacionadas a menor
const DANBOORU_TAGS = [
  "rating:explicit",
  // temas opcionais:
  // "fantasy", "magic", "warrior",

  "-loli", "-shota", "-child", "-young", "-toddler", "-infant",
].join(" ");

// fallback caso não carregue imagem
const FALLBACK_IMG = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(`
<svg xmlns='http://www.w3.org/2000/svg' width='300' height='190'>
<rect width='100%' height='100%' fill='#0b1220'/>
<text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='#9ca3af' font-family='Arial' font-size='18'>
sem imagem
</text>
</svg>`);

/** ========= ESTADO ========= **/
let state = null;

/** ========= UTIL ========= **/
const $ = (id) => document.getElementById(id);

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function log(msg, cls="") {
  const el = $("log");
  const div = document.createElement("div");
  div.className = "evt " + cls;
  div.textContent = msg;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

/** ========= DANBOORU ========= **/
async function fetchRandomImageUrl() {
  const url = `https://danbooru.donmai.us/posts.json?limit=1&random=true&tags=${encodeURIComponent(DANBOORU_TAGS)}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    const post = data[0];

    // Prioriza uma versão mais "carregável"
    let u = post.large_file_url || post.file_url || post.preview_file_url || null;
    if (!u) return null;

    // Ajustes de URL (às vezes vem // ou /...)
    if (u.startsWith("//")) u = "https:" + u;
    if (u.startsWith("/")) u = "https://danbooru.donmai.us" + u;

    return u;
  } catch (e) {
    return null;
  }
}

/** ========= GERADOR DE CARTAS ========= **/
const NAME_A = ["Entidade", "Guerreira", "Feiticeira", "Demônio", "Anjo", "Caçador", "Bruxa", "Gladiador", "Serafim", "Lâmina"];
const NAME_B = ["Caótico", "Sombrio", "Arcano", "Vermelho", "Abissal", "Celestial", "Feral", "Maldito", "Místico", "Dourado"];

const RARITIES = [
  { key:"Comum",   badge:"comum",   mult:1.0,  weight:55 },
  { key:"Rara",    badge:"rara",    mult:1.25, weight:28 },
  { key:"Épica",   badge:"epica",   mult:1.55, weight:13 },
  { key:"Lendária",badge:"lendaria",mult:2.05, weight:4  },
];

function rollRarity() {
  const total = RARITIES.reduce((s,r)=>s+r.weight,0);
  let roll = Math.random() * total;
  for (const r of RARITIES) {
    roll -= r.weight;
    if (roll <= 0) return r;
  }
  return RARITIES[0];
}

// Habilidades simples (efeitos em combate)
const ABILITIES = [
  {
    key: "Fúria",
    text: "+300 ATK quando ataca.",
    onAttack: () => ({ atkBonus: 300, dmgBonus: 0 }),
  },
  {
    key: "Perfurante",
    text: "Se destruir um inimigo, causa +2 de dano ao HP.",
    afterCombat: (card, ctx) => (ctx.killedDefender ? { faceDamageBonus: 2 } : { faceDamageBonus: 0 })
  },
  {
    key: "Escudo",
    text: "Reduz 2 de dano recebido.",
    onDefend: () => ({ dmgReduction: 2 }),
  },
  {
    key: "Sanguessuga",
    text: "Cura 2 de HP quando destrói uma criatura.",
    afterCombat: (card, ctx) => (ctx.killedDefender ? { heal: 2 } : { heal: 0 })
  },
  {
    key: "Venenosa",
    text: "Ao atacar, causa +1 de dano direto ao HP (extra).",
    onAttack: () => ({ atkBonus: 0, dmgBonus: 1 }),
  },
  { key: "Vazia", text: "Sem habilidade." }
];

function generateCardBase() {
  const rarity = rollRarity();
  const name = `${pick(NAME_A)} ${pick(NAME_B)}`;

  // custo baseado em raridade
  const cost = clamp(Math.round(randInt(1, 4) * rarity.mult), 1, 7);

  // stats
  const base = 400 + cost * 220;
  const atk = Math.round((base + randInt(-120, 180)) * rarity.mult);
  const def = Math.round((base + randInt(-150, 150)) * rarity.mult);

  const ability = pick(ABILITIES);

  // “vida” da criatura (simplificado)
  const hp = Math.max(1, Math.round(def / 250));

  return {
    id: crypto.randomUUID(),
    name,
    img: null,
    rarity: rarity.key,
    rarityBadge: rarity.badge, // comum/rara/epica/lendaria
    cost,
    atk,
    def,
    hp,
    maxHp: hp,
    abilityKey: ability.key,
    abilityText: ability.text,
    _ability: ability,
    exhausted: true, // entra exausta; desvira no começo do turno do dono
  };
}

async function generateCard() {
  const c = generateCardBase();
  const url = await fetchRandomImageUrl();
  c.img = url || FALLBACK_IMG;
  return c;
}

/** ========= JOGO ========= **/
function newEmptyPlayer(name) {
  return {
    name,
    hp: GAME.startHP,
    energy: 0,
    energyMax: 0,
    deck: [],
    hand: [],
    field: [],
    grave: [],
  };
}

function resetState() {
  state = {
    turn: 1,
    current: "player", // "player" | "ai"
    phase: "main",     // "main" | "combat" | "end"
    selectedAttackerId: null,
    busy: false,
    player: newEmptyPlayer("Você"),
    ai: newEmptyPlayer("IA"),
  };
}

async function buildDeck(playerObj) {
  playerObj.deck = [];
  for (let i=0; i<GAME.deckSize; i++){
    playerObj.deck.push(await generateCard());
  }
  shuffle(playerObj.deck);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function opponentOf(side) {
  return side === "player" ? "ai" : "player";
}
function getP(side){ return state[side]; }

function updateHUD() {
  $("turnOwner").textContent = state.current === "player" ? "Você" : "IA";
  $("phase").textContent = state.phase;

  $("pHP").textContent = state.player.hp;
  $("pEnergy").textContent = state.player.energy;
  $("pEnergyMax").textContent = state.player.energyMax;
  $("pDeckCount").textContent = state.player.deck.length;
  $("pHandCount").textContent = state.player.hand.length;
  $("pGraveCount").textContent = state.player.grave.length;

  $("aiHP").textContent = state.ai.hp;
  $("aiEnergy").textContent = state.ai.energy;
  $("aiEnergyMax").textContent = state.ai.energyMax;
  $("aiDeckCount").textContent = state.ai.deck.length;
  $("aiHandCount").textContent = state.ai.hand.length;
  $("aiGraveCount").textContent = state.ai.grave.length;

  const isPlayerTurn = state.current === "player";
  $("btnDraw").disabled = !isPlayerTurn || state.busy || state.phase !== "main";
  $("btnEndTurn").disabled = !isPlayerTurn || state.busy;
  $("btnAttackFace").disabled = !isPlayerTurn || state.busy || state.phase !== "combat" || !state.selectedAttackerId;
}

function cardEl(card, opts = {}) {
  const div = document.createElement("div");
  div.className = "mtg-card";
  div.dataset.id = card.id;

  if (opts.selected) div.classList.add("selected");
  if (card.exhausted) div.classList.add("tapped");

  const rarityClass = `rarity-${(card.rarityBadge || "comum")}`;

  // “P/T” mais MTG: atk vira power, hp vira toughness
  const power = clamp(Math.round(card.atk / 500), 0, 20);
  const tough = clamp(card.hp, 1, 20);

  div.innerHTML = `
    <div class="mtg-frame ${rarityClass}">
      <div class="mtg-titlebar">
        <div class="mtg-title">${card.name}</div>
        <div class="mtg-cost">⚡${card.cost}</div>
      </div>

      <div class="mtg-art">
        <img referrerpolicy="no-referrer" loading="lazy" src="${card.img || FALLBACK_IMG}" alt="">
      </div>

      <div class="mtg-typeline">
        <div class="mtg-type">Criatura — ${card.abilityKey}</div>
        <div class="mtg-rarity">${card.rarity}</div>
      </div>

      <div class="mtg-textbox">
        <div class="mtg-rules">${card.abilityText}</div>
        <div class="mtg-flavor">"${card.rarity === "Lendária" ? "Uma presença que dobra o destino." : "O caos sempre cobra um preço."}"</div>
      </div>

      <div class="mtg-stats">
        <div class="pt">${power}/${tough}</div>
      </div>
    </div>
  `;

  return div;
}

function renderAll() {
  // player hand
  const pHand = $("pHand");
  pHand.innerHTML = "";
  state.player.hand.forEach(c => {
    const el = cardEl(c);
    el.addEventListener("click", () => onClickHandCard(c.id));
    pHand.appendChild(el);
  });

  // player field
  const pField = $("pField");
  pField.innerHTML = "";
  state.player.field.forEach(c => {
    const el = cardEl(c, { selected: state.selectedAttackerId === c.id });
    el.addEventListener("click", () => onClickFieldCard("player", c.id));
    pField.appendChild(el);
  });

  // player grave
  const pGrave = $("pGrave");
  pGrave.innerHTML = "";
  state.player.grave.slice(-6).forEach(c => {
    const el = cardEl(c);
    pGrave.appendChild(el);
  });

  // ai field
  const aiField = $("aiField");
  aiField.innerHTML = "";
  state.ai.field.forEach(c => {
    const el = cardEl(c);
    el.addEventListener("click", () => onClickFieldCard("ai", c.id));
    aiField.appendChild(el);
  });

  // ai hand ghost (oculto)
  const ghost = $("aiHandGhost");
  ghost.innerHTML = "";
  for (let i=0;i<state.ai.hand.length;i++){
    const g = document.createElement("div");
    g.className = "mtg-card";
    g.style.opacity = "0.35";
    g.innerHTML = `
      <div class="mtg-frame rarity-comum">
        <div class="mtg-titlebar">
          <div class="mtg-title">???</div>
          <div class="mtg-cost">⚡?</div>
        </div>
        <div class="mtg-art">
          <img referrerpolicy="no-referrer" loading="lazy" src="${FALLBACK_IMG}" alt="">
        </div>
        <div class="mtg-typeline">
          <div class="mtg-type">Carta — Oculta</div>
          <div class="mtg-rarity">?</div>
        </div>
        <div class="mtg-textbox">
          <div class="mtg-rules">Conteúdo desconhecido.</div>
          <div class="mtg-flavor">"A IA planeja em silêncio."</div>
        </div>
        <div class="mtg-stats"><div class="pt">?/?</div></div>
      </div>
    `;
    ghost.appendChild(g);
  }

  updateHUD();
}

function startTurn(side) {
  const p = getP(side);
  state.current = side;
  state.phase = "main";
  state.selectedAttackerId = null;

  p.energyMax = clamp(p.energyMax + 1, 0, GAME.energyPerTurnCap);
  p.energy = p.energyMax;

  // desvira criaturas do dono
  p.field.forEach(c => c.exhausted = false);

  log(`--- Turno ${state.turn}: ${side === "player" ? "Você" : "IA"} ---`, "muted");

  // compra automática no início
  drawCard(side, true);

  renderAll();

  if (side === "ai") aiTakeTurn();
}

function endTurn() {
  if (state.busy) return;
  state.phase = "end";
  renderAll();

  const next = opponentOf(state.current);
  if (next === "player") state.turn++;

  startTurn(next);
}

async function drawCard(side, silent=false) {
  const p = getP(side);
  if (p.deck.length === 0) {
    p.hp -= 1;
    if (!silent) log(`${p.name} tentou comprar, mas o deck acabou! Sofre 1 de dano.`, "bad");
    checkGameOver();
    return;
  }
  if (p.hand.length >= GAME.maxHand) {
    const burned = p.deck.pop();
    p.grave.push(burned);
    if (!silent) log(`${p.name} está com a mão cheia. Uma carta foi para o cemitério.`, "muted");
    return;
  }
  const c = p.deck.pop();
  p.hand.push(c);
  if (!silent) log(`${p.name} comprou 1 carta.`, "good");
}

function findCard(container, id) {
  return container.find(c => c.id === id) || null;
}

/** ========= AÇÕES DO PLAYER ========= **/
async function onClickHandCard(cardId) {
  if (state.busy) return;
  if (state.current !== "player") return;
  if (state.phase !== "main") return;

  const p = state.player;
  const c = findCard(p.hand, cardId);
  if (!c) return;

  if (p.field.length >= GAME.maxField) {
    log("Seu campo está cheio.", "bad");
    return;
  }
  if (p.energy < c.cost) {
    log(`Energia insuficiente (precisa ${c.cost}).`, "bad");
    return;
  }

  p.energy -= c.cost;
  p.hand = p.hand.filter(x => x.id !== cardId);
  c.exhausted = true;
  p.field.push(c);

  log(`Você conjurou "${c.name}" (⚡${c.cost}).`, "good");
  renderAll();
}

function onClickFieldCard(side, cardId) {
  if (state.busy) return;

  // clicou em criatura sua => selecionar atacante
  if (state.current === "player" && side === "player") {
    if (state.phase !== "combat") {
      // atalho: se estiver na main, muda pra combat
      if (state.phase === "main") {
        state.phase = "combat";
        log("Fase alterada para COMBATE.", "muted");
        renderAll();
      } else {
        log("Você só pode atacar na fase de combate.", "muted");
      }
      return;
    }

    const c = findCard(state.player.field, cardId);
    if (!c) return;
    if (c.exhausted) { log("Essa criatura está exausta e não pode atacar.", "bad"); return; }

    state.selectedAttackerId = (state.selectedAttackerId === cardId) ? null : cardId;
    renderAll();
    return;
  }

  // clicou em criatura inimiga => atacar ela
  if (state.current === "player" && side === "ai") {
    if (state.phase !== "combat") return;
    if (!state.selectedAttackerId) return;

    const atk = findCard(state.player.field, state.selectedAttackerId);
    const def = findCard(state.ai.field, cardId);
    if (!atk || !def) return;

    resolveCombat({
      attackerSide: "player",
      attackerId: atk.id,
      defenderId: def.id,
      direct: false,
    });
  }
}

/** ========= COMBATE ========= **/
function resolveCombat({ attackerSide, attackerId, defenderId=null, direct=false }) {
  const A = getP(attackerSide);
  const D = getP(opponentOf(attackerSide));

  const attacker = findCard(A.field, attackerId);
  if (!attacker) return;

  if (attacker.exhausted) {
    log("Atacante está exausto.", "bad");
    return;
  }

  // habilidade: ataque
  let atkBonus = 0;
  let dmgBonus = 0;

  if (attacker._ability?.onAttack) {
    const res = attacker._ability.onAttack(attacker, {});
    atkBonus += (res?.atkBonus || 0);
    dmgBonus += (res?.dmgBonus || 0);
  }

  const attackValue = attacker.atk + atkBonus;

  if (direct) {
    const dmg = Math.max(0, Math.round(attackValue / 700)) + dmgBonus;
    D.hp -= dmg;
    attacker.exhausted = true;

    log(`${A.name} atacou direto com "${attacker.name}" e causou ${dmg} de dano!`, "bad");

    if (attacker._ability?.afterCombat) {
      const extra = attacker._ability.afterCombat(attacker, { killedDefender:false });
      if (extra?.faceDamageBonus) {
        D.hp -= extra.faceDamageBonus;
        log(`Efeito (${attacker.abilityKey}): +${extra.faceDamageBonus} dano ao HP.`, "bad");
      }
      if (extra?.heal) {
        A.hp += extra.heal;
        log(`Efeito (${attacker.abilityKey}): cura +${extra.heal}.`, "good");
      }
    }

    checkGameOver();
    state.selectedAttackerId = null;
    renderAll();
    return;
  }

  // combate contra criatura
  const defender = findCard(D.field, defenderId);
  if (!defender) return;

  // habilidade: defesa
  let dmgReduction = 0;
  if (defender._ability?.onDefend) {
    const res = defender._ability.onDefend(defender, {});
    dmgReduction += (res?.dmgReduction || 0);
  }

  let dmgToDef = Math.max(1, Math.round(attackValue / 600));
  dmgToDef = Math.max(0, dmgToDef - dmgReduction);

  defender.hp -= dmgToDef;
  attacker.exhausted = true;

  log(`${A.name} atacou "${defender.name}" com "${attacker.name}" e causou ${dmgToDef} de dano.`, "muted");

  let killed = false;
  if (defender.hp <= 0) {
    killed = true;
    D.field = D.field.filter(x => x.id !== defender.id);
    D.grave.push(defender);
    log(`"${defender.name}" foi destruída!`, "bad");
  }

  if (attacker._ability?.afterCombat) {
    const extra = attacker._ability.afterCombat(attacker, { killedDefender: killed });
    if (extra?.faceDamageBonus) {
      D.hp -= extra.faceDamageBonus;
      log(`Efeito (${attacker.abilityKey}): +${extra.faceDamageBonus} dano ao HP.`, "bad");
    }
    if (extra?.heal) {
      A.hp += extra.heal;
      log(`Efeito (${attacker.abilityKey}): cura +${extra.heal}.`, "good");
    }
  }

  checkGameOver();
  state.selectedAttackerId = null;
  renderAll();
}

function checkGameOver() {
  if (state.player.hp <= 0 && state.ai.hp <= 0) {
    log("Empate!", "bad");
    lockGame();
    return true;
  }
  if (state.player.hp <= 0) {
    log("Você perdeu! (HP chegou a 0)", "bad");
    lockGame();
    return true;
  }
  if (state.ai.hp <= 0) {
    log("Você venceu! (HP da IA chegou a 0)", "good");
    lockGame();
    return true;
  }
  return false;
}

function lockGame() {
  $("btnDraw").disabled = true;
  $("btnEndTurn").disabled = true;
  $("btnAttackFace").disabled = true;
  state.busy = true;
}

/** ========= IA ========= **/
async function aiTakeTurn() {
  state.busy = true;
  renderAll();

  const ai = state.ai;
  const player = state.player;

  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  // MAIN: invocar o que der (prioriza custo alto)
  state.phase = "main";
  renderAll();
  await wait(350);

  ai.hand.sort((a,b)=>b.cost-a.cost);
  let invoked = true;

  while (invoked) {
    invoked = false;
    if (ai.field.length >= GAME.maxField) break;

    const playable = ai.hand.find(c => c.cost <= ai.energy);
    if (playable) {
      ai.energy -= playable.cost;
      ai.hand = ai.hand.filter(x => x.id !== playable.id);
      playable.exhausted = true;
      ai.field.push(playable);

      log(`IA conjurou "${playable.name}" (⚡${playable.cost}).`, "muted");
      invoked = true;
      renderAll();
      await wait(350);
    }
  }

  // COMBATE
  state.phase = "combat";
  renderAll();
  await wait(300);

  for (const attacker of [...ai.field]) {
    if (checkGameOver()) break;
    if (attacker.exhausted) continue;

    const defenders = [...player.field].sort((a,b)=>a.hp-b.hp);

    if (defenders.length > 0) {
      const target = defenders[0];
      resolveCombat({
        attackerSide: "ai",
        attackerId: attacker.id,
        defenderId: target.id,
        direct: false,
      });
      await wait(350);
    } else {
      resolveCombat({
        attackerSide: "ai",
        attackerId: attacker.id,
        direct: true,
      });
      await wait(350);
    }
  }

  state.busy = false;
  if (!checkGameOver()) endTurn();
}

/** ========= UI ========= **/
$("btnNewGame").addEventListener("click", async () => {
  await setupNewGame();
});

$("btnDraw").addEventListener("click", async () => {
  if (state.current !== "player") return;
  if (state.phase !== "main") return;
  await drawCard("player");
  renderAll();
  checkGameOver();
});

$("btnEndTurn").addEventListener("click", () => {
  if (state.current !== "player") return;
  endTurn();
});

$("btnAttackFace").addEventListener("click", () => {
  if (state.current !== "player") return;
  if (state.phase !== "combat") return;
  const attackerId = state.selectedAttackerId;
  if (!attackerId) return;
  resolveCombat({ attackerSide:"player", attackerId, direct:true });
});

/** ========= SETUP ========= **/
async function setupNewGame() {
  resetState();
  $("log").innerHTML = "";
  log("Gerando decks com imagens aleatórias... (se algumas não carregarem, é bloqueio de hotlink do host)", "muted");

  state.busy = true;
  renderAll();

  await buildDeck(state.player);
  await buildDeck(state.ai);

  for (let i=0;i<GAME.startHand;i++){
    await drawCard("player", true);
    await drawCard("ai", true);
  }

  state.busy = false;
  renderAll();

  startTurn("player");
}

/** ========= START ========= **/
setupNewGame();
