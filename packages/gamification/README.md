# Pacote de gamificação

Temporada, passe, missões, loja de cosméticos, amortecedores e proteção de menor, com
um livro-razão que registra a origem de cada movimento. A receita diz quando usar e o
que verificar: [Gamificação e economia](../../recipes/gamification.md). Este arquivo
cobre o pacote: API, formato, testes e limites.

ES modules, **zero dependências**, Node ≥ 20. Roda igual no Node e no navegador. O
tempo entra por parâmetro e o sorteio usa semente. Identificadores em inglês, textos
em português.

## Camadas

| Camada | Módulo | O que garante |
| --- | --- | --- |
| Catálogo | `catalog.js`, `catalog-schema.js` | seções com hash, substituição por seção, validação que nomeia o campo e campos recusados com o motivo |
| Livro-razão | `ledger.js` | só acrescenta; origem e sumidouro de vocabulário fechado; `txId` idempotente; saldo nunca negativo; transação com várias pernas entra inteira |
| Relógios | `clock.js` | virada do dia em hora UTC, semana, mês e temporada; cada relógio declara o que reinicia, acumula e vence |
| Passe | `pass.js` | curva de XP por tier, teto diário, partida parada sem XP, token limitado ao que falta, sem cauda paga |
| Missões | `missions.js` | missão como condição sobre evento; a mesma partida atualiza todas; uma troca grátis por dia |
| Loja | `store.js` | preço em moeda do jogo, rotação igual para todos, cofre, oferta com janela e limite |
| Amortecedores | `dampers.js` | consolo após derrotas seguidas, trilha com teto de perda e margem de tier, primeira vez paga uma vez |
| Sorte | `luck.js` | desligada por padrão; chances somando 1, garantia e reserva de duplicata |
| Segurança | `safety.js`, `purchase.js` | idade desconhecida conta como menor; criança não compra; menor tem limite mensal; sem sorte para menor; compra real só como adaptador desligado |
| Instrumentação | `telemetry.js` | funil derivado do livro e das marcas; bandeiras A/B com início e fim; nada é enviado |
| Estado | `state.js` | estado versionado; versão futura bloqueia; lançamento ilegível é separado |
| Simulador | `simulate.js`, `tools/simulate.mjs` | três personas, várias sementes; julga o pior caso; o catálogo quebrado falha |

## API em dez linhas

```js
import { loadBundle, createGamification, manualClock, simulateSeason } from "./src/index.js";
const { ok, bundle, errors } = loadBundle(catalogJson, { overrides: { luck } }); // hash por seção
const game = createGamification({ bundle, clock: manualClock(Date.now()), playerId, state });
game.handle({ id, type: "match.finished", game: "arena", placement: 3, players: 10, kills, durationS });
game.unlockPremium();            // com moeda ganha; recusa sem saldo
game.buy(cosmeticId); game.buyOffer(offerId); game.reroll(slot); game.pull(tableId);
game.purchaseReal(productId);    // segurança primeiro; o adaptador padrão recusa
game.setProfile({ age, ageSource: "verified", childAccount, guardianLinked });
const view = game.view(); const saved = game.save();  // livro-razão incluso
const report = simulateSeason(bundle);                // report.pass, report.checks
```

Toda ação devolve `{ ok, reason?, effects }`. `reason` é de vocabulário fechado, com
textos em `REASONS`. Os efeitos (`tier`, `mission`, `item`, `duplicate`, `cap`, `idle`,
`consolation`, `reset`, `expired`…) servem à interface.

## Eventos de jogo

| Tipo | Campos |
| --- | --- |
| `match.finished` | `placement`, `players`, `durationS` obrigatórios; `kills`, `wave`, `won`, `mode`, `idle` |
| `level.won` | `stars` (0 a 3); `level`, `durationS`, `idle` |
| `level.lost` | `level`, `durationS`, `idle` |

O `id` do evento é obrigatório. Com ele o motor não paga duas vezes nem avança missão
duas vezes. Campo fora do vocabulário é recusado: não existe `spend`, `segment` nem
perfil de pagante no evento.

## Formato do catálogo

`{ format: "alanstudio.gamification/1", id, version, hash?, sections }`. O esquema está
em [schemas/catalog.schema.json](schemas/catalog.schema.json), exportado de
`src/catalog-schema.js` por `node tools/export-schema.mjs`. Seções obrigatórias:
`series`, `currencies`, `clocks`, `season`, `pass`, `rewards`, `missions`, `cosmetics`,
`store` e `safety`. Opcionais: `offers`, `firstTime`, `dampers`, `luck`, `realPurchase`
e `experiments`.

O hash declarado precisa bater com o conteúdo. Depois de editar à mão, rode
`node tools/rehash.mjs <arquivo>`. Uma substituição por seção recalcula o hash; o
hash declarado vale só para o arquivo intacto. O servidor fica como adaptador
desligado (`remoteSource`).

Exemplos em [examples/](examples/):

- `temporada-exemplo.json`: temporada de 56 dias com 30 tiers, que passa em todos os critérios.
- `catalogo-quebrado.json`: o controle negativo. Uma moeda entra sem sumidouro e o passe pede 120.000 XP.
- `invalido-sorte-sem-soma.json`: chances que somam 0,9.

## Simulador

```sh
node tools/simulate.mjs --summary                                     # exemplo; sai com 0
node tools/simulate.mjs examples/catalogo-quebrado.json --summary     # sai com 1
node tools/simulate.mjs <catalogo.json> --seeds 1,2,3 --criteria c.json --personas p.json --series
```

As personas padrão são três:

| Persona | Sessões por dia | Partidas por sessão | Dias ativos por semana | Jogos |
| --- | ---: | ---: | ---: | ---: |
| casual | 1 | 3 | 4 | 2 |
| regular | 2 | 3 | 5 | 3 |
| dedicado | 3 | 4 | 7 | 6 |

Cada persona tem uma distribuição de colocação por décimo, uma taxa de vitória em fase
e em solo, e uma política de gasto.

Os critérios padrão:

- O casual fecha o passe grátis em até 80% da temporada.
- O regular e o dedicado fecham o premium com moeda ganha.
- Nenhuma moeda fica sem sumidouro, na análise estática e na jogada.
- A razão fonte/sumidouro fica em no máximo 2,5.
- Todo cosmético da temporada tem caminho sem dinheiro real.

O veredito usa o **pior caso entre oito sementes** e o relatório traz também a mediana.

Resultado do exemplo em 26/09/2026:

| Persona | Fecha o grátis (pior · mediana) | Libera o premium | Fecha o premium | Fonte/sumidouro das moedas (pior) | Cosméticos obtidos |
| --- | --- | ---: | --- | ---: | ---: |
| casual | dia 42 · 36 de 56 | dia 21 | dia 42 | 1,14 | 78,9% |
| regular | dia 20 · 17 | dia 13 | dia 20 | 1,41 | 89,5% |
| dedicado | dia 8 · 8 | dia 5 | dia 8 | 2,24 | 100% |

O teto diário tira do dedicado 1.809 XP e 3.413 moedas na semente 1. Sem o teto, ele
fecharia o passe no dia 6 em vez do dia 8. O regular compra tudo o que está à venda
até o dia 37 e o dedicado até o dia 20. Dali em diante a moeda só acumula: o
dedicado termina com 4.055 na mediana. É o limite que a receita discute.

## Testes

```sh
node --test          # 72 testes em tests/
```

São propriedades com sequências semeadas:

- o livro nunca fica negativo, soma igual ao saldo e é idempotente;
- o dia vira na hora UTC certa, também na virada de mês e de ano e em 29 de fevereiro;
- a temporada zera só o que declara;
- o XP nunca passa do último tier;
- o token vale só o que falta;
- o evento repetido não paga;
- a rotação da loja é igual para todos.

Cada regra de segurança tem um teste. Há também três controles negativos: um livro
sem regras é pego pelo verificador, o catálogo quebrado falha no simulador e um
critério mais apertado reprova a mesma temporada.

Em 26/09/2026, nove mutações feitas à mão foram todas pegas pela suíte:

- saldo negativo aceito;
- XP sem limite;
- evento repetido contado de novo;
- idade desconhecida tratada como adulto;
- criança comprando;
- chance que não soma 1;
- troca ilimitada;
- relógio que zera tudo;
- simulador sem as checagens estáticas.

## Consumir

O pacote não é publicado em registro. O consumidor copia `src/` por um script de
sincronização que grava `SOURCE.json` com o commit do core e o sha256 de cada arquivo,
e confere a cópia com `--verify`. A cópia é gerada e nunca se edita à mão. O script
de sincronização mora no consumidor, não neste pacote.

## Limites

- **Fora deste pacote:** backend, contas, pagamento real, envio de analytics e
  integração com os jogos. O estado mora no cliente; o jogador pode adulterá-lo.
  Placar competitivo ou concessão que exija prova precisa de servidor (ver
  [persistência](../../recipes/persistence.md)).
- **O que o simulador não mede:** diversão, retenção nem conversão. Ele mede o
  desenho do catálogo contra personas declaradas; persona não é jogador. Os números
  do exemplo são do exemplo e não viram meta para outro jogo.
- **Números de jogos de terceiros:** os valores vigentes de jogos publicados são
  remotos na maioria. O exemplo não copia número de nenhum deles; usa os padrões e
  os números de desenho do próprio catálogo de exemplo.
- **Compra real:** ligar exige aferição de idade confiável, vínculo parental,
  política de estorno e revisão jurídica. Não basta trocar `enabled`.
