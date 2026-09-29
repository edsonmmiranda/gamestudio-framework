// Aleatoriedade determinística.
//
// Rotação da loja, sorteio de missões, simulação e sorte usam semente explícita:
// a mesma entrada dá o mesmo resultado, o teste reproduz e ninguém recebe uma loja
// "só sua". A semente da loja e das missões nunca inclui gasto nem perfil do jogador.

export function hashSeed(...parts) {
  const text = parts.map((part) => String(part)).join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.state = () => state;
  return next;
}

export function pickWeighted(rng, weights) {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (!(total > 0)) return -1;
  let roll = rng() * total;
  for (let i = 0; i < weights.length; i += 1) {
    const weight = Math.max(0, weights[i]);
    if (roll < weight) return i;
    roll -= weight;
  }
  return weights.length - 1;
}

export function shuffled(rng, list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
